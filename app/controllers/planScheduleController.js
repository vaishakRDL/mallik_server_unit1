const { handleErrorResponse, connection, handleSuccessResponse, CustomError } = require("../config/dbSql");
const moment = require('moment');
const { shopFloorSchedule } = require("./scheduleController");
const { getUser } = require("../utility/utilityFunction");
const { generateMRP } = require("./mrpController");

exports.updateOrderPriority = async (conn) => {
    try {
        const [rows] = await conn.execute(`SELECT id FROM order_plannings WHERE orderPriority != ? ORDER BY orderPriority ASC`, [0]);

        const updateQuery = `UPDATE order_plannings SET orderPriority = ? WHERE id = ?`;
        let priority = 1;
        for (const row of rows) {
            await conn.execute(updateQuery, [priority, row.id]);
            priority++;
        }

        return true;
    } catch (err) {
        throw err;
    }
}

exports.eventLogs = async (conn, module, event, user) => {
    try {
        await conn.execute(`INSERT INTO event_logs (module, event, user) VALUES (?, ?, ?)`,
            [module, event, user]
        );

        return true;
    } catch (err) {
        throw err;
    }
}

exports.productionCheck = async (op) => {
    try {
        if (!op || isNaN(op)) {
            throw new CustomError('Invalid or missing order priority');
        }

        const [orders] = await connection.execute(`
            SELECT mm.id, op.kanbanDate, op.orderPriority
            FROM mrp_mst mm
            INNER JOIN order_plannings op ON op.id = mm.orderPlnId
            WHERE op.orderPriority >= ?`,
            [op]
        );

        if (orders.length === 0) {
            return true;
        }

        // Map MRP IDs and create lookup for later use
        const mrpMstIds = orders.map(order => order.id);
        const mrpObj = Object.fromEntries(
            orders.map(order => [order.id, { kanbanDate: order.kanbanDate, orderPriority: order.orderPriority }])
        );

        const placeholders = mrpMstIds.map(() => '?').join(',');
        const [productionRows] = await connection.execute(`
            SELECT DISTINCT mrpMstId 
            FROM jobcard_planning 
            WHERE producedQty > 0 AND mrpMstId IN (${placeholders})`,
            mrpMstIds
        );

        if (productionRows.length > 0) {
            const affectedPriorities = [...new Set(productionRows.map(row => mrpObj[row.mrpMstId].orderPriority))];
            const priorityList = affectedPriorities.join(', ');

            throw new CustomError(`Rescheduling is not possible for orders with priorities: ${priorityList}`);
        }

        return true;
    } catch (err) {
        throw err;
    }
};

exports.revertAllocation = async (conn, orderPlnId) => {
    try {
        // Fetch items with their allocQty
        const [items] = await connection.execute(`
            SELECT itemId, SUM(allocQty) as allocQty 
            FROM sfg 
            WHERE orderPlnId = ? 
            GROUP BY itemId`,
            [orderPlnId]
        );

        if (items.length === 0) return true;

        let updateQuery = `
            UPDATE items 
            SET allocStk = CASE`;
        const itemIds = [];

        // Add CASE conditions and collect item IDs
        for (const item of items) {
            updateQuery += ` 
                WHEN id = ? THEN allocStk + ?`;
            itemIds.push(item.itemId, item.allocQty);
        }

        // Close the CASE statement and add WHERE clause
        updateQuery += `
            END 
            WHERE id IN (${items.map(() => "?").join(", ")})`;

        await conn.execute(updateQuery, [...itemIds, ...items.map(item => item.itemId)]);

        return true;
    } catch (err) {
        throw err;
    }
};

const orderPlanning = async (priority) => {
    const [rows] = await connection.execute(`
        SELECT mrp_mst.id AS mrpMstId, orderPriority 
        FROM order_plannings op
        LEFT JOIN mrp_mst ON mrp_mst.orderPlnId = op.id
        WHERE op.orderPriority >= ? AND op.orderPriority != ?
        ORDER BY op.orderPriority ASC`,
        [priority, 0]
    );

    return rows;
}

// Function to current and previous shifts with dates
function getCurrentAndPreviousShift() {
    try {
        const shiftTimings = {
            1: { start: '06:00:00', end: '14:00:00' },
            2: { start: '14:00:00', end: '22:00:00' },
            3: { start: '22:00:00', end: '06:00:00' }
        };

        const previousShifts = {
            1: 3,
            2: 1,
            3: 2
        };

        const currentMoment = moment(); // Get current system time
        const currentTime = currentMoment.format('HH:mm:ss'); // Extract current time in HH:mm:ss format
        let currentShift = null;

        // Helper function to format date
        function formatDate(date) {
            return date.format('YYYY-MM-DD');
        }

        // Function to determine if current time is between start and end times (spanning midnight if needed)
        function isTimeInShift(startTime, endTime, currentTime) {
            const start = moment(startTime, 'HH:mm:ss');
            const end = moment(endTime, 'HH:mm:ss');
            const current = moment(currentTime, 'HH:mm:ss');

            if (end.isBefore(start)) {
                // Shift spans midnight
                return current.isAfter(start) || current.isBefore(end);
            }
            return current.isBetween(start, end, null, '[)');
        }

        for (let shift in shiftTimings) {
            const { start, end } = shiftTimings[shift];
            if (isTimeInShift(start, end, currentTime)) {
                currentShift = parseInt(shift, 10);
                break;
            }
        }

        if (currentShift === null) {
            throw new CustomError(`Current time does not fall within any shift`);
        }

        // Determine the previous shift
        const previousShift = previousShifts[currentShift];

        // Get the current date
        let currentShiftDate = moment(); // Today's date
        let previousShiftDate = moment(currentShiftDate);

        // If previous shift is '3' and current shift is '1', adjust date to the previous day
        if (currentShift === 1) {
            previousShiftDate.subtract(1, 'days'); // Previous shift was yesterday
        }

        return {
            currentShift,
            previousShift,
            previousShiftDate: formatDate(previousShiftDate)
        };
    } catch (err) {
        throw err;
    }
}

const holdOrder = async (planningDetails) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        // const {  orderId } = planningDetails;
        const { docID, orderID, approvedUser, approvedDate } = planningDetails;

        // await conn.execute(`DELETE FROM mrp_mst WHERE orderPlnId = ?`, [orderId]);
        await conn.execute(`DELETE FROM mrp_mst WHERE orderPlnId = ?`, [orderID]);
        await conn.execute(`UPDATE order_plannings SET status = ?, mrpStatus = ?, orderPriority = ?, authRequest = ? WHERE id = ?`, ['Hold', 0, 0, 0, orderID]);
        await conn.execute(`UPDATE authorize_planning_doc SET status = ?, authorizedUser = ?, authorizedDate = ? WHERE id = ?`, [1, approvedUser, approvedDate, docID]);

        await this.updateOrderPriority(conn);
        await conn.commit();

        return true;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// const forceDeleteOrder = async (planningDetails) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();

//     try {
//         const { docID, orderID, approvedUser, approvedDate } = planningDetails;

//         await this.revertAllocation(conn, orderID);

//         await conn.execute(`DELETE FROM mrp_mst WHERE orderPlnId = ?`, [orderID]);
//         await conn.execute(`DELETE FROM order_plannings WHERE id = ?`, [orderID]);
//         await conn.execute(`UPDATE authorize_planning_doc SET status = ?, authorizedUser = ?, authorizedDate = ? WHERE id = ?`, [1, approvedUser, approvedDate, docID]);

//         await this.updateOrderPriority(conn);
//         await conn.commit();

//         return true;
//     } catch (err) {
//         await conn.rollback();
//         throw err;
//     } finally {
//         conn.release();
//     }
// }

const forceDeleteOrder = async (planningDetails) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { docID, orderID, approvedUser, approvedDate } = planningDetails;

        if (!docID || !orderID) {
            throw new Error('Invalid planning details');
        }

        // 1. Revert allocations
        await this.revertAllocation(conn, orderID);

        // 2. Fetch MRP info
        const [mrpRows] = await conn.execute(
            `
            SELECT s.contractNos, m.sobMstId
            FROM mrp_mst m
            LEFT JOIN sob_mst s ON s.id = m.sobMstId
            WHERE m.orderPlnId = ?
            `,
            [orderID]
        );

        if (!mrpRows.length) {
            throw new Error(`MRP not found for orderPlnId: ${orderID}`);
        }

        const { sobMstId, contractNos } = mrpRows[0];

        // 3. Delete CSL + SOB only if contracts exist
        if (sobMstId && contractNos) {
            const contractList = contractNos
                .split(',')
                .map(cn => cn.trim())
                .filter(Boolean);

            if (contractList.length) {
                const placeholders = contractList.map(() => '?').join(',');

                await conn.execute(
                    `DELETE FROM csl_mst WHERE contractNo IN (${placeholders})`,
                    contractList
                );
            }

            await conn.execute(
                `DELETE FROM sob_mst WHERE id = ?`,
                [sobMstId]
            );
        }

        // 4. Delete MRP & order planning
        await conn.execute(
            `DELETE FROM mrp_mst WHERE orderPlnId = ?`,
            [orderID]
        );

        await conn.execute(
            `DELETE FROM order_plannings WHERE id = ?`,
            [orderID]
        );

        // 5. Update authorization doc
        await conn.execute(
            `
            UPDATE authorize_planning_doc
            SET status = ?, authorizedUser = ?, authorizedDate = ?
            WHERE id = ?
            `,
            [1, approvedUser, approvedDate, docID]
        );

        // 6. Update priorities
        await this.updateOrderPriority(conn);

        await conn.commit();
        return true;

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
};

const rescheduleOrder = async (planningDetails) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { docID, orderID, priority: op, approvedUser, approvedDate } = planningDetails;

        const priority = parseInt(op, 10)
        if (!priority) {
            throw new CustomError(`Please select priority!`);
        }

        // Production check
        await this.productionCheck(priority);

        const rows = await orderPlanning(priority);

        const filteredRows = rows.filter(row => row.mrpMstId !== null);
        const mrpMstIds = filteredRows.map(row => row.mrpMstId);

        if (mrpMstIds.length > 0) {
            const placeholders = mrpMstIds.map(() => '?').join(',');

            await conn.execute(`DELETE FROM sf_schedule WHERE mrpMstId IN (${placeholders})`, mrpMstIds);
        }

        await conn.execute(`UPDATE order_plannings SET orderPriority = ? WHERE id = ?`, [priority, orderID]);

        const [orders] = await conn.execute(`
            SELECT op.id AS opId, op.orderPriority 
            FROM order_plannings op
            WHERE op.orderPriority >= ? AND op.orderPriority != ?
            ORDER BY op.orderPriority ASC`,
            [priority, 0]
        );

        let orderPriority = priority + 1;
        const updatePromises = [];

        for (const row of orders) {
            const { opId } = row;

            if (orderID !== opId) {
                updatePromises.push(
                    conn.execute(`UPDATE order_plannings SET orderPriority = ? WHERE id = ?`, [orderPriority, opId])
                );
                orderPriority++;
            }
        }
        await Promise.all(updatePromises);

        const updatedPlanning = await orderPlanning(priority);

        for (const item of updatedPlanning) {
            if (item.mrpMstId) {
                await shopFloorSchedule(conn, item.mrpMstId);
            }
        }
        await conn.execute(`UPDATE order_plannings SET status = ?, authRequest = ? WHERE id = ?`, ['MRP', 0, orderID]);
        await conn.execute(`UPDATE authorize_planning_doc SET status = ?, authorizedUser = ?, authorizedDate = ? WHERE id = ?`, [1, approvedUser, approvedDate, docID]);
        await conn.commit();

        return true;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

const forceCompleteOrder = async (planningDetails) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { docID, orderID, approvedUser, approvedDate } = planningDetails;

        const [mrp] = await conn.execute(`SELECT id FROM mrp_mst WHERE orderPlnId = ?`, [orderID]);

        if (!mrp.length) {
            throw new CustomError(`MRP not found!`, 404);
        }
        const mrpMstId = mrp[0].id;

        // const { currentShift, previousShift, previousShiftDate } = getCurrentAndPreviousShift();

        // await conn.execute(`UPDATE job_card SET Produced_QTY = Qty WHERE mrpMstId = ?`, [mrpMstId]);
        // await conn.execute(`UPDATE jobcard_planning SET producedQty = Qty WHERE mrpMstId = ?`, [mrpMstId]);
        await conn.execute(`UPDATE sf_schedule SET status = ? WHERE mrpMstId = ?`, [1, mrpMstId]);

        await conn.execute(`UPDATE order_plannings SET status = ?, orderPriority = ?, authRequest = ? WHERE id = ?`, ['Force Completed', 0, 0, orderID]);
        await conn.execute(`UPDATE authorize_planning_doc SET status = ?, authorizedUser = ?, authorizedDate = ? WHERE id = ?`, [1, approvedUser, approvedDate, docID]);

        await this.updateOrderPriority(conn);
        await conn.commit();

        return true;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

exports.planning = async (req, res) => {
    try {
        const { type } = req.body;

        if (type === 'hold') {
            return await holdOrder(req, res);
        } else if (type === 'forceComplete') {
            return await forceCompleteOrder(req, res);
        } else if (type === 'forceDelete') {
            return await forceDeleteOrder(req, res);
        } else if (type === 'reschedule') {
            return await rescheduleOrder(req, res);
        } else {
            throw new CustomError(`Invalid type recieved!`, 400)
        }
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.reqForAuthorization = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const { orderId, type, kanbanDate, typeOfOrder, priority, reason } = req.body;

        const validTypes = new Set(['hold', 'forceComplete', 'forceDelete', 'reschedule', 'mrp']);
        if (!validTypes.has(type)) {
            throw new CustomError(`Invalid type provided!`, 400);
        }

        const reqUser = await getUser(req);
        const reqDate = moment().format('YYYY-MM-DD HH:mm:ss');

        const scheduleTypes = {
            hold: "Hold Pending",
            forceComplete: "ForceComplete Pending",
            forceDelete: "ForceDelete Pending",
            reschedule: "Reschedule Pending",
            mrp: "MRP Pending",
        }

        const [planningData] = await conn.execute(`
            SELECT orderNo, status, mrpStatus, authRequest FROM order_plannings WHERE id = ?`,
            [orderId]
        );

        if (!planningData.length) {
            throw new CustomError(`Order not found!`, 404);
        }
        if (type === 'reschedule') {
            await this.productionCheck(priority);
        }

        const { orderNo, status, mrpStatus, authRequest } = planningData[0];
        if (authRequest === 1) throw new CustomError(`Requested Order is already in pending status!`, 400);
        if (mrpStatus && type === 'mrp') throw new CustomError(`MRP is already generated for this Order!`, 400);

        const docData = JSON.stringify({ kanbanDate, typeOfOrder, priority });

        await conn.execute(`
            INSERT INTO authorize_planning_doc (dateTime, docType, docID, docNo, docData, user, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [reqDate, type, orderId, orderNo, docData, reqUser, type === 'mrp' ? 'Kanban' : reason]
        );

        await conn.execute(`
            UPDATE order_plannings set authRequest = ?, prevStatus = ?, status = ? WHERE id = ?`,
            [1, status, scheduleTypes[type], orderId]
        );

        await conn.commit();

        return handleSuccessResponse(res, 'Request submitted successfully. Awaiting approval.');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

exports.getAuthDocs = async (req, res) => {
    try {
        const { type } = req.query;

        const normalizedType = type?.toLowerCase();
        const statusMap = {
            pending: 0,
            approved: 1
        };

        if (!(normalizedType in statusMap)) {
            throw new CustomError('Invalid type. Use Pending or Approved.', 400);
        }

        const status = statusMap[normalizedType];

        const [rows] = await connection.execute(`
            SELECT 
                ROW_NUMBER() OVER (ORDER BY ap.id) AS sNo, 
                ap.id, 
                ap.docNo, 
                CONCAT(UCASE(LEFT(ap.docType, 1)), LCASE(SUBSTRING(ap.docType, 2))) AS docType,
                ap.user AS requestedBy, 
                DATE_FORMAT(ap.dateTime, '%d-%m-%Y %H:%i:%s') AS requestedDate,
                ap.reason,
                ap.authorizedUser AS authorizedBy,
                DATE_FORMAT(ap.authorizedDate, '%d-%m-%Y') AS authorizedDate,
                CASE when ap.status = 0 then 'Pending' else 'Approved' end as status
            FROM authorize_planning_doc ap
            WHERE ap.status = ?`,
            [status]
        );

        return handleSuccessResponse(res, 'Documents fetched successfully', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.processPlanningDocs = async (req, res) => {
    try {
        const { docIDs } = req.body;

        if (!Array.isArray(docIDs) || docIDs.length === 0) {
            throw new CustomError('Please select documents to process!', 400);
        }

        const approvedDate = moment().format('YYYY-MM-DD HH:mm:ss');
        const approvedUser = await getUser(req);

        const docTypeHandlers = {
            hold: holdOrder,
            forceComplete: forceCompleteOrder,
            forceDelete: forceDeleteOrder,
            reschedule: rescheduleOrder,
            mrp: generateMRP
        };

        for (const docID of docIDs) {
            const [rows] = await connection.execute(
                `SELECT docID as orderID, docType, docData FROM authorize_planning_doc WHERE id = ? AND status = 0`,
                [docID]
            );

            if (!rows.length) {
                throw new CustomError(`Invalid document ID: [${docID}] or the Document is already processed!`, 400);
            }

            const { orderID, docType, docData } = rows[0];

            if (!(docType in docTypeHandlers)) {
                throw new CustomError(`Invalid document type: ${docType}`, 400);
            }

            const planningDetails = {
                docID,
                orderID,
                ...JSON.parse(docData),
                approvedDate,
                approvedUser
            };

            // Call the respective handler
            await docTypeHandlers[docType](planningDetails);
        }

        return handleSuccessResponse(res, 'Documents processed successfully!');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.processMRP = async (req, res) => {
    try {
        const planningDetails = req.body;

        await generateMRP(planningDetails);
        return handleSuccessResponse(res, 'MRP generated successfully!');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.declinePlanningDocs = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { docIDs } = req.body;

        if (!Array.isArray(docIDs) || docIDs.length === 0) {
            throw new CustomError('Please select documents to process!', 400);
        }

        const placeholders = docIDs.map(() => '?').join(',');
        const [opRows] = await conn.execute(
            `SELECT docID 
             FROM authorize_planning_doc 
             WHERE id IN (${placeholders}) 
             AND status = 0`,
            docIDs
        );

        if (opRows.length === 0) {
            throw new CustomError('No pending documents found to decline!', 400);
        }

        const orderIDs = opRows.map(row => row.docID);

        const orderPlaceholders = orderIDs.map(() => '?').join(',');
        await conn.execute(
            `UPDATE order_plannings 
             SET authRequest = 0, 
                 status = prevStatus, 
                 prevStatus = NULL 
             WHERE id IN (${orderPlaceholders})`,
            orderIDs
        );

        await conn.execute(
            `DELETE FROM authorize_planning_doc 
             WHERE docID IN (${orderPlaceholders}) 
             AND status = 0`,
            orderIDs
        );

        await conn.commit();

        return handleSuccessResponse(res, `Documents declined successfully!`);
    } catch (err) {
        if (conn) await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


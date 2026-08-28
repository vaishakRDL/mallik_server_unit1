const { connection, CustomError, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');
const { updateDocCounter } = require('../utility/docNo');
const utility = require('../utility/utilityFunction');

exports.uniqueOrderInput = async () => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const currentDate = new Date();
        const yearMonth = `${currentDate.getFullYear().toString().slice(-2)}${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;

        let orderNo;

        const [counterRows] = await conn.execute(
            `SELECT number FROM counter WHERE counterType = ? AND month = ?`,
            ['OrderInput', yearMonth]
        );

        if (counterRows.length === 0) {
            orderNo = 1;
            const [rows] = await conn.execute(
                `UPDATE counter SET month = ?, number = ? WHERE counterType = ? AND month != ?`,
                [yearMonth, orderNo, 'OrderInput', yearMonth]
            );

            if (rows.affectedRows === 0) {
                await conn.execute(
                    `INSERT INTO counter(counterType, month, number) VALUES(?, ?, ?)`,
                    ['OrderInput', yearMonth, orderNo]
                );
            }
        } else {
            orderNo = counterRows[0].number;
        }
        await conn.commit();

        return `${yearMonth}OI${orderNo}`;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        if (conn) conn.release();
    }
};


exports.getOrderNo = async (req, res) => {
    try {
        const orderNo = await utility.getOrderNo(req);

        if (orderNo) return res.status(200).json({ success: true, orderNo: orderNo })
        throw new CustomError("Something went wrong!", 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
};


exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { orderNo = null, poRef, customerId = null, orderPriority, file, isBatchProduction, fim = null, remarks, isNpd = 0, isAssembly = 0, generateSrn = 1, itemLists } = req.body;

        if (!Array.isArray(itemLists) || itemLists.length === 0) {
            throw new CustomError("Please select items", 400);
        }
        const filePath = file ? utility.storeFile(file, 'sales') : null;
        const saleId = await this.uniqueOrderInput();
        const createdBy = await utility.getUser(req);

        const [fetchOrders] = await conn.execute(`SELECT id FROM sales WHERE orderNo = ?`, [orderNo]);

        const uniqueOrderNo = fetchOrders.length > 0 ? await utility.getOrderNo(req) : orderNo;

        const [rows] = await conn.execute(`
            INSERT INTO sales (
                saleId, orderNo, poRef, customerId, orderPriority,
                isBatchProd, fim, file, remarks, isNpd, isAssembly, generateSrn, createdBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [saleId, uniqueOrderNo, poRef, customerId, orderPriority, isBatchProduction, fim, filePath, remarks, isNpd, isAssembly, generateSrn, createdBy]);

        if (rows.affectedRows > 0) {
            const insertId = rows.insertId;

            const placeholders = itemLists.map(() => '(?, ?, ?, ?, ?)').join(', ');
            const orderQuery = `INSERT INTO salesOrder (saleMstId, saleId, refNo, itemId, Qty) VALUES ${placeholders}`;
            const orderValues = itemLists.flatMap(item => [insertId, saleId, item.refNo || null, item.itemId, item.Qty]); //Made changes here to id as itemId 

            await conn.execute(orderQuery, orderValues);

            await updateDocCounter(conn, 'OrderPlan');
            await utility.updateCounter('OrderInput');

            await conn.commit();
            return handleSuccessResponse(res, 'Order added successfully');
        }

        throw new CustomError("Failed to add sales order", 400);
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};



exports.update = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { id } = req.params;
        const { saleId, orderNo = null, poRef, customerId = null, orderPriority, file, isBatchProduction, fim = null, remarks, isNpd = 0, isAssembly = 0, itemLists } = req.body;

        if (!id) {
            throw new CustomError("Sale ID is required", 400);
        }

        if (!Array.isArray(itemLists) || itemLists.length === 0) {
            throw new CustomError("Please select items", 400);
        }

        const filePath = file ? utility.storeFile(file, 'sales') : null;

        // Update sales table
        const [rows] = await conn.execute(`
            UPDATE sales SET
                poRef = ?, customerId = ?, orderPriority = ?,
                isBatchProd = ?, fim = ?, file = ?, remarks = ?, isNpd = ?, isAssembly = ?
            WHERE id = ?
        `, [poRef, customerId, orderPriority, isBatchProduction, fim, filePath, remarks, isNpd, isAssembly, id]);

        if (rows.affectedRows > 0) {
            // Delete existing items for this saleId in salesOrder
            await conn.execute(`DELETE FROM salesOrder WHERE saleId = ?`, [saleId]);

            // Insert updated item details
            const placeholders = itemLists.map(() => '(?, ?, ?, ?)').join(', ');
            const orderQuery = `INSERT INTO salesOrder (saleMstId, saleId, itemId, Qty) VALUES ${placeholders}`;
            const orderValues = itemLists.flatMap(item => [id, saleId, item.itemId, item.Qty]);

            await conn.execute(orderQuery, orderValues);

            await conn.commit();
            return handleSuccessResponse(res, 'Order updated successfully');
        }

        throw new CustomError("Failed to update sales order", 400);
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


// exports.delete = async (req, res) => {
//     try {
//         const id = req.params.id;

//         await connection.execute(`
//             DELETE so
//             FROM salesorder so
//             INNER JOIN sales s ON so.saleId = s.saleId
//             WHERE s.id = ?;
//         `, [id]);

//         await connection.execute('DELETE from sales WHERE id = ?', [id]);

//         return res.status(200).json({ success: true, message: "Successfully deleted" });
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };

exports.delete = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const id = req.params.id;

        await conn.beginTransaction();

        const [rows] = await conn.execute('SELECT id, saleId, processed FROM sales WHERE id = ?', [id]);

        if (!rows.length) {
            throw new CustomError("Sale not found", 404);
        }
        if (rows[0].processed) {
            throw new CustomError("Cannot delete a processed order", 400);
        }

        await conn.execute(
            'DELETE FROM salesorder WHERE saleId = ?',
            [rows[0].saleId]
        );

        await conn.execute(
            'DELETE FROM sales WHERE id = ?',
            [id]
        );

        // await conn.execute(
        //     'DELETE FROM sales WHERE id = ?',
        //     [id]
        // );

        await conn.commit();
        return handleSuccessResponse(res, "Successfully deleted");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


// exports.show = async (req, res) => {
//     try {
//         const { isNpd, isAssembly, fromDate, toDate, type = 'Pending' } = req.query;

//         const selectQuery = isAssembly === '1' ? `, DATE_FORMAT(ap.shipmentDate, '%d-%m-%Y') AS shipmentDate` : ``;
//         const joinQuery = isAssembly === '1' ? ` LEFT JOIN assembly_planning ap ON ap.saleMstId = s.id` : ``;

//         let fetchQuery = `
//             SELECT ROW_NUMBER() OVER(ORDER BY s.id) as sNo, s.id, s.saleId, s.orderNo, s.poRef, c.cCode, c.id as custId, DATE_FORMAT(s.created_at, '%d-%m-%Y') AS createdDate, s.fim,
//                 s.createdBy ${selectQuery}
//             FROM sales s
//             LEFT JOIN customer c ON c.id = s.customerId
//             ${joinQuery}
//             WHERE s.isNpd = ? AND s.isAssembly = ? AND s.status = ?
//         `;
//         let values = [isNpd, isAssembly, type];

//         if (fromDate && toDate) {
//             fetchQuery += ` AND date(s.created_at) >= ? AND date(s.created_at) <= ?`;
//             values.push(fromDate, toDate);
//         }
//         fetchQuery += ` GROUP BY s.id`;
//         const [rows] = await connection.execute(fetchQuery, values);

//         return handleSuccessResponse(res, 'Order Lists', rows);
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };

exports.show = async (req, res) => {
    try {
        const {
            isNpd = 0,
            isAssembly = 0,
            fromDate,
            toDate,
            type = 'Pending',
            limit = 100,
            offset = 0
        } = req.query;

        const isAssemblyFlag = Number(isAssembly) === 1;

        const selectColumns = `
            s.id,
            s.saleId,
            s.orderNo,
            s.poRef,
            c.cCode,
            c.id AS custId,
            DATE_FORMAT(s.created_at, '%d-%m-%Y') AS createdDate,
            s.fim,
            s.createdBy
            ${isAssemblyFlag ? `, DATE_FORMAT(ap.shipmentDate, '%d-%m-%Y') AS shipmentDate` : ``}
        `;

        let query = `
            SELECT 
                ROW_NUMBER() OVER (ORDER BY s.id ASC) AS sNo,
                ${selectColumns}
            FROM sales s
            LEFT JOIN customer c ON c.id = s.customerId
            ${isAssemblyFlag ? `LEFT JOIN assembly_planning ap ON ap.saleMstId = s.id` : ``}
            WHERE s.isNpd = ?
              AND s.isAssembly = ?
              AND s.status = ?
        `;

        const values = [isNpd, isAssembly, type];

        if (fromDate && toDate) {
            query += ` AND s.created_at BETWEEN ? AND ?`;
            values.push(`${fromDate} 00:00:00`, `${toDate} 23:59:59`);
        }

        query += `
            GROUP BY s.id
            LIMIT ?
            OFFSET ?
        `;

        values.push(Number(limit), Number(offset));

        const [rows] = await connection.execute(query, values);

        return handleSuccessResponse(res, 'Order list fetched successfully', rows);
    } catch (error) {
        return handleErrorResponse(res, err);
    }
};

exports.fetch = async (req, res) => {
    try {
        const { fromDate, toDate, type, isNpd } = req.body;

        let fetchQuery = `
            SELECT 
                op.id, op.orderNo, op.poNo, op.requestedBy, op.delay,
                op.status, op.orderPriority,
                cust.cName,
                mrp_mst.id AS mrpMstId, mrp_mst.mrpNo,
                DATE_FORMAT(op.created_at, '%d-%m-%Y') AS created_at,
                DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
            FROM order_plannings AS op
            LEFT JOIN customer AS cust ON cust.id = op.customerId
            LEFT JOIN mrp_mst ON mrp_mst.orderPlnId = op.id
            WHERE op.isNpd = ?
        `;

        let values = [isNpd];

        if (type === 'Scheduled_and_Process_Order') {
            fetchQuery += `
                AND op.status IN (
                    'MRP',
                    'Pending',
                    'Hold Pending',
                    'ForceComplete Pending',
                    'ForceDelete Pending',
                    'Reschedule Pending',
                    'MRP Pending',
                    'Rej MRP'
                )
            `;
        } else if (type === 'Hold') {
            fetchQuery += ` AND op.status = ?`;
            values.push('Hold');

        } else if (type === 'Completed') {
            fetchQuery += ` AND op.status = ?`;
            values.push('Completed');

        } else if (type === 'Force_Completed') {
            fetchQuery += ` AND op.status = ?`;
            values.push('Force Completed');
        }

        if (fromDate && toDate) {
            fetchQuery += ` AND DATE(op.created_at) BETWEEN ? AND ?`;
            values.push(fromDate, toDate);
        }

        fetchQuery += ` GROUP BY op.id ORDER BY op.orderPriority ASC`;

        const [rows] = await connection.execute(fetchQuery, values);

        return handleSuccessResponse(res, 'Order Plannings fetched successfully', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



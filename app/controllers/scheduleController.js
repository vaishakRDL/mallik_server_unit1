const { handleErrorResponse, connection, CustomError, handleSuccessResponse } = require("../config/dbSql");
const { getCurrentTime, getCurrentShift, currentDateTime, currentDateTimeInd } = require("../utility/utilityFunction");
const moment = require('moment');
require('dotenv').config();

const machineObj = {
    KITTING_MACHINE: process.env.KITTING_M_CODE,
}

const filterParts = async (conn, mrpMstId) => {
    const [jcRows] = await conn.execute(`
        SELECT 
            items.materialThickness as thickness,
            GROUP_CONCAT(jc.itemCode ORDER BY jc.itemCode SEPARATOR ',') AS itemCodes
        FROM job_card jc
        INNER JOIN items ON items.id = jc.itemId 
        WHERE jc.mrpMstId = ?
        GROUP BY thickness`,
        [mrpMstId]
    );

    const parts = {};
    // Sort jcRows such that the entry with empty thickness comes first
    jcRows.sort((a, b) => (a.thickness === '' ? -1 : (b.thickness === '' ? 1 : 0)));

    jcRows.forEach(item => {
        const items = item.itemCodes.split(',');
        items.sort((a, b) => {
            const aClean = a.toLowerCase().replace(/[^a-z0-9]/g, "");
            const bClean = b.toLowerCase().replace(/[^a-z0-9]/g, "");
            return aClean > bClean ? 1 : (aClean < bClean ? -1 : 0);
        });
        parts[item.thickness] = items;
    });

    const filteredThickness = Object.keys(parts).sort((a, b) => {
        const aValue = a === '' ? -1 : parseFloat(a);
        const bValue = b === '' ? -1 : parseFloat(b);
        return aValue - bValue;
    });

    return { filteredThickness, parts };
};

const macAndProDetails = async (conn, mrpMstId) => {
    const [processRows] = await conn.execute(`
        SELECT jc.id as jcId, jc.jcNo, jc.itemId, jc.itemCode, m.machineCode as machineName, pm.code as process, jc.Qty, 
            pm.id as processId, m.id as machineId, iVp.cycleTime, (iVp.cycleTime * jc.Qty) as totTime, iVp.count, (iVp.count * jc.Qty) as totCount
        FROM job_card jc 
        INNER JOIN item_vs_pm iVp ON iVp.item = jc.itemId
        INNER JOIN mst_pm pm ON pm.id = iVp.process
        INNER JOIN machines m ON m.id = iVp.machineName
        WHERE jc.mrpMstId = ? AND iVp.dflag = ?`,
        [mrpMstId, 0]
    );

    const productionObj = {};
    processRows.forEach(i => {
        if (!productionObj[i.itemCode]) {
            productionObj[i.itemCode] = { jcId: i.jcId, jcNo: i.jcNo, Qty: i.Qty, processDetails: [] };
        }
        productionObj[i.itemCode].processDetails.push({ itemId: i.itemId, machineName: i.machineName, process: i.process, pTime: i.cycleTime, cTime: i.totTime, count: i.count, totCount: i.totCount, processId: i.processId, machineId: i.machineId });
    });

    return productionObj;
};


const kittingMachinePlanning = async (conn, mrpMstId) => {
    try {
        const [rows] = await conn.execute(`
            SELECT mrp.orderPlnId, mrp.itemId, mrp.itemCode, mrp.Qty, machines.machineCode as machineName, pm.code as process, ip.cycleTime, ip.cycleTime * mrp.Qty as plannedTime
            FROM mrp 
            LEFT JOIN job_card jc ON jc.id = mrp.jcId 
            LEFT JOIN item_vs_pm ip ON ip.item = mrp.itemId 
            INNER JOIN machines ON machines.id = ip.machineName 
            INNER JOIN mst_pm pm ON pm.id = ip.process
            WHERE mrp.mrpMstId = ? AND ip.dflag = ? AND pm.code = ?`,
            [mrpMstId, 0, 'KITTING']
        );

        if (rows.length === 0) return;

        const values = rows.map(({ itemCode, machineName, process, Qty, cycleTime, plannedTime }) =>
            [mrpMstId, itemCode, machineName, process, Qty, cycleTime, plannedTime]
        );

        await conn.query(`
            INSERT INTO sf_schedule (mrpMstId, itemCode, machine, process, Qty, cycleTime, plannedTime) VALUES ?
        `, [values]);

        return true;
    } catch (err) {
        throw err;
    }
}


exports.shopFloorSchedule = async (conn, mrpMstId) => {
    try {
        const { filteredThickness, parts: partsDetails } = await filterParts(conn, mrpMstId)
        const machineAndProcesses = await macAndProDetails(conn, mrpMstId)

        const scheduleList = [];

        filteredThickness.forEach((thickness) => {
            const parts = partsDetails[thickness];

            parts.forEach((item) => {
                if (machineAndProcesses[item]) {
                    const { jcId, jcNo, Qty, processDetails } = machineAndProcesses[item];

                    processDetails.forEach((data) => {
                        const { machineId, processId, machineName, process, pTime, cTime, count, totCount } = data;

                        scheduleList.push({ mrpMstId, jcId, jcNo, item, machineId, processId, machineName, process, Qty, pTime, cTime, thickness, count, totCount })
                    });
                }
            });
        });

        await insertScheduleTask(conn, scheduleList)
        await kittingMachinePlanning(conn, mrpMstId);   // kitting machine planning

        await conn.execute(`
            UPDATE order_plannings op 
            INNER JOIN mrp_mst m ON m.orderPlnId = op.id 
            SET op.isScheduled = ? 
            WHERE m.id = ?`,
            [1, mrpMstId]
        )

        return true;
    } catch (err) {
        throw err;
    }
}


exports.schedulingTasks = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { orderPlnId } = req.body;

        const [rows] = await conn.execute(`
            SELECT mm.id FROM mrp_mst mm
            INNER JOIN order_plannings op ON op.id = mm.orderPlnId
            WHERE op.id = ? AND op.isScheduled = ?`,
            [orderPlnId, 0]
        );

        if (rows.length === 0) {
            throw new CustomError(`No MRP records found for scheduling. Please check MRP data.`);
        }
        await this.shopFloorSchedule(conn, rows[0].id);

        return handleSuccessResponse(res, 'Successful');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err)
    } finally {
        conn.release();
    }
}

const insertScheduleTask = async (conn, scheduleObj) => {
    try {
        if (scheduleObj.length === 0) return;
        const insertQuery = `INSERT INTO sf_schedule (mrpMstId, jcId, jcNo, itemCode, machineId, processId, machine, process, Qty, cycleTime, plannedTime, count, totCount) VALUES ?`;

        const values = scheduleObj.map(obj => {
            const { mrpMstId, jcId, jcNo, item, machineId, processId, machineName, process, Qty, pTime, cTime, count, totCount } = obj;
            return [mrpMstId, jcId, jcNo, item, machineId, processId, machineName, process, Qty, pTime, cTime, count, totCount];
        });

        await conn.query(insertQuery, [values]);

        return true;
    } catch (err) {
        throw err;
    }
}


exports.machineSchedule = async (req, res) => {
    try {
        const { date, machineName } = req.body;

        // if (!date || !machineName) throw new CustomError(`Please select both a Date and a Machine, then try again.`, 400);

        // Stored Procedure
        const [shifts] = await connection.execute(
            `CALL get_shifts_by_machine_and_date(?, ?)`,
            [machineName, date]
        );

        return handleSuccessResponse(res, 'Shifts', shifts[0]);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

// Filter the result
const filterResult = async (part, thickness, data) => {
    if (!part && !thickness) return data;

    const key = part != "" ? 'Part Number' : 'Thickness';
    const val = part != "" ? part.toLowerCase() : thickness.toLowerCase();

    const foundParts = [];
    const unFoundParts = [];

    data.forEach(item => {
        if (item[key].toLowerCase().includes(val)) {
            foundParts.push(item);
        } else {
            unFoundParts.push(item);
        }
    })

    return [...foundParts, ...unFoundParts];
}

const checkShift = (date, shift) => {
    const shiftTimings = {
        1: { start: '06:00:00', end: '14:00:00' },
        4: { start: '08:00:00', end: '17:00:00' }, // General overlaps Shift1 & Shift2
        2: { start: '14:00:00', end: '22:00:00' },
        3: { start: '22:00:00', end: '06:00:00' }
    };

    function getCurrentAndLastShifts(curTime) {
        const timeToNumber = (time) => {
            return time.split(':').reduce((acc, timeUnit) => (60 * acc) + +timeUnit, 0);
        };

        const curTimeNumber = timeToNumber(curTime);

        let currentShift = [];

        for (const [shiftId, timings] of Object.entries(shiftTimings)) {
            const start = timeToNumber(timings.start);
            const end = timeToNumber(timings.end);

            if (end <= start) {
                // crosses midnight
                if (curTimeNumber >= start || curTimeNumber < end) {
                    currentShift.push(parseInt(shiftId));
                }
            } else {
                // normal
                if (curTimeNumber >= start && curTimeNumber < end) {
                    currentShift.push(parseInt(shiftId));
                }
            }
        }

        const previousShifts = {
            1: [],
            4: [1],       // General's "previous shift" = Shift1
            2: [1, 4],    // Shift2 follows Shift1 and General
            3: [1, 4, 2]  // Night follows Shift1, General, and Shift2
        };

        // Collect last shifts for ALL active current shifts
        let lastShift = [];
        for (const s of currentShift) {
            lastShift.push(...previousShifts[s]);
        }
        lastShift = [...new Set(lastShift)]; // remove duplicates

        return { currentShift, lastShift };
    }

    const { currentShift, lastShift } = getCurrentAndLastShifts(getCurrentTime());

    // Normalize dates to midnight for comparison
    const normalizeDate = (dateStr) => {
        const date = new Date(dateStr);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    };

    const curDate = normalizeDate(new Date());
    const inputDate = normalizeDate(date);

    // Compare the dates and shifts separately
    if (inputDate === curDate && currentShift.includes(shift)) {
        return { shiftStatus: 'Current', currentShift, lastShift };
    } else if (inputDate < curDate || (inputDate === curDate && lastShift.includes(shift))) {
        return { shiftStatus: 'Pre', currentShift, lastShift };
    } else {
        return { shiftStatus: 'Post', currentShift, lastShift };
    }
};

const currentSchedules = async (machine, KITTING_MACHINE, date, shift) => {
    const [completedTasks] = await connection.execute(`
        SELECT sfs.id, items.materialThickness as Thickness,  mm.mrpNo as 'MRP ID', sfs.itemCode as 'Part Number', items.itemName as Description, sfs.jcNo as 'JobCard No', DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS 'JobCard Date',
            pf.name as 'Product Type', sfs.cycleTime as CTime, uom.name as UOM, SUM(sfs.plannedTime) as 'Work Planned', sfs.Qty as Qty, jp.producedQty as 'Produced Qty', sfs.prod_qty as Produced_Qty, sfs.prod_shift
        FROM sf_schedule sfs
        INNER JOIN items ON items.itemCode = sfs.itemCode
        LEFT JOIN job_card jc ON jc.id = sfs.jcId
        LEFT JOIN mst_uom AS uom ON uom.id = items.uom
        LEFT JOIN item_product_family pf ON pf.id = items.productFamily
        LEFT JOIN mrp_mst mm ON mm.id = sfs.mrpMstId
        LEFT JOIN order_plannings op ON op.id = mm.orderPlnId
        LEFT JOIN jobcard_planning jp ON jp.jcId = sfs.jcId AND jp.machinename = sfs.machine
        WHERE sfs.machine = ? AND sfs.prod_date = ? AND sfs.prod_shift = ?
        GROUP BY sfs.mrpMstId, sfs.itemCode, sfs.jcId
        ORDER BY sfs.id ASC`,
        [machine, date, shift]
    )

    const [tasks] = await connection.execute(`
        SELECT sfs.id, items.materialThickness as Thickness,  mm.mrpNo as 'MRP ID', sfs.itemCode as 'Part Number', items.itemName as Description, sfs.jcNo as 'JobCard No', DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS 'JobCard Date',
            pf.name as 'Product Type', sfs.cycleTime as CTime, uom.name as UOM, SUM(sfs.plannedTime) as 'Work Planned', sfs.Qty as Qty, jp.producedQty as 'Produced Qty', sfs.prod_qty as Produced_Qty, sfs.prod_shift
        FROM sf_schedule sfs
        INNER JOIN items ON items.itemCode = sfs.itemCode
        LEFT JOIN job_card jc ON jc.id = sfs.jcId
        LEFT JOIN mst_uom AS uom ON uom.id = items.uom
        LEFT JOIN item_product_family pf ON pf.id = items.productFamily
        LEFT JOIN mrp_mst mm ON mm.id = sfs.mrpMstId
        LEFT JOIN order_plannings op ON op.id = mm.orderPlnId
        LEFT JOIN jobcard_planning jp ON jp.jcId = sfs.jcId AND jp.machinename = sfs.machine AND jp.process = sfs.process
        WHERE sfs.machine = ? AND sfs.status = ?
        GROUP BY sfs.mrpMstId, sfs.itemCode, sfs.jcId
        ORDER BY sfs.id ASC`,
        [machine, 0]
    )

    return await curAndPostSchedules(machine, KITTING_MACHINE, completedTasks, tasks, 0);
}

exports.scheduledPlan = async (req) => {
    try {
        const { machine, date, shift: shiftStr, part, thickness } = req.body;

        const KITTING_MACHINE = machineObj['KITTING_MACHINE'];
        const MAX_TIME = 440;
        const shiftObj = { Shift1: 1, Shift2: 2, Shift3: 3, General: 4 };
        const shift = shiftObj[shiftStr];

        if (!shift) throw new CustomError(`Please select a valid shift and try again.`);

        const { shiftStatus, currentShift } = checkShift(date, shift);

        let rows;
        if (shiftStatus === 'Current') {
            rows = await currentSchedules(machine, KITTING_MACHINE, date, shift, MAX_TIME);

        } else if (shiftStatus === 'Pre') {
            [rows] = await connection.execute(`
                SELECT sfs.id, items.materialThickness as Thickness, mm.mrpNo as 'MRP ID', sfs.itemCode as 'Part Number', items.itemName as Description, sfs.jcNo as 'JobCard No', DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS 'JobCard Date',
                    pf.name as 'Product Type', sfs.cycleTime as CTime, uom.name as UOM, sfs.plannedTime as 'Work Planned', sfs.Qty as Qty, jp.producedQty as 'Produced Qty', sfs.prod_qty as Produced_Qty
                FROM sf_schedule sfs
                INNER JOIN items ON items.itemCode = sfs.itemCode
                LEFT JOIN job_card jc ON jc.id = sfs.jcId
                LEFT JOIN mst_uom AS uom ON uom.id = items.uom
                LEFT JOIN item_product_family pf ON pf.id = items.productFamily
                LEFT JOIN jobcard_planning jp ON jp.jcId = sfs.jcId AND jp.machinename = sfs.machine
                LEFT JOIN mrp_mst mm ON mm.id = sfs.mrpMstId
                LEFT JOIN order_plannings op ON op.id = mm.orderPlnId
                WHERE sfs.machine = ? AND sfs.status = ? AND sfs.prod_date = ? AND sfs.prod_shift = ?
                ORDER BY sfs.id`,
                [machine, 1, date, shift]
            )

            if (machine === KITTING_MACHINE) {
                rows = rows.map(({ "Produced Qty": prodQty, "JobCard No": jcNo, ...rest }) => rest);
            } else {
                rows = rows.map(({ id, Produced_Qty, ...rest }) => rest);
            }

        } else if (shiftStatus === 'Post') {
            const shifts = await fetchShifts(machine, date, shift);

            const currentShifts = [...new Set([...currentShift, shift])];
            const shiftPlaceHolder = currentShifts.map(() => '?').join(', ');

            const [completedTasks] = await connection.execute(`
                SELECT sfs.id, items.materialThickness as Thickness,  mm.mrpNo as 'MRP ID', sfs.itemCode as 'Part Number', items.itemName as Description, sfs.jcNo as 'JobCard No', DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS 'JobCard Date',
                    pf.name as 'Product Type', sfs.cycleTime as CTime, uom.name as UOM, SUM(sfs.plannedTime) as 'Work Planned', sfs.Qty as Qty, jp.producedQty as 'Produced Qty', sfs.prod_qty as Produced_Qty, sfs.prod_shift
                FROM sf_schedule sfs
                INNER JOIN items ON items.itemCode = sfs.itemCode
                LEFT JOIN job_card jc ON jc.id = sfs.jcId
                LEFT JOIN mst_uom AS uom ON uom.id = items.uom
                LEFT JOIN item_product_family pf ON pf.id = items.productFamily
                LEFT JOIN mrp_mst mm ON mm.id = sfs.mrpMstId
                LEFT JOIN order_plannings op ON op.id = mm.orderPlnId
                LEFT JOIN jobcard_planning jp ON jp.jcId = sfs.jcId AND jp.machinename = sfs.machine
                WHERE sfs.machine = ? AND sfs.prod_date = ? AND prod_shift IN (${shiftPlaceHolder}) AND sfs.status = ?
                GROUP BY sfs.mrpMstId, sfs.itemCode, sfs.jcId, sfs.process
                ORDER BY sfs.id ASC`,
                [machine, date, ...currentShifts, 1]
            )

            const curShiftCompletedTasks = completedTasks.filter(task => task.prod_shift === shift);
            const prevShiftTime = completedTasks.reduce((acc, task) => {
                if (task.prod_shift && task.prod_shift !== shift) {
                    return acc + parseFloat(task['Work Planned'] || 0);
                }
                return acc;
            }, 0);

            const [tasks] = await connection.execute(`
                SELECT sfs.id, items.materialThickness as Thickness,  mm.mrpNo as 'MRP ID', sfs.itemCode as 'Part Number', items.itemName as Description, sfs.jcNo as 'JobCard No', DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS 'JobCard Date',
                    pf.name as 'Product Type', sfs.cycleTime as CTime, uom.name as UOM, SUM(sfs.plannedTime) as 'Work Planned', sfs.Qty as Qty, jp.producedQty as 'Produced Qty', sfs.prod_qty as Produced_Qty, sfs.prod_shift
                FROM sf_schedule sfs
                INNER JOIN items ON items.itemCode = sfs.itemCode
                LEFT JOIN job_card jc ON jc.id = sfs.jcId
                LEFT JOIN mst_uom AS uom ON uom.id = items.uom
                LEFT JOIN item_product_family pf ON pf.id = items.productFamily
                LEFT JOIN mrp_mst mm ON mm.id = sfs.mrpMstId
                LEFT JOIN order_plannings op ON op.id = mm.orderPlnId
                LEFT JOIN jobcard_planning jp ON jp.jcId = sfs.jcId AND jp.machinename = sfs.machine AND jp.process = sfs.process
                WHERE sfs.machine = ? AND sfs.status = ?
                GROUP BY sfs.mrpMstId, sfs.itemCode, sfs.jcId
                ORDER BY sfs.id ASC`,
                [machine, 0]
            )

            const uniqueShifts = shifts.map(s => s.shiftNumber);
            const skipPlannedTime = Math.max(0, (uniqueShifts.length - 1) * MAX_TIME - prevShiftTime);

            rows = await curAndPostSchedules(machine, KITTING_MACHINE, curShiftCompletedTasks, tasks, skipPlannedTime, shift)
        }

        const result = await filterResult(part, thickness, rows);

        return result;
    } catch (err) {
        throw err;
    }
}

const curAndPostSchedules = async (machine, KITTING_MACHINE, completedTasks, tasks, skipTime, shift) => {
    let MAX_TIME = 440;
    let accumulatedTime = 0;
    const resultTasks = [];
    const taskIds = new Set(completedTasks.map(task => task.id)); // Track completed tasks by ID

    // Adjust skipTime by completed task times
    const completedTime = completedTasks.reduce((acc, item) => acc + parseFloat(item['Work Planned']), 0);
    MAX_TIME = Math.max(MAX_TIME - completedTime, 0);

    // Add completed tasks to the result first
    for (const completed of completedTasks) {
        resultTasks.push(completed);
    }

    for (const task of tasks) {
        let taskTime = parseFloat(task['Work Planned']);
        let prodShift = task['prod_shift'];

        // Skip portions of task time if skipTime is still positive
        if (skipTime > 0) {
            if (taskTime <= skipTime) {
                skipTime -= taskTime;
                continue; // Skip the entire task if within skipTime
            } else {
                // Skip a portion of this task, then adjust taskTime
                taskTime -= skipTime;
                skipTime = 0;
            }
        }

        // Check if the task has already been completed
        if (taskIds.has(task.id)) {
            continue;
        }

        // if (prodShift === null && prodShift !== shift) {
        // Check if remaining taskTime fits within MAX_TIME
        if (accumulatedTime + taskTime <= MAX_TIME) {
            accumulatedTime += taskTime;
            resultTasks.push({ ...task, 'Work Planned': taskTime.toFixed(2) });
            taskIds.add(task.id); // Mark task as added
        } else {
            // Split the task to fit remaining MAX_TIME
            const allowedTime = MAX_TIME - accumulatedTime;
            if (allowedTime > 0) {
                resultTasks.push({ ...task, 'Work Planned': allowedTime.toFixed(2) });
            }
            break; // Stop once MAX_TIME is reached
        }
        // }
    }

    // Return resultTasks sorted by id and without the 'id' field
    // return resultTasks
    //     .sort((a, b) => a.id - b.id)
    //     .map(({ id, prod_qty, ...rest }) => rest);

    const result = resultTasks.sort((a, b) => a.id - b.id);

    if (machine === KITTING_MACHINE) {
        return result.map(({ "Produced Qty": prodQty, "JobCard No": jcNo, prod_shift, ...rest }) => ({ ...rest }));
    } else {
        return result.map(({ id, Produced_Qty, prod_shift, ...rest }) => rest);
    }
};

exports.fetchSchedules = async (req, res) => {
    try {
        const schedules = await this.scheduledPlan(req);

        return handleSuccessResponse(res, 'Scheduled tasks', schedules)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.reallocateShifts = async (req, res) => {
    try {
        const shift = getCurrentShift()[0];
        const date = (await currentDateTime()).split(' ')[0];

        if (!shift || !date) throw new CustomError(`Date or Shift not found!`)

        const clause = shift === 4  // need to recheck for shift 3
            ? `(prod_date = ? AND prod_shift IN (2, 3))`
            : `(prod_date = ? AND prod_shift > ?)`;

        // Fetch rows that match the conditions
        const [rows] = await connection.execute(`
            SELECT id FROM sf_schedule 
            WHERE (${clause}) OR (prod_date > ?)
            AND status = ?`,
            shift === 4 ? [date, date, 1] : [date, shift, date, 1]
        );

        const rowIds = rows.map(row => row.id);

        if (rowIds.length > 0) {
            const placeholders = rowIds.map(() => '?').join(',');

            // Update `prod_shift` and `prod_date` for the selected row IDs
            await connection.execute(`
                UPDATE sf_schedule 
                SET prod_shift = ?, prod_date = ?
                WHERE id IN (${placeholders})
            `, [shift, date, ...rowIds]);
        }

        return handleSuccessResponse(res, "Shifts reallocated successfully");
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.reassignShifts = async (req, res) => {
    try {
        const { machine } = req.body;

        const shifts = getCurrentShift();
        const curDate = (await currentDateTime()).split(" ")[0];

        const placeholders = shifts.map(() => '?').join(', ');

        const [shiftRows] = await connection.execute(`
            SELECT s.shiftNumber 
            FROM shift_production_planning s
            WHERE scheduleDate = ? 
              AND s.machineName = ? 
              AND shiftNumber IN (${placeholders})
        `, [curDate, machine, ...shifts]);

        if (!shiftRows.length) {
            throw new CustomError(`No shifts found for the machine on the current date.`);
        }

        const currentShift = shiftRows[0].shiftNumber;

        let clause;
        let params = [];

        if (currentShift === 4) {
            clause = `(prod_date = ? AND prod_shift IN (2,3))`;
            params = [curDate];
        } else {
            clause = `(prod_date = ? AND prod_shift > ?)`;
            params = [curDate, currentShift];
        }

        const [rows] = await connection.execute(`
            SELECT id 
            FROM sf_schedule
            WHERE (
                    ${clause}
                  ) 
              OR (
                    prod_date > ?
                 )
              AND status = ?
        `, [...params, curDate, 1]);

        const rowIds = rows.map(r => r.id);

        if (rowIds.length > 0) {
            const idPlaceholders = rowIds.map(() => '?').join(',');

            await connection.execute(`
                UPDATE sf_schedule
                SET prod_shift = ?, prod_date = ?
                WHERE id IN (${idPlaceholders})
            `, [currentShift, curDate, ...rowIds]);
        }

        return handleSuccessResponse(res, "Shifts reallocated successfully");
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

const fetchShifts = async (machine, date, toShift) => {
    try {
        const shifts = [1, 4, 2, 3]; // Fixed shift order

        const curDay = moment().tz('Asia/Kolkata').startOf('day');
        const toDay = moment(date).tz('Asia/Kolkata').startOf('day');

        const curShifts = getCurrentShift(); // Could be [1,4] or [3,4], etc.

        let shiftArray = [];
        let currentDate = curDay.clone();

        while (currentDate.isSameOrBefore(toDay)) {
            const dayString = currentDate.format('YYYY-MM-DD');

            if (currentDate.isSame(curDay) && currentDate.isSame(toDay)) {
                // Both start and end are today
                const slices = [];

                for (const curShift of curShifts) {
                    const startIndex = shifts.indexOf(curShift);
                    const endIndex = shifts.indexOf(toShift);

                    if (startIndex !== -1 && endIndex !== -1) {
                        const slice =
                            startIndex <= endIndex
                                ? shifts.slice(startIndex, endIndex + 1) // inclusive
                                : shifts.slice(startIndex).concat(shifts.slice(0, endIndex + 1));

                        slices.push(...slice);
                    }
                }

                // Remove duplicates (e.g., [1,4,2,4,3] -> [1,4,2,3])
                const uniqueShifts = [...new Set(slices)];
                shiftArray.push({ [dayString]: uniqueShifts });
            }
            else if (currentDate.isSame(curDay)) {
                // First day — multiple starting shifts possible
                const slices = [];
                for (const curShift of curShifts) {
                    const startIndex = shifts.indexOf(curShift);
                    if (startIndex !== -1) {
                        slices.push(...shifts.slice(startIndex));
                    }
                }

                const uniqueShifts = [...new Set(slices)];
                shiftArray.push({ [dayString]: uniqueShifts });
            }
            else if (currentDate.isSame(toDay)) {
                // Last day
                const endIndex = shifts.indexOf(toShift);
                const slice = endIndex !== -1 ? shifts.slice(0, endIndex + 1) : shifts;
                shiftArray.push({ [dayString]: slice });
            }
            else {
                // Intermediate full days
                shiftArray.push({ [dayString]: shifts });
            }

            currentDate.add(1, 'days');
        }

        return await getShifts(machine, shiftArray);
    } catch (err) {
        throw err;
    }
};

const getShifts = async (machine, shiftArray) => {
    const conditions = shiftArray.map(obj => {
        const [scheduleDate, shiftNumbers] = Object.entries(obj)[0];

        if (shiftNumbers.length === 0) return null;

        const placeholders = shiftNumbers.map(() => '?').join(',');
        return `(s.scheduleDate = ? AND s.shiftNumber IN (${placeholders}))`;
    }).filter(Boolean).join(' OR ');

    const queryParams = shiftArray.flatMap(obj => {
        const [scheduleDate, shiftNumbers] = Object.entries(obj)[0];
        return shiftNumbers.length === 0 ? [] : [scheduleDate, ...shiftNumbers];
    });

    const [rows] = await connection.execute(`
        SELECT s.scheduleDate, s.shiftNumber 
        FROM shift_production_planning s
        WHERE (${conditions})
        AND s.machineName = ?
    `, [...queryParams, machine]);

    return rows;
};

exports.nestingPlan = async (req, res) => {
    try {
        const { machine, kanbanDate, thickness, sheetQty } = req.body;

        let filterClause = '', filterParams = [];
        if (thickness) {
            filterClause += ' AND Thickness = ?';
            filterParams.push(thickness);
        }
        if (sheetQty) {
            filterClause += ' AND Sheet_qty = ?';
            filterParams.push(sheetQty);
        }

        const [nestRows] = await connection.execute(`
            SELECT 
                id, Nesting_no, Kanbandate, Material_Name, GRN_No, Jobcard_no, Part_no, Sheet_qty, Program_code, Machine_name, Thickness, Produced_SheetQty, Pdf_link
            FROM nesting_table
            WHERE Machine_name = ? AND kanbanDate = ? ${filterClause}`,
            [machine, kanbanDate, ...filterParams]
        );

        return handleSuccessResponse(res, 'Nesting Plan', nestRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.materialLists = async (req, res) => {
    try {
        const [matRows] = await connection.execute(
            `SELECT DISTINCT Material_Name FROM nesting_table`
        );

        return handleSuccessResponse(res, 'Material List', matRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.storeSheetDetails = async (req, res) => {
    try {
        const { machine, materialType, thickness, length, Qty, grn } = req.body;

        const currentDate = currentDateTimeInd();

        await connection.execute(`
            INSERT INTO cutsheet_details (Date_time, Machine, Material_type, Thickness, Length_Width, Qty, GRN_number) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [currentDate, machine, materialType, thickness, length, Qty, grn]
        );

        return handleSuccessResponse(res, 'Successful');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.assemblyOperatorLog = async (req, res) => {
    try {
        const { operatorName, fromDate, toDate } = req.query;

        const [rows] = await connection.execute(`
            SELECT id, Operator_Name, Date_time, Kanbandate, Part_Number, FIMNo, ContractNo, Shift, Produced_Quantity 
            FROM assembly_operator_log 
            WHERE Operator_Name = ? AND DATE(Date_time) BETWEEN ? AND ? 
            `, [operatorName, fromDate, toDate]
        );

        return handleSuccessResponse(res, 'Assembly Operator Log', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const cleanString = (str = "") => str.replace(/[^a-zA-Z0-9]/g, "");

exports.machinePlanning = async (req, res) => {
    try {
        let { kanbanDate, machine, q = "", page = 1, limit = 50 } = req.query;

        if (!kanbanDate || !machine) {
            throw new CustomError("kanbanDate and machine are required");
        }

        // Validate date format YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(kanbanDate)) {
            throw new CustomError("kanbanDate must be in YYYY-MM-DD format");
        }

        page = Math.max(1, parseInt(page) || 1);
        limit = Math.min(1000, Math.max(1, parseInt(limit) || 50));
        const offset = (page - 1) * limit;

        // Clean search string
        const search = cleanString(q);
        const likeQuery = `%${search}%`;

        let countSql = `
            SELECT COUNT(DISTINCT sfs.mrpMstId, sfs.itemCode, sfs.jcId) AS total
            FROM sf_schedule sfs
            INNER JOIN mrp_mst mm ON mm.id = sfs.mrpMstId
            INNER JOIN order_plannings op ON op.id = mm.orderPlnId
            WHERE op.kanbanDate = ? 
              AND sfs.machine = ?
        `;

        const countParams = [kanbanDate, machine];

        // Apply search when q is provided
        if (search) {
            countSql += ` AND REPLACE(sfs.itemCode, '-', '') LIKE ?`;
            countParams.push(likeQuery);
        }

        const [countRows] = await connection.execute(countSql, countParams);
        const total = countRows[0].total;
        const totalPages = Math.ceil(total / limit);

        let sql = `
            SELECT
                sfs.id, items.materialThickness AS Thickness, mm.mrpNo AS MrpNo, sfs.itemCode AS PartNo, items.itemName AS Description,
                sfs.jcNo AS JobcardNo, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS KanbanDate, pf.name AS ProductType, sfs.cycleTime AS CTime,
                uom.name AS UOM, sfs.plannedTime AS WorkPlanned, sfs.Qty AS Qty, COALESCE(jp.producedQty, 0) AS ProdQty, sfs.prod_shift AS ProdShift
            FROM sf_schedule sfs
            INNER JOIN mrp_mst mm ON mm.id = sfs.mrpMstId
            INNER JOIN order_plannings op ON op.id = mm.orderPlnId
            LEFT JOIN jobcard_planning jp ON jp.jcId = sfs.jcId AND jp.machinename = sfs.machine
            INNER JOIN items ON items.itemCode = sfs.itemCode
            LEFT JOIN mst_uom uom ON uom.id = items.uom
            LEFT JOIN item_product_family pf ON pf.id = items.productFamily
            WHERE op.kanbanDate = ? AND sfs.machine = ?
        `;

        const mainParams = [kanbanDate, machine];

        // Search filter
        if (search) {
            sql += ` AND REPLACE(sfs.itemCode, '-', '') LIKE ?`;
            mainParams.push(likeQuery);
        }

        sql += `
            ORDER BY sfs.id ASC
            LIMIT ? OFFSET ?
        `;

        mainParams.push(limit, offset);

        const [tasks] = await connection.execute(sql, mainParams);

        return res.status(200).json({
            success: true,
            message: "Machine Planning",
            search: q,
            page,
            total,
            totalPages,
            data: tasks
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// Aggregate child part counts into parent sf_schedule entries by process
exports.aggregateChildCounts = async (conn, mrpMstId) => {
    try {
        await conn.execute(`
            UPDATE sf_schedule s
            INNER JOIN (
                SELECT jcId, processId, SUM(\`count\`) AS childCountSum, SUM(totCount) AS childTotCountSum
                FROM childpart_planning
                WHERE mrpMstId = ?
                GROUP BY jcId, processId
            ) cp ON cp.jcId = s.jcId AND cp.processId = s.processId
            SET s.\`count\` = s.\`count\` + cp.childCountSum, s.totCount = s.totCount + cp.childTotCountSum
            WHERE s.mrpMstId = ?`,
            [mrpMstId, mrpMstId]
        );

        return true;
    } catch (err) {
        throw err;
    }
};

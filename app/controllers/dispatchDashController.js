const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require('../config/dbSql');
const { generateDocNo, formatFinancialYears, updateDocCounter } = require('../utility/docNo');
const { generateSrnNo, insertSrnItems } = require("./srnController");
const { fetchItemId } = require("../utility/utilityFunction");
const { sendEmail } = require("../config/emailService")
const excel = require("exceljs");


exports.showdropdown = async (req, res) => {
    try {
        const queryObj = req.query;
        const searchValue = Object.values(queryObj)[0];

        let query = `SELECT DISTINCT DelNoteNo FROM shipment_details`;
        let params = [];

        // If ANY query param is passed
        if (searchValue) {
            query += ` WHERE DelNoteNo LIKE ?`;
            params.push(`%${searchValue}%`);
        }

        const [rows] = await connection.execute(query, params);

        return res.status(200).json({
            success: true,
            count: rows.length,
            data: rows.map(r => ({
                DelNoteNo: r.DelNoteNo     // 👈 key name added
            }))
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
};

exports.updateShipmentTime = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const { shipmentDate, startTime, id, screen = 'Web' } = req.body;

        if (!shipmentDate || !startTime || !Array.isArray(id) || id.length === 0) {
            throw new CustomError("Invalid input data", 400);
        }

        const validIds = id.filter(i => Number.isInteger(i) && i > 0);
        if (validIds.length === 0) {
            throw new CustomError("No valid id provided", 400);
        }

        // ✅ Define curDate here
        const curDate = new Date().toISOString().split("T")[0];

        const shipmentdateFormatted = `${curDate} ${startTime}`;
        const placeholders = validIds.map(() => '?').join(', ');

        await conn.execute(
            `UPDATE shipment_details 
             SET Start_Time = ? 
             WHERE id IN (${placeholders})`,
            [shipmentdateFormatted, ...validIds]
        );

        await conn.commit();

        return handleSuccessResponse(res, 'Shipment Start_Time updated successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

//old
function delayCalculation(startTime, endTime) {
    const parseDateTime = (dateTimeStr) => {
        const [date, time, meridian] = dateTimeStr.split(/[\s]+/);
        let [hour, minute] = time.split(':').map(Number);
        if (meridian?.toUpperCase() === "PM" && hour !== 12) hour += 12;
        if (meridian?.toUpperCase() === "AM" && hour === 12) hour = 0;
        return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
    };

    let start = parseDateTime(startTime);
    const end = parseDateTime(endTime);
    if (isNaN(start) || isNaN(end)) throw new Error("Invalid date/time format");

    // Add 20 minutes buffer to start time
    start = new Date(start.getTime() + 20 * 60 * 1000);

    const delayMs = end - start;
    if (delayMs <= 0) {
        return "0 min";
    }

    const delayMinutes = Math.floor(delayMs / (1000 * 60));
    const hours = Math.floor(delayMinutes / 60);
    const minutes = delayMinutes % 60;

    let delayStr = '';
    if (hours) delayStr += `${hours} hr `;
    if (minutes) delayStr += `${minutes} min`;

    return delayStr.trim();
}

// ✅ OTD check
function checkOTD(timeslot, endtime) {
    // console.log("➡️ Raw timeslot received:", timeslot);
    // console.log("➡️ Raw endtime received:", endtime);
    const [startStr, endStr] = timeslot.toLowerCase().split(" to ");
    const end = new Date(endtime);
    if (isNaN(end)) throw new Error("Invalid endtime format");

    const datePart = endtime.split(" ")[0];

    const parseTime = (date, timeStr) => {
        const match = timeStr.trim().match(/(\d+(:\d+)?)(\s*)(am|pm)/i);
        if (!match) throw new Error(`Invalid timeslot format: ${timeStr}`);

        let [, time, , , meridian] = match;
        let [hour, minute] = time.split(":").map(Number);
        minute = minute || 0;

        if (meridian.toLowerCase() === "pm" && hour !== 12) hour += 12;
        if (meridian.toLowerCase() === "am" && hour === 12) hour = 0;

        return new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
    };

    const slotStart = parseTime(datePart, startStr);
    const slotEnd = parseTime(datePart, endStr);

    return (end >= slotStart && end <= slotEnd) ? "YES" : "NO";
}

// ✅ Wrapper
function calculateDelayAndOTD(timeslot, startTime, endTime) {
    const delay = delayCalculation(startTime, endTime);
    const otd = checkOTD(timeslot, endTime);
    return { delay, otd };
}

exports.fetchDispatch = async (req, res) => {
    try {
        const { shipmentdate } = req.body;

        const [result] = await connection.execute(
            `SELECT viewFlag FROM shipment_mst WHERE shipmentdate = ?`,
            [shipmentdate]
        );

        let viewStatus = 1;
        if (result.length > 0 && result[0].viewFlag === 0) {
            viewStatus = 0;
        }

        return res.status(200).json({
            success: true,
            viewStatus
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


function delayCalculations(startTime, endTime) {
    const parseDateTime = (dateTimeStr) => {
        const [date, time, meridian] = dateTimeStr.split(/[\s]+/);
        let [hour, minute] = time.split(':').map(Number);
        if (meridian?.toUpperCase() === "PM" && hour !== 12) hour += 12;
        if (meridian?.toUpperCase() === "AM" && hour === 12) hour = 0;
        return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
    };

    let start = parseDateTime(startTime);
    const end = parseDateTime(endTime);
    if (isNaN(start) || isNaN(end)) return null;

    // Add 20 minutes buffer to start time
    start = new Date(start.getTime() + 20 * 60 * 1000);

    const delayMs = end - start;
    if (delayMs <= 0) return "0 min";

    const delayMinutes = Math.floor(delayMs / (1000 * 60));
    const hours = Math.floor(delayMinutes / 60);
    const minutes = delayMinutes % 60;

    let delayStr = '';
    if (hours) delayStr += `${hours} hr `;
    if (minutes) delayStr += `${minutes} min`;

    return delayStr.trim();
}



// ✅ Function to calculate OTD based on shipmentdate and End_Time
const calculateOTD = (shipmentDate, endTime) => {
    if (!endTime) return null;

    try {
        const shipment = new Date(shipmentDate);
        shipment.setHours(0, 0, 0, 0);

        const endDate = new Date(endTime);
        endDate.setHours(0, 0, 0, 0);

        return endDate <= shipment ? "YES" : "NO";
    } catch (error) {
        console.error("Error parsing date for OTD calculation:", error);
        return null;
    }
};

//to test new code for batch update to stop transactions errors 
exports.getDispatchPlan = async (req, res) => {
    try {
        const { shipmentdate } = req.body;

        if (!shipmentdate) {
            throw new CustomError("Shipmentdate is required", 400);
        }

        // Get the shipment master row
        const [mstRows] = await connection.execute(
            `SELECT id FROM shipment_mst WHERE shipmentdate = ?`,
            [shipmentdate]
        );
        // `SELECT ROW_NUMBER() OVER (ORDER BY id) AS SNo, shipment_details.* 
        //                  FROM shipment_details  ///below query
        //                  WHERE mstId = ?`,
        let shipmentDetails = [];
        if (mstRows.length) {
            const [detailsRows] = await connection.execute(
                `SELECT ROW_NUMBER() OVER (ORDER BY FIELD(TimeSlot,'8 am to 10 am','10 am to 2 pm','2 pm to 5 pm'), id) AS SNo,
                 shipment_details.*
                 FROM shipment_details
                 WHERE mstId = ?
                 ORDER BY FIELD(TimeSlot,'8 am to 10 am','10 am to 2 pm','2 pm to 5 pm'), id;`,
                [mstRows[0].id]
            );

            if (detailsRows.length) {
                const staticKeys = [
                    "SNo", "id", "mstId", "DelNoteNo", "ContractNo", "KanbanDate", "TimeSlot", "Duty",
                    "QtyStops", "PoNo", "VehicleNo", "Start_Time", "End_Time",
                    "Delay", "OTD", "Remarks", "colorCode"
                ];
                const nonFimKeys = new Set([
                    "id", "SNo", "mstId", "DelNoteNo", "ContractNo", "KanbanDate", "TimeSlot", "Duty",
                    "QtyStops", "PoNo", "VehicleNo", "Start_Time", "End_Time",
                    "Delay", "OTD", "Remarks", "colorCode", 'created_at', 'updated_at'
                ]);

                // Get dynamic FIM columns
                const allDynamicCols = Object.keys(detailsRows[0]).filter(
                    key => !nonFimKeys.has(key)
                );
                const colsWithValues = allDynamicCols.filter(col =>
                    detailsRows.some(row => row[col] !== null && row[col] !== "" && row[col] !== undefined)
                );

                // Collect updates here
                const updates = [];

                shipmentDetails = await Promise.all(
                    detailsRows.map(async row => {
                        const staticData = {};
                        staticKeys.forEach(key => {
                            staticData[key] = row[key];
                        });

                        // Delay calculation
                        let delayMinutes = 0;
                        let calculatedDelay = null;
                        if (row.Start_Time && row.End_Time) {
                            calculatedDelay = delayCalculation(row.Start_Time, row.End_Time);
                            staticData.Delay = calculatedDelay;

                            delayMinutes = calculatedDelay.split(" ").reduce((acc, val, idx, arr) => {
                                if (val === "hr") acc += parseInt(arr[idx - 1], 10) * 60;
                                if (val === "min") acc += parseInt(arr[idx - 1], 10);
                                return acc;
                            }, 0);
                        }

                        // OTD calculation
                        const calculatedOTD = calculateOTD(shipmentdate, row.End_Time);
                        staticData.OTD = calculatedOTD;

                        // 👉 Store update instead of running here
                        updates.push([calculatedDelay, calculatedOTD, row.id]);

                        // Filter only non-null FIMs
                        const nonNullFims = colsWithValues.filter(col =>
                            row[col] !== null && row[col] !== "" && row[col] !== undefined
                        );

                        const allNonNullFimsArePRD = nonNullFims.length
                            ? nonNullFims.every(col => String(row[col]).toUpperCase().trim() === "P/R/D")
                            : false;


                        // if (!calculatedDelay) {
                        //     // Delay null
                        //     staticData.colorCode = null;
                        // } else if (delayMinutes === 0) {
                        //     staticData.colorCode = "#56ED79"; // Green
                        // } else if (delayMinutes > 0 && delayMinutes <= 5) {
                        //     staticData.colorCode = "#E3EE6A"; // Yellow
                        // } else if (delayMinutes > 5) {
                        //     staticData.colorCode = "#F5B133"; // Orange
                        // } else {
                        //     staticData.colorCode = null;
                        // }
                        if (!row.Start_Time || !row.End_Time) {
                            staticData.colorCode = null;

                        } else if (delayMinutes === 0) {
                            staticData.colorCode = "#56ED79"; // Green

                        } else if (delayMinutes > 0 && delayMinutes <= 5) {
                            staticData.colorCode = "#E3EE6A"; // Yellow

                        } else if (delayMinutes > 5) {
                            staticData.colorCode = "#F5B133"; // Orange

                        } else {
                            staticData.colorCode = null;
                        }
                        // // Dynamic FIM data
                        const dynamicData = {};
                        colsWithValues.forEach(col => {
                            dynamicData[col] = row[col];
                        });

                        return { ...staticData, ...dynamicData };
                    })
                );

                // ✅ After loop: run one bulk UPDATE
                if (updates.length) {
                    let delayCase = "CASE id";
                    let otdCase = "CASE id";
                    const ids = [];

                    updates.forEach(([delay, otd, id]) => {
                        delayCase += ` WHEN ${id} THEN ${connection.escape(delay)}`;
                        otdCase += ` WHEN ${id} THEN ${connection.escape(otd)}`;
                        ids.push(id);
                    });

                    delayCase += " END";
                    otdCase += " END";

                    const sql = `
            UPDATE shipment_details
            SET Delay = ${delayCase},
                OTD = ${otdCase}
            WHERE id IN (${ids.join(",")})
        `;

                    await connection.execute(sql);
                }
                await connection.execute(
                    `UPDATE shipment_mst SET viewFlag = 0 WHERE shipmentdate = ?`,
                    [shipmentdate]
                );
            }
        }
        return res.status(200).json({
            success: true,
            message: "Dispatch Plan list",
            date: shipmentdate,
            data: shipmentDetails
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};




function getPrefix(fimNo) {
    return fimNo?.match(/([a-zA-Z]+)/)?.[0] || "";
}

function timeSlotToValue(slot) {
    // Assumes slot is like "8 am to 10 am"
    if (!slot) return Infinity;

    const timeMap = { am: 0, pm: 12 };

    const match = slot.toLowerCase().match(/^(\d+)\s*(am|pm)/);
    if (!match) return Infinity;

    const hour = parseInt(match[1], 10);
    const period = match[2];

    return hour % 12 + timeMap[period];
}

function calculateDelay(timeSlot, endTime) {
    if (!timeSlot || !endTime) return null;
    const slotHour = timeSlotToValue(timeSlot.split("-")[0].trim());
    const actualHour = new Date(endTime).getHours();
    return actualHour > slotHour ? actualHour - slotHour : 0;
}

///////////////////update remarks in dispatch plan table ////////////////////////////
exports.updateDispatch = async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks } = req.body;

        if (!remarks || remarks.trim() === '') {
            return res.status(400).json({ success: false, message: 'Remarks are required' });
        }

        await connection.execute(
            `UPDATE sob SET remarks = ? WHERE id = ?`,
            [remarks, id]
        );

        await connection.execute(
            `UPDATE shipment_details SET Remarks = ? WHERE sobId = ?`,
            [remarks, sobId]
        );

        return res.status(200).json({
            success: true,
            message: 'Remark updated successfully',
            data: {
                id,
                remarks
            }
        });
    } catch (error) {
        return handleErrorResponse(res, error);
    }
};

//contract footer code deployed old
// exports.dailydashboardcontractno = async (req, res) => {
//     try {
//         const clientDate = req.body.date ? new Date(req.body.date) : new Date();
//         const year = clientDate.getFullYear();
//         const month = clientDate.getMonth() + 1;

//         const monthStr = month.toString().padStart(2, '0');
//         const firstDayOfMonth = `${year}-${monthStr}-01`;
//         const lastDayOfMonth = new Date(year, month, 0).toISOString().slice(0, 10);
//         const daysInMonth = new Date(year, month, 0).getDate();
//         const monthName = clientDate.toLocaleString('default', { month: 'long' });

//         const debug = req.body.debug === true;

//         const fimFields = [
//             'FIM5.0', 'FIM8.0', 'FIM3.1', 'FIM3.2', 'FIM9.11', 'FIM2.31',
//             'FIM11.11', 'FIM9.12', 'FIM4.4', 'FIM11.12', 'FIM11.0', 'FIM2.3',
//             'FIM4.1', 'FIM8.1', 'FIM9.0', 'FIM9.13', 'FIM9.1'
//         ];

//         // 1️⃣ Planned, Dispatched, Delay Query
//         const query = `
//                 SELECT 
//                     sm.shipmentDate,
//                     sd.mstId,
//                     COUNT(sd.id) AS planned,
//                     SUM(
//                         CASE 
//                             WHEN ${fimFields.map(f => `(\`${f}\` = 'P/R/D' OR \`${f}\` IS NULL)`).join(' AND ')}
//                             THEN 1 ELSE 0
//                         END
//                     ) AS dispatched,
//                     SUM(CASE WHEN sd.OTD = 'NO' THEN 1 ELSE 0 END) AS delay
//                 FROM shipment_details sd
//                 INNER JOIN shipment_mst sm ON sm.id = sd.mstId
//                 WHERE sm.shipmentDate BETWEEN ? AND ?
//                 GROUP BY sm.shipmentDate, sd.mstId
//                 ORDER BY sm.shipmentDate
//                 `;
//         if (debug) console.log("Executing Query:\n", query);
//         const [rows] = await connection.execute(query, [firstDayOfMonth, lastDayOfMonth]);
//         if (debug) console.log("Fetched Rows:", JSON.stringify(rows, null, 2));

//         // 2️⃣ Vehicle Count Query (each delMstId counted once if any endTime exists)
//         const vehicleQuery = `
//                 SELECT 
//                     DATE(dnm.deliveryDate) AS date,
//                     COUNT(DISTINCT dnm.id) AS vehicleCount
//                 FROM del_note_mst dnm
//                 JOIN (
//                     SELECT DISTINCT delMstId
//                     FROM gstsalesinvoitem
//                     WHERE endTime IS NOT NULL
//                 ) gi ON gi.delMstId = dnm.id
//                 WHERE dnm.deliveryDate BETWEEN ? AND ?
//                 GROUP BY DATE(dnm.deliveryDate)
//                 ORDER BY DATE(dnm.deliveryDate);
//                 `;
//         const [vehicleRows] = await connection.execute(vehicleQuery, [firstDayOfMonth, lastDayOfMonth]);

//         // 3️⃣ Prepare daily counts
//         const dailyCounts = Array(daysInMonth).fill().map(() => ({
//             planned: 0,
//             dispatched: 0,
//             delay: 0,
//             vehicleCount: 0
//         }));
//         let totals = { planned: 0, dispatched: 0, delay: 0, vehicleCount: 0 };

//         // Planned, Dispatched, Delay
//         rows.forEach(row => {
//             const dayIndex = new Date(row.shipmentDate).getDate() - 1;
//             if (dayIndex < 0 || dayIndex >= daysInMonth) return;

//             dailyCounts[dayIndex].planned += Number(row.planned);
//             dailyCounts[dayIndex].dispatched += Number(row.dispatched);
//             dailyCounts[dayIndex].delay += Number(row.delay);

//             totals.planned += Number(row.planned);
//             totals.dispatched += Number(row.dispatched);
//             totals.delay += Number(row.delay);
//         });

//         // Vehicle Count
//         vehicleRows.forEach(row => {
//             const dayIndex = new Date(row.date).getDate() - 1;
//             if (dayIndex < 0 || dayIndex >= daysInMonth) return;

//             dailyCounts[dayIndex].vehicleCount = Number(row.vehicleCount);
//             totals.vehicleCount += Number(row.vehicleCount);
//         });

//         // 4️⃣ Build response
//         const data = dailyCounts.map((day, index) => {
//             const dayNum = index + 1;
//             const plannedNum = Number(day.planned);
//             const dispatchedNum = Number(day.dispatched);
//             const delayNum = Number(day.delay);
//             const vehicleNum = Number(day.vehicleCount);

//             return {
//                 SNo: dayNum,
//                 date: `${year}-${monthStr}-${dayNum.toString().padStart(2, '0')}`,
//                 planned: plannedNum,
//                 dispatched: dispatchedNum,
//                 delay: delayNum,
//                 vehicleCount: vehicleNum,
//                 performance: plannedNum > 0 ? `${((delayNum / plannedNum) * 100).toFixed(2)}%` : '0.00%',
//                 contractPerformance: plannedNum > 0 ? `${((dispatchedNum / plannedNum) * 100).toFixed(2)}%` : '0.00%'
//             };
//         });

//         data.push({
//             SNo: 'Total',
//             date: `${monthName} ${year}`,
//             planned: totals.planned,
//             dispatched: totals.dispatched,
//             delay: totals.delay,
//             vehicleCount: totals.vehicleCount,
//             performance: totals.planned > 0 ? `${((totals.delay / totals.planned) * 100).toFixed(2)}%` : '0.00%',
//             contractPerformance: totals.planned > 0 ? `${((totals.dispatched / totals.planned) * 100).toFixed(2)}%` : '0.00%',
//             otd: '100%'
//         });

//         res.status(200).json({
//             success: true,
//             message: `Daily ContractNo Count and Performance for ${monthName} ${year}`,
//             date: clientDate.toISOString().slice(0, 10),
//             data,
//         });

//     } catch (err) {
//         console.error('Dashboard error:', err);
//         res.status(500).json({
//             success: false,
//             message: err.message || 'An error occurred while fetching dashboard data.',
//         });
//     }
// };

//working code 
// exports.dailydashboardcontractno = async (req, res) => {
//     try {
//         const clientDate = req.body.date ? new Date(req.body.date) : new Date();
//         const year = clientDate.getFullYear();
//         const month = clientDate.getMonth() + 1;

//         const monthStr = month.toString().padStart(2, '0');
//         const firstDayOfMonth = `${year}-${monthStr}-01`;
//         // const lastDayOfMonth = new Date(year, month, 0).toISOString().slice(0, 10);
//         const lastDay = new Date(year, month, 0).getDate();
//         const lastDayOfMonth = `${year}-${monthStr}-${lastDay.toString().padStart(2, '0')}`;
//         const daysInMonth = new Date(year, month, 0).getDate();
//         const monthName = clientDate.toLocaleString('default', { month: 'long' });

//         const debug = req.body.debug === true;

//         const fimFields = [
//             'FIM5.0', 'FIM8.0', 'FIM3.1', 'FIM3.2', 'FIM9.11', 'FIM2.31',
//             'FIM11.11', 'FIM9.12', 'FIM4.4', 'FIM11.12', 'FIM11.0', 'FIM2.3',
//             'FIM4.1', 'FIM8.1', 'FIM9.0', 'FIM9.13', 'FIM9.1','FIM9.4'
//         ];

//         // 1️⃣ Planned, Dispatched, Delay Query
//         const query = `
//                 SELECT 
//                     sm.shipmentDate,
//                     sd.mstId,
//                     COUNT(sd.id) AS planned,
//                     SUM(
//                         CASE 
//                             WHEN (
//                              ${fimFields.map(f => `(\`${f}\` = 'P/R/D' OR \`${f}\` IS NULL)`).join(' AND ')}
//                             )   
//                              AND (
//                              ${fimFields.map(f => `\`${f}\` IS NOT NULL`).join(' OR ')}
//                             )
//                             THEN 1 ELSE 0
//                         END
//                     ) AS dispatched,
//                     SUM(CASE WHEN sd.OTD = 'NO' THEN 1 ELSE 0 END) AS delay
//                 FROM shipment_details sd
//                 INNER JOIN shipment_mst sm ON sm.id = sd.mstId
//                 WHERE sm.shipmentDate >= ?
//                 AND sm.shipmentDate < DATE_ADD(?, INTERVAL 1 DAY)
//                 GROUP BY sm.shipmentDate, sd.mstId
//                 ORDER BY sm.shipmentDate
//                 `;
//         if (debug) console.log("Executing Query:\n", query);
//         const [rows] = await connection.execute(query, [firstDayOfMonth, lastDayOfMonth]);
//         if (debug) console.log("Fetched Rows:", JSON.stringify(rows, null, 2));

//         // 2️⃣ Vehicle Count Query (each delMstId counted once if any endTime exists)
//         const vehicleQuery = `
//                 SELECT 
//                     DATE(dnm.deliveryDate) AS date,
//                     COUNT(DISTINCT dnm.id) AS vehicleCount
//                 FROM del_note_mst dnm
//                 JOIN (
//                     SELECT DISTINCT delMstId
//                     FROM gstsalesinvoitem
//                     WHERE endTime IS NOT NULL
//                 ) gi ON gi.delMstId = dnm.id
//                 WHERE dnm.deliveryDate BETWEEN ? AND ?
//                 GROUP BY DATE(dnm.deliveryDate)
//                 ORDER BY DATE(dnm.deliveryDate);
//                 `;
//         const [vehicleRows] = await connection.execute(vehicleQuery, [firstDayOfMonth, lastDayOfMonth]);

//         // 3️⃣ Prepare daily counts
//         const dailyCounts = Array(daysInMonth).fill().map(() => ({
//             planned: 0,
//             dispatched: 0,
//             delay: 0,
//             vehicleCount: 0
//         }));
//         let totals = { planned: 0, dispatched: 0, delay: 0, vehicleCount: 0 };

//         // Planned, Dispatched, Delay
//         rows.forEach(row => {
//             const dayIndex = new Date(row.shipmentDate).getDate() - 1;
          
//             if (dayIndex < 0 || dayIndex >= daysInMonth) return;

//             dailyCounts[dayIndex].planned += Number(row.planned);
//             dailyCounts[dayIndex].dispatched += Number(row.dispatched);
//             dailyCounts[dayIndex].delay += Number(row.delay);

//             totals.planned += Number(row.planned);
//             totals.dispatched += Number(row.dispatched);
//             totals.delay += Number(row.delay);
//         });

//         // Vehicle Count
//         vehicleRows.forEach(row => {
//             const dayIndex = new Date(row.date).getDate() - 1;
//             if (dayIndex < 0 || dayIndex >= daysInMonth) return;

//             dailyCounts[dayIndex].vehicleCount = Number(row.vehicleCount);
//             totals.vehicleCount += Number(row.vehicleCount);
//         });

//         // 4️⃣ Build response
//         const data = dailyCounts.map((day, index) => {
//             const dayNum = index + 1;
//             const plannedNum = Number(day.planned);
//             const dispatchedNum = Number(day.dispatched);
//             const delayNum = Number(day.delay);
//             const vehicleNum = Number(day.vehicleCount);

//             return {
//                 SNo: dayNum,
//                 date: `${year}-${monthStr}-${dayNum.toString().padStart(2, '0')}`,
//                 planned: plannedNum,
//                 dispatched: dispatchedNum,
//                 delay: delayNum,
//                 vehicleCount: vehicleNum,
//                 performance: dispatchedNum > 0 ? `${(((plannedNum - delayNum) / plannedNum) * 100).toFixed(2)}%` : '0.00%',
//                 contractPerformance: plannedNum > 0 ? `${((dispatchedNum / plannedNum) * 100).toFixed(2)}%` : '0.00%'
//             };
//         });

//         data.push({
//             SNo: 'Total',
//             date: `${monthName} ${year}`,
//             planned: totals.planned,
//             dispatched: totals.dispatched,
//             delay: totals.delay,
//             vehicleCount: totals.vehicleCount,
//             performance: totals.planned > 0 ? `${(((totals.planned - totals.delay) / totals.planned) * 100).toFixed(2)}%` : '0.00%',
//             contractPerformance: totals.planned > 0 ? `${((totals.dispatched / totals.planned) * 100).toFixed(2)}%` : '0.00%',
//             otd: '100%'
//         });

//         res.status(200).json({
//             success: true,
//             message: `Daily ContractNo Count and Performance for ${monthName} ${year}`,
//             date: clientDate.toISOString().slice(0, 10),
//             data,
//         });

//     } catch (err) {
//         console.error('Dashboard error:', err);
//         res.status(500).json({
//             success: false,
//             message: err.message || 'An error occurred while fetching dashboard data.',
//         });
//     }
// };
exports.dailydashboardcontractno = async (req, res) => {
    try {
        const clientDate = req.body.date ? new Date(req.body.date) : new Date();
        const year = clientDate.getFullYear();
        const month = clientDate.getMonth() + 1;

        const monthStr = month.toString().padStart(2, '0');
        const firstDayOfMonth = `${year}-${monthStr}-01`;
        // const lastDayOfMonth = new Date(year, month, 0).toISOString().slice(0, 10);
        const lastDay = new Date(year, month, 0).getDate();
        const lastDayOfMonth = `${year}-${monthStr}-${lastDay.toString().padStart(2, '0')}`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const monthName = clientDate.toLocaleString('default', { month: 'long' });

        const debug = req.body.debug === true;

        const fimFields = [
            'FIM5.0', 'FIM8.0', 'FIM3.1', 'FIM3.2', 'FIM9.11', 'FIM2.31',
            'FIM11.11', 'FIM9.12', 'FIM4.4', 'FIM11.12', 'FIM11.0', 'FIM2.3',
            'FIM4.1', 'FIM8.1', 'FIM9.0', 'FIM9.13', 'FIM9.1','FIM9.4'
        ];
        const notNullCondition = fimFields
  .map(f => `\`${f}\` IS NOT NULL`)
  .join(' OR ');
        // 1️⃣ Planned, Dispatched, Delay Query
       const query = `
SELECT 
    sm.shipmentDate,
    sd.mstId,
    COUNT(sd.id) AS planned,
    SUM(
        CASE 
            WHEN (
                ${fimFields.map(f => `(\`${f}\` = 'P/R/D' OR \`${f}\` IS NULL)`).join(' AND ')}
            )   
            AND (
                ${fimFields.map(f => `\`${f}\` IS NOT NULL`).join(' OR ')}
            )
            THEN 1 ELSE 0
        END
    ) AS dispatched,
    SUM(CASE WHEN sd.OTD = 'NO' THEN 1 ELSE 0 END) AS delay
FROM shipment_details sd
INNER JOIN shipment_mst sm ON sm.id = sd.mstId
WHERE sm.shipmentDate >= ?
AND sm.shipmentDate < DATE_ADD(?, INTERVAL 1 DAY)
AND (${notNullCondition})   
GROUP BY sm.shipmentDate, sd.mstId
ORDER BY sm.shipmentDate
`;
        if (debug) console.log("Executing Query:\n", query);
        const [rows] = await connection.execute(query, [firstDayOfMonth, lastDayOfMonth]);
        if (debug) console.log("Fetched Rows:", JSON.stringify(rows, null, 2));

        // 2️⃣ Vehicle Count Query (each delMstId counted once if any endTime exists)
        const vehicleQuery = `
                SELECT 
                    DATE(dnm.deliveryDate) AS date,
                    COUNT(DISTINCT dnm.id) AS vehicleCount
                FROM del_note_mst dnm
                JOIN (
                    SELECT DISTINCT delMstId
                    FROM gstsalesinvoitem
                    WHERE endTime IS NOT NULL
                ) gi ON gi.delMstId = dnm.id
                WHERE dnm.deliveryDate BETWEEN ? AND ?
                GROUP BY DATE(dnm.deliveryDate)
                ORDER BY DATE(dnm.deliveryDate);
                `;
        const [vehicleRows] = await connection.execute(vehicleQuery, [firstDayOfMonth, lastDayOfMonth]);

        // 3️⃣ Prepare daily counts
        const dailyCounts = Array(daysInMonth).fill().map(() => ({
            planned: 0,
            dispatched: 0,
            delay: 0,
            vehicleCount: 0
        }));
        let totals = { planned: 0, dispatched: 0, delay: 0, vehicleCount: 0 };

        // Planned, Dispatched, Delay
        rows.forEach(row => {
            const dayIndex = new Date(row.shipmentDate).getDate() - 1;
          
            if (dayIndex < 0 || dayIndex >= daysInMonth) return;

            dailyCounts[dayIndex].planned += Number(row.planned);
            dailyCounts[dayIndex].dispatched += Number(row.dispatched);
            dailyCounts[dayIndex].delay += Number(row.delay);

            totals.planned += Number(row.planned);
            totals.dispatched += Number(row.dispatched);
            totals.delay += Number(row.delay);
        });

        // Vehicle Count
        vehicleRows.forEach(row => {
            const dayIndex = new Date(row.date).getDate() - 1;
            if (dayIndex < 0 || dayIndex >= daysInMonth) return;

            dailyCounts[dayIndex].vehicleCount = Number(row.vehicleCount);
            totals.vehicleCount += Number(row.vehicleCount);
        });

        // 4️⃣ Build response
        const data = dailyCounts.map((day, index) => {
            const dayNum = index + 1;
            const plannedNum = Number(day.planned);
            const dispatchedNum = Number(day.dispatched);
            const delayNum = Number(day.delay);
            const vehicleNum = Number(day.vehicleCount);

            return {
                SNo: dayNum,
                date: `${year}-${monthStr}-${dayNum.toString().padStart(2, '0')}`,
                planned: plannedNum,
                dispatched: dispatchedNum,
                delay: delayNum,
                vehicleCount: vehicleNum,
                performance: dispatchedNum > 0 ? `${(((plannedNum - delayNum) / plannedNum) * 100).toFixed(2)}%` : '0.00%',
                contractPerformance: plannedNum > 0 ? `${((dispatchedNum / plannedNum) * 100).toFixed(2)}%` : '0.00%'
            };
        });

        data.push({
            SNo: 'Total',
            date: `${monthName} ${year}`,
            planned: totals.planned,
            dispatched: totals.dispatched,
            delay: totals.delay,
            vehicleCount: totals.vehicleCount,
            performance: totals.planned > 0 ? `${(((totals.planned - totals.delay) / totals.planned) * 100).toFixed(2)}%` : '0.00%',
            contractPerformance: totals.planned > 0 ? `${((totals.dispatched / totals.planned) * 100).toFixed(2)}%` : '0.00%',
            otd: '100%'
        });

        res.status(200).json({
            success: true,
            message: `Daily ContractNo Count and Performance for ${monthName} ${year}`,
            date: clientDate.toISOString().slice(0, 10),
            data,
        });

    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'An error occurred while fetching dashboard data.',
        });
    }
};






//////////////////////////partnumber api deployed
// exports.getDispatchWithVehicle = async (req, res) => {
//     try {
//         const { partNoIds = [], shipmentDate } = req.body;

//         // Get today's date in YYYY-MM-DD format
//         const now = new Date();
//         const todayStr = now.toISOString().split('T')[0];

//         // Format current time in 12-hour format (e.g., 10:23 AM)
//         const timeStr = now.toLocaleTimeString('en-US', {
//             hour: 'numeric',
//             minute: '2-digit',
//             hour12: true
//         });

//         const currentTime = `${todayStr} ${timeStr}`;
//         const filterDate = (shipmentDate && shipmentDate.trim() !== '') ? shipmentDate : todayStr;

//         // ✅ Update startTime for given partNoIds
//         if (Array.isArray(partNoIds) && partNoIds.length > 0) {
//             const placeholders = partNoIds.map(() => '?').join(',');
//             const updateQuery = `UPDATE purchas_order_item SET startTime = ? WHERE id IN (${placeholders})`;
//             await connection.execute(updateQuery, [currentTime, ...partNoIds]);
//         }

//         // 🔍 Fetch updated data for the filter date
//         const query = `
//                 SELECT 
//                 poi.id,
//                 dp.contractNo AS PartNo,
//                 poi.Qty,
//                 po.poNo AS PoNo,
//                 poi.startTime,
//                 gsi.vechileNO,
//                 gsii.endTime,
//                 dn.id AS DelDtlId,
//                 dn.delMstId,
//                 dn.contractNo AS DelContractNo,
//                 poi.partRemarks AS Remarks
//             FROM dispatch_plan dp
//             JOIN purchas_order_item poi ON poi.PartNo = dp.contractNo
//             JOIN purchase_order po ON po.id = poi.purchase_order_id
//             LEFT JOIN gstsalesinvoitem gsii 
//                 ON gsii.poId = po.id 
//                 AND gsii.poItemId = poi.id   
//             LEFT JOIN gstsalesinvo gsi ON gsi.id = gsii.gstsalesinvo_id
//             LEFT JOIN del_note dn ON dn.id = gsii.delDtlId  
//             WHERE dp.contractOrPart = 0
//             AND DATE(dp.sheduledDate) = ?
//             GROUP BY poi.id

//         `;

//         const [rows] = await connection.execute(query, [filterDate]);

//         // 🧠 Delay and OTD calculation
//         const updatedRows = rows.map((row, index) => {
//             let delay = null;
//             let otd = null;
//             let delayMinutes = null;

//             if (row.startTime && row.endTime) {
//                 const parseDateTime = (datetimeStr) => {
//                     if (!datetimeStr.includes(' ')) return null;
//                     const [datePart, timePart, ampm] = datetimeStr.split(' ');
//                     const [year, month, day] = datePart.split('-').map(Number);
//                     let [hour, minute] = timePart.split(':').map(Number);

//                     if (ampm === 'PM' && hour !== 12) hour += 12;
//                     if (ampm === 'AM' && hour === 12) hour = 0;

//                     return new Date(year, month - 1, day, hour, minute);
//                 };

//                 const start = parseDateTime(row.startTime);
//                 const end = parseDateTime(row.endTime);

//                 if (start && end) {
//                     // ⏱️ Add 20 minutes buffer to startTime
//                     const adjustedStart = new Date(start.getTime() + 20 * 60 * 1000);

//                     const diffMs = end - adjustedStart;
//                     delayMinutes = Math.floor(diffMs / (1000 * 60));
//                     delay = delayMinutes > 0 ? `${delayMinutes} min` : '0 min';

//                     // ✅ New OTD logic: based only on date
//                     const startDateStr = start.toISOString().split('T')[0];
//                     const endDateStr = end.toISOString().split('T')[0];
//                     otd = startDateStr === endDateStr ? 'YES' : 'NO';
//                 }
//             }
//             // 🎨 ColorCode logic
//             let colorCode = null;
//             if (otd === 'YES') {
//                 if (delayMinutes !== null && delayMinutes > 0 && delayMinutes <= 25) {
//                     colorCode = '#E3EE6A'; // light yellow if delay <= 25 min
//                 } else {
//                     colorCode = '#56ED79'; // green if no delay or delay = 0
//                 }
//             } else if (otd === 'NO') {
//                 colorCode = '#F5B133'; // orange if not OTD
//             }
//             return {
//                 SNo: index + 1,
//                 id: row.id,
//                 PartNo: row.PartNo,
//                 Qty: row.Qty,
//                 PoNo: row.PoNo,
//                 StartTime: row.startTime,
//                 VehicleNo: row.vechileNO,
//                 EndTime: row.endTime,
//                 Remarks: row.Remarks,
//                 Delay: delay,
//                 OTD: otd,
//                 colorCode: otd === 'YES' ? '#56ED79' : (otd === 'NO' ? '#F5B133' : null)
//             };
//         });

//         // ✅ Return updated rows
//         return res.status(200).json({ success: true, data: updatedRows });

//     } catch (err) {
//         console.error("❌ Error in getDispatchWithVehicle:", err);
//         return res.status(500).json({ success: false, message: "Server error" });
//     }
// };




//update api for partremarks table 
exports.updatePartRemarks = async (req, res) => {
    try {
        const { id, remarks } = req.body;

        if (!id || !remarks) {
            return res.status(400).json({
                success: false,
                message: "Both id and remarks are required"
            });
        }

        // Update the remark
        const updateQuery = `
            UPDATE purchas_order_item
            SET partRemarks = ?
            WHERE id = ?
        `;
        await connection.execute(updateQuery, [remarks, id]);

        // Fetch the updated record
        const selectQuery = `
            SELECT id, PartNo, Qty, partRemarks
            FROM purchas_order_item
            WHERE id = ?
        `;
        const [rows] = await connection.execute(selectQuery, [id]);

        return res.status(200).json({
            success: true,
            message: "Remark updated successfully",
            updated: rows[0] || {}
        });

    } catch (err) {
        console.error("❌ Error in updatePartRemarks:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

//deployed code footer api partno
// exports.footerPartNo = async (req, res) => {
//     try {
//         const inputDate = new Date(req.body.date);

//         if (isNaN(inputDate)) {
//             return res.status(400).json({ success: false, message: 'Invalid date' });
//         }

//         const year = inputDate.getFullYear();
//         const month = String(inputDate.getMonth() + 1).padStart(2, '0');

//         const startDate = `${year}-${month}-01`;
//         const endDate = `${year}-${month}-31`;

//         // 🟢 Planned count
//         const [plannedRows] = await connection.execute(
//             `SELECT 
//                 DATE_FORMAT(dp.sheduledDate, '%Y-%m-%d') AS date,
//                 COUNT(DISTINCT poi.id) AS planned
//              FROM dispatch_plan dp
//              JOIN purchas_order_item poi 
//                ON TRIM(LOWER(dp.contractNo)) = TRIM(LOWER(poi.PartNo))
//              WHERE dp.contractOrPart = 0
//                AND dp.sheduledDate BETWEEN ? AND ?
//              GROUP BY DATE(dp.sheduledDate)
//              ORDER BY DATE(dp.sheduledDate)`,
//             [startDate, endDate]
//         );

//         // 🟡 Dispatched count
//         const [dispatchedRows] = await connection.execute(
//             `SELECT 
//                 DATE_FORMAT(dnm.deliveryDate, '%Y-%m-%d') AS date,
//                 COUNT(gi.id) AS dispatched
//              FROM del_note_mst dnm
//              JOIN gstsalesinvoitem gi 
//                ON gi.delMstId = dnm.id
//              WHERE dnm.deliveryDate BETWEEN ? AND ?
//                AND gi.endTime IS NOT NULL
//              GROUP BY DATE(dnm.deliveryDate)
//              ORDER BY DATE(dnm.deliveryDate)`,
//             [startDate, endDate]
//         );

//         // 🔵 Vehicle Count
//         const [vehicleRows] = await connection.execute(
//             `SELECT 
//                 DATE_FORMAT(t.deliveryDate, '%Y-%m-%d') AS date,
//                 SUM(t.vehiclePerDelNote) AS vehicleCount
//              FROM (
//                  SELECT 
//                      dnm.id AS delMstId,
//                      dnm.deliveryDate,
//                      COUNT(DISTINCT si.vechileNO) AS vehiclePerDelNote
//                  FROM del_note_mst dnm
//                  JOIN gstsalesinvoitem gi 
//                    ON gi.delMstId = dnm.id
//                  JOIN gstsalesinvo si 
//                    ON si.id = gi.gstsalesinvo_id
//                  WHERE gi.endTime IS NOT NULL
//                    AND dnm.deliveryDate BETWEEN ? AND ?
//                  GROUP BY dnm.id, dnm.deliveryDate
//              ) t
//              GROUP BY DATE(t.deliveryDate)
//              ORDER BY DATE(t.deliveryDate)`,
//             [startDate, endDate]
//         );

//         // 🔴 Delay count (OTD NO)
//         const [delayRows] = await connection.execute(
//             `SELECT 
//     DATE_FORMAT(t.deliveryDate, '%Y-%m-%d') AS date,
//     SUM(CAST(t.vehiclePerDelNote AS UNSIGNED)) AS vehicleCount
// FROM (
//     SELECT 
//         dnm.id AS delMstId,
//         dnm.deliveryDate,
//         COUNT(DISTINCT si.vechileNO) AS vehiclePerDelNote
//     FROM del_note_mst dnm
//     JOIN gstsalesinvoitem gi 
//       ON gi.delMstId = dnm.id
//     JOIN gstsalesinvo si 
//       ON si.id = gi.gstsalesinvo_id
//     WHERE gi.endTime IS NOT NULL
//       AND dnm.deliveryDate BETWEEN ? AND ?
//     GROUP BY dnm.id, dnm.deliveryDate
// ) t
// GROUP BY DATE(t.deliveryDate)
// ORDER BY DATE(t.deliveryDate)`,
//             [startDate, endDate]
//         );

//         // STEP 3: Merge results
//         const dataMap = {};

//         plannedRows.forEach(row => {
//             dataMap[row.date] = { planned: row.planned, dispatched: 0, vehicleCount: 0, delayCount: 0 };
//         });

//         dispatchedRows.forEach(row => {
//             if (!dataMap[row.date]) dataMap[row.date] = { planned: 0, dispatched: row.dispatched, vehicleCount: 0, delayCount: 0 };
//             else dataMap[row.date].dispatched = row.dispatched;
//         });

//         vehicleRows.forEach(row => {
//             if (!dataMap[row.date]) dataMap[row.date] = { planned: 0, dispatched: 0, vehicleCount: row.vehicleCount, delayCount: 0 };
//             else dataMap[row.date].vehicleCount = row.vehicleCount;
//         });

//         delayRows.forEach(row => {
//             if (!dataMap[row.date]) dataMap[row.date] = { planned: 0, dispatched: 0, vehicleCount: 0, delayCount: row.delayCount };
//             else dataMap[row.date].delayCount = row.delayCount;
//         });

//         // STEP 4: Build monthly response
//         const daysInMonth = new Date(year, parseInt(month), 0).getDate();
//         const responseData = [];

//         let totalPlanned = 0;
//         let totalDispatched = 0;
//         let totalVehicleCount = 0;
//         let totalDelayCount = 0;

//         for (let day = 1; day <= daysInMonth; day++) {
//             const dateStr = `${year}-${month}-${String(day).padStart(2, '0')}`;
//             const planned = dataMap[dateStr]?.planned || 0;
//             const dispatched = dataMap[dateStr]?.dispatched || 0;
//             const vehicleCount = Number(dataMap[dateStr]?.vehicleCount) || 0;
//             const delayCount = dataMap[dateStr]?.delayCount || 0;

//             totalPlanned += planned;
//             totalDispatched += dispatched;
//             totalVehicleCount += vehicleCount;
//             totalDelayCount += delayCount;

//             responseData.push({
//                 SNo: day,
//                 date: dateStr,
//                 planned,
//                 dispatched,
//                 vehicleCount,
//                 delayCount,
//                 partPerformance: planned > 0 ? ((dispatched / planned) * 100).toFixed(2) : "0.00"
//             });
//         }

//         // STEP 5: Return response with totals
//         res.json({
//             success: true,
//             message: `Daily Planned, Dispatched, Vehicle Count and Delay Count for ${inputDate.toLocaleString('default', { month: 'long' })} ${year}`,
//             date: req.body.date,
//             overall: {
//                 planned: totalPlanned,
//                 dispatched: totalDispatched,
//                 vehicleCount: totalVehicleCount,
//                 delayCount: totalDelayCount
//             },
//             data: responseData
//         });

//     } catch (error) {
//         console.error("❌ Error in footerPartNo:", error);
//         res.status(500).json({ success: false, message: 'Server error' });
//     }
// };



// exports.screenCheck = async (req, res) => {
//     try {
//         const { type } = req.query;

//         if (type === '0') {
//             const [rows] = await connection.execute(
//                 `SELECT id FROM dashboard_lock WHERE screen = ? AND isLocked = ?`, ['Dispatch', 0]
//             );
//             if (rows.length === 0) {
//                 throw new CustomError('Dashboard is already used by another person', 400);
//             }
//             await connection.execute(
//                 `UPDATE dashboard_lock SET isLocked = ? WHERE screen = ?`, [1, 'Dispatch']
//             );
//         } else {
//             await connection.execute(
//                 `UPDATE dashboard_lock SET isLocked = ? WHERE screen = ?`, [0, 'Dispatch']
//             );
//         }

//         return res.status(200).json({
//             success: true,
//             message: 'Screen is locked for Dispatch'
//         });
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// }
exports.screenCheck = async (req, res) => {
    try {
        const { type } = req.query;
        const username = (req.headers.username || "").trim().toLowerCase();

        // Load allowed users from .env
        const allowedUsers = process.env.ALLOWED_USERS
            .split(',')
            .map(u => u.trim().toLowerCase());

        // Validate access
        if (!allowedUsers.includes(username)) {
            throw new CustomError("You are not allowed to access this screen lock", 403);
        }

        // Type = 0  ➜ Lock
        if (type === "0") {
            await connection.execute(
                `UPDATE dashboard_lock SET isLocked = 1 WHERE screen = ?`,
                ['Dispatch']
            );
        }
        // Any other type ➜ Unlock
        else {
            await connection.execute(
                `UPDATE dashboard_lock SET isLocked = 0 WHERE screen = ?`,
                ['Dispatch']
            );
        }

        return res.status(200).json({
            success: true,
            message: "Screen lock updated for Dispatch"
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};






// exports.dashcontractnodotnet = async (req, res) => {
//     try {
//         const clientDate = req.body.date ? new Date(req.body.date) : new Date();
//         const year = clientDate.getFullYear();
//         const month = clientDate.getMonth() + 1;

//         const monthStr = month.toString().padStart(2, '0');
//         const firstDayOfMonth = `${year}-${monthStr}-01`;
//         // const lastDayOfMonth = new Date(year, month, 0).toISOString().slice(0, 10);
//         const lastDay = new Date(year, month, 0).getDate();
//         const lastDayOfMonth = `${year}-${monthStr}-${lastDay.toString().padStart(2, '0')}`;
//         const daysInMonth = new Date(year, month, 0).getDate();
//         const monthName = clientDate.toLocaleString('default', { month: 'long' });

//         const debug = req.body.debug === true;

//         const fimFields = [
//             'FIM5.0', 'FIM8.0', 'FIM3.1', 'FIM3.2', 'FIM9.11', 'FIM2.31',
//             'FIM11.11', 'FIM9.12', 'FIM4.4', 'FIM11.12', 'FIM11.0', 'FIM2.3',
//             'FIM4.1', 'FIM8.1', 'FIM9.0', 'FIM9.13', 'FIM9.1','FIM9.4'
//         ];
//         const notNullCondition = fimFields
//   .map(f => `\`${f}\` IS NOT NULL`)
//   .join(' OR ');
//         // 1️⃣ Planned, Dispatched, Delay Query
//        const query = `
// SELECT 
//     sm.shipmentDate,
//     sd.mstId,
//     COUNT(sd.id) AS planned,
//     SUM(
//         CASE 
//             WHEN (
//                 ${fimFields.map(f => `(\`${f}\` = 'P/R/D' OR \`${f}\` IS NULL)`).join(' AND ')}
//             )   
//             AND (
//                 ${fimFields.map(f => `\`${f}\` IS NOT NULL`).join(' OR ')}
//             )
//             THEN 1 ELSE 0
//         END
//     ) AS dispatched,
//     SUM(CASE WHEN sd.OTD = 'NO' THEN 1 ELSE 0 END) AS delay
// FROM shipment_details sd
// INNER JOIN shipment_mst sm ON sm.id = sd.mstId
// WHERE sm.shipmentDate >= ?
// AND sm.shipmentDate < DATE_ADD(?, INTERVAL 1 DAY)
// AND (${notNullCondition})   
// GROUP BY sm.shipmentDate, sd.mstId
// ORDER BY sm.shipmentDate
// `;
//         if (debug) console.log("Executing Query:\n", query);
//         const [rows] = await connection.execute(query, [firstDayOfMonth, lastDayOfMonth]);
//         if (debug) console.log("Fetched Rows:", JSON.stringify(rows, null, 2));

//         // 2️⃣ Vehicle Count Query (each delMstId counted once if any endTime exists)
//         const vehicleQuery = `
//                 SELECT 
//                     DATE(dnm.deliveryDate) AS date,
//                     COUNT(DISTINCT dnm.id) AS vehicleCount
//                 FROM del_note_mst dnm
//                 JOIN (
//                     SELECT DISTINCT delMstId
//                     FROM gstsalesinvoitem
//                     WHERE endTime IS NOT NULL
//                 ) gi ON gi.delMstId = dnm.id
//                 WHERE dnm.deliveryDate BETWEEN ? AND ?
//                 GROUP BY DATE(dnm.deliveryDate)
//                 ORDER BY DATE(dnm.deliveryDate);
//                 `;
//         const [vehicleRows] = await connection.execute(vehicleQuery, [firstDayOfMonth, lastDayOfMonth]);

//         // 3️⃣ Prepare daily counts
//         const dailyCounts = Array(daysInMonth).fill().map(() => ({
//             planned: 0,
//             dispatched: 0,
//             delay: 0,
//             vehicleCount: 0
//         }));
//         let totals = { planned: 0, dispatched: 0, delay: 0, vehicleCount: 0 };

//         // Planned, Dispatched, Delay
//         rows.forEach(row => {
//             const dayIndex = new Date(row.shipmentDate).getDate() - 1;
          
//             if (dayIndex < 0 || dayIndex >= daysInMonth) return;

//             dailyCounts[dayIndex].planned += Number(row.planned);
//             dailyCounts[dayIndex].dispatched += Number(row.dispatched);
//             dailyCounts[dayIndex].delay += Number(row.delay);

//             totals.planned += Number(row.planned);
//             totals.dispatched += Number(row.dispatched);
//             totals.delay += Number(row.delay);
//         });

//         // Vehicle Count
//         vehicleRows.forEach(row => {
//             const dayIndex = new Date(row.date).getDate() - 1;
//             if (dayIndex < 0 || dayIndex >= daysInMonth) return;

//             dailyCounts[dayIndex].vehicleCount = Number(row.vehicleCount);
//             totals.vehicleCount += Number(row.vehicleCount);
//         });

//         // 4️⃣ Build response
//         const data = dailyCounts.map((day, index) => {
//             const dayNum = index + 1;
//             const plannedNum = Number(day.planned);
//             const dispatchedNum = Number(day.dispatched);
//             const delayNum = Number(day.delay);
//             const vehicleNum = Number(day.vehicleCount);

//             return {
//                 SNo: dayNum,
//                 date: `${year}-${monthStr}-${dayNum.toString().padStart(2, '0')}`,
//                 planned: plannedNum,
//                 dispatched: dispatchedNum,
//                 delay: delayNum,
//                 vehicleCount: vehicleNum,
//                 performance: dispatchedNum > 0 ? `${(((plannedNum - delayNum) / plannedNum) * 100).toFixed(2)}%` : '0.00%',
//                 contractPerformance: plannedNum > 0 ? `${((dispatchedNum / plannedNum) * 100).toFixed(2)}%` : '0.00%'
//             };
//         });

//         data.push({
//             SNo: 'Total',
//             date: `${monthName} ${year}`,
//             planned: totals.planned,
//             dispatched: totals.dispatched,
//             delay: totals.delay,
//             vehicleCount: totals.vehicleCount,
//             performance: totals.planned > 0 ? `${(((totals.planned - totals.delay) / totals.planned) * 100).toFixed(2)}%` : '0.00%',
//             contractPerformance: totals.planned > 0 ? `${((totals.dispatched / totals.planned) * 100).toFixed(2)}%` : '0.00%',
//             otd: '100%'
//         });

//         res.status(200).json({
//             success: true,
//             message: `Daily ContractNo Count and Performance for ${monthName} ${year}`,
//             date: clientDate.toISOString().slice(0, 10),
//             data,
//         });

//     } catch (err) {
//         console.error('Dashboard error:', err);
//         res.status(500).json({
//             success: false,
//             message: err.message || 'An error occurred while fetching dashboard data.',
//         });
//     }
// };

exports.dashcontractnodotnet = async (req, res) => {
    try {
        const clientDate = req.body.date ? new Date(req.body.date) : new Date();
        const year = clientDate.getFullYear();
        const month = clientDate.getMonth() + 1;

        const monthStr = month.toString().padStart(2, '0');
        const firstDayOfMonth = `${year}-${monthStr}-01`;
        // const lastDayOfMonth = new Date(year, month, 0).toISOString().slice(0, 10);
        const lastDay = new Date(year, month, 0).getDate();
        const lastDayOfMonth = `${year}-${monthStr}-${lastDay.toString().padStart(2, '0')}`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const monthName = clientDate.toLocaleString('default', { month: 'long' });

        const debug = req.body.debug === true;

        const fimFields = [
            'FIM5.0', 'FIM8.0', 'FIM3.1', 'FIM3.2', 'FIM9.11', 'FIM2.31',
            'FIM11.11', 'FIM9.12', 'FIM4.4', 'FIM11.12', 'FIM11.0', 'FIM2.3',
            'FIM4.1', 'FIM8.1', 'FIM9.0', 'FIM9.13', 'FIM9.1','FIM9.4'
        ];
        const notNullCondition = fimFields
  .map(f => `\`${f}\` IS NOT NULL`)
  .join(' OR ');
        // 1️⃣ Planned, Dispatched, Delay Query
       const query = `
SELECT 
    sm.shipmentDate,
    sd.mstId,
    COUNT(sd.id) AS planned,
    SUM(
        CASE 
            WHEN (
                ${fimFields.map(f => `(\`${f}\` = 'P/R/D' OR \`${f}\` IS NULL)`).join(' AND ')}
            )   
            AND (
                ${fimFields.map(f => `\`${f}\` IS NOT NULL`).join(' OR ')}
            )
            THEN 1 ELSE 0
        END
    ) AS dispatched,
    SUM(CASE WHEN sd.OTD = 'NO' THEN 1 ELSE 0 END) AS delay
FROM shipment_details sd
INNER JOIN shipment_mst sm ON sm.id = sd.mstId
WHERE sm.shipmentDate >= ?
AND sm.shipmentDate < DATE_ADD(?, INTERVAL 1 DAY)
AND (${notNullCondition})   
GROUP BY sm.shipmentDate, sd.mstId
ORDER BY sm.shipmentDate
`;
        if (debug) console.log("Executing Query:\n", query);
        const [rows] = await connection.execute(query, [firstDayOfMonth, lastDayOfMonth]);
        if (debug) console.log("Fetched Rows:", JSON.stringify(rows, null, 2));

        // 2️⃣ Vehicle Count Query (each delMstId counted once if any endTime exists)
        const vehicleQuery = `
                SELECT 
                    DATE(dnm.deliveryDate) AS date,
                    COUNT(DISTINCT dnm.id) AS vehicleCount
                FROM del_note_mst dnm
                JOIN (
                    SELECT DISTINCT delMstId
                    FROM gstsalesinvoitem
                    WHERE endTime IS NOT NULL
                ) gi ON gi.delMstId = dnm.id
                WHERE dnm.deliveryDate BETWEEN ? AND ?
                GROUP BY DATE(dnm.deliveryDate)
                ORDER BY DATE(dnm.deliveryDate);
                `;
        const [vehicleRows] = await connection.execute(vehicleQuery, [firstDayOfMonth, lastDayOfMonth]);

        // 3️⃣ Prepare daily counts
        const dailyCounts = Array(daysInMonth).fill().map(() => ({
            planned: 0,
            dispatched: 0,
            delay: 0,
            vehicleCount: 0
        }));
        let totals = { planned: 0, dispatched: 0, delay: 0, vehicleCount: 0 };

        // Planned, Dispatched, Delay
        rows.forEach(row => {
            const dayIndex = new Date(row.shipmentDate).getDate() - 1;
          
            if (dayIndex < 0 || dayIndex >= daysInMonth) return;

            dailyCounts[dayIndex].planned += Number(row.planned);
            dailyCounts[dayIndex].dispatched += Number(row.dispatched);
            dailyCounts[dayIndex].delay += Number(row.delay);

            totals.planned += Number(row.planned);
            totals.dispatched += Number(row.dispatched);
            totals.delay += Number(row.delay);
        });

        // Vehicle Count
        vehicleRows.forEach(row => {
            const dayIndex = new Date(row.date).getDate() - 1;
            if (dayIndex < 0 || dayIndex >= daysInMonth) return;

            dailyCounts[dayIndex].vehicleCount = Number(row.vehicleCount);
            totals.vehicleCount += Number(row.vehicleCount);
        });

        // 4️⃣ Build response
const data = dailyCounts.map((day, index) => {
    const dayNum = index + 1;
    const plannedNum = Number(day.planned);
    const dispatchedNum = Number(day.dispatched);
    const delayNum = Number(day.delay);
    const vehicleNum = Number(day.vehicleCount);

           return {
        SNo: dayNum,
        dispatchDate: `${year}-${monthStr}-${dayNum.toString().padStart(2, '0')}`, // ✅ renamed
        planned: plannedNum,
        dispatched: dispatchedNum,
        delay: delayNum,
        vehicleCount: vehicleNum,
        performance: plannedNum > 0
            ? `${(((plannedNum - delayNum) / plannedNum) * 100).toFixed(2)}%`
            : '0.00%',
        contractPerformance: plannedNum > 0
            ? `${((dispatchedNum / plannedNum) * 100).toFixed(2)}%`
            : '0.00%'
    };
});
    const totalData = {
    TotalPlanned: totals.planned,
    TotalDispatched: totals.dispatched,
    TotalDelay: totals.delay,
    TotalVehicleCount: totals.vehicleCount,
    TotalPerformance: totals.planned > 0
        ? `${((totals.dispatched / totals.planned) * 100).toFixed(2)}%`
        : '0.00%',
    TotalOtd: totals.planned > 0
        ? `${(((totals.planned - totals.delay) / totals.planned) * 100).toFixed(2)}%`
        : '0.00%'
};


  res.status(200).json({
    success: true,
    message: `Daily ContractNo Count and Performance for ${monthName} ${year}`,
    date: clientDate.toISOString().slice(0, 10),
    data,        // ✅ only daily data
    Total: totalData   // ✅ separate total
});

    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'An error occurred while fetching dashboard data.',
        });
    }
};







exports.updateSobRemarks = async (req, res) => {
    try {
        const { id, remarks } = req.body;

        if (!id || remarks === undefined) {
            return res.status(400).json({ success: false, message: "id and remarks are required" });
        }

        const sql = `UPDATE shipment_details SET remarks = ? WHERE id = ?`;
        const [result] = await connection.query(sql, [remarks, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "No record found with given id" });
        }

        res.json({ success: true, message: "Remarks updated successfully" });
    } catch (err) {
        console.error("Error updating remarks:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
};





//////////////////new CR version partno


exports.getDispatchWithVehicle = async (req, res) => {
    try {
        const { shipmentDate } = req.body;
        const filterDate = shipmentDate ? shipmentDate.split('T')[0] : null;

        if (!shipmentDate) {
            return res.status(400).json({
                success: false,
                message: "shipmentDate is required",
            });
        }

        // 🔍 Fetch joined data from del_note + del_note_mst + gstsalesinvoitem
        const [rows] = await connection.execute(
            `SELECT 
          dn.id,
          dn.poNo,
          dn.contractNo AS PartNo,
          dn.qty AS Qty,
          dn.StartTime AS StartTime,
          dn.remarks,
          dnm.vehicleNo,
          dnm.delNoteNo,
          dnm.deliveryDate,
          gsii.endTime
       FROM del_note dn
       LEFT JOIN del_note_mst dnm ON dnm.id = dn.delMstId
       LEFT JOIN gstsalesinvoitem gsii ON gsii.delDtlId = dn.id
       WHERE dn.fimNo IS NULL
       AND DATE(dnm.deliveryDate) = ?`,
            [filterDate]
        );

        if (rows.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        // 🧾 Format response
        const data = rows.map((row, index) => {
            let delay = null;
            let colorCode = null;
            let OTD = null;

            if (row.StartTime && row.endTime) {
                const start = new Date(row.StartTime);
                const end = new Date(row.endTime);

                // Add 20 minutes to StartTime (ETAR)
                const etar = new Date(start.getTime() + 20 * 60000);

                // Calculate delay in minutes (endTime - ETAR)
                const delayMinutes = Math.floor((end - etar) / 60000);

                // if (delayMinutes > 0) {
                //     delay = `${delayMinutes} min`;
                //     colorCode = "#F5B133"; // delay color
                // } else {
                //     delay = "0 min";
                //     colorCode = "#56ED79"; // on-time color
                // }
                if (delayMinutes <= 0) {
                    delay = "0 min";
                    colorCode = "#56ED79";  // Green
                }
                else if (delayMinutes > 0 && delayMinutes <= 5) {
                    delay = `${delayMinutes} min`;
                    colorCode = "#E3EE6A";  // Yellow
                }
                else if (delayMinutes > 5) {
                    delay = `${delayMinutes} min`;
                    colorCode = "#F5B133";  // Orange
                }

                // ✅ Calculate OTD (compare endTime date vs shipmentDate)
                const endDateOnly = end.toISOString().split("T")[0];
                OTD = endDateOnly <= filterDate ? "YES" : "NO";
            }

            return {
                SNo: index + 1,
                id: row.id,
                DelNoteNo: row.delNoteNo,
                PartNo: row.PartNo,
                Qty: row.Qty,
                PoNo: row.poNo,
                VehicleNo: row.vehicleNo,
                StartTime: row.StartTime,
                EndTime: row.endTime || null,
                Remarks: row.remarks,
                Delay: delay,
                OTD,
                colorCode,
            };
        });

        return res.status(200).json({
            success: true,
            data,
        });

    } catch (err) {
        console.error("❌ Error in getDispatchWithVehicle:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};


exports.postRemarks = async (req, res) => {
    try {
        const { id, remarks } = req.body;

        // ✅ Validate input
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "id is required",
            });
        }

        if (!remarks) {
            return res.status(400).json({
                success: false,
                message: "remarks is required",
            });
        }

        // ✅ Update single record
        const [result] = await connection.execute(
            `UPDATE del_note 
       SET remarks = ?
       WHERE id = ?`,
            [remarks, id]
        );

        // ✅ Return success
        return res.status(200).json({
            success: true,
            message: "Remarks updated successfully ✅",
            updatedCount: result.affectedRows,
        });

    } catch (error) {
        console.error("❌ Error updating remarks:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};


exports.updateStartTime = async (req, res) => {
    try {
        const { ids, startTime } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: "ids (array) is required",
            });
        }

        if (!startTime) {
            return res.status(400).json({
                success: false,
                message: "startTime is required",
            });
        }

        const placeholders = ids.map(() => "?").join(",");

        const [result] = await connection.execute(
            `UPDATE del_note 
       SET StartTime = ?
       WHERE id IN (${placeholders})`,
            [startTime, ...ids]
        );

        return res.status(200).json({
            success: true,
            message: "StartTime updated successfully",
        });

    } catch (error) {
        console.error("❌ Error updating StartTime:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};





//old deployed new cr 
// exports.footerPartNo = async (req, res) => {
//   try {
//     const inputDate = new Date(req.body.date);

//     if (isNaN(inputDate)) {
//       return res.status(400).json({ success: false, message: "Invalid date" });
//     }

//     const year = inputDate.getFullYear();
//     const month = String(inputDate.getMonth() + 1).padStart(2, "0");
//     const startDate = `${year}-${month}-01`;
//     const endDate = `${year}-${month}-31`;

//     // 🟢 Planned count
//     const [plannedRows] = await connection.execute(
//       `
//       SELECT 
//         DATE_FORMAT(dnm.deliveryDate, '%Y-%m-%d') AS date,
//         COUNT(DISTINCT dn.id) AS planned
//       FROM del_note_mst dnm
//       JOIN del_note dn ON dn.delMstId = dnm.id
//       WHERE dnm.deliveryDate BETWEEN ? AND ?
//         AND dn.fimNo IS NULL
//       GROUP BY DATE(dnm.deliveryDate)
//       ORDER BY DATE(dnm.deliveryDate)
//       `,
//       [startDate, endDate]
//     );

//     // 🟡 Dispatched count + OTD (delayCount)
//     const [dispatchedRows] = await connection.execute(
//       `
//       SELECT 
//         DATE_FORMAT(dnm.deliveryDate, '%Y-%m-%d') AS date,
//         COUNT(DISTINCT dn.id) AS dispatched,
//         SUM(CASE WHEN gsi.endTime <= ? THEN 1 ELSE 0 END) AS delayCount
//       FROM del_note_mst dnm
//       JOIN del_note dn ON dn.delMstId = dnm.id
//       JOIN gstsalesinvoitem gsi ON gsi.delDtlId = dn.id
//       WHERE 
//         dnm.deliveryDate BETWEEN ? AND ?
//         AND gsi.endTime IS NOT NULL
//         AND dn.fimNo IS NULL
//       GROUP BY DATE(dnm.deliveryDate)
//       ORDER BY DATE(dnm.deliveryDate)
//       `,
//       [inputDate, startDate, endDate]
//     );

//     // 🚚 Vehicle count
//     const [vehicleRows] = await connection.execute(
//       `
//       SELECT 
//         DATE_FORMAT(dnm.deliveryDate, '%Y-%m-%d') AS date,
//         COUNT(DISTINCT dnm.id) AS vehicleCount
//       FROM del_note_mst dnm
//       JOIN del_note dn ON dn.delMstId = dnm.id
//       JOIN gstsalesinvoitem gsi ON gsi.delDtlId = dn.id
//       WHERE 
//         dnm.deliveryDate BETWEEN ? AND ?
//         AND gsi.endTime IS NOT NULL
//         AND dn.fimNo IS NULL
//       GROUP BY DATE(dnm.deliveryDate)
//       ORDER BY DATE(dnm.deliveryDate)
//       `,
//       [startDate, endDate]
//     );

//     // 🧩 Combine all
//     const dataMap = {};

//     plannedRows.forEach(row => {
//       dataMap[row.date] = {
//         planned: Number(row.planned) || 0,
//         dispatched: 0,
//         delayCount: 0,
//         vehicleCount: 0
//       };
//     });

//     dispatchedRows.forEach(row => {
//       if (!dataMap[row.date]) {
//         dataMap[row.date] = {
//           planned: 0,
//           dispatched: Number(row.dispatched) || 0,
//           delayCount: Number(row.delayCount) || 0,
//           vehicleCount: 0
//         };
//       } else {
//         dataMap[row.date].dispatched = Number(row.dispatched) || 0;
//         dataMap[row.date].delayCount = Number(row.delayCount) || 0;
//       }
//     });

//     vehicleRows.forEach(row => {
//       if (!dataMap[row.date]) {
//         dataMap[row.date] = {
//           planned: 0,
//           dispatched: 0,
//           delayCount: 0,
//           vehicleCount: Number(row.vehicleCount) || 0
//         };
//       } else {
//         dataMap[row.date].vehicleCount = Number(row.vehicleCount) || 0;
//       }
//     });

//     // 🧾 Build monthly summary
//     const daysInMonth = new Date(year, parseInt(month), 0).getDate();
//     const responseData = [];

//     let totalPlanned = 0;
//     let totalDispatched = 0;
//     let totalDelay = 0;
//     let totalVehicle = 0;

//     for (let day = 1; day <= daysInMonth; day++) {
//       const dateStr = `${year}-${month}-${String(day).padStart(2, "0")}`;
//       const planned = Number(dataMap[dateStr]?.planned || 0);
//       const dispatched = Number(dataMap[dateStr]?.dispatched || 0);
//       const delayCount = Number(dataMap[dateStr]?.delayCount || 0);
//       const vehicleCount = Number(dataMap[dateStr]?.vehicleCount || 0);

//       totalPlanned += planned;
//       totalDispatched += dispatched;
//       totalDelay += delayCount;
//       totalVehicle += vehicleCount;

//       responseData.push({
//         SNo: day,
//         date: dateStr,
//         planned,
//         dispatched,
//         delayCount,
//         vehicleCount,
//         partPerformance: planned > 0 ? ((dispatched / planned) * 100).toFixed(2) : "0.00",
//         otdPerformance: dispatched > 0 ? (((planned - delayCount) / planned) * 100).toFixed(2) : "0.00",
//       });
//     }

//     // ✅ Calculate overall performance
//     const partOverallPerfo =
//       totalPlanned > 0 ? ((totalDispatched / totalPlanned) * 100).toFixed(2) : "0.00";

//     const overallOtdPerc =
//       totalPlanned > 0 ? (((totalPlanned - totalDelay) / totalPlanned) * 100).toFixed(2) : "0.00";

//     // ✅ Final output
//     res.json({
//       success: true,
//       message: `Daily Planned, Dispatched, Vehicle & OTD Counts for ${inputDate.toLocaleString(
//         "default",
//         { month: "long" }
//       )} ${year}`,
//       date: req.body.date,
//       overall: {
//         planned: totalPlanned,
//         dispatched: totalDispatched,
//         delayCount: totalDelay,
//         vehicleCount: totalVehicle,
//         partOverallPerfo,
//         overallOtdPerc
//       },
//       data: responseData,
//     });
//   } catch (error) {
//     console.error("❌ Error in footerPartNo:", error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

//new with otd changes 
exports.footerPartNo = async (req, res) => {
    try {
        const inputDate = new Date(req.body.date);

        if (isNaN(inputDate)) {
            return res.status(400).json({ success: false, message: "Invalid date" });
        }

        const year = inputDate.getFullYear();
        const month = String(inputDate.getMonth() + 1).padStart(2, "0");
        const startDate = `${year}-${month}-01`;
        const endDate = `${year}-${month}-31`;

        // 🟢 Planned count
        const [plannedRows] = await connection.execute(
            `
      SELECT 
        DATE_FORMAT(dnm.deliveryDate, '%Y-%m-%d') AS date,
        COUNT(DISTINCT dn.id) AS planned
      FROM del_note_mst dnm
      JOIN del_note dn ON dn.delMstId = dnm.id
      WHERE dnm.deliveryDate BETWEEN ? AND ?
        AND dn.fimNo IS NULL
      GROUP BY DATE(dnm.deliveryDate)
      ORDER BY DATE(dnm.deliveryDate)
      `,
            [startDate, endDate]
        );

        // 🟡 Dispatched count + OTD (delayCount)
        const [dispatchedRows] = await connection.execute(
            `
      SELECT 
        DATE_FORMAT(dnm.deliveryDate, '%Y-%m-%d') AS date,
        COUNT(DISTINCT dn.id) AS dispatched,
        SUM(CASE WHEN DATE(gsi.endTime) > DATE(dnm.deliveryDate) THEN 1 ELSE 0 END) AS delayCount
      FROM del_note_mst dnm
      JOIN del_note dn ON dn.delMstId = dnm.id
      JOIN gstsalesinvoitem gsi ON gsi.delDtlId = dn.id
      WHERE 
        dnm.deliveryDate BETWEEN ? AND ?
        AND gsi.endTime IS NOT NULL
        AND dn.fimNo IS NULL
      GROUP BY DATE(dnm.deliveryDate)
      ORDER BY DATE(dnm.deliveryDate)
      `,
            [startDate, endDate]
        );

        // Vehicle count
        const [vehicleRows] = await connection.execute(
            `
      SELECT 
        DATE_FORMAT(dnm.deliveryDate, '%Y-%m-%d') AS date,
        COUNT(DISTINCT dnm.id) AS vehicleCount
      FROM del_note_mst dnm
      JOIN del_note dn ON dn.delMstId = dnm.id
      JOIN gstsalesinvoitem gsi ON gsi.delDtlId = dn.id
      WHERE 
        dnm.deliveryDate BETWEEN ? AND ?
        AND gsi.endTime IS NOT NULL
        AND dn.fimNo IS NULL
      GROUP BY DATE(dnm.deliveryDate)
      ORDER BY DATE(dnm.deliveryDate)
      `,
            [startDate, endDate]
        );

        // 🧩 Combine all
        const dataMap = {};

        plannedRows.forEach(row => {
            dataMap[row.date] = {
                planned: Number(row.planned) || 0,
                dispatched: 0,
                delayCount: 0,
                vehicleCount: 0
            };
        });

        dispatchedRows.forEach(row => {
            if (!dataMap[row.date]) {
                dataMap[row.date] = {
                    planned: 0,
                    dispatched: Number(row.dispatched) || 0,
                    delayCount: Number(row.delayCount) || 0,
                    vehicleCount: 0
                };
            } else {
                dataMap[row.date].dispatched = Number(row.dispatched) || 0;
                dataMap[row.date].delayCount = Number(row.delayCount) || 0;
            }
        });

        vehicleRows.forEach(row => {
            if (!dataMap[row.date]) {
                dataMap[row.date] = {
                    planned: 0,
                    dispatched: 0,
                    delayCount: 0,
                    vehicleCount: Number(row.vehicleCount) || 0
                };
            } else {
                dataMap[row.date].vehicleCount = Number(row.vehicleCount) || 0;
            }
        });

        // 🧾 Build monthly summary
        const daysInMonth = new Date(year, parseInt(month), 0).getDate();
        const responseData = [];

        let totalPlanned = 0;
        let totalDispatched = 0;
        let totalDelay = 0;
        let totalVehicle = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${month}-${String(day).padStart(2, "0")}`;
            const planned = Number(dataMap[dateStr]?.planned || 0);
            const dispatched = Number(dataMap[dateStr]?.dispatched || 0);
            const delayCount = Number(dataMap[dateStr]?.delayCount || 0);
            const vehicleCount = Number(dataMap[dateStr]?.vehicleCount || 0);

            totalPlanned += planned;
            totalDispatched += dispatched;
            totalDelay += delayCount;
            totalVehicle += vehicleCount;

            responseData.push({
                SNo: day,
                date: dateStr,
                planned,
                dispatched,
                delayCount,
                vehicleCount,
                partPerformance: planned > 0 ? ((dispatched / planned) * 100).toFixed(2) : "0.00",
                otdPerformance:
                    planned === 0
                        ? "0.00"
                        : dispatched === 0
                            ? "0.00"
                            : delayCount === 0
                                ? "100.00"
                                : ((planned - delayCount) / planned * 100).toFixed(2),
            });
        }

        // ✅ Calculate overall performance
        const partOverallPerfo =
            totalPlanned > 0 ? ((totalDispatched / totalPlanned) * 100).toFixed(2) : "0.00";

        const overallOtdPerc =
            totalPlanned > 0 ? (((totalPlanned - totalDelay) / totalPlanned) * 100).toFixed(2) : "0.00";

        // ✅ Final output
        res.json({
            success: true,
            message: `Daily Planned, Dispatched, Vehicle & OTD Counts for ${inputDate.toLocaleString(
                "default",
                { month: "long" }
            )} ${year}`,
            date: req.body.date,
            overall: {
                planned: totalPlanned,
                dispatched: totalDispatched,
                delayCount: totalDelay,
                vehicleCount: totalVehicle,
                partOverallPerfo,
                overallOtdPerc
            },
            data: responseData,
        });
    } catch (error) {
        console.error("❌ Error in footerPartNo:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};



//search api
// exports.searchShipment = async (req, res) => {
//     try {
//         const { DelNoteNo, shipmentDate } = req.body;

//         if (!shipmentDate) {
//             return res.status(400).json({
//                 success: false,
//                 message: "shipmentDate is required"
//             });
//         }

//         // 1️⃣ Check if shipmentDate exists in shipment_mst
//         const [mstRows] = await connection.execute(
//             "SELECT id FROM shipment_mst WHERE shipmentDate = ?",
//             [shipmentDate]
//         );

//         if (mstRows.length === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Unknown shipmentDate"
//             });
//         }

//         const mstId = mstRows[0].id;

//         // 2️⃣ Fetch shipment_details for this mstId and DelNoteNo
//         let query = `SELECT * FROM shipment_details WHERE mstId = ?`;
//         let params = [mstId];

//         if (DelNoteNo) {
//             query += ` AND DelNoteNo = ?`;
//             params.push(DelNoteNo);
//         }

//         const [rows] = await connection.execute(query, params);

//         if (rows.length === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Unknown DelNote in shipmentDate"
//             });
//         }

//         // 3️⃣ Filter FIMs + add colorCode
//         const result = rows.map(row => {
//             let colorCode = null;

//             if (row.Delay !== null && row.Delay !== undefined) {
//                 const delayNum = parseInt(row.Delay);
//                 if (delayNum === 0) colorCode = "#56ED79";
//                 else if (delayNum > 0 && delayNum <= 20) colorCode = "#E3EE6A";
//                 else if (delayNum > 20) colorCode = "#F5B133";
//             }

//             // Keep all main shipment columns
//             const mainColumns = {
//                 id: row.id,
//                 mstId: row.mstId,
//                 DelNoteNo: row.DelNoteNo,
//                 ContractNo: row.ContractNo,
//                 KanbanDate: row.KanbanDate,
//                 TimeSlot: row.TimeSlot,
//                 Duty: row.Duty,
//                 QtyStops: row.QtyStops,
//                 PoNo: row.PoNo,
//                 VehicleNo: row.VehicleNo,
//                 Start_Time: row.Start_Time,
//                 End_Time: row.End_Time,
//                 Delay: row.Delay,
//                 OTD: row.OTD,
//                 Remarks: row.Remarks
//             };

//             // Filter only non-null FIMs
//             Object.keys(row).forEach(key => {
//                 if (key.startsWith("FIM") && row[key] !== null) {
//                     mainColumns[key] = row[key];
//                 }
//             });

//             // Add colorCode if needed
//             if (colorCode) mainColumns.colorCode = colorCode;

//             return mainColumns;
//         });

//         return res.status(200).json({
//             success: true,
//             count: result.length,
//             data: result
//         });

//     } catch (err) {
//         console.error("Error:", err);
//         return res.status(500).json({
//             success: false,
//             message: "Server error",
//             error: err.message
//         });
//     }
// };

exports.searchShipment = async (req, res) => {
    try {
        const { DelNoteNo, shipmentDate } = req.body;

        if (!shipmentDate) {
            return res.status(400).json({
                success: false,
                message: "shipmentDate is required"
            });
        }

        // 1️⃣ Check if shipmentDate exists in shipment_mst
        const [mstRows] = await connection.execute(
            "SELECT id FROM shipment_mst WHERE shipmentDate = ?",
            [shipmentDate]
        );

        if (mstRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Unknown shipmentDate"
            });
        }

        const mstId = mstRows[0].id;

        // 2️⃣ Fetch shipment_details for this mstId and DelNoteNo
        let query = `SELECT * FROM shipment_details WHERE mstId = ?`;
        let params = [mstId];

        if (DelNoteNo) {
            query += ` AND DelNoteNo = ?`;
            params.push(DelNoteNo);
        }

        const [rows] = await connection.execute(query, params);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Unknown DelNote in shipmentDate"
            });
        }
        const allFimKeys = new Set();
        rows.forEach(row => {
            Object.keys(row).forEach(key => {
                if (key.startsWith("FIM") && row[key] !== null) {
                    allFimKeys.add(key);
                }
            });
        });
        // 3️⃣ Filter FIMs + add colorCode
        const result = rows.map(row => {
            const allFimKeys = new Set();

            rows.forEach(row => {
                Object.keys(row).forEach(key => {
                    if (key.startsWith("FIM") && row[key] !== null) {
                        allFimKeys.add(key);
                    }
                });
            });
            let colorCode = null;

            if (row.Delay !== null && row.Delay !== undefined) {
                const delayNum = parseInt(row.Delay);
                if (delayNum === 0) colorCode = "#56ED79";
                else if (delayNum > 0 && delayNum <= 20) colorCode = "#E3EE6A";
                else if (delayNum > 20) colorCode = "#F5B133";
            }

            // Keep all main shipment columns
            const mainColumns = {
                id: row.id,
                mstId: row.mstId,
                DelNoteNo: row.DelNoteNo,
                ContractNo: row.ContractNo,
                KanbanDate: row.KanbanDate,
                TimeSlot: row.TimeSlot,
                Duty: row.Duty,
                QtyStops: row.QtyStops,
                PoNo: row.PoNo,
                VehicleNo: row.VehicleNo,
                Start_Time: row.Start_Time,
                End_Time: row.End_Time,
                Delay: row.Delay,
                OTD: row.OTD,
                Remarks: row.Remarks
            };

            // Filter only non-null FIMs
            allFimKeys.forEach(fimKey => {
                mainColumns[fimKey] = row.hasOwnProperty(fimKey)
                    ? row[fimKey]
                    : null;
            });

            // Add colorCode if needed
            if (colorCode) mainColumns.colorCode = colorCode;

            return mainColumns;
        });

        return res.status(200).json({
            success: true,
            count: result.length,
            data: result
        });

    } catch (err) {
        console.error("Error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: err.message
        });
    }
};



exports.getContractsByShipmentDate = async (req, res) => {
    try {
        const { shipmentDate } = req.body;

        if (!shipmentDate) {
            return res.status(400).json({
                success: false,
                message: "shipmentDate is required"
            });
        }

        // Step 1: Get mstId from shipment_mst table
        const [mstRows] = await connection.execute(
            `SELECT id FROM shipment_mst WHERE shipmentDate = ?`,
            [shipmentDate]
        );

        if (mstRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No data found for this shipmentDate"
            });
        }

        const mstId = mstRows[0].id;

        // Step 2: Fetch ContractNo from shipment_details
        const [rows] = await connection.execute(
            `SELECT ContractNo ,id
             FROM shipment_details 
             WHERE mstId = ?`,
            [mstId]
        );

        // Format: { contractNo: "ABC123" }
        const formatted = rows.map(r => ({
            id: r.id,
            contractNo: r.ContractNo
        }));

        return res.status(200).json({
            success: true,
            count: formatted.length,
            data: formatted
        });

    } catch (err) {
        console.error("Error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: err.message
        });
    }
};


exports.getContractDetails = async (req, res) => {
    try {
        const { contractNo } = req.params;

        if (!contractNo) {
            return res.status(400).json({
                success: false,
                message: "contractNo is required"
            });
        }

        const likeValue = `%${contractNo}%`;  // contains search

        const [rows] = await connection.execute(
            `SELECT id, ContractNo
             FROM shipment_details
             WHERE ContractNo LIKE ?`,
            [likeValue]
        );

        const formatted = rows.map(r => ({
            id: r.id,
            contractNo: r.ContractNo
        }));

        return res.status(200).json({
            success: true,
            count: formatted.length,
            data: formatted
        });

    } catch (err) {
        console.error("Error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: err.message
        });
    }
};








exports.getFIMValuesByContract = async (req, res) => {
    try {
        const { id } = req.body;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "id is required"
            });
        }

        const [rows] = await connection.execute(
            `SELECT * FROM shipment_details WHERE id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No data found for this id"
            });
        }

        const data = rows[0];

        const fimList = [];
        let count = 1;
        let sNo = 1;

        for (const key in data) {
            if (key.startsWith("FIM") && data[key] !== null) {

                fimList.push({
                    id: count++,
                    sNo: sNo++,
                    FIM: key,          // 👈 send as "FIM11.12"
                    status: data[key]
                });
            }
        }

        return res.status(200).json({
            success: true,
            id,
            data: fimList
        });

    } catch (err) {
        console.error("Error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: err.message
        });
    }
};



//old
// exports.updateFimStatus = async (req, res) => {
//     try {
//         const { id, fimNo } = req.body;

//         if (!id || !fimNo || !Array.isArray(fimNo)) {
//             return res.status(400).json({
//                 success: false,
//                 message: "id and fimNo (array) are required"
//             });
//         }

//         // Regex for safe column names
//         const validColumnRegex = /^[A-Za-z0-9_.]+$/;

//         // Build SET query dynamically
//         let setQueryParts = [];

//         fimNo.forEach(col => {
//             if (!validColumnRegex.test(col)) {
//                 return res.status(400).json({
//                     success: false,
//                     message: `Invalid fimNo format: ${col}`
//                 });
//             }
//             setQueryParts.push(`\`${col}\` = 'P/R/D'`);
//         });

//         const setQuery = setQueryParts.join(", ");

//         const sql = `
//             UPDATE shipment_details
//             SET ${setQuery}
//             WHERE id = ?
//         `;

//         await connection.execute(sql, [id]);

//         return res.json({
//             success: true,
//             message: `Updated columns ${fimNo.join(", ")} to 'P/R/D' for id ${id}`
//         });

//     } catch (error) {
//         console.error(error);
//         return res.status(500).json({
//             success: false,
//             message: "Internal server error"
//         });
//     }
// };
exports.updateFimStatus = async (req, res) => {
    try {
        const { id, fimNo } = req.body;

        if (!id || !fimNo || !Array.isArray(fimNo) || fimNo.length === 0) {
            return res.status(400).json({
                success: false,
                message: "id and fimNo (non-empty array) are required"
            });
        }

        const validColumnRegex = /^[A-Za-z0-9_.]+$/;

        let setQueryParts = [];

        for (const col of fimNo) {
            if (!validColumnRegex.test(col)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid fimNo format: ${col}`
                });
            }
            setQueryParts.push(`\`${col}\` = 'P/R/D'`);
        }

        if (setQueryParts.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid column names provided"
            });
        }

        const setQuery = setQueryParts.join(", ");

        const sql = `
            UPDATE shipment_details
            SET ${setQuery}
            WHERE id = ?
        `;

        await connection.execute(sql, [id]);

        return res.json({
            success: true,
            message: `Updated columns ${fimNo.join(", ")} to 'P/R/D' for id ${id}`
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};




/////////////post api part no delnote filter based on delivery date
exports.getDelNotesByDeliveryDate = async (req, res) => {
    try {
        const { deliveryDate } = req.body;

        if (!deliveryDate) {
            return res.status(400).json({
                success: false,
                message: "deliveryDate is required"
            });
        }

        // 1️⃣ Get delNoteMst ids for given deliveryDate
        const [mstRows] = await connection.execute(
            `SELECT id, delNoteNo
             FROM del_note_mst
             WHERE deliveryDate = ?`,
            [deliveryDate]
        );

        if (!mstRows.length) {
            return res.status(200).json({
                success: true,
                count: 0,
                data: []
            });
        }

        let finalList = [];

        // 2️⃣ For each delNoteMstId, validate condition in del_note table
        for (const row of mstRows) {

            const [details] = await connection.execute(
                `SELECT id 
                 FROM del_note
                 WHERE delMstId = ?
                   AND contractNo IS NOT NULL
                   AND fimNo IS NULL`,
                [row.id]
            );

            // 3️⃣ If matching rows exist → include this delNote
            if (details.length > 0) {
                finalList.push({
                    id: row.id,
                    delNoteNo: row.delNoteNo
                });
            }
        }

        return res.status(200).json({
            success: true,
            count: finalList.length,
            data: finalList
        });

    } catch (err) {
        console.error("Error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: err.message
        });
    }
};


exports.getPartFilteredData = async (req, res) => {
    try {
        const { delNoteId } = req.body;

        if (!delNoteId) {
            return res.status(400).json({
                success: false,
                message: "delNoteId is required",
            });
        }

        // Step 1: Fetch deliveryDate from del_note_mst
        const [mstRow] = await connection.execute(
            `SELECT deliveryDate 
             FROM del_note_mst 
             WHERE id = ?`,
            [delNoteId]
        );

        if (mstRow.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Invalid delNoteId",
            });
        }

        const deliveryDate = mstRow[0].deliveryDate;
        const filterDate = deliveryDate.split("T")[0];

        // Step 2: Use SAME logic based on this deliveryDate
        const [rows] = await connection.execute(
            `SELECT 
                dn.id,
                dn.poNo,
                dn.contractNo AS PartNo,
                dn.qty AS Qty,
                dn.StartTime AS StartTime,
                dn.remarks,
                dnm.vehicleNo,
                dnm.delNoteNo,
                dnm.deliveryDate,
                gsii.endTime
            FROM del_note dn
            LEFT JOIN del_note_mst dnm ON dnm.id = dn.delMstId
            LEFT JOIN gstsalesinvoitem gsii ON gsii.delDtlId = dn.id
            WHERE dn.fimNo IS NULL  AND dnm.id = ? 
            AND DATE(dnm.deliveryDate) = ?`,
            [delNoteId, filterDate]
        );

        if (rows.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        // Step 3: Format response (same old logic)
        const data = rows.map((row, index) => {
            let delay = null;
            let colorCode = null;
            let OTD = null;

            if (row.StartTime && row.endTime) {
                const start = new Date(row.StartTime);
                const end = new Date(row.endTime);

                const etar = new Date(start.getTime() + 20 * 60000);
                const delayMinutes = Math.floor((end - etar) / 60000);

                if (delayMinutes > 0) {
                    delay = `${delayMinutes} min`;
                    colorCode = "#F5B133";
                } else {
                    delay = "0 min";
                    colorCode = "#56ED79";
                }

                const endDateOnly = end.toISOString().split("T")[0];
                OTD = endDateOnly <= filterDate ? "YES" : "NO";
            }

            return {
                SNo: index + 1,
                id: row.id,
                DelNoteNo: row.delNoteNo,
                PartNo: row.PartNo,
                Qty: row.Qty,
                PoNo: row.poNo,
                VehicleNo: row.vehicleNo,
                StartTime: row.StartTime,
                EndTime: row.endTime || null,
                Remarks: row.remarks,
                Delay: delay,
                OTD,
                colorCode,
            };
        });

        return res.status(200).json({
            success: true,
            data,
        });

    } catch (err) {
        console.error("❌ Error in getDispatchWithVehicle:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};



exports.dailyKpiDash = async (req, res) => {
    try {
        const clientDate = req.body.date ? new Date(req.body.date) : new Date();
        const todayStr = clientDate.toISOString().slice(0, 10);
        const fimFields = [
            'FIM5.0', 'FIM8.0', 'FIM3.1', 'FIM3.2', 'FIM9.11', 'FIM2.31',
            'FIM11.11', 'FIM9.12', 'FIM4.4', 'FIM11.12', 'FIM11.0', 'FIM2.3',
            'FIM4.1', 'FIM8.1', 'FIM9.0', 'FIM9.13', 'FIM9.1'
        ];
        // :small_blue_diamond: Get planned, dispatched, delay info (keep original performance logic)
        const query = `
            SELECT
                COUNT(sd.id) AS planned,
                SUM(
                    CASE
                        WHEN ${fimFields.map(f => `(\`${f}\` = 'P/R/D' OR \`${f}\` IS NULL)`).join(' AND ')}
                        THEN 1 ELSE 0
                    END
                ) AS dispatched,
                SUM(CASE WHEN sd.OTD = 'NO' THEN 1 ELSE 0 END) AS delay
            FROM shipment_details sd
            INNER JOIN shipment_mst sm ON sm.id = sd.mstId
            WHERE DATE(sm.shipmentDate) = ?
        `;
        const [rows] = await connection.execute(query, [todayStr]);
        const planned = Number(rows[0]?.planned || 0);
        const dispatched = Number(rows[0]?.dispatched || 0);
        const delay = Number(rows[0]?.delay || 0);
        // :small_blue_diamond: Performance (original logic unchanged)
        const performance = planned > 0 ? `${(((planned - delay) / planned) * 100).toFixed(2)}` : '0.00';
        // :small_blue_diamond: Calculate vehicleTime (sum of Delay column for the date)
        const vehicleTimeQuery = `
            SELECT sd.Delay AS delayValue
            FROM shipment_details sd
            INNER JOIN shipment_mst sm ON sm.id = sd.mstId
            WHERE DATE(sm.shipmentDate) = ? AND sd.Delay IS NOT NULL
        `;
        const [delayRows] = await connection.execute(vehicleTimeQuery, [todayStr]);
        const parseDelayToMinutes = (str) => {
            if (!str) return 0;
            str = str.toLowerCase();
            let total = 0;
            const hrMatch = str.match(/(\d+)\s*hr/);
            const minMatch = str.match(/(\d+)\s*min/);
            if (hrMatch) total += parseInt(hrMatch[1], 10) * 60;
            if (minMatch) total += parseInt(minMatch[1], 10);
            return total;
        };
        const totalMinutes = delayRows.reduce((sum, row) => sum + parseDelayToMinutes(row.delayValue), 0);
        // const hours = Math.floor(totalMinutes / 60);
        // const minutes = totalMinutes % 60;
        // const vehicleTime = `${hours > 0 ? hours + ' hr ' : ''}${minutes} min`;
        const vehicleTime = totalMinutes;
        // :small_blue_diamond: Send response
        res.status(200).json({
            success: true,
            date: todayStr,
            todayPerformance: {
                target: "100",
                performance,
                vehicleTime,
                vehicleTarget: "20"
            }
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'An error occurred while fetching dashboard data.',
        });
    }
};

const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { generateSrnNo, insertSrnItems } = require("./srnController");
const { generateDocNo, updateDocCounter, docNoReset } = require('../utility/docNo');
const { sendEmail } = require("../config/emailService")
const excel = require("exceljs");
const fs = require("fs");
const path = require("path");

const dispatchLogPath = path.join(process.cwd(), "dispatch.txt");

const { delayCalculation } = require('./dispatchDashController');

// Assume `connection` is defined elsewhere in your code
async function fetchItem(item) {
    const [rows] = await connection.execute(`SELECT id FROM items WHERE itemCode = ?`, [item]);
    return rows.length > 0 ? rows[0].id : null;
}


//Fetching all Fim From Matchble data in Table dispatch_plan and  order_plannings
exports.searchFim = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;

        // let fetch = `
        //     SELECT  
        //         DISTINCT sob.fimNo
        //     FROM 
        //         order_plannings AS op  
        //     INNER JOIN sob ON op.sobMstId = sob.sobMstId
        //     INNER JOIN dispatch_plan as disp ON sob.contractNo = disp.contractNo

        //     `;

        let fetch = `
            SELECT  
                DISTINCT CONCAT( SUBSTRING(sob.fimNo, LOCATE('IM', sob.fimNo) - 1)) AS fimNo
            FROM 
                order_plannings AS op  
            INNER JOIN sob ON op.sobMstId = sob.sobMstId
            INNER JOIN dispatch_plan as disp ON sob.contractNo = disp.contractNo
        `;

        const values = [];

        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` AND ( sob.fimNo LIKE ? OR CAST( sob.fimNo AS CHAR) LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes containing the search query
            values.push(`%${q}%`); // Append '%' to the search query to match item codes containing the search query
        }

        // fetch += ` LIMIT 20`; // Add LIMIT clause to retrieve only the first 10 records

        const [rows, fields] = await connection.execute(fetch, values);

        //Auto Index value
        rows.forEach((element, index) => {
            element.sNo = index + 1;
        });

        return res.status(200).json({ success: true, message: "FIM", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}


//Currently not used
//GET ALL FIM from item_fim_id
exports.getFim = async (req, res) => {
    try {
        const sqlQuery = `
            SELECT 
                item_fim_id.id, item_fim_id.name
            FROM 
                item_fim_id
            WHERE 
                item_fim_id.dflag = 0`;

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, []);

        // Filter and map the rows to extract only the FIM names with decimal numbers
        const filteredRows = rows.filter(row => {
            return /^FIM\d+(\.\d+)?$/.test(row.name); // Test if the name matches the pattern
        }).map(row => {
            return {
                id: row.id,
                name: row.name
            };
        });

        return res.status(200).json({ success: true, data: filteredRows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
}






exports.show2 = async (req, res) => {
    try {
        const date = req.body.date;
        const fim = req.body.fim;

        let query = `
            SELECT  
                sob.id, sob.contractNo, sob.partNo, sob.plannedStatus, csl.boxNo, sob.fimNo, 
                csl_mst.duty, csl_mst.product, csl_mst.stop, dp.timeSlot, dp.id AS dispatchId, 
                DATE_FORMAT(dp.sheduledDate, '%d-%m-%Y') AS sheduledDate,
                DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
            FROM 
                dispatch_plan AS dp  
            INNER JOIN csl ON csl.contractNo = dp.contractNo
            LEFT JOIN sob ON sob.cslMstId = csl.cslMstId
            LEFT JOIN order_plannings op ON op.sobMstId = sob.sobMstId
            LEFT JOIN csl_mst ON sob.cslMstId = csl_mst.id
        `;

        const params = [];

        if (date && fim) {
            query += ` WHERE dp.sheduledDate = ? AND sob.fimNo LIKE ?`;
            params.push(date, `%${fim}%`);
        } else if (date) {
            query += ` WHERE dp.sheduledDate = ?`;
            params.push(date);
        } else if (fim) {
            query += ` WHERE sob.fimNo LIKE ?`;
            params.push(`%${fim}%`);
        }

        const [rows] = await connection.execute(query, params);

        // Sort rows by TimeSlot
        rows.sort((a, b) => {
            const timeSlotToValue = timeSlot => {
                if (!timeSlot) return Number.MAX_VALUE; // Handle null or undefined timeSlot by placing it at the end

                const [start] = timeSlot.split('-').map(t => t.trim()); // Extract start time
                const match = start.match(/(\d+)(AM|PM)/);
                if (!match) return Number.MAX_VALUE; // If format is unexpected, place it at the end

                const [_, hour, period] = match; // Destructure matched groups
                let h = parseInt(hour, 10);
                if (period === 'PM' && h !== 12) h += 12;
                if (period === 'AM' && h === 12) h = 0;
                return h;
            };

            return timeSlotToValue(a.timeSlot) - timeSlotToValue(b.timeSlot);
        });

        let id = 1;
        let sNo = 1;
        const fimNoSet = new Set();
        const result = {};

        for (const row of rows) {
            const prefix = getPrefix(row.boxNo);

            if (!result[prefix]) {
                result[prefix] = [];
            }

            let contractEntry = result[prefix].find(entry => entry.ContractNo === row.contractNo);
            if (!contractEntry) {
                contractEntry = {
                    id: id++, // Generate id after sorting
                    SNo: sNo++, // Generate SNo after sorting
                    ContractNo: row.contractNo,
                    KanbanDate: row.kanbanDate,
                    SheduledDate: row.sheduledDate,
                    TimeSlot: row.timeSlot,
                    Duty: row.duty,
                    Product: row.product,
                    QtyStops: row.stop,
                    Prefix: prefix
                };

                const [fimRows] = await connection.execute(`
                    SELECT name FROM item_fim_id WHERE name LIKE ?`, [`${prefix}%`]);

                fimRows.forEach(fimRow => {
                    const fimNoNumeric = fimRow.name.replace(prefix, '').trim();
                    if (fimNoNumeric) {
                        fimNoSet.add(fimNoNumeric);
                        contractEntry[fimNoNumeric] = null;
                    }
                });

                result[prefix].push(contractEntry);
            }

            if (row.fimNo) { // Check if fimNo is not null
                const fimNoMatch = row.fimNo.match(/[0-9.]+/);
                if (fimNoMatch) {
                    const fimNoNumeric = fimNoMatch[0];
                    if (fimNoSet.has(fimNoNumeric)) {
                        contractEntry[fimNoNumeric] = row.plannedStatus || null;
                    }
                }
            }
        }

        const fimNoArray = Array.from(fimNoSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        const finalResult = Object.values(result).flatMap(contractEntries => {
            return contractEntries.map(item => {
                const newItem = { ...item };
                fimNoArray.forEach(fimNo => {
                    if (!(fimNo in newItem)) {
                        newItem[fimNo] = null;
                    }
                });
                return newItem;
            });
        });

        // Initialize the counts object
        const counts = {
            P: {}, // To count "P"
            PR: {} // To count "P/R"
        };

        fimNoArray.forEach(fimNo => {
            counts.P[fimNo] = 0;  // Initialize count for "P"
            counts.PR[fimNo] = 0; // Initialize count for "P/R"
        });

        // Count "P" and "P/R" occurrences
        finalResult.forEach(item => {
            fimNoArray.forEach(fimNo => {
                if (item[fimNo] === 'P') {
                    counts.P[fimNo] += 1;
                }
                if (item[fimNo] === 'P/R') {
                    counts.PR[fimNo] += 1;
                }
            });
        });

        // Add Total CONTRACTS object
        const summaryObject = { id: id++, Product: "TOTAL CONTRACTS" };
        fimNoArray.forEach(fimNo => {
            summaryObject[fimNo] = counts.P[fimNo] + counts.PR[fimNo];  // Add "P" and "P/R" counts together for total
        });

        // Add READY CONTRACTS object
        const readyObject = { id: id++, Product: "READY CONTRACTS" };
        fimNoArray.forEach(fimNo => {
            readyObject[fimNo] = counts.PR[fimNo];  // Only "P/R" count for ready contracts
        });


        // Add PENDING CONTRACTS object
        const pendingObject = { id: id++, Product: "PENDING CONTRACTS" };
        fimNoArray.forEach(fimNo => {
            pendingObject[fimNo] = (summaryObject[fimNo] || 0) - (readyObject[fimNo] || 0);
        });

        finalResult.push(summaryObject);
        finalResult.push(readyObject);
        finalResult.push(pendingObject);


        // Remove FIMs with all null values
        fimNoArray.forEach(fimNo => {
            const isFIMNullEverywhere = finalResult.every(item => item[fimNo] === null);

            if (isFIMNullEverywhere) {
                // Remove the FIM from all objects
                finalResult.forEach(item => {
                    delete item[fimNo];
                });
            }
        });

        return res.status(200).json({
            success: true,
            message: "Dispatch Plan list",
            data: finalResult
        });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};


// exports.show = async (req, res) => {
//     try {
//         const date = req.body.date;
//         const fim = req.body.fim;
//         // const match = req.body.fim.match(/FIM\d+(\.\d+)?/);
//         // const fim = match ? match[0] : null;

//         // //console.log(fim);


//         let query = `
//             SELECT  
//                 sob.id, sob.contractNo, sob.partNo, sob.plannedStatus, csl.boxNo, sob.fimNo, 
//                 csl_mst.duty, csl_mst.product, csl_mst.stop, dp.timeSlot, dp.id AS dispatchId, 
//                 DATE_FORMAT(dp.sheduledDate, '%d-%m-%Y') AS sheduledDate,
//                 DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
//             FROM 
//                 dispatch_plan AS dp  
//             INNER JOIN csl ON csl.contractNo = dp.contractNo
//             LEFT JOIN sob ON sob.cslMstId = csl.cslMstId
//             LEFT JOIN order_plannings op ON op.sobMstId = sob.sobMstId
//             LEFT JOIN csl_mst ON sob.cslMstId = csl_mst.id
//         `;

//         const params = [];

//         if (date && fim) {
//             query += ` WHERE dp.sheduledDate = ? AND sob.fimNo LIKE ?`;
//             params.push(date, `%${fim}%`);
//         } else if (date) {
//             query += ` WHERE dp.sheduledDate = ?`;
//             params.push(date);
//         } else if (fim) {
//             query += ` WHERE sob.fimNo LIKE ?`;
//             params.push(`%${fim}%`);
//         }

//         const [rows] = await connection.execute(query, params);

//         // Sort rows by TimeSlot
//         rows.sort((a, b) => {
//             const timeSlotToValue = timeSlot => {
//                 if (!timeSlot) return Number.MAX_VALUE; // Handle null or undefined timeSlot by placing it at the end

//                 const [start] = timeSlot.split('-').map(t => t.trim()); // Extract start time
//                 const match = start.match(/(\d+)(AM|PM)/);
//                 if (!match) return Number.MAX_VALUE; // If format is unexpected, place it at the end

//                 const [_, hour, period] = match; // Destructure matched groups
//                 let h = parseInt(hour, 10);
//                 if (period === 'PM' && h !== 12) h += 12;
//                 if (period === 'AM' && h === 12) h = 0;
//                 return h;
//             };

//             return timeSlotToValue(a.timeSlot) - timeSlotToValue(b.timeSlot);
//         });

//         let id = 1;
//         let sNo = 1;
//         const fimNoSet = new Set();
//         const result = {};

//         for (const row of rows) {
//             // const prefix = getPrefix(row.fimNo);
//             const prefix = row.fimNo ? getPrefix(row.fimNo) : "";


//             if (!result[prefix]) {
//                 result[prefix] = [];
//             }

//             let contractEntry = result[prefix].find(entry => entry.ContractNo === row.contractNo);
//             if (!contractEntry) {
//                 contractEntry = {
//                     id: id++, // Generate id after sorting
//                     SNo: sNo++, // Generate SNo after sorting
//                     ContractNo: row.contractNo,
//                     KanbanDate: row.kanbanDate,
//                     SheduledDate: row.sheduledDate,
//                     TimeSlot: row.timeSlot,
//                     Duty: row.duty,
//                     Product: row.product,
//                     QtyStops: row.stop,
//                     Prefix: prefix
//                 };

//                 const [fimRows] = await connection.execute(`
//                     SELECT name FROM item_fim_id WHERE name LIKE ?`, [`${prefix}%`]);

//                 fimRows.forEach(fimRow => {
//                     const fimNoNumeric = fimRow.name.replace(prefix, '').trim();
//                     if (fimNoNumeric) {
//                         fimNoSet.add(fimNoNumeric);
//                         contractEntry[fimNoNumeric] = null;
//                     }
//                 });

//                 result[prefix].push(contractEntry);
//             }

//             if (row.fimNo) { // Check if fimNo is not null
//                 const fimNoMatch = row.fimNo.match(/[0-9.]+/);
//                 if (fimNoMatch) {
//                     const fimNoNumeric = fimNoMatch[0];
//                     if (fimNoSet.has(fimNoNumeric)) {
//                         contractEntry[fimNoNumeric] = row.plannedStatus || null;
//                     }
//                 }
//             }
//         }

//         const fimNoArray = Array.from(fimNoSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

//         const finalResult = Object.values(result).flatMap(contractEntries => {
//             return contractEntries.map(item => {
//                 const newItem = { ...item };
//                 fimNoArray.forEach(fimNo => {
//                     if (!(fimNo in newItem)) {
//                         newItem[fimNo] = null;
//                     }
//                 });
//                 return newItem;
//             });
//         });


//         // Remove FIMs that do not appear in any ContractNo
//         fimNoArray.forEach(fimNo => {
//             const isFIMUsed = finalResult.some(item => item[fimNo] !== null);

//             if (!isFIMUsed) {
//                 // Remove the FIM from all objects
//                 finalResult.forEach(item => {
//                     delete item[fimNo];
//                 });
//             }
//         });
//         // Initialize the counts object
//         const counts = {
//             P: {}, // To count "P"
//             PR: {} // To count "P/R"
//         };

//         fimNoArray.forEach(fimNo => {
//             counts.P[fimNo] = 0;  // Initialize count for "P"
//             counts.PR[fimNo] = 0; // Initialize count for "P/R"
//         });

//         // Count "P" and "P/R" occurrences
//         finalResult.forEach(item => {
//             fimNoArray.forEach(fimNo => {
//                 if (item[fimNo] === 'P') {
//                     counts.P[fimNo] += 1;
//                 }
//                 if (item[fimNo] === 'P/R') {
//                     counts.PR[fimNo] += 1;
//                 }
//             });
//         });

//         // Add Total CONTRACTS object
//         const summaryObject = { id: id++, Product: "TOTAL CONTRACTS" };
//         fimNoArray.forEach(fimNo => {
//             summaryObject[fimNo] = counts.P[fimNo] + counts.PR[fimNo];  // Add "P" and "P/R" counts together for total
//         });

//         // Add READY CONTRACTS object
//         const readyObject = { id: id++, Product: "READY CONTRACTS" };
//         fimNoArray.forEach(fimNo => {
//             readyObject[fimNo] = counts.PR[fimNo];  // Only "P/R" count for ready contracts
//         });


//         // Add PENDING CONTRACTS object
//         const pendingObject = { id: id++, Product: "PENDING CONTRACTS" };
//         fimNoArray.forEach(fimNo => {
//             pendingObject[fimNo] = (summaryObject[fimNo] || 0) - (readyObject[fimNo] || 0);
//         });

//         finalResult.push(summaryObject);
//         finalResult.push(readyObject);
//         finalResult.push(pendingObject);


//         // Remove FIMs with all null values
//         fimNoArray.forEach(fimNo => {
//             const isFIMNullEverywhere = finalResult.every(item => item[fimNo] === null);

//             if (isFIMNullEverywhere) {
//                 // Remove the FIM from all objects
//                 finalResult.forEach(item => {
//                     delete item[fimNo];
//                 });
//             }
//         });

//         return res.status(200).json({
//             success: true,
//             message: "Dispatch Plan list",
//             data: finalResult
//         });
//     } catch (err) {
//         return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
//     }
// };

exports.shipmentPlanning = async (conn, date, fim = '') => {
    try {
        let query = `
            SELECT  
                sob.id, sob.contractNo, sob.partNo, sob.plannedStatus, csl.boxNo, sob.fimNo, 
                csl_mst.duty, csl_mst.product, csl_mst.stop, dp.timeSlot, dp.id AS dispatchId, 
                DATE_FORMAT(dp.sheduledDate, '%d-%m-%Y') AS sheduledDate,
                DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
            FROM 
                dispatch_plan AS dp  
            INNER JOIN csl ON csl.contractNo = dp.contractNo
            LEFT JOIN sob ON sob.cslMstId = csl.cslMstId
            LEFT JOIN order_plannings op ON op.sobMstId = sob.sobMstId
            LEFT JOIN csl_mst ON sob.cslMstId = csl_mst.id
        `;
        const params = [];

        if (date && fim) {
            query += ` WHERE dp.sheduledDate = ? AND sob.fimNo LIKE ?`;
            params.push(date, `%${fim}%`);
        } else if (date) {
            query += ` WHERE dp.sheduledDate = ?`;
            params.push(date);
        } else if (fim) {
            query += ` WHERE sob.fimNo LIKE ?`;
            params.push(`%${fim}%`);
        }
        const [rows] = await conn.execute(query, params);

        // Sort rows by TimeSlot
        rows.sort((a, b) => {
            const timeSlotToValue = timeSlot => {
                if (!timeSlot) return Number.MAX_VALUE; // Handle null or undefined timeSlot by placing it at the end

                const [start] = timeSlot.split('-').map(t => t.trim()); // Extract start time
                const match = start.match(/(\d+)(AM|PM)/);
                if (!match) return Number.MAX_VALUE; // If format is unexpected, place it at the end

                const [_, hour, period] = match; // Destructure matched groups
                let h = parseInt(hour, 10);
                if (period === 'PM' && h !== 12) h += 12;
                if (period === 'AM' && h === 12) h = 0;
                return h;
            };

            return timeSlotToValue(a.timeSlot) - timeSlotToValue(b.timeSlot);
        });

        let id = 1;
        let sNo = 1;
        const fimNoSet = new Set();
        const result = {};

        for (const row of rows) {
            const prefix = row.fimNo ? getPrefix(row.fimNo) : "";
            if (!result[prefix]) {
                result[prefix] = [];
            }

            let contractEntry = result[prefix].find(entry => entry.ContractNo === row.contractNo);
            if (!contractEntry) {
                contractEntry = {
                    id: id++, // Generate id after sorting
                    SNo: sNo++, // Generate SNo after sorting
                    ContractNo: row.contractNo,
                    KanbanDate: row.kanbanDate,
                    SheduledDate: row.sheduledDate,
                    TimeSlot: row.timeSlot,
                    Duty: row.duty,
                    Product: row.product,
                    QtyStops: row.stop,
                    Prefix: prefix
                };

                const [fimRows] = await conn.execute(`
                    SELECT name FROM item_fim_id WHERE name LIKE ?`, [`${prefix}%`]);

                fimRows.forEach(fimRow => {
                    const fimNoNumeric = fimRow.name.replace(prefix, '').trim();
                    if (fimNoNumeric) {
                        fimNoSet.add(fimNoNumeric);
                        contractEntry[fimNoNumeric] = null;
                    }
                });

                result[prefix].push(contractEntry);
            }

            if (row.fimNo) { // Check if fimNo is not null
                const fimNoMatch = row.fimNo.match(/[0-9.]+/);
                if (fimNoMatch) {
                    const fimNoNumeric = fimNoMatch[0];
                    if (fimNoSet.has(fimNoNumeric)) {
                        contractEntry[fimNoNumeric] = row.plannedStatus || null;
                    }
                }
            }
        }
        const fimNoArray = Array.from(fimNoSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        const finalResult = Object.values(result).flatMap(contractEntries => {
            return contractEntries.map(item => {
                const newItem = { ...item };
                fimNoArray.forEach(fimNo => {
                    if (!(fimNo in newItem)) {
                        newItem[fimNo] = null;
                    }
                });
                return newItem;
            });
        });

        // Remove FIMs that do not appear in any ContractNo
        fimNoArray.forEach(fimNo => {
            const isFIMUsed = finalResult.some(item => item[fimNo] !== null);

            if (!isFIMUsed) {
                // Remove the FIM from all objects
                finalResult.forEach(item => {
                    delete item[fimNo];
                });
            }
        });
        // Initialize the counts object
        const counts = {
            P: {}, // To count "P"
            PR: {} // To count "P/R"
        };

        fimNoArray.forEach(fimNo => {
            counts.P[fimNo] = 0;  // Initialize count for "P"
            counts.PR[fimNo] = 0; // Initialize count for "P/R"
        });

        // Count "P" and "P/R" occurrences
        finalResult.forEach(item => {
            fimNoArray.forEach(fimNo => {
                if (item[fimNo] === 'P') {
                    counts.P[fimNo] += 1;
                }
                if (item[fimNo] === 'P/R') {
                    counts.PR[fimNo] += 1;
                }
            });
        });

        // Add Total CONTRACTS object
        const summaryObject = { id: id++, Product: "TOTAL CONTRACTS" };
        fimNoArray.forEach(fimNo => {
            summaryObject[fimNo] = counts.P[fimNo] + counts.PR[fimNo];  // Add "P" and "P/R" counts together for total
        });

        // Add READY CONTRACTS object
        const readyObject = { id: id++, Product: "READY CONTRACTS" };
        fimNoArray.forEach(fimNo => {
            readyObject[fimNo] = counts.PR[fimNo];  // Only "P/R" count for ready contracts
        });


        // Add PENDING CONTRACTS object
        const pendingObject = { id: id++, Product: "PENDING CONTRACTS" };
        fimNoArray.forEach(fimNo => {
            pendingObject[fimNo] = (summaryObject[fimNo] || 0) - (readyObject[fimNo] || 0);
        });

        finalResult.push(summaryObject);
        finalResult.push(readyObject);
        finalResult.push(pendingObject);


        // Remove FIMs with all null values
        fimNoArray.forEach(fimNo => {
            const isFIMNullEverywhere = finalResult.every(item => item[fimNo] === null);

            if (isFIMNullEverywhere) {
                // Remove the FIM from all objects
                finalResult.forEach(item => {
                    delete item[fimNo];
                });
            }
        });

        return finalResult;
    } catch (err) {
        throw err;
    }
};

exports.show = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const { date, fim = '' } = req.body;

        const shipmentData = await this.shipmentPlanning(conn, date, fim);

        return handleSuccessResponse(res, "Dispatch Plan list", shipmentData)
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

// function getPrefix(fimNo) {
//     const regex = /([a-zA-Z]+)/;
//     const match = fimNo.match(regex);
//     return match ? match[0] : null;
// }

function getPrefix(fimNo) {
    if (!fimNo) return "";  // Return an empty string instead of null to avoid errors
    const regex = /([a-zA-Z]+)/;
    const match = fimNo.match(regex);
    return match ? match[0] : "";
}



exports.deleteAll = async (req, res) => {
    try {
        const id = req.params.id;

        const [fRows] = await connection.execute(`SELECT id FROM dispatch_plan WHERE sheduledDate = ?`, [id]);

        if (fRows.length === 0) {
            throw new CustomError("Data not found i Given Date!", 404);
        }


        // Update npd record with dflag=1, deleted_at, and deleted_by
        const [DRows] = await connection.execute(
            `DELETE FROM dispatch_plan  WHERE sheduledDate = ?`,
            [id]
        );

        return res.status(200).json({ success: true, message: "Successfully deleted" });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};

//************************************             CREATE DELNOTE               *************************************************************//



// exports.getId = async (req, res) => {
//     try {

//         const [fRows] = await connection.execute('SELECT delNoteNo FROM del_note_mst ORDER BY id DESC', []);
//         let delNo = 'DNR1'; // Default delNoteNo if no records exist

//         if (fRows.length > 0) {
//             revNo = parseInt(fRows[0].revisionNo) + 1; // Increment revisionNo

//             const lastdelNoteNo = fRows[0].delNoteNo;
//             const numericPart = (lastdelNoteNo && lastdelNoteNo.match(/\d+/)) ? parseInt(lastdelNoteNo.match(/\d+/)[0]) : 0;
//             delNo = 'DNR' + (numericPart + 1);
//         }

//         return res.status(200).json({
//             delNoteNo: delNo
//         });

//     } catch (err) {
//         console.error(err);
//         return res.status(500).json({ success: false, message: err.message });
//     }
// };




// exports.uniqueId = async (req, res) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();

//     try {

//         const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'DelNote' });

//         await conn.commit();
//         return res.status(200).json({
//             id: uniqueNo,
//             digit: padStartNo
//         });
//     } catch (err) {
//         await conn.rollback();
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// };

exports.getId = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {

        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'DelNote' });

        await conn.commit();
        return res.status(200).json({
            delNoteNo: uniqueNo,
            digit: padStartNo
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.getContractPart = async (req, res) => {
    try {

        const disp = req.body;

        const query = `
            SELECT  id, contractNo	
            FROM dispatch_plan   
            WHERE  sheduledDate = ? AND  contractOrPart = 1`;

        const [rows] = await connection.execute(query, [disp.date]);

        if (rows.length >= 0) {


            return res.status(200).json({
                success: true,
                message: "Contract or Part list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}





// exports.openPo = async (req, res) => {
//     try {
//         const { excelId, customerId } = req.body;

//         if (!customerId) {
//             return res.status(400).json({ success: false, message: "Customer is required" });
//         }

//         // Optimized SQL
//         let query = `
//             SELECT 
//                 d.contractNo,
//                 d.id AS dispId,
//                 d.qty AS dispatchQty,
//                 d.excelId,
//                 DATE_FORMAT(d.sheduledDate, '%d-%m-%Y') AS sheduledDate,
//                 d.timeSlot AS timeslot,
//                 po.poNo,
//                 po.date AS poDate,
//                 po.id AS poId,
//                 poItem.Qty AS poQty,
//                 poItem.pendQty,
//                 poItem.id AS poItemId,
//                 poItem.PartNo AS itemCode,
//                 poItem.SchDate
//             FROM dispatch_plan d
//             INNER JOIN purchas_order_item AS poItem 
//                 ON poItem.PartNo = d.contractNo
//             INNER JOIN purchase_order AS po 
//                 ON po.id = poItem.purchase_order_id 
//             INNER JOIN (
//                 SELECT itemCode, id
//                 FROM (
//                     SELECT itemCode, id,
//                            ROW_NUMBER() OVER (PARTITION BY itemCode ORDER BY id DESC) AS rn
//                     FROM fg_stocks
//                     WHERE totQty > 0
//                 ) ranked
//                 WHERE rn = 1
//             ) AS fg ON fg.itemCode = poItem.PartNo
//             WHERE d.dflag = 0 
//                 AND po.customer = ? 
//                 AND d.contractOrPart = 0 
//                 AND poItem.pendQty > 0
//                AND  poItem.isShortCls = 0 
//         `;

//         const params = [customerId];

//         if (excelId) {
//             query += `
//                 AND d.excelId = ?
//                 GROUP BY d.id, poItem.id, poItem.SchDate
//                 ORDER BY poItem.SchDate ASC, poItem.id ASC
//             `;
//             params.push(excelId);
//         } else {
//             query += `
//                 ORDER BY poItem.SchDate ASC, poItem.id ASC
//             `;
//         }

//         const [rows] = await connection.execute(query, params);

//         let serial = 1;
//         let finalResults = [];

//         if (!excelId) {
//             // No excelId → list rows with qty = pendQty
//             finalResults = rows
//                 .filter(r => r.pendQty > 0)
//                 .map((row, i) => ({
//                     sNo: serial++,
//                     id: serial + 499,
//                     contractNo: row.contractNo,
//                     dispId: row.dispId,
//                     excelId: row.excelId,
//                     sheduledDate: row.sheduledDate,
//                     timeslot: row.timeslot,
//                     itemCode: row.itemCode,
//                     poNo: row.poNo,
//                     poId: row.poId,
//                     poQty: row.poQty,
//                     poItemId: row.poItemId,
//                     pendQty: row.pendQty,
//                     qty: row.pendQty
//                 }));
//         } else {
//             // With excelId → apply allocation logic
//             const grouped = rows.reduce((acc, row) => {
//                 const key = `${row.dispId}_${row.itemCode}`;
//                 if (!acc[key]) acc[key] = [];
//                 acc[key].push(row);
//                 return acc;
//             }, {});

//             for (const key in grouped) {
//                 const dispatchGroup = grouped[key];
//                 const baseRow = dispatchGroup[0];
//                 let remainingDispatchQty = baseRow.dispatchQty;

//                 for (const row of dispatchGroup) {
//                     if (remainingDispatchQty <= 0) break;

//                     const allocQty = Math.min(row.pendQty, remainingDispatchQty);

//                     if (allocQty > 0) {
//                         finalResults.push({
//                             sNo: serial,
//                             id: serial + 499,
//                             contractNo: row.contractNo,
//                             dispId: row.dispId,
//                             excelId: row.excelId,
//                             sheduledDate: row.sheduledDate,
//                             timeslot: row.timeslot,
//                             itemCode: row.itemCode,
//                             poNo: row.poNo,
//                             poId: row.poId,
//                             poQty: row.poQty,
//                             poItemId: row.poItemId,
//                             pendQty: row.pendQty,
//                             qty: allocQty
//                         });
//                         serial++;
//                         remainingDispatchQty -= allocQty;
//                     }
//                 }
//             }
//         }

//         return res.status(200).json({
//             success: true,
//             message: "Data retrieved successfully",
//             data: finalResults
//         });

//     } catch (err) {
//         return res.status(err.statusCode || 500).json({
//             success: false,
//             message: err.message || 'An error occurred'
//         });
//     }
// };

exports.openPo = async (req, res) => {
    try {
        const { excelId, customerId } = req.body;

        if (!customerId || !excelId) {
            return res.status(400).json({ success: false, message: "Customer and Excel ID are required" });
        }

        let query = `
            SELECT
                d.contractNo,
                d.id AS dispId,
                d.qty AS dispatchQty,
                d.excelId,
                DATE_FORMAT(d.sheduledDate, '%d-%m-%Y') AS sheduledDate,
                d.timeSlot AS timeslot,
                po.poNo,
                po.date AS poDate,
                po.id AS poId,
                poItem.Qty AS poQty,
                poItem.pendQty,
                poItem.id AS poItemId,
                poItem.PartNo AS itemCode,
                poItem.SchDate
            FROM dispatch_plan d
            INNER JOIN purchas_order_item AS poItem
                ON poItem.PartNo = d.contractNo
            INNER JOIN purchase_order AS po
                ON po.id = poItem.purchase_order_id
            WHERE d.dflag = 0
                AND po.customer = ?
                AND d.excelId = ?
                AND d.contractOrPart = 0
                AND poItem.pendQty > 0
                AND poItem.isShortCls = 0
                AND (
                    SELECT totQty
                    FROM fg_stocks fgs
                    WHERE fgs.itemCode = poItem.PartNo
                    ORDER BY fgs.id DESC
                    LIMIT 1
                ) > 0
            GROUP BY d.id, poItem.id, poItem.SchDate
            ORDER BY poItem.SchDate ASC, poItem.id ASC
        `;

        const params = [customerId, excelId];

        const [rows] = await connection.execute(query, params);

        let serial = 1;
        let finalResults = [];

        // Apply allocation logic
        const grouped = rows.reduce((acc, row) => {
            const key = `${row.dispId}_${row.itemCode}`;
            if (!acc[key]) acc[key] = [];
            acc[key].push(row);
            return acc;
        }, {});

        for (const key in grouped) {
            const dispatchGroup = grouped[key];
            const baseRow = dispatchGroup[0];
            let remainingDispatchQty = baseRow.dispatchQty;

            for (const row of dispatchGroup) {
                if (remainingDispatchQty <= 0) break;

                const allocQty = Math.min(row.pendQty, remainingDispatchQty);

                if (allocQty > 0) {
                    finalResults.push({
                        sNo: serial,
                        id: serial + 499,
                        contractNo: row.contractNo,
                        dispId: row.dispId,
                        excelId: row.excelId,
                        sheduledDate: row.sheduledDate,
                        timeslot: row.timeslot,
                        itemCode: row.itemCode,
                        poNo: row.poNo,
                        poId: row.poId,
                        poQty: row.poQty,
                        poItemId: row.poItemId,
                        pendQty: row.pendQty,
                        qty: allocQty
                    });
                    serial++;
                    remainingDispatchQty -= allocQty;
                }
            }
        }

        return res.status(200).json({
            success: true,
            message: "Data retrieved successfully",
            data: finalResults
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};

exports.delShow = async (req, res) => {
    try {
        const { customerId: custId, date, type, no = [] } = req.body;
        let errorFlag = 0;


        if (!date || !type || !custId) {
            return res.status(400).json({ success: false, message: "Date, Type, and Customer are required" });
        }

        const params = [custId, date, ...no];

        const query = `
            SELECT DISTINCT
                sob.cslMstId,
                sob.fimNo,
                1 AS qty,
                csl_mst.contractNo,
                csl_mst.duty,
                csl_mst.stop,
                csl_mst.type,
                disp.sheduledDate,
                po.poNo,
                poItem.PartNo,
                fg.totQty
            FROM sob
            INNER JOIN csl_mst ON csl_mst.id = sob.cslMstId
            INNER JOIN dispatch_plan AS disp ON csl_mst.contractNo = disp.contractNo
            INNER JOIN mrp_mst ON mrp_mst.sobMstId = sob.sobMstId
            LEFT JOIN purchas_Order_item AS poItem ON poItem.PartNo = CONCAT(csl_mst.contractNo, '-', sob.fimNo)
              AND poItem.pendQty > 0  AND poItem.isShortCls = 0 
            LEFT JOIN purchase_order AS po ON po.id = poItem.purchase_order_id AND po.customer = ?
            LEFT JOIN (
                SELECT fs1.*
                FROM fg_stocks fs1
                INNER JOIN (
                    SELECT itemCode, MAX(id) AS maxId
                    FROM fg_stocks
                    WHERE totQty > 0
                    GROUP BY itemCode
                ) fs2 ON fs1.itemCode = fs2.itemCode AND fs1.id = fs2.maxId
            ) AS fg ON fg.itemCode = poItem.PartNo
            WHERE disp.contractOrPart = 1 
              AND disp.sheduledDate = ?
              ${no.length > 0 ? `AND disp.contractNo IN (${no.map(() => '?').join(', ')})` : ''}
            ${type == 1 ? `GROUP BY csl_mst.contractNo, sob.fimNo` : ''}
        `;

        const [rows] = await connection.execute(query, params);

        const missingInfo = [];
        rows.forEach((row, index) => {
            row.sNo = index + 1;
            row.id = index + 1;

            // const isPoMissing = !row.poNo;
            // const isStockMissing = !row.totQty;
            // const isStockInsufficient = row.qty > (row.totQty || 0);

            // if (isStockMissing) {
            //     missingInfo.push(`Stock not found for contractNo: ${row.PartNo}`);
            //     row.errorFlag = 1;

            // } else if (isStockInsufficient) {
            //     const insufficientQty = row.qty - (row.totQty || 0);
            //     missingInfo.push(`Stock is insufficient for contractNo: ${row.contractNo}, fimNo: ${row.fimNo}, insufficient qty: ${insufficientQty}`);
            //     row.errorFlag = 1;

            // } else if (isPoMissing && isStockMissing) {
            //     missingInfo.push(`PO and Stock not found for contractNo: ${row.contractNo}, fimNo: ${row.fimNo}`);
            //     row.errorFlag = 1;

            // } else if (isPoMissing) {
            //     missingInfo.push(`PO not found for contractNo: ${row.contractNo}, fimNo: ${row.fimNo}`);
            //     row.errorFlag = 1;

            // }


            const isPoMissing = !row.poNo;
            const isStockMissing = !row.totQty;
            const isStockInsufficient = row.qty > (row.totQty || 0);

            // if (isPoMissing && isStockMissing) {
            //     missingInfo.push(`PO and Stock not found for contractNo: ${row.contractNo}, fimNo: ${row.fimNo}`);
            //     row.errorFlag = 1;

            // } else


            if (isPoMissing) {
                missingInfo.push(`PO not found for contractNo: ${row.contractNo}, fimNo: ${row.fimNo}`);
                row.errorFlag = 1;

            } else if (isStockMissing) {
                missingInfo.push(`Stock not found for PartNo: ${row.PartNo}`);
                row.errorFlag = 1;

            } else if (isStockInsufficient) {
                const insufficientQty = row.qty - (row.totQty || 0);
                missingInfo.push(`Stock is insufficient for contractNo: ${row.contractNo}, fimNo: ${row.fimNo}, insufficient qty: ${insufficientQty}`);
                row.errorFlag = 1;
            }


        });

        return res.status(200).json({
            success: true,
            message: missingInfo.length > 0 ? "Partial data with warnings" : "delShow list",
            warnings: missingInfo,
            data: rows
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || "An error occurred" });
    }
};







// exports.crtDelNote = async (req, res) => {
//     try {
//         const valData = req.body.selectedValue;
//         const {
//             delNoteNo, digit, customerId, isWareHouse, delDate = null, vehicleNo = null, deliveryDate, timeslot = null
//         } = req.body;

//         const createdBy = req.headers.username || 'admin';

//         if (!Array.isArray(valData)) {
//             throw new CustomError("Invalid request format. Expected an array for selectedValue.");
//         }
//         if (!delNoteNo || !deliveryDate) {
//             throw new CustomError("Missing required fields: delNoteNo or deliveryDate.");
//         }

//         //  Step 0: Duplicate check before insertion
//         for (const item of valData) {
//             const { poNo, contractNo } = item;

//             const checkQuery = `
//                 SELECT dn.id, gsi.id As gstId
//                 FROM del_note dn
//                 LEFT JOIN gstsalesinvoitem gsi 
//                     ON gsi.delDtlId = dn.id
//                 WHERE dn.poNo = ? 
//                   AND dn.contractNo = ?
//             `;
//             const [checkRows] = await connection.execute(checkQuery, [poNo, contractNo]);
//             // console.log("checkRows",checkRows)

//             if (checkRows.length > 0) {
//                 // If no matching join with gstsalesinvoitem → throw error
//                 const valid = checkRows.some(row => row.id && row.gstId == null);
//                 if (valid) {
//                     throw new CustomError(`Del Note already created for poNo: ${poNo} with contractNo/PartNo: ${contractNo}`);
//                 }
//             }
//         }

//         // Step 1: Insert into del_note_mst
//         const mstQuery = `
//             INSERT INTO del_note_mst (
//                 delNoteNo, digit,  customerId, isWareHouse, delDate,
//                 vehicleNo, deliveryDate, timeslot, createdBy
//             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//         `;
//         const mstValues = [
//             delNoteNo, digit, customerId, isWareHouse, delDate, vehicleNo, deliveryDate, timeslot, createdBy
//         ];
//         const [mstResult] = await connection.execute(mstQuery, mstValues);
//         const delMstId = mstResult.insertId;

//         // Step 2: Prepare batch insert
//         const delNoteValues = [];
//         const poUpd = [];

//         for (const item of valData) {
//             const { contractNo, fimNo = null, qty, shipmentQty = qty, duty = null, stop = null, type = null, poNo } = item;

//             delNoteValues.push([
//                 delNoteNo, poNo, contractNo, fimNo,
//                 qty, shipmentQty, duty, stop, type, delMstId
//             ]);

//             const part = fimNo != null ? `${contractNo}-${fimNo}` : contractNo;
//             poUpd.push([qty, poNo, part]);
//         }

//         // Step 3: Insert into del_note
//         const delNoteQuery = `
//             INSERT INTO del_note (
//                 delNoteNo, poNo, contractNo, fimNo, qty, shipmentQty,
//                 duty, stop, type, delMstId
//             ) VALUES ?
//         `;
//         await connection.query(delNoteQuery, [delNoteValues]);

//         // Step 4: Update purchase_order_item
//         const updatePoQuery = `
//             UPDATE purchas_order_item poItem
//             INNER JOIN purchase_order AS po ON po.id = poItem.purchase_order_id
//             SET poItem.qcFlag = 1, poItem.invQty = ?
//             WHERE poItem.PartNo = ? AND po.poNo = ?
//         `;
//         for (const [qty, poNo, part] of poUpd) {
//             await connection.execute(updatePoQuery, [qty, part, poNo]);
//         }

//         // Step 5: Update dispatch_plan flags
//         const dispIds = valData.map(item => item.dispId).filter(Boolean);
//         if (dispIds.length > 0) {
//             const updateDelQuery = `
//                 UPDATE dispatch_plan 
//                 SET dflag = 1  
//                 WHERE id IN (${dispIds.map(() => '?').join(',')})
//             `;
//             await connection.query(updateDelQuery, dispIds);
//         }

//         await updateDocCounter(connection, 'DelNote'); //Need to implement

//         return res.status(200).json({ success: true, message: "Data added successfully" });

//     } catch (err) {
//         return res.status(err.statusCode || 500).json({
//             success: false,
//             message: err.message || 'An error occurred'
//         });
//     }
// };


exports.crtDelNoteOld = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const valData = req.body.selectedValue;
        const {
            delNoteNo, digit, customerId, isWareHouse, delDate = null, vehicleNo = null, deliveryDate, timeslot = null
        } = req.body;

        const createdBy = req.headers.username || 'admin';

        if (!Array.isArray(valData)) {
            throw new CustomError("Invalid request format. Expected an array for selectedValue.");
        }
        if (!delNoteNo || !deliveryDate) {
            throw new CustomError("Missing required fields: delNoteNo or deliveryDate.");
        }

        //  Step 0: Duplicate check before insertion
        for (const item of valData) {
            const { poNo, contractNo } = item;

            const checkQuery = `
                SELECT dn.id, gsi.id As gstId
                FROM del_note dn
                LEFT JOIN gstsalesinvoitem gsi 
                    ON gsi.delDtlId = dn.id
                WHERE dn.poNo = ? 
                  AND dn.contractNo = ?
            `;
            const [checkRows] = await conn.execute(checkQuery, [poNo, contractNo]);
            // console.log("checkRows",checkRows)

            if (checkRows.length > 0) {
                // If no matching join with gstsalesinvoitem → throw error
                const valid = checkRows.some(row => row.id && row.gstId == null);
                if (valid) {
                    throw new CustomError(`Del Note already created for poNo: ${poNo} with contractNo/PartNo: ${contractNo}`);
                }
            }
        }

        // Step 1: Insert into del_note_mst
        const mstQuery = `
            INSERT INTO del_note_mst (
                delNoteNo, digit,  customerId, isWareHouse, delDate,
                vehicleNo, deliveryDate, timeslot, createdBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const mstValues = [
            delNoteNo, digit, customerId, isWareHouse, delDate, vehicleNo, deliveryDate, timeslot, createdBy
        ];
        const [mstResult] = await conn.execute(mstQuery, mstValues);
        const delMstId = mstResult.insertId;

        // Step 2: Prepare batch insert
        const delNoteValues = [];
        const poUpd = [];

        for (const item of valData) {
            const { contractNo, fimNo = null, qty, shipmentQty = qty, duty = null, stop = null, type = null, poNo } = item;

            delNoteValues.push([
                delNoteNo, poNo, contractNo, fimNo,
                qty, shipmentQty, duty, stop, type, delMstId
            ]);

            const part = fimNo != null ? `${contractNo}-${fimNo}` : contractNo;
            poUpd.push([qty, poNo, part]);
        }

        // Step 3: Insert into del_note
        const delNoteQuery = `
            INSERT INTO del_note (
                delNoteNo, poNo, contractNo, fimNo, qty, shipmentQty,
                duty, stop, type, delMstId
            ) VALUES ?
        `;
        await conn.query(delNoteQuery, [delNoteValues]);

        // Step 4: Update purchase_order_item
        const updatePoQuery = `
            UPDATE purchas_order_item poItem
            INNER JOIN purchase_order AS po ON po.id = poItem.purchase_order_id
            SET poItem.qcFlag = 1, poItem.invQty = ?
            WHERE poItem.PartNo = ? AND po.poNo = ?
        `;
        for (const [qty, poNo, part] of poUpd) {
            await conn.execute(updatePoQuery, [qty, part, poNo]);
        }

        // Step 5: Update dispatch_plan flags
        const dispIds = valData.map(item => item.dispId).filter(Boolean);
        if (dispIds.length > 0) {
            const updateDelQuery = `
                UPDATE dispatch_plan 
                SET dflag = 1  
                WHERE id IN (${dispIds.map(() => '?').join(',')})
            `;
            await conn.query(updateDelQuery, dispIds);
        }

        await updateDocCounter(conn, 'DelNote'); //Need to implement

        return res.status(200).json({ success: true, message: "Data added successfully" });

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.crtDelNote = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const valData = req.body.selectedValue;
        const {
            delNoteNo, digit, customerId, isWareHouse, delDate = null, vehicleNo = null, deliveryDate, timeslot = null
        } = req.body;

        const createdBy = req.headers.username || 'admin';

        if (!Array.isArray(valData)) {
            throw new CustomError("Invalid request format. Expected an array for selectedValue.");
        }
        if (!delNoteNo || !deliveryDate) {
            throw new CustomError("Missing required fields: delNoteNo or deliveryDate.");
        }

        // Step 0: Duplicate check before insertion (Executed in parallel)
        const checkPromises = valData.map(item => {
            const checkQuery = `
                SELECT dn.id, gsi.id As gstId
                FROM del_note dn
                LEFT JOIN gstsalesinvoitem gsi
                    ON gsi.delDtlId = dn.id
                WHERE dn.poNo = ?
                  AND dn.contractNo = ?
            `;
            return conn.execute(checkQuery, [item.poNo, item.contractNo])
                .then(([checkRows]) => ({ item, checkRows }));
        });

        const checkResults = await Promise.all(checkPromises);
        for (const { item, checkRows } of checkResults) {
            if (checkRows.length > 0) {
                const valid = checkRows.some(row => row.id && row.gstId == null);
                if (valid) {
                    throw new CustomError(`Del Note already created for poNo: ${item.poNo} with contractNo/PartNo: ${item.contractNo}`);
                }
            }
        }

        // Step 1: Insert into del_note_mst
        const mstQuery = `
            INSERT INTO del_note_mst (
                delNoteNo, digit,  customerId, isWareHouse, delDate,
                vehicleNo, deliveryDate, timeslot, createdBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const mstValues = [
            delNoteNo, digit, customerId, isWareHouse, delDate, vehicleNo, deliveryDate, timeslot, createdBy
        ];
        const [mstResult] = await conn.execute(mstQuery, mstValues);
        const delMstId = mstResult.insertId;

        // Step 2: Prepare batch insert
        const delNoteValues = [];
        const poUpd = [];

        for (const item of valData) {
            const { contractNo, fimNo = null, qty, shipmentQty = qty, duty = null, stop = null, type = null, poNo } = item;

            delNoteValues.push([
                delNoteNo, poNo, contractNo, fimNo,
                qty, shipmentQty, duty, stop, type, delMstId
            ]);

            const part = fimNo != null ? `${contractNo}-${fimNo}` : contractNo;
            poUpd.push([qty, poNo, part]);
        }

        // Step 3: Insert into del_note
        const delNoteQuery = `
            INSERT INTO del_note (
                delNoteNo, poNo, contractNo, fimNo, qty, shipmentQty,
                duty, stop, type, delMstId
            ) VALUES ?
        `;
        await conn.query(delNoteQuery, [delNoteValues]);

        // Step 4: Update purchase_order_item (Executed in parallel)
        const updatePoQuery = `
            UPDATE purchas_order_item poItem
            INNER JOIN purchase_order AS po ON po.id = poItem.purchase_order_id
            SET poItem.qcFlag = 1, poItem.invQty = ?
            WHERE poItem.PartNo = ? AND po.poNo = ?
        `;
        await Promise.all(poUpd.map(([qty, poNo, part]) => conn.execute(updatePoQuery, [qty, part, poNo])));

        // Step 5: Update dispatch_plan flags
        const dispIds = valData.map(item => item.dispId).filter(Boolean);
        if (dispIds.length > 0) {
            const updateDelQuery = `
                UPDATE dispatch_plan
                SET dflag = 1
                WHERE id IN (${dispIds.map(() => '?').join(',')})
            `;
            await conn.query(updateDelQuery, dispIds);
        }

        // Step 6: Update document counter
        await updateDocCounter(conn, 'DelNote', { docNo: delNoteNo });

        await conn.commit();
        return res.status(200).json({ success: true, message: "Data added successfully" });

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.delNoteShow = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body;

        let query = `
      SELECT  
        del_note_mst.*,  
        DATE_FORMAT(del_note_mst.deliveryDate, '%d-%m-%Y') as deliveryDate
      FROM del_note_mst
      WHERE dflag = 0
    `;

        const params = [];

        // ✅ Add date filter only if fromDate & toDate are provided
        if (fromDate && toDate) {
            query += ` AND del_note_mst.deliveryDate BETWEEN ? AND ?`;
            params.push(fromDate, toDate);
        } else if (fromDate) {
            query += ` AND del_note_mst.deliveryDate >= ?`;
            params.push(fromDate);
        } else if (toDate) {
            query += ` AND del_note_mst.deliveryDate <= ?`;
            params.push(toDate);
        }

        // ✅ Order by deliveryDate (optional)
        query += ` ORDER BY del_note_mst.deliveryDate DESC`;

        const [rows] = await connection.execute(query, params);

        // ✅ Handle and format response
        if (rows.length >= 0) {
            rows.forEach((row, index) => {
                row.sNo = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "DelNote Mst list",
                data: rows,
            });
        }
    } catch (err) {
        return res
            .status(err.statusCode || 500)
            .json({ success: false, message: err.message || "An error occurred" });
    }
};




exports.eachDelNoteDtl = async (req, res) => {
    try {
        const delNo = req.body.delNo;

        const query = `
            SELECT  
                dn.*, 
                COALESCE(i1.id, i2.id) AS itemId
            FROM del_note dn
             LEFT JOIN items i1 ON i1.itemCode = dn.contractNo  
             LEFT JOIN items i2 ON i2.itemCode = CONCAT(dn.contractNo, '-', dn.fimNo) 
            WHERE dn.delNoteNo = ? AND dn.dflag = 0`;

        const [rows] = await connection.execute(query, [delNo]);

        if (rows.length > 0) { // Check if data exists
            rows.forEach((row, index) => {
                row.sNo = index + 1; // Add serial number
            });

            return res.status(200).json({
                success: true,
                message: "DelNote list",
                data: rows
            });
        } else {
            return res.status(404).json({
                success: false,
                message: "No records found"
            });
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};


exports.delete = async (req, res) => {
    try {
        const id = req.params.id;

        // Step 1: Check if the main record exists
        const [fRows] = await connection.execute(
            `SELECT * FROM del_note_mst WHERE id = ?`,
            [id]
        );

        if (fRows.length === 0) {
            throw new CustomError("Data not found!", 404);
        }

        // Step 2: Check if this id is referenced in gstsalesinvoitem
        const [invoiceRows] = await connection.execute(
            `SELECT id FROM gstsalesinvoitem WHERE delMstId = ?`,
            [id]
        );

        if (invoiceRows.length > 0) {
            throw new CustomError("Invoice Generated. Deletion not allowed.", 400);
        }

        // // Step 3: Delete related records from del_note
        // await connection.execute(
        //     `DELETE FROM del_note WHERE delMstId = ?`,
        //     [id]
        // );

        // Step 4: Delete from del_note_mst
        await connection.execute(
            `DELETE FROM del_note_mst WHERE id = ?`,
            [id]
        );

        await docNoReset(connection, req, { docType: 'DelNote', table: 'del_note_mst', col: 'digit' });


        return res.status(200).json({
            success: true,
            message: "Successfully deleted"
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "An error occurred"
        });
    }
};




exports.invoiceClick = async (req, res) => {
    try {
        const id = req.params.id;

        const [fRows] = await connection.execute(`SELECT * FROM del_note_mst WHERE id = ?`, [id]);

        if (fRows.length === 0) {
            throw new CustomError("data not found!", 404);
        }

        const delNoteNo = fRows[0].delNoteNo; // Accessing the delNoteNo property of the first row

        // Update npd record with dflag=1, deleted_at, and deleted_by
        const [DRows] = await connection.execute(
            `UPDATE del_note_mst SET status = ? WHERE id = ?`,
            ['Processing', id]
        );

        // Update del_note records with dflag=1 where delNoteNo matches
        // const [DrevRows] = await connection.execute(`UPDATE del_note SET dflag=1 WHERE delNoteNo = ?`, [delNoteNo]);

        return res.status(200).json({ success: true, message: "Successfully Updated" });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};



// *****************************               Qc Approval                **************************************** //


exports.qcApprove = async (req, res) => {

    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const qltyData = req.body.qcData;
        const delNo = req.body.delNote;
        let user = req.headers.username;


        for (const item of qltyData) {

            // Update del_note table
            const updateQuery = `UPDATE del_note SET accQty = ?, rejQty = ? WHERE id = ?`;
            const updValues = [item.accQty, item.rejQty, item.id];
            await conn.execute(updateQuery, updValues);


            if (item.itemId != null) {
                // //console.log("item", item.itemId);

                const [itemData] = await conn.execute(
                    `SELECT id, itemCode FROM items WHERE id = ?`,
                    [item.itemId]
                );

                const itemCode = itemData[0].itemCode;

                // Update Qc
                const updatepo = `
                    UPDATE purchas_order_item poItem
                    INNER JOIN purchase_order AS po ON po.id = poItem.purchase_order_id
                    SET poItem.qcFlag = 1, poItem.invQty = ?
                    WHERE poItem.PartNo = ? AND po.poNo = ?
                `;

                const poValues = [item.accQty, itemCode, item.poNo];
                // //console.log("poValues", poValues);

                await conn.execute(updatepo, poValues);

            }
        }

        // Update del_note table
        const updateQc = `UPDATE del_note_mst SET status = 'Qc Approved', approvedBy = ? WHERE delNoteNo = ?`;
        const qcValues = [user, delNo];
        // //console.log("qcValues", qcValues);
        await conn.execute(updateQc, qcValues)


        // return res.status(200).json({ success: true, message: "Successfully Updated" });

        await conn.commit();
        return handleSuccessResponse(res, "Qc Updated");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.sendMail = async (req, res) => {
    try {
        const emails = req.body.email;
        const cName = req.body.cName;
        const type = 'Dispatch';

        const emailList = emails.split(',').map(email => email.trim());

        const htmlContent = `
            <h2 style="font-weight: bold;">${type} Order</h2>
            <p>from ${cName} Customer </p>
        `;

        await Promise.all(emailList.map(to =>
            sendEmail({
                to,
                subject: `${type} Order`,
                cc: to,
                htmlContent,
                text: `Attached is your ${type} Order.`,
                attachments: [],
                type // pass to email sender
            })
        ));

        return res.status(200).json({
            success: true,
            message: "Email Sent Successfully",
        });
    } catch (error) {
        console.error('Error sending email:', error);
        return res.status(500).send('Error sending email');
    }
};


//old
// exports.delNoteVerification = async (req, res) => {
//     try {
//         const { delID } = req.query;

//         let rows = []
//         if (delID) {
//             [rows] = await connection.execute(`
//                 SELECT ROW_NUMBER() OVER (ORDER BY g.id) AS sNo, g.id, d.contractNo, d.delNoteNo, d.fimNo, d.type, d.duty, d.stop,  
//                     CASE
//                         WHEN g.delStatus = 1 THEN 1 
//                         ELSE 0 
//                     END AS status
//                 FROM gstsalesinvoitem g
//                 INNER JOIN del_note d ON d.id = g.delDtlId
//                 WHERE g.gstsalesinvo_id = ? AND g.delStatus = ?
//             `, [delID, 0]);
//         } else {
//             [rows] = await connection.execute(`
//                 SELECT ROW_NUMBER() OVER (ORDER BY g.id) AS sNo, g.id, g.invNo, DATE_FORMAT(g.date, '%d-%m-%Y') AS invDate, g.vechileNO, g.addedBy, g.custPoNo, gsi.poNo, 
//                 CASE 
//                     WHEN gsi.delStatus = 0 THEN 'Pending'
//                     WHEN gsi.delStatus = 1 THEN 'Completed'
//                     ELSE 'Unknown'
//                 END AS status
//                 FROM gstsalesinvo g
//                 INNER JOIN gstsalesinvoitem gsi ON g.id = gsi.gstsalesinvo_id

//                 WHERE g.delStatus = 0 AND g.dflag = 0
//                 GROUP BY g.id
//             `, []);
//         }

//         return handleSuccessResponse(res, "DelNote Verification list", rows);
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// }
exports.delNoteVerification = async (req, res) => {
    try {
        const { delID } = req.query;

        let rows = []
        if (delID) {
            [rows] = await connection.execute(`
               SELECT 
                    ROW_NUMBER() OVER (ORDER BY d.id) AS sNo,
                    d.id AS delDtlId,
                    dm.id AS delMstId,
                    dm.delNoteNo,
                    d.poNo,
                    d.contractNo,
                    d.fimNo,
                    d.qty,
                    d.type,
                    d.duty,
                    d.stop,
                    gsi.id,
                    gsi.gstsalesinvo_id,
                    gst.invNo,
                    DATE_FORMAT(gst.date, '%d-%m-%Y') AS invDate,
                    CASE 
                        WHEN gsi.delStatus = 1 THEN 1 
                        ELSE 0 
                    END AS status
                FROM del_note_mst dm
                INNER JOIN del_note d ON dm.id = d.delMstId
                INNER JOIN gstsalesinvoitem gsi ON gsi.delDtlId = d.id
                INNER JOIN gstsalesinvo gst ON gst.id = gsi.gstsalesinvo_id
                WHERE dm.id = ?
                ORDER BY d.id;
            `, [delID]);
        } else {
            [rows] = await connection.execute(`
                SELECT 
                    ROW_NUMBER() OVER (ORDER BY dnm.id) AS sNo,
                    dnm.id,
                    dnm.delNoteNo,
                    dnm.vehicleNo,
                    DATE_FORMAT(dnm.deliveryDate, '%d-%m-%Y') AS deliveryDate,
                    dnm.customerId,
                    c.cName,
                    c.cCode,
                    dnm.createdBy,
                    CASE 
                        WHEN MIN(gsi.delStatus) = 0 THEN 'Pending'
                        ELSE 'Completed'
                    END AS status
                FROM del_note_mst dnm
                INNER JOIN gstsalesinvoitem gsi ON dnm.id = gsi.delMstId
                INNER JOIN customer c ON c.id = dnm.customerId
                WHERE dnm.dflag = 0
                GROUP BY 
                    dnm.id, dnm.delNoteNo, dnm.vehicleNo, dnm.deliveryDate, 
                    dnm.customerId, dnm.createdBy, c.cName, c.cCode
                    HAVING MIN(gsi.delStatus) = 0
                ORDER BY dnm.id;
            `);
        }

        return handleSuccessResponse(res, "DelNote Verification list", rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};




exports.getCompletedDelNote = async (req, res) => {
    try {
        const { type, id } = req.query;

        let gstQuery = `
            SELECT g.id, g.invNo, DATE_FORMAT(g.date, '%d-%m-%Y') AS invDate, g.vechileNO, g.addedBy, g.custPoNo
            FROM gstsalesinvo g
            WHERE delStatus = 1 AND g.dflag = 0
        `;
        let params = [];

        switch (type) {
            case 'first':
                gstQuery += ` ORDER BY g.id ASC LIMIT 1`;
                break;
            case 'last':
                gstQuery += ` ORDER BY g.id DESC LIMIT 1`;
                break;
            case 'forward':
                gstQuery += ` AND g.id > ? ORDER BY g.id ASC LIMIT 1`;
                params = [id];
                break;
            case 'reverse':
                gstQuery += ` AND g.id < ? ORDER BY g.id DESC LIMIT 1`;
                params = [id];
                break;
        }
        const [rows] = await connection.execute(gstQuery, params);

        const [delItems] = await connection.execute(`
            SELECT d.id, d.contractNo, d.delNoteNo, d.fimNo, d.type, d.duty, d.stop
            FROM gstsalesinvoitem g
            LEFT JOIN del_note d ON d.id = g.delDtlId
            WHERE g.gstsalesinvo_id = ?
        `, [rows[0]?.id || 0]);

        return res.status(200).json({
            success: true,
            delDetails: rows[0],
            delItems
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const MISreport = async (delNoteIDs) => {
    try {
        const placeholders = delNoteIDs.map(() => '?').join(',');

        const [delItems] = await connection.execute(`
            SELECT ROW_NUMBER() OVER (ORDER BY gi.id) AS sNo, g.invNo, DATE_FORMAT(g.date, '%d-%m-%Y') AS invDate, 
                g.vechileNO, c.cCode as custCode, gi.partNo, gi.partName, gi.uom, gi.invQty, po.poNo,  DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate
            FROM gstsalesinvoitem gi
            INNER JOIN gstsalesinvo g ON g.id = gi.gstsalesinvo_id
            INNER JOIN purchase_order po ON po.id = gi.poId
            LEFT JOIN del_note d ON d.id = gi.delDtlId
            LEFT JOIN customer c ON c.id = g.custName
            WHERE gi.id IN (${placeholders})
        `, delNoteIDs);

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        const borderStyle = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' }
        };

        // Define worksheet columns (which automatically creates headers)
        worksheet.columns = [
            { header: 'Sl NO', key: 'sNo', width: 10 },
            { header: 'INV NO', key: 'invNo', width: 20 },
            { header: 'INV DATE', key: 'invDate', width: 15 },
            { header: 'VEHICLE NO', key: 'vechileNO', width: 15 },
            { header: 'CUST CODE', key: 'custCode', width: 20 },
            { header: 'PART NO', key: 'partNo', width: 25 },
            { header: 'PART NAME', key: 'partName', width: 25 },
            { header: 'UOM', key: 'uom', width: 15 },
            { header: 'INV QTY', key: 'invQty', width: 15 },
            { header: 'PO NO', key: 'poNo', width: 20 },
            { header: 'PO DATE', key: 'poDate', width: 15 },

        ];

        // Style Header Row (already created by `worksheet.columns`)
        worksheet.getRow(1).font = { bold: true, size: 12 };
        worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).eachCell(cell => {
            cell.border = borderStyle;
        });

        // Add Data Rows
        delItems.forEach(row => {
            const dataRow = worksheet.addRow([
                row.sNo, row.invNo, row.invDate, row.vechileNO, row.custCode,
                row.partNo, row.partName, row.uom, row.invQty, row.poNo, row.poDate
            ]);

            dataRow.eachCell(cell => {
                cell.border = borderStyle;
                cell.alignment = { horizontal: 'center', vertical: 'middle' }; // Center align
            });
        });

        return await workbook.xlsx.writeBuffer();
    } catch (err) {
        throw err;
    }
};


//backup deployed
// exports.approveDelNote = async (req, res) => {
//     try {
//         const { delNoteIDs, endTime } = req.body; 
//         const type = 'Dispatch';

//         if (!Array.isArray(delNoteIDs) || delNoteIDs.length === 0) {
//             throw new CustomError('Invoice IDs are required', 400);
//         }
//         if (!endTime) {
//             throw new CustomError('endTime is required', 400);
//         }

//         // Get Customer Details
//         const [customerResult] = await connection.execute(`
//             SELECT c.id, c.email, gi.partNo, d.contractNo, d.fimNo
//             FROM gstsalesinvoitem gi
//                 INNER JOIN gstsalesinvo g ON g.id = gi.gstsalesinvo_id
//                 INNER JOIN customer c ON c.id = g.custName
//                 INNER JOIN del_note d ON d.id = gi.delDtlId
//             WHERE gi.id IN (${delNoteIDs.map(() => '?').join(',')})
//         `, delNoteIDs);

//         const customer = customerResult[0];
//         if (!customer || !customer.email) {
//             throw new CustomError('Customer email not found', 404);
//         }

//         // Email Content
//         const subject = 'Dispatch Approved Notification';
//         const htmlContent = `
//             <!DOCTYPE html>
//             <html>
//             <head><meta charset="UTF-8"></head>
//             <body>
//                 <p>
//                     Dear Sir/Madam,<br><br>
//                     Please find attached the MIS report for the approved dispatch order.<br><br>
//                     <strong>Note:</strong> This is an auto-generated email. Please do not reply.<br><br>
//                     Best Regards,<br>
//                     <strong>MALLIK ENGINEERING (INDIA) PVT. LTD.</strong>
//                 </p>
//             </body>
//             </html>
//         `;

//         // Generate Attachment
//         const attachmentBuffer = await MISreport(delNoteIDs);
//         const attachment = [{
//             filename: 'MIS-report.xlsx',
//             content: attachmentBuffer
//         }];

//         // Send Email
//         await sendEmail({
//             to: customer.email,
//             subject,
//             cc: null,
//             htmlContent,
//             text: null,
//             attachments: attachment,
//             type
//         });

//         // ✅ Use frontend's endTime directly
//         await connection.execute(`
//             UPDATE gstsalesinvoitem
//             SET delStatus = 1, endTime = ?
//             WHERE id IN (${delNoteIDs.map(() => '?').join(',')})
//         `, [endTime, ...delNoteIDs]);

//         // Update dispatch by part number if contractNo and fimNo exist
//         for (const row of customerResult) {
//             if (row.contractNo && row.fimNo) {
//                 await updateDispatchByPartNo(row.contractNo, row.fimNo);
//             }
//         }
//         return handleSuccessResponse(res, 'Del_Note approved successfully');
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };

//recently deployed emergency deploy this (mis report first then update high load issues)
// exports.approveDelNote = async (req, res) => {
//     const conn = await connection.getConnection();
//     try {
//         await conn.beginTransaction();
//         const { delNoteIDs, endTime } = req.body;
//         const type = 'Dispatch';

//         if (!Array.isArray(delNoteIDs) || delNoteIDs.length === 0) {
//             throw new CustomError('Invoice IDs are required', 400);
//         }
//         if (!endTime) {
//             throw new CustomError('endTime is required', 400);
//         }

//         // Get Customer Details
//         const [customerResult] = await conn.execute(`
//             SELECT c.id, c.email, gi.partNo, d.contractNo, d.fimNo
//             FROM gstsalesinvoitem gi
//                 INNER JOIN gstsalesinvo g ON g.id = gi.gstsalesinvo_id
//                 INNER JOIN customer c ON c.id = g.custName
//                 INNER JOIN del_note d ON d.id = gi.delDtlId
//             WHERE gi.id IN (${delNoteIDs.map(() => '?').join(',')})
//         `, delNoteIDs);

//         const customer = customerResult[0];
//         if (!customer || !customer.email) {
//             throw new CustomError('Customer email not found', 404);
//         }

//         // Email Content
//         const subject = 'Dispatch Approved Notification';
//         const htmlContent = `
//             <!DOCTYPE html>
//             <html>
//             <head><meta charset="UTF-8"></head>
//             <body>
//                 <p>
//                     Dear Sir/Madam,<br><br>
//                     Please find attached the MIS report for the approved dispatch order.<br><br>
//                     <strong>Note:</strong> This is an auto-generated email. Please do not reply.<br><br>
//                     Best Regards,<br>
//                     <strong>MALLIK ENGINEERING (INDIA) PVT. LTD.</strong>
//                 </p>
//             </body>
//             </html>
//         `;

//         // Generate Attachment
//         const attachmentBuffer = await MISreport(delNoteIDs);
//         const attachment = [{
//             filename: 'MIS-report.xlsx',
//             content: attachmentBuffer
//         }];

//         // Send Email
//         await sendEmail({
//             to: customer.email,
//             subject,
//             cc: null,
//             htmlContent,
//             text: null,
//             attachments: attachment,
//             type
//         });

//         // ✅ Use frontend's endTime directly
//         await conn.execute(`
//             UPDATE gstsalesinvoitem
//             SET delStatus = 1, endTime = ?
//             WHERE id IN (${delNoteIDs.map(() => '?').join(',')})
//         `, [endTime, ...delNoteIDs]);

//         const grouped = {};

//         for (const row of customerResult) {
//             if (!row.contractNo || !row.fimNo) continue;

//             if (!grouped[row.contractNo]) {
//                 grouped[row.contractNo] = new Set();
//             }
//             grouped[row.contractNo].add(row.fimNo);
//         }

//         // NOW CALL updateDispatch ONLY ONCE per contract
//         for (const contractNo of Object.keys(grouped)) {
//             const fimList = Array.from(grouped[contractNo]);
//             await updateDispatchByPartNo(conn, contractNo, fimList);
//         }

//         await conn.commit();
//         return handleSuccessResponse(res, 'Del_Note approved successfully');
//     } catch (err) {
//         await conn.rollback();
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// };

//first inside transaction all updates then mis report calls after commit 
exports.approveDelNote = async (req, res) => {
    const conn = await connection.getConnection();
    let customerEmail = null;
    let delNoteIdsCopy = [];
    let customerResult = [];

    try {
        const { delNoteIDs, endTime } = req.body;
        const type = 'Dispatch';

        if (!Array.isArray(delNoteIDs) || delNoteIDs.length === 0) {
            throw new CustomError('Invoice IDs are required', 400);
        }
        if (!endTime) {
            throw new CustomError('endTime is required', 400);
        }

        delNoteIdsCopy = delNoteIDs;

        // 🔹 START TRANSACTION
        await conn.beginTransaction();

        // 1️⃣ Fetch data (FAST)
        const [rows] = await conn.execute(`
            SELECT c.email, d.contractNo, d.fimNo
            FROM gstsalesinvoitem gi
            JOIN gstsalesinvo g ON g.id = gi.gstsalesinvo_id
            JOIN customer c ON c.id = g.custName
            JOIN del_note d ON d.id = gi.delDtlId
            WHERE gi.id IN (${delNoteIDs.map(() => '?').join(',')})
        `, delNoteIDs);

        customerResult = rows;

        if (!rows.length || !rows[0].email) {
            throw new CustomError('Customer email not found', 404);
        }

        customerEmail = rows[0].email;

        // 2️⃣ Update invoice items
        await conn.execute(`
            UPDATE gstsalesinvoitem
            SET delStatus = 1, endTime = ?
            WHERE id IN (${delNoteIDs.map(() => '?').join(',')})
        `, [endTime, ...delNoteIDs]);

        // 3️⃣ Group contract → FIMs
        const grouped = {};
        for (const row of rows) {
            if (!row.contractNo || !row.fimNo) continue;
            if (!grouped[row.contractNo]) {
                grouped[row.contractNo] = new Set();
            }
            grouped[row.contractNo].add(row.fimNo);
        }

        // 4️⃣ Update dispatch tables (FAST DB ONLY)
        for (const contractNo of Object.keys(grouped)) {
            await updateDispatchByPartNo(
                conn,
                contractNo,
                Array.from(grouped[contractNo])
            );
        }

        // ✅ COMMIT QUICKLY
        await conn.commit();

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }

    // =====================================================
    //  EVERYTHING BELOW IS OUTSIDE TRANSACTION
    // =====================================================

    try {
        const attachmentBuffer = await MISreport(delNoteIdsCopy);

        await sendEmail({
            to: customerEmail,
            subject: 'Dispatch Approved Notification',
            cc: null,
            htmlContent: `<!DOCTYPE html>
             <html>
             <head><meta charset="UTF-8"></head>
             <body>
                 <p>
                     Dear Sir/Madam,<br><br>
                     Please find attached the MIS report for the approved dispatch order.<br><br>
                     <strong>Note:</strong> This is an auto-generated email. Please do not reply.<br><br>
                    Best Regards,<br>
                    <strong>MALLIK ENGINEERING (INDIA) PVT. LTD.</strong>
                 </p>
            </body>
            </html>` ,
            text: null,
            attachments: [{
                filename: 'MIS-report.xlsx',
                content: attachmentBuffer
            }],
            type: 'Dispatch'
        });
    } catch (mailErr) {
        // ❗ DB is already committed — safe
        dispatchLog(`EMAIL FAILED | ${mailErr.message}`);
    }

    return handleSuccessResponse(res, 'Del_Note approved successfully');
};



//old deployed
// const updateDispatchByPartNo = async (conn,contract, fimList) => {
//     try {
//         // Ensure fimList is an array
//         if (!Array.isArray(fimList)) {
//             fimList = fimList ? [fimList] : [];
//         }

//         if (fimList.length === 0) {
//             throw new Error("fimList is empty, cannot update.");
//         }

//         // 1) Update all sob rows in one query
//         await conn.execute(`
//             UPDATE sob
//             SET plannedStatus = 'P/R/D'
//             WHERE contractNo = ? AND fimNo IN (${fimList.map(() => '?').join(',')})
//         `, [contract, ...fimList]);

//         // 2) Build dynamic SQL for shipment_details (update multiple columns)
//         const columnsToUpdate = fimList.map(f => f.substring(f.indexOf('FIM'))); // Extract FIMxx
//         const setClause = columnsToUpdate.map(col => `\`${col}\` = 'P/R/D'`).join(', ');

//         await conn.execute(`
//             UPDATE shipment_details 
//             SET ${setClause}
//             WHERE ContractNo = ?
//         `, [contract]);

//         await connection.execute(`
//             UPDATE shipment_mst sm
//             JOIN shipment_details sd ON sm.id = sd.mstId
//             SET sm.viewFlag = 1
//             WHERE sd.ContractNo = ?
//         `, [contract]);

//     } catch (err) {
//         console.error("Error in updateDispatchByPartNo:", err);
//         throw err;
//     }
// };



function dispatchLog(message) {
    const time = new Date().toISOString().replace("T", " ").split(".")[0];
    const logLine = `[${time}] ${message}\n`;

    fs.appendFile(dispatchLogPath, logLine, err => {
        if (err) {
            console.error("Failed to write dispatch log:", err);
        }
    });
}

// const updateDispatchByPartNo = async (conn, contract, fimNo) => {
//     try {
//         // console.log("---- UPDATE DISPATCH START ----");
//         // console.log("ContractNo Received:", contract);
//         // console.log("FIM No Received:", fimNo);

//         // Convert single fimNo -> array
//         let fimList = Array.isArray(fimNo) ? fimNo : [fimNo];
//         // console.log("FIM List:", fimList);

//         // Extract real FIM column names for shipment_details
//         const columnsToUpdate = fimList
//             .map(f => {
//                 const match = f.match(/FIM\d+(\.\d+)?/);
//                 return match ? match[0] : null;
//             })
//             .filter(Boolean);

//         // console.log("Columns to update in shipment_details:", columnsToUpdate);

//         if (columnsToUpdate.length === 0) {
//             console.log("No valid FIM columns found, skipping updates.");
//             return;
//         }

//         // ---- 1. Update SOB table ----
//         // console.log("Updating SOB table...");
//         // console.log("SOB Update Query FIM values:", fimList);

//         await conn.execute(`
//             UPDATE sob
//             SET plannedStatus = 'P/R/D'
//             WHERE contractNo = ? AND fimNo IN (${fimList.map(() => '?').join(',')})
//         `, [contract, ...fimList]);

//         // ---- 2. Update shipment_details ----
//         const setClause = columnsToUpdate
//             .map(col => `\`${col}\` = 'P/R/D'`)
//             .join(', ');

//         // console.log("Shipment Details SET Clause:", setClause);

//         if (setClause.trim()) {
//             // console.log("Updating shipment_details...");
//             await conn.execute(`
//                 UPDATE shipment_details
//                 SET ${setClause}
//                 WHERE ContractNo = ?
//             `, [contract]);
//         }

//         // ---- 3. Update shipment_mst ----
//         // console.log("Updating shipment_mst...");
//         await conn.execute(`
//             UPDATE shipment_mst sm
//             JOIN shipment_details sd ON sm.id = sd.mstId
//             SET sm.viewFlag = 1
//             WHERE sd.ContractNo = ?
//         `, [contract]);

//         // console.log("---- UPDATE DISPATCH END ----");

//     } catch (err) {
//         console.error("Error in updateDispatchByPartNo:", err);
//         throw err;
//     }
// };


//recent deployed
// const updateDispatchByPartNo = async (conn, contract, fimNo) => {
//     try {
//         const fimList = Array.isArray(fimNo) ? fimNo : [fimNo];

//         dispatchLog("UPDATE DISPATCH START");
//         dispatchLog(
//             `ContractNo & FIMs Received: ${contract} - [${fimList.join(", ")}]`
//         );

//         const columnsToUpdate = fimList
//             .map(f => {
//                 const match = f.match(/FIM\d+(\.\d+)?/);
//                 return match ? match[0] : null;
//             })
//             .filter(Boolean);

//         if (columnsToUpdate.length === 0) {
//             dispatchLog(
//                 `No valid FIM columns found | ContractNo: ${contract}`
//             );
//             return;
//         }

//         await conn.execute(`
//             UPDATE sob
//             SET plannedStatus = 'P/R/D'
//             WHERE contractNo = ? AND fimNo IN (${fimList.map(() => '?').join(',')})
//         `, [contract, ...fimList]);

//         dispatchLog(`SOB Updated FIMs: [${fimList.join(", ")}]`);

//         const setClause = columnsToUpdate
//             .map(col => `\`${col}\`='P/R/D'`)
//             .join(", ");

//         dispatchLog(`Shipment Details SET Clause: ${setClause}`);

//         await conn.execute(`
//             UPDATE shipment_details
//             SET ${setClause}
//             WHERE ContractNo = ?
//         `, [contract]);

//         await conn.execute(`
//             UPDATE shipment_mst sm
//             JOIN shipment_details sd ON sm.id = sd.mstId
//             SET sm.viewFlag = 1
//             WHERE sd.ContractNo = ?
//         `, [contract]);

//         dispatchLog("UPDATE DISPATCH END");

//     } catch (err) {
//         dispatchLog(
//             `DISPATCH FAILED | ContractNo: ${contract} | Error: ${err.message}`
//         );
//         throw err;
//     }
// };
const updateDispatchByPartNo = async (conn, contract, fimNo) => {
    try {
        // Normalize inputs
        contract = contract.trim();
        const fimList = Array.isArray(fimNo) ? fimNo.map(f => f.trim()) : [fimNo.trim()];

        dispatchLog("UPDATE DISPATCH START");
        dispatchLog(`ContractNo & FIMs Received: ${contract} - [${fimList.join(", ")}]`);

        // Extract valid FIM columns for shipment_details
        const columnsToUpdate = fimList
            .map(f => {
                const match = f.match(/FIM\d+(\.\d+)?/);
                return match ? match[0] : null;
            })
            .filter(Boolean);

        if (columnsToUpdate.length === 0) {
            dispatchLog(`No valid FIM columns found | ContractNo: ${contract}`);
            dispatchLog("UPDATE DISPATCH END");
            return;
        }

        // ----------------------
        // Update SOB table
        // ----------------------
        const [sobResult] = await conn.execute(`
            UPDATE sob
            SET plannedStatus = 'P/R/D'
            WHERE contractNo = ? AND fimNo IN (${fimList.map(() => '?').join(',')})
              AND plannedStatus != 'P/R/D'
        `, [contract, ...fimList]);

        // Determine which FIMs were actually updated
        let updatedSobFims = [];
        if (sobResult.affectedRows > 0) {
            const [rows] = await conn.execute(`
                SELECT DISTINCT fimNo
                FROM sob
                WHERE contractNo = ? AND fimNo IN (${fimList.map(() => '?').join(',')}) 
                  AND plannedStatus = 'P/R/D'
            `, [contract, ...fimList]);
            updatedSobFims = rows.map(r => r.fimNo);
        }

        dispatchLog(`SOB UPDATED FIMs: [${updatedSobFims.join(", ")}]`);

        // ----------------------
        // Update Shipment Details
        // ----------------------
        const setClause = columnsToUpdate.map(col => `\`${col}\`='P/R/D'`).join(", ");

        const [shipmentResult] = await conn.execute(`
            UPDATE shipment_details
            SET ${setClause}
            WHERE ContractNo = ?
        `, [contract]);

        // Determine which shipment columns actually changed
        const [shipmentRows] = await conn.execute(`
            SELECT ${columnsToUpdate.map(col => `\`${col}\``).join(", ")}
            FROM shipment_details
            WHERE ContractNo = ?
        `, [contract]);

        const updatedShipmentFims = [];
        if (shipmentRows.length > 0) {
            const row = shipmentRows[0];
            for (const col of columnsToUpdate) {
                if (row[col] === 'P/R/D') updatedShipmentFims.push(col);
            }
        }

        dispatchLog(`SHIPMENT UPDATED FIMs: [${updatedShipmentFims.join(", ")}]`);

        // ----------------------
        // Update shipment_mst viewFlag
        // ----------------------
        await conn.execute(`
            UPDATE shipment_mst sm
            JOIN shipment_details sd ON sm.id = sd.mstId
            SET sm.viewFlag = 1
            WHERE sd.ContractNo = ?
        `, [contract]);

        dispatchLog("UPDATE DISPATCH END");

    } catch (err) {
        dispatchLog(`DISPATCH FAILED | ContractNo: ${contract} | Error: ${err.message}`);
        throw err;
    }
};



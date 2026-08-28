const { connection, handleSuccessResponse, handleErrorResponse, CustomError } = require('../config/dbSql');
const { generateDocNo, formatFinancialYears, updateDocCounter } = require('../utility/docNo');


exports.kanaban = async (req, res) => {
    try {
        const { date } = req.body;


        const query = `
            SELECT 
                op.id, op.sobMstId, op.orderNo, 
                DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') as kanbanDate
            FROM 
                order_plannings op
            WHERE 
                op.sobMstId IS NOT NULL 
            AND DATE(op.kanbanDate) = ?`;

        const [rows] = await connection.execute(query, [date]);

        return res.status(200).json({
            success: true,
            data: rows,
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: 'An error occurred.', error: err.message });
    }
};



exports.searchContracts = async (req, res) => {
    try {
        const sob = req.body.sob; // Expecting `sob` as an array
        const { q } = req.query;

        if (!Array.isArray(sob) || sob.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid or empty 'sob' array in request body.",
            });
        }

        // SQL query to fetch `id` and `contractNos` for the given IDs
        const fetch = `
            SELECT 
                id, contractNos
            FROM 
                sob_mst 
            WHERE 
               id IN (${sob.map(() => '?').join(', ')})
        `;

        // Execute the query
        const [rows] = await connection.execute(fetch, sob);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No contracts found for the provided IDs.",
            });
        }

        // Process each row to split `contractNos` and associate them with their `id`
        const response = rows.flatMap(row => {
            const contractNosArray = row.contractNos.split(',').map(contract => contract.trim());
            const filteredContracts = q
                ? contractNosArray.filter(contract => contract.includes(q))
                : contractNosArray;

            // Map each contract to include the `id`
            return filteredContracts.map(contract => ({
                id: row.id,
                contract,
            }));
        });

        return res.status(200).json({
            success: true,
            message: "Contracts retrieved successfully.",
            data: response,
        });
    } catch (err) {
        console.error("Error fetching contracts:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: "Internal server error.",
            error: err.message,
        });
    }
};


exports.showData = async (req, res) => {
    try {
        const id = req.params.id;
        const { contractNo } = req.body;

        // Fetch `kanbanDate` and `orderNo` for the given `id`
        const fetchDtl = `
            SELECT 
                op.orderNo, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
            FROM 
                order_plannings op
            WHERE 
                op.sobMstId IS NOT NULL 
            AND sobMstId = ?
        `;
        const [getData] = await connection.execute(fetchDtl, [id]);

        // Ensure `getData` contains rows
        if (getData.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No data found for the given ID.",
            });
        }


        // Base query to fetch contracts
        const query = `
                SELECT 
                    sob.contractNo, sob.partNo, sob.Qty, sob.fimNo AS boxNo,
                    DATE_FORMAT(sob.created_at, '%d-%m-%Y') AS date, itm.id AS itemId, itm.npdFile 
                FROM sob 
                   LEFT JOIN items AS itm ON sob.partNo = itm.itemCode

                WHERE sob.contractNo = ?
        `;
        const queryParams = [contractNo];

        // Execute the query
        const [rows] = await connection.execute(query, queryParams);

        const inspecQuery = `
            SELECT DISTINCT
             ivi.item, ivi.inspectionType
             FROM itempm_vs_inspec ivi
            WHERE  ivi.type = 'Assembly'
           `;
        const [inspectionData] = await connection.execute(inspecQuery);

        // Add serial numbers and `kanbanDate`/`orderNo` from `getData`
        rows.forEach((element, index) => {
            element.id = index + 1;
            element.sNo = index + 1;
            element.kanbanDate = getData[0].kanbanDate; // Use the first row of `getData`
            element.orderNo = getData[0].orderNo; // Use the first row of `getData`

            // Find matching inspection data
            const match = inspectionData.find((inspection) => inspection.item === element.itemId);
            element.inspectionType = match ? match.inspectionType : null;
        });

        // Return response
        return res.status(200).json({
            success: true,
            message: "Qlty Items list",
            data: rows,
        });
    } catch (err) {
        console.error("Error fetching data:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "An error occurred",
        });
    }
};







exports.productionQc = async (req, res) => {
    try {
        const { item, date } = req.body;


        const [result] = await connection.execute(
            `CALL GetPreviousProcess(?)`,
            [item]
        );

        const pm = result[0][0].process;


        const query = `
            SELECT DISTINCT
                    itm.itemCode,  shfit_mst.shiftLabel AS shift2,
                    chPlan.machineName,  chPlan.machineId as machId, chPlan.Produced_QTY AS Qty, 
                    mst_pm.id as operationId, mst_pm.name as operation, inspec.status, inspec.addedBy
                FROM 
                    item_vs_pm itmPm    
                INNER JOIN job_card jc ON jc.itemId = itmPm.item
                INNER JOIN mrp_mst mm ON mm.id = jc.mrpMstId
                INNER JOIN order_plannings op ON op.id = mm.orderPlnId
                LEFT JOIN 
                    pm_inspeclist as inspec ON inspec.jcId = jC.id      
                    AND itmPm.item = inspec.itemId 
                    AND itmPm.process = inspec.processId 
                WHERE 
                    itmPm.dflag = 0 AND  itmPm.item = ? AND op.kanbanDate = ? AND inspec.processId = ?`;

        const [rows] = await connection.execute(query, [item, date, pm]);

        return res.status(200).json({
            success: true,
            data: rows,
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: 'An error occurred.', error: err.message });
    }
};






exports.showType = async (req, res) => {
    try {
        const { item, type, contractNo, qty } = req.body;

        let sqlQuery;
        const cust = "OTIS";

        // Main query to fetch item details
        sqlQuery = `
            SELECT DISTINCT
                itmPm.item, itm.itemCode, machines.machineCode, machines.id AS machineId, 
                mst_pm.id AS operationId, mst_pm.name AS operation, inspec.status, inspec.addedBy
            FROM 
                itempm_vs_inspec itmPm   
            INNER JOIN 
                items AS itm ON itm.id = itmPm.item  
            INNER JOIN 
                mst_pm ON mst_pm.id = itmPm.process
            INNER JOIN 
                machines_vs_pm_uom ON machines_vs_pm_uom.machineOperator = itmPm.process      
            INNER JOIN 
                machines ON machines.machineCode = machines_vs_pm_uom.machineCode
            LEFT JOIN 
                assembly_qlty_inspeclist_mst AS inspec 
                ON inspec.contractNo = ?   AND inspec.type = ? 
                AND inspec.totQty = ? AND inspec.itemId = ? 
                AND inspec.processId = itmPm.process   
                AND inspec.machineId = machines.id    
            WHERE 
                itmPm.dflag = 0 AND  mst_pm.name = 'Assembly' AND itmPm.item = ?`;

        // Execute the query using parameterized inputs
        const [rows] = await connection.execute(sqlQuery, [contractNo, type, qty, item, item]);

        if (rows.length === 0) {
            return res.status(200).json({ success: true, message: 'No data found', data: [] });
        }

        // Extract operationIds from rows
        const operationIds = rows.map(row => row.operationId);

        // If no operationIds are found, skip the next query
        if (operationIds.length === 0) {
            return res.status(200).json({ success: true, message: 'No operations found', data: [] });
        }

        const checkQuery = `
            SELECT 
              qcinspec.actualResult, qcMst.processId AS operationId
            FROM  
              assembly_qlty_inspeclist qcinspec
            INNER JOIN 
              assembly_qlty_inspeclist_mst AS qcMst ON qcMst.id = qcinspec.mstId  
            WHERE qcMst.contractNo = ? AND qcMst.itemId = ? AND qcMst.totQty = ? AND qcMst.type = ?`

        // Execute the checkQuery to get actualResult data
        const [checkResults] = await connection.execute(checkQuery, [contractNo, item, qty, type]);

        // //console.log(checkResults);
        const checkMap = {};
        checkResults.forEach(result => {
            if (!checkMap[result.operationId]) {
                checkMap[result.operationId] = [];
            }
            checkMap[result.operationId].push(result.actualResult);
        });


        // Second query to fetch inspection data
        const sqlQuery2 = `
            SELECT 
                ivi.id, ivi.qltyParameter, ivi.expVisInspec, ivi.evalMethod, ivi.inspectionId, 
                ivi.maxTolerance, ivi.minTolerance, ivi.expVal, ivi.addedBy, ivi.item AS itemId, 
                ivi.inspectionType AS inspecCategory, ivi.process AS operationId,
                mst_uom.id AS uomId, mst_uom.code AS uom
            FROM 
                itempm_vs_inspec ivi
            INNER JOIN 
                mst_pm ON mst_pm.id = ivi.process
            INNER JOIN 
                mst_uom ON mst_uom.id = ivi.uom    
            WHERE 
                ivi.dflag = 0 AND ivi.type = 'Assembly' AND ivi.item = ? 
            AND ivi.process IN (${operationIds.map(() => '?').join(', ')})`;

        const params = [item, ...operationIds];
        const [subRows] = await connection.execute(sqlQuery2, params);

        // Map inspections by operationId
        // const inspectionMap = {};
        // if (subRows.length > 0) {
        //     subRows.forEach((row, index) => {
        //         row.sNo = index + 1;
        //         if (!inspectionMap[row.operationId]) {
        //             inspectionMap[row.operationId] = [];
        //         }

        //         // Attach actualResult to the row (if found) or null
        //         row.actualResult = checkMap[row.operationId] ? checkMap[row.operationId].shift() : null;
        //         inspectionMap[row.operationId].push(row);
        //     });
        // }

        // Map inspections by operationId
        const inspectionMap = {};
        const inspectionCounters = {}; // Track sNo for each operationId

        if (subRows.length > 0) {
            subRows.forEach((row) => {
                if (!inspectionMap[row.operationId]) {
                    inspectionMap[row.operationId] = [];
                    inspectionCounters[row.operationId] = 1; // Initialize counter for this operationId
                }

                // Assign sNo based on operationId-specific count
                row.sNo = inspectionCounters[row.operationId]++;

                // Attach actualResult to the row (if found) or null
                row.actualResult = checkMap[row.operationId] ? checkMap[row.operationId].shift() : null;

                inspectionMap[row.operationId].push(row);
            });
        }


        // Enhance rows and attach inspections
        rows.forEach((row, index) => {
            row.type = type;
            row.id = index + 1;
            row.sNo = index + 1;
            row.customer = cust;
            row.inspections = inspectionMap[row.operationId] || []; // Attach inspections or empty array
        });

        // Split rows into two arrays (example logic for splitting)
        const firstArray = rows.filter(row => row.machineCode === "MATCHING_MACHINE_CODE"); // Replace with your logic
        const lastArray = rows.filter(row => row.machineCode !== "MATCHING_MACHINE_CODE");

        // Construct response object
        const responseObject = {
            success: true,
            data: [...firstArray, ...lastArray]
        };

        // Send response
        res.status(200).json(responseObject);
    } catch (err) {
        console.error("Error in showType:", err);
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};


//    ****************************      PROCESS INSPECTION TYPE   *******************************         //


// exports.uniqueId = async (req, res) => {
//     try {
//         const [fRows] = await connection.execute('SELECT qcTestNo FROM assembly_qlty_inspeclist_mst ORDER BY id DESC', []);
//         let qTn = 'QTN1'; // Default fileId if no records exist

//         if (fRows.length > 0) {

//             const lastFileId = fRows[0].qcTestNo;
//             const numericPart = (lastFileId && lastFileId.match(/\d+/)) ? parseInt(lastFileId.match(/\d+/)[0]) : 0;
//             qTn = 'QTN' + (numericPart + 1);
//         }

//         return res.status(200).json({
//             qcTestNo: qTn
//         });

//     } catch (err) {
//         console.error(err);
//         return res.status(500).json({ success: false, message: err.message });
//     }
// };

exports.uniqueId = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {

        const { padStartNo, uniqueNo } = await generateDocNo(
            conn,
            req,
            { docType: 'AssemblyContractQC' }
        );

        await conn.commit();
        return res.status(200).json({
            qcTestNo: uniqueNo,
            snNo: padStartNo
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};





const validateTolerance = (item) => {
    const actual = item.actualResult;

    // Skip validation if actual is not a number (e.g., "OK")
    if (isNaN(Number(actual))) return;

    const actualNum = Number(actual);
    const expected = Number(item.expVal);
    const maxTolerance = Number(item.maxTolerance);
    const minTolerance = Number(item.minTolerance);

    if ([expected, maxTolerance, minTolerance].some(val => isNaN(val))) {
        throw new CustomError(`Expected value or tolerance settings are invalid for ${item.qltyParameter}.`);
    }

    const upperBound = parseFloat((expected + maxTolerance).toFixed(2));
    const lowerBound = parseFloat((expected - minTolerance).toFixed(2));

    if (actualNum < lowerBound || actualNum > upperBound) {
        throw new CustomError(
            `Actual Result for ${item.qltyParameter} is not within allowed tolerance range (${lowerBound} - ${upperBound}).`
        );
    }
};



// exports.submit = async (req, res) => {
//     const data = req.body;
//     const user = req.headers.username;
//     const variableData = data.qlty;

//     try {
//         // Check if the record already exists
//         const [existingRecord] = await connection.execute(
//             `SELECT id, status FROM assembly_qlty_inspeclist_mst 
//              WHERE type = ? AND contractNo = ? AND itemId = ? 
//              AND processId = ? AND machineId = ? AND totQty = ?`,
//             [data.type, data.contractNo, data.itemId, data.operationId, data.machId, data.qty]
//         );

//         let mstId;

//         if (existingRecord.length > 0) {
//             // Record exists, validate status
//             const existingStatus = existingRecord[0].status;

//             if (existingStatus === "reworks" && data.status === "approved") {
//                 // Update existing record if status matches the condition
//                 mstId = existingRecord[0].id;

//                 await connection.execute(
//                     `UPDATE assembly_qlty_inspeclist_mst
//                         SET qcTestNo = ?, date = ?, customer = ?, status = ?, reason = ?, remarks = ?, addedBy = ?
//                         WHERE id = ?`,
//                     [data.qcTestNo, data.date, data.customer, data.status, data.reason, data.remarks, user, mstId]
//                 );

//                 // Clear old variable data associated with mstId
//                 await connection.execute(`DELETE FROM assembly_qlty_inspeclist WHERE mstId = ?`, [mstId]);

//             } else if (existingStatus !== "reworks") {
//                 // If status is not reworks, throw an error
//                 return res.status(400).json({
//                     success: false,
//                     message: "Report already submitted. Update is not allowed.",
//                 });
//             }
//         } else {
//             // Insert new record
//             const [result] = await connection.execute(
//                 `INSERT INTO assembly_qlty_inspeclist_mst 
//                   (qcTestNo, type, date, customer, contractNo, itemId, processId, machineId, totQty, rejRewQty, status, reason, remarks, addedBy)
//                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

//                 [data.qcTestNo, data.type, data.date, data.customer, data.contractNo, data.itemId, data.operationId, data.machId, data.qty, 
//                  data.rejRewQty ?? null,  data.status, data.reason, data.remarks, user]
//             );

//             mstId = result.insertId; // New record ID
//         }

//         // Insert variable data (quality inspection parameters)
//         const insertVariableDataQuery = `
//             INSERT INTO assembly_qlty_inspeclist 
//             (qltyParameter, expVal, maxTolerance, minTolerance, uomId, visual, evalutionMethod, actualResult, mstId)
//             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

//         try {
//             for (const item of variableData) {
//                 // Validate tolerances only if status is "approved"
//                 if (data.status === 'approved') {
//                     try {
//                         validateTolerance(item); // Ensure validation occurs here
//                     } catch (validationError) {
//                         throw new CustomError(` ${validationError.message}`);
//                     }
//                 }

//                 await connection.execute(insertVariableDataQuery, [
//                     item.qltyParameter, item.expVal, item.maxTolerance, item.minTolerance,
//                     item.uomId, item.expVisInspec, item.evalMethod, item.actualResult, mstId
//                 ]);
//             }

//             return res.status(200).json({
//                 success: true,
//                 message: existingRecord.length > 0 ? "Data Updated Successfully" : "Data Added Successfully",
//             });
//         } catch (err) {
//             console.error("Error during variable data insertion:", err);

//             // If any error occurs, rollback if needed and return error response
//             if (mstId && existingRecord.length === 0) {
//                 // If a new record was inserted, delete it to maintain integrity
//                 await connection.execute(`DELETE FROM assembly_qlty_inspeclist_mst WHERE id = ?`, [mstId]);
//             }

//             throw err; // Re-throw the error to handle it in the outer catch
//         }

//     // } catch (err) {
//     //     console.error("Error in store function:", err);
//     //     return res.status(400).json({ success: false, message: err.message || "An error occurred" });
//     // }

//     } catch (err) {
//     return handleErrorResponse(res, err);
//   } finally {
//     if (connection) connection.release();
//   }
// };


exports.submit = async (req, res) => {
    let conn;

    try {
        conn = await connection.getConnection();
        await conn.beginTransaction();

        const data = req.body;
        const user = req.headers.username;
        const variableData = data.qlty || [];

        /* ---------- CHECK EXISTING RECORD ---------- */
        const [existingRecord] = await conn.execute(
            `SELECT id, status
             FROM assembly_qlty_inspeclist_mst
             WHERE type = ?
               AND contractNo = ? AND itemId = ? AND processId = ? AND machineId = ? AND totQty = ?`,
            [
                data.type, data.contractNo, data.itemId, data.operationId, data.machId, data.qty
            ]
        );

        let mstId;
        let isUpdate = false;

        /* ---------- UPDATE CASE ---------- */
        if (existingRecord.length > 0) {
            const { id, status } = existingRecord[0];

            if (status !== 'reworks' || data.status !== 'approved') {
                throw new CustomError(
                    "Report already submitted. Update is not allowed."
                );
            }

            mstId = id;
            isUpdate = true;

            await conn.execute(
                `UPDATE assembly_qlty_inspeclist_mst
                  SET qcTestNo = ?, date = ?, customer = ?, status = ?, reason = ?, remarks = ?, addedBy = ?
                  WHERE id = ?`,
                [
                    data.qcTestNo, data.date, data.customer, data.status, data.reason, data.remarks, user, mstId
                ]
            );

            // Remove old inspection parameters
            await conn.execute(
                `DELETE FROM assembly_qlty_inspeclist WHERE mstId = ?`,
                [mstId]
            );
        }

        /* ---------- INSERT CASE ---------- */
        if (!mstId) {
            const [result] = await conn.execute(
                `INSERT INTO assembly_qlty_inspeclist_mst
                 (qcTestNo, type, date, customer, contractNo, itemId,  processId, machineId, totQty, rejRewQty,
                  status, reason, remarks, addedBy)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.qcTestNo, data.type, data.date, data.customer, data.contractNo, data.itemId, data.operationId,
                    data.machId, data.qty, data.rejRewQty ?? null, data.status, data.reason, data.remarks, user
                ]
            );

            mstId = result.insertId;
        }

        /* ---------- INSERT VARIABLE DATA ---------- */
        const insertVarSql = `
            INSERT INTO assembly_qlty_inspeclist
            (qltyParameter, expVal, maxTolerance, minTolerance, uomId, visual, evalutionMethod, actualResult, mstId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        for (const item of variableData) {
            if (data.status === 'approved') {
                validateTolerance(item);
            }

            await conn.execute(insertVarSql, [
                item.qltyParameter, item.expVal, item.maxTolerance, item.minTolerance, item.uomId, item.expVisInspec, 
                item.evalMethod, item.actualResult, mstId
            ]);
        }

        /* ---------- COMMIT ---------- */
        await conn.commit();

        return res.status(200).json({
            success: true,
            message: isUpdate
                ? "Data Updated Successfully"
                : "Data Added Successfully"
        });

    } catch (err) {
        if (conn) await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};




//   ************************************       QUALITY REPORT     ********************************************  //


exports.report = async (req, res) => {
    try {

        const { contractNo, type, from, to } = req.body;

        // Construct the SQL query
        let sqlQuery = `
            SELECT 
                qcMst.id, qcMst.qcTestNo, qcMst.type,  qcMst.contractNo, 
                qcMst.status, qcMst.addedBy, mst_pm.code AS process,
                items.itemCode, mach.machineCode,
                DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as date,
                DATE_FORMAT(qcMst.kanbanDate, '%d-%m-%Y') as kanbanDate

            FROM 
                assembly_qlty_inspeclist_mst qcMst
            INNER JOIN 
                items ON qcMst.itemId = items.id  
            INNER JOIN 
                mst_pm ON mst_pm.id = qcMst.processId
            INNER JOIN 
                machines AS mach ON mach.id = qcMst.machineId
            WHERE 
                qcMst.type = ?`;

        // Add conditions for 'from' and 'to' if they are provided
        const params = [type];

        if (from && to && contractNo) {
            sqlQuery += ` AND DATE(qcMst.created_at) BETWEEN ? AND ? AND qcMst.contractNo = ?`;
            params.push(from, to, contractNo);

        } else if (from && to) {
            sqlQuery += ` AND DATE(qcMst.created_at) BETWEEN ? AND ?`;
            params.push(from, to);

        } else if (contractNo) {
            sqlQuery += ` AND qcMst.contractNo = ?`;
            params.push(contractNo);

        } else {
            sqlQuery += ` AND DATE(qcMst.created_at) = CURDATE()`;
        }

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, params);

        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        // Construct the response object with the modified rows
        const responseObject = {
            success: true,
            data: rows
        };

        // Send the responseObject as a response
        res.json(responseObject);
    } catch (err) {
        res.status(500).json({ success: false, message: 'An error occurred', error: err.message });
    }
};




exports.reportView = async (req, res) => {
    try {
        const { id } = req.params;

        // Construct the SQL query
        const sqlQuery = `
            SELECT 
                qcInspec.*,
                mach.machineCode, mst_pm.code as process, mst_uom.code as uom,
                itm.itemCode, itm.itemName, 
                qcMst.contractNo,  qcMst.customer, qcMst.qcTestNo, qcMst.addedBy,
                qcMst.totQty, DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as date
            FROM 
                assembly_qlty_inspeclist qcInspec
                INNER JOIN assembly_qlty_inspeclist_mst AS qcMst ON qcMst.id = qcInspec.mstId

                INNER JOIN items AS itm ON itm.id = qcMst.itemId 
                INNER JOIN mst_pm ON mst_pm.id = qcMst.processId
                INNER JOIN machines AS mach ON mach.id = qcMst.machineId
                INNER JOIN mst_uom ON mst_uom.id = qcInspec.uomId
            WHERE 
               qcMst.id = ?`;

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, [id]);

        // Add serial numbers to rows
        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        // Construct the response object with the modified rows
        const responseObject = {
            success: true,
            data: rows
        };

        // Send the responseObject as a response
        res.json(responseObject);

    } catch (err) {
        // Handle errors by sending a 500 response
        res.status(500).json({ success: false, message: 'An error occurred', error: err.message });
    }
}

exports.rejected = async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;

        // Base SQL query
        let sqlQuery = `
            SELECT 
                qcMst.id,
                qcMst.contractNo,
                qcMst.itemId,
                qcMst.addedBy,
                qcMst.totQty AS Qty,
                qcMst.rejRewQty,
                qcMst.remarks,
                items.itemCode,
                mach.machineCode,
                DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') AS date
            FROM 
                assembly_qlty_inspeclist_mst AS qcMst
            INNER JOIN 
                machines AS mach ON mach.id = qcMst.machineId
            INNER JOIN 
                items ON qcMst.itemId = items.id
            WHERE 
                qcMst.status = 'scrap'
        `;

        const params = [];

        //  Apply date filter only when both dates are present
        if (fromDate && toDate) {
            sqlQuery += ` AND DATE(qcMst.created_at) BETWEEN ? AND ?`;
            params.push(fromDate, toDate);
        }

        const [rows] = await connection.execute(sqlQuery, params);

        // Add serial number (sNo)
        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return res.status(200).json({
            success: true,
            message: "Rejected scrap list",
            data: rows
        });

    } catch (err) {
        console.error("Error in rejected:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "An error occurred while fetching rejected data"
        });
    }
};



//   ************************************                    ASSEMBLY PLANNINGS                     ********************************************  //



exports.assemblyShow = async (req, res) => {
    try {
        const { kanbanDate, fim } = req.body;

        if (!kanbanDate && !fim) {
            return res.status(400).json({ success: false, message: "Missing kanbanDate and fim" });
        }

        // Fetch finalResult and contractList from assemblyPlanning
        // const { finalResult, contractList } = await this.assemblyPlanning(kanbanDate, fim); //Intial 
        const { finalResult, contractList } = await exports.assemblyPlanning(kanbanDate, fim);


        // Check if finalResult and contractList are empty
        if (!finalResult || finalResult.length === 0 || !contractList || Object.keys(contractList).length === 0) {
            return res.status(200).json({ success: true, message: 'No data found', data: [] });
        }

        // Calculate totalContractCount
        const totalContractCount = Object.keys(contractList).length;

        // Construct resArray based on finalResult and contractList
        const resArray = [];
        const items = ['duty', 'stop', 'type', 'poNo'];
        const keys = Object.keys(finalResult[0] || {});

        items.forEach((item, index) => {
            const obj = {};
            keys.forEach((key, i) => {
                if (key === 'id') {
                    obj[key] = `${index}_${i}`;
                    obj['sNo'] = ''; // Adjusted logic
                } else if (key === 'itemCode') {
                    obj[key] = item[0].toUpperCase() + item.slice(1, 4);
                    obj['grn'] = ''; // Adjusted logic

                } else if (key !== 'totQty') {
                    obj[key] = contractList[key]?.[item] || "";
                }
            });


            resArray.push({ ...obj, totQty: "" });
        });

        // Update `Qty` in `finalResult` to be an empty string if it's 0
        finalResult.forEach(row => {
            row.sNo = row.id;

            Object.keys(row).forEach(key => {
                if (contractList[key] && row[key] === 0) {
                    row[key] = ""; // Replace 0 with empty string
                }
            });

            // if (updated[row.itemCode]) {
            //     row.updated = { ...updated[row.itemCode] };
            // }
        });

        return res.status(200).json({
            success: true,
            message: 'Assembly Planning lists',
            totalContractCount, // Include totalContractCount in the response
            data: [...resArray, ...finalResult],
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: 'Internal server error!',
            error: error.message
        });
    }
};


// exports.assemblyPlanning = async function (kanbanDate, fim) {
//     try {


//         const fetchQuery = `
//            SELECT 
//                 sob.id,  sob.contractNo,  sob.partNo AS itemCode,  sob.Qty,  ip.inspectionType,
//                 items.category, items.id As itemId,  COALESCE(SUM(DISTINCT iVp.cycleTime), 0) AS cycleTime,
//                 GROUP_CONCAT(
//                     DISTINCT COALESCE(srn.issueNo, srn.grn)
//                     ORDER BY srn.id
//                 ) AS grn
//             FROM sob
//             INNER JOIN items ON items.itemCode = sob.partNo
//             INNER JOIN order_plannings op ON op.sobMstId = sob.sobMstId 
//             LEFT JOIN orderlist ol ON ol.sobId = sob.id
//             LEFT JOIN item_vs_pm iVp ON iVp.item = items.id
//             LEFT JOIN srn ON srn.sobId = sob.id
//             LEFT JOIN itempm_vs_inspec ip ON ip.item = items.id AND type = "Assembly"
//             WHERE 
//                 op.kanbanDate = ? AND sob.fimNo LIKE ?
//             GROUP BY 
//                 sob.id, sob.contractNo, sob.partNo, sob.Qty;
//         `;

        

//         const [rows] = await connection.execute(fetchQuery, [kanbanDate, `%${fim}`,]);

//         const contractsArray = Array.from(new Set(rows.map(row => row.contractNo)));
//         const contractList = await contractDetails(contractsArray, fim);

//         const contractNos = Object.keys(contractList);

//         const reformattedResult = [];
//         rows.forEach(row => {
//             const { contractNo, itemCode, grn, category, itemId, Qty, inspectionType } = row;

//             let existingItem = reformattedResult.find(item => item.itemCode === itemCode);

//             if (!existingItem) {
//                 existingItem = {
//                     id: reformattedResult.length + 1,
//                     itemCode,
//                     grn: grn || '',
//                     inspectionType: inspectionType,
//                     category,
//                     itemId,
//                     totQty: 0,
//                 };
//                 contractNos.forEach(contract => {
//                     existingItem[contract] = 0;
//                 });
//                 reformattedResult.push(existingItem);
//             }

//             existingItem[contractNo] += parseInt(Qty);
//             existingItem.totQty += parseInt(Qty);
//         });


//         const finalResult = await Promise.all(reformattedResult.map(async item => {
//             const statusDisplay = await exports.qcVerified(kanbanDate, fim, item.itemId, contractList, item);

//             return {
//                 id: item.id,
//                 itemCode: item.itemCode,
//                 grn: item.grn || '',
//                 inspectionType: item.inspectionType,
//                 category: item.category,
//                 itemId: item.itemId,
//                 statusDisplay, // Add the G/P/R statusDisplay
//                 ...contractNos.reduce((acc, contractNo) => {
//                     acc[contractNo] = item[contractNo];
//                     return acc;
//                 }, {}),
//                 totQty: item.totQty,
//             };
//         }));


//         return { finalResult, contractList }

//     } catch (error) {
//         throw error;
//     }
// };

exports.assemblyPlanning = async function (kanbanDate, fim) {
    try {
        const fetchQuery = `
            SELECT 
                sob.id,  sob.contractNo,  sob.partNo AS itemCode,  sob.Qty,  ip.inspectionType,
                items.category, items.id As itemId,  COALESCE(SUM(DISTINCT iVp.cycleTime), 0) AS cycleTime,
                GROUP_CONCAT(
                    DISTINCT COALESCE(srn.issueNo, srn.grn)
                    ORDER BY srn.id
                ) AS grn
            FROM sob
            INNER JOIN items ON items.itemCode = sob.partNo
            INNER JOIN order_plannings op ON op.sobMstId = sob.sobMstId 
            LEFT JOIN orderlist ol ON ol.sobId = sob.id
            LEFT JOIN item_vs_pm iVp ON iVp.item = items.id
            LEFT JOIN srn ON srn.sobId = sob.id
            LEFT JOIN itempm_vs_inspec ip ON ip.item = items.id AND type = "Assembly"
            WHERE 
                op.kanbanDate = ? AND sob.fimNo LIKE ?
            GROUP BY 
                sob.id, sob.contractNo, sob.partNo, sob.Qty;
        `;

        const [rows] = await connection.execute(fetchQuery, [kanbanDate, `%${fim}`]);

        const contractsArray = Array.from(new Set(rows.map(row => row.contractNo)));
        const contractList = await contractDetails(contractsArray, fim);

        const contractNos = Object.keys(contractList);

        const reformattedResult = [];
        rows.forEach(row => {
            const { contractNo, itemCode, grn, category, itemId, Qty, inspectionType } = row;

            let existingItem = reformattedResult.find(item => item.itemCode === itemCode);

            if (!existingItem) {
                existingItem = {
                    id: reformattedResult.length + 1,
                    itemCode,
                    grn: grn || '',
                    inspectionType: inspectionType,
                    category,
                    itemId,
                    totQty: 0,
                };
                contractNos.forEach(contract => {
                    existingItem[contract] = 0;
                });
                reformattedResult.push(existingItem);
            }

            existingItem[contractNo] += parseInt(Qty);
            existingItem.totQty += parseInt(Qty);
        });

        // ✅ STEP 1: Batch fetch all QC data in ONE query instead of N queries
        const allItemIds = reformattedResult.map(item => item.itemId);

        let allQcData = {};
        if (allItemIds.length > 0) {
            const placeholders = allItemIds.map(() => '?').join(',');
            const qcBatchQuery = `
                SELECT 
                    aqc.contractNo,
                    aqc.totQty,
                    aqc.itemId
                FROM assembly_qlty_inspeclist_mst aqc
                WHERE 
                    aqc.kanbanDate = ? 
                    AND aqc.fimNo = ? 
                    AND aqc.itemId IN (${placeholders})
            `;

            const [qcRows] = await connection.execute(qcBatchQuery, [
                kanbanDate,
                fim,
                ...allItemIds,
            ]);

            // ✅ STEP 2: Group QC data by itemId -> contractNo -> totQty
            qcRows.forEach(r => {
                if (!allQcData[r.itemId]) allQcData[r.itemId] = {};
                allQcData[r.itemId][r.contractNo] = r.totQty;
            });
        }

        // ✅ STEP 3: Build finalResult using batched QC data (no more concurrent DB calls)
        const finalResult = reformattedResult.map(item => {
            const qcMap = allQcData[item.itemId] || {};

            let statusObj = {};
            let hasYellow = false;

            for (const contractNo of Object.keys(contractList)) {
                const mainQty = item[contractNo] || 0;
                const qcQty = qcMap[contractNo] || 0;

                if (qcQty > 0) {
                    statusObj[contractNo] = "G";
                } else if (mainQty > 0) {
                    statusObj[contractNo] = "Y";
                    hasYellow = true;
                } else {
                    statusObj[contractNo] = "R";
                }
            }

            // totQty status — Y if any contract is yellow, else G
            statusObj.totQty = hasYellow ? "Y" : "G";

            return {
                id: item.id,
                itemCode: item.itemCode,
                grn: item.grn || '',
                inspectionType: item.inspectionType,
                category: item.category,
                itemId: item.itemId,
                statusDisplay: statusObj,   // G / Y / R per contract
                ...contractNos.reduce((acc, contractNo) => {
                    acc[contractNo] = item[contractNo];
                    return acc;
                }, {}),
                totQty: item.totQty,
            };
        });

        return { finalResult, contractList };

    } catch (error) {
        throw error;
    }
};

//Not included
exports.qcVerified = async (kanbanDate, fim, itemId, contractList, itemRow) => {
    try {
        const query = `
            SELECT 
                aqc.contractNo,
                aqc.totQty
            FROM assembly_qlty_inspeclist_mst aqc
            WHERE 
                aqc.kanbanDate = ? 
                AND aqc.fimNo = ? 
                AND aqc.itemId = ?
        `;

        const [rows] = await connection.execute(query, [kanbanDate, fim, itemId]);

        // QC qty map
        const qcMap = {};
        rows.forEach(r => {
            qcMap[r.contractNo] = r.totQty;
        });

        let statusObj = {};
        let hasYellow = false;   // 👈 ONLY track Y

        for (const contractNo of Object.keys(contractList)) {

            const mainQty = itemRow[contractNo] || 0;
            const qcQty = qcMap[contractNo] || 0;

            if (qcQty > 0) {
                statusObj[contractNo] = "G";
            }
            else if (mainQty > 0) {
                statusObj[contractNo] = "Y";
                hasYellow = true;   // 👈 mark Y found
            }
            else {
                statusObj[contractNo] = "R";  // ignored for totQty
            }
        }

        // ✅ totQty logic (ignore R)
        statusObj.totQty = hasYellow ? "Y" : "G";

        return statusObj;

    } catch (err) {
        console.error("qcVerified error:", err);
        return {};
    }
};



async function contractDetails(contractNos, fim) {
    const cList = {};
    for (const contract of contractNos) {
        const label = contract + "-" + fim;

        const [rows] = await connection.execute(`SELECT duty, stop, type FROM csl_mst WHERE contractNo = ?`, [contract]);
        const [po] = await connection.execute(`SELECT po.poNo FROM purchas_Order_item poItem
            LEFT JOIN purchase_order po on po.id = poItem.purchase_order_id
            WHERE poItem.PartNo LIKE ?`,
            [label]
        );

        if (rows.length > 0) {
            const { duty, stop, type } = rows[0];
            const poNo = po.length > 0 ? po[0].poNo : null;
            // //console.log(label, poNo)

            const dutyFormat = duty;
            if (!cList[dutyFormat]) {
                cList[dutyFormat] = [];
            }
            cList[dutyFormat].push({ contract, poNo, duty, stop, type });
        }
    }

    const finalResult = {};
    Object.keys(cList).forEach(dutyFormat => {
        cList[dutyFormat].forEach(item => {
            const { contract, poNo, duty, stop, type } = item;
            finalResult[contract] = { poNo, duty, stop, type };
        });
    });

    return finalResult;
}

// inspec.status, inspec.addedBy

// exports.assemblyPlanShowType = async (req, res) => {
//     try {
//         const { item, fim, type, date, category, statusDisplay } = req.body;


//         const cust = "OTIS";

//         const sqlQuery = `
//             SELECT DISTINCT
//                 itmPm.item, itm.itemCode, machines.machineCode, machines.id AS machineId, 
//                 mst_pm.id AS operationId, mst_pm.name AS operation, inspec.status, inspec.addedBy
//             FROM 
//                 itempm_vs_inspec itmPm   
//             INNER JOIN 
//                 items AS itm ON itm.id = itmPm.item  
//             INNER JOIN 
//                 mst_pm ON mst_pm.id = itmPm.process
//             INNER JOIN 
//                 machines_vs_pm_uom ON machines_vs_pm_uom.machineOperator = itmPm.process      
//             INNER JOIN 
//                 machines ON machines.machineCode = machines_vs_pm_uom.machineCode
//             LEFT JOIN 
//                 assembly_qlty_inspeclist_mst AS inspec 
//                 ON inspec.type = ?  
//                 AND inspec.kanbanDate = ? 
//                 AND inspec.fimNo = ? 
//                 AND inspec.itemId = ? 
//                 AND inspec.processId = itmPm.process   
//                 AND inspec.machineId = machines.id    
//             WHERE 
//                 itmPm.dflag = 0 AND  mst_pm.name = 'Assembly' AND itmPm.item = ?`;

//         const [rows] = await connection.execute(sqlQuery, [type, date, fim, item, item]);

//         if (rows.length === 0) {
//             return res.status(200).json({ success: true, message: 'No data found', data: [] });
//         }

//         const operationIds = rows.map(row => row.operationId);
//         if (operationIds.length === 0) {
//             return res.status(200).json({ success: true, message: 'No operations found', data: [] });
//         }

//         const checkQuery = `
//             SELECT 
//               qcinspec.actualResult, qcMst.processId AS operationId
//             FROM  
//               assembly_qlty_inspeclist qcinspec
//             INNER JOIN 
//               assembly_qlty_inspeclist_mst AS qcMst ON qcMst.id = qcinspec.mstId  
//             WHERE qcMst.kanbanDate = ? 
//               AND qcMst.itemId = ? 
//               AND qcMst.fimNo = ? 
//               AND qcMst.type = ?`;

//         const [checkResults] = await connection.execute(checkQuery, [date, item, fim, type]);

//         const checkMap = {};
//         checkResults.forEach(result => {
//             if (!checkMap[result.operationId]) {
//                 checkMap[result.operationId] = [];
//             }
//             checkMap[result.operationId].push(result.actualResult);
//         });

//         const sqlQuery2 = `
//             SELECT 
//                 ivi.id, ivi.qltyParameter, ivi.expVisInspec, ivi.evalMethod, ivi.inspectionId, 
//                 ivi.maxTolerance, ivi.minTolerance, ivi.expVal, ivi.item AS itemId, 
//                 ivi.inspectionType AS inspecCategory, ivi.process AS operationId,
//                 mst_uom.id AS uomId, mst_uom.code AS uom
//             FROM 
//                 itempm_vs_inspec ivi
//             INNER JOIN 
//                 mst_pm ON mst_pm.id = ivi.process
//             INNER JOIN 
//                 mst_uom ON mst_uom.id = ivi.uom    
//             WHERE 
//                 ivi.dflag = 0 AND ivi.type = 'Assembly' AND ivi.item = ? 
//                 AND ivi.process IN (${operationIds.map(() => '?').join(', ')})`;

//         const params = [item, ...operationIds];
//         const [subRows] = await connection.execute(sqlQuery2, params);

//         const inspectionMap = {};
//         const inspectionCounters = {};

//         subRows.forEach((row) => {
//             if (!inspectionMap[row.operationId]) {
//                 inspectionMap[row.operationId] = [];
//                 inspectionCounters[row.operationId] = 1;
//             }

//             row.sNo = inspectionCounters[row.operationId]++;
//             row.actualResult = checkMap[row.operationId] ? checkMap[row.operationId].shift() : null;

//             inspectionMap[row.operationId].push(row);
//         });

//         rows.forEach((row, index) => {
//             row.type = type;
//             row.id = index + 1;
//             row.sNo = index + 1;
//             row.customer = cust;
//             row.inspections = inspectionMap[row.operationId] || [];
//         });

//         const firstArray = rows.filter(row => row.machineCode === "MATCHING_MACHINE_CODE");
//         const lastArray = rows.filter(row => row.machineCode !== "MATCHING_MACHINE_CODE");

//         const responseObject = {
//             success: true,
//             data: [...firstArray, ...lastArray]
//         };

//         res.status(200).json(responseObject);
//     } catch (err) {
//         console.error("Error in assemblyPlanShowType:", err);
//         return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
//     }
// };




exports.assemblyPlanShowType = async (req, res) => {
    try {
        const { item, fim, type, date, contractNo, category, statusDisplay } = req.body;


        const cust = "OTIS";

        // take first contract number safely
        const contractNoValue = Array.isArray(contractNo) && contractNo.length > 0 ? contractNo[0] : null;

        const sqlQuery = `
            SELECT DISTINCT
                itmPm.item, itm.itemCode, machines.machineCode, machines.id AS machineId, 
                mst_pm.id AS operationId, mst_pm.name AS operation, inspec.status, inspec.addedBy
            FROM 
                itempm_vs_inspec itmPm   
            INNER JOIN 
                items AS itm ON itm.id = itmPm.item  
            INNER JOIN 
                mst_pm ON mst_pm.id = itmPm.process
            INNER JOIN 
                machines_vs_pm_uom ON machines_vs_pm_uom.machineOperator = itmPm.process      
            INNER JOIN 
                machines ON machines.machineCode = machines_vs_pm_uom.machineCode
            LEFT JOIN 
                assembly_qlty_inspeclist_mst AS inspec 
                ON inspec.type = ?  
                AND inspec.kanbanDate = ? 
                AND inspec.fimNo = ? 
                AND inspec.itemId = ? 
                AND inspec.contractNo = ?
                AND inspec.processId = itmPm.process   
                AND inspec.machineId = machines.id    
            WHERE 
                itmPm.dflag = 0 AND  mst_pm.name = 'Assembly' AND itmPm.item = ?`;

        const [rows] = await connection.execute(sqlQuery, [type, date, fim, item, contractNoValue, item]);

        if (rows.length === 0) {
            return res.status(200).json({ success: true, message: 'No data found', data: [] });
        }

        const operationIds = rows.map(row => row.operationId);
        if (operationIds.length === 0) {
            return res.status(200).json({ success: true, message: 'No operations found', data: [] });
        }

        const checkQuery = `
            SELECT 
              qcinspec.actualResult, qcMst.processId AS operationId
            FROM  
              assembly_qlty_inspeclist qcinspec
            INNER JOIN 
              assembly_qlty_inspeclist_mst AS qcMst ON qcMst.id = qcinspec.mstId  
            WHERE qcMst.kanbanDate = ? 
              AND qcMst.itemId = ? 
              AND qcMst.fimNo = ? 
              AND qcMst.type = ?
              AND qcMst.contractNo = ?`;

        const [checkResults] = await connection.execute(checkQuery, [date, item, fim, type, contractNoValue]);

        const checkMap = {};
        checkResults.forEach(result => {
            if (!checkMap[result.operationId]) {
                checkMap[result.operationId] = [];
            }
            checkMap[result.operationId].push(result.actualResult);
        });

        const sqlQuery2 = `
            SELECT 
                ivi.id, ivi.qltyParameter, ivi.expVisInspec, ivi.evalMethod, ivi.inspectionId, 
                ivi.maxTolerance, ivi.minTolerance, ivi.expVal, ivi.item AS itemId, 
                ivi.inspectionType AS inspecCategory, ivi.process AS operationId,
                mst_uom.id AS uomId, mst_uom.code AS uom
            FROM 
                itempm_vs_inspec ivi
            INNER JOIN 
                mst_pm ON mst_pm.id = ivi.process
            INNER JOIN 
                mst_uom ON mst_uom.id = ivi.uom    
            WHERE 
                ivi.dflag = 0 AND ivi.type = 'Assembly' AND ivi.item = ? 
                AND ivi.process IN (${operationIds.map(() => '?').join(', ')})`;

        const params = [item, ...operationIds];
        const [subRows] = await connection.execute(sqlQuery2, params);

        const inspectionMap = {};
        const inspectionCounters = {};

        subRows.forEach((row) => {
            if (!inspectionMap[row.operationId]) {
                inspectionMap[row.operationId] = [];
                inspectionCounters[row.operationId] = 1;
            }

            row.sNo = inspectionCounters[row.operationId]++;
            row.actualResult = checkMap[row.operationId] ? checkMap[row.operationId].shift() : null;

            inspectionMap[row.operationId].push(row);
        });

        rows.forEach((row, index) => {
            row.type = type;
            row.id = index + 1;
            row.sNo = index + 1;
            row.customer = cust;
            row.inspections = inspectionMap[row.operationId] || [];
        });

        const firstArray = rows.filter(row => row.machineCode === "MATCHING_MACHINE_CODE");
        const lastArray = rows.filter(row => row.machineCode !== "MATCHING_MACHINE_CODE");

        const responseObject = {
            success: true,
            data: [...firstArray, ...lastArray]
        };

        res.status(200).json(responseObject);
    } catch (err) {
        console.error("Error in assemblyPlanShowType:", err);
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};

exports.productionShowType = async (req, res) => {
    try {
        const { date, item: itm, type } = req.body;
        const customer = "OTIS";

        if (!date || !itm || !type) {
            return res.status(400).json({ success: false, message: 'Missing required fields: date, item, or type' });
        }



        const sqlMain = `
            SELECT DISTINCT
                itmPm.machineName AS machineId, machines.machineCode,  itmPm.process AS processId,
                jC.jcNo, jC.id AS jCId, jC.Qty AS jcQty, jC.itemCode, jC.itemId,
                DATE_FORMAT(jC.created_at, '%d-%m-%Y') AS date,
                mst_pm.id AS operationId, mst_pm.name AS operation,
                inspec.status, inspec.addedBy,
                inspec.totQlty AS Qty
            FROM item_vs_pm itmPm
            INNER JOIN mrp ON mrp.itemId = itmPm.item
            INNER JOIN job_card AS jc ON jc.itemId = mrp.itemId
            INNER JOIN order_plannings AS op ON op.id = mrp.orderPlnId 
            INNER JOIN mst_pm ON mst_pm.id = itmPm.process
            INNER JOIN machines ON machines.id = itmPm.machineName
            INNER JOIN pm_inspeclist AS inspec ON
                inspec.jcId = jC.id AND
                itmPm.item = inspec.itemId AND
                itmPm.process = inspec.processId AND
                itmPm.machineName = inspec.machineId AND
                inspec.pmInnspecType = ?
            WHERE itmPm.dflag = 0 AND itmPm.item = ? AND op.kanbanDate = ?`;

        const [rows] = await connection.execute(sqlMain, [type, itm, date]);

        //console.log("data",rows)

        if (rows.length === 0) {
            return res.status(200).json({ success: true, message: 'No data found', data: [] });
        }

        const operationIds = [...new Set(rows.map(row => row.operationId))];
        if (operationIds.length === 0) {
            return res.status(200).json({ success: true, message: 'No operations found', data: [] });
        }

        // Step 1: Loop through each row to fetch individual actualResult
        const checkMap = {};
        const sqlCheck = `
            SELECT pmi.machineId, pmi.actualResult, pmi.itemId, 
                   pmi.processId AS operationId, pmi.qltyParameter
            FROM pm_inspeclist pmi
            WHERE pmi.jcId = ? AND pmi.itemId = ? AND pmi.machineId = ? AND pmi.processId = ? AND pmi.pmInnspecType = ?`;

        for (const row of rows) {
            const { jCId, itemId, machineId, processId } = row;
            const [checkResults] = await connection.execute(sqlCheck, [jCId, itemId, machineId, processId, type]);

            for (const result of checkResults) {
                const key = `${itemId}_${machineId}_${processId}_${result.qltyParameter}`;
                checkMap[key] = result.actualResult;
            }
        }

        // Step 2: Get all inspection definitions
        const sqlInspections = `
            SELECT 
                ivi.id, ivi.qltyParameter, ivi.expVisInspec, ivi.evalMethod, ivi.inspectionId,
                ivi.maxTolerance, ivi.minTolerance, ivi.expVal, ivi.addedBy, ivi.item AS itemId,
                ivi.inspectionType AS inspecCategory, ivi.process AS operationId,
                mst_uom.id AS uomId, mst_uom.code AS uom
            FROM itempm_vs_inspec ivi
            INNER JOIN mst_pm ON mst_pm.id = ivi.process
            INNER JOIN mst_uom ON mst_uom.id = ivi.uom
            WHERE ivi.dflag = 0 AND ivi.item = ? AND ivi.process IN (${operationIds.map(() => '?').join(', ')})`;

        const [subRows] = await connection.execute(sqlInspections, [itm, ...operationIds]);

        // Step 3: Attach inspections to rows with loop-based checkMap
        const inspectionMap = {};
        subRows.forEach((row, idx) => {
            row.sNo = idx + 1;
            row.actualResult = null; // Default

            if (!inspectionMap[row.operationId]) inspectionMap[row.operationId] = [];
            inspectionMap[row.operationId].push(row);
        });

        const enrichedRows = rows.map((row, idx) => {
            const { operationId, machineId, itemId } = row;
            const inspections = (inspectionMap[operationId] || []).map(ins => {
                const key = `${itemId}_${machineId}_${operationId}_${ins.qltyParameter}`;
                return {
                    ...ins,
                    actualResult: checkMap[key] || null
                };
            });

            return {
                ...row,
                type,
                id: idx + 1,
                sNo: idx + 1,
                customer,
                inspections
            };
        });

        // Organize response
        const machineId = rows[0]?.machineId;
        const firstArray = enrichedRows.filter(row => row.machineId === machineId);
        const lastArray = enrichedRows.filter(row => row.machineId !== machineId);

        res.status(200).json({ success: true, data: [...firstArray, ...lastArray] });

    } catch (err) {
        console.error('Error in productionShowType:', err);
        res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};







exports.assemblyPlanSubmit = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const data = req.body;
        const user = req.headers.username;
        const variableData = data.qlty || [];

        const contractList = Array.isArray(data.contractList) ? data.contractList : [data.contractList];

        for (const contract of contractList) {
            // Check if already exists
            const [existRows] = await conn.execute(
                `SELECT id FROM assembly_qlty_inspeclist_mst  
                 WHERE type = ? AND kanbanDate = ? AND contractNo = ? 
                   AND fimNo = ? AND itemId = ? AND processId = ?`,
                [
                    data.type, data.kanbanDate, contract,
                    data.fim, data.itemId, data.operationId
                ]
            );

            if (existRows.length > 0) {
                // console.log(`Skipping ${contract}: record already exists`);
                continue;
            }


            // Generate a new qcTestNo for each contract
            const [fRows] = await conn.execute('SELECT qcTestNo FROM assembly_qlty_inspeclist_mst ORDER BY id DESC LIMIT 1');
            let qcTestNo = 'QTN1';

            if (fRows.length > 0) {
                const lastFileId = fRows[0].qcTestNo;
                const numericPart = (lastFileId && lastFileId.match(/\d+/)) ? parseInt(lastFileId.match(/\d+/)[0]) : 0;
                qcTestNo = 'QTN' + (numericPart + 1);
            }

            // Insert into master table
            const [masterResult] = await conn.execute(
                `INSERT INTO assembly_qlty_inspeclist_mst 
                (qcTestNo, type, date, kanbanDate, customer, contractNo, fimNo, itemId, processId, machineId, totQty, rejRewQty, status, reason, remarks, addedBy, isAssemblyPlan)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    qcTestNo, data.type, data.date, data.kanbanDate, data.customer, contract, data.fim, data.itemId, data.operationId,
                    data.machId, data.qty, data.rejRewQty ?? null, data.status, data.reason, data.remarks, user, 1
                ]
            );

            const mstId = masterResult.insertId;

            // Insert inspection details
            const insertVariableQuery = `
                INSERT INTO assembly_qlty_inspeclist 
                (qltyParameter, expVal, maxTolerance, minTolerance, uomId, visual, evalutionMethod, actualResult, mstId)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            for (const item of variableData) {
                if (data.status === 'approved') {
                    validateTolerance(item); // throws if invalid
                }

                const row = [
                    item.qltyParameter, item.expVal, item.maxTolerance, item.minTolerance, item.uomId,
                    item.expVisInspec, item.evalMethod, item.actualResult, mstId
                ];

                await conn.execute(insertVariableQuery, row);
            }
        }
        await updateDocCounter(conn, 'AssemblyContractQC');

        await conn.commit();
        return handleSuccessResponse(res, "Data inserted successfully.");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


// exports.assemblyPlanSubmit = async (req, res) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();

//     try {
//         const data = req.body;
//         const user = req.headers.username;
//         const variableData = data.qlty || [];

//         let contractList = Array.isArray(data.contractList) ? data.contractList: [data.contractList];

//         // ------------------------------------------------------
//         // ✔ COMPLETE MODE: Insert only ONE contract record
//         // ------------------------------------------------------
//         if (data.inspecCategory === "Complete") {
//             let selectedContract = null;

//             // Find first NON-EXISTING contract
//             for (const contract of contractList) {
//                 const [existRows] = await conn.execute(
//                     `SELECT id FROM assembly_qlty_inspeclist_mst
//                      WHERE type = ? AND kanbanDate = ? AND contractNo = ?
//                        AND fimNo = ? AND itemId = ? AND processId = ?`,
//                     [
//                         data.type, data.kanbanDate, contract,
//                         data.fim, data.itemId, data.operationId
//                     ]
//                 );

//                 if (existRows.length === 0) {
//                     selectedContract = contract;
//                     break;  // Found the first contract which does NOT exist
//                 }
//             }

//             // If all contracts exist → no need to insert
//             if (!selectedContract) {
//                 await conn.rollback();
//                 return handleSuccessResponse(
//                     res,
//                     "All contracts already exist. No insertion needed."
//                 );
//             }

//             // Only insert this one contract
//             contractList = [selectedContract];
//         }

//         // ------------------------------------------------------
//         // ✔ SAMPLE BASED: Insert for all contracts
//         // ------------------------------------------------------

//         for (const contract of contractList) {

//             // Check if already exists
//             const [existRows] = await conn.execute(
//                 `SELECT id FROM assembly_qlty_inspeclist_mst
//                  WHERE type = ? AND kanbanDate = ? AND contractNo = ?
//                    AND fimNo = ? AND itemId = ? AND processId = ?`,
//                 [
//                     data.type, data.kanbanDate, contract,
//                     data.fim, data.itemId, data.operationId
//                 ]
//             );

//             if (existRows.length > 0) {
//                 console.log(`Skipping ${contract}: record already exists`);
//                 continue;
//             }

//             // Get new qcTestNo
//             const [fRows] = await conn.execute(
//                 'SELECT qcTestNo FROM assembly_qlty_inspeclist_mst ORDER BY id DESC LIMIT 1'
//             );

//             let qcTestNo = 'QTN1';
//             if (fRows.length > 0) {
//                 const lastFileId = fRows[0].qcTestNo;
//                 const numericPart = lastFileId?.match(/\d+/)
//                     ? parseInt(lastFileId.match(/\d+/)[0])
//                     : 0;
//                 qcTestNo = 'QTN' + (numericPart + 1);
//             }

//             // Insert master record
//             const [masterResult] = await conn.execute(
//                 `INSERT INTO assembly_qlty_inspeclist_mst
//                 (qcTestNo, type, date, kanbanDate, customer, contractNo, fimNo, itemId,
//                  processId, machineId, totQty, rejRewQty, status, reason, remarks,
//                  addedBy, isAssemblyPlan)
//                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//                 [
//                     qcTestNo, data.type, data.date, data.kanbanDate, data.customer,
//                     contract, data.fim, data.itemId, data.operationId, data.machId,
//                     data.qty, data.rejRewQty ?? null, data.status, data.reason,
//                     data.remarks, user, 1
//                 ]
//             );

//             const mstId = masterResult.insertId;

//             // Insert variable inspection rows
//             const insertVariableQuery = `
//                 INSERT INTO assembly_qlty_inspeclist
//                 (qltyParameter, expVal, maxTolerance, minTolerance, uomId, visual,
//                  evalutionMethod, actualResult, mstId)
//                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//             `;

//             for (const item of variableData) {
//                 if (data.status === 'approved') {
//                     validateTolerance(item);
//                 }

//                 await conn.execute(insertVariableQuery, [
//                     item.qltyParameter, item.expVal, item.maxTolerance,
//                     item.minTolerance, item.uomId, item.expVisInspec,
//                     item.evalMethod, item.actualResult, mstId
//                 ]);
//             }
//         }

//         await conn.commit();
//         return handleSuccessResponse(res, "Data inserted successfully.");

//     } catch (err) {
//         await conn.rollback();
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// };


const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const utility = require("../utility/utilityFunction");
const { toolUsageCountUpdate } = require('./toolComplaintController');
const { generateDocNo, formatFinancialYears, updateDocCounter } = require('../utility/docNo');



// exports.inwardProcess = async (req, res) => {
//     try {
//         const id = Number(req.params.id);

//         const sqlQuery = `
//             SELECT 
//                 mst_pm.id, mst_pm.code as process, mst_pm.id AS processId, qt.tempName
//             FROM 
//                 qlty_template qt
//             INNER JOIN mst_pm ON mst_pm.id = qt.process
//             WHERE 
//                 qt.type = 'Inward';
//         `;

//         const [rows] = await connection.execute(sqlQuery);

//         const modifiedRows = rows.map(row => ({ ...row, itemId: id }));
//         // //console.log(modifiedRows); // 

//         return handleSuccessResponse(res, 'Inward Process', modifiedRows);
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// }


exports.inwardProcess = async (req, res) => {
    try {
        const id = Number(req.params.id);

        const sqlQuery = `
            SELECT 
                mst_pm.id, mst_pm.code as process, mst_pm.id AS processId, qt.tempName
            FROM 
                item_vs_pm  ivp
            INNER JOIN qlty_template qt ON qt.process = ivp.process
            INNER JOIN mst_pm ON mst_pm.id = ivp.process
            WHERE 
                qt.type = 'Inward' AND ivp.item = ?; 
        `;

        const [rows] = await connection.execute(sqlQuery, [id]);

        const modifiedRows = rows.map(row => ({ ...row, itemId: id }));
        // //console.log(modifiedRows); // 

        return handleSuccessResponse(res, 'Inward Process', modifiedRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


exports.showData = async (req, res) => {
    try {
        const qlty = req.body;

        // Main query
        let query = `
            SELECT 
                pbd.accQty, pb.poNo, pb.id As pbId, supplier.id As spId, supplier.spCode, supplier.spName, 
                items.id As itemId, items.npdFile,  items.itemCode,  items.itemName, 
                DATE_FORMAT(pbd.created_at, '%d-%m-%Y') AS date,
                DATE_FORMAT(pbd.schDate, '%d-%m-%Y') AS schDate

            FROM po_bill_dtl pbd
                INNER JOIN po_bill  pb ON pbd.digit = pb.digit AND pb.type = pbd.type
                INNER JOIN supplier ON pb.spName = supplier.id
                INNER JOIN items ON pbd.itemName = items.id
                WHERE pb.qcApproval = 0 
                AND DATE(pbd.created_at) >= ? 
                AND DATE(pbd.created_at) <= ? 
        `;

        const queryParams = [qlty.from, qlty.to];

        // Add optional condition for `fim` if provided
        if (qlty.supplier) {
            query += ` AND supplier.id = ?`;
            queryParams.push(qlty.supplier);
        }

        // Execute the main query
        const [rows] = await connection.execute(query, queryParams);

        // Secondary query to fetch inspectionType
        const inspecQuery = `
            SELECT DISTINCT
              ivi.item, ivi.inspectionType
            FROM itempm_vs_inspec ivi
            WHERE  ivi.type = 'Inward'
        `;
        const [inspectionData] = await connection.execute(inspecQuery);

        // Map inspectionType to the rows based on itemId and ivi.item
        rows.forEach((element, index) => {
            element.id = index + 1;
            element.sNo = index + 1;

            // Find matching inspection data
            const match = inspectionData.find((inspection) => inspection.item === element.itemId);
            element.inspectionType = match ? match.inspectionType : null;
        });

        // Return response
        return res.status(200).json({
            success: true,
            message: "Items list",
            data: rows,
        });
    } catch (err) {
        console.error("Error fetching data:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "An error occurred while fetching data.",
        });
    }
};






exports.showType = async (req, res) => {
    try {
        const { poBillDtlId, item } = req.body;

        let sqlQuery;
        const cust = "OTIS";

        // Main query to fetch item details
        sqlQuery = `
            SELECT DISTINCT
                itmPm.item, itm.itemCode, machines.machineCode, machines.id AS machineId, 
                mst_pm.id AS operationId, mst_pm.name AS operation, NULL AS status , NULL AS addedBy,
                DATE_FORMAT(pbd.schDate, '%d-%m-%Y') AS schDate
                
            FROM 
                itempm_vs_inspec itmPm  
            INNER JOIN 
                po_bill_dtl AS pbd ON pbd.itemName = itmPm.item  
            INNER JOIN 
                items AS itm ON itm.id = itmPm.item  
            INNER JOIN 
                mst_pm ON mst_pm.id = itmPm.process
            INNER JOIN 
                machines_vs_pm_uom ON machines_vs_pm_uom.machineOperator = itmPm.process      
            INNER JOIN 
                machines ON machines.machineCode = machines_vs_pm_uom.machineCode  
            LEFT JOIN 
                inward_qc_mst AS inspec 
                ON   inspec.itemId = ? 
                AND inspec.processId = itmPm.process   
                AND inspec.machineId = machines.id    
            WHERE 
                itmPm.type = 'Inward' AND  itmPm.dflag = 0 AND itmPm.item = ? AND pbd.id = ?`;

        // Execute the query using parameterized inputs
        const [rows] = await connection.execute(sqlQuery, [item, item, poBillDtlId]);

        if (rows.length === 0) {
            return res.status(200).json({ success: true, message: 'No data found', data: [] });
        }

        // Extract operationIds from rows
        const operationIds = rows.map(row => row.operationId);

        // If no operationIds are found, skip the next query
        if (operationIds.length === 0) {
            return res.status(200).json({ success: true, message: 'No operations found', data: [] });
        }

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
                ivi.type = 'Inward' AND ivi.dflag = 0 AND ivi.item = ? 
            AND ivi.process IN (${operationIds.map(() => '?').join(', ')})`;

        const params = [item, ...operationIds];
        const [subRows] = await connection.execute(sqlQuery2, params);

        // Map inspections by operationId
        const inspectionMap = {};
        if (subRows.length > 0) {
            subRows.forEach((row, index) => {
                row.sNo = index + 1;
                if (!inspectionMap[row.operationId]) {
                    inspectionMap[row.operationId] = [];
                }

                // Attach actualResult to the row (if found) or null
                // row.actualResult = checkMap[row.operationId] ? checkMap[row.operationId].shift() : null;
                inspectionMap[row.operationId].push(row);
            });
        }

        // Enhance rows and attach inspections
        rows.forEach((row, index) => {
            row.id = index + 1;
            row.sNo = index + 1;
            row.customer = cust;
            row.inspectionType = subRows[0]?.inspecCategory || null;
            row.inspections = inspectionMap[row.operationId] || []; // Attach inspections or empty array
        });

        // Split rows into two arrays (example logic for splitting)
        const firstArray = rows.filter(row => row.machineCode === "MATCHING_MACHINE_CODE"); // Replace with your logic
        const lastArray = rows.filter(row => row.machineCode !== "MATCHING_MACHINE_CODE");

        // // Construct response object
        // const responseObject = {
        //     success: true,
        //     data: [...firstArray, ...lastArray]
        // };



        //     // Send response
        //     res.status(200).json(responseObject);
        // } catch (err) {
        //     console.error("Error in showType:", err);
        //     return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
        // }

        return handleSuccessResponse(res, "Qc Data", [...firstArray, ...lastArray]);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



exports.qcFile = async (req, res) => {
    try {

        const { file } = req.body;
        const user = req.headers.username;
        const id = req.params.id;


        if (!id) {
            return res.status(400).json({ success: false, message: "ID is required for updating the record." });
        }


        const filePath = utility.storeFile(file, 'qcFile');

        // Prepare the update query
        const updateQuery = `
            UPDATE po_bill 
            SET qcFile = ?, qcFileAdded = ?  WHERE id = ?`;

        const values = [
            filePath, user, id
        ];

        const [result] = await connection.query(updateQuery, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "No record found with the provided ID." });
        }

        return handleSuccessResponse(res, 'File uploaded successfully.');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.multiQcFile = async (req, res) => {
    try {
        const { file, type } = req.body;
        const user = req.headers.username;
        const id = req.params.id;

        if (!id) {
            return res.status(400).json({ success: false, message: "ID is required for updating the record." });
        }

        // Store file
        const filePath = utility.storeFile(file, 'qcFile');

        // Determine table based on type
        let updateQuery = "";

        if (type === "againstPo") {
            updateQuery = `
                UPDATE po_bill_dtl 
                SET qcFile = ?, qcFileAdded = ? 
                WHERE id = ?`;
        } else if (type === "withoutPo") {
            updateQuery = `
                UPDATE pob_wo_po_dtl 
                SET qcFile = ?, qcFileAdded = ?  
                WHERE id = ?`;
        }
        else {
            return res.status(400).json({ success: false, message: "Invalid type provided." });
        }

        // Values for both queries
        const values = [filePath, user, id];

        // Execute query
        const [result] = await connection.query(updateQuery, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "No record found with the provided ID." });
        }

        return handleSuccessResponse(res, "File uploaded successfully.");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


exports.uniqueId = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {

        const { padStartNo, uniqueNo } = await generateDocNo(
            conn,
            req,
            { docType: 'InwardQC' }
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


// Helper function to validate tolerances
const validateTolerance = (item) => {

    if (item.expVal === "Visual") {
        return;
    }
    const actual = parseFloat(item.actualResult);
    if (!actual) {
        throw new CustomError(`Actual Result can't be empty for  ${item.qltyParameter} Quality Parameter.`);

    }
    const expected = parseFloat(item.expVal);
    const maxTolerance = parseFloat(item.maxTolerance);
    const minTolerance = parseFloat(item.minTolerance);
    const upperBound = parseFloat((expected + maxTolerance).toFixed(2));
    const lowerBound = parseFloat((expected - minTolerance).toFixed(2));

    // //console.log("Upper Bound:", upperBound); // 9.8

    if (actual < lowerBound || actual > upperBound) {
        throw new CustomError(`Actual Result for ${item.qltyParameter} is not within Min-Max Tolerance.`);
    }
};

// const updateJCstatus = async (conn, user, poBillDtlId, process, accQty) => {
//     try {
//         if(!process) throw CustomError("Process can not be empty!", 400);

//         const [jobCardRow] = await conn.execute(`
//             SELECT sfg.id, pbd.poNo, pbd.itemName as itemId, pbd.itemCode, jc.jcNo, sfg.jcId, sfg.machine, sfg.nextProcess, pbd.conversionPartId, pbd.conversionPart, pbd.conversionQty
//             FROM po_bill_dtl pbd
//             INNER JOIN po_generate pg ON pg.id = pbd.poDtlId
//             INNER JOIN jobwork_issue_details jid ON jid.id = pg.jobWorkId
//             LEFT JOIN sfg ON sfg.id = jid.sfgId
//             LEFT JOIN job_card jc ON jc.id = sfg.jcId
//             WHERE pbd.id = ?`,
//             [poBillDtlId]
//         );

//         if (!jobCardRow.length) return;
//         const { poNo, jcId, jcNo, itemId, itemCode, machine, conversionPartId, conversionPart, conversionQty } = jobCardRow[0];

//         const [result] = await conn.execute(
//             `
//             UPDATE jobcard_planning 
//             SET producedQty = ?, acptQty = ?, qa = ? 
//             WHERE jcId = ? AND process = ?
//             `,
//             [accQty, accQty, user, jcId, process]
//         );

//         if (result.affectedRows === 0) {
//             throw new CustomError('Invalid process for the given PartNo');
//         }

//         // Check if more processes remain
//         const [nextRows] = await conn.execute(`
//             SELECT id 
//                 FROM jobcard_planning
//             WHERE jcId = ?
//             AND LOWER(machineName) NOT IN ('store', 'assembly')
//             AND id > (
//                 SELECT id
//                 FROM jobcard_planning
//                 WHERE jcId = ?
//                     AND process = ?
//                 ORDER BY id ASC
//                 LIMIT 1
//             )`, [jcId, jcId, process]
//         );

//         if (nextRows.length === 0) {
//             // Finalize JC
//             await conn.execute(`
//                 UPDATE job_card jc
//                 JOIN (
//                     SELECT id, verifiedQty + ? AS newVerified
//                     FROM job_card
//                     WHERE id = ?
//                 ) t ON jc.id = t.id
//                 SET 
//                     jc.verifiedQty = t.newVerified,
//                     jc.isCompleted = CASE 
//                         WHEN jc.Qty = t.newVerified THEN 1 
//                         ELSE 0 
//                     END,
//                     jc.completedDate = CASE 
//                         WHEN t.newVerified >= jc.Qty THEN NOW() 
//                         ELSE jc.completedDate 
//                     END,
//                     jc.status = CASE 
//                         WHEN jc.Qty = t.newVerified THEN 'Completed' 
//                         ELSE 'Pending' 
//                     END
//             `, [accQty, jcId]);

//             if (conversionPartId && conversionPart && conversionQty) {
//                 await conn.query(
//                     `INSERT INTO store (itemId, itemCode, docType, grnNo, docNo, inwardQty, addedBy) VALUES (?, ?, ?, ?, ?, ?, ?)`,
//                     [conversionPartId, conversionPart, 'Purchase Bill', poNo, poNo, conversionQty, user]
//                 );
//             } else {
//                 await conn.query(
//                     `INSERT INTO store (itemId, itemCode, docType, grnNo, docNo, inwardQty, addedBy) VALUES (?, ?, ?, ?, ?, ?, ?)`,
//                     [itemId, itemCode, 'Purchase Bill', poNo, poNo, accQty, user]
//                 );
//             }

//             await toolUsageCountUpdate(conn, jcNo, itemCode, accQty)
//         } else {
//             // Reset SFG for next process
//             await conn.execute(`UPDATE sfg SET sfgVerifiedQty = 0, jwQty = 0, jwPenQty = 0 WHERE jcId = ?`, [jcId]);
//         }

//         // Update JC entry to enable next process in HMI
//         const [processRows] = await conn.execute(`SELECT id FROM updated_jobcard_trail WHERE JCID = ? AND process = ?`, [jcId, process]);

//         if (processRows.length > 0) {
//             await conn.execute(`
//                 UPDATE updated_jobcard_trail SET JCQTY = JCQTY + ? WHERE JCID = ? AND process = ?`,
//                 [accQty, jcId, process]
//             );
//         } else {
//             await conn.execute(`
//                 INSERT INTO updated_jobcard_trail (JCID, JCNO, SITEMCODE, JCQTY, Process, Machine) 
//                 VALUES (?, ?, ?, ?, ?, ?)`,
//                 [jcId, jcNo, itemCode, accQty, process, machine]
//             );
//         }

//         return true;
//     } catch (err) {
//         throw err;
//     }
// };

const checkIfFinalProcess = async (conn, jcId, process) => {
    const [rows] = await conn.execute(`
        SELECT id 
        FROM jobcard_planning
        WHERE jcId = ?
        AND LOWER(machineName) NOT IN ('store', 'assembly')
        AND id > (
            SELECT id
            FROM jobcard_planning
            WHERE jcId = ?
            AND process = ?
            ORDER BY id ASC
            LIMIT 1
        )
    `, [jcId, jcId, process]);

    return rows.length === 0;
};

const finalizeJobCard = async (conn, jcId, accQty) => {
    await conn.execute(`
        UPDATE job_card jc
        JOIN (
            SELECT id, verifiedQty + ? AS newVerified
            FROM job_card
            WHERE id = ?
        ) t ON jc.id = t.id
        SET 
            jc.verifiedQty = t.newVerified,
            jc.isCompleted = CASE 
                WHEN jc.Qty = t.newVerified THEN 1 
                ELSE 0 
            END,
            jc.completedDate = CASE 
                WHEN t.newVerified >= jc.Qty THEN NOW()
                ELSE jc.completedDate 
            END,
            jc.status = CASE 
                WHEN jc.Qty = t.newVerified THEN 'Completed'
                ELSE 'Pending'
            END
    `, [accQty, jcId]);
};

const resetSFG = async (conn, jcId) => {
    await conn.execute(`
        UPDATE sfg 
        SET sfgVerifiedQty = 0, jwQty = 0, jwPenQty = 0 
        WHERE jcId = ?
    `, [jcId]);
};

const insertIntoStore = async (
    conn,
    conversionPartId,
    conversionPart,
    conversionQty,
    itemId,
    itemCode,
    poNo,
    accQty,
    user
) => {
    const finalItemId = conversionPartId && conversionPart && conversionQty
        ? conversionPartId
        : itemId;

    const finalItemCode = conversionPartId && conversionPart && conversionQty
        ? conversionPart
        : itemCode;

    const finalQty = conversionPartId && conversionPart && conversionQty
        ? conversionQty
        : accQty;

    await conn.query(`
        INSERT INTO store 
        (itemId, itemCode, docType, grnNo, docNo, inwardQty, addedBy) 
        VALUES (?, ?, 'Purchase Bill', ?, ?, ?, ?)
    `, [finalItemId, finalItemCode, poNo, poNo, finalQty, user]);
};

const updateJobcardTrail = async (
    conn,
    jcId,
    jcNo,
    itemCode,
    accQty,
    process,
    machine
) => {
    const [rows] = await conn.execute(`
        SELECT id 
        FROM updated_jobcard_trail 
        WHERE JCID = ? AND process = ?
    `, [jcId, process]);

    if (rows.length > 0) {
        await conn.execute(`
            UPDATE updated_jobcard_trail 
            SET JCQTY = JCQTY + ?
            WHERE JCID = ? AND process = ?
        `, [accQty, jcId, process]);
    } else {
        await conn.execute(`
            INSERT INTO updated_jobcard_trail 
            (JCID, JCNO, SITEMCODE, JCQTY, Process, Machine) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, [jcId, jcNo, itemCode, accQty, process, machine]);
    }
};

const updateJCstatus = async (conn, user, poBillDtlId, process, accQty) => {
    if (!process) throw CustomError("Process cannot be empty!", 400);

    try {
        /* -----------------------------------------------------
           1️⃣ Fetch Job Card Details
        ----------------------------------------------------- */
        const [rows] = await conn.execute(`
            SELECT 
                sfg.id,
                pbd.poNo,
                pbd.itemName AS itemId,
                pbd.itemCode,
                jc.jcNo,
                sfg.jcId,
                sfg.machine,
                sfg.nextProcess,
                pbd.conversionPartId,
                pbd.conversionPart,
                pbd.conversionQty
            FROM po_bill_dtl pbd
            INNER JOIN po_generate pg ON pg.id = pbd.poDtlId
            INNER JOIN jobwork_issue_details jid ON jid.id = pg.jobWorkId
            LEFT JOIN sfg ON sfg.id = jid.sfgId
            LEFT JOIN job_card jc ON jc.id = sfg.jcId
            WHERE pbd.id = ?
        `, [poBillDtlId]);

        if (!rows.length) return;

        const {
            poNo,
            jcId,
            jcNo,
            itemId,
            itemCode,
            machine,
            conversionPartId,
            conversionPart,
            conversionQty
        } = rows[0];

        /* -----------------------------------------------------
           2️⃣ Update Jobcard Planning
        ----------------------------------------------------- */
        const [result] = await conn.execute(`
            UPDATE jobcard_planning 
            SET producedQty = ?, acptQty = ?, qa = ?
            WHERE jcId = ? AND process = ?
        `, [accQty, accQty, user, jcId, process]);

        const isJobCardItem = result.affectedRows > 0; // (rows[0].sfgId instead of affected Rows)

        /* -----------------------------------------------------
           3️⃣ Handle JobCard Items
        ----------------------------------------------------- */
        if (isJobCardItem) {
            const isFinalProcess = await checkIfFinalProcess(conn, jcId, process);

            if (isFinalProcess) {
                await finalizeJobCard(conn, jcId, accQty);
                await insertIntoStore(
                    conn,
                    conversionPartId,
                    conversionPart,
                    conversionQty,
                    itemId,
                    itemCode,
                    poNo,
                    accQty,
                    user
                );

                await toolUsageCountUpdate(conn, jcNo, itemCode, accQty);
            } else {
                await resetSFG(conn, jcId);
            }
        } else {
            /* -----------------------------------------------------
               4️⃣ Non JobCard Items
            ----------------------------------------------------- */
            await insertIntoStore(
                conn,
                conversionPartId,
                conversionPart,
                conversionQty,
                itemId,
                itemCode,
                poNo,
                accQty,
                user
            );
        }

        /* -----------------------------------------------------
           5️⃣ Update HMI Trail
        ----------------------------------------------------- */
        await updateJobcardTrail(conn, jcId, jcNo, itemCode, accQty, process, machine);

        return true;

    } catch (err) {
        throw err;
    }
};


// Helper function to validate tolerances
const validateTolerance2 = (item, resultValue) => {
    // if (item.expVal === "Visual") return;
    // Skip validation for specific expVal values
    const skipList = ["Visual", "M4", "M3", "M6", "M8", "M10", "M12"];
    if (skipList.includes(item.expVal)) return;

    const actual = parseFloat(resultValue);
    if (isNaN(actual)) {
        throw new CustomError(`Actual Result can't be empty or invalid for ${item.qltyParameter}.`);
    }

    const expected = parseFloat(item.expVal);
    const maxTolerance = parseFloat(item.maxTolerance);
    const minTolerance = parseFloat(item.minTolerance);
    const upperBound = parseFloat((expected + maxTolerance).toFixed(2));
    const lowerBound = parseFloat((expected - minTolerance).toFixed(2));

    if (actual < lowerBound || actual > upperBound) {
        throw new CustomError(`Actual Result (${actual}) for ${item.qltyParameter} is not within Min-Max Tolerance.`);
    }
};

// Main function
exports.submit = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const data = req.body;
        const user = req.headers.username;
        const variableData = data.qlty;

        if (!Array.isArray(variableData) || variableData.length === 0) {
            throw new CustomError(`Quality data can't be empty`);
        }

        // Check poBill validity
        const [checkId] = await conn.execute(
            `SELECT id, poNo, type FROM po_bill WHERE id = ?`,
            [data.poBillId]
        );

        if (checkId.length === 0) {
            throw new CustomError(`poId mismatched, not able to submit. Kindly refresh the page`);
        }

        // Handle JC update if needed
        if (checkId[0].type === 'J') {
            await updateJCstatus(conn, user, data.poBillDtlId, data.process, data.accQty);
        }

        // Insert into inward_qc_mst
        const [result] = await conn.execute(
            `INSERT INTO inward_qc_mst 
                (qcTestNo, date, supplier, poBillId, poBillDtlId, schDate, itemId, processId, machineId, totQty, status, reason, remarks, addedBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.qcTestNo, data.date, data.spCode, data.poBillId, data.poBillDtlId,
                data.schDate, data.itemId, data.operationId, data.machId,
                data.Qty, data.status, data.reason, data.remarks, user
            ]
        );

        const mstId = result.insertId;

        // Dynamically build query and data for inward_qc_list
        for (const item of variableData) {
            const resultColumns = [];
            const resultValues = [];

            // Collect actualResult1...actualResult30 dynamically
            for (let i = 1; i <= 30; i++) {
                const key = `actualResult${i}`;
                if (item[key] !== undefined && item[key] !== null && item[key] !== "") {
                    resultColumns.push(key);
                    resultValues.push(item[key]);

                    // Corrected: use validateTolerance2
                    if (data.status === 'approved') {
                        validateTolerance2(item, item[key]);
                    }
                }
            }

            // Fallback for single actualResult (old data structure)
            if (resultColumns.length === 0 && item.actualResult !== undefined) {
                resultColumns.push('actualResult');
                resultValues.push(item.actualResult);

                if (data.status === 'approved') {
                    validateTolerance2(item, item.actualResult);
                }
            }

            // Dynamic insert query
            const baseColumns = [
                "qltyParameter",
                "expVal",
                "maxTolerance",
                "minTolerance",
                "uomId",
                "visual",
                "evalutionMethod",
                ...resultColumns,
                "mstId",
            ];

            const placeholders = baseColumns.map(() => "?").join(", ");
            const insertQuery = `INSERT INTO inward_qc_list (${baseColumns.join(", ")}) VALUES (${placeholders})`;

            const values = [
                item.qltyParameter,
                item.expVal,
                item.maxTolerance,
                item.minTolerance,
                item.uomId,
                item.expVisInspec,
                item.evalMethod,
                ...resultValues,
                mstId,
            ];

            await conn.execute(insertQuery, values);
        }


        // // Update QC Approval in po_bill_dtl
        // await conn.execute(
        //     `UPDATE po_bill_dtl SET qcAuthBy = ?,  issueQoh = ?, qcApproval = 1 WHERE id = ?`,
        //     [user,  data.accQty, data.poBillDtlId]
        // );

        const issueQoh = Number(data.conversionQty) > 0 ? Number(data.conversionQty) : Number(data.accQty);

        // Update QC Approval in po_bill_dtl
        await conn.execute(
            `UPDATE po_bill_dtl
                SET qcAuthBy = ?,
                    issueQoh = ?,
                    qcApproval = 1
                 WHERE id = ?
                    AND qcApproval <> 1
                `,
            [user, issueQoh, data.poBillDtlId]);


        // await updateDocCounter(conn, 'InwardQC');
        await updateDocCounter(conn, 'InwardQC', { docNo: data.qcTestNo });
        await conn.commit();

        return res.status(200).json({
            success: true,
            message: "Data added successfully.",
        });
    } catch (err) {
        if (conn) await conn.rollback();

        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                message: "QC report has already been added"
            });
        }

        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};

// Manually QC Approve
exports.qcApprove = async (req, res) => {
    try {
        const type = req.query.type;
        const { ids } = req.body;
        const user = req.headers.username;

        if (!Array.isArray(ids) || ids.length === 0) {
            throw new CustomError('Invoice IDs are required', 400);
        }

        // Build placeholders for the IN clause
        const placeholders = ids.map(() => '?').join(',');

        if (type == 1) {
            await connection.execute(
                `UPDATE po_bill_dtl 
                  SET qcAuthBy = ?, qcApproval = ? 
                  WHERE id IN (${placeholders})`,
                [user, 1, ...ids]
            );
        } else {
            await connection.execute(
                `UPDATE pob_wo_po_dtl 
                  SET qcAuthBy = ?, qcApproval = ? 
                  WHERE id IN (${placeholders})`,
                [user, 1, ...ids]
            );
        }

        return handleSuccessResponse(res, 'QC Approved Successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



exports.searchPo = async (req, res) => {
    try {
        const { q } = req.query;

        let query = `
            SELECT pbd.poNo
            FROM po_bill_dtl pbd
            INNER JOIN inward_qc_mst qc ON qc.poBillDtlId = pbd.id
        `;

        const values = [];

        if (q) {
            query += ` WHERE pbd.poNo LIKE ?`;
            values.push(`%${q}%`);
        }

        query += ` GROUP BY pbd.poNo`;

        const [rows] = await connection.execute(query, values);

        return res.status(200).json({
            success: true,
            message: "Po List",
            data: rows
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: "Internal server error.",
            error: err.message
        });
    }
};

exports.report = async (req, res) => {
    try {

        const { sup, po, from, to } = req.body;

        let sqlQuery = `
            SELECT 
                qcMst.id, qcMst.qcTestNo, qcMst.type, qcMst.status, qcMst.addedBy, 
                qcMst.totQty, qcMst.poBillDtlId,
                mst_pm.code AS process,
                items.itemCode,
                mach.machineCode,
                DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') AS date,

                -- Use pb.qcFile first, if NULL then use po.qcFile
                COALESCE(pb.qcFile, po.qcFile) AS qcFile,

                -- Same for qcFileAdded
                COALESCE(pb.qcFileAdded, po.qcFileAdded) AS qcFileAdded,

                po.poNo,
                sup.spCode,
                sup.spName

            FROM inward_qc_mst qcMst
            INNER JOIN po_bill_dtl pb    ON pb.id = qcMst.poBillDtlId
            INNER JOIN po_bill po        ON po.id = qcMst.poBillId
            INNER JOIN supplier sup      ON sup.id = pb.spName          
            INNER JOIN items             ON items.id = qcMst.itemId  
            INNER JOIN mst_pm            ON mst_pm.id = qcMst.processId
            INNER JOIN machines mach     ON mach.id = qcMst.machineId
            WHERE 1=1
        `;

        const params = [];

        // Supplier filter
        if (sup) {
            sqlQuery += ` AND pb.spName = ?`;
            params.push(sup);
        }

        // PO filter
        if (po) {
            sqlQuery += ` AND pb.poNo = ?`;
            params.push(po);
        }

        // Date range filter
        if (from && to) {
            sqlQuery += ` AND DATE(qcMst.created_at) BETWEEN ? AND ?`;
            params.push(from, to);
        }

        // Default to today's date ONLY when no filters are given
        if (!sup && !po && !(from && to)) {
            sqlQuery += ` AND DATE(qcMst.created_at) = CURDATE()`;
        }

        const [rows] = await connection.execute(sqlQuery, params);

        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return handleSuccessResponse(res, 'Inward Qc Report', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};





exports.reportView = async (req, res) => {
    try {
        const { id } = req.params;

        const sqlQuery = `
            SELECT 
                qcInspec.*,
                mach.machineCode, mst_pm.code as process, mst_uom.code as uom,
                itm.itemCode, itm.itemName, po_bill.poNo,
                qcMst.qcTestNo, qcMst.addedBy, qcMst.supplier, qcMst.status, qcMst.remarks,
                qcMst.totQty, DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as date
            FROM 
                inward_qc_list qcInspec
                INNER JOIN inward_qc_mst AS qcMst ON qcMst.id = qcInspec.mstId
                INNER JOIN items AS itm ON itm.id = qcMst.itemId 
                INNER JOIN mst_pm ON mst_pm.id = qcMst.processId
                INNER JOIN machines AS mach ON mach.id = qcMst.machineId
                INNER JOIN mst_uom ON mst_uom.id = qcInspec.uomId
                INNER JOIN po_bill ON po_bill.id = qcMst.poBillId
            WHERE qcMst.id = ?;
        `;

        const [rows] = await connection.execute(sqlQuery, [id]);

        // Fetch company data
        const [companyData] = await connection.execute(
            `SELECT companyName, image FROM company_details LIMIT 1`
        );

        const company = companyData.length ? companyData[0] : { companyName: null, image: null };

        // Add company info inside each row
        const processedRows = rows.map((row, index) => {
            row.sNo = index + 1;

            // Remove empty actualResult columns
            Object.keys(row).forEach(key => {
                if (key.startsWith('actualResult') && (!row[key])) {
                    delete row[key];
                }
            });

            // Inject company info inside each row
            row.companyName = company.companyName;
            row.companyImage = company.image;

            return row;
        });

        return handleSuccessResponse(res, 'Qc Report', processedRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};




exports.rejected = async (req, res) => {
    try {
        const { from, to } = req.body;

        let sqlQuery = `
            SELECT 
                qcMst.id, qcMst.qcTestNo,  qcMst.status, qcMst.addedBy, qcMst.supplier,
                mst_pm.code AS process, items.itemCode, mach.machineCode, qcMst.totQty,
                DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as date, pbd.poNo
            FROM 
                inward_qc_mst qcMst
            INNER JOIN 
                po_bill_dtl pbd ON pbd.id = qcMst.poBillDtlId  
            INNER JOIN 
                items ON qcMst.itemId = items.id  
            INNER JOIN 
                mst_pm ON mst_pm.id = qcMst.processId
            INNER JOIN 
                machines AS mach ON mach.id = qcMst.machineId
            WHERE 
                qcMst.status = "scarp"
        `;

        const params = [];

        if (from && to) {
            sqlQuery += ` AND DATE(qcMst.created_at) BETWEEN ? AND ?`;
            params.push(from, to);
        } else {
            sqlQuery += ` AND DATE(qcMst.created_at) = CURDATE()`;
        }

        const [rows] = await connection.execute(sqlQuery, params);

        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return handleSuccessResponse(res, 'Rejected Items', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



// *********************************************************                   INWARD WITHOUT PO               *********************************************************************//




exports.withoutPoShowType = async (req, res) => {
    try {
        const { poBillDtlId, item, qty } = req.body;

        let sqlQuery;
        const cust = "OTIS";

        sqlQuery = `
            SELECT DISTINCT
                itmPm.item, itm.itemCode, machines.machineCode, machines.id AS machineId, 
                mst_pm.id AS operationId, mst_pm.name AS operation, NULL AS status , NULL AS addedBy,
                DATE_FORMAT(pbd.schDate, '%d-%m-%Y') AS schDate
                
            FROM 
                itempm_vs_inspec itmPm  
            INNER JOIN 
                pob_wo_po_dtl AS pbd ON pbd.itemId = itmPm.item  
            INNER JOIN 
                items AS itm ON itm.id = itmPm.item  
            INNER JOIN 
                mst_pm ON mst_pm.id = itmPm.process
            INNER JOIN 
                machines_vs_pm_uom ON machines_vs_pm_uom.machineOperator = itmPm.process      
            INNER JOIN 
                machines ON machines.machineCode = machines_vs_pm_uom.machineCode  
            LEFT JOIN 
                inward_qc_withoutpo_mst AS inspec 
                ON   inspec.itemId = ? 
                AND inspec.processId = itmPm.process   
                AND inspec.machineId = machines.id    
            WHERE 
                itmPm.dflag = 0 AND pbd.id = ?`;

        // Execute the query using parameterized inputs
        const [rows] = await connection.execute(sqlQuery, [item, poBillDtlId]);

        if (rows.length === 0) {
            return res.status(200).json({ success: true, message: 'No data found', data: [] });
        }

        // Extract operationIds from rows
        const operationIds = rows.map(row => row.operationId);

        // If no operationIds are found, skip the next query
        if (operationIds.length === 0) {
            return res.status(200).json({ success: true, message: 'No operations found', data: [] });
        }



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
                ivi.type = 'Inward' AND ivi.dflag = 0 AND ivi.item = ? 
            AND ivi.process IN (${operationIds.map(() => '?').join(', ')})`;

        const params = [item, ...operationIds];
        const [subRows] = await connection.execute(sqlQuery2, params);

        // console.log(subRows)

        // Map inspections by operationId
        const inspectionMap = {};
        if (subRows.length > 0) {
            subRows.forEach((row, index) => {
                row.sNo = index + 1;
                if (!inspectionMap[row.operationId]) {
                    inspectionMap[row.operationId] = [];
                }

                // Attach actualResult to the row (if found) or null
                // row.actualResult = checkMap[row.operationId] ? checkMap[row.operationId].shift() : null;
                inspectionMap[row.operationId].push(row);
            });
        }

        // Enhance rows and attach inspections
        rows.forEach((row, index) => {
            row.id = index + 1;
            row.sNo = index + 1;
            row.customer = cust;
            row.inspectionType = subRows[0].inspecCategory;
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





exports.withoutPoUniqueId = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {

        const { padStartNo, uniqueNo } = await generateDocNo(
            conn,
            req,
            { docType: 'InwardQC' }
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



exports.withoutPosubmit = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const data = req.body;
        const user = req.headers.username;
        const variableData = data.qlty;

        if (!Array.isArray(variableData) || variableData.length === 0) {
            throw new CustomError(`Quality data can't be empty`);
        }

        // Insert master record
        const [result] = await conn.execute(
            `INSERT INTO inward_qc_withoutpo_mst 
                (qcTestNo, date, supplier, poBillId, poBillDtlId, schDate, itemId, processId, machineId, totQty, status, reason, remarks, addedBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.qcTestNo, data.date, data.spCode, data.poBillId, data.poBillDtlId,
                data.schDate, data.itemId, data.operationId, data.machId,
                data.Qty, data.status, data.reason, data.remarks, user
            ]
        );

        const mstId = result.insertId;

        // Dynamically build insert query for each variable record
        for (const item of variableData) {
            const resultColumns = [];
            const resultValues = [];

            // Collect actualResult1...actualResult30 dynamically
            for (let i = 1; i <= 30; i++) {
                const key = `actualResult${i}`;
                if (item[key] !== undefined && item[key] !== null && item[key] !== "") {
                    resultColumns.push(key);
                    resultValues.push(item[key]);

                    // Validate each actualResult if status = approved
                    if (data.status === "approved") {
                        validateTolerance2(item, item[key]);
                    }
                }
            }

            // Fallback for single actualResult (old structure)
            if (resultColumns.length === 0 && item.actualResult !== undefined) {
                resultColumns.push("actualResult");
                resultValues.push(item.actualResult);

                if (data.status === "approved") {
                    validateTolerance2(item, item.actualResult);
                }
            }

            // Fixed columns that are always inserted
            const fixedColumns = [
                "qltyParameter",
                "expVal",
                "maxTolerance",
                "minTolerance",
                "uomId",
                "visual",
                "evalutionMethod",
                "mstId"
            ];

            const insertColumns = [...fixedColumns.slice(0, -1), ...resultColumns, "mstId"];
            const placeholders = insertColumns.map(() => "?").join(", ");

            const insertQuery = `
                INSERT INTO inward_qc_withoutpo_list (${insertColumns.join(", ")})
                VALUES (${placeholders})
            `;

            const insertValues = [
                item.qltyParameter,
                item.expVal,
                item.maxTolerance,
                item.minTolerance,
                item.uomId,
                item.expVisInspec,
                item.evalMethod,
                ...resultValues,
                mstId
            ];

            await conn.execute(insertQuery, insertValues);
        }

        // // Update QC approval info
        // await conn.execute(
        //     `UPDATE pob_wo_po_dtl 
        //      SET qcAuthBy = ?, issueQoh = ?,  qcApproval = 1 
        //      WHERE id = ?`,
        //     [user, data.accQty, data.poBillDtlId]
        // );


        const issueQoh = Number(data.conversionQty) > 0 ? Number(data.conversionQty) : Number(data.accQty);

        // Update QC Approval in po_bill_dtl
        await conn.execute(
            `UPDATE pob_wo_po_dtl
                SET qcAuthBy = ?,
                    issueQoh = ?,
                    qcApproval = 1
                WHERE id = ?
                AND qcApproval <> 1`,
            [user, issueQoh, data.poBillDtlId]);

        await updateDocCounter(conn, 'InwardQC', { docNo: data.qcTestNo });

        await conn.commit();

        return res.status(200).json({
            success: true,
            message: "Data added successfully.",
        });

    } catch (err) {
        await conn.rollback();
        // return res.status(400).json({
        //     success: false,
        //     message: err.message || "Internal server error",
        //     error: err.stack || err
        // });

        return handleErrorResponse(res, err);

    } finally {
        conn.release();
    }
};





exports.withoutPoQcFile = async (req, res) => {
    try {

        const { file } = req.body;
        const user = req.headers.username;
        const id = req.params.id;


        if (!id) {
            return res.status(400).json({ success: false, message: "ID is required for updating the record." });
        }


        const filePath = utility.storeFile(file, 'qcFile');

        // Prepare the update query
        const updateQuery = `
            UPDATE po_bill 
            SET qcFile = ?, qcFileAdded = ?  WHERE id = ?`;

        const values = [
            filePath, user, id
        ];

        const [result] = await connection.query(updateQuery, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "No record found with the provided ID." });
        }

        return res.status(200).json({ success: true, message: "File uploaded successfully." });
    } catch (error) {
        console.error('Unexpected error:', error);
        return res.status(500).json({
            success: false,
            message: 'An unexpected error occurred',
            error: error.message
        });
    }
};

exports.withoutPoSearch = async (req, res) => {
    try {
        const { q } = req.query;

        let query = `
            SELECT pbd.poNo
            FROM pob_wo_po_dtl pbd
            INNER JOIN inward_qc_withoutpo_mst qc ON qc.poBillDtlId = pbd.id
        `;

        const values = [];

        if (q) {
            query += ` WHERE pbd.poNo LIKE ?`;
            values.push(`%${q}%`);
        }

        query += ` GROUP BY pbd.poNo`;

        const [rows] = await connection.execute(query, values);

        return res.status(200).json({
            success: true,
            message: "Po List",
            data: rows
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: "Internal server error.",
            error: err.message
        });
    }
};


exports.withoutPoReport = async (req, res) => {
    try {


        const { sup, po, from, to } = req.body;


        // Construct the SQL query
        let sqlQuery = `
            SELECT 
                qcMst.id, qcMst.qcTestNo, qcMst.type, qcMst.status, qcMst.addedBy, qcMst.poBillDtlId,
                mst_pm.code AS process, items.itemCode, mach.machineCode, qcMst.totQty,
                DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as date, pbd.poNo, sup.spCode, sup.spName, pbd.qcFile, pbd.qcFileAdded
            FROM 
                inward_qc_withoutpo_mst qcMst
            INNER JOIN 
                pob_wo_po_dtl  pbd ON pbd.id = qcMst.poBillDtlId  
            INNER JOIN 
                items ON qcMst.itemId = items.id  
            INNER JOIN 
                supplier sup  ON sup.id = pbd.supId          
            INNER JOIN 
                mst_pm ON mst_pm.id = qcMst.processId
            INNER JOIN 
                machines AS mach ON mach.id = qcMst.machineId
            WHERE 1=1
           `;

        // Add conditions for 'from' and 'to' if they are provided
        const params = [];

        // Supplier filter
        if (sup) {
            sqlQuery += ` AND pbd.supId = ?`;
            params.push(sup);
        }

        // PO filter
        if (po) {
            sqlQuery += ` AND pbd.poNo = ?`;
            params.push(po);
        }

        // Date range filter
        if (from && to) {
            sqlQuery += ` AND DATE(qcMst.created_at) BETWEEN ? AND ?`;
            params.push(from, to);
        }

        // Default to today's date ONLY when no filters are given
        if (!sup && !po && !(from && to)) {
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




exports.withoutPoReportView = async (req, res) => {
    try {
        const { id } = req.params;

        // Construct the SQL query
        const sqlQuery = `
            SELECT 
                qcInspec.*,
                mach.machineCode, mst_pm.code as process, mst_uom.code as uom,
                itm.itemCode, itm.itemName, pob_wo_po.poNo,
                qcMst.qcTestNo, qcMst.addedBy, qcMst.supplier, qcMst.status, qcMst.remarks,
                qcMst.totQty, DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as date
            FROM 
                inward_qc_withoutpo_list qcInspec
                INNER JOIN inward_qc_withoutpo_mst AS qcMst ON qcMst.id = qcInspec.mstId
                INNER JOIN items AS itm ON itm.id = qcMst.itemId 
                INNER JOIN mst_pm ON mst_pm.id = qcMst.processId
                INNER JOIN machines AS mach ON mach.id = qcMst.machineId
                INNER JOIN mst_uom ON mst_uom.id = qcInspec.uomId
                INNER JOIN pob_wo_po ON pob_wo_po.id = qcMst.poBillId
            WHERE 
               qcMst.id = ?;`;

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, [id]);

        // Fetch company data
        const [companyData] = await connection.execute(
            `SELECT companyName, image FROM company_details LIMIT 1`
        );

        const company = companyData.length ? companyData[0] : { companyName: null, image: null };

        // Add company info inside each row
        const processedRows = rows.map((row, index) => {
            row.sNo = index + 1;

            // Remove empty actualResult columns
            Object.keys(row).forEach(key => {
                if (key.startsWith('actualResult') && (!row[key])) {
                    delete row[key];
                }
            });

            // Inject company info inside each row
            row.companyName = company.companyName;
            row.companyImage = company.image;

            return row;
        });

        return handleSuccessResponse(res, 'Qc Report', processedRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}







exports.withoutPorejected = async (req, res) => {
    try {
        const { from, to } = req.body;

        let sqlQuery = `
            SELECT 
                qcMst.id, qcMst.qcTestNo,  qcMst.status, qcMst.addedBy, qcMst.supplier,
                mst_pm.code AS process, items.itemCode, mach.machineCode, qcMst.totQty,
                DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as date, pbd.poNo
            FROM 
                inward_qc_withoutpo_mst qcMst
            INNER JOIN 
                pob_wo_po_dtl pbd ON pbd.id = qcMst.poBillDtlId  
            INNER JOIN 
                items ON qcMst.itemId = items.id  
            INNER JOIN 
                mst_pm ON mst_pm.id = qcMst.processId
            INNER JOIN 
                machines AS mach ON mach.id = qcMst.machineId
            WHERE 
                qcMst.status = "scrap"
        `;

        const params = [];

        if (from && to) {
            sqlQuery += ` AND DATE(qcMst.created_at) BETWEEN ? AND ?`;
            params.push(from, to);
        } else {
            sqlQuery += ` AND DATE(qcMst.created_at) = CURDATE()`;
        }

        const [rows] = await connection.execute(sqlQuery, params);

        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return handleSuccessResponse(res, 'Rejected Items', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.updateOneQcFile = async (req, res) => {
    const conn = await connection.getConnection();
    try {

        const sql = `
            UPDATE po_bill_dtl AS d
            JOIN view_po_bill_qc AS v ON v.poNo = d.poNo
            SET d.qcFile = v.qcFile
            WHERE d.qcFile IS NULL
            LIMIT 10;
        `;

        const [result] = await conn.query(sql);

        return res.json({
            updatedRows: result.affectedRows,
            message: result.affectedRows > 0
                ? "One record updated successfully"
                : "No record found to update"
        });

    } catch (err) {
        console.error("Error updating qcFile:", err);
        return res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
};

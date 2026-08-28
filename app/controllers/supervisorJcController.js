
const { connection, handleSuccessResponse, handleErrorResponse, CustomError } = require('../config/dbSql');
const { updateDocCounter, formatFinancialYears } = require('../utility/docNo');
const { updateCounter, getUser } = require('../utility/utilityFunction');
const { updateNextProcess } = require('./sfgVerificationController');
const { generateSrnNo, insertSrnItems } = require("./srnController");


exports.jobCard = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body;
        const jcValues = [];

        let fetchJc = `
            SELECT  jc.id, jc.jcNo, jc.itemCode, items.id AS itemId, jc.Qty, jc.Produced_QTY AS producedQty, 
                jc.High_escalation, jc.status, items.npdFile, items.rmThickness,  jc.supervisorCls,
                DATE_FORMAT(jc.created_at, '%d-%m-%Y') AS created_at,
                DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
            FROM job_card jc
            INNER JOIN items ON items.id = jc.itemId
            LEFT JOIN mrp_mst mm ON mm.id = jc.mrpMstId
            LEFT JOIN order_plannings op ON op.id = mm.orderPlnId
            WHERE 1 = 1
        `;


        // if (fromDate && toDate) {
        //     fetchJc += ` AND date(jc.created_at) >= ? AND date(jc.created_at) <= ?`;
        //     jcValues.push(fromDate, toDate);
        // } else {
        //     fetchJc += ` AND jc.created_at = CURDATE()`;
        // }

        if (fromDate && toDate) {
            fetchJc += ` AND date(op.kanbanDate) >= ? AND date(op.kanbanDate) <= ?`;
            jcValues.push(fromDate, toDate);
        } else {
            fetchJc += ` AND op.kanbanDate = CURDATE()`;
        }

        fetchJc += `
            GROUP BY jc.id, jc.mrpMstId
            ORDER by op.orderPriority, items.materialThickness
        `;

        const [jcRows] = await connection.execute(fetchJc, jcValues);
        return res.json({ success: true, data: jcRows });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// jc.supervisorCls:
// 0:Incomplete, 1:Completed, 2:Pending, 3:Awaiting for Vendor Process



//GET Machines From Stored in nesting_table
exports.machine = async (req, res) => {
    try {

        const query = `
            SELECT  DISTINCT
                Machine_name
            FROM nesting_table 
            ORDER BY ID DESC`;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            rows.forEach((element, index) => {
                element.id = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Machine list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



//GET Material_Name From Stored in nesting_table
exports.material = async (req, res) => {
    try {

        const query = `
            SELECT DISTINCT TRIM(REPLACE(Material_Name, '\\r', '')) AS Material_Name
            FROM nesting_table
            ORDER BY ID DESC
        `;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            rows.forEach((element, index) => {
                element.id = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Material list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}


exports.nestShow = async (req, res) => {
    try {
        const { machine, material, thickness, from, to } = req.body;

        // Define the base query
        let query = `
            SELECT 
                nt.id, 
                DATE_FORMAT(nt.date, '%d-%m-%Y') as date, 
                nt.Dimension, 
                nt.Thickness, 
                nt.Sheet_qty AS Qty,
                nt.Jobcard_no, 
                nt.Machine_name, 
                nt.Nesting_no, 
                nt.Material_Name,  
                nt.Kanbandate, 
                nt.Pdf_link,
                mrp_mst.mrpNo,
                mrp_mst.id as mrpMstId,
                jc.grn,
                items.netWeight,
                items.itemName,
                items.itemCode,
                pf.name AS pf
            FROM nesting_table nt
            INNER JOIN items ON items.itemCode = nt.Material_Name
            INNER JOIN job_card  jc ON jc.jcNo = nt.Jobcard_no
            LEFT JOIN mrp_mst ON mrp_mst.id = jc.mrpMstId
            LEFT JOIN item_product_family pf ON items.productFamily = pf.id
            WHERE nt.Pdf_link IS NOT NULL 
            AND nt.isRqst = 0
        `;
        const params = [];
        let conditions = [];

        // Add conditions based on provided filters
        if (machine) {
            conditions.push(`nt.Machine_name = ?`);
            params.push(machine);
        }

        if (material) {
            conditions.push(`nt.Material_Name = ?`);
            params.push(material);
        }

        if (thickness) {
            conditions.push(`nt.Thickness = ?`);
            params.push(thickness);
        }

        if (from && to) {
            conditions.push(`STR_TO_DATE(nt.Kanbandate, '%d-%m-%Y') BETWEEN ? AND ?`);
            params.push(from, to);
        }

        // Add conditions to the query if there are any
        if (conditions.length > 0) {
            query += ` AND ` + conditions.join(' AND ');
        }

        // Add GROUP BY and ORDER BY clauses
        query += ` GROUP BY nt.Nesting_no ORDER BY nt.id DESC`;

        const [check] = await connection.execute(query, params);

        // if (check.length === 0) {
        //     return res.status(404).json({ success: false, message: "Nesting number not found" });
        // }

        // Loop through each item and calculate totQty
        check.forEach((element, index) => {
            // Calculate totQty
            const sheetQty = element.Qty || 0;  // default to 0 if null
            const netWeight = element.netWeight || 0; // default to 0 if null
            const totQty = parseFloat((sheetQty * netWeight).toFixed(2));

            // Add sNo and totQty to each object
            element.sNo = index + 1;
            element.totalQuantity = totQty;
        });

        return res.status(200).json({
            success: true,
            message: "Nest Data",
            data: check
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};



exports.nestShowDtl = async (req, res) => {
    try {

        const nstNo = req.body.nstNo;

        const query = `

            SELECT 
                items.netWeight, 
                DATE_FORMAT(nesting_table.date, '%d-%m-%Y') as date, 
                nesting_table.id,
                nesting_table.Jobcard_no, 
                nesting_table.Part_no, 
                nesting_table.Machine_name, 
                nesting_table.Nesting_no, 
                nesting_table.Thickness, 
                nesting_table.Material_Name, 
                nesting_table.Sheet_qty, 
                nesting_table.GRN_No,
                items.netWeight * nesting_table.Sheet_qty AS totSheetQty
            FROM
                nesting_table
            JOIN
                items ON nesting_table.Part_no = items.itemCode
            JOIN
                job_card jc ON nesting_table.Jobcard_no = jc.jcNo
            WHERE 
                nesting_table.Nesting_no = ?
    
            `;


        const [rows] = await connection.execute(query, [nstNo]);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;

            });

            return res.status(200).json({
                success: true,
                message: "Nest Data",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}

exports.rqstMaterial = async (req, res) => {
    try {
        const nstNoObjects = req.body.nestData; // Array of objects containing nstNo
        const username = req.headers.username; // Ensure username exists

        if (!Array.isArray(nstNoObjects) || nstNoObjects.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid input: nstNo should be a non-empty array."
            });
        }

        const nstNos = nstNoObjects.map(obj => obj.Nesting_no);
        const totalQuantityMap = new Map(nstNoObjects.map(obj => [obj.Nesting_no, obj.totalQuantity]));

        const allNstData = new Map(); // To store unique Nesting_no data

        for (const nstNo of nstNos) {
            // Fetch job card and item data
            const [nstDataResult] = await connection.execute(
                `SELECT 
                    nesting_table.Nesting_no, job_card.jcNo, 
                    i.id as itemId, i.itemCode, job_card.id as jcId
                FROM
                    nesting_table
                JOIN
                    items i ON nesting_table.Material_Name = i.itemCode
                JOIN
                    job_card ON job_card.jcNo = nesting_table.Jobcard_no
                WHERE 
                    nesting_table.Nesting_no = ?`, [nstNo]
            );

            if (nstDataResult.length === 0) {
                continue;
            }

            // Extract unique jcNos as a comma-separated string
            const jcNos = [...new Set(nstDataResult.map(row => row.jcNo))].join(',');

            // Store first occurrence of itemId and itemCode
            const firstItem = nstDataResult[0];

            allNstData.set(nstNo, {
                jcNos, // Store comma-separated jcNos
                itemId: firstItem.itemId,
                itemCode: firstItem.itemCode,
                totalQuantity: totalQuantityMap.get(nstNo) || 0
            });
        }

        if (allNstData.size === 0) {
            return res.status(404).json({
                success: false,
                message: "No valid nesting data found."
            });
        }

        const { srn: srnNo, issue: issueNo } = await generateSrnNo(req);

        // Insert into `srn_mst`
        const [srnMst] = await connection.query(
            `INSERT INTO srn_mst (srnNo, issueNo, category, requestedBy) VALUES (?, ?, ?, ?)`,
            [srnNo, issueNo, 'Production', username]
        );
        const mstInsertId = srnMst.insertId;

        // Insert into `srn` table for each unique `Nesting_no`
        for (const [nestNo, data] of allNstData.entries()) {
            await connection.query(
                `INSERT INTO srn (nestNo, jcNos, itemId, itemCode, Qty, srnMstId) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [nestNo, data.jcNos, data.itemId, data.itemCode, data.totalQuantity, mstInsertId]
            );
        }

        await updateDocCounter(connection, 'Srn');
        await updateDocCounter(connection, 'MaterialIssueNote');

        //  Call the function to update STATUS
        const statusUpadte = await updateMaterialRequst(
            nstNos.map(nestNo => ({ nestNo })),
            username
        );

        return res.status(200).json({
            success: true,
            message: "Data Added Successfully",
            statusUpadte
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'An error occurred while processing the nesting data',
            error: error.message
        });
    }
};

const updateMaterialRequst = async (processItems, user) => {
    try {
        for (const nst of processItems) {
            const { nestNo } = nst;

            await connection.execute(
                `UPDATE nesting_table SET requestedBy = ?, isRqst = 1 WHERE Nesting_no = ?`,
                [user, nestNo]
            );
        }
        return { success: true, message: "status updated successfully" };
    } catch (error) {
        console.error("Error updating job card planning:", error);
        throw error;
    }
};



//GET Net Weight
exports.netWeight = async (req, res) => {
    try {

        const id = req.params.id;
        const query = `
            SELECT  DISTINCT
                netWeight
            FROM items 
            WHERE id = ?`;

        const [rows] = await connection.execute(query, [id]);

        if (rows.length >= 0) {

            rows.forEach((element, index) => {
                element.id = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "NetWeight list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}


exports.unique = async (req, res) => {
    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = String(now.getMonth() + 1).padStart(2, '0'); // Ensure 2-digit month (01-12)

        const [rows] = await connection.execute(
            `SELECT nestNo FROM manual_sheet_req_mst ORDER BY id DESC LIMIT 1`, []
        );

        // Get last nestNo or initialize to the first number of the current month
        const lastNestNo = (rows.length > 0 && rows[0].nestNo != null) ? rows[0].nestNo : `${currentYear}${currentMonth}00000`;

        // Extract and increment sequential number
        const sequentialNumber = parseInt(lastNestNo.slice(-5), 10) + 1;

        // Format sequential number with leading zeros to 5 digits
        const formattedSequentialNumber = String(sequentialNumber).padStart(5, '0');

        // Construct the new nestNo
        const nestNo = `${currentYear}${currentMonth}${formattedSequentialNumber}`;

        return handleSuccessResponse(res, 'Nesting Number', { sequentialNumber, nestNo });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



exports.manualRqstMaterial = async (req, res) => {
    try {
        const { sheetInfo, jcList } = req.body;
        const username = req.headers.username || 'admin';

        if (!jcList || jcList.length === 0) {
            return res.status(400).json({ success: false, message: "No job card data provided" });
        }

        //  Generate SRN Number
        const { srn: srnNo, issue: issueNo } = await generateSrnNo(req);

        //  Concatenate all jcNo values into a comma-separated string
        const jcNos = jcList.map(jc => jc.jcNo).join(',');
        // const itemCodeSet = jcList.map(jc => jc.itemCode).join(',');


        // Insert into `srn_mst` and get the inserted ID
        const [srnMst] = await connection.query(
            `INSERT INTO srn_mst (srnNo, issueNo, category, requestedBy) VALUES (?, ?, ?, ?)`,
            [srnNo, issueNo, 'Production', username]
        );
        const mstInsertId = srnMst.insertId;

        // Insert into `srn` table
        await connection.query(
            `INSERT INTO srn (nestNo, jcNos, itemId, itemCode, Qty, srnMstId) VALUES (?, ?, ?, ?, ?, ?)`,
            [sheetInfo.nestNo, jcNos, sheetInfo.itemId, sheetInfo.itemCode, sheetInfo.totQty, mstInsertId]
        );


        //  Insert into `manual_sheet_req_mst` and get the inserted ID
        const [mstResult] = await connection.query(
            `INSERT INTO manual_sheet_req_mst (nestNo, addedBy) VALUES (?, ?)`,
            [sheetInfo.nestNo, username]
        );
        const lastInsertId = mstResult.insertId;


        // Prepare bulk insert for `manual_sheet_req_dtl`
        const insertDtlValues = jcList.map(jc => [
            jc.jcId, jc.itemId, sheetInfo.itemCode, sheetInfo.thickness,
            sheetInfo.netWeight, sheetInfo.sheetQty, sheetInfo.totQty, lastInsertId
        ]);

        // Insert into `manual_sheet_req_dtl`
        await connection.query(
            `INSERT INTO manual_sheet_req_dtl (jcId, itemId, material, thickness, netWeight, sheetQty, totQty, rqstMatMstId) VALUES ?`,
            [insertDtlValues]
        );

        //  Update SRN Counter
        await updateCounter('Srn');

        return res.status(200).json({
            success: true,
            message: "Data Added Successfully",
        });

    } catch (err) {
        console.error("Error in store:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "An error occurred while processing the request.",
        });
    }
};



//Checkimg BUY PRODUCTION Child Parts
exports.getList2 = async (req, res) => {
    try {
        const itemCode = req.body.itemCode;

        const [bRow] = await connection.execute(`
            SELECT items.itemCode, items.category FROM bom_mst
            INNER JOIN items ON items.id = bom_mst.itemId
            WHERE bom_mst.itemCode = ?`,
            [itemCode]
        );

        const array = [];
        if (bRow.length >= 0) {
            if (bRow[0].category) {
                array.push({ id: 1, label: bRow[0].itemCode, Qty: 1 });
            }

            const query = `
                SELECT bom_mst.itemId as mstPartId, bom.*, items.isBom, items.itemName, items.itemCode, uom.name as uomName, items.category FROM bom_mst
                    INNER JOIN bom ON bom.bomMstId = bom_mst.id
                    INNER JOIN items ON items.id = bom.itemId
                    INNER JOIN mst_uom AS uom on items.uom = uom.id
                WHERE bom_mst.itemCode = ?
            `;


            const [rows] = await connection.execute(query, [itemCode]);

            if (rows.length > 0) {
                for (const element of rows) {
                    let obj = { id: element.id, label: element.itemCode, Qty: element.Qty }

                    if (element.category === 'BUY PRODUCTION') {
                        array.push(obj);
                    }
                    if (element.isBom == 'Y') {
                        const childItemsResult = await childItems2(element.itemId, element.Qty);  // Use a different name
                        array.push(...childItemsResult)
                    }
                };
            }
        }

        return res.status(200).json({ data: array })
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
}


// Recursive function to fetch the child items
async function childItems2(itemId, parentQty) {
    try {
        const query = `
            SELECT bom_mst.itemId as mstPartId, bom.*, items.isBom, items.itemName, items.itemCode, items.category FROM bom_mst
                INNER JOIN bom ON bom.bomMstId = bom_mst.id
                INNER JOIN items ON items.id = bom.itemId
            WHERE bom_mst.itemId = ?
        `;

        const [rows] = await connection.execute(query, [itemId]);
        const array = [];

        if (rows.length > 0) {
            for (const element of rows) {
                let obj = { id: element.id, label: element.itemCode, Qty: element.Qty * parentQty }

                if (element.category === 'BUY PRODUCTION') {
                    array.push(obj);
                }
                if (element.isBom == 'Y') {
                    // Recursively call childItems and append the result to the 'child' property
                    const childItemsResult = await childItems2(element.itemId, element.Qty);
                    array.push(...childItemsResult)
                }
            }
        }

        return array;

    } catch (error) {
        throw error;
    }
}


//JobCard Submit Api
// exports.submit = async (req, res) => {
//     try {
//         const user = req.headers.username;
//         const processItems = req.body;

//         for (const item of processItems) {
//             const { acptQty, jcId, itemId, machineName, process } = item;

//             if (!jcId || !itemId || !machineName || !process) {
//                 return res.status(400).json({
//                     success: false,
//                     message: "Missing required fields in item",
//                 });
//             }

//             const [DRows] = await connection.execute(
//                 `UPDATE jobcard_planning SET acptQty = ?, prod_eng = ? WHERE jcId = ? AND itemId = ? AND machineName = ? AND process = ?`,
//                 [acptQty, user, jcId, itemId, machineName, process]
//             );

//         }

//         return res.status(200).json({
//             success: true,
//             message: "Data Submitted Successfully",
//         });

//     } catch (error) {

//     }
// };

const updateJCstatus = async (conn, jcId) => {
    try {
        const [jcRow] = await conn.execute(
            `SELECT j.mrpMstId, m.orderPlnId 
             FROM job_card j 
             INNER JOIN mrp_mst m ON m.id = j.mrpMstId 
             WHERE j.id = ?`,
            [jcId]
        );

        if (!jcRow.length) {
            throw new CustomError(`JC not found!`, 404);
        }

        const { mrpMstId, orderPlnId } = jcRow[0];

        // Check if any incomplete job card exists
        const [pendingJC] = await conn.execute(
            `SELECT 1 FROM job_card WHERE isCompleted = 0 AND mrpMstId = ? LIMIT 1`,
            [mrpMstId]
        );

        if (!pendingJC.length) {
            await conn.execute(
                `UPDATE order_plannings SET status = 'Completed', orderPriority = 0 WHERE id = ?`,
                [orderPlnId]
            );
        }
    } catch (err) {
        throw err;
    }
};

// exports.submit = async (req, res) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();

//     try {
//         const processItems = req.body;
//         if (!Array.isArray(processItems) || processItems.length === 0) {
//             throw new CustomError(`No process items provided!`);
//         }

//         const user = await getUser(req);

//         // Fetch the final process for the item
//         const [rows] = await conn.execute(
//             `SELECT ivp.id, pm.name AS process, pm.vendorProcess
//              FROM item_vs_pm ivp
//              INNER JOIN mst_pm pm ON ivp.process = pm.id
//              WHERE ivp.item = ? 
//              ORDER BY ivp.processPriority DESC 
//              LIMIT 1`,
//             [processItems[0].itemId]
//         );

//         if (rows.length === 0) {
//             throw new CustomError(`Item VS Process not defined for the Item!`);
//         }
//         const finalProcess = rows[0].process;
//         // const vp = rows[0].vendorProcess;


//         for (let i = 0; i < processItems.length; i++) {
//             const item = processItems[i];
//             const { acptQty, jcId, itemId, machineName, process } = item;

//             if (![jcId, itemId, machineName, process].every(Boolean)) {
//                 throw new CustomError(`Required fields are missing or invalid!`);
//             }

//             const parsedQty = parseFloat(acptQty);
//             if (isNaN(parsedQty) || parsedQty <= 0) {
//                 throw new CustomError(`Invalid acceptance quantity!`);
//             }

//             await conn.execute(
//                 `UPDATE jobcard_planning 
//                 SET acptQty = ?, prod_eng = ? 
//                 WHERE jcId = ? AND itemId = ? AND machineName = ? AND process = ?`,
//                 [parsedQty, user, jcId, itemId, machineName, process]
//             );

//             if (process === finalProcess) {
//                 await conn.execute(
//                     `UPDATE sfg SET accQty = ? WHERE jcId = ?`,
//                     [acptQty, jcId]
//                 );

//                 // await conn.execute(
//                 //     `UPDATE job_card 
//                 //     SET verifiedQty = verifiedQty + ?, 
//                 //         isCompleted = CASE WHEN verifiedQty + ? >= Qty THEN 1 ELSE 0 END,
//                 //         status = CASE WHEN verifiedQty + ? >= Qty THEN 'Completed' ELSE 'Pending' END,
//                 //         completedDate = CASE WHEN verifiedQty + ? >= Qty THEN NOW() ELSE completedDate END,
//                 //         supervisorCls = ?
//                 //     WHERE id = ?`,
//                 //     [parsedQty, parsedQty, parsedQty, parsedQty, 1, jcId]
//                 // );
//                 await conn.execute(
//                     `UPDATE job_card 
//                     SET verifiedQty = verifiedQty + ?, 
//                         completedDate = CASE WHEN verifiedQty + ? >= Qty THEN NOW() ELSE completedDate END,
//                         supervisorCls = ?
//                     WHERE id = ?`,
//                     [parsedQty, parsedQty, 1, jcId]
//                 );

//                 await updateJCstatus(conn, jcId);

//             } else if (i === processItems.length - 1) {
//                 // Only run this logic for the LAST item that is NOT the final process
//                 const [currentRows] = await conn.execute(
//                     `SELECT ivp.id, ivp.processPriority, pm.name AS process, pm.vendorProcess
//                     FROM item_vs_pm ivp
//                     INNER JOIN mst_pm pm ON ivp.process = pm.id
//                     WHERE ivp.item = ? AND pm.name = ?
//                     ORDER BY ivp.processPriority DESC
//                     LIMIT 1`,
//                     [itemId, process]
//                 );

//                 if (currentRows.length > 0) {
//                     const cPriority = currentRows[0].processPriority;
//                     const [nextRows] = await conn.execute(
//                         `SELECT ivp.id, pm.name AS process, pm.vendorProcess
//                         FROM item_vs_pm ivp
//                         INNER JOIN mst_pm pm ON ivp.process = pm.id
//                         WHERE  ivp.item = ?  AND ivp.processPriority > ?
//                         AND (pm.vendorProcess = 1 OR pm.name = 'Assembly')
//                         ORDER BY ivp.processPriority ASC
//                         LIMIT 1`,
//                         [itemId, cPriority]
//                     );

//                     if (nextRows.length > 0) {
//                         const currentProcess = nextRows[0].process;
//                         await conn.execute(`UPDATE sfg SET accQty = ? WHERE jcId = ?`, [parsedQty, jcId]);
//                     }
//                 }

//                 await conn.execute(
//                     `UPDATE job_card 
//                        SET  supervisorCls = ?
//                     WHERE id = ?`, [2, jcId]
//                 );

//             }
//         }
//         // Update the next process
//         if (processItems[processItems.length - 1]) {
//             const { jcId, itemId, machineName, process, acptQty } = processItems[processItems.length - 1];

//             const [machineRow] = await conn.execute(
//                 `SELECT id FROM machines WHERE machineName = ?`,
//                 [machineName]
//             );

//             const [processRow] = await conn.execute(
//                 `SELECT id FROM mst_pm WHERE code = ?`,
//                 [process]
//             );

//             const [machineId, processId] = [machineRow[0]?.id, processRow[0]?.id];
//             if (!machineId || !processId) {
//                 throw new CustomError(`Machine or Process not found!`);
//             }

//             await updateNextProcess(req, conn, jcId, itemId, machineId, processId, acptQty);
//         }

//         await conn.commit();
//         return handleSuccessResponse(res, 'Data saved successfully');
//     } catch (err) {
//         await conn.rollback();
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// };

const checkOperatorEntry = async (conn, data) => {
    const conditions = data.map(() => '(jcId = ? AND machineName = ? AND process = ? AND producedQty > 0)').join(' OR ');
    const values = data.flatMap(d => [d.jcId, d.machineName, d.process]);

    const sql = `SELECT id FROM jobcard_planning WHERE ${conditions}`;
    const [rows] = await conn.execute(sql, values);

    if (rows.length === data.length) return true;
    throw new CustomError('Operator entry pending!');
};

exports.submit = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const processItems = req.body;

        if (!Array.isArray(processItems) || processItems.length === 0) {
            throw new CustomError(`No process items provided!`);
        }
        const user = await getUser(req);

        // await checkOperatorEntry(conn, processItems);

        // Fetch the final process for the item
        const [rows] = await conn.execute(
            `SELECT ivp.id, pm.name AS process, pm.vendorProcess
             FROM item_vs_pm ivp
             INNER JOIN mst_pm pm ON ivp.process = pm.id
             WHERE ivp.item = ? 
             ORDER BY ivp.processPriority DESC 
             LIMIT 1`,
            [processItems[0].itemId]
        );

        if (rows.length === 0) {
            throw new CustomError(`Item VS Process not defined for the Item!`);
        }
        const finalProcess = rows[0].process;

        for (let i = 0; i < processItems.length; i++) {
            const item = processItems[i];
            const { acptQty, jcId, itemId, machineName, process } = item;

            if (![jcId, itemId, machineName, process].every(Boolean)) {
                throw new CustomError(`Required fields are missing or invalid!`);
            }

            const parsedQty = parseFloat(acptQty);
            if (isNaN(parsedQty) || parsedQty <= 0) {
                throw new CustomError(`Invalid acceptance quantity!`);
            }

            await conn.execute(
                `UPDATE jobcard_planning 
                SET acptQty = ?, prod_eng = ? 
                WHERE jcId = ? AND itemId = ? AND machineName = ? AND process = ?`,
                [parsedQty, user, jcId, itemId, machineName, process]
            );

            if (process === finalProcess) {
                await conn.execute(
                    `UPDATE sfg SET accQty = ? WHERE jcId = ?`,
                    [acptQty, jcId]
                );

                await conn.execute(
                    `UPDATE job_card 
                    SET verifiedQty = verifiedQty + ?, 
                        completedDate = CASE WHEN verifiedQty + ? >= Qty THEN NOW() ELSE completedDate END,
                        supervisorCls = ?
                    WHERE id = ?`,
                    [parsedQty, parsedQty, 1, jcId]
                );

                await updateJCstatus(conn, jcId);

            } else if (i === processItems.length - 1) {
                // Only run this logic for the LAST item that is NOT the final process
                const [currentRows] = await conn.execute(
                    `SELECT ivp.id, ivp.processPriority, pm.name AS process, pm.vendorProcess
                    FROM item_vs_pm ivp
                    INNER JOIN mst_pm pm ON ivp.process = pm.id
                    WHERE ivp.item = ? AND pm.name = ?
                    ORDER BY ivp.processPriority DESC
                    LIMIT 1`,
                    [itemId, process]
                );

                if (currentRows.length > 0) {
                    const cPriority = currentRows[0].processPriority;
                    const [nextRows] = await conn.execute(
                        `SELECT ivp.id, pm.name AS process, pm.vendorProcess
                        FROM item_vs_pm ivp
                        INNER JOIN mst_pm pm ON ivp.process = pm.id
                        WHERE  ivp.item = ?  AND ivp.processPriority > ?
                        AND (pm.vendorProcess = 1 OR pm.name = 'Assembly')
                        ORDER BY ivp.processPriority ASC
                        LIMIT 1`,
                        [itemId, cPriority]
                    );

                    if (nextRows.length > 0) {
                        const currentProcess = nextRows[0].process;
                        await conn.execute(`UPDATE sfg SET accQty = ? WHERE jcId = ?`, [parsedQty, jcId]);
                    }
                }

                await conn.execute(
                    `UPDATE job_card 
                       SET  supervisorCls = ?
                    WHERE id = ?`, [2, jcId]
                );

            }
        }
        // Update the next process
        if (processItems[processItems.length - 1]) {
            const { jcId, itemId, machineName, process, acptQty } = processItems[processItems.length - 1];

            const [machineRow] = await conn.execute(
                `SELECT id FROM machines WHERE machineName = ?`,
                [machineName]
            );

            const [processRow] = await conn.execute(
                `SELECT id FROM mst_pm WHERE code = ?`,
                [process]
            );

            const [machineId, processId] = [machineRow[0]?.id, processRow[0]?.id];
            if (!machineId || !processId) {
                throw new CustomError(`Machine or Process not found!`);
            }

            await updateNextProcess(req, conn, jcId, itemId, machineId, processId, acptQty);
        }

        await conn.commit();
        return handleSuccessResponse(res, 'Data saved successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.viewSrnDoc = async (req, res) => {
    try {
        const { type, id } = req.query;
        const { fyFrom, fyTo } = formatFinancialYears(req);

        let mstQuery = `
            SELECT s.id, s.srnNo, s.issueNo, s.requestedBy, DATE_FORMAT(s.created_at, '%d-%m-%Y') AS srnDate
            FROM srn_mst s
            WHERE category = 'Production' AND DATE(s.created_at) BETWEEN ? AND ?
        `;
        let params = [fyFrom, fyTo];

        switch (type) {
            case 'first':
                mstQuery += ` ORDER BY s.id ASC LIMIT 1`;
                break;
            case 'last':
                mstQuery += ` ORDER BY s.id DESC LIMIT 1`;
                break;
            case 'forward':
                mstQuery += ` AND s.id > ? ORDER BY s.id ASC LIMIT 1`;
                params.push(id);
                break;
            case 'reverse':
                mstQuery += ` AND s.id < ? ORDER BY s.id DESC LIMIT 1`;
                params.push(id);
                break;
            case 'view':
                mstQuery += ` AND s.id = ?`;
                params.push(id);
                break;
        }
        const [rows] = await connection.execute(mstQuery, params);

        const [srnItems] = await connection.execute(`
            SELECT ROW_NUMBER() OVER (ORDER BY s.id) AS sNo, s.id, i.itemCode, i.itemName, s.Qty, pf.name AS pf
            FROM srn s
            INNER JOIN items i ON s.itemId = i.id
            LEFT JOIN item_product_family pf ON i.productFamily = pf.id
            WHERE s.srnMstId = ?
        `, [rows[0]?.id || 0]);

        return res.status(200).json({
            success: true,
            mstDetails: rows[0],
            srnItems
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

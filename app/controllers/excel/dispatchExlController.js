const excel = require('exceljs');
const { connection, CustomError, handleSuccessResponse, handleErrorResponse } = require('../../config/dbSql');
const { generateDocNo, updateDocCounter } = require('../../utility/docNo');
const { decodeBase64 } = require('../../utility/utilityFunction');
const { shipmentPlanning } = require("../dispatchController");


//Download Template 
exports.templateContract = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Contract No', 'Time-slot']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text


        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Template.xlsx');

        // Write the Excel file to the response
        workbook.xlsx.write(res)
            .then(() => {
                // End the response stream
                res.end();
            })
            .catch(err => {
                console.error('Error writing Excel file:', err);
                res.status(500).send('Error generating Excel file');
            });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};



//Download Template 
exports.templatePart = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Part No', 'Quantity', 'Time-slot']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text


        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Template.xlsx');

        // Write the Excel file to the response
        workbook.xlsx.write(res)
            .then(() => {
                // End the response stream
                res.end();
            })
            .catch(err => {
                console.error('Error writing Excel file:', err);
                res.status(500).send('Error generating Excel file');
            });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};



exports.uniqueId = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {

        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'DelNoteExcel' });

        await conn.commit();
        return res.status(200).json({
            id: uniqueNo,
            digit: padStartNo
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


// exports.importPart = async (req, res) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();

//     try {
//         const buffer = await decodeBase64(req.body.file);
//         const shDate = req.body.date;
//         const cust = req.body.customerId;

//         const workbook = new excel.Workbook();
//         await workbook.xlsx.load(buffer);

//         const worksheet = workbook.getWorksheet(1);
//         const rowsPromises = [];
//         let autoIncrementId = 1;

//         // Keep track of already processed parts (for duplicates)
//         const seenParts = new Set();

//         // Call generateDocNo for DelNoteExcel
//         const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'DelNoteExcel' });
//         const excelId = uniqueNo;

//         worksheet.eachRow((row, rowNumber) => {
//             if (rowNumber !== 1) {
//                 const part = row.getCell(1).value;
//                 const qty = row.getCell(2).value;
//                 const tslot = row.getCell(3).value;

//                 rowsPromises.push(
//                     (async () => {
//                         let errorRemark = null;
//                         let errorFlag = 0;
//                         let poNo = null;

//                         // Duplicate check BEFORE DB queries
//                         if (seenParts.has(part)) {
//                             errorRemark = 'Duplicate Part Found';
//                             errorFlag = 1;
//                         } else {
//                             seenParts.add(part);

//                             // Check for itemCode
//                             const [items] = await connection.execute(`
//                                 SELECT id, itemCode
//                                 FROM items
//                                 WHERE itemCode = ? 
//                             `, [part]);

//                             const checkItm = items.length > 0;
//                             const item = checkItm ? items[0].itemCode : null;

//                             // Check for PO
//                             const [poRows] = await connection.execute(`
//                                 SELECT po.poNo, poItem.pendQty, poItem.id As poItemId
//                                 FROM purchas_Order_item AS poItem
//                                 INNER JOIN purchase_order AS po ON po.id = poItem.purchase_order_id
//                                 WHERE poItem.PartNo = ? AND po.customer = ? AND  poItem.isShortCls = 0 AND poItem.pendQty !=0
//                             `, [part, cust]);

//                             const hasPo = poRows.length > 0;
//                             poNo = hasPo ? poRows[0].poNo : null;
//                             poItemId = hasPo ? poRows[0].poItemId : null;

//                             // Check dispatchPlan
//                             const [dispatchPlan] = await connection.execute(`
//                                 SELECT id FROM dispatch_plan
//                                 WHERE contractNo = ? AND contractOrPart = ? AND dflag = ?
//                                 ORDER BY id DESC LIMIT 1
//                             `, [part, 1, 0]);

//                             const hadDel = dispatchPlan.length > 0;

//                             // Check for Stock
//                             const [stockRows] = await connection.execute(`
//                                 SELECT totQty FROM fg_stocks
//                                 WHERE itemCode = ? AND totQty > 0
//                                 ORDER BY id DESC LIMIT 1
//                             `, [part]);

//                             const hasStock = stockRows.length > 0;
//                             const availableStock = stockRows[0]?.totQty ?? 0;

//                             // Existing error checks
//                             if (hadDel) {
//                                 errorRemark = 'Dispatch already planned';
//                                 errorFlag = 1;
//                             } else if (!item) {
//                                 errorRemark = 'Item Not Registered';
//                                 errorFlag = 1;
//                             } else if (!hasPo && !hasStock) {
//                                 errorRemark = 'PO and Stock not found';
//                                 errorFlag = 1;
//                             } else if (!hasPo) {
//                                 errorRemark = 'PO not found';
//                                 errorFlag = 1;
//                             } else if (!hasStock) {
//                                 errorRemark = 'Stock not found or insufficient';
//                                 errorFlag = 1;
//                             } else if (availableStock < qty) {
//                                 errorRemark = `insufficient Stock. Only ${availableStock} is available.`;
//                                 errorFlag = 1;
//                             }
                            
//                             // else if (hasPo && hasStock) {
//                             //     const availableStock = stockRows[0]?.totQty ?? 0;
//                             //     const poQty = poRows[0]?.pendQty ?? 0;

//                             //     if (availableStock >= qty) {
//                             //         if (poQty < qty) {
//                             //             const diff = qty - poQty;
//                             //             errorRemark = `${diff} qty is not available the PendingPo qty ${poQty}.`;
//                             //             errorFlag = 1;
//                             //         }
//                             //     }
//                             // }

                            
//                         }
//                         return {
//                             id: autoIncrementId++,
//                             rowNo: rowNumber,
//                             excelId,
//                             poItemId,
//                             shDate,
//                             part,
//                             poNo,
//                             qty,
//                             tslot,
//                             errorRemark,
//                             errorFlag,
//                         };
//                     })()
//                 );
//             }
//         });

//         const items = await Promise.all(rowsPromises);

//         await conn.commit();

//         return res.status(200).json({
//             success: true,
//             message: 'Item details validated',
//             digit: padStartNo,
//             excelId,
//             items
//         });

//     } catch (err) {
//         await conn.rollback();
//         console.error('Error importing items:', err);
//         return res.status(500).json({
//             success: false,
//             message: 'An error occurred during import',
//             error: err.message
//         });
//     } finally {
//         conn.release();
//     }
// };

exports.importPart = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const buffer = await decodeBase64(req.body.file);
        const shDate = req.body.date;
        const cust = req.body.customerId;

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const rowsPromises = [];
        let autoIncrementId = 1;

        // Keep track of already processed parts (for duplicates)
        const seenParts = new Set();

        // Call generateDocNo for DelNoteExcel
        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'DelNoteExcel' });
        const excelId = uniqueNo;

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) {
                const part = row.getCell(1).value;
                const qty = row.getCell(2).value;
                const tslot = row.getCell(3).value;

                rowsPromises.push(
                (async () => {
                    let errorRemark = null;
                    let errorFlag = 0;
                    let poNo = null;        // define here
                    let poItemId = null;    // define here
                    let totalPendQty = 0;   // define here

                    // Duplicate check BEFORE DB queries
                    if (seenParts.has(part)) {
                        errorRemark = 'Duplicate Part Found';
                        errorFlag = 1;
                    } else {
                    seenParts.add(part);

                    // Check for itemCode
                    const [items] = await connection.execute(`
                        SELECT id, itemCode
                        FROM items
                        WHERE itemCode = ? 
                    `, [part]);

                    const checkItm = items.length > 0;
                    const item = checkItm ? items[0].itemCode : null;

                    // Check for PO
                    const [poRows] = await connection.execute(`
                        SELECT po.poNo, poItem.pendQty, poItem.id AS poItemId
                        FROM purchas_Order_item AS poItem
                        INNER JOIN purchase_order AS po ON po.id = poItem.purchase_order_id
                        WHERE poItem.PartNo = ? AND po.customer = ? 
                        AND poItem.isShortCls = 0 
                        AND poItem.pendQty != 0
                    `, [part, cust]);

                    const hasPo = poRows.length > 0;

                    if (hasPo) {
                        poNo = poRows.map(p => p.poNo).join(', ');
                        poItemId = poRows.map(p => p.poItemId).join(', ');
                        totalPendQty = poRows.reduce((sum, p) => sum + Number(p.pendQty || 0), 0);
                    }

                    // Check dispatchPlan
                    const [dispatchPlan] = await connection.execute(`
                        SELECT id FROM dispatch_plan
                        WHERE contractNo = ? AND contractOrPart = ? AND dflag = ?
                        ORDER BY id DESC LIMIT 1
                    `, [part, 1, 0]);

                    const hadDel = dispatchPlan.length > 0;

                    // Check for Stock
                    // const [stockRows] = await connection.execute(`
                    //     SELECT totQty FROM fg_stocks
                    //     WHERE itemCode = ? AND totQty > 0
                    //     ORDER BY id DESC LIMIT 1
                    // `, [part]);

                    // const hasStock = stockRows.length > 0;
                    // const availableStock = stockRows[0]?.totQty ?? 0;

                    const [stockRows] = await connection.execute(`
                        SELECT totQty
                        FROM fg_stocks
                        WHERE itemCode = ?
                        ORDER BY id DESC
                        LIMIT 1
                    `, [part]);

                    const hasStock = stockRows.length > 0;
                    const availableStock = stockRows[0]?.totQty ?? 0;

                    // Error checks
                    if (hadDel) {
                        errorRemark = 'Dispatch already planned';
                        errorFlag = 1;
                    } else if (!item) {
                        errorRemark = 'Item Not Registered';
                        errorFlag = 1;
                    } else if (!hasPo && !hasStock) {
                        errorRemark = 'PO and Stock not found';
                        errorFlag = 1;
                    } else if (!hasPo) {
                        errorRemark = 'PO not found';
                        errorFlag = 1;
                    } else if (!hasStock) {
                        errorRemark = 'Stock not found or insufficient';
                        errorFlag = 1;
                    } else if (availableStock < qty) {
                        errorRemark = `Insufficient Stock. Only ${availableStock} is available.`;
                        errorFlag = 1;
                    } else if (hasPo && hasStock) {
                        const poQty = totalPendQty;

                        if (availableStock >= qty) {
                        if (poQty < qty) {
                            const diff = qty - poQty;
                            errorRemark = `${diff} qty exceeds pending PO qty (${poQty}).`;
                            errorFlag = 1;
                        }
                        } else {
                        errorRemark = `Insufficient stock, Only ${availableStock} is available.`;
                        errorFlag = 1;
                        }
                    }
                    }

                    return {
                    id: autoIncrementId++,
                    rowNo: rowNumber,
                    excelId,
                    poItemId,
                    shDate,
                    part,
                    poNo,
                    qty,
                    tslot,
                    errorRemark,
                    errorFlag,
                    };
                })()
                );

            }
        });

        const items = await Promise.all(rowsPromises);

        await conn.commit();

        return res.status(200).json({
            success: true,
            message: 'Item details validated',
            digit: padStartNo,
            excelId,
            items
        });

    } catch (err) {
        await conn.rollback();
        console.error('Error importing items:', err);
        return res.status(500).json({
            success: false,
            message: 'An error occurred during import',
            error: err.message
        });
    } finally {
        conn.release();
    }
};

exports.getExcelId = async (req, res) => {
    try {

        const { q } = req.query;

        let query = `
            SELECT  
               excelId
            FROM dispatch_plan
            WHERE dflag = 0 AND excelId IS NOT NULL
        `;

        const values = [];

        if (q) {
            query += ` AND excelId LIKE ?`;
            values.push(`%${q}%`);
        }

        query += ` GROUP BY excelId LIMIT 20`;

        const [rows] = await connection.execute(query, values);


        return handleSuccessResponse(res, 'Excel Generated Ids', rows);
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}


//Contract Wise dispatch plan data store
exports.store = async (req, res) => {
    try {
        const { items } = req.body;

        // Prepare values for bulk insert with update on duplicate key
        const values = items.map(item => [
            item.shDate,
            item.part,
            item.qty,
            item.tslot,
            item.excelId,
            0
        ]);


        await connection.query(
            'INSERT INTO dispatch_plan (sheduledDate, contractNo, qty, timeSlot, excelId, contractOrPart) VALUES ?',
            [values]
        );
        // excelId,

        await updateDocCounter(connection, 'DelNoteExcel', { uniqueNo: items[0].excelId });
        return handleSuccessResponse(res, 'Data Uploded successfully');

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};
//old
// const storeShipmentDetails = async (conn, shipmentdate, shipmentRows) => {
//     try {
//         const [insertResult] = await conn.execute(
//             `INSERT INTO shipment_mst (shipmentdate) VALUES (?)`,
//             [shipmentdate]
//         );
//         const shipmentDateId = insertResult.insertId;

//         const [cols] = await conn.execute(`SHOW COLUMNS FROM shipment_details`);
//         const existingCols = cols.map(c => c.Field);

//         const fixedColKeys = [
//             "mstId", "ContractNo", "KanbanDate", "TimeSlot",
//             "Duty", "QtyStops", "PoNo", "VehicleNo",
//             "Start_Time", "End_Time", "Delay", "OTD", "Remarks"
//         ];

//         const skipColumns = new Set(['TOTAL CONTRACTS', 'READY CONTRACTS', 'PENDING CONTRACTS']);

//         // ✅ Collect all dynamic FIM keys
//         const allDynamicKeys = new Set();
//         for (const row of shipmentRows) {
//             Object.keys(row).forEach(key => {
//                 if (!fixedColKeys.includes(key) && !skipColumns.has(row.Product)) {
//                     allDynamicKeys.add(key);
//                 }
//             });
//         }

//         // ✅ Alter table for missing columns only once
//         for (const key of allDynamicKeys) {
//             if (!existingCols.includes(key)) {
//                 await conn.execute(
//                     `ALTER TABLE shipment_details ADD COLUMN \`${key}\` VARCHAR(255) NULL`
//                 );
//                 existingCols.push(key);
//             }
//         }

//         // ✅ Insert each row separately
//         for (const row of shipmentRows) {
//             if (row.ContractNo && !skipColumns.has(row.Product)) {
//                 const fixedCols = {
//                     mstId: shipmentDateId,
//                     ContractNo: row.ContractNo || null,
//                     KanbanDate: row.KanbanDate || null,
//                     TimeSlot: row.TimeSlot || null,
//                     Duty: row.Duty || null,
//                     QtyStops: row.QtyStops || null,
//                     PoNo: null,
//                     VehicleNo: null,
//                     Start_Time: null,
//                     End_Time: null,
//                     Delay: null,
//                     OTD: null,
//                     Remarks: null
//                 };

//                 const dynamicCols = {};
//                 for (const key of allDynamicKeys) {
//                     dynamicCols[key] = row[key] ?? null;
//                 }

//                 const allCols = [...Object.keys(fixedCols), ...Object.keys(dynamicCols)];
//                 const allValues = [...Object.values(fixedCols), ...Object.values(dynamicCols)];
//                 const placeholders = allCols.map(() => "?").join(",");

//                 await conn.execute(
//                     `INSERT INTO shipment_details (${allCols.map(c => `\`${c}\``).join(",")}) VALUES (${placeholders})`,
//                     allValues
//                 );
//             }
//         }
//     } catch (err) {
//         throw err;
//     }
// };
//deployed
// const storeShipmentDetails = async (conn, shipmentdate, shipmentRows) => {
//     try {
//         // Insert shipment date once into shipment_mst
//         const [insertResult] = await conn.execute(
//             `INSERT INTO shipment_mst (shipmentdate) VALUES (?)`,
//             [shipmentdate]
//         );
//         const shipmentDateId = insertResult.insertId;

//         // Keys that should NOT be prefixed with FIM
//         const fixedObjKeys = new Set([
//             'id',
//             'SNo',
//             'ContractNo',
//             'KanbanDate',
//             'SheduledDate',
//             'TimeSlot',
//             'Duty',
//             'Product',
//             'QtyStops',
//             'Prefix'
//         ]);

//         for (const row of shipmentRows) {
//             if (row.ContractNo) {
//                 const shipmentObj = {
//                     mstId: shipmentDateId,
//                     ContractNo: row.ContractNo || null,
//                     KanbanDate: row.KanbanDate || null,
//                     TimeSlot: row.TimeSlot || null,
//                     Duty: row.Duty || null,
//                     QtyStops: row.QtyStops || null,
//                 };

//                 for (const col of Object.keys(row)) {
//                     if (!fixedObjKeys.has(col)) {
//                         shipmentObj[`FIM${col}`] = row[col] || null;
//                     }
//                 }

//                 console.log(shipmentObj);

//                 const allCols = Object.keys(shipmentObj);
//                 const allValues = Object.values(shipmentObj);
//                 const placeholders = allCols.map(() => "?").join(",");

//                 await conn.execute(
//                     `INSERT INTO shipment_details (${allCols.map(c => `\`${c}\``).join(",")}) VALUES (${placeholders})`,
//                     allValues
//                 );
//             }
//         }
//     } catch (err) {
//         throw err;
//     }
// };
const storeShipmentDetails = async (conn, shipmentdate, shipmentRows) => {
    try {
        // 1️⃣ Check if shipmentdate already exists in shipment_mst
        let shipmentDateId;
        const [existingMst] = await conn.execute(
            `SELECT id FROM shipment_mst WHERE shipmentdate = ?`,
            [shipmentdate]
        );

        if (existingMst.length > 0) {
            shipmentDateId = existingMst[0].id;
        } else {
            const [insertResult] = await conn.execute(
                `INSERT INTO shipment_mst (shipmentdate) VALUES (?)`,
                [shipmentdate]
            );
            shipmentDateId = insertResult.insertId;
        }

        // 2️⃣ Get all existing ContractNos for this shipment date
        const [existingDetails] = await conn.execute(
            `SELECT id, ContractNo FROM shipment_details WHERE mstId = ?`,
            [shipmentDateId]
        );

        const existingContractNos = new Map(
            existingDetails.map(r => [r.ContractNo, r.id])
        );

        // Prepare a set of contractNos coming from the new upload
        const newContractNos = new Set(shipmentRows.map(r => r.ContractNo));

        // 3️⃣ DELETE rows that are no longer present in new upload
        for (const [contractNo, id] of existingContractNos.entries()) {
            if (!newContractNos.has(contractNo)) {
                // console.log(`Deleting old contractNo: ${contractNo}`);
                await conn.execute(
                    `DELETE FROM shipment_details WHERE id = ?`,
                    [id]
                );
            }
        }

        // 4️⃣ INSERT new rows that are not already present
        const fixedObjKeys = new Set([
            'id',
            'SNo',
            'ContractNo',
            'KanbanDate',
            'SheduledDate',
            'TimeSlot',
            'Duty',
            'Product',
            'QtyStops',
            'Prefix'
        ]);

        for (const row of shipmentRows) {
            if (!row.ContractNo) continue;

            if (existingContractNos.has(row.ContractNo)) {
                // ✅ Contract already exists — keep it, no insert
                // console.log(`Keeping existing contractNo: ${row.ContractNo}`);
                continue;
            }

            // Prepare new row for insertion
            const shipmentObj = {
                mstId: shipmentDateId,
                ContractNo: row.ContractNo || null,
                KanbanDate: row.KanbanDate || null,
                TimeSlot: row.TimeSlot || null,
                Duty: row.Duty || null,
                QtyStops: row.QtyStops || null,
            };

            for (const col of Object.keys(row)) {
                if (!fixedObjKeys.has(col)) {
                    shipmentObj[`FIM${col}`] = row[col] || null;
                }
            }

            const allCols = Object.keys(shipmentObj);
            const allValues = Object.values(shipmentObj);
            const placeholders = allCols.map(() => "?").join(",");

            await conn.execute(
                `INSERT INTO shipment_details (${allCols.map(c => `\`${c}\``).join(",")}) VALUES (${placeholders})`,
                allValues
            );
        }
    } catch (err) {
        throw err;
    }
};


//old punith code 
// exports.import = async (req, res) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();
//     try {
//         if (!req.body.file) {
//             return res.status(400).json({ success: false, message: 'No file uploaded' });
//         }

//         const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
//         const base64Data = req.body.file.replace(base64URL, '');
//         const buffer = Buffer.from(base64Data, 'base64');

//         const workbook = new excel.Workbook();
//         await workbook.xlsx.load(buffer);

//         const worksheet = workbook.getWorksheet(1);

//         // Determine template type based on headers
//         const headers = worksheet.getRow(1).values.map(h => h?.toString().trim().toLowerCase() || '');
//         const isContractTemplate = headers.includes("contract no");
//         const isPartTemplate = headers.includes("part no");

//         const allData = [];

//         worksheet.eachRow((row, rowNumber) => {
//             if (rowNumber !== 1) { // Skip header row
//                 const itm = {
//                     rId: rowNumber,
//                     shDate: req.body.date,
//                     flag: req.body.flag,
//                 };

//                 if (isContractTemplate) {
//                     itm.contractNo = row.getCell(1).value;
//                     itm.tslot = row.getCell(2).value;
//                     itm.qty = null; // Contract template doesn't have qty
//                 } else if (isPartTemplate) {
//                     itm.contractNo = row.getCell(1).value; // Use `.value` instead of `.text`
//                     itm.qty = row.getCell(2).value;
//                     itm.tslot = row.getCell(3).value;
//                 } else {
//                     throw new Error('Unknown template format');
//                 }

//                 if (!itm.contractNo) {
//                     throw new Error(`Invalid data in row ${rowNumber}`);
//                 }

//                 allData.push(itm);
//             }
//         });

//         if (allData.length === 0) {
//             return res.status(400).json({ success: false, message: 'No data to insert' });
//         }

//         // const uniqueDates = [...new Set(allData.map(itm => itm.shDate))];
//         // await conn.query('DELETE FROM dispatch_plan WHERE sheduledDate IN (?)', [uniqueDates]);


//         const uniqueDates = [...new Set(allData.map(itm => itm.shDate))];
//         const uniqueFlags = [...new Set(allData.map(itm => itm.flag))];

//         if (uniqueDates.length > 0 && uniqueFlags.length > 0) {
//             await conn.query(
//                 `DELETE FROM dispatch_plan WHERE sheduledDate IN (?) AND contractOrPart IN (?)`,
//                 [uniqueDates, uniqueFlags]
//             );
//         }
//         const insertData = allData.map(itm => [itm.shDate, itm.contractNo, itm.qty, itm.tslot, itm.flag]);
//         await conn.query(
//             'INSERT INTO dispatch_plan (sheduledDate, contractNo, qty, timeSlot, contractOrPart) VALUES ?',
//             [insertData]
//         );

//         const shipmentDate = allData[0].shDate;
//         const shipmentData = await shipmentPlanning(conn, shipmentDate);
//         await storeShipmentDetails(conn, shipmentDate, shipmentData);

//         await conn.commit();

//         return res.status(200).json({
//             success: true,
//             message: 'Successfully imported',
//         });
//     } catch (err) {
//         await conn.rollback();
//         console.error("Import Error:", err);
//         return res.status(500).json({ success: false, message: err.message });
//     } finally {
//         conn.release();
//     }
// };
exports.import = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        if (!req.body.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
        const base64Data = req.body.file.replace(base64URL, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);

        // Determine template type based on headers
        const headers = worksheet.getRow(1).values.map(h => h?.toString().trim().toLowerCase() || '');
        const isContractTemplate = headers.includes("contract no");
        const isPartTemplate = headers.includes("part no");

        const allData = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                const itm = {
                    rId: rowNumber,
                    shDate: req.body.date,
                    flag: req.body.flag,
                };

                if (isContractTemplate) {
                    itm.contractNo = row.getCell(1).value?.toString().trim();
                    itm.tslot = row.getCell(2).value;
                    itm.qty = null; // Contract template doesn't have qty
                } else if (isPartTemplate) {
                    itm.contractNo = row.getCell(1).value?.toString().trim();
                    itm.qty = row.getCell(2).value;
                    itm.tslot = row.getCell(3).value;
                } else {
                    throw new Error('Unknown template format');
                }

                if (!itm.contractNo) {
                    throw new Error(`Invalid data in row ${rowNumber}`);
                }

                allData.push(itm);
            }
        });

        if (allData.length === 0) {
            return res.status(400).json({ success: false, message: 'No data to insert' });
        }

        const uniqueDates = [...new Set(allData.map(itm => itm.shDate))];
        const uniqueFlags = [...new Set(allData.map(itm => itm.flag))];

        // ✅ Step 1: Check for duplicates within the file itself
        // const seenContracts = new Set();
        // for (const itm of allData) {
        //     // if (seenContracts.has(itm.contractNo)) {
        //     //     throw new Error(`Duplicate contractNo "${itm.contractNo}" found in file`);
        //     // }
        //     seenContracts.add(itm.contractNo);
        // }

        // // ✅ Step 2: Check if any contractNo already exists in DB
        // const contractNos = allData.map(itm => itm.contractNo);
        // const [existing] = await conn.query(
        //     `SELECT contractNo FROM dispatch_plan 
        //      WHERE sheduledDate IN (?) AND contractOrPart IN (?) AND contractNo IN (?)`,
        //     [uniqueDates, uniqueFlags, contractNos]
        // );

        // if (existing.length > 0) {
        //     const duplicateNos = existing.map(e => e.contractNo).join(", ");
        //     throw new Error(`ContractNo already exists: ${duplicateNos}`);
        // }
        
        // ✅ Step 3: If no duplicates, insert fresh data
        if (uniqueDates.length > 0 && uniqueFlags.length > 0) {
            await conn.query(
                `DELETE FROM dispatch_plan WHERE sheduledDate IN (?) AND contractOrPart IN (?)`,
                [uniqueDates, uniqueFlags]
            );
        }

        const insertData = allData.map(itm => [itm.shDate, itm.contractNo, itm.qty, itm.tslot, itm.flag]);
        await conn.query(
            'INSERT INTO dispatch_plan (sheduledDate, contractNo, qty, timeSlot, contractOrPart) VALUES ?',
            [insertData]
        );

        const shipmentDate = allData[0].shDate;
        const shipmentData = await shipmentPlanning(conn, shipmentDate);
        await storeShipmentDetails(conn, shipmentDate, shipmentData);

        await conn.commit();

        return res.status(200).json({
            success: true,
            message: 'Successfully imported',
        });
    } catch (err) {
        await conn.rollback();
        console.error("Import Error:", err);
        return res.status(400).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};




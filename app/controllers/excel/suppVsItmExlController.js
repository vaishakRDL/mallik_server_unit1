const excel = require('exceljs');
const { connection, CustomError, handleErrorResponse } = require('../../config/dbSql');
const { decodeBase64 } = require("../../utility/utilityFunction");




// Downloading Excel Items which has combination with Supplier from supp_vs_item
exports.download = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { id } = req.params;

        const fetchQuery = `
            SELECT 
                svi.*, sup.spCode, sup.spName AS suppName, sup.id AS supId,
                itm.itemName, itm.id AS itemId, itm.grossWeight, itm.netWeight, itm.scrapWeight, itm.itemCode,
                uomTab.name AS uom, uomTab.id AS uomId, prdFam.name AS productFamily, prdFam.id AS productFamilyId, 
                prdFin.name AS productFinish, prdFin.id AS productFinishId
            FROM supp_vs_item svi
            INNER JOIN supplier sup 
                ON svi.spName = sup.id
            INNER JOIN items itm 
                ON svi.itemName = itm.id
            LEFT JOIN mst_uom uomTab 
                ON itm.uom = uomTab.id
            LEFT JOIN item_product_family prdFam 
                ON itm.productFamily = prdFam.id
            LEFT JOIN item_product_finish prdFin 
                ON itm.productFinish = prdFin.id
            WHERE sup.id = ?
        `;

        const [results] = await conn.query(fetchQuery, [id]);

        if (!results || results.length === 0) {
            // return res.status(404).json({
            //     success: false,
            //     message: "No data found for this supplier"
            // });
            throw new CustomError("No data found for this supplier");

        }

        // Create Excel workbook & worksheet
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Supplier_Items');

        // Custom headers
        const headers = [
            'Supply Code',
            'Part No',
            'Part Name',
            'UOM',
            'Rate',
            'SOB%',
            'Supplier Desc',
            'JWDC Rate',
            'Lead Time (Days)',
            'FC Item',
            'Product Family',
            'Product Weight',
            'Product Finish',
            'Remarks'
        ];

        const headerRow = worksheet.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };

        // Set column width
        worksheet.columns.forEach(col => {
            col.width = 17;
        });

        // Add rows
        results.forEach(row => {
            worksheet.addRow([
                row.spCode,
                row.itemCode,
                row.itemName,
                row.uom,
                row.rate,
                row.sob,
                row.suppDesc,
                row.jwdcRate,
                row.leadTime,
                row.IsFcItem,
                row.productFamily,
                row.netWeight,
                row.productFinish,
                row.remarks
            ]);
        });

        // Response headers
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            'attachment; filename=Supplier_Items.xlsx'
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Excel download error:', err);
        return res.status(500).json({
            success: false,
            message: err.message
        });
    } finally {
        conn.release();
    }
};


//Download Template only for store Supply details (supp_vs_item)
exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item code', 'Rate', 'SOB', 'Supp Desc', 'JWDC Rate', 'lead Time (Days)', 'Remarks', 'FC Item']);

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


// Fetch ID for Import Function (using async/await)
async function fetchId(master, value, conn) {
    try {
        const collection = {
            supplier: {
                tbName: 'supplier',
                colName: 'spCode',
            },
            items: {
                tbName: 'items',
                colName: 'itemCode',
            }
        };

        if (!collection[master]) {
            throw new Error(`Invalid master type: ${master}`);
        }

        const { tbName, colName } = collection[master];

        const fetchQuery = `SELECT id FROM ${tbName} WHERE ${colName} = ?`;

        const [results] = await conn.query(fetchQuery, [value]);

        return results.length > 0 ? results[0].id : null;

    } catch (error) {
        // console.error(`Error fetching ID (${master}):`, error.message);
        throw error;
    }
}





exports.import = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        if (!req.body.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        if (!req.body.spCode) {
            return res.status(400).json({
                success: false,
                message: 'spCode cannot be empty'
            });
        }

        const base64URL =
            'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
        const base64Data = req.body.file.replace(base64URL, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const display = [];

        // Read Excel rows
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) {
                display.push({
                    rowNo: rowNumber,
                    suppName: req.body.spCode,
                    itemCode: row.getCell(1).value,
                    rate: row.getCell(2).value,
                    sob: row.getCell(3).value,
                    supplyDesc: row.getCell(4).value,
                    jwdcRate: row.getCell(5).value,
                    leadTime: row.getCell(6).value,
                    remarks: row.getCell(7).value,
                    isFc: row.getCell(8).value,
                });
            }
        });

        // Fetch supplier & item IDs
        for (const sp of display) {
            sp.suppId = await fetchId('supplier', sp.suppName, conn);
            sp.itemId = await fetchId('items', sp.itemCode, conn);

            if (!sp.suppId) {
                sp.errorRemarks = 'Missing suppId';
            }

            if (!sp.itemId) {
                sp.errorRemarks = sp.errorRemarks
                    ? `${sp.errorRemarks} and itemId`
                    : 'Missing itemId';
            }
        }

        return res.status(200).json({
            success: true,
            display
        });

    } catch (err) {
        console.error('Import error:', err);
        return res.status(500).json({
            success: false,
            message: 'An error occurred',
            error: err.message
        });
    } finally {
        conn.release();
    }
};


exports.store = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { items: detailArray } = req.body;

        if (!Array.isArray(detailArray) || detailArray.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid or empty items array"
            });
        }

        await conn.beginTransaction();

        /* ==============================
           FETCH EXISTING SUPP-ITEMS
        ============================== */
        const keys = detailArray
            .map(i => `('${i.suppId}','${i.itemId}')`)
            .join(",");

        const [existingRows] = await conn.query(`
            SELECT * FROM supp_vs_item
            WHERE (spName, itemName) IN (${keys})
        `);

        const existingMap = new Map();
        for (const r of existingRows) {
            existingMap.set(`${r.spName}_${r.itemName}`, r);
        }

        const changedBy = new Date().toISOString().slice(0, 10);

        /* ==============================
           PROCESS EACH ITEM
        ============================== */
        for (const item of detailArray) {
            const key = `${item.suppId}_${item.itemId}`;
            const existing = existingMap.get(key);

            /* =====================================================
               CASE 1: ITEM EXISTS → RATE CHANGE (↑ or ↓)
            ===================================================== */
            if (existing) {
                const preRate = Number(existing.rate || 0);
                const newRate = Number(item.rate || 0);
                const supItmId = existing.id;
                const remarks = item.remarks || existing.remarks;

                if (newRate !== preRate) {

                    // Delete old approved logs
                    await conn.query(
                        `DELETE FROM price_revision_log
                         WHERE supItmId = ? AND isApprove = 1`,
                        [supItmId]
                    );

                    const category = newRate > preRate ? 'Rate Increased' : 'Rate Decreased';

                    // Insert pending approval log
                    await conn.query(
                        `INSERT INTO price_revision_log
                         (spName, itemName, preRate, newRate, remarks, changedBy, isApprove, supItmId, category)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            item.suppId,
                            item.itemId,
                            preRate,
                            newRate,
                            remarks,
                            changedBy,
                            1, // pending
                            supItmId,
                            category
                        ]
                    );

                    // // Mark item under approval
                    // await conn.query(
                    //     `UPDATE items SET isPoRate = 1 WHERE id = ?`,
                    //     [item.itemId]
                    // );


                    // Mark item as rate-under-approval
                    await conn.query(
                        `UPDATE supp_vs_item SET isRate = 1 WHERE spName = ? AND  itemName = ?`,
                        [item.suppId, item.itemId]
                    );
                }

                // Update supplier vs item
                await conn.query(`
                    UPDATE supp_vs_item
                    SET rate = ?, sob = ?, suppDesc = ?, jwdcRate = ?, leadTime = ?, remarks = ?, IsFcItem = ?
                    WHERE spName = ? AND itemName = ?
                `, [
                    item.rate,
                    item.sob,
                    item.supplyDesc || null,
                    item.jwdcRate,
                    item.leadTime,
                    item.remarks,
                    item.isFc,
                    item.suppId,
                    item.itemId
                ]);
            }

            /* =====================================================
               CASE 2: NEW ITEM → DIRECT APPROVAL
            ===================================================== */
            else {
                const [result] = await conn.query(`
                    INSERT INTO supp_vs_item
                    (spName, itemName, rate, sob, suppDesc, jwdcRate, leadTime, remarks, IsFcItem)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    item.suppId,
                    item.itemId,
                    item.rate,
                    item.sob,
                    item.supplyDesc || null,
                    item.jwdcRate,
                    item.leadTime,
                    item.remarks,
                    item.isFc
                ]);

                const supItmId = result.insertId;

                // Insert pending approval log
                await conn.query(
                    `INSERT INTO price_revision_log
                     (spName, itemName, preRate, newRate, remarks, changedBy, isApprove, supItmId, category)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        item.suppId,
                        item.itemId,
                        item.rate,
                        item.rate,
                        item.remarks || null,
                        changedBy,
                        1, // pending
                        supItmId,
                        'New Item'
                    ]
                );

                // // Mark item under approval
                // await conn.query(
                //     `UPDATE items SET isPoRate = 1 WHERE id = ?`,
                //     [item.itemId]
                // );

                // Block usage until approval
                await conn.query(
                    `UPDATE supp_vs_item SET notAllow = 1 WHERE id = ?`,
                    [supItmId]
                );
            }
        }

        await conn.commit();
        conn.release();

        return res.status(200).json({
            success: true,
            message: "Excel data saved successfully"
        });

    } catch (err) {
        await conn.rollback();
        conn.release();
        console.error("storeExcelData error:", err);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: err.message
        });
    }
};


async function chkItm(itmId, res) {
    // exports.chkItm = async (req, res) => {
    try {

        // const no = req.body.itmId;

        const query = `
            SELECT 
                itm.itemName as itemName, itm.id as itemsId, SUM(svi.sob) AS total_sob

            FROM supp_vs_item svi
                INNER JOIN items itm ON svi.itemName = itm.id
                WHERE svi.itemName = ?

            GROUP BY itm.itemName
            HAVING total_sob >= 100
        `;

        const [rows] = await connection.execute(query, [itmId]);

        if (rows.length >= 0) {

            return res.status(400).json({ success: false, message: `The SOB Have already 100% for this ItemCode ${rows[0].itemsId}!` });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}




exports.dbImport = async (req, res) => {
    try {
        const buffer = await decodeBase64(req.body.file);

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);

        const [items] = await connection.execute(`SELECT id as itemId, itemCode FROM items WHERE dflag = ?`, [0]);
        const [suppliers] = await connection.execute(`SELECT id as supId, Lower(spCode) as spCode FROM supplier WHERE dflag = ?`, [0]);

        const itemMap = new Map(items.map(item => [item.itemCode, item.itemId]));
        const supplierMap = new Map(suppliers.map(sup => [sup.spCode, sup.supId]));
        const sup = [];
        const itemErr = [];
        const supErr = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                const suppId = supplierMap.get((row.getCell(1).text).toLowerCase());
                const itemId = itemMap.get(row.getCell(2).text);

                if (suppId && itemId) {
                    const sp = {
                        suppName: suppId,
                        itemName: itemId,
                        rate: row.getCell(3).text,
                        sob: row.getCell(4).text,
                        supplyDesc: row.getCell(5).text,
                        jwdcRate: row.getCell(6).text,
                        leadTime: row.getCell(7).text,
                        remarks: row.getCell(8).text,
                        isFc: row.getCell(9).text,
                    };
                    sup.push(sp);
                }
            }
        });

        const insertQuery = 'INSERT INTO supp_vs_item (spName, itemName, rate, sob, suppDesc, jwdcRate, leadTime, remarks, IsFcItem) VALUES ?';
        const values = sup.map(sp => [sp.suppName, sp.itemName, sp.rate, sp.sob, sp.supplyDesc || null, sp.jwdcRate, sp.leadTime, sp.remarks, sp.isFc]);

        const chunkSize = 5000; // Adjust based on your DB's packet size limit
        for (let i = 0; i < values.length; i += chunkSize) {
            const chunk = values.slice(i, i + chunkSize);
            await connection.query(insertQuery, [chunk]);
        }

        res.send("Success")
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

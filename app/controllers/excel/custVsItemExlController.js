const excel = require('exceljs');
const { connection, handleSuccessResponse, handleErrorResponse, CustomError } = require('../../config/dbSql');
const { decodeBase64 } = require("../../utility/utilityFunction");
const { collection: masterCollection } = require('../../utility/master');
const { collection: itemCollection } = require('../../utility/itemMaster');

async function fetchItemId(itemCode, rowNumber = null) {
    try {
        if (!itemCode) return null;

        const [rows, fields] = await connection.execute(`SELECT id FROM items WHERE itemCode = ?`, [itemCode]);

        if (rows.length > 0) {
            return rows[0].id;
        }


        if (rowNumber !== null) {
            throw new Error(`Invalid Item Code ${itemCode}, rowNumber: ${rowNumber}`);
        } else {
            // console.error(`Invalid Item Code ${itemCode}`);
            return null;
        }

        // throw new Error(`Invalid Item Code ${itemCode}, rowNumber: ${rowNumber}`);
    } catch (error) {
        throw error;
    }
}

async function fetchCustId(cCode, rowNumber = null) {
    try {
        if (!cCode) return null;

        const [rows, fields] = await connection.execute(`SELECT id FROM customer WHERE cCode = ?`, [cCode]);

        if (rows.length > 0) {
            return rows[0].id;
        }


        if (rowNumber !== null) {
            throw new Error(`Invalid Customer Code ${cCode}, rowNumber: ${rowNumber}`);
        } else {
            // console.error(`Invalid Customer Code ${cCode}`);
            return null;
        }

        // throw new Error(`Invalid Item Code ${cCode}, rowNumber: ${rowNumber}`);
    } catch (error) {
        throw error;
    }
}

async function fetchId(master, value) {
    try {
        if (!value || value == 'NULL' || value == '-' || value == '' || value == '0' || value == '#N/A') {
            return null;
        }

        const masterInfo = masterCollection[master] || itemCollection[master];
        if (!masterInfo) {
            throw new Error(`Invalid master: ${master}`);
        }

        const { tbName, mstLable } = masterInfo;
        if (!tbName || !mstLable) {
            throw new Error(`Invalid master info for: ${master}`);
        }

        const [rows, fields] = await connection.execute(`SELECT id FROM ${tbName} WHERE name = ?`, [value]);

        if (rows.length > 0) {
            return rows[0].id;
        }

        throw new Error(`Invalid ${mstLable} : ${value}`);
    } catch (error) {
        console.error(`Error fetching ${master}: ${error.message}`);
        throw error;
    }
}

//Download Template only for store Supply details (supp_vs_item)
exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item code', 'Rate', 'Uom', 'HSN Code', 'Customer Desc', 'Under Ledger', 'Item Group']);

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
                return handleErrorResponse(res, new Error('Error generating Excel file'));
            });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.import = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        if (!req.body.file) {
            throw new CustomError('No file uploaded', 400);
        }

        if (!req.body.customerId) {
            throw new CustomError('Customer Code can’t be empty', 400);
        }

        const custId = req.body.customerId;
        const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
        const base64Data = req.body.file.replace(base64URL, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const sup = [];
        const missing = [];
        const display = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) {
                const sp = {
                    rowNo: rowNumber,
                    itemName: row.getCell(1).value,
                    rate: row.getCell(2).value,
                    uom: row.getCell(3).value,
                    hsn: row.getCell(4).value,
                    custDesc: row.getCell(5).value,
                    il: row.getCell(6).value,
                    ig: row.getCell(7).value,
                };
                sup.push(sp);
            }
        });

        for (const sp of sup) {
            try {
                sp.itemId = await fetchItemId(sp.itemName);
                sp.ilId = await fetchId('underLedger', sp.il);
                sp.igId = await fetchId('itemGroup', sp.ig);

                // If any are missing, skip and mark as missing
                if (!sp.itemId || !sp.ilId || !sp.igId) {
                    missing.push({
                        rowNo: sp.rowNo,
                        itemCode: sp.itemName,
                        rate: sp.rate,
                        uom: sp.uom,
                        hsn: sp.hsn,
                        custDesc: sp.custDesc,
                        il: sp.il,
                        ig: sp.ig,
                        reason: !sp.itemId
                            ? 'Item not found'
                            : !sp.ilId
                                ? 'Invalid Under Ledger'
                                : 'Invalid Item Group',
                    });
                    continue;
                }

                // If valid → push into display list
                display.push({
                    itemCode: sp.itemName,
                    rate: sp.rate,
                    uom: sp.uom,
                    hsn: sp.hsn,
                    custDesc: sp.custDesc,
                    il: sp.il,
                    ig: sp.ig,
                });

                // Check existing record
                const [existingRows] = await conn.query(
                    `SELECT rate as oldRate 
                     FROM cust_vs_item 
                     WHERE customerId = ? AND itemId = ?`,
                    [custId, sp.itemId]
                );

                if (existingRows.length > 0) {
                    const { oldRate } = existingRows[0];
                    let lessRate = 0;

                    if (oldRate !== sp.rate) {
                        if (sp.rate < oldRate) {
                            lessRate = 1;

                            // Insert into history (less rate)
                            await conn.execute(
                                `INSERT INTO cust_vs_item_history 
                                    (customerId, itemId, old_rate, new_rate, lessRate) 
                                 VALUES (?, ?, ?, ?, ?)`,
                                [custId, sp.itemId, oldRate, sp.rate, lessRate]
                            );

                            // Skip main table update if less rate
                            continue;
                        }

                        // Insert into history (greater rate)
                        await conn.execute(
                            `INSERT INTO cust_vs_item_history 
                                (customerId, itemId, old_rate, new_rate, lessRate) 
                             VALUES (?, ?, ?, ?, ?)`,
                            [custId, sp.itemId, oldRate, sp.rate, 0]
                        );
                    }

                    // Update main table if rate >= oldRate
                    if (sp.rate >= oldRate) {
                        await conn.query(
                            `UPDATE cust_vs_item 
                             SET rate = ?, uom = ?, hsnCode = ?, customerDesc = ?, underLedger = ?, itemGroup = ? 
                             WHERE customerId = ? AND itemId = ?`,
                            [sp.rate, sp.uom, sp.hsn, sp.custDesc, sp.ilId, sp.igId, custId, sp.itemId]
                        );
                    }
                } else {
                    // Insert new record
                    await conn.query(
                        `INSERT INTO cust_vs_item 
                            (customerId, itemId, rate, uom, hsnCode, customerDesc, underLedger, itemGroup)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [custId, sp.itemId, sp.rate, sp.uom, sp.hsn, sp.custDesc, sp.ilId, sp.igId]
                    );
                }
            } catch (innerErr) {
                // Handle lookup or query failures gracefully
                missing.push({
                    rowNo: sp.rowNo,
                    itemCode: sp.itemName,
                    rate: sp.rate,
                    uom: sp.uom,
                    hsn: sp.hsn,
                    custDesc: sp.custDesc,
                    il: sp.il,
                    ig: sp.ig,
                    reason: innerErr.message || 'Unexpected error while processing row'
                });
                continue;
            }
        }

        await conn.commit();
        return res.status(200).json({
            success: true,
            message: 'Import completed with some skipped entries (if any)',
            display,
            missing
        })
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

//Download Template For CopyTo CopyFrom
exports.rateTemplate = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item code', 'Rate']);

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
                return handleErrorResponse(res, new Error('Error generating Excel file'));
            });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

//rate Update 
exports.rateImport = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        if (!req.body.file) {
            throw new CustomError('No file uploaded', 400);
        }

        if (!req.body.customerId) {
            throw new CustomError('Customer Code can’t be empty', 400);
        }

        const custId = req.body.customerId;

        const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
        const base64Data = req.body.file.replace(base64URL, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const sup = [];
        const missing = [];
        const display = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                const sp = {
                    rowNo: rowNumber,
                    itemName: row.getCell(1).value,
                    rate: row.getCell(2).value
                };
                sup.push(sp);
            }
        });

        for (const sp of sup) {
            sp.itemId = await fetchItemId(sp.itemName);

            // If itemId missing → add to missing and skip
            if (!sp.itemId) {
                missing.push({
                    itemCode: sp.itemName,
                    rate: sp.rate,
                    reason: 'Item not found in master'
                });
                continue;
            }

            // Check if record exists
            const [existingRows] = await conn.query(
                `SELECT rate as oldRate 
                    FROM cust_vs_item 
                    WHERE customerId = ? AND itemId = ?`,
                [custId, sp.itemId]
            );

            if (existingRows.length === 0) {
                // Record not found → mark missing
                missing.push({
                    itemCode: sp.itemName,
                    rate: sp.rate,
                    reason: 'ItemCode not mapped to this customer'
                });
                continue;
            }

            const { oldRate } = existingRows[0];
            let lessRate = 0;

            // Add to display list (valid rows)
            display.push({
                itemCode: sp.itemName,
                oldRate,
                newRate: sp.rate
            });

            // Rate changed?
            if (oldRate !== sp.rate) {
                if (sp.rate < oldRate) {
                    lessRate = 1;
                    await conn.execute(
                        `INSERT INTO cust_vs_item_history 
                        (customerId, itemId, old_rate, new_rate, lessRate) 
                        VALUES (?, ?, ?, ?, ?)`,
                        [custId, sp.itemId, oldRate, sp.rate, lessRate]
                    );
                    continue; // skip update if rate is less
                }

                // Rate increased or same
                await conn.execute(
                    `INSERT INTO cust_vs_item_history 
                    (customerId, itemId, old_rate, new_rate, lessRate) 
                    VALUES (?, ?, ?, ?, 0)`,
                    [custId, sp.itemId, oldRate, sp.rate]
                );

                await conn.query(
                    `UPDATE cust_vs_item 
                     SET rate = ? 
                     WHERE customerId = ? AND itemId = ?`,
                    [sp.rate, custId, sp.itemId]
                );
            }
        }
        await conn.commit();
        return res.status(200).json({
            success: true,
            message: 'Successfully imported',
            display,
            missing
        })
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

//Download Template For CopyTo CopyFrom
exports.copyTemplate = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['CopyTo Customer', 'CopyFrom Customer']);

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
                return handleErrorResponse(res, new Error('Error generating Excel file'));
            });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// Import Copy Function
exports.copy = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const buffer = await decodeBase64(req.body.file);
        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const items = [];
        const missing = [];

        // Fetch rows starting from row 2
        const rows = worksheet.getRows(2, worksheet.rowCount - 1) || [];

        for (const row of rows) {
            const copyToString = row.getCell(1).value;
            const copyFromString = row.getCell(2).value;

            // Get the IDs for copyTo and copyFrom
            const cCode = await fetchCustId(copyToString);
            const eCode = await fetchCustId(copyFromString);

            if (cCode && eCode) {
                const existingItemDetails = await fetchItemDetails(conn, cCode, eCode);

                if (existingItemDetails && existingItemDetails.length > 0) {
                    items.push(...existingItemDetails);
                } else {
                    missing.push({
                        copyTo: copyToString,
                        copyFrom: copyFromString,
                        message: `Existing details not found for Customer Code: ${copyFromString}`
                    });
                }
            } else {
                missing.push({
                    copyTo: copyToString,
                    copyFrom: copyFromString,
                    message: `Customer not found for ${!cCode ? copyToString : copyFromString}`
                });
            }
        }

        if (items.length > 0) {
            await insertItems(conn, items);
            await conn.commit();
            return res.status(200).json({
                success: true,
                message: 'Data Duplicated Successfully',
                missing
            })
        } else {
            await conn.rollback();
            throw new CustomError('No data to duplicate', 400, { missing });
        }

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

//Used in Copy Function
async function fetchItemDetails(conn, cCode, code) {
    try {
        await conn.execute('DELETE FROM cust_vs_item WHERE customerId = ?', [cCode]);
        const [rows] = await conn.execute(`SELECT * FROM cust_vs_item WHERE customerId = ?`, [code]);

        if (rows.length === 0) return [];

        rows.forEach(element => {
            element.code = cCode;
        });

        return rows;

    } catch (error) {
        throw error;
    }
}

async function insertItems(conn, items) {
    try {
        for (const sp of items) {
            await conn.execute(
                `INSERT INTO cust_vs_item (customerId, itemId, rate, customerDesc, underLedger, itemGroup) VALUES (?, ?, ?, ?, ?, ?)`,
                [sp.code, sp.itemId, sp.rate, sp.customerDesc, sp.underLedger, sp.itemGroup]
            );
        }
    } catch (error) {
        console.error('Insert Error:', error.message);
        throw error;
    }
}



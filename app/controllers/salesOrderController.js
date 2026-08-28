const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const excel = require('exceljs');
const utility = require('../utility/utilityFunction');

exports.store = async (req, res) => {
    try {
        const data = req.body;

        const query = 'INSERT INTO salesOrder (saleId, itemId, Qty) VALUES (?, ?, ?)'
        const values = [data.saleId, data.itemId, data.Qty];

        const [rows, fields] = await connection.execute(query, values);

        if (rows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully added" });
        }
        throw new CustomError("Something went wrong!", 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
}

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;

        const [fRows] = await connection.execute(`SELECT id FROM salesOrder WHERE id = ?`, [id]);

        if (fRows.length == 0) throw new CustomError("Sales Id not exists!", 404);

        const updateQuery = `UPDATE salesOrder SET itemId = ?, Qty = ? WHERE id = ?`;
        const values = [data.itemId, data.Qty, id];

        const [uRows] = await connection.execute(updateQuery, values);

        if (uRows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully updated" });
        }
        throw new CustomError("Something went wrong!", 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};

exports.deleteById = async (req, res) => {
    try {
        const id = req.params.id;

        const [rows, fields] = await connection.execute('DELETE from salesOrder WHERE id = ?', [id]);

        if (rows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully deleted" });
        }
        throw new CustomError("Record not found!", 404);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
};

exports.delete = async (req, res) => {
    try {
        const sId = req.params.id;

        const [rows, fields] = await connection.execute('DELETE from salesOrder WHERE saleId = ?', [sId]);

        if (rows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully deleted" });
        }
        throw new CustomError("Record not found!", 404);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
};

exports.show = async (req, res) => {
    try {
        const sId = req.params.id;

        const query = `
            SELECT so.id, so.saleId, so.itemId, items.itemCode, items.itemName, so.Qty 
            FROM salesOrder AS so
            INNER JOIN items ON items.id = so.itemId
            LEFT JOIN sales s ON s.saleId = so.saleId
            WHERE s.id = ?`;

        const [rows, fields] = await connection.execute(query, [sId]);

        if (rows.length >= 0) {
            return res.status(200).json({ success: true, message: "Sales Order list", data: rows });
        }

        throw new CustomError("Something went wrong!", 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
};

exports.import = async (req, res) => {
    try {
        if (!req.body.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        const sId = req.body.saleId;

        const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
        const base64Data = req.body.file.replace(base64URL, '');

        const buffer = Buffer.from(base64Data, 'base64');

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const rowsPromises = [];

        worksheet.eachRow(async (row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                const itemPromise = (async () => {
                    try {
                        const item = {
                            itemId: await utility.fetchItemId(row.getCell(1).text),
                            qty: row.getCell(2).text,
                        };
                        return item;
                    } catch (error) {
                        // console.error('Error processing row:', error);
                        throw error; // Propagate the error to reject the promise
                    }
                })();

                rowsPromises.push(itemPromise);
            }
        });

        const items = await Promise.all(rowsPromises);
        try {
            const insertQuery = `INSERT INTO salesOrder (saleId, itemId, Qty) VALUES ?`;

            const values = items.map(item => [sId, item.itemId, item.qty]);

            await connection.query(insertQuery, [values]);

            return res.status(200).json({ success: true, message: 'Successfully Imported' });

        } catch (insertError) {
            return res.status(500).json({ success: false, message: insertError.message });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

exports.fetch = async (req, res) => {
    try {
        const saleId = req.body.saleId;

        const fetchQuery = `SELECT ROW_NUMBER() OVER() as sNo, so.id, sales.orderNo, items.itemCode, items.itemName, so.Qty
            FROM sales
            LEFT JOIN customer AS cust ON cust.id = sales.customerId
            INNER JOIN salesOrder AS so ON so.saleId = sales.saleId
            INNER JOIN items ON items.id = so.itemId
            WHERE sales.id = ?`;

        const [rows] = await connection.execute(fetchQuery, [saleId]);

        return handleSuccessResponse(res, "Sales list", rows)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.template = async (req, res) => {
    try {
        const { isAssembly = 0 } = req.query;
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        const headers = isAssembly ? ['Item Code', 'Reference No', 'Qty'] : ['Item Code', 'Qty'];
        const headerRow = worksheet.addRow(headers);

        headerRow.font = { bold: true };
        headerRow.font = { size: 13 };
        headerRow.alignment = { horizontal: 'center' };

        worksheet.columns.forEach((column) => {
            column.width = 22;
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = Order Input.xlsx');

        workbook.xlsx.write(res)
            .then(() => {
                res.end();
            })
            .catch(err => {
                console.error('Error writing Excel file:', err);
                res.status(500).send('Error generating Excel file');
            });
    } catch (err) {
        handleErrorResponse(res, err);
    }
};

exports.importItems = async (req, res) => {
    try {
        const { isAssembly = 0, file } = req.body;

        if (!file) throw new CustomError('No file provided!', 400);

        const buffer = await utility.decodeBase64(file);
        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const items = [], itemCounts = new Map();

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                const itemCode = String(row.getCell(1).value || '').trim();
                let refNo = '';
                let qty;

                if (isAssembly) {
                    refNo = String(row.getCell(2).value || '').trim();
                    qty = Number(row.getCell(3).value || 0);
                } else {
                    qty = Number(row.getCell(2).value || 0);
                }

                if (!itemCode || isNaN(qty)) {
                    throw new CustomError(`Invalid data at row ${rowNumber}`, 400);
                }

                items.push(isAssembly ? { itemCode, refNo, qty } : { itemCode, qty });

                const key = `${itemCode}-${refNo}`;
                itemCounts.set(key, (itemCounts.get(key) || 0) + 1);
            }
        });

        if (items.length === 0) {
            throw new CustomError('No items found in the file!', 400);
        }

        const duplicateItems = [...itemCounts.entries()]
            .filter(([_, count]) => count > 1)
            .map(([key]) => {
                const [itemCode, refNo] = key.split('-');
                return isAssembly ? `${itemCode} (Ref: ${refNo})` : itemCode;
            });

        if (duplicateItems.length > 0) {
            throw new CustomError(`Duplicate Items found: ${duplicateItems.join(', ')}`, 400);
        }

        const placeholders = items.map(() => '?').join(',');
        const values = items.map(item => item.itemCode);
        const [rows] = await connection.execute(`SELECT id As itemId, itemCode, itemName FROM items WHERE itemCode IN (${placeholders})`, values);

       
        // Create a map for faster lookup
        const rowsMap = new Map(rows.map(row => [row.itemCode, row]));

        // Check for missing items
        const missingItems = items.filter(item => !rowsMap.has(item.itemCode));
        if (missingItems.length > 0) {
            const missingCodes = missingItems.map(item => item.itemCode).join(', ');
            throw new CustomError(`The following Items are not found!: ${missingCodes}`, 400);
        }

        // // Prepare the final result, preserving the order
        // const finalResult = items.map(item => {
        //     const matchedRow = rowsMap.get(item.itemCode);
        //     if (matchedRow) {
        //         if (isAssembly) {
        //             return {
        //                 ...matchedRow,
        //                 refNo: item.refNo,
        //                 Qty: item.qty,
        //             };
        //         } else {
        //             return {
        //                 ...matchedRow,
        //                 Qty: item.qty,
        //             };
        //         }
        //     }
        // });
        // Prepare the final result, preserving the order and avoiding duplicate IDs
        const finalResult = items.map((item, index) => {
            const matchedRow = rowsMap.get(item.itemCode);
            if (matchedRow) {
                const base = {
                    id: index + 1,
                    sNo: index + 1,
                    ...matchedRow,
                    Qty: item.qty,
                };
                if (isAssembly) base.refNo = item.refNo;
                return base;
            }
        });

        return handleSuccessResponse(res, 'Upload successful', finalResult);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


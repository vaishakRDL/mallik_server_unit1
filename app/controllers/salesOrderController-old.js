const { connection, CustomError } = require('../config/dbSql');
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

        const [fRows] = await connection.execute(`SELECT * FROM salesOrder WHERE id = ?`, [id]);

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

        const query = `SELECT so.*, items.itemCode, items.itemName FROM salesOrder AS so
            INNER JOIN items ON items.id = so.itemId
            WHERE so.saleId = ?`;

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
        // return res.send(items);
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

        const fetchQuery = `SELECT sales.*, cust.cCode, cust.cName, items.itemCode, items.itemName, so.orderNo, so.Qty, so.id FROM sales
            INNER JOIN customer AS cust ON cust.id = sales.customerId
            INNER JOIN salesOrder AS so ON so.saleId = sales.saleId
            INNER JOIN items ON items.id = so.itemId
            WHERE sales.saleId = ?`;

        const [rows] = await connection.execute(fetchQuery, [saleId]);

        if (rows.length > 0) {
            rows.forEach((element, index) => {
                element.sNo = index + 1;
            });

            return res.status(200).json({ success: true, message: "Sales list", data: rows });
        }

        throw new CustomError("No sales data found for the given status.", 404);
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
}


async function splitOrderNo(orderId, orderNo) {
    try {
        let val = 1;
        const [rows] = await connection.execute('SELECT * FROM salesOrder WHERE orderId = ? ORDER BY id DESC LIMIT 1', [orderId]);

        if (rows.length > 0) {
            const orderNum = rows[0].orderNo;
            const split = orderNum.split('-')[1];
            const intValue = parseInt(split, 10);
            val = intValue + val;
        }
        orderNo = orderNo + '-' + val;

        return orderNo;
    } catch (err) {
        //console.log(err.message);
        throw err;
    }
}



exports.splitOrder = async (req, res) => {
    try {
        const data = req.body.arrayList;
        const kanbanDate = req.body.kanbanDate;
        const items = [];

        await Promise.all(data.map(async (val) => {
            const list = await getOrderDetails(val.id, val.ParentOrderQty, val.splitOrderQty);
            items.push(list);
        }));

        const insertQuery = 'INSERT INTO salesOrder (saleId, orderId, orderNo, itemId, Qty, kanbanDate) VALUES ?';
        const values = items.map(item => [item.saleId, item.orderId, item.orderNo, item.itemId, item.Qty, kanbanDate]);
        
        const [rows] = await connection.query(insertQuery, [values]);

        if (rows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully added" });
        }

        throw new CustomError("Something went wrong!", 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
}


async function getOrderDetails(orderId, parentQty, splitQty) {
    try {
        const [rows] = await connection.execute('SELECT * FROM salesOrder WHERE id = ?', [orderId]);

        if (rows.length > 0) {
            const data = rows[0];
            const [fRows] = await connection.execute('UPDATE salesOrder SET Qty = ? WHERE id = ?', [parentQty, orderId]);
            const splitOrdNo = await splitOrderNo(data.id, data.orderNo);

            list = {
                saleId: data.saleId,
                orderId: data.id,
                orderNo: splitOrdNo,
                itemId: data.itemId,
                Qty: splitQty
            }

            return list;
        }
        throw new CustomError('Order not found!', 404);

    } catch (err) {
        //console.log(err.message);
        throw err;
    }
}

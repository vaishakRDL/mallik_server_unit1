const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { updateDocCounter } = require('../utility/docNo');
const { getOrderNo, getUser } = require('../utility/utilityFunction');

exports.getOderPriority = async () => {
    const [rows] = await connection.execute(`SELECT CASE WHEN MAX(orderPriority) THEN MAX(orderPriority) ELSE 0 END AS priority FROM order_plannings`, []);
    return rows[0].priority + 1;
}

exports.processOrder = async (req, res) => {
    try {
        const sobMstId = req.body.sobMstId;
        const [rows] = await connection.execute('SELECT * FROM sob_mst WHERE id = ?', [sobMstId]);

        if (rows.length === 0) throw new CustomError('Sob not found!', 400);
        if (rows[0].processed === 1) throw new CustomError('Orders already processed!', 400);

        const sobArray = [];

        for (const item of rows) {
            const [cRows] = await connection.execute('SELECT * FROM sob WHERE sobMstId = ?', [item.id]);
            sobArray.push(...cRows);
        }

        const user = await getUser(req);
        const { orderPlnId, orderNo } = await this.storeOrder(req, sobMstId, 0, user);

        const insertQuery = `INSERT INTO orderList (sobMstId, sobId, orderPlnId, orderNo, contractNo, itemCode, Qty, fimNo) VALUES ?`;
        const values = sobArray.map(item => [rows[0].id, item.id, orderPlnId, orderNo, item.contractNo, item.partNo, item.Qty, item.fimNo]);

        await connection.query(insertQuery, [values]);

        await connection.query('UPDATE `sob_mst` SET `processed` = ? WHERE id = ?', [1, sobMstId]);

        await updateDocCounter(connection, 'OrderPlan');

        return res.status(200).json({ success: true, message: 'Order processed Successfully' })
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
}


exports.storeOrder = async (req, sobMstId, npdCheck, user) => {
    try {
        const orderNo = await getOrderNo(req);
        let customerId = null;

        const [cRows] = await connection.execute('SELECT * FROM customer WHERE cCode = ?', ['OTIS']);
        if (cRows.length > 0) {
            customerId = cRows[0].id;
        }
        const orderPriority = await this.getOderPriority();

        const insertQ = 'INSERT INTO order_plannings (sobMstId, typeOfOrder, orderNo, customerId, requestedBy, devliveryDate, orderPriority, isNpd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        const value = [sobMstId, null, orderNo, customerId, user, null, orderPriority, npdCheck];

        const [insertRows] = await connection.execute(insertQ, value);

        if (insertRows.affectedRows > 0) {
            const orderPlnId = insertRows.insertId;
            return { orderPlnId, orderNo };
        }
        throw new CustomError('Order planning insertion failed!', 400);

    } catch (err) {
        throw err;
    }
}


exports.processSales = async (req, res) => {
    try {
        const saleId = req.body.id;

        const [rows] = await connection.execute('SELECT * FROM `sales` WHERE id = ?', [saleId]);
        if (rows.length === 0) throw new CustomError('Sale not found!', 404);
        if (rows[0].processed === 1) throw new CustomError('Orders already processed!', 400);

        const data = rows[0];
        const orderNo = data.orderNo;
        const saleUqId = data.saleId;
        const orderPriority = await this.getOderPriority();

        const user = await getUser(req);
        const insertQ = 'INSERT INTO order_plannings (saleId, orderNo, poNo, customerId, requestedBy, orderPriority, isNpd) VALUES (?, ?, ?, ?, ?, ?, ?)';
        const value = [data.id, data.orderNo, data.poRef, data.customerId, user, orderPriority, data.isNpd];
        const [insertRows] = await connection.execute(insertQ, value);

        if (insertRows.affectedRows > 0) {
            const orderPlnId = insertRows.insertId;

            const fetchQ = `SELECT  so.id, so.Qty, items.itemCode FROM salesOrder AS so
                INNER JOIN sales ON so.saleId = sales.saleId
                INNER JOIN items ON items.id = so.itemId
                WHERE so.saleId = ?
            `;
            const [itemRows] = await connection.execute(fetchQ, [saleUqId]);

            if (itemRows.length > 0) {
                const insertQuery = `INSERT INTO orderList (saleId, sOrderId, orderPlnId, orderNo, itemCode, Qty) VALUES ?`;
                const values = itemRows.map(item => [saleId, item.id, orderPlnId, orderNo, item.itemCode, item.Qty]);

                await connection.query(insertQuery, [values]);

                await connection.query('UPDATE `sales` SET `processed` = ? WHERE id = ?', [1, saleId]);

                return res.status(200).json({ success: true, message: 'Order Processed Successfully' })
            }
            throw new CustomError('Items not found in Order list!', 404);
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
}


exports.orderList = async (req, res) => {
    try {
        const orderPlnId = req.params.id;

        const fetchQuery = `
            SELECT 
                ROW_NUMBER() OVER(ORDER BY ol.id) AS slNo,
                ol.id AS id, 
                op.orderNo, 
                ol.contractNo, 
                ol.itemCode, 
                ol.Qty, 
                items.itemName 
            FROM orderList ol
            INNER JOIN order_plannings op ON op.id = ol.orderPlnId 
            LEFT JOIN items ON items.itemCode = ol.itemCode 
            WHERE ol.orderPlnId = ?
        `;
        const [rows] = await connection.execute(fetchQuery, [orderPlnId]);

        const jobCardQuery = `
            SELECT 
                COUNT(jc.id) AS totalJC, 
                SUM(CASE WHEN jc.qltyStatus = 'G' THEN 1 ELSE 0 END) AS completedJC 
            FROM mrp_mst mm 
            INNER JOIN order_plannings op ON op.id = mm.orderPlnId 
            INNER JOIN job_card jc ON jc.mrpMstId = mm.id 
            WHERE mm.orderPlnId = ?
        `;
        const [jcRows] = await connection.execute(jobCardQuery, [orderPlnId]);

        const { totalJC = 0, completedJC = 0 } = jcRows[0] || {};

        return res.status(200).json({
            success: true,
            message: 'Order lists',
            data: rows,
            totalJC,
            completedJC
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



// Split Order
async function splitOrderNo(orderId) {
    try {
        const [oRows] = await connection.execute('SELECT * FROM order_plannings WHERE id = ?', [orderId]);

        if (oRows.length === 0) {
            throw new CustomError('Order not found!', 404);
        }
        const likeOrdNo = (oRows[0].orderNo).split('-')[0];
        const [rows] = await connection.execute('SELECT * FROM order_plannings WHERE orderNo LIKE ? ORDER BY id desc', [`${likeOrdNo}%`]);

        const orderData = rows[0];

        const orderNo = orderData.orderNo;
        const splitNo = orderNo.split('-');
        const val = orderNo.includes("-") ? parseInt(splitNo[1]) + 1 : 1;
        const uniqueNo = splitNo[0] + '-' + val;

        return { orderData, uniqueNo };
    } catch (err) {
        //console.log(err.message);
        throw err;
    }
}


exports.splitOrder = async (req, res) => {
    try {
        const data = req.body.arrayList;
        const orderPlnId = req.body.orderPlnId;

        const { orderData: OD, uniqueNo: orderNo } = await splitOrderNo(orderPlnId);

        const orderQuery = 'INSERT INTO order_plannings (sobMstId, saleId, typeOfOrder, orderNo, poNo, customerId, requestedBy, devliveryDate, orderPriority, kanbanDate, file, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        const orderValues = [
            OD.sobMstId, OD.saleId, OD.typeOfOrder, orderNo, OD.poNo, OD.customerId, OD.requestedBy, OD.devliveryDate, OD.orderPriority, OD.kanbanDate, OD.file, OD.remarks,
        ]

        const [rows] = await connection.execute(orderQuery, orderValues);

        if (rows.affectedRows > 0) {
            const newOrderId = rows.insertId;

            const items = [];
            await Promise.all(data.map(async (val) => {
                const list = await getOrderDetails(newOrderId, orderNo, val.id, val.ParentOrderQty, val.splitOrderQty);
                items.push(list);
            }));

            const insertQuery = 'INSERT INTO orderList (sobMstId, sobId, saleId, sOrderId, orderPlnId, orderNo, itemCode, Qty, fimNo) VALUES ?';
            const values = items.map(item => [item.sobMstId, item.sobId, item.saleId, item.sOrderId, item.orderPlnId, item.orderNo, item.itemCode, item.Qty, item.fimNo]);

            const [iRows] = await connection.query(insertQuery, [values]);

            if (iRows.affectedRows > 0) {
                return res.status(200).json({ success: true, message: "Order split successfull" });
            }
        }
        throw new CustomError("Something went wrong!", 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
}


async function getOrderDetails(orderPlnId, orderNo, orderListId, parentQty, splitQty) {
    try {
        const [rows] = await connection.execute('SELECT * FROM orderList WHERE id = ?', [orderListId]);

        if (rows.length > 0) {
            const data = rows[0];
            const [fRows] = await connection.execute('UPDATE orderList SET Qty = ? WHERE id = ?', [parentQty, orderListId]);

            list = {
                sobMstId: data.sobMstId,
                sobId: data.sobId,
                saleId: data.saleId,
                sOrderId: data.sOrderId,
                orderPlnId: orderPlnId,
                orderNo: orderNo,
                itemCode: data.itemCode,
                Qty: splitQty,
                fimNo: data.fimNo
            }

            return list;
        }
        throw new CustomError('Orderlist not found!', 404);

    } catch (err) {
        //console.log(err.message);
        throw err;
    }
}


exports.deleteOrderPln = async (req, res) => {
    try {
        const opId = req.params.id;
        const [opRows] = await connection.execute(`SELECT id FROM order_plannings WHERE id = ?`, [opId]);

        if (opRows.length > 0) {
            const [mrpRows] = await connection.execute(`SELECT id FROM mrp_mst WHERE orderPlnId = ?`, [opId]);

            if (mrpRows.length <= 0) {
                await connection.execute(`DELETE FROM order_plannings WHERE id = ?`, [opId]);

                return handleSuccessResponse(res, `Delete successful`);
            }
            throw new CustomError('MRP already generated for this order. Deletion not possible.', 400);
        }
        throw new CustomError('Order details id not found!', 404);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.updatePriority = async (res, orderPlnId, dayDiff) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        await connection.execute(`UPDATE order_plannings SET status = ?, delay = ?, orderPriority = ? WHERE id = ?`, ['Completed', dayDiff, 0, orderPlnId]);

        const [rows] = await conn.execute(`SELECT id FROM order_plannings WHERE orderPriority != ? ORDER BY orderPriority ASC`, [0]);

        const updateQuery = `UPDATE order_plannings SET orderPriority = ? WHERE id = ?`;
        let priority = 1;
        for (const row of rows) {
            await conn.execute(updateQuery, [priority, row.id]);
            priority++;
        }
        await conn.commit();

        return handleSuccessResponse(res, 'Priorities updated successfully')
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

const validateItems = async (scrapItems) => {
    const placeholders = scrapItems.map(() => '?').join(',');
    const values = scrapItems.map(itm => itm.itemCode);

    const [rows] = await connection.execute(`SELECT id, itemCode FROM items WHERE itemCode IN (${placeholders})`, values);

    // Create a Map from rows for quick lookup
    const map = new Map(rows.map(itm => [itm.itemCode, itm.id]));

    // Filter scrapItems to find missing item codes
    const missingItems = scrapItems.filter(itm => !map.has(itm.itemCode));

    if (missingItems.length > 0) {
        throw new CustomError(`Items not registered: ${missingItems.map(itm => itm.itemCode).join(',')}`);
    }
    const finalItems = scrapItems.map(itm => ({
        itemCode: itm.itemCode,
        Qty: itm.Qty,
        itemId: map.get(itm.itemCode)
    }));

    return finalItems;
}


exports.scrapItems = async (req, res) => {
    try {
        const { saleId, scrapItems } = req.body;

        const items = await validateItems(scrapItems);

        const values = items.map(itm => [saleId, itm.itemId, itm.Qty]);

        await connection.query(`INSERT INTO salesOrder (saleId, itemId, Qty) VALUES ?`, [values]);

        return res.status(200).json({
            message: true,
            saleId
        })
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

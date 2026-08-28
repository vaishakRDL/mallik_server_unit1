const { fn } = require('moment');
const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { fetchSobItems, checkJcCondition, storeJcPart, getJcNo, storeMstMRP, storeMrp, splitFim, childItems } = require('./mrpController');
const { automation } = require('./allocateController');


async function processSales(id) {
    const conn = await connection.getConnection();  // Obtain a connection from the pool
    await conn.beginTransaction();

    try {
        // Fetch sale details and associated order planning ID
        const [rows] = await conn.execute(
            `SELECT sales.*, op.id as orderPlnId FROM sales
            LEFT JOIN order_plannings op ON op.saleId = sales.id
            WHERE sales.id = ?`,
            [id]
        );

        if (rows.length === 0) throw new CustomError('Sale not found!', 404);

        const { saleId, orderNo, orderPlnId, fim, poRef, customerId, orderPriority } = rows[0];

        if (orderPlnId) {
            // Order planning already exists
            return { orderPlnId, fim };
        } else {
            // Insert new order planning
            const insertQ = 'INSERT INTO order_plannings (saleId, orderNo, poNo, customerId, orderPriority) VALUES (?, ?, ?, ?, ?)';
            const values = [id, orderNo, poRef, customerId, orderPriority];
            const [insertResult] = await conn.execute(insertQ, values);

            if (insertResult.affectedRows > 0) {
                const insertId = insertResult.insertId;

                // Fetch items associated with the sale
                const fetchQ = `SELECT so.id, so.Qty, items.itemCode, sales.fim FROM salesOrder AS so
                                INNER JOIN sales ON so.saleId = sales.saleId 
                                INNER JOIN items ON items.id = so.itemId
                                WHERE so.saleId = ?`;
                const [itemRows] = await conn.execute(fetchQ, [saleId]);

                if (itemRows.length > 0) {
                    // Insert order list
                    const insertQuery = `INSERT INTO orderList (saleId, sOrderId, orderPlnId, orderNo, itemCode, Qty, fimNo) VALUES ?`;
                    const orderListValues = itemRows.map(item => [id, item.id, insertId, orderNo, item.itemCode, item.Qty, item.fim]);
                    await conn.query(insertQuery, [orderListValues]);

                    // Update sales to mark as processed
                    await conn.query('UPDATE `sales` SET `processed` = ? WHERE id = ?', [1, id]);

                    // Commit transaction
                    await conn.commit();
                    return { orderPlnId: insertId, fim };
                }
                throw new CustomError('Items not found in Order list!', 404);
            }
            throw new CustomError('Order insertion failed!', 400);
        }
    } catch (err) {
        // Rollback transaction in case of error
        await conn.rollback();
        throw err;
    } finally {
        // Release the connection
        conn.release();
    }
}

exports.assemblyMRP = async (req, res) => {
    let mrpMstId;

    try {
        const saleId = req.body.saleId;
        const kanbanDate = req.body.kanbanDate;
        const typeOfOrder = req.body.typeOfOrder;

        if (!saleId || !kanbanDate || !typeOfOrder) throw new CustomError('Request body can not be empty!', 400);

        const { orderPlnId: opId, fim } = await processSales(saleId);
        const { isOrderInput, isBatchProd, rows: opRows, cRows: sRows } = await fetchSobItems(opId);

        //console.log('isOrderInput', isOrderInput);
        //console.log('isBatchProd', isBatchProd);
        if (sRows.length === 0) {
            throw new CustomError('Sob not found!', 404);
        }
        mrpMstId = await storeMstMRP(opRows);

        const mrpArray = [];
        const missingItems = [];
        const conFalseItems = [];

        for (const item of sRows) {
            const orderId = item.id;
            const itemId = item.itemId;
            const itemCode = item.itemCode;
            const orderQty = item.Qty;
            const fimNo = item.fimNo;
            const fim = fimNo == null ? null : await splitFim(fimNo);
            const contractNo = item.contractNo;

            const [bRow] = await connection.execute(`SELECT * FROM bom_mst WHERE itemCode = ?`, [itemCode]);

            // JC  number
            // let jcId = null;
            // if (await checkJcCondition(isOrderInput, isBatchProd, itemCode)) {
            //     jcId = await storeJcPart(isOrderInput, orderId, mrpMstId, itemCode, orderQty, contractNo);
            // } else {
            //     if (!conFalseItems.includes(itemCode)) {
            //         conFalseItems.push(itemCode);
            //     }
            //     mrpArray.push({ opId: opId, orderId: orderId, jcId: jcId, itemId: itemId, itemCode: itemCode, Qty: orderQty, fim: fim, contractNo });
            // }

            if (bRow.length > 0) {
                const query = `
                    SELECT bom_mst.itemId as mstPartId, bom.*, items.isBom, items.itemName, items.itemCode FROM bom_mst
                        INNER JOIN bom ON bom.bomMstId = bom_mst.id
                        INNER JOIN items ON items.id = bom.itemId
                    WHERE bom_mst.itemCode = ?
                `;

                const [rows] = await connection.execute(query, [itemCode]);

                if (rows.length > 0) {
                    for (const element of rows) {
                        const childOrderQty = orderQty * element.Qty;
                        const obj = { opId: opId, orderId: orderId, jcId: jcId, itemId: element.itemId, itemCode: element.itemCode, Qty: childOrderQty, fim: fim, contractNo }
                        mrpArray.push(obj);

                        if (element.isBom == 'Y') {
                            const childItemsResult = await childItems(isOrderInput, isBatchProd, orderId, mrpMstId, opId, element.itemId, element.itemCode, childOrderQty, fim, contractNo, jcId);
                            mrpArray.push(...childItemsResult);
                        } 
                    }
                } else {
                    //console.log("child missing", itemCode)
                }
            } else {
                if (!missingItems.includes(itemCode)) {
                    missingItems.push(itemCode);
                }
            }
        }
        //console.log('mrpArray ', mrpArray.length)
        //console.log('missingItems ', missingItems)
        //console.log('conFalseItems ', conFalseItems)

        const storeData = await storeMrp(mrpMstId, mrpArray)   // Storing MRP and JC

        if (storeData) {
            const srnMstId = await automation(mrpMstId); // Allocation

            await connection.execute('UPDATE order_plannings SET typeOfOrder = ?, kanbanDate = ?, status = ?, mrpStatus = ? WHERE id = ?', [typeOfOrder, kanbanDate, 'Mrp', 1, opId]);
            await connection.execute(`UPDATE mrp_mst SET srnMstId = ? WHERE id = ?`, [srnMstId, mrpMstId]);

            return res.status(200).json({ success: true, message: "MRP generation successfull" })
        }
        throw new CustomError('Something went wrong!', 400);

    } catch (err) {
        if (mrpMstId) {
            await connection.execute(`DELETE FROM mrp_mst WHERE id = ?`, [mrpMstId]);
        }
        //console.log(err)
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
}




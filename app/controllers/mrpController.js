const { connection, CustomError, handleErrorResponse } = require('../config/dbSql');
const { generateDocNo, updateDocCounter } = require('../utility/docNo');
const { storeSfg } = require('./allocateController');
const { jobCardPlanning, childPartPlanning } = require('./planningController');
const { shopFloorSchedule, aggregateChildCounts } = require('./scheduleController');
const { storeRequestNote } = require('./storeReqController');

const npdItemsCheck = async (opId) => {
    try {
        const [orderRows] = await connection.execute(`SELECT itemCode FROM orderlist WHERE orderPlnId = ?`, [opId]);
        if (orderRows.length === 0) throw new CustomError(`Items not found!`);

        const itemCodes = orderRows.map(row => row.itemCode);
        const placeholders = itemCodes.map(() => '?').join(',');

        const [itemRows] = await connection.execute(`SELECT itemCode FROM items WHERE itemCode IN (${placeholders})`, itemCodes);

        if (itemRows.length !== itemCodes.length) {
            throw new CustomError(`Npd Items are not registered!`, 400);
        }

        return true;
    } catch (err) {
        throw err;
    }
}

exports.fetchSobItems = async (opId) => {
    try {
        let isOrderInput = false;
        let isBatchProd = true;
        const [rows] = await connection.execute('SELECT * FROM order_plannings WHERE id = ?', [opId]);

        if (rows.length === 0) throw new CustomError('Order Planing not found!', 404);

        const { mrpStatus, saleId, isNpd } = rows[0];

        if (mrpStatus === 1) throw new CustomError('MRP has already been generated for this order!', 400);

        if (isNpd) {
            await npdItemsCheck(opId);
        }

        if (saleId != null) {
            isOrderInput = true;
            const [OIRows] = await connection.execute('SELECT id FROM sales WHERE id = ? AND isBatchProd = ?', [rows[0].saleId, 1]);
            if (!OIRows.length) {
                isBatchProd = false;
            }
        }

        const query = `SELECT ol.id, items.id as itemId, ol.sobMstId, ol.sOrderId, ol.itemCode, ol.Qty, ol.fimNo, ol.contractNo, items.jcPart FROM orderList ol
            INNER JOIN items ON items.itemCode = ol.itemCode
            WHERE ol.orderPlnId = ?
        `;
        const [cRows] = await connection.execute(query, [opId]);

        return { isOrderInput, isBatchProd, rows, cRows };
    } catch (err) {
        throw err;
    }
}


// Store MRP data into the database
exports.storeMrp = async (conn, mrpMstId, sobList) => {
    try {
        //console.log('MRP insertion started...');

        // Aggregating quantities, orderIds, and contractNos by jcId and itemCode
        const aggregatedData = {};
        sobList.forEach(item => {
            const jcIdKey = item.jcId === null ? 'null' : item.jcId.toString();
            const key = `${jcIdKey}_${item.itemCode}`;
            if (!aggregatedData[key]) {
                aggregatedData[key] = {
                    mrpMstId,
                    orderPlnId: item.opId,
                    orderListId: new Set([item.orderId]),
                    contractNos: new Set([item.contractNo]),
                    jcId: item.jcId,
                    itemId: item.itemId,
                    itemCode: item.itemCode,
                    Qty: Number(item.Qty),
                    fim: item.fim,
                    jcPart: item.isJcPart
                };
            } else {
                aggregatedData[key].Qty += Number(item.Qty);
                aggregatedData[key].orderListId.add(item.orderId);
                aggregatedData[key].contractNos.add(item.contractNo);
            }
        });

        // Convert Sets to comma-separated strings
        Object.values(aggregatedData).forEach(item => {
            item.orderListId = Array.from(item.orderListId).join(',');
            item.contractNos = Array.from(item.contractNos).join(',');
        });

        // Generate insertion promises
        const insertPromises = Object.values(aggregatedData).map(item =>
            conn.execute(
                'INSERT INTO mrp (mrpMstId, orderPlnId, orderListId, contractNos, jcId, itemId, itemCode, Qty, fim, jcPart) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [item.mrpMstId, item.orderPlnId, item.orderListId, item.contractNos, item.jcId, item.itemId, item.itemCode, item.Qty, item.fim, item.jcPart]
            )
        );

        // Execute all insertions concurrently
        const insertResults = await Promise.all(insertPromises);

        // Check if all insertions were successful
        const allSuccessful = insertResults.every(result => result[0].affectedRows > 0);

        if (allSuccessful) {
            //console.log('MRP insertion successful.');
            return true;
        } else {
            throw new CustomError("Failed to insert MRP data.", 500);
        }
    } catch (err) {
        //console.log('Error storing MRP data:', err);
        throw err; // Rethrow the caught error for further handling
    }
}

async function updateCounter(conn, counterType) {
    await conn.execute(`
        UPDATE counter SET number = number + 1 WHERE counterType = ?`,
        [counterType]
    );

    return true;
}

// Store Mst MRP
exports.storeMstMRP = async (conn, req, opRows) => {
    try {
        if (!opRows) {
            throw new CustomError('Order planings not found!', 404);
        }

        const data = opRows[0];
        const { uniqueNo: mrpNo } = await generateDocNo(conn, req, { docType: 'Mrp' });

        const insertQ = `INSERT INTO mrp_mst (mrpNo, orderPlnId, sobMstId, saleId, orderNo, poNo, requestedBy, requestedDate, customerId, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const values = [mrpNo, data.id, data.sobMstId || null, data.saleId || null, data.orderNo || null, data.poNo || null, data.requestedBy || null, data.devliveryDate || null, data.customerId || null, 'Processed']

        const [rRows] = await conn.execute(insertQ, values);

        if (rRows.affectedRows > 0) {
            return rRows.insertId;
        }

        throw new CustomError('Mrp Insertion failed!', 400);
    } catch (err) {
        throw err;
    }
}

exports.splitFim = async (fim) => {
    if (fim == null) {
        return;
    }
    const fimNo = fim.split('FIM');
    const finalFim = 'FIM' + fimNo[1];

    return finalFim;
}

exports.checkJcCondition = async (isBatchProd, itemCode) => {
    try {
        const categories = ['BUY LC-S', 'MAKE'];

        if (isBatchProd) categories.push('BUY PRODUCTION');
        const categoryPlaceholders = categories.map(() => '?').join(', ');

        let query = `SELECT id FROM items WHERE itemCode = ? AND inActive = 0 AND category IN (${categoryPlaceholders})`;
        const params = [itemCode, ...categories];

        if (isBatchProd) {
            query += ` AND jcPart = ?`;
            params.push('Y');
        }
        const [rows] = await connection.execute(query, params);

        return rows.length > 0 ? rows[0].id : false;
    } catch (error) {
        throw error;
    }
};

// exports.checkJcCondition = async (isBatchProd, itemCode) => {
//     try {
//         const categories = ['BUY LC-S', 'MAKE'];

//         if (isBatchProd) categories.push('BUY PRODUCTION');
//         const categoryPlaceholders = categories.map(() => '?').join(', ');

//         let query = `SELECT id FROM items WHERE itemCode = ? AND inActive = 0 AND category IN (${categoryPlaceholders})`;
//         const params = [itemCode, ...categories];

//         if (isBatchProd) {
//             query += ` AND (jcPart = 'Y' OR buyProdJC = 'Y')`;
//         } else {
//             query += ` AND buyProdJC = 'Y'`;
//         }
//         const [rows] = await connection.execute(query, params);

//         return rows.length > 0 ? rows[0].id : false;
//     } catch (error) {
//         throw error;
//     }
// };

// Revised MRP generation logic with duplicate JC creation prevention
exports.getJcNo = async (conn, req) => {
    try {
        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'JobCard', customValue: '' });
        const docPrefix = uniqueNo.replace(padStartNo, '');
        return { docPrefix, incNo: Number(padStartNo) };
    } catch (err) {
        throw err;
    }
};

exports.storeJcPart = async (conn, orderId, mrpMstId, itemCode, orderQty, contractNo, docPrefix, uniqueNoRef) => {
    try {
        if (!itemCode) throw new CustomError("JC itemCode not provided!", 400);

        const [[existing]] = await conn.execute(
            'SELECT id, Qty, contractNos FROM job_card WHERE mrpMstId = ? AND itemCode = ?',
            [mrpMstId, itemCode]
        );

        if (existing) {
            const updatedQty = existing.Qty + Number(orderQty);
            const contractNos = new Set((existing.contractNos || '').split(',').filter(Boolean));
            if (contractNo) contractNos.add(contractNo);
            await conn.execute('UPDATE job_card SET Qty = ?, contractNos = ? WHERE id = ?', [updatedQty, [...contractNos].join(','), existing.id]);
            return existing.id;
        }

        const [[item]] = await conn.execute('SELECT id FROM items WHERE itemCode = ?', [itemCode]);
        if (!item) throw new CustomError(`ItemCode not found: ${itemCode}`, 404);

        const jcNo = `${docPrefix}${String(uniqueNoRef.value).padStart(5, '0')}`;
        if (jcNo.includes('undefined')) {
            throw new CustomError('Job Card Number generation failed!', 500);
        }

        const [result] = await conn.execute(
            'INSERT INTO job_card (mrpMstId, orderListId, jcNo, itemId, itemCode, Qty, contractNos) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [mrpMstId, orderId, jcNo, item.id, itemCode, orderQty, contractNo]
        );

        if (result.affectedRows) {
            uniqueNoRef.value++;
            return result.insertId;
        }

        throw new CustomError('Failed to insert job card!', 500);
    } catch (err) {
        throw err;
    }
};

exports.getBomChildren = async (conn, itemCode) => {
    const [rows] = await conn.execute(`
        SELECT bm.itemId AS mstPartId, b.*, i.isBom, i.itemName, i.itemCode 
        FROM bom_mst bm
        JOIN bom b ON b.bomMstId = bm.id
        JOIN items i ON i.id = b.itemId
        WHERE bm.itemCode = ? AND i.inActive = 0
    `, [itemCode]);

    return rows;
};

exports.childItems = async (conn, ctx, parentQty, parentId, parentCode, alreadyCreated = false) => {
    const rows = await this.getBomChildren(conn, parentCode);
    const childMrpList = [];

    if (!alreadyCreated && await this.checkJcCondition(ctx.isBatchProd, parentCode)) {
        parentId = await this.storeJcPart(conn, ctx.orderId, ctx.mrpMstId, parentCode, parentQty, ctx.contractNo, ctx.docPrefix, ctx.uniqueNoRef);
    }

    for (const row of rows) {
        const childQty = parentQty * Number(row.Qty);
        const child = {
            opId: ctx.opId, orderId: ctx.orderId, jcId: parentId,
            itemId: row.itemId, itemCode: row.itemCode, Qty: childQty,
            fim: ctx.fim, contractNo: ctx.contractNo, isJcPart: row.jcPart
        };

        childMrpList.push(child);

        if (row.isBom === 'Y') {
            const nested = await this.childItems(conn, ctx, childQty, parentId, row.itemCode, false);
            childMrpList.push(...nested);
        } else if (await this.checkJcCondition(ctx.isBatchProd, row.itemCode)) {
            await this.storeJcPart(conn, ctx.orderId, ctx.mrpMstId, row.itemCode, childQty, ctx.contractNo, ctx.docPrefix, ctx.uniqueNoRef);
        }
    }

    return childMrpList;
};

const calculateToProduce = (part, requestedQty, item) => {
    if (!item) {
        return { toProduce: 0, errorMsg: `${part} not found in inventory` };
    }

    if (item.stockControl === 'N') {
        // Stock control disabled → always produce requested qty
        return { toProduce: requestedQty, errorMsg: null };
    }

    if (Number(item.maxStock) === 0) {
        return {
            toProduce: 0,
            errorMsg: `${part}: Production not allowed (maxStock = 0)`
        };
    }

    let toProduce = 0;

    // Case 1: stock already below minStock → must produce everything
    if (Number(item.curStock) < Number(item.minStock)) {
        toProduce = requestedQty;
    } else {
        const usableStock = Number(item.curStock) - Number(item.minStock);

        if (requestedQty <= usableStock) {
            // Enough stock
            toProduce = 0;
            item.curStock -= requestedQty;
        } else {
            // Need to produce
            toProduce = requestedQty - usableStock;
            item.curStock = Number(item.minStock);
        }
    }

    // Final check: maxStock violation
    if (Number(item.curStock) + toProduce > Number(item.maxStock)) {
        return {
            toProduce: 0,
            errorMsg: `${part} exceeds max stock (${Number(item.maxStock)})`
        };
    }

    return { toProduce, errorMsg: null };
};

exports.generateMRP = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { orderId: opId, kanbanDate, typeOfOrder } = req.body;
        if (!opId || !kanbanDate || !typeOfOrder) throw new CustomError('Missing required fields!', 400);

        const { docPrefix, incNo } = await this.getJcNo(conn, req);
        const uniqueNoRef = { value: incNo };

        const { isOrderInput, isBatchProd, rows: opRows, cRows: sRows } = await this.fetchSobItems(opId);
        if (!sRows.length) throw new CustomError('SOB items not found!', 404);

        const mrpMstId = await this.storeMstMRP(conn, req, opRows);
        const mrpList = [];

        const itemQuery = `SELECT id, stockControl, minStockLvl as minStock, maxLvl as maxStock, totStk as curStock FROM items WHERE id = ? AND inActive = 0`;
        const stockErrorMsg = [];

        for (const s of sRows) {
            let orderQty = s.Qty;

            if (!isOrderInput) {
                const [[itemDetails]] = await conn.execute(itemQuery, [s.itemId]);
                const { toProduce, errorMsg } = calculateToProduce(s.itemCode, s.Qty, itemDetails);

                if (errorMsg) stockErrorMsg.push(errorMsg);
                orderQty = toProduce;
            }

            const fim = s.fimNo ? await this.splitFim(s.fimNo) : null;
            const bomExists = (await conn.execute('SELECT 1 FROM bom_mst WHERE itemCode = ?', [s.itemCode]))[0].length > 0;

            let jcId = null;
            const ctx = { isBatchProd, orderId: s.id, opId, mrpMstId, contractNo: s.contractNo, fim, docPrefix, uniqueNoRef };

            if (await this.checkJcCondition(isBatchProd, s.itemCode)) {
                jcId = await this.storeJcPart(conn, s.id, mrpMstId, s.itemCode, orderQty, s.contractNo, docPrefix, uniqueNoRef);
            } else {
                mrpList.push({ opId, orderId: s.id, jcId, itemId: s.itemId, itemCode: s.itemCode, Qty: orderQty, fim, contractNo: s.contractNo, isJcPart: s.jcPart });
            }

            if (bomExists) {
                const children = await this.childItems(conn, ctx, orderQty, jcId, s.itemCode, true);
                mrpList.push(...children);
            }
        }
        if (stockErrorMsg.length) {
            throw new CustomError(stockErrorMsg.join('; '), 400);
        }

        // console.log(mrpList)
        //console.log('Total MRP items:', mrpList.length);
        const stored = await this.storeMrp(conn, mrpMstId, mrpList);

        if (stored) {
            await storeSfg(conn, mrpMstId);
            const srnMstId = await storeRequestNote(conn, req, opId, mrpMstId);
            await conn.execute(`UPDATE mrp_mst SET srnMstId = ? WHERE id = ?`, [srnMstId, mrpMstId]);

            await Promise.all([
                jobCardPlanning(conn, mrpMstId),
                childPartPlanning(conn, mrpMstId),
                shopFloorSchedule(conn, mrpMstId),
                conn.execute(
                    `UPDATE order_plannings SET typeOfOrder = ?, kanbanDate = ?, status = ?, mrpStatus = ? WHERE id = ?`,
                    [typeOfOrder, kanbanDate, 'MRP', 1, opId]
                ),
                !isOrderInput
                    ? conn.execute(`UPDATE csl_mst SET sobStatus = 1 WHERE DATE(date) = CURDATE() AND sobStatus = 0`)
                    : null,
                updateDocCounter(conn, 'Mrp'),
                conn.execute(
                    `UPDATE document_counter SET counter = ? WHERE docType = 'JobCard' ORDER BY id DESC LIMIT 1`,
                    [uniqueNoRef.value]
                )
            ]);

            // Aggregate child part counts into parent schedule by process
            await aggregateChildCounts(conn, mrpMstId);

            await conn.commit();
            return res.status(200).json({ success: true, message: "MRP generation successful" });
        }

        throw new CustomError('Failed to store MRP!', 500);
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};
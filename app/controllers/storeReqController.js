const { handleErrorResponse, connection, CustomError, handleSuccessResponse } = require("../config/dbSql");
const { updateDocCounter } = require("../utility/docNo");
const { getUser, updateCounter } = require("../utility/utilityFunction");
const { generateSrnNo, insertSrnItems } = require("./srnController");

// Unique FIM's
const getFimList = async () => {
    const [rows] = await connection.execute(
        `SELECT name FROM item_fim_id WHERE dflag = '0'`
    );

    // Extract FIM suffixes
    const suffixSet = new Set();
    const fimArray = [];

    rows.forEach(row => {
        const index = row.name.indexOf("FIM");
        if (index !== -1) {
            const suffix = row.name.substring(index);
            if (!suffixSet.has(suffix)) {
                suffixSet.add(suffix);
                fimArray.push(suffix);
            }
        }
    });

    return fimArray;
}


// Main Item details
exports.fetchMainItemDetails = async (itemId) => {
    const query = `
        SELECT items.itemCode, items.isBom as isBomMainItem, items.category, 
            CASE WHEN items.category IN ('MAKE', 'BUY', 'BUY LC-S') THEN 1 ELSE 0 END as generateSrnMainItem,
            CASE WHEN items.category = 'BUY PRODUCTION' THEN 1 ELSE 0 END as buyProdMain
        FROM items
        WHERE items.id = ?;
    `;
    const [bomMst] = await connection.execute(query, [itemId]);
    return bomMst[0];
}

// Child Item details
exports.fetchItemsDetails = async (bomMstId, sobQty) => {
    const query = `
        SELECT items.id as itemId, items.itemCode, items.isBom, (bom.Qty * ?) as bomQty, 
            CASE WHEN items.category IN ('MAKE', 'BUY', 'BUY LC-S') THEN 1 ELSE 0 END as generateSrn,
            CASE WHEN items.category = 'BUY PRODUCTION' THEN 1 ELSE 0 END as buyProd
        FROM bom 
        INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
        INNER JOIN items ON items.id = bom.itemId
        WHERE bom_mst.itemId = ?
    `;
    const [bom] = await connection.execute(query, [sobQty, bomMstId]);
    return bom;
}

// Recursive function to fetch child details
exports.childItems = async (sobId, bomMstId, bomMstItemCode, fim, bomMstQty) => {
    try {
        const itemsList = [];

        const { isBomMainItem, generateSrnMainItem } = await this.fetchMainItemDetails(bomMstId);

        if (generateSrnMainItem) {
            itemsList.push({ sobId, itemId: bomMstId, itemCode: bomMstItemCode, Qty: bomMstQty, fim });
        }

        if (isBomMainItem === 'Y') {
            const bomItemDetails = await this.fetchItemsDetails(bomMstId, bomMstQty);

            for (const item of bomItemDetails) {
                const { itemId, itemCode, isBom, bomQty, generateSrn } = item;

                if (isBom === 'Y') {
                    const { itemsList: childParts } = await this.childItems(sobId, itemId, itemCode, fim, bomQty); // Recursive call
                    itemsList.push(...childParts);
                } else {
                    if (generateSrn) {
                        itemsList.push({ sobId, itemId, itemCode, Qty: bomQty, fim });
                    }
                }
            }
        }

        return { itemsList };
    } catch (error) {
        throw error;
    }
}

exports.groupItemsByCode = async (itemsList, type) => {
    const groupedItems = new Map();

    itemsList.forEach(row => {
        const { itemId, itemCode, Qty, fim } = row;
        const key = type === 'Assembly' ? `${fim}_${itemId}` : itemId;

        if (groupedItems.has(key)) {
            const item = groupedItems.get(key);
            groupedItems.set(key, {
                ...item,
                Qty: Number(item.Qty) + Number(Qty)
            });
        } else {
            groupedItems.set(key, { ...row });
        }
    });

    return Array.from(groupedItems.values());
}

exports.storeRequestNote = async (conn, req, orderPlnId, mrpMstId) => {
    try {
        const fimList = await getFimList();
        const finalSet = [];

        //console.log('SRN started...');

        for (const fim of fimList) {
            const fetchQuery = `
                SELECT sob.id AS sobId, items.id as itemId, items.itemCode, sob.fimNo as fim, SUM(sob.Qty) as Qty
                FROM sob
                INNER JOIN items ON items.itemCode = sob.partNo
                INNER JOIN order_plannings op ON op.sobMstId = sob.sobMstId
                WHERE op.id = ? AND sob.fimNo LIKE ? 
                GROUP BY itemCode;
            `;
            // WHERE op.id = ? AND sob.fimNo LIKE ? AND items.jcPart = 'Y' 

            //jcPart label in the fromtend rename as "Is Batch Production Part" just for reference

            const [items] = await conn.execute(fetchQuery, [orderPlnId, `%${fim}`]);

            const itemsList = [];

            await Promise.all(items.map(async element => {
                const { sobId, itemId, itemCode, Qty } = element;

                const { isBomMainItem, generateSrnMainItem } = await this.fetchMainItemDetails(itemId);

                if (generateSrnMainItem) {
                    itemsList.push({ sobId, itemId, itemCode, Qty, fim });
                }

                if (isBomMainItem === 'Y') {
                    const bomItemDetails = await this.fetchItemsDetails(itemId, Qty);
                    for (const item of bomItemDetails) {
                        const { itemId, itemCode, isBom, bomQty, generateSrn } = item;

                        if (isBom === 'Y') {
                            const { itemsList: childParts } = await this.childItems(sobId, itemId, itemCode, fim, bomQty);
                            itemsList.push(...childParts);
                        } else {
                            if (generateSrn) itemsList.push({ sobId, itemId, itemCode, Qty: bomQty, fim });
                        }
                    }
                }
            }));

            finalSet.push(...await this.groupItemsByCode(itemsList, 'Assembly'));
        }
        // BUY PRODUCTION
        const buyProdSet = await BuyProductionSRN(conn, mrpMstId);

        const srnMstId = await Promise.all([
            await this.handleInsertSRN(conn, req, finalSet, mrpMstId, null, null, null, 'Assembly'),
            await this.handleInsertSRN(conn, req, buyProdSet, mrpMstId, null, null, null, 'BUY PRODUCTION')
        ]);

        //console.log('SRN successful.');
        return srnMstId[0]; // Return Assembly SRN ID
    } catch (err) {
        throw err;
    }
};

const insertSrnIssue = async (conn, mrpMstId) => {
    await conn.execute(`
        INSERT INTO srn_issue (jcId, itemId, reqQty)
        SELECT
            m.jcId,
            m.itemId,
            SUM(m.Qty) AS reqQty
        FROM mrp m
        INNER JOIN items i ON i.id = m.itemId
        WHERE m.mrpMstId = ?
          AND i.category = 'BUY PRODUCTION' AND jcId IS NOT NULL
        GROUP BY m.jcId, m.itemId
        ON DUPLICATE KEY UPDATE
            reqQty = VALUES(reqQty)
    `, [mrpMstId]);
};

const BuyProductionSRN = async (conn, mrpMstId) => {
    try {
        const [mrpItems] = await conn.execute(`
            SELECT
                i.id as itemId,
                m.itemCode,
                m.fim,
                SUM(m.Qty) AS Qty,
                GROUP_CONCAT(DISTINCT jc.jcNo ORDER BY jc.jcNo SEPARATOR ', ') AS jcNos,
                ol.sobId
            FROM mrp m
            INNER JOIN items i ON i.id = m.itemId
            LEFT JOIN job_card jc ON jc.id = m.jcId
            LEFT JOIN orderlist ol ON ol.id = m.orderListId
            WHERE m.mrpMstId = ? AND i.category = ?
            GROUP BY m.itemId, m.fim
        `, [mrpMstId, 'BUY PRODUCTION']);
        
        await insertSrnIssue(conn, mrpMstId);

        return mrpItems;
    } catch (err) {
        throw err;
    }
}

exports.handleInsertSRN = async (conn, req, srnItems, mrpMstId, orderId, fimNo, kanbanDate, srnType) => {
    try {
        const { srn, issue } = await generateSrnNo(req);
        const requestedBy = await getUser(req);

        const insertedSrnId = await insertSrnItems(conn, req, mrpMstId, orderId, srn, issue, fimNo, kanbanDate, requestedBy, srnItems, srnType);

        return insertedSrnId;
    } catch (err) {
        throw err;
    }
}

exports.srnRequest = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { orderPlnId, mrpMstId } = req.body;
        await this.storeRequestNote(conn, req, orderPlnId, mrpMstId);

        await conn.commit();
        return handleSuccessResponse(res, 'Success');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

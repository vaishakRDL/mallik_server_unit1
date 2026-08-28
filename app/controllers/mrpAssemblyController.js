const { connection, CustomError, handleSuccessResponse, handleErrorResponse } = require("../config/dbSql");
const { fetchItemsDetails, childItems, fetchMainItemDetails, groupItemsByCode, handleInsertSRN } = require("./storeReqController");

exports.assemblySrn = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { saleId, kanbanDate } = req.body;

        const [sales] = await conn.execute(`
            SELECT s.id, s.saleId, s.generateSrn, s.fim, so.refNo, so.itemId, items.itemCode, so.Qty FROM sales s
            INNER JOIN salesorder so ON so.saleId = s.saleId
            INNER JOIN items ON items.id = so.itemId
            WHERE s.id = ? AND s.processed = ?`,
            [saleId, 0]
        )

        if (sales.length === 0) {
            throw new CustomError(`Request already processed!`, 404);
        }

        const { fim: fimNo, generateSrn } = sales[0];
        let srnMstId = null;

        if (generateSrn) {
            const itemsList = [];
            for (const element of sales) {
                const { itemId, itemCode, Qty, fim } = element;

                // Fetch main item details
                const { isBomMainItem, generateSrnMainItem } = await fetchMainItemDetails(itemId);

                if (generateSrnMainItem) {
                    itemsList.push({ itemId, itemCode, Qty, fim });
                }

                if (isBomMainItem === 'Y') {
                    // Fetch child items
                    const bomItemDetails = await fetchItemsDetails(itemId, Qty);

                    for (const item of bomItemDetails) {
                        const { itemId, itemCode, isBom, bomQty, generateSrn } = item;

                        if (isBom === 'Y') {
                            const { itemsList: childParts } = await childItems(null, itemId, itemCode, fim, bomQty); // Recursive call
                            itemsList.push(...childParts);
                        } else {
                            if (generateSrn) {
                                itemsList.push({ itemId, itemCode, Qty: bomQty, fim });
                            }
                        }
                    }
                }
            }
            // groupItemsByCode
            const finalSet = await groupItemsByCode(itemsList);

            // Store SRN
            srnMstId = await handleInsertSRN(conn, req, finalSet, null, saleId, fimNo, kanbanDate, 'Assembly');
        }
        await assemblyPlanning(conn, srnMstId, kanbanDate, sales);

        await conn.execute(`UPDATE sales SET processed = ? WHERE id = ?`, [1, saleId]);

        await conn.commit();

        return handleSuccessResponse(res, 'Srn successful')
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

const insertSrnIssueFromSrn = async (conn, srnMstId) => {
    await conn.execute(`
        INSERT INTO srn_issue (jcId, asmPlnId, srnId, itemId, reqQty)
        SELECT
            NULL AS jcId,
            NULL AS asmPlnId,
            s.id AS srnId,
            s.itemId,
            s.Qty AS reqQty
        FROM srn s
        WHERE s.srnMstId = ?
        ON DUPLICATE KEY UPDATE
            reqQty = VALUES(reqQty)
    `, [srnMstId]);
};


// const assemblyPlanning = async (conn, srnMstId, shipmentDate, items) => {
//     try {
//         const placeholders = items.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(',');
//         const assemblyQuery =  `INSERT INTO assembly_planning (saleMstId, srnMstId, shipmentDate, fim, refNo, itemId, itemCode, Qty) values ${placeholders}`;
//         const assemblyValues = items.flatMap((i) => [i.id, srnMstId, shipmentDate, i.fim, i.refNo, i.itemId, i.itemCode, i.Qty]);

//         await conn.execute(assemblyQuery, assemblyValues);
//     } catch (err) {
//         throw err;
//     }
// }

const assemblyPlanning = async (conn, srnMstId, shipmentDate, items) => {
    try {
        const placeholders = items.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(',');

        const assemblyQuery = `
            INSERT INTO assembly_planning
            (saleMstId, srnMstId, shipmentDate, fim, refNo, itemId, itemCode, Qty)
            VALUES ${placeholders}
        `;

        const assemblyValues = items.flatMap(i => [
            i.id,
            srnMstId,
            shipmentDate,
            i.fim,
            i.refNo,
            i.itemId,
            i.itemCode,
            i.Qty
        ]);

        await conn.execute(assemblyQuery, assemblyValues);

        // Insert SRN → SRN Issue
        await insertSrnIssueFromSrn(conn, srnMstId);

    } catch (err) {
        throw err;
    }
};

const { connection, handleErrorResponse, CustomError } = require("../config/dbSql");
const { paginateQuery, totRowCount } = require("../utility/pagination");


async function supplierDetails(supplierId, itemId) {
    try {
        if (supplierId) {
            const [items] = await connection.execute(`SELECT supplier.id as spId, supplier.spCode, supVsItem.itemName as itemId FROM supp_vs_item supVsItem
                INNER JOIN supplier ON supplier.id = supVsItem.spName
                WHERE supVsItem.spName = ?`, [supplierId]
            );

            if (items.length === 0) {
                return { spDetails: null, itemList: null };

            } else {
                const spDetails = { spId: items[0].spId, spCode: items[0].spCode };
                const itemList = [];
                items.forEach(element => {
                    itemList.push(element.itemId);
                });

                return { spDetails, itemList };
            }
        } else {
            const [supRows] = await connection.execute(`SELECT supplier.id as spId, supplier.spCode FROM supp_vs_item supVsItem 
                INNER JOIN supplier ON supplier.id = supVsItem.spName
                where itemName = ?
                ORDER BY sob desc
                LIMIT 1
            `, [itemId]);

            if (supRows.length > 0) {
                return supRows[0];
            }
            return { spId: null, spCode: null };
        }
    } catch (err) {
        throw err;
    }
}


exports.show = async (req, res) => {
    try {
        const supplierId = req.query.supplierId;
        let rows;
        let totRows;
        let values = [];

        let fetchQuery = `
            SELECT boi.*, mm.mrpNo, items.id as itemId, items.itemCode, items.itemName, items.category, uom.name as uom, items.totStk as stockInHand 
            FROM boi_indent as boi
            INNER JOIN items ON items.id = boi.itemId
            INNER JOIN mst_uom as uom ON uom.id = items.uom
            LEFT JOIN mrp_mst mm ON mm.id = boi.mrpMstId
        `;

        totRows = await totRowCount('boi_indent');

        if (supplierId) {
            const { spDetails, itemList } = await supplierDetails(supplierId, null);

            if (spDetails && itemList) {
                const placeholders = itemList.map(() => '?').join(',');
                fetchQuery += ` WHERE boi.itemId IN (${placeholders})`;
            }

            [rows] = await connection.execute(fetchQuery, itemList);

            rows.forEach(element => {
                element.spId = spDetails.spId,
                element.spCode = spDetails.spCode
            });
        } else {
            // Pagination
            const paginatedQuery = await paginateQuery(fetchQuery, req.query);

            [rows] = await connection.execute(paginatedQuery, values);

            // Fetching supplier details for each item concurrently
            const supplierDetailsPromises = rows.map(async (item) => {
                const { spId, spCode } = await supplierDetails(null, item.itemId);
                item.select = false;
                item.spId = spId;
                item.spCode = spCode;
            });

            await Promise.all(supplierDetailsPromises);
        }

        return res.status(200).json({
            success: true,
            message: 'BOI lists',
            data: rows,
            currentPage: Number(req.query.page || 0),
            totRows: totRows
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


exports.search = async (req, res) => {
    try {
        const { q } = req.query;

        let fetch = `
            SELECT DISTINCT spItem.spName as spId, supplier.spCode as label
            FROM supp_vs_item spItem 
            INNER JOIN supplier ON supplier.id = spItem.spName
        `;
        const values = [];

        if (q) {
            fetch += ` AND (supplier.spCode LIKE ?)`;
            values.push(`%${q}%`);
        }
        fetch += ` LIMIT 20`;
        const [rows] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "Items", data: rows });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


exports.spAndItemList = async (req, res) => {
    try {
        const { spId, itemList } = req.body;

        const spQuery = `SELECT sp.id, sp.sId, sp.spCode, sp.spName, 
         CONCAT(sp.spAdd1, ' ', sp.spAdd2, ' ', sp.spAdd3, ' ', sp.spAdd4) AS spAddress, 
        sp.gstNo, cur.id as currencyId, cur.name as currency
            FROM supplier sp
            INNER JOIN mst_currency cur ON cur.id = sp.currency
            WHERE sp.id = ?
        `;

        const [spRows] = await connection.execute(spQuery, [spId]);
        if (spRows.length === 0) throw new CustomError('Supplier not found!', 404);

        const itemsArray = [];
        const itemsArrayPromises = itemList.map(async (boiId) => {
            const fetch = `
            SELECT 
                items.id as id, items.id as itemId, items.itemCode, items.itemName as label, items.minStockLvl, items.maxLvl,
                items.totStk, items.jwQty, boi.reqQty as poQty, (sup.rate * boi.reqQty) AS amt,
                uom.name as uom, uom.id AS uomId, sup.suppDesc, sup.rate, supplier.id as supId, supplier.spName as suppName
            FROM boi_indent as boi
                INNER JOIN items ON items.id = boi.itemId
                INNER JOIN mst_uom uom ON items.uom = uom.id
                INNER JOIN supp_vs_item as sup ON items.id = sup.itemName
                INNER JOIN supplier ON supplier.id = sup.spName
            WHERE boi.id = ? AND sup.spName = ?`;

            const [row] = await connection.execute(fetch, [boiId, spId]);

            itemsArray.push(...row); 
        });

        await Promise.all(itemsArrayPromises);

        return res.status(200).json({
            success: true,
            message: 'Supplier & Items list',
            supplierDetails: spRows[0],
            itemsDetails: itemsArray
        })
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

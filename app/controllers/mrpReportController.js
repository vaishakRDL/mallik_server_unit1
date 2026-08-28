const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { mrpReportExport } = require('./excel/mrpExlController');

// Main Item details
async function fetchMainItemDetails(itemId) {
    const query = `
        SELECT items.itemCode, items.isBom as isBomMainItem, items.category
        FROM items
        WHERE items.id = ?;
    `;
    const [bomMst] = await connection.execute(query, [itemId]);
    return bomMst[0];
}

// Child Item details
async function fetchItemsDetails(bomMstId, sobQty) {
    const query = `
        SELECT items.id as itemId, items.itemCode, items.isBom, (bom.Qty * ?) as bomQty
        FROM bom 
        INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
        INNER JOIN items ON items.id = bom.itemId
        WHERE bom_mst.itemId = ?
    `;
    const [bom] = await connection.execute(query, [sobQty, bomMstId]);
    return bom;
}

// Recursive function to fetch child details
async function childItems(bomMstId, bomMstItemCode, bomMstQty, contractNos) {
    try {
        const itemsList = [];

        itemsList.push({ itemId: bomMstId, itemCode: bomMstItemCode, Qty: bomMstQty, contractNos });
        const { isBomMainItem } = await fetchMainItemDetails(bomMstId);

        if (isBomMainItem === 'Y') {
            const bomItemDetails = await fetchItemsDetails(bomMstId, bomMstQty);

            for (const item of bomItemDetails) {
                const { itemId, itemCode, isBom, bomQty } = item;

                if (isBom === 'Y') {
                    const childParts = await childItems(itemId, itemCode, bomQty, contractNos); // Recursive call
                    itemsList.push(...childParts);
                } else {
                    itemsList.push({ itemId, itemCode, Qty: bomQty, contractNos });
                }
            }
        }

        return itemsList;
    } catch (error) {
        throw error;
    }
}

// Group items by itemCode and aggregate quantities
// async function groupItemsByCode(itemsList) {
//     const groupedItems = new Map();

//     for (const item of itemsList) {
//         const { itemId, itemCode, Qty, contractNos: contractsLatest } = item;

//         let existingItem = groupedItems.get(itemCode);

//         if (!existingItem) {
//             const itemQuery = `
//                 SELECT 
//                     items.itemName, mst_item_group.code as itemGroup, mst_uom.code as uom, items.category, items.totStk, item_main_loc.name as location,
//                     item_product_family.name as productFamily, items.material, items.rmItemCode as rmItem, items.materialThickness, supplier.spCode as supplier
//                 FROM items
//                     LEFT JOIN mst_item_group ON mst_item_group.id = items.itemGroup
//                     LEFT JOIN mst_uom ON mst_uom.id = items.uom
//                     LEFT JOIN item_main_loc ON item_main_loc.id = items.mainLocation
//                     LEFT JOIN item_product_family ON item_product_family.id = items.productFamily
//                     LEFT JOIN (
//                         SELECT itemName, spName
//                         FROM supp_vs_item
//                         GROUP BY itemName
//                         ORDER BY MIN(id)
//                         LIMIT 1
//                     ) AS supp_vs_item ON supp_vs_item.itemName = items.id
//                     LEFT JOIN supplier ON supplier.id = supp_vs_item.spName
//                 WHERE 
//                     items.id = ?
//             `;

//             const [itemRow] = await connection.execute(itemQuery, [itemId]);
//             const res = itemRow[0];

//             existingItem = {
//                 Group: res.itemGroup,
//                 partNo: itemCode,
//                 partDesc: res.itemName,
//                 UOM: res.uom,
//                 Location: res.location,
//                 Category: res.category,
//                 Qty: 0,
//                 QOH: res.totStk,
//                 pendPOQty: null,
//                 jcQty: item.jcQty,
//                 prQty: null,
//                 contractNos: '',
//                 Remarks: null,
//                 productFamily: res.productFamily,
//                 MATERIAL: res.material,
//                 KANBAN: null,
//                 materialThickness: res.materialThickness,
//                 RMITEM: res.rmItem,
//                 SuppName: res.supplier
//             };

//             groupedItems.set(itemCode, existingItem);
//         }

//         // Unique contracts
//         const splitLast = existingItem.contractNos ? existingItem.contractNos.split(",") : [];
//         const splitLatest = contractsLatest ? contractsLatest.split(",") : "";
//         const combinedContracts = splitLast.concat(splitLatest);
//         const uniqueContracts = [...new Set(combinedContracts)];

//         existingItem.contractNos = uniqueContracts.join(",");
//         existingItem.Qty += Number(Qty);
//     }

//     const finalRes = Array.from(groupedItems.values()).map((item, index) => ({ slNo: index + 1, ...item }));
//     return finalRes;
// }

async function groupItemsByCode(itemsList) {
    const groupedItems = new Map();

    for (const item of itemsList) {
        const { itemId, itemCode, Qty, contractNos: contractsLatest, jcQty } = item;

        let existingItem = groupedItems.get(itemCode);

        if (!existingItem) {
            const itemQuery = `
                SELECT 
                    items.itemName,
                    mst_item_group.code AS itemGroup,
                    mst_uom.code AS uom,
                    items.category,
                    latestStock.totStk AS QOH,
                    item_main_loc.name AS location,
                    item_product_family.name AS productFamily,
                    items.material,
                    items.rmItemCode AS rmItem,
                    items.materialThickness,
                    supplier.spCode AS supplier
                FROM items
                LEFT JOIN mst_item_group ON mst_item_group.id = items.itemGroup
                LEFT JOIN mst_uom ON mst_uom.id = items.uom
                LEFT JOIN item_main_loc ON item_main_loc.id = items.mainLocation
                LEFT JOIN item_product_family ON item_product_family.id = items.productFamily
                LEFT JOIN (
                    SELECT s.itemId, s.totQty as totStk
                    FROM store s
                    INNER JOIN (
                        SELECT itemId, MAX(id) AS maxId
                        FROM store
                        GROUP BY itemId
                    ) x ON s.id = x.maxId
                ) AS latestStock ON latestStock.itemId = items.id
                LEFT JOIN (
                    SELECT itemName, spName
                    FROM supp_vs_item
                    GROUP BY itemName
                    ORDER BY MIN(id)
                    LIMIT 1
                ) AS svi ON svi.itemName = items.id
                LEFT JOIN supplier ON supplier.id = svi.spName

                WHERE items.id = ?
            `;

            const [rows] = await connection.execute(itemQuery, [itemId]);
            const res = rows[0];

            existingItem = {
                Group: res.itemGroup,
                partNo: itemCode,
                partDesc: res.itemName,
                UOM: res.uom,
                Location: res.location,
                Category: res.category,
                Qty: 0,
                QOH: Number(res.QOH ?? 0),
                pendPOQty: null,
                jcQty,
                prQty: null,
                contractNos: "",
                Remarks: null,
                productFamily: res.productFamily,
                MATERIAL: res.material,
                KANBAN: null,
                materialThickness: res.materialThickness,
                RMITEM: res.rmItem,
                SuppName: res.supplier
            };

            groupedItems.set(itemCode, existingItem);
        }
        const prevContracts = existingItem.contractNos
            ? existingItem.contractNos.split(",").filter(Boolean)
            : [];

        const latestContracts = contractsLatest
            ? contractsLatest.split(",").filter(Boolean)
            : [];

        const uniqueContracts = [...new Set([...prevContracts, ...latestContracts])];

        existingItem.contractNos = uniqueContracts.join(",");
        existingItem.Qty += Number(Qty || 0);
    }

    return Array.from(groupedItems.values()).map((item, index) => ({
        slNo: index + 1,
        ...item
    }));
}

exports.mrpReport = async (req, res) => {
    try {
        const { orderPlnId } = req.query;
        const finalSet = [];

        const fetchQuery = `
            SELECT items.id as itemId, items.itemCode, ol.fimNo as fim, SUM(ol.Qty) as Qty,
            GROUP_CONCAT(
                DISTINCT ol.contractNo ORDER BY ol.contractNo ASC SEPARATOR ','
            ) AS contractNos
            FROM orderlist ol
            INNER JOIN items on items.itemCode = ol.itemCode
            INNER JOIN order_plannings op ON op.id = ol.orderPlnId
            WHERE op.id = ?
            GROUP BY ol.itemCode;
        `;
        const [items] = await connection.execute(fetchQuery, [orderPlnId]);

        const itemsList = [];
        for (const element of items) {
            const { itemId, itemCode, Qty, contractNos } = element;

            itemsList.push({ itemId, itemCode, Qty, contractNos });
            // Fetch main item details
            const { isBomMainItem } = await fetchMainItemDetails(itemId);

            if (isBomMainItem === 'Y') {
                // Fetch child items
                const bomItemDetails = await fetchItemsDetails(itemId, Qty);

                for (const item of bomItemDetails) {
                    const { itemId, itemCode, isBom, bomQty } = item;

                    if (isBom === 'Y') {
                        const childParts = await childItems(itemId, itemCode, bomQty, contractNos); // Recursive call
                        itemsList.push(...childParts);
                    } else {
                        itemsList.push({ itemId, itemCode, Qty: bomQty, contractNos });
                    }
                }
            }
        }

        // Grouping by item code
        const groupedItems = await groupItemsByCode(itemsList);
        finalSet.push(...groupedItems);

        return await mrpReportExport(res, finalSet);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

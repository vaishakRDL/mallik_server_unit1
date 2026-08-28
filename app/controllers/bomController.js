const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const excel = require('exceljs');
const { decodeBase64 } = require('../utility/utilityFunction');
const { bomMainParts } = require('./excel/bomExlController');

exports.import = async (req, res) => {
    const conn = await connection.getConnection();  // Obtain a connection from the pool
    await conn.beginTransaction();

    try {
        const buffer = await decodeBase64(req.body.file);
        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        const bom = [];
        const itemsSet = new Set();
        let breakLoop = false;

        worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
            if (rowNumber === 1 || breakLoop) return;

            const isEmpty = row.values.every(cell => !cell || cell.toString().trim() === '');
            if (isEmpty) {
                breakLoop = true;
                return;
            }

            const mainItemCode = row.getCell(1).text.trim();
            const itemCode = row.getCell(2).text.trim();
            const qty = row.getCell(3).text.trim();
            const jcPart = row.getCell(4).text.trim().toUpperCase() === 'Y' ? 'Y' : 'N';

            bom.push({
                id: rowNumber,
                mainItemCode,
                itemCode,
                qty,
                jcPart,
                errorMessage: '',
                itemId: null,
                uomName: null,
            });
        });

        // Validate & enrich with item data
        const uniqueItemCodes = [...new Set(bom.map(b => b.itemCode))];
        const placeholders = uniqueItemCodes.map(() => '?').join(',');

        const [itemRows] = await conn.execute(`
            SELECT items.id AS itemId, items.itemCode, uom.name AS uomName 
            FROM items
            INNER JOIN mst_uom AS uom ON items.uom = uom.id
            WHERE items.itemCode IN (${placeholders})
        `, uniqueItemCodes);

        const itemMap = new Map(itemRows.map(item => [item.itemCode, item]));

        for (const row of bom) {
            const errors = [];

            if (!row.mainItemCode) errors.push('BOM PartNo is required');
            if (!row.itemCode) errors.push('Child PartNo is required');
            if (!row.qty) errors.push('Qty is required');

            const item = itemMap.get(row.itemCode);
            if (!item) errors.push(`Unknown Item: ${row.itemCode}`);
            else {
                row.itemId = item.itemId;
                row.uomName = item.uomName;
            }

            const duplicateKey = `${row.mainItemCode.toUpperCase()}-${row.itemCode.toUpperCase()}`;
            if (itemsSet.has(duplicateKey)) {
                errors.push('Duplicate Child Part');
            } else {
                itemsSet.add(duplicateKey);
            }

            row.errorMessage = errors.join('; ');
        }

        await conn.commit();
        return handleSuccessResponse(res, 'BOM data', bom);
    } catch (err) {
        await conn.rollback();  // Rollback transaction on error
        return handleErrorResponse(res, err);
    } finally {
        conn.release();  // Release the connection back to the pool
    }
};

async function bomMst(conn, itemCode) {
    try {
        const [itemRows] = await conn.execute(
            `SELECT id FROM items WHERE itemCode = ?`,
            [itemCode]
        );

        if (itemRows.length === 0) {
            throw new CustomError("Item not found: " + itemCode);
        }
        const itemId = itemRows[0].id;

        const [rows] = await conn.execute(
            `SELECT id FROM bom_mst WHERE itemCode = ?`,
            [itemCode]
        );

        if (rows.length > 0) {
            return rows[0].id;

        } else {
            const [insrtRows] = await conn.execute(
                `INSERT INTO bom_mst (itemId, itemCode) VALUES (?, ?)`,
                [itemId, itemCode]
            );

            if (insrtRows.affectedRows > 0) {
                return insrtRows.insertId;
            }

            throw new CustomError("Failed to insert record.");
        }
    } catch (err) {
        throw err;
    }
}

exports.storeBom = async (req, res) => {
    const conn = await connection.getConnection();  // Obtain a connection from the pool
    await conn.beginTransaction();
    try {
        const itemList = req.body.data;

        if (!itemList || itemList.length === 0) {
            throw new CustomError('Please select a file to import data.', 400);
        }

        // Create a map where the key is the mainItemCode
        const map = {};
        itemList.forEach(item => {
            const { itemId, mainItemCode, itemCode, qty, jcPart } = item;

            if (!map[mainItemCode]) {
                map[mainItemCode] = [];
            }
            map[mainItemCode].push({ itemId, itemCode, qty, jcPart });
        });

        // Retrieve BOM Master IDs for each mainItemCode
        const mainItemCodes = Object.keys(map);
        await deleteFromBomMst(mainItemCodes);
        const bomMstIds = await Promise.all(mainItemCodes.map(mainItemCode => bomMst(conn, mainItemCode)));

        // Prepare final set of items with bomMstId
        const finalSet = [];
        bomMstIds.forEach((bomMstId, index) => {
            const items = map[mainItemCodes[index]];
            items.forEach(item => {
                item.bomMstId = bomMstId;
                finalSet.push(item);
            });
        });

        // Insert BOM items into the database
        await Promise.all(finalSet.map(item =>
            conn.execute('INSERT INTO bom (bomMstId, itemId, Qty, jcPart) VALUES (?, ?, ?, ?)', [item.bomMstId, item.itemId, item.qty, item.jcPart])
        ));

        // Mark items as having a BOM
        await Promise.all(mainItemCodes.map(item =>
            conn.execute(`UPDATE items SET isBom = 'Y' WHERE itemCode = ?`, [item])
        ));

        await conn.commit();
        return res.status(200).json({ success: true, message: 'BOM insertion success' });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

async function deleteFromBomMst(mainItemCodes) {
    const placeholders = mainItemCodes.map(() => '?').join(',');
    await connection.execute(`DELETE FROM bom_mst WHERE itemCode IN (${placeholders})`, mainItemCodes);
}

async function childItems(conn, itemId, visited) {
    try {
        if (visited.has(itemId)) {
            return []; // Prevent circular reference
        }

        visited.add(itemId);

        const query = `
            SELECT bom.id, bom.Qty, items.id AS itemId, items.itemCode, items.isBom, items.itemName
            FROM bom_mst
            INNER JOIN bom ON bom.bomMstId = bom_mst.id
            INNER JOIN items ON items.id = bom.itemId
            WHERE bom_mst.itemId = ?
        `;

        const [rows] = await conn.execute(query, [itemId]);
        const array = [];

        for (const element of rows) {
            let obj = {
                id: element.id,
                label: element.itemCode,
                Qty: element.Qty
            };

            if (element.isBom === 'Y') {
                const childItemsResult = await childItems(conn, element.itemId, visited);
                obj.child = childItemsResult;
            }

            array.push(obj);
        }

        visited.delete(itemId);
        return array;
    } catch (error) {
        throw error;
    }
}

exports.getList = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { type, id } = req.query;

        if ((!type && !id) || id === 'undefined') {
            return res.status(200).json({ success: false, bomTree: [], data: [] });
        }

        let fetchQuery = `SELECT id as bomID, itemCode as bomItemCode FROM bom_mst bm `;
        let params = [];

        switch (type) {
            case 'first':
                fetchQuery += `ORDER BY bm.id ASC LIMIT 1`;
                break;
            case 'last':
                fetchQuery += `ORDER BY bm.id DESC LIMIT 1`;
                break;
            case 'forward':
                fetchQuery += `WHERE bm.id > ? ORDER BY bm.id ASC LIMIT 1`;
                params.push(id);
                break;
            case 'reverse':
                fetchQuery += `WHERE bm.id < ? ORDER BY bm.id DESC LIMIT 1`;
                params.push(id);
                break;
            case 'view':
                fetchQuery += `WHERE bm.id = ?`;
                params.push(id);
                break;
        }
        const [bRow] = await conn.execute(fetchQuery, params);

        if (!bRow.length) {
            throw new CustomError('BOM is not added for the selected Item code', 400);
        }
        const { bomID, bomItemCode } = bRow[0];

        const query = `
            SELECT bom.id, bom.Qty, items.id AS itemId, items.itemCode, items.isBom, items.itemName, uom.name AS uomName, bom.jcPart
            FROM bom_mst
            INNER JOIN bom ON bom.bomMstId = bom_mst.id
            INNER JOIN items ON items.id = bom.itemId
            LEFT JOIN mst_uom AS uom ON items.uom = uom.id
            WHERE bom_mst.id = ?
        `;

        const [rows] = await conn.execute(query, [bomID]);
        const array = [];
        const visited = new Set();

        for (const element of rows) {
            let obj = {
                id: element.id,
                label: element.itemCode,
                Qty: element.Qty
            };

            if (element.isBom === 'Y') {
                const childItemsResult = await childItems(conn, element.itemId, visited);
                obj.child = childItemsResult;
            }

            array.push(obj);
        }

        const finalItem = [{
            id: bomID,
            label: bomItemCode,
            showLabel: bomItemCode,
            child: array
        }];

        return res.status(200).json({ success: true, bomTree: finalItem, data: rows });
    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.item = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { q } = req.query;

        let fetch = `SELECT bom_mst.id, bom_mst.itemId, bom_mst.itemCode as label FROM bom_mst`;
        const values = [];

        if (q) {
            fetch += ` WHERE (bom_mst.itemCode LIKE ?)`;
            values.push(`%${q}%`);
        }
        fetch += ` ORDER BY CASE WHEN bom_mst.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, bom_mst.itemCode LIMIT 30`;

        const [rows] = await conn.execute(fetch, values);

        return res.status(200).json({ success: true, message: "BOM Items", data: rows });
    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

exports.updateBom = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const { itemId, itemCode, bomList } = req.body;

        if (!Array.isArray(bomList) || bomList.length === 0) {
            throw new Error('BOM list is required and should not be empty.');
        }

        const [bomMstResult] = await conn.execute(`
            SELECT id FROM bom_mst WHERE itemId = ? `,
            [itemId]
        );

        if (!bomMstResult.length) {
            throw new CustomError('BOM item not found!', 404);
        }
        const bomMstId = bomMstResult[0].id;

        await conn.execute('DELETE FROM bom WHERE bomMstId = ?', [bomMstId]);

        const placeholders = bomList.map(() => '(?, ?, ?, ?)').join(',');
        const bomValues = bomList.flatMap(item => [bomMstId, item.itemId, item.Qty, item.jcPart]);
        const bomInsertQuery = `INSERT INTO bom (bomMstId, itemId, Qty, jcPart) VALUES ${placeholders}`;

        await conn.execute(bomInsertQuery, bomValues);

        await conn.commit();
        return handleSuccessResponse(res, 'Successfully updated');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.delItem = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const id = req.params.id;

        const [rows] = await conn.execute(`DELETE from bom WHERE id = ?`, [id]);

        await conn.commit();
        return res.status(200).json({ success: true, message: 'Succesfully deleted' })
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

exports.bomMstDlt = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const bomMstCode = req.params.itemCode;

        const [rows] = await conn.execute(`
            SELECT id FROM bom_mst WHERE itemCode = ?`,
            [bomMstCode]
        );
        if (!rows.length) throw new CustomError('BOM item not found!', 404);

        await conn.execute(`DELETE FROM bom_mst WHERE itemCode = ?`, [bomMstCode]);
        await conn.execute(`UPDATE items SET isBom = ? WHERE itemCode = ?`, ['N', bomMstCode]);

        await conn.commit();

        return handleSuccessResponse(res, 'Successfully deleted');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

const fetchMainItems = async (itemId) => {
    try {
        const [bomRows] = await connection.execute(`
                SELECT bom_mst.itemCode, items.itemName, mst_uom.name as uom, mst_item_group.name as itemGroup, bom.Qty 
                FROM bom 
                INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
                INNER JOIN items ON items.id = bom_mst.itemId
                LEFT JOIN mst_uom ON mst_uom.id = items.uom
                LEFT JOIN mst_item_group ON mst_item_group.id = items.itemGroup
                WHERE bom.itemId = ?
            `, [itemId]
        );
        const finalResult = bomRows.map((item, index) => ({ id: index + 1, ...item }));
        return finalResult;
    } catch (err) {
        throw err;
    }
}

exports.fetchMainParts = async (req, res) => {
    try {
        const { itemId, type } = req.query;

        const itemsList = await fetchMainItems(itemId);

        if (type === 'View') {
            return handleSuccessResponse(res, 'Bom Main parts', itemsList);
        } else if (type === 'Export') {
            return await bomMainParts(res, itemsList);
        } else {
            throw new CustomError('Invalid type recieved!', 404);
        }
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}

exports.itemDetails = async (req, res) => {
    try {
        const { q } = req.query;

        let fetch = `
            SELECT items.id, items.id as itemId, items.itemCode, items.itemName, u.name as uomName, items.jcPart, items.isBom 
            FROM items 
            INNER JOIN mst_uom AS u on items.uom = u.id
            WHERE items.dflag = 0
        `;
        const values = [];

        if (q) {
            fetch += ` AND (items.itemCode LIKE ?)`;
            values.push(`%${q}%`);
        }
        fetch += ` ORDER BY CASE WHEN items.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, items.itemCode LIMIT 10`;

        const [rows] = await connection.execute(fetch, values);

        return handleSuccessResponse(res, `Item details`, rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.itemSearch = async (req, res) => {
    try {
        const { q = "" } = req.query;

        const fetch = `
            SELECT b.id, b.itemId, b.itemCode AS label
            FROM bom_mst b
            INNER JOIN items i ON i.id = b.itemId
            WHERE b.itemCode LIKE ?
            ORDER BY 
                CASE 
                    WHEN b.itemCode REGEXP '^[A-Za-z0-9 ]+$' THEN 0 
                    ELSE 1 
                END,
                b.itemCode
            LIMIT 30
        `;

        const [rows] = await connection.query(fetch, [`%${q}%`]);

        return res.status(200).json({
            success: true,
            message: "BOM Items",
            data: rows
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};
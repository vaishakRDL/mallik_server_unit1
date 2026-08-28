const { storeFile, getUser, generateNgrams, currentDateTimeInd } = require('../utility/utilityFunction');
const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { paginateQuery, totRowCount } = require('../utility/pagination');
const redisClient = require('../config/redisCleinet');

exports.store = async (req, res) => {
    try {
        const item = req.body;

        const fetch = `SELECT * FROM items WHERE itemCode = ? AND dflag = '0'`;
        const [results] = await connection.execute(fetch, [item.itemCode]);

        if (results.length > 0) {
            return res.status(400).json({ success: false, message: "Item name already exists!" });
        }
        const createdBy = await getUser(req);

        const columnNames = [
            'itemCode', 'itemName', 'itemGroup', 'tallyOrErp', 'inActive', 'uom', 'stdRate', 'gstCategory',
            'filePath', 'minStockLvl', 'minLvl', 'maxLvl', 'underLedger', 'reorder', 'rol', 'roq', 'shelfLifeItem',
            'hsnCode', 'critical', 'mainLocation', 'subLocation', 'productFinish', 'productFamily', 'category',
            'fimId', 'duty', 'grossWeight', 'netWeight', 'scrapWeight', 'rmItemCode', 'rmThickness', 'rmWidth',
            'rmLength', 'stockControl', 'material', 'materialThickness', 'jcPart', 'buyProdJC', 'partType', 'sdCode',
            'delPackageType', 'delLotQty', 'nonStockable', 'binNo', 'lotWiseItem', 'lotType', 'MOQ',
            'INVTOOLSEL', 'TOOLID', 'ledTime', 'STCOND', 'RMItemId', 'createdBy'
        ];

        // const values = columnNames.map(columnName => {
        //     if (columnName === 'createdBy') return createdBy;
        //     if (item.hasOwnProperty(columnName)) {
        //         const value = item[columnName] == "" ? null : item[columnName];
        //         return value;
        //     } else {
        //         return null; // Pass null for undefined properties
        //     }
        // });

        const toBooleanNumber = (v) => (v === true ? 1 : 0);
        const yesNo = (v) => (v === 'Y' ? 'Y' : 'N');

        const specialHandlers = {
            createdBy: () => createdBy,
            inActive: (item) => toBooleanNumber(item.inActive),
            nonStockable: (item) => toBooleanNumber(item.nonStockable),
            buyProdJC: (item) => yesNo(item.buyProdJC),
            jcPart: (item) => yesNo(item.buyProdJC),
        };

        const values = columnNames.map((columnName) => {
            if (specialHandlers[columnName]) {
                return specialHandlers[columnName](item);
            }
            if (Object.prototype.hasOwnProperty.call(item, columnName)) {
                const value = item[columnName];
                return value === "" ? null : value;
            }

            return null;
        });

        const placeholders = Array(values.length).fill('?').join(', ');
        const placeholderString = `(${placeholders})`;

        const store = `
            INSERT INTO items (
                ${columnNames.join(', ')}
            ) VALUES ${placeholderString}
        `;

        await connection.execute(store, values);

        return res.status(200).json({ success: true, message: "Item added successfully" });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};

exports.update = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        const { id } = req.params;
        const item = req.body;

        const [itemRow] = await conn.execute(`SELECT id FROM items WHERE id = ?`, [id]);

        if (!itemRow.length) {
            throw new CustomError('Item not found!', 404);
        }
        const updatedBy = await getUser(req);
        const filePath = storeFile(item.file, 'item');

        const columnNames = [
            'itemCode', 'itemName', 'itemGroup', 'tallyOrErp', 'inActive', 'uom', 'stdRate', 'gstCategory',
            'minStockLvl', 'minLvl', 'maxLvl', 'underLedger', 'reorder', 'rol', 'roq', 'shelfLifeItem',
            'hsnCode', 'critical', 'mainLocation', 'subLocation', 'productFinish', 'productFamily', 'category',
            'fimId', 'duty', 'grossWeight', 'netWeight', 'scrapWeight', 'rmItemCode', 'rmThickness', 'rmWidth',
            'rmLength', 'stockControl', 'material', 'materialThickness', 'jcPart', 'buyProdJC', 'partType', 'sdCode',
            'delPackageType', 'delLotQty', 'nonStockable', 'binNo', 'lotWiseItem', 'lotType', 'MOQ',
            'INVTOOLSEL', 'TOOLID', 'ledTime', 'STCOND', 'RMItemId', 'conversionConcept', 'conversionPart',
            'conversionPartId'
        ];

        const toBooleanNumber = (v) => (v === true || v === 1 ? 1 : 0);
        const yesNo = (v) => (v === 'Y' ? 'Y' : 'N');

        const specialHandlers = {
            inActive: (item) => toBooleanNumber(item.inActive),
            nonStockable: (item) => toBooleanNumber(item.nonStockable),
            buyProdJC: (item) => yesNo(item.buyProdJC),
            jcPart: (item) => yesNo(item.jcPart),
        };

        const updateParts = columnNames.map(col => `${col} = ?`);
        const values = columnNames.map(col => {
            if (specialHandlers[col]) return specialHandlers[col](item);
            return (item[col] === "" || item[col] === undefined) ? null : item[col];
        });

        // Add metadata fields
        updateParts.push('filePath = ?', 'updatedBy = ?', 'updated_at = NOW()');
        values.push(filePath, updatedBy, id);

        const updateQuery = `UPDATE items SET ${updateParts.join(', ')} WHERE id = ?`;

        await conn.execute(updateQuery, values);

        await this.incCacheVersion();

        await conn.commit();

        return handleSuccessResponse(res, 'Successfully updated');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.delete = async (req, res) => {
    try {
        const { id } = req.params;

        const [rows] = await connection.execute(`SELECT * FROM items WHERE id = ?`, [id]);

        if (rows.length === 0) {
            throw new CustomError(`Item not found!`, 404);
        }
        const deletedUser = await getUser(req);
        await this.handleDeletedRecords('items', rows[0], deletedUser)

        await connection.execute(`DELETE FROM items WHERE id = ?`, [id]);

        await this.incCacheVersion();

        return handleSuccessResponse(res, 'Successfully deleted')
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}

exports.handleDeletedRecords = async (recordType, records, deletedUser) => {
    await connection.execute(`INSERT INTO deleted_records (type, records, deletedBy) VALUES(?, ?, ?)`,
        [recordType, JSON.stringify(records), deletedUser]
    );

    return true;
}

exports.show = async (req, res) => {
    try {
        const itemId = req.query.itemId;

        const [rows] = await connection.execute(`
            SELECT 
                i.id, itemCode, itemName, i.itemCode, i.inActive, i.uom, i.stdRate, i.minStockLvl, i.maxLvl, i.shelfLifeItem, i.hsnCode, i.critical, i.category, i.mainLocation, i.material, i.materialThickness,
                i.rmWidth, i.rmLength, i.grossWeight, i.netWeight, i.scrapWeight, i.productFinish, null as coatingArea, i.productFamily, i.fimId, i.rmItemCode, i.reorder, i.rol, i.roq, i.nonStockable, i.underLedger, 
                i.gstCategory, i.stockControl, i.jcPart, i.buyProdJC, uom.name as uomName, ig.name as itemGroupName, hsn.name as hsnName, loc.name as mainLocationName, pfam.name as productFamilyName, pfin.name as productFinishName, 
                ledj.name as underLedgerName, i.itemGroup, i.tallyOrErp, i.npdFile, i.delLotQty, i.conversionConcept, i.conversionPart, i.conversionPartId, i.createdBy, DATE_FORMAT(i.created_at, '%d %b %Y %h:%i %p') AS created_at, i.updatedBy,
                CASE 
                    WHEN i.updatedBy IS NOT NULL 
                    THEN DATE_FORMAT(i.updated_at, '%d %b %Y %h:%i %p')
                    ELSE NULL
                END AS updated_at
                FROM items i
                LEFT JOIN mst_uom as uom ON uom.id = i.uom 
                LEFT JOIN mst_item_group as ig ON ig.id = i.itemGroup
                LEFT JOIN item_hsn_code AS hsn ON hsn.id = i.hsnCode
                LEFT JOIN item_main_loc AS loc ON loc.id = i.mainLocation
                LEFT JOIN item_product_family pfam ON pfam.id = i.productFamily
                LEFT JOIN item_product_finish pfin ON pfin.id = i.productFinish
                LEFT JOIN item_under_ledger as ledj ON ledj.id = i.underLedger
            WHERE i.id = ?
        `, [itemId]);

        return handleSuccessResponse(res, 'Items list', rows)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.fetch = async (req, res) => {
    try {
        const fetch = `
            SELECT items.id, items.itemCode, items.itemName FROM items 
            where items.dflag = 0
        `;

        const [rows, fields] = await connection.execute(fetch, []);

        if (rows.length >= 0) {
            return res.status(200).json({ success: true, message: "Items", data: rows });
        }

        throw new CustomError("Something went wrong!", 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}

exports.supVsItem = async (req, res) => {
    try {
        const itemId = req.params.id;

        const [rows, fields] = await connection.execute(
            `SELECT svp.*,  supplier.spCode, supplier.spName
         from supp_vs_item svp
          INNER JOIN supplier ON svp.spName = supplier.id
         where svp.itemName = ?`, [itemId]);

        return res.status(200).json({
            success: true,
            message: "Supply vs Item list",
            data: rows
        })

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
}

exports.storeStock = async (req, res) => {
    const stocks = req.body.data;

    if (!Array.isArray(stocks) || stocks.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid request: data must be a non-empty array."
        });
    }

    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        /* ---------- Insert stock history ---------- */
        const insertQuery = `
            INSERT INTO item_stock (itemId, itemCode, maxQty, minQty)
            VALUES ?
        `;

        const insertValues = stocks.map(s => [
            s.id,
            s.itemCode,
            s.maxQty || 0,
            s.minQty || 0
        ]);

        await conn.query(insertQuery, [insertValues]);

        /* ---------- Prepare JSON maps ---------- */
        const minMap = {};
        const maxMap = {};

        for (const s of stocks) {
            minMap[s.id] = s.minQty;
            maxMap[s.id] = s.maxQty;
        }

        /* ---------- Bulk update items ---------- */
        const updateQuery = `
            UPDATE items i
            SET
                i.minStockLvl = JSON_UNQUOTE(JSON_EXTRACT(?, CONCAT('$."', i.id, '"'))),
                i.maxLvl      = JSON_UNQUOTE(JSON_EXTRACT(?, CONCAT('$."', i.id, '"')))
            WHERE JSON_EXTRACT(?, CONCAT('$."', i.id, '"')) IS NOT NULL
        `;

        await conn.query(updateQuery, [
            JSON.stringify(minMap),
            JSON.stringify(maxMap),
            JSON.stringify(minMap) // WHERE condition anchor
        ]);

        await conn.commit();

        return res.status(200).json({
            success: true,
            message: "Stock levels updated successfully"
        });

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.search = async (req, res) => {
    try {
        const { q } = req.query;

        let fetch = `
            SELECT items.id, items.id As itemId, items.itemCode as label, items.itemName 
            FROM items 
            WHERE items.dflag = 0
        `;

        const values = [];

        if (q) {
            fetch += ` AND items.itemCode LIKE ?`;
            values.push(`%${q}%`);
        }

        // Push special-character-containing itemCodes last
        fetch += ` ORDER BY CASE WHEN items.itemCode REGEXP '[^a-zA-Z0-9]' THEN 1 ELSE 0 END LIMIT 60`;

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "Items", data: rows });
    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: "Internal server error",
            error: err.message
        });
    }
}

exports.getItems = async (req, res) => {
    try {
        const { type, id } = req.query;

        let items = `
            SELECT 
                i.id, itemCode, itemName, i.itemCode, i.inActive, i.uom, i.stdRate, i.minStockLvl, i.maxLvl, i.shelfLifeItem, i.hsnCode, i.critical, i.category, i.mainLocation, i.material, i.materialThickness,
                i.rmWidth, i.rmLength, i.grossWeight, i.netWeight, i.scrapWeight, i.productFinish, null as coatingArea, i.productFamily, i.fimId, i.rmItemCode, i.reorder, i.rol, i.roq, i.nonStockable, i.underLedger, 
                i.gstCategory, i.stockControl, i.jcPart, i.buyProdJC, uom.name as uomName, ig.name as itemGroupName, hsn.name as hsnName, loc.name as mainLocationName, pfam.name as productFamilyName, pfin.name as productFinishName, 
                ledj.name as underLedgerName, i.itemGroup, i.tallyOrErp, i.npdFile, i.delLotQty, i.conversionConcept, i.conversionPart, i.conversionPartId, i.createdBy, DATE_FORMAT(i.created_at, '%d %b %Y %h:%i %p') AS created_at, i.updatedBy,
                CASE 
                    WHEN i.updatedBy IS NOT NULL 
                    THEN DATE_FORMAT(i.updated_at, '%d %b %Y %h:%i %p')
                    ELSE NULL
                END AS updated_at
                FROM items i
                LEFT JOIN mst_uom as uom ON uom.id = i.uom 
                LEFT JOIN mst_item_group as ig ON ig.id = i.itemGroup
                LEFT JOIN item_hsn_code AS hsn ON hsn.id = i.hsnCode
                LEFT JOIN item_main_loc AS loc ON loc.id = i.mainLocation
                LEFT JOIN item_product_family pfam ON pfam.id = i.productFamily
                LEFT JOIN item_product_finish pfin ON pfin.id = i.productFinish
                LEFT JOIN item_under_ledger as ledj ON ledj.id = i.underLedger
            WHERE i.dflag = 0
        `;
        let params = [];

        switch (type) {
            case 'first':
                items += ` ORDER BY i.id ASC LIMIT 1`;
                break;
            case 'last':
                items += ` ORDER BY i.id DESC LIMIT 1`;
                break;
            case 'forward':
                items += ` AND i.id > ? ORDER BY i.id ASC LIMIT 1`;
                params = [id];
                break;
            case 'reverse':
                items += ` AND i.id < ? ORDER BY i.id DESC LIMIT 1`;
                params = [id];
                break;
            // If no specific type is provided, return all items
        }

        const [rows] = await connection.execute(items, params);

        return res.status(200).json({
            success: true,
            data: rows
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.updateItemRate = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const itemsList = req.body.data;
        const user = await getUser(req);

        /* ---------- Validation ---------- */
        if (!Array.isArray(itemsList) || itemsList.length === 0) {
            return handleErrorResponse(res, "Invalid or empty data");
        }

        for (const item of itemsList) {
            if (!item.id || item.itemRate === undefined) {
                return handleErrorResponse(
                    res,
                    "Each item must contain id and itemRate"
                );
            }
        }

        await conn.beginTransaction();

        /* ---------- 1. Insert Price History ---------- */
        const insertQuery = `
            INSERT INTO item_price (itemId, itemCode, rate, changedBy)
            VALUES ?
        `;

        const insertValues = itemsList.map(item => [
            item.id,
            item.itemCode,
            item.itemRate,
            user
        ]);

        await conn.query(insertQuery, [insertValues]);

        /* ---------- 2. Bulk Update items ---------- */
        const updateQuery = `
            UPDATE items i
            JOIN (
                SELECT ? AS data
            ) tmp
            SET
                i.stdRate = JSON_UNQUOTE(
                    JSON_EXTRACT(tmp.data, CONCAT('$."', i.id, '"'))
                ),
                i.updatedBy = ?,
                updated_at = NOW()
            WHERE JSON_EXTRACT(tmp.data, CONCAT('$."', i.id, '"')) IS NOT NULL
        `;

        const rateMap = {};
        for (const item of itemsList) {
            rateMap[item.id] = item.itemRate;
        }

        await conn.query(updateQuery, [
            JSON.stringify(rateMap),
            user
        ]);

        await conn.commit();

        return handleSuccessResponse(res, "Item rates updated successfully");

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.getRmCode = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;

        // Construct the SQL query to include search functionality
        let fetch = `SELECT i.id,  i.itemCode
            from items i
            INNER JOIN mst_item_group ig ON i.itemGroup = ig.id
            WHERE ig.code LIKE '%RAW MATERIAL%' `;

        const values = [];

        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` AND (i.itemCode LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
        }

        // Add ORDER BY clause to sort the results with item codes containing special characters last
        // fetch += ` LIMIT 20`;
        // fetch += ` ORDER BY CASE WHEN items.itemCode LIKE '%[^a-zA-Z0-9]%' THEN 1 ELSE 0 END, items.itemCode LIMIT 20`;  // including white space
        fetch += ` ORDER BY CASE WHEN i.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, i.itemCode LIMIT 50`;

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "Rm Items", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}

exports.incCacheVersion = async () => {
    await redisClient.incr("items:version");
    return true;
}

async function searchItems(raw, includeInactive) {
    // Wrapping inActive in an expression prevents MySQL optimizer from choosing a non-selective index on inActive
    const inactiveCondition = includeInactive ? "" : "AND (inActive + 0) = 0";

    const clean = raw.toUpperCase();
    const CACHE_TTL = 60 * 60 * 8; // 8 hrs
    const PREFIX_LIMIT = 60;
    const NGRAM_LIMIT = 3000;
    const conn = connection;
    let version = 1;

    try {
        version = await redisClient.get("items:version") || 1;
    } catch (_) { }

    // Differentiate cache key based on the includeInactive flag
    const inactiveFlag = includeInactive ? 1 : 0;
    const cacheKey = `items_search:v${version}:${clean}:${inactiveFlag}`;


    /* ----------------------------------------
       1) Check Redis Cache
    ---------------------------------------- */
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            return parsed;
        }
    } catch (_) { }

    let results = [];

    /* ----------------------------------------
       2) Always check EXACT match first
    ---------------------------------------- */
    const [exact] = await conn.execute(
        `SELECT id, id AS itemId, itemCode AS label, itemName
         FROM items
         WHERE dflag = 0 AND itemCode = ? ${inactiveCondition}
         LIMIT 1`,
        [clean]
    );

    if (exact.length) {
        const finalData = exact;
        try {
            await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(finalData));
        } catch (_) { }
        return finalData;
    }

    /* ----------------------------------------
       3) Choose Strategy
       - If length < 3 → prefix ONLY
       - Else → NGRAM + fallback prefix + fallback substring
    ---------------------------------------- */

    const useNgram = clean.length >= 2;

    /* ----------------------------------------
       3A) Prefix Search (for short input or fallback)
    ---------------------------------------- */
    async function prefixSearch() {
        // 1st query: Try to get pure alphanumeric item codes first (no filesort!)
        const [normalRows] = await conn.execute(
            `SELECT id, id AS itemId, itemCode AS label, itemName, inActive
             FROM items
             WHERE dflag = 0 AND itemCode LIKE ?
             AND itemCode NOT REGEXP '[^a-zA-Z0-9]'
             ORDER BY itemCode ASC
             LIMIT ?`,
            [`${clean}%`, PREFIX_LIMIT]
        );

        let valid = normalRows;
        if (!includeInactive) {
            valid = normalRows.filter(r => Number(r.inActive) === 0);
        }

        // If we don't have enough pure alphanumeric codes, backfill with special character codes
        if (valid.length < PREFIX_LIMIT) {
            const [specialRows] = await conn.execute(
                `SELECT id, id AS itemId, itemCode AS label, itemName, inActive
                 FROM items
                 WHERE dflag = 0 AND itemCode LIKE ?
                 AND itemCode REGEXP '[^a-zA-Z0-9]'
                 ORDER BY itemCode ASC
                 LIMIT ?`,
                [`${clean}%`, PREFIX_LIMIT]
            );

            let validSpecial = specialRows;
            if (!includeInactive) {
                validSpecial = specialRows.filter(r => Number(r.inActive) === 0);
            }

            for (const sRow of validSpecial) {
                valid.push(sRow);
                if (valid.length >= PREFIX_LIMIT) break;
            }
        }

        // Add forceSpecial explicitly for compatibility if needed implicitly by step B/C
        return valid.map(r => {
            r.forceSpecial = /^[a-zA-Z0-9]+$/.test(r.label) ? 0 : 1;
            return r;
        });
    }

    async function combinedFallbackSearch() {
        const pref = await prefixSearch();
        // We completely skip SubstringSearch here because:
        // 1. It takes 8,000ms - 34,000ms to perform a full table scan.
        // 2. N-Gram search already perfectly covers substring matching!
        // 3. For 1-2 char searches, substring matches are too chaotic to be useful anyway.
        return pref;
    }

    /* ----------------------------------------
       4) If short input (1–2 chars) → prefix + substring fallback
    ---------------------------------------- */
    if (!useNgram) {
        results = await combinedFallbackSearch();
    }

    /* ----------------------------------------
       5) N-GRAM Search (for length ≥ 3)
    ---------------------------------------- */
    else {
        const grams = generateNgrams(clean, 2);
        if (!grams.length) {
            results = await combinedFallbackSearch();
        } else {
            const unique = [...new Set(grams)];
            const gramCount = unique.length;
            const gramPlace = unique.map(() => "?").join(",");

            // Dynamic threshold (50% match or at least 2)
            let threshold = Math.max(2, Math.ceil(gramCount * 0.5));
            if (gramCount === 1) threshold = 1;

            /* Step A — Fetch best matching item IDs */
            const [idRows] = await conn.execute(
                `
                SELECT itemId, COUNT(DISTINCT ng) AS matchCount
                FROM item_ngrams
                WHERE ng IN (${gramPlace})
                GROUP BY itemId
                HAVING matchCount >= ?
                ORDER BY matchCount DESC
                LIMIT ?
                `,
                [...unique, threshold, NGRAM_LIMIT]
            );

            /* Step B: If no N-gram results, fallback */
            if (!idRows.length) {
                results = await combinedFallbackSearch();
            } else {
                const itemIds = idRows.map(r => r.itemId);
                const idPlace = itemIds.map(() => "?").join(",");

                /* Step B — fetch real items */
                const [rows] = await conn.execute(
                    `
                    SELECT id, id AS itemId, itemCode AS label, itemName,
                           (CASE WHEN itemCode REGEXP '[^a-zA-Z0-9]' THEN 1 ELSE 0 END) AS forceSpecial
                    FROM items
                    WHERE id IN (${idPlace}) ${inactiveCondition}
                    ORDER BY forceSpecial ASC, itemCode ASC
                    `,
                    [...itemIds]
                );

                /* Step C — strict filter (final accuracy) */
                results = rows
                    .filter(r => r.label.toUpperCase().includes(clean))
                    .slice(0, PREFIX_LIMIT);

                /* Step D — Fallback to fill remaining slots if needed */
                if (results.length < PREFIX_LIMIT) {
                    const extras = await combinedFallbackSearch();
                    const seen = new Set(results.map(r => r.id));
                    for (const e of extras) {
                        if (!seen.has(e.id)) {
                            results.push(e);
                            if (results.length >= PREFIX_LIMIT) break;
                        }
                    }
                }
            }
        }
    }

    /* ----------------------------------------
       6) Final formatting + cache
    ---------------------------------------- */
    const finalData = results.map(r => ({
        id: r.id,
        itemId: r.itemId,
        label: r.label,
        itemName: r.itemName
    }));

    try {
        await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(finalData));
    } catch (_) { }

    return finalData;
}

exports.itemSearch = async (req, res) => {
    try {
        const q = req.query.q?.trim();
        if (!q) return handleSuccessResponse(res, "Items", []);

        const includeInactive = (req.query.includeInactive || "true") === "true";

        const data = await searchItems(q, includeInactive);

        return handleSuccessResponse(res, "Items", data);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.upsertItemNgrams = async (conn) => {
    try {
        let lastId = 0;
        const batchSize = 1000;

        while (true) {
            const [rows] = await conn.execute(
                `SELECT id, itemCode
                 FROM items
                 WHERE ngStatus = 0 AND id > ?
                 ORDER BY id
                 LIMIT ?`,
                [lastId, batchSize]
            );

            if (rows.length === 0) break;

            const inserts = [];
            for (const row of rows) {
                const code = (row.itemCode || "").trim().toUpperCase();
                const grams = generateNgrams(code);
                for (const g of grams) {
                    inserts.push([row.id, g]);
                }
            }

            // Insert in smaller chunks to avoid huge queries
            if (inserts.length > 0) {
                const chunkSize = 5000; // adjust
                for (let i = 0; i < inserts.length; i += chunkSize) {
                    const chunk = inserts.slice(i, i + chunkSize);
                    const placeholders = chunk.map(() => "(?, ?)").join(",");
                    const values = chunk.flat();

                    await conn.execute(
                        `INSERT IGNORE INTO item_ngrams (itemId, ng)
                         VALUES ${placeholders}`,
                        values
                    );
                }
            }

            // Fast pagination update
            lastId = rows[rows.length - 1].id;
        }

        // Update only processed rows - avoids full table update
        await conn.execute(
            `UPDATE items SET ngStatus = 1 WHERE ngStatus = 0`
        );

    } catch (err) {
        throw err;
    }
};

exports.buildNgramsForAllItems = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        await this.upsertItemNgrams(conn);

        await conn.commit();

        return handleSuccessResponse(res, 'Success')
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

exports.getAllItemCache = async (req, res) => {
    try {
        const pattern = "items_search:*";
        const limit = Number(req.query.limit) || 100; // default: 100 keys

        let cursor = "0";
        const keys = [];

        do {
            const scanResult = await redisClient.scan(cursor, {
                MATCH: pattern,
                COUNT: 500
            });

            cursor = scanResult.cursor;

            for (const key of scanResult.keys) {
                keys.push(key);

                if (keys.length >= limit) {
                    return res.status(200).json({
                        success: true,
                        message: `Fetched ${limit} keys`,
                        count: keys.length,
                        keys
                    });
                }
            }

        } while (cursor !== "0");

        // Fewer keys than limit
        return res.status(200).json({
            success: true,
            message: "Fetched all available keys",
            count: keys.length,
            keys
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.clearItemCache = async (req, res) => {
    try {
        let cursor = "0";
        const pattern = "items_search:*";

        do {
            const scanResult = await redisClient.scan(cursor, {
                MATCH: pattern,
                COUNT: 1000   // smaller batch for safety
            });

            cursor = scanResult.cursor;
            const keys = scanResult.keys;

            if (keys.length > 0) {
                const multi = redisClient.multi();
                keys.forEach(k => multi.del(k));
                await multi.exec();
            }

        } while (cursor !== "0");

        return handleSuccessResponse(res, "Cache cleared in batches");
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

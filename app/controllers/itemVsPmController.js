const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');

//Get Items stored in item_vs_pm table
// exports.search = async (req, res) => {
//     try {
//         // Get the search query from the request query parameters
//         const { q } = req.query;

//         // Construct the SQL query to include search functionality
//         let fetch = `
//             SELECT  items.id, items.itemCode as label FROM items 
//             INNER JOIN item_vs_pm as itmPm ON itmPm.item = items.id
//             `;

//         const values = [];


//         // If there's a search query, add a condition to filter items based on the search query
//         if (q) {
//             fetch += ` AND (items.itemCode LIKE ?)`;
//             values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
//         }

//         // Add ORDER BY clause to sort the results with item codes containing special characters last
//         fetch += ` GROUP BY items.id, items.itemCode
//             ORDER BY CASE WHEN items.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, items.itemCode 
//             LIMIT 20 `;

//         const [rows, fields] = await connection.execute(fetch, values);

//         return res.status(200).json({ success: true, message: "Items", data: rows });

//     } catch (err) {
//         return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
//     }
// }




async function searchItems(q) {
    const raw = (q || "").trim();
    if (!raw) return [];

    const clean = raw.toUpperCase();
    const CACHE_TTL = 60 * 60 * 8; // 8 hrs
    const PREFIX_LIMIT = 60;
    const NGRAM_LIMIT = 5000;
    const conn = connection;
    const cacheKey = `item_vs_pm:${clean}`;

    // 1) Redis Cache
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (_) { }

    // 2) Strategy
    const hasDigit = /\d/.test(clean);
    const useNgram = hasDigit || clean.length >= 2;

    let results = [];

    // 3) PREFIX SEARCH
    if (!useNgram) {
        const [rows] = await conn.execute(
            `SELECT i.id, i.itemCode AS label
             FROM item_vs_pm 
             INNER JOIN items i ON i.id = item_vs_pm.item
             WHERE i.dflag = 0 AND i.itemCode LIKE ?
             GROUP BY i.id
             ORDER BY i.hasSpecial ASC, i.itemCode ASC
             LIMIT ?`,
            [`${clean}%`, PREFIX_LIMIT]
        );
        results = rows;
    }

    // 4) N-GRAM SEARCH
    else {
        const grams = generateNgrams(clean, 2);
        if (grams.length === 0) return [];

        const unique = [...new Set(grams)];
        const gramCount = unique.length;
        const gramPlace = unique.map(() => "?").join(",");

        // Step A: ranked candidate IDs
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
            [...unique, Math.max(1, gramCount), NGRAM_LIMIT]
        );

        if (!idRows.length) {
            // fallback to LIKE substring
            const [rows] = await conn.execute(
                `SELECT i.id, i.itemCode AS label
                FROM item_vs_pm 
                INNER JOIN items i ON i.id = item_vs_pm.item
                WHERE i.dflag = 0 AND i.itemCode LIKE ?
                GROUP BY i.id
                ORDER BY i.hasSpecial ASC, i.itemCode ASC
                LIMIT ?`,
                [`%${clean}%`, PREFIX_LIMIT]
            );
            results = rows;
        } else {
            const itemIds = idRows.map(r => r.itemId);
            const idPlace = itemIds.map(() => "?").join(",");

            // Step B: fetch items
            const [rows] = await conn.execute(
                `
                SELECT i.id, i.itemCode AS label
                FROM item_vs_pm 
                INNER JOIN items i ON i.id = item_vs_pm.item
                WHERE i.id IN (${idPlace})
                GROUP BY i.id
                ORDER BY i.hasSpecial ASC, i.itemCode ASC
                LIMIT ?
                `,
                [...itemIds, PREFIX_LIMIT]
            );

            // Step C: strict filter
            results = rows
                .filter(r => r.label?.toUpperCase().includes(clean))
                .slice(0, PREFIX_LIMIT);
        }
    }

    // 5) Cache & return
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




exports.search = async (req, res) => {
    try {
        const q = req.query.q || "";
        const data = await searchItems(q);

        return handleSuccessResponse(res, "Items", data);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


function generateNgrams(str, size = 2) {
    if (!str) return [];
    const s = String(str).trim().toUpperCase();

    const grams = [];
    for (let i = 0; i <= s.length - size; i++) {
        grams.push(s.substring(i, i + size));
    }
    return grams;
}
//get Items
exports.getItem = async (req, res) => {
    try {
        const [rows, fields] = await connection.execute(` 
            SELECT items.id, items.id, items.itemName, items.itemName as label,  items.itemCode,
                uomTab.name as uom,  uomTab.id AS uomId, loc.name AS location, loc.id AS locId
            FROM items
                INNER JOIN mst_uom as uomTab ON items.uom = uomTab.id
                INNER JOIN item_main_loc as loc ON items.mainLocation  = loc.id
            WHERE items.dflag = 0`, []);

        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
}


// Get Tools
exports.getTool = async (req, res) => {
    try {
        const { q } = req.query;

        let fetch = `SELECT id, toolNo FROM tool`;
        const values = [];

        if (q) {
            fetch += ` WHERE toolNo LIKE ?`;
            values.push(`%${q}%`);
        }

        const [rows] = await connection.execute(fetch, values);
        return res.status(200).json({ success: true, message: "Tools", data: rows });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



// GET allocated machines with process and uom (using async/await)
// exports.getPmMach = async (req, res) => {
//     const conn = await connection.getConnection();

//     try {
//         const itm = req.body.item;

//         // ================= QUERY WHEN ITEM IS NOT PROVIDED =================
//         const fetch = `
//             SELECT 
//                 machines_vs_pm_uom.id,
//                 machines_vs_pm_uom.machineCode,
//                 pm.name AS process,
//                 pm.id AS pmId,
//                 uomTab.name AS uom,
//                 uomTab.id AS uomId,
//                 mach.id AS machineId,
//                 pm.PMSLNO AS processPriority,
//                 NULL AS count,
//                 NULL AS cycleTime,
//                 0 AS vendorProcess,
//                 NULL AS toolNo,
//                 NULL AS toolId,
//                 0 AS skip
//             FROM machines_vs_pm_uom
//                 INNER JOIN mst_pm AS pm 
//                     ON machines_vs_pm_uom.machineOperator = pm.id
//                 LEFT JOIN mst_uom AS uomTab 
//                     ON machines_vs_pm_uom.utilizationUnit = uomTab.id
//                 INNER JOIN machines AS mach 
//                     ON machines_vs_pm_uom.machineCode = mach.machineCode
//             WHERE 
//                 machines_vs_pm_uom.dflag = 0 
//                 AND mach.dflag = 0
//             ORDER BY    
//                 CASE WHEN pm.PMSLNO >= 1 THEN 0 ELSE 1 END,
//                 pm.PMSLNO
//         `;

//         // ================= QUERY WHEN ITEM IS PROVIDED =================
//         const itemFetch = `
//             SELECT 
//                 machines_vs_pm_uom.id,
//                 machines_vs_pm_uom.machineCode,
//                 pm.name AS process,
//                 pm.id AS pmId,
//                 uomTab.name AS uom,
//                 uomTab.id AS uomId,
//                 mach.id AS machineId,
//                 ivp.processPriority,
//                 ivp.count,
//                 ivp.cycleTime,
//                 COALESCE(ivp.skip, 0) AS skip,
//                 COALESCE(ivp.vendorProcess, 0) AS vendorProcess,
//                 ivp.dflag,
//                 ivp.id AS itemVsPmId
//             FROM machines_vs_pm_uom
//                 INNER JOIN mst_pm AS pm 
//                     ON machines_vs_pm_uom.machineOperator = pm.id
//                 LEFT JOIN mst_uom AS uomTab 
//                     ON machines_vs_pm_uom.utilizationUnit = uomTab.id
//                 INNER JOIN machines AS mach 
//                     ON machines_vs_pm_uom.machineCode = mach.machineCode
//                 LEFT JOIN item_vs_pm AS ivp 
//                     ON ivp.process = pm.id 
//                     AND ivp.machineName = mach.id 
//                     AND ivp.item = ?
//             WHERE 
//                 machines_vs_pm_uom.dflag = 0 
//                 AND mach.dflag = 0
//             ORDER BY 
//                 CASE WHEN ivp.processPriority IS NULL THEN 1 ELSE 0 END,
//                 ivp.processPriority ASC
//         `;

//         // ================= EXECUTION =================
//         const query = itm ? itemFetch : fetch;
//         const params = itm ? [itm] : [];

//         const [results] = await conn.execute(query, params);

//         const finalResult = results.map(row => ({
//             ...row,
//             selected: !!(itm && row.dflag === 0)
//         }));

//         return handleSuccessResponse(res, 'Process Machines list', finalResult);
//     } catch (err) {
//         return handleErrorResponse(res, err)
//     } finally {
//         conn.release();
//     }
// };




// GET allocated machines with process and uom (using async/await)
exports.getPmMach = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const itm = req.body.item;

        // ================= QUERY WHEN ITEM IS NOT PROVIDED =================
        const fetch = `
            SELECT 
                machines_vs_pm_uom.id,
                machines_vs_pm_uom.machineCode,
                pm.name AS process,
                pm.id AS pmId,
                uomTab.name AS uom,
                uomTab.id AS uomId,
                mach.id AS machineId,
                pm.PMSLNO AS processPriority,
                NULL AS count,
                NULL AS cycleTime,
                0 AS vendorProcess,
                NULL AS toolNo,
                NULL AS toolId,
                0 AS skip,
                NULL AS \`range\`,
                NULL AS priceRangeId
            FROM machines_vs_pm_uom
                INNER JOIN mst_pm AS pm 
                    ON machines_vs_pm_uom.machineOperator = pm.id
                LEFT JOIN mst_uom AS uomTab 
                    ON machines_vs_pm_uom.utilizationUnit = uomTab.id
                INNER JOIN machines AS mach 
                    ON machines_vs_pm_uom.machineCode = mach.machineCode
            WHERE 
                machines_vs_pm_uom.dflag = 0 
                AND mach.dflag = 0
            ORDER BY    
                CASE WHEN pm.PMSLNO >= 1 THEN 0 ELSE 1 END,
                pm.PMSLNO
        `;

        // ================= QUERY WHEN ITEM IS PROVIDED =================
        const itemFetch = `
            SELECT 
                machines_vs_pm_uom.id,
                machines_vs_pm_uom.machineCode,
                pm.name AS process,
                pm.id AS pmId,
                uomTab.name AS uom,
                uomTab.id AS uomId,
                mach.id AS machineId,
                ivp.processPriority,
                ivp.count,
                ivp.cycleTime,
                COALESCE(ivp.skip, 0) AS skip,
                COALESCE(ivp.vendorProcess, 0) AS vendorProcess,
                ivp.dflag,
                ivp.id AS itemVsPmId,
                pmP.\`range\`,
                pmP.id AS priceRangeId
            FROM machines_vs_pm_uom
                INNER JOIN mst_pm AS pm 
                    ON machines_vs_pm_uom.machineOperator = pm.id
                LEFT JOIN mst_uom AS uomTab 
                    ON machines_vs_pm_uom.utilizationUnit = uomTab.id
                INNER JOIN machines AS mach 
                    ON machines_vs_pm_uom.machineCode = mach.machineCode
                LEFT JOIN item_vs_pm AS ivp 
                    ON ivp.process = pm.id 
                    AND ivp.machineName = mach.id 
                    AND ivp.item = ?
                LEFT JOIN pm_price_map AS pmP 
                    ON ivp.priceRange = pmP.id    
            WHERE 
                machines_vs_pm_uom.dflag = 0 
                AND mach.dflag = 0
            ORDER BY 
                CASE WHEN ivp.processPriority IS NULL THEN 1 ELSE 0 END,
                ivp.processPriority ASC
        `;

        // ================= EXECUTION =================
        const query = itm ? itemFetch : fetch;
        const params = itm ? [itm] : [];

        const [results] = await conn.execute(query, params);

        const finalResult = results.map(row => ({
            ...row,
            selected: !!(itm && row.dflag === 0)
        }));

        return handleSuccessResponse(res, 'Process Machines list', finalResult);
    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


// exports.store = async (req, res) => {
//     try {
//         const itmVsPmArray = req.body;
//         const promises = [];

//         for (const itmVsPm of itmVsPmArray) {
//             if (itmVsPm.selected == 0) {
//                 // Deselect the machine
//                 const update = `UPDATE item_vs_pm SET dflag = 1 WHERE id = ?`;
//                 promises.push(
//                     new Promise((resolve, reject) => {
//                         sql.query(update, [itmVsPm.itemVsPmId], (err, result) => {
//                             if (err) return reject(err);
//                             resolve({ success: true, message: `DeSelected Successful` });
//                         });
//                     })
//                 );

//             } else if (itmVsPm.selected == 1) {
//                 // Validate required fields
//                 if (itmVsPm.count == null || itmVsPm.cycleTime == null) {
//                     return res.status(400).json({ message: "Count And CycleTime Can't be null" });
//                 }

//                 if (itmVsPm.item == null) {
//                     return res.status(400).json({ message: "itemCode Can't be null. Please ReSelect the itemCode" });
//                 }

//                 // Check if item already exists
//                 const fetch = 'SELECT * FROM item_vs_pm WHERE item = ? AND machineName = ? AND process = ?';
//                 const checkPromise = new Promise((resolve, reject) => {
//                     sql.query(fetch, [itmVsPm.item, itmVsPm.machineId, itmVsPm.pmId], (err, results) => {
//                         if (err) return reject(err);

//                         if (results.length > 0) {
//                             // Update if exists
//                             const update = `UPDATE item_vs_pm SET count = ?, cycleTime = ?, processPriority = ?, skip = ?, dflag = ?
//                                 WHERE item = ? AND machineName = ? AND process = ?`;

//                             sql.query(update, [itmVsPm.count, itmVsPm.cycleTime, itmVsPm.processPriority, itmVsPm.skip, 0, itmVsPm.item, itmVsPm.machineId, itmVsPm.pmId], (err, result) => {
//                                 if (err) return reject(err);
//                                 resolve({ success: true, message: `Data updated successfully` });
//                             });


//                         } else {
//                             // Insert if not exists
//                             const insert = `INSERT INTO item_vs_pm (item, machineName, process, count, cycleTime, processPriority, skip)
//                                 VALUES (?, ?, ?, ?, ?, ?, ?)`;

//                             sql.query(insert, [itmVsPm.item, itmVsPm.machineId, itmVsPm.pmId, itmVsPm.count, itmVsPm.cycleTime, itmVsPm.processPriority, itmVsPm.skip], (err, result) => {
//                                 if (err) return reject(err);
//                                 resolve({ success: true, message: `Data added successfully` });
//                             });

//                         }
//                     });
//                 });

//                 promises.push(checkPromise);
//             }
//         }

//         // Wait for all queries to complete
//         const results = await Promise.all(promises);

//         return res.status(200).json({ success: true, message: "All operations completed", results });

//     } catch (err) {
//         return res.status(500).json({ success: false, message: err.message || "An error occurred" });
//     }
// };


exports.store = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const itmVsPmArray = req.body;

        if (!Array.isArray(itmVsPmArray)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payload format"
            });
        }

        await conn.beginTransaction();

        for (const itmVsPm of itmVsPmArray) {

            // ====================== DE-SELECT ======================
            if (itmVsPm.selected == 0 && itmVsPm.itemVsPmId) {
                const update = `
                    UPDATE item_vs_pm SET dflag = 1 WHERE id = ?
                `;
                await conn.execute(update, [itmVsPm.itemVsPmId]);
                continue;
            }

            // ====================== VALIDATION ======================
            if (itmVsPm.selected == 1) {
                if (itmVsPm.count == null || itmVsPm.cycleTime == null) {
                    throw new CustomError("Count And CycleTime Can't be null");
                }

                if (!itmVsPm.item) {
                    throw new CustomError("itemCode Can't be null. Please ReSelect the itemCode");
                }

                // ====================== CHECK EXISTING ======================
                const fetch = `
                    SELECT id 
                    FROM item_vs_pm 
                    WHERE item = ? AND machineName = ? AND process = ?
                `;

                const [rows] = await conn.execute(fetch, [
                    itmVsPm.item, itmVsPm.machineId, itmVsPm.pmId
                ]);

                // ====================== UPDATE ======================
                if (rows.length > 0) {
                    const update = `
                        UPDATE item_vs_pm 
                        SET 
                            count = ?,  cycleTime = ?,  processPriority = ?,  skip = ?,  dflag = 0
                        WHERE item = ? AND machineName = ? AND process = ?
                    `;

                    await conn.execute(update, [
                        itmVsPm.count, itmVsPm.cycleTime, itmVsPm.processPriority, itmVsPm.skip || 0, itmVsPm.item, itmVsPm.machineId, itmVsPm.pmId
                    ]);

                // ====================== INSERT ======================
                } else {
                    const insert = `
                        INSERT INTO item_vs_pm
                        (item, machineName, process, count, cycleTime, processPriority, skip)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `;

                    await conn.execute(insert, [
                        itmVsPm.item, itmVsPm.machineId, itmVsPm.pmId, itmVsPm.count, itmVsPm.cycleTime, itmVsPm.processPriority, itmVsPm.skip || 0
                    ]);
                }
            }
        }

        await conn.commit();

        return handleSuccessResponse(res, 'Data Updated');

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);

    } finally {
        conn.release();
    }
};


// //Items vs pm Allocation
// exports.deSelect = (req, res) => {
//     try {
//         const itmVsPmArray = req.body;
//         itmVsPmArray.forEach((itmVsPm) => {

//             // Check if itemVsPmId is not null
//             // if (itmVsPm.itemVsPmId !== null) {
//             if (itmVsPm.selected == 0) {


//                 // Determine the value of dflag based on itmVsPm.selected
//                 // const dflagValue = itmVsPm.selected ? 0 : 1;

//                 const update = `UPDATE item_vs_pm SET dflag = 1 WHERE id = ?`;

//                 sql.query(update, [itmVsPm.itemVsPmId], (err, result) => {
//                     if (err) {
//                         return res.status(400).json({ success: false, message: err.message });
//                     }
//                 });
//             }
//         });

//         // If the loop completes without errors, send a success response
//         res.status(200).json({ success: true, message: 'DeSelected successful' });

//     } catch (err) {
//         return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
//     }
// };


// Items vs PM De-Allocation (using async/await)
exports.deSelect = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const itmVsPmArray = req.body;

        if (!Array.isArray(itmVsPmArray)) {
            // return res.status(400).json({
            //     success: false,
            //     message: "Invalid payload format"
            // });
            throw new CustomError("Invalid payload format");

        }

        await conn.beginTransaction();

        for (const itmVsPm of itmVsPmArray) {
            if (itmVsPm.selected == 0 && itmVsPm.itemVsPmId) {
                const update = `
                    UPDATE item_vs_pm 
                    SET dflag = 1 
                    WHERE id = ?
                `;
                await conn.execute(update, [itmVsPm.itemVsPmId]);
            }
        }
  
        await conn.commit();

        return handleSuccessResponse(res, 'DeSelected successful');

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);

    } finally {
        conn.release();
    }
};




// exports.showByItm = async (req, res) => {
//     try {

//         const id = req.params.id;

//         const [rows, fields] = await connection.execute(` 

//         SELECT item_vs_pm.id, pm.name AS process, pm.vendorProcess, uomTab.name as uom, 
//             mach.machineName AS machineName, mach.machineCode,
//             item_vs_pm.processPriority, item_vs_pm.skip,
//             itm.itemName AS item
//         FROM item_vs_pm
//             INNER JOIN items as itm ON item_vs_pm.item = itm.id
//             INNER JOIN machines as mach ON item_vs_pm.machineName = mach.id
//             INNER JOIN mst_pm as pm ON item_vs_pm.process = pm.id
//             INNER JOIN mst_uom as uomTab ON mach.utilizationUnit = uomTab.id
//         WHERE item_vs_pm.dflag = 0`, [id]);

//         return res.status(200).json({ success: true, data: rows });
//     } catch (err) {
//         return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
//     }
// }





// exports.show = async (req, res) => {
//     try {

//         const id = req.params.id;

//         const query = `
//             SELECT item_vs_pm.id, pm.name AS process,  uomTab.name as uom, 
//                 mach.machineName AS machineName, mach.machineCode, mach.id as machineId,
//                 item_vs_pm.skip,  item_vs_pm.count, item_vs_pm.cycleTime, itm.itemName AS item, 
//                 item_vs_pm.processPriority

//             FROM item_vs_pm
//                 INNER JOIN items as itm ON item_vs_pm.item = itm.id
//                 INNER JOIN machines as mach ON item_vs_pm.machineName = mach.id
//                 INNER JOIN mst_pm as pm ON item_vs_pm.process = pm.id
//                 INNER JOIN mst_uom as uomTab ON mach.utilizationUnit = uomTab.id
//             WHERE item_vs_pm.dflag = 0 AND item_vs_pm.item = ?
//             ORDER BY 
//               CASE WHEN item_vs_pm.processPriority >= 1 THEN 0 ELSE 1 END, item_vs_pm.processPriority
//             `



//         const [rows] = await connection.execute(query, [id]);

//         if (rows.length >= 0) {


//             return res.status(200).json({
//                 success: true,
//                 message: "item_vs_pm Msterlist",
//                 data: rows
//             });
//         }
//     } catch (err) {
//         return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
//     }
// }




exports.show = async (req, res) => {
    try {

        const id = req.params.id;

        const query = `
            SELECT item_vs_pm.id, pm.name AS process, pm.id AS processId, uomTab.name as uom, 
                mach.machineName AS machineName, mach.machineCode, mach.id as machineId,
                item_vs_pm.skip,  item_vs_pm.count, item_vs_pm.cycleTime, itm.itemName AS item, 
                item_vs_pm.processPriority, pmP.\`range\`, pmP.id AS priceRangeId, pmP.rate,
                pmP.rate * item_vs_pm.count As cost

            FROM item_vs_pm
                INNER JOIN items as itm ON item_vs_pm.item = itm.id
                INNER JOIN machines as mach ON item_vs_pm.machineName = mach.id
                INNER JOIN mst_pm as pm ON item_vs_pm.process = pm.id
                INNER JOIN mst_uom as uomTab ON mach.utilizationUnit = uomTab.id
                LEFT JOIN pm_price_map as pmP ON item_vs_pm.priceRange = pmP.id

            WHERE item_vs_pm.dflag = 0 AND item_vs_pm.item = ?
            ORDER BY 
              CASE WHEN item_vs_pm.processPriority >= 1 THEN 0 ELSE 1 END, item_vs_pm.processPriority
            `

        const [rows] = await connection.execute(query, [id]);

        if (rows.length >= 0) {


            return res.status(200).json({
                success: true,
                message: "item_vs_pm Msterlist",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}


exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const itmVsPm = req.body;
        const priceRangeId =
        itmVsPm.priceRangeId === "" || itmVsPm.priceRangeId === null || itmVsPm.priceRangeId === undefined ? null : itmVsPm.priceRangeId;


        const updateQuery = `UPDATE item_vs_pm SET count = ?, cycleTime = ?, processPriority = ?, priceRange = ? WHERE id = ?`;

       
        const values = [itmVsPm.count, itmVsPm.cycleTime, itmVsPm.processPriority, priceRangeId, id];

        
        const [uRows] = await connection.execute(updateQuery, values);

        if (uRows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully updated" });
        } else {
            throw new CustomError("Something went wrong!");
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};






//Show Items Based on Machines
exports.showItems = async (req, res) => {
    try {

        const id = req.params.id;

        const query = `
            SELECT item_vs_pm.id, mach.machineName AS machineName, mach.machineCode, 
                pm.name AS process, pm.vendorProcess, itm.itemCode, itm.itemName, 
                item_vs_pm.count, item_vs_pm.cycleTime, 
                item_vs_pm.skip, item_vs_pm.processPriority  
            FROM item_vs_pm
                INNER JOIN items as itm ON item_vs_pm.item = itm.id
                INNER JOIN machines as mach ON item_vs_pm.machineName = mach.id
                INNER JOIN mst_pm as pm ON item_vs_pm.process = pm.id

            WHERE item_vs_pm.dflag = 0 AND item_vs_pm.machineName = ?`;

        const [rows] = await connection.execute(query, [id]);

        if (rows.length >= 0) {

            return res.status(200).json({
                success: true,
                message: "item_vs_pm Part list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}


//Get Itesm based on  respective Machine 
exports.searchItm = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;
        const id = req.params.id;

        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT DISTINCT items.id, items.itemCode as label FROM items 
            INNER JOIN item_vs_pm as itmPm ON itmPm.item = items.id
            WHERE items.dflag = 0 AND itmPm.machineName = ?
        `;

        const values = [id]; // Pass the machineId as a value

        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` AND (items.itemCode LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
        }


        // Add ORDER BY clause to sort the results with item codes containing special characters last
        fetch += ` ORDER BY CASE WHEN items.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, items.itemCode LIMIT 100`;

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "Items", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}





exports.showPrMap = async (req, res) => {
  try {

    const id = req.params.id;
    const [rows] = await connection.execute(`
      SELECT 
        copq.id,  copq.processId, copq.priceFrom, copq.priceTo, copq.range, copq.rate
      FROM  
        pm_price_map copq
      WHERE copq.processId = ?`, [id]
    );

    return handleSuccessResponse(res, 'Price Grouping lists', rows);
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}                       

const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const redis = require("../config/redisCleinet");

exports.getSupp = async (req, res) => {
    let conn;
    try {
        conn = await connection.getConnection();

        const fetchQuery = `
      SELECT  
        supplier.id,  supplier.spCode,  supplier.spName,  supplier.sId,
        CONCAT(
          COALESCE(supplier.spAdd1, ''), ' ', 
          COALESCE(supplier.spAdd2, ''), ' ', 
          COALESCE(supplier.spAdd3, ''), ' ', 
          COALESCE(supplier.spAdd4, '')
        ) AS spAddress,
        cur.name AS currency,  cur.id AS currencyId,  cur.code,  supCon.department,  supplier.panNo,  supplier.gstNo,  supplier.paymentTerms
      FROM supplier
      LEFT JOIN sup_con_person AS supCon 
        ON supplier.sId = supCon.sId
      LEFT JOIN mst_currency AS cur 
        ON supplier.currency = cur.id
      WHERE supplier.dflag = 0
    `;

        const [results] = await conn.query(fetchQuery);


        return handleSuccessResponse(res, 'Supplier list', results);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.search = async (req, res) => {
    try {
        // const { q } = req.query;
        // const cacheKey = `supplier_search:${q || "all"}`;

        const { q, inactiveStatus } = req.query;
        const cacheKey = `supplier_search:${q || "all"}:${inactiveStatus ?? "all"}`;

        // 1️⃣ Check Redis Cache for supplier list
        if (redis) {
            const cachedResult = await redis.get(cacheKey);
            if (cachedResult) {
                return res.status(200).json({
                    success: true,
                    message: "Supplier (from cache)",
                    data: JSON.parse(cachedResult)
                });
            }
        }

        // 2️⃣ Fetch company name + address (CACHE THIS ALSO)
        let shipAddress = "";

        if (redis) {
            const cachedCompany = await redis.get("company_address");
            if (cachedCompany) {
                shipAddress = cachedCompany;
            } else {
                const companyQuery = `
                    SELECT CONCAT(cd.companyName, '\n', cd.address) AS companyAdd
                    FROM company_details cd
                    LIMIT 1
                `;
                const [companyRows] = await connection.execute(companyQuery);
                shipAddress = companyRows.length > 0 ? companyRows[0].companyAdd : "";

                // Store for 1 hour
                await redis.set("company_address", shipAddress, { EX: 60 });
            }
        }

        // 3️⃣ Build SQL Query
        let query = `
            SELECT  
                supplier.id, supplier.spCode, supplier.spName, supplier.sId, supplier.spCode AS label,
                CONCAT(
                    COALESCE(supplier.spAdd1, ''), ' ', 
                    COALESCE(supplier.spAdd2, ''), ' ', 
                    COALESCE(supplier.spAdd3, ''), ' ', 
                    COALESCE(supplier.spAdd4, '')
                ) AS spAddress,               
                cur.name AS currency, cur.id AS currencyId, cur.code, 
                supCon.department, supplier.panNo, supplier.gstNo, supplier.paymentTerms, 
                ? AS shipAddress
            FROM supplier
                LEFT JOIN sup_con_person AS supCon ON supplier.sId = supCon.sId
                LEFT JOIN mst_currency AS cur ON supplier.currency = cur.id
            WHERE supplier.dflag = 0
        `;

        const values = [shipAddress];

        if (req.query.inactiveStatus != null) {
            query += ` AND supplier.inactiveStatus = 0`;
            // values.push(Number(req.query.inactiveStatus));
        }

        if (q) {
            query += ` AND supplier.spCode LIKE ?`;
            values.push(`%${q}%`);
        }

        query += ` GROUP BY supplier.spCode LIMIT 20`;

        // 4️⃣ Execute SQL
        const [rows] = await connection.execute(query, values);

        // 5️⃣ Save result in Redis
        if (redis) {
            await redis.set(cacheKey, JSON.stringify(rows), { EX: 60 }); // cache 2 mins
        }

        return res.status(200).json({
            success: true,
            message: "Supplier (from DB)",
            data: rows
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: err.message
        });
    }
};


// Get Items which have combination with Supplier from table supp_vs_item
exports.getSupItm = async (req, res) => {
    let conn;
    try {
        const id = req.params.id;
        const supCode = req.body.supCode;

        if (!id && !supCode) {
            return res.status(400).json({
                success: false,
                message: "Either 'id' or 'supCode' must be provided."
            });
        }

        // Pagination
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 100;
        const offset = (page - 1) * limit;

        conn = await connection.getConnection();

        /* ---------------- MAIN DATA QUERY ---------------- */
        let dataQuery = `
        SELECT
            supp_vs_item.*, sup.spCode, sup.spName AS suppName, sup.id AS supId, cur.name AS currency, cur.id AS currencyId, 
            itm.itemName, itm.id AS itemId, itm.grossWeight, itm.netWeight, itm.scrapWeight, itm.itemCode, uomTab.name AS uom, uomTab.id AS uomId, 
            prdFam.name AS productFamily, prdFam.id AS productFamilyId, prdFin.name AS productFinish, prdFin.id AS productFinishId, itm.isPoRate
        FROM supplier sup
        LEFT JOIN supp_vs_item ON supp_vs_item.spName = sup.id
        LEFT JOIN mst_currency cur ON sup.currency = cur.id
        LEFT JOIN items itm ON supp_vs_item.itemName = itm.id
        LEFT JOIN mst_uom uomTab ON itm.uom = uomTab.id
        LEFT JOIN item_product_family prdFam ON itm.productFamily = prdFam.id
        LEFT JOIN item_product_finish prdFin ON itm.productFinish = prdFin.id
        `;

        const params = [];

        if (id) {
            dataQuery += ` WHERE sup.id = ?`;
            params.push(id);
        } else {
            dataQuery += ` WHERE sup.spCode = ?`;
            params.push(supCode);
        }

        dataQuery += `
      ORDER BY
        CASE
          WHEN itm.itemCode REGEXP '^[0-9]' THEN 0
          ELSE 1
        END,
        itm.itemCode ASC
      LIMIT ? OFFSET ?
    `;

        params.push(limit, offset);

        const [rows] = await conn.query(dataQuery, params);

        /* ---------------- ADD SERIAL NUMBER ---------------- */
        const data = rows.map((row, index) => ({
            sNo: offset + index + 1,
            ...row
        }));

        /* ---------------- COUNT QUERY ---------------- */
        let countQuery = `
      SELECT COUNT(*) AS total
      FROM supplier sup
      LEFT JOIN supp_vs_item ON supp_vs_item.spName = sup.id
      LEFT JOIN items itm ON supp_vs_item.itemName = itm.id
    `;

        const countParams = [];

        if (id) {
            countQuery += ` WHERE sup.id = ?`;
            countParams.push(id);
        } else {
            countQuery += ` WHERE sup.spCode = ?`;
            countParams.push(supCode);
        }

        const [[{ total }]] = await conn.query(countQuery, countParams);
        const totalPages = Math.ceil(total / limit);

        return res.status(200).json({
            success: true,
            message: "Supplier Items list",
            currentPage: page,
            totalPages,
            totalRecords: total,
            data
        });

    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    } finally {
        if (conn) conn.release();
    }
};




exports.searchItm = async (req, res) => {
    let conn;
    try {
        const { supCode } = req.body;
        const { q } = req.query;

        if (!supCode) {
            return res.status(400).json({
                success: false,
                message: "supCode must be provided."
            });
        }

        conn = await connection.getConnection();

        let fetchQuery = `
        SELECT
            supp_vs_item.*, sup.spCode, sup.spName AS suppName, sup.id AS supId, cur.name AS currency, cur.id AS currencyId,
            itm.itemName, itm.id AS itemId, itm.grossWeight, itm.netWeight, itm.scrapWeight, itm.itemCode, uomTab.name AS uom, uomTab.id AS uomId,
            prdFam.name AS productFamily, prdFam.id AS productFamilyId, prdFin.name AS productFinish, prdFin.id AS productFinishId
        FROM supplier sup
        LEFT JOIN supp_vs_item ON supp_vs_item.spName = sup.id
        LEFT JOIN mst_currency cur ON sup.currency = cur.id
        LEFT JOIN items itm ON supp_vs_item.itemName = itm.id
        LEFT JOIN mst_uom uomTab ON itm.uom = uomTab.id
        LEFT JOIN item_product_family prdFam ON itm.productFamily = prdFam.id
        LEFT JOIN item_product_finish prdFin ON itm.productFinish = prdFin.id
        WHERE sup.spCode = ?
        `;

        const params = [supCode];

        if (q) {
            fetchQuery += ` AND itm.itemCode LIKE ?`;
            params.push(`%${q}%`);
        }

        fetchQuery += ` ORDER BY itm.itemCode ASC LIMIT 100`;

        const [results] = await conn.query(fetchQuery, params);

        return handleSuccessResponse(res, "Supplier Items list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};



exports.store = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { items: detailyArray, spCode } = req.body;
        await conn.beginTransaction();

        if (!Array.isArray(detailyArray)) {
            return res.status(400).json({
                success: false,
                message: "Invalid request format. Expected an array for data."
            });
        }

        // Fetch supplier ID
        const [rows] = await conn.execute(
            'SELECT id FROM supplier WHERE spCode = ?',
            [spCode]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Invalid Supplier Code"
            });
        }

        const supId = rows[0].id;
        const changedBy = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        const updateQuery = `
            UPDATE supp_vs_item
            SET rate = ?, sob = ?, suppDesc = ?, jwdcRate = ?, leadTime = ?, remarks = ?, IsFcItem = ?
            WHERE spName = ? AND itemName = ?
        `;

        const insertQuery = `
            INSERT INTO supp_vs_item
            (spName, itemName, rate, sob, suppDesc, jwdcRate, leadTime, remarks, IsFcItem)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const item of detailyArray) {

            const [existingRow] = await conn.query(
                `SELECT * FROM supp_vs_item WHERE spName = ? AND itemName = ?`,
                [supId, item.itemId]
            );

            /* =====================================================
               CASE 1: ITEM ALREADY EXISTS → RATE CHANGE (↑ or ↓)
            ===================================================== */
            if (existingRow.length > 0) {

                const existingData = existingRow[0];
                const preRate = Number(existingData.rate);
                const newRate = Number(item.rate);
                const supItmId = existingData.id;
                const rmk = item.remarks || existingData.remarks;

                // If rate changed (increase OR decrease)
                if (newRate !== preRate) {

                    // Remove old approved logs
                    await conn.query(
                        `DELETE FROM price_revision_log 
                         WHERE supItmId = ? AND isApprove = 1`,
                        [supItmId]
                    );

                    const category = newRate > preRate ? 'Rate Increased' : 'Rate Decreased';

                    // Insert approval entry (PENDING)
                    await conn.query(
                        `INSERT INTO price_revision_log
                         (spName, itemName, preRate, newRate, remarks, changedBy, isApprove, supItmId, category)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            supId,
                            item.itemId,
                            preRate,
                            newRate,
                            rmk,
                            changedBy,
                            1, // pending approval
                            supItmId,
                            category
                        ]
                    );

                    // // Mark item as rate-under-approval
                    // await conn.query(
                    //     `UPDATE items SET isPoRate = 1 WHERE id = ?`,
                    //     [item.itemId]
                    // );

                    // Mark item as rate-under-approval
                    await conn.query(
                        `UPDATE supp_vs_item SET isRate = 1 WHERE spName  = ? AND  itemName = ?`,
                        [supId, item.itemId]
                    );
                }

                // Update supplier-item master
                await conn.query(updateQuery, [
                    item.rate,
                    item.sob,
                    item.suppDesc,
                    item.jwdcRate,
                    item.leadTime,
                    item.remarks,
                    item.IsFcItem,
                    supId,
                    item.itemId
                ]);

            }
            /* =====================================================
               CASE 2: NEW ITEM → DIRECTLY GO FOR APPROVAL
            ===================================================== */
            else {

                const [result] = await conn.query(insertQuery, [
                    supId,
                    item.itemId,
                    item.rate,
                    item.sob,
                    item.suppDesc || null,
                    item.jwdcRate,
                    item.leadTime,
                    item.remarks,
                    item.IsFcItem
                ]);

                const supItmId = result.insertId;

                // Insert approval log for NEW item
                await conn.query(
                    `INSERT INTO price_revision_log
                     (spName, itemName, preRate, newRate, remarks, changedBy, isApprove, supItmId, category)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        supId,
                        item.itemId,
                        null,              // no previous rate
                        item.rate || null,
                        item.remarks || null,
                        changedBy,
                        1,                 // pending approval
                        supItmId,
                        'New Item'
                    ]
                );

                // // Mark item as rate-under-approval
                // await conn.query(
                //     `UPDATE items SET isPoRate = 1 WHERE id = ?`,
                //     [item.itemId]
                // );

                // Mark item as rate-under-approval
                await conn.query(
                    `UPDATE supp_vs_item SET notAllow = ? WHERE id = ?`,
                    [1, supItmId]
                );

            
            }
        }

        await conn.commit();
        return handleSuccessResponse(res, 'Data Saved Successfully');

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


// exports.delete = async (req, res) => {
//     try {
//         const id = req.params.id;

//         const fetch = 'SELECT * FROM supp_vs_item WHERE id = ?';
//         const [results] = await connection.execute(fetch, [id]);

//         if (results.length === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Data not found'
//             });
//         }

//         const del = 'DELETE FROM supp_vs_item WHERE id = ?';
//         await connection.execute(del, [id]);

//         return res.status(200).json({
//             success: true,
//             message: 'Successfully deleted'
//         });

//     } catch (err) {
//         return res.status(400).json({
//             success: false,
//             message: err.message || 'An error occurred'
//         });
//     }
// };

exports.delete = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const id = req.params.id;


        await conn.beginTransaction();

        /* 1. Fetch row to be deleted */
        const [rows] = await conn.execute(
            'SELECT * FROM supp_vs_item WHERE id = ?',
            [id]
        );

        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                success: false,
                message: 'Data not found'
            });
        }


        /* 2. Insert into log table */
        await conn.execute(
            `
            INSERT INTO supp_vs_item_delete_log
            (
                id, spName, itemName, rate, sob,
                suppDesc, jwdcRate, leadTime, remarks,
                IsFcItem, dflag, oldRate, isRate, notAllow,
                created_at, deleted_at, deleted_by
            )
            SELECT
                id, spName, itemName, rate, sob,
                suppDesc, jwdcRate, leadTime, remarks,
                IsFcItem, dflag, oldRate, isRate, notAllow,
                created_at, NOW(), ?
            FROM supp_vs_item
            WHERE id = ?
            `,
            [req.headers.username ?? null, id]
        );


        /* 3. Delete from main table */
        await conn.execute(
            'DELETE FROM supp_vs_item WHERE id = ?',
            [id]
        );

        await conn.commit();

        return res.status(200).json({
            success: true,
            message: 'Successfully deleted'
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};



// Delete multiple rows where spName = supplier id
// exports.deleteAll = async (req, res) => {
//     let conn;
//     try {
//         const supId = req.params.id;

//         if (!supId) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Supplier id is required"
//             });
//         }

//         conn = await connection.getConnection();

//         const deleteQuery = `
//       DELETE FROM supp_vs_item
//       WHERE spName = ?
//     `;

//         const [result] = await conn.query(deleteQuery, [supId]);

//         if (result.affectedRows === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: "No data found to delete"
//             });
//         }

//         return handleSuccessResponse(res, 'Successfully deleted');

//     } catch (err) {
//         return handleErrorResponse(res, err);
//     } finally {
//         if (conn) conn.release();
//     }
// };


// Delete multiple rows where spName = supplier id (WITH LOG)
exports.deleteAll = async (req, res) => {
    let conn;

    try {
        const supId = req.params.id;
        const user = req.headers.username ?? null;

        if (!supId) {
            return res.status(400).json({
                success: false,
                message: "Supplier id is required"
            });
        }

        conn = await connection.getConnection();
        await conn.beginTransaction();

        /* 1. Log rows BEFORE delete */
        const [logResult] = await conn.execute(
            `
            INSERT INTO supp_vs_item_delete_log
            (
                id, spName, itemName, rate, sob, suppDesc, jwdcRate, leadTime, remarks, IsFcItem, dflag, oldRate, isRate, notAllow,
                created_at, deleted_at, deleted_by
            )
            SELECT
                id, spName, itemName, rate, sob, suppDesc, jwdcRate, leadTime, remarks, IsFcItem, dflag, oldRate, isRate, notAllow,
                created_at, NOW(), ?
            FROM supp_vs_item
            WHERE spName = ?
            `,
            [user, supId]
        );

        if (logResult.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({
                success: false,
                message: "No data found to delete"
            });
        }

        /* 2. Delete rows */
        await conn.execute(
            ` DELETE FROM supp_vs_item WHERE spName = ? `,
            [supId]
        );

        await conn.commit();

        return handleSuccessResponse(
            res,
            `Successfully deleted`
        );

    } catch (err) {
        if (conn) await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


exports.copy = async (req, res) => {
    let conn;
    try {
        const { copyFrom, copyTo } = req.body;

        if (!copyTo || !copyFrom) {
            return res.status(400).json({
                success: false,
                message: 'copyFrom and copyTo supplier codes are required'
            });
        }

        conn = await connection.getConnection();
        await conn.beginTransaction();

        const changedBy = new Date().toISOString().slice(0, 10);

        /* ---------- FETCH SOURCE SUPPLIER ITEMS ---------- */
        const [rows] = await conn.query(`
            SELECT
                itemName, rate, sob, suppDesc, jwdcRate, leadTime, remarks, IsFcItem
            FROM supp_vs_item
            WHERE spName = ?
        `, [copyFrom]);

        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                success: false,
                message: 'No data found to copy'
            });
        }

        /* ---------- PROCESS EACH ITEM ---------- */
        for (const row of rows) {

            // Check if item already exists for copyTo supplier
            const [existingRows] = await conn.query(`
                SELECT * FROM supp_vs_item
                WHERE spName = ? AND itemName = ?
            `, [copyTo, row.itemName]);

            /* =====================================================
               CASE 1: ITEM EXISTS → RATE CHANGE (↑ or ↓)
            ===================================================== */
            if (existingRows.length > 0) {

                const existing = existingRows[0];
                const preRate = Number(existing.rate || 0);
                const newRate = Number(row.rate);
                const supItmId = existing.id;
                const remarks = row.remarks || existing.remarks;

                if (newRate !== preRate) {

                    // Remove old approved logs
                    await conn.query(`
                        DELETE FROM price_revision_log
                        WHERE supItmId = ? AND isApprove = 1
                    `, [supItmId]);

                    const category = newRate > preRate ? 'Rate Increased' : 'Rate Decreased';

                    // Insert pending approval log
                    await conn.query(`
                        INSERT INTO price_revision_log
                        (spName, itemName, preRate, newRate, remarks, changedBy, isApprove, supItmId, category)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        copyTo,
                        row.itemName,
                        preRate,
                        newRate,
                        remarks,
                        changedBy,
                        1,
                        supItmId,
                        category
                    ]);

                    // // Mark item under approval
                    // await conn.query(
                    //     `UPDATE items SET isPoRate = 1 WHERE id = ?`,
                    //     [row.itemName]
                    // );

                     // Mark item as rate-under-approval
                    await conn.query(
                        `UPDATE supp_vs_item SET isRate = 1 WHERE id  = ?`,
                        [supItmId]
                    );
                }

                // Update supplier-item row
                await conn.query(`
                    UPDATE supp_vs_item
                    SET rate = ?, sob = ?, suppDesc = ?, jwdcRate = ?, leadTime = ?, remarks = ?, IsFcItem = ?
                    WHERE id = ?
                `, [
                    row.rate,
                    row.sob,
                    row.suppDesc,
                    row.jwdcRate,
                    row.leadTime,
                    row.remarks,
                    row.IsFcItem,
                    supItmId
                ]);
            }

            /* =====================================================
               CASE 2: NEW ITEM → DIRECT APPROVAL
            ===================================================== */
            else {

                const [result] = await conn.query(`
                    INSERT INTO supp_vs_item
                    (spName, itemName, rate, sob, suppDesc, jwdcRate, leadTime, remarks, IsFcItem)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    copyTo,
                    row.itemName,
                    row.rate,
                    row.sob,
                    row.suppDesc,
                    row.jwdcRate,
                    row.leadTime,
                    row.remarks,
                    row.IsFcItem
                ]);

                const supItmId = result.insertId;

                // Insert approval log (pending)
                await conn.query(`
                    INSERT INTO price_revision_log
                    (spName, itemName, preRate, newRate, remarks, changedBy, isApprove, supItmId, category)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    copyTo,
                    row.itemName,
                    row.rate,
                    row.rate,
                    row.remarks || null,
                    changedBy,
                    1,
                    supItmId,
                    'New Item'
                ]);

                // // Mark item under approval
                // await conn.query(
                //     `UPDATE items SET isPoRate = 1 WHERE id = ?`,
                //     [row.itemName]
                // );

                // Block until approval
                await conn.query(
                    `UPDATE supp_vs_item SET notAllow = 1 WHERE id = ?`,
                    [supItmId]
                );
            }
        }

        await conn.commit();
        return handleSuccessResponse(res, 'Supplier items copied/updated and sent for approval');

    } catch (err) {
        if (conn) await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};



// Get Price Revision History
// exports.getPriceRevision = async (req, res) => {
//     let conn;
//     try {
//         const { spName, itemName, fromDate, toDate } = req.body;

//         // Validate date range
//         if ((fromDate && !toDate) || (!fromDate && toDate)) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Please select Date Range."
//             });
//         }

//         conn = await connection.getConnection();

//         let fetchQuery = `
//         SELECT
//             price_revision_log.*, sup.spCode, sup.spName AS suppName, sup.id AS supId, itm.itemName, itm.id AS itemId, itm.itemCode
//         FROM price_revision_log
//         INNER JOIN supplier AS sup
//             ON price_revision_log.spName = sup.id
//         INNER JOIN items AS itm
//             ON price_revision_log.itemName = itm.id
//         WHERE 1 = 1
 
//         `;

//         const params = [];

//         if (spName) {
//             fetchQuery += ` AND price_revision_log.spName = ?`;
//             params.push(spName);
//         }

//         if (itemName) {
//             fetchQuery += ` AND price_revision_log.itemName = ?`;
//             params.push(itemName);
//         }

//         if (fromDate && toDate) {
//             fetchQuery += ` AND DATE(price_revision_log.changedBy) BETWEEN ? AND ?`;
//             params.push(fromDate, toDate);
//         }

//         const [results] = await conn.query(fetchQuery, params);

//         const formattedResults = results.map(row => ({
//             ...row,
//             changedBy: row.changedBy ? new Date(row.changedBy).toLocaleDateString('en-GB') : null
//         }));


//         return handleSuccessResponse(res, "Price Revision History", formattedResults);

//     } catch (err) {
//         return handleErrorResponse(res, err);
//     } finally {
//         if (conn) conn.release();
//     }
// };

// Get Price Revision History
exports.getPriceRevision = async (req, res) => {
    let conn;

    try {
        const { spName = [], itemName, fromDate, toDate } = req.body;

        // Validate date range
        if ((fromDate && !toDate) || (!fromDate && toDate)) {
            return res.status(400).json({
                success: false,
                message: "Please select Date Range."
            });
        }

        conn = await connection.getConnection();

        let fetchQuery = `
            SELECT
                prl.*,
                sup.spCode,
                sup.spName AS suppName,
                sup.id AS supId,
                itm.itemName,
                itm.id AS itemId,
                itm.itemCode
            FROM price_revision_log AS prl
            INNER JOIN supplier AS sup
                ON prl.spName = sup.id
            INNER JOIN items AS itm
                ON prl.itemName = itm.id
            WHERE 1 = 1
        `;

        const params = [];

        // Supplier filter (single or multiple)
        if (Array.isArray(spName) && spName.length > 0) {
            fetchQuery += ` 
                AND prl.spName IN (${spName.map(() => '?').join(',')})
            `;
            params.push(...spName);
        }

        // Item filter
        if (itemName) {
            fetchQuery += ` AND prl.itemName = ? `;
            params.push(itemName);
        }

        // Date filter
        if (fromDate && toDate) {
            fetchQuery += `
                AND DATE(prl.changedBy) BETWEEN ? AND ?
            `;
            params.push(fromDate, toDate);
        }

        // Order by latest
        fetchQuery += ` ORDER BY prl.id DESC`;

        const [results] = await conn.query(fetchQuery, params);

        const formattedResults = results.map(row => ({
            ...row,
            changedBy: row.changedBy
                ? new Date(row.changedBy).toLocaleDateString('en-GB')
                : null
        }));

        return handleSuccessResponse(
            res,
            "Price Revision History",
            formattedResults
        );

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};

exports.suppReport = async (req, res) => {
    try {
        const { customerIds } = req.body;

        let query = `
            SELECT 
                svi.*, 
                s.spCode, 
                s.gstNo, 
                s.spName AS supplierName, 
                sg.code AS supplierGroupCode,
                c.code AS currencyCode,
                i.itemCode, 
                i.itemName, 
                i.grossWeight, 
                i.netWeight, 
                i.scrapWeight, 
                u.name AS uomName,
                i.minStockLvl, 
                i.minLvl, 
                i.category,
                i.maxLvl,
                iml.name AS mainLocationName,
                ig.code AS itemGroupCode,
                pf.name AS productFinishName,         
                fam.name AS productFamilyName 
            FROM 
                supp_vs_item svi
                LEFT JOIN supplier s ON svi.spName = s.id
                LEFT JOIN items i ON svi.itemName = i.id
                LEFT JOIN mst_uom u ON i.uom = u.id
                LEFT JOIN mst_sup_group sg ON s.spGroup = sg.id  
                LEFT JOIN mst_item_group ig ON i.itemGroup = ig.id
                LEFT JOIN mst_currency c ON s.currency = c.id 
                LEFT JOIN item_product_finish pf ON i.productFinish = pf.id
                LEFT JOIN item_product_family fam ON i.productFamily = fam.id
                LEFT JOIN item_main_loc iml ON i.mainLocation = iml.id`;

        let params = [];

        if (Array.isArray(customerIds) && customerIds.length > 0) {
            const placeholders = customerIds.map(() => '?').join(',');
            query += ` WHERE svi.spName IN (${placeholders})`;
            params = [...customerIds];
        }

        const [rows] = await connection.query(query, params);

        const dataWithSerialNo = rows.map((row, index) => ({
            sNo: index + 1,
            ...row
        }));

        res.status(200).json({ data: dataWithSerialNo });

    } catch (error) {
        console.error('Error fetching report:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};


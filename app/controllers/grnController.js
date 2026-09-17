const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require("../config/dbSql");
const { updateDocCounter } = require("../utility/docNo");
const { getUser, fetchOpQty } = require("../utility/utilityFunction");

exports.fetchGrn = async (req, res) => {
    try {
        const { itemCode } = req.query;
        if (!itemCode) {
            throw new CustomError('itemCode is required', 400);
        }

        const [items] = await connection.execute(
            `SELECT id, category, shelfLifeItem
             FROM items
             WHERE itemCode = ?`,
            [itemCode]
        );

        if (!items.length) {
            throw new CustomError('Item not found!', 404);
        }

        const { id, shelfLifeItem } = items[0];

        /* ===================== ALL SOURCES (run concurrently) ===================== */
        const [
            [openingBalance],
            [grnRows],
            [fgRows],
            [poRows],
            [mrnRows],
            [poBillWithOutPo]
        ] = await Promise.all([
            // OPENING BALANCE
            connection.execute(`
                SELECT
                    op.id,
                    op.itemCode,
                    op.grn AS grnRefNO,
                    op.created_at AS grnDate,
                    op.issueQoh AS poQty,
                    'op' AS type
                FROM op_balance op
                WHERE op.itemId = ?
                  AND op.issueStatus = 0
            `, [id]),

            // PO LOT
            connection.execute(`
                SELECT
                    pbl.id,
                    pbd.id AS pbdId,
                    pbd.itemCode,
                    CONCAT(pbl.lotNo, '-', pbl.expiry) AS grnRefNO,
                    pbl.lotDate AS grnDate,
                    pbl.issueQoh AS poQty,
                    'lot' AS type
                FROM po_bill_dtl pbd
                INNER JOIN po_bill_lot pbl
                    ON pbl.digit = pbd.digit
                   AND pbl.type = pbd.type
                   AND pbl.itemId = pbd.itemName
                WHERE pbd.itemName = ?
                  AND pbl.issueStatus = 0
                  AND pbd.qcApproval = 1
            `, [id]),

            // FG STOCK
            connection.execute(`
                SELECT
                    f.id,
                    f.itemCode,
                    f.grn AS grnRefNO,
                    f.created_at AS grnDate,
                    f.issueQoh AS poQty,
                    'fg' AS type
                FROM fg_stock f
                WHERE f.itemId = ?
                  AND f.issueStatus = 0
            `, [id]),

            // PO
            connection.execute(`
                SELECT
                    pbd.id,
                    pbd.itemCode,
                    pb.grnRefNO,
                    pb.date AS grnDate,
                    pbd.issueQoh AS poQty,
                    'po' AS type
                FROM po_bill_dtl pbd
                INNER JOIN po_bill pb
                    ON pb.poNo = pbd.poNo
                WHERE
                (
                    (pbd.conversionPart IS NOT NULL
                    AND pbd.conversionPart <> ''
                    AND pbd.conversionPartId = ?)
                OR ( (pbd.conversionPart IS NULL OR pbd.conversionPart = '')
                    AND pbd.itemName = ?)
                )
                AND pbd.issueStatus = 0
            `, [id, id]),

            // MRN
            connection.execute(`
                SELECT
                    id,
                    itemCode,
                    grnNo AS grnRefNO,
                    created_at AS grnDate,
                    issueQoh AS poQty,
                    'mrn' AS type
                FROM store
                WHERE docType = 'Mrn'
                  AND itemId = ?
                  AND issueStatus = 0
                  AND issueQoh > 0
            `, [id]),

            // PO BILL WITHOUT PO
            connection.execute(`
                SELECT
                    id,
                    itemCode,
                    poNo AS grnRefNO,
                    created_at AS grnDate,
                    issueQoh AS poQty,
                    'pbWithoutPo' AS type
                FROM pob_wo_po_dtl
                WHERE
                (
                    (NULLIF(conversionPart, '') IS NOT NULL AND conversionPartId = ?)
                OR (NULLIF(conversionPart, '') IS NULL AND itemId = ?)
                )
                AND issueStatus = 0
                AND issueQoh > 0
            `, [id, id])
        ]);

        let grnLists = [
            ...openingBalance,
            ...grnRows,
            ...fgRows,
            ...poRows,
            ...mrnRows,
            ...poBillWithOutPo
        ];

        /* ===================== FIFO SORT ===================== */
        grnLists.sort((a, b) => {
            const d = new Date(a.grnDate) - new Date(b.grnDate);
            if (d !== 0) return d;
            return a.id - b.id; // strict FIFO tie-breaker
        });

        grnLists = grnLists.map((row, index) => ({
            sNo: index + 1,
            ...row,
            grnDate: new Date(row.grnDate).toISOString().slice(0, 10)
        }));

        return handleSuccessResponse(res, 'GRN details', grnLists);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// Manual Grn assignment
const assignGrnToJC = async (conn, srnCategory, srnId, grnNo, issueNo, itemId, totalIssuedQty) => {
    try {
        // if (srnCategory !== 'Production' && srnCategory !== 'BUY PRODUCTION') {
        //     return true;
        // }

        const [srnRows] = await conn.execute(
            `SELECT jcNos
            FROM srn
            WHERE id = ?
                AND jcNos IS NOT NULL
                AND TRIM(jcNos) <> ''`,
            [srnId]
        );

        if (srnRows.length === 0) {
            return true;
        }

        const jcNos = srnRows[0].jcNos
            .split(',')
            .map(j => j.trim())
            .filter(Boolean)
            .join(',');

        if (!jcNos || jcNos.trim() === "") {
            return true;
        }
        const jcNosArray = jcNos.split(',');
        const placeholders = jcNosArray.map(() => '?').join(', ');

        const query = ` 
            UPDATE job_card
            SET 
                grn = CONCAT_WS(',', NULLIF(grn,''), ?),
                issueNo = CONCAT_WS(',', NULLIF(issueNo,''), ?)
            WHERE jcNo IN (${placeholders});
        `;

        await conn.query(query, [grnNo, issueNo, ...jcNosArray]);

        await allocateIssuedQtyToJCs(conn, itemId, jcNos, totalIssuedQty, issueNo);

        return true;
    } catch (err) {
        throw err;
    }
};

// Atomically deduct issueQoh and derive issueStatus, guarding against concurrent over-issue.
const deductWithStatus = async (conn, table, id, quantity) => {
    const [result] = await conn.execute(
        `UPDATE ${table}
         SET issueStatus = CASE WHEN (issueQoh - ?) <= 0 THEN 1 ELSE 0 END,
             issueQoh = issueQoh - ?
         WHERE id = ? AND issueQoh >= ?`,
        [quantity, quantity, id, quantity]
    );
    if (result.affectedRows === 0) {
        throw new CustomError('Stock was consumed by another transaction while processing! Please try issuing again.', 409);
    }
};

exports.assignGrn = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { docNo, issueNo, srnId, itemId, itemCode, category, data } = req.body;

        if (!docNo || !issueNo || !srnId || !itemId || !itemCode || !category || !data) {
            throw new CustomError('Missing required parameters!', 400);
        }

        const issuedBy = await getUser(req);
        let totIssueQty = 0, grnNos = '';

        const [issuedRows] = await conn.execute(`
            INSERT INTO material_issue_note (docNo, issueNo, issuedBy) VALUES (?, ?, ?)`
            , [docNo, issueNo, issuedBy]
        );

        if (!issuedRows.affectedRows) {
            throw new CustomError('Failed to create issue note!', 400);
        }
        const issueId = issuedRows.insertId;

        for (const item of data) {
            const { id, grnNo, quantity, type } = item;

            if (type === 'lot') {
                const { pbdId } = item;

                await deductWithStatus(conn, 'po_bill_lot', id, quantity);
                await deductWithStatus(conn, 'po_bill_dtl', pbdId ?? id, quantity);
            } else if (type === 'po') {
                await deductWithStatus(conn, 'po_bill_dtl', id, quantity);
            } else if (type === 'op') {
                await deductWithStatus(conn, 'op_balance', id, quantity);
            } else if (type === 'fg') {
                await deductWithStatus(conn, 'fg_stock', id, quantity);
            } else if (type === 'mrn') {
                await deductWithStatus(conn, 'store', id, quantity);
            } else if (type === 'pbWithoutPo') {
                await deductWithStatus(conn, 'pob_wo_po_dtl', id, quantity);
            } else {
                throw new CustomError('Invalid GRN type!', 400);
            }

            totIssueQty += quantity;
            grnNos = grnNos === '' ? grnNo : `${grnNos}, ${grnNo}`;

            await updateStore(conn, itemId, itemCode, grnNo, issueNo, srnId, quantity);
        }
        // Update GRN to JC
        await assignGrnToJC(conn, category, srnId, grnNos, issueNo, itemId, totIssueQty);

        await conn.execute(`
            UPDATE srn 
            SET grn = CASE 
                    WHEN grn IS NULL OR grn = '' THEN ? 
                    ELSE CONCAT(grn, ', ', ?) 
                END, 
                issueNo = CASE 
                    WHEN issueNo IS NULL OR issueNo = '' THEN ? 
                    ELSE CONCAT(issueNo, ', ', ?) 
                END,
                issuedQty = GREATEST(issuedQty + ?, 0), 
                issuedBy = ? 
            WHERE id = ?;
            `, [grnNos, grnNos, issueNo, issueNo, totIssueQty, issuedBy, srnId]
        );

        await conn.execute(`
            INSERT INTO material_issue_dtl (issueId, srnId, itemId, itemCode, grnNo, issuedQty) VALUES (?, ?, ?, ?, ?, ?)`
            , [issueId, srnId, itemId, itemCode, grnNos, totIssueQty]
        );

        await updateDocCounter(conn, 'MaterialIssueNote');
        await conn.commit();

        return handleSuccessResponse(res, 'Issue successful');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

// stock in bulk. Keeps query size/lock time bounded for a few-thousand-item batch.
const RESET_CHUNK = 2000;

const chunkArray = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

// Core of the reset: given an open transaction connection and a list of item
const resetIssueQohForIds = async (conn, ids) => {
    const totals = { op: 0, lot: 0, fg: 0, po: 0, mrn: 0, pbWithoutPo: 0 };

    for (const idChunk of chunkArray(ids, RESET_CHUNK)) {
        const placeholders = idChunk.map(() => '?').join(',');

        // OPENING BALANCE
        const [opResult] = await conn.query(`
            UPDATE op_balance
            SET issueQoh = 0, issueStatus = 1
            WHERE itemId IN (${placeholders})
        `, idChunk);

        // PO LOT
        const [lotResult] = await conn.query(`
            UPDATE po_bill_lot
            SET issueQoh = 0, issueStatus = 1
            WHERE itemId IN (${placeholders})
        `, idChunk);

        // FG STOCK
        const [fgResult] = await conn.query(`
            UPDATE fg_stock
            SET issueQoh = 0, issueStatus = 1
            WHERE itemId IN (${placeholders})
        `, idChunk);

        // PO — matches the "own item vs conversion part" logic used by fetchGrn / materialIssue.
        const [poResult] = await conn.query(`
            UPDATE po_bill_dtl pbd
            SET pbd.issueQoh = 0, pbd.issueStatus = 1
            WHERE
                (pbd.conversionPart IS NOT NULL AND pbd.conversionPart <> '' AND pbd.conversionPartId IN (${placeholders}))
             OR ((pbd.conversionPart IS NULL OR pbd.conversionPart = '') AND pbd.itemName IN (${placeholders}))
        `, [...idChunk, ...idChunk]);

        // MRN (only docType = 'Mrn' rows carry this ledger)
        const [mrnResult] = await conn.query(`
            UPDATE store
            SET issueQoh = 0, issueStatus = 1
            WHERE docType = 'Mrn' AND itemId IN (${placeholders})
        `, idChunk);

        // PO BILL WITHOUT PO
        const [poWoPoResult] = await conn.query(`
            UPDATE pob_wo_po_dtl
            SET issueQoh = 0, issueStatus = 1
            WHERE
                (NULLIF(conversionPart, '') IS NOT NULL AND conversionPartId IN (${placeholders}))
             OR (NULLIF(conversionPart, '') IS NULL AND itemId IN (${placeholders}))
        `, [...idChunk, ...idChunk]);

        totals.op += opResult.affectedRows;
        totals.lot += lotResult.affectedRows;
        totals.fg += fgResult.affectedRows;
        totals.po += poResult.affectedRows;
        totals.mrn += mrnResult.affectedRows;
        totals.pbWithoutPo += poWoPoResult.affectedRows;
    }

    return totals;
};
exports.resetIssueQohForIds = resetIssueQohForIds;

// resetIssueQohForIds does the actual per-table reset.
exports.resetGrnStock = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const rawCodes = Array.isArray(req.body.itemCodes)
            ? req.body.itemCodes
            : (req.body.itemCode ? [req.body.itemCode] : []);

        const itemCodes = [...new Set(rawCodes.map(c => String(c).trim()).filter(Boolean))];
        if (!itemCodes.length) {
            throw new CustomError('itemCode or itemCodes is required', 400);
        }

        // Resolve item codes -> ids in batched IN(...) lookups
        const idByCode = new Map();
        for (const codeChunk of chunkArray(itemCodes, RESET_CHUNK)) {
            const [found] = await conn.query(
                `SELECT id, itemCode FROM items WHERE itemCode IN (?)`,
                [codeChunk]
            );
            for (const r of found) idByCode.set(r.itemCode, r.id);
        }

        const notFound = itemCodes.filter(c => !idByCode.has(c));
        const ids = [...idByCode.values()];

        if (!ids.length) {
            throw new CustomError('None of the given item(s) were found!', 404);
        }

        const totals = await resetIssueQohForIds(conn, ids);

        await conn.commit();

        return handleSuccessResponse(res, 'GRN stock reset successfully', {
            itemsRequested: itemCodes.length,
            itemsMatched: ids.length,
            notFound,
            rowsReset: totals
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.fetchGrnNo = async (req, res) => {
    try {
        const { itemCode } = req.body;

        const query = `
            SELECT 
                pbd.id, pbd.itemCode, pb.grnRefNO, pbd.issueQoh as poQty 
            FROM 
                po_bill_dtl pbd
            INNER JOIN po_bill pb ON pb.digit = pbd.digit AND pb.type = pbd.type
            WHERE pbd.itemCode = ? AND pbd.issueStatus = ?
        `;

        const [rows] = await connection.execute(query, [itemCode, 0]);
        const result = rows.length > 0 ? [rows[0]] : [];

        return handleSuccessResponse(res, 'GRN-details', result);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const fetchJcIds = async (conn, jcNos) => {
    try {
        const jc = jcNos.split(',')
        const placeholders = Array(jc.length).fill('?').join(',')

        const [jcRows] = await conn.execute(`
            SELECT id FROM job_card
            WHERE jcNo IN(${placeholders})`,
            jc
        )

        return jcRows.map(row => row.id);
    } catch (err) {
        throw err
    }
}

async function allocateIssuedQtyToJCs(conn, itemId, jcNos, totIssuedQty, issueNo) {
    if (totIssuedQty <= 0 || !jcNos) return;

    // ✅ GUARANTEE TEMP TABLE EXISTS (SAFE & FAST)
    await conn.execute(`
        CREATE TEMPORARY TABLE IF NOT EXISTS tmp_srn_fifo (
            id INT PRIMARY KEY,
            reqQty DECIMAL(10,2),
            issuedQty DECIMAL(10,2)
        ) ENGINE=MEMORY
    `);

    const jcIds = await fetchJcIds(conn, jcNos);
    if (!jcIds.length) return;

    const placeholders = jcIds.map(() => '?').join(',');

    await conn.execute(`TRUNCATE TABLE tmp_srn_fifo`);

    await conn.execute(
        `
        INSERT INTO tmp_srn_fifo (id, reqQty, issuedQty)
        SELECT id, reqQty, issuedQty
        FROM srn_issue
        WHERE itemId = ?
          AND jcId IN (${placeholders})
          AND issuedQty < reqQty
        ORDER BY id ASC
        `,
        [itemId, ...jcIds]
    );

    await conn.execute(`SET @remaining := ?`, [totIssuedQty]);

    await conn.execute(
        `
        UPDATE srn_issue si
        JOIN (
            SELECT
                id,
                LEAST(reqQty - issuedQty, @remaining) AS allocQty,
                @remaining := @remaining - LEAST(reqQty - issuedQty, @remaining)
            FROM tmp_srn_fifo
        ) t ON t.id = si.id
        SET 
            si.issuedQty = si.issuedQty + t.allocQty,
            si.issueNo = CASE
                WHEN si.issueNo IS NULL OR si.issueNo = ''
                    THEN ?
                ELSE CONCAT(si.issueNo, ',', ?)
            END
        WHERE t.allocQty > 0
        `,
        [issueNo, issueNo]
    );
}

exports.issueAutomatic = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { docNo, issueNo, issuedDate, items } = req.body;

        if (!docNo || !issueNo || !items || !items.length) {
            throw new CustomError('Missing required parameters!', 400);
        }
        const issuedBy = await getUser(req);

        const [issuedRows] = await conn.execute(`
            INSERT INTO material_issue_note (docNo, issueNo, issueDate, issuedBy) VALUES (?, ?, ?, ?)`
            , [docNo, issueNo, issuedDate, issuedBy]
        );

        if (!issuedRows.affectedRows) {
            throw new CustomError('Failed to create issue note!', 400);
        }

        const issueId = issuedRows.insertId;
        const grnToJC = new Map();

        // GRN update function
        const updateGrnNos = (grnToJC, key, grn) => {
            const trimmedKey = key.trim();
            if (grnToJC.has(trimmedKey)) {
                grnToJC.set(trimmedKey, `${grnToJC.get(trimmedKey)},${grn}`);
            } else {
                grnToJC.set(trimmedKey, grn);
            }
        };

        // let grnFound = false;
        const issueIds = new Map(items.map(obj => [obj.id, obj.itemCode]));
        let isIssued = false;

        await conn.execute(`
            CREATE TEMPORARY TABLE IF NOT EXISTS tmp_srn_fifo (
                id INT PRIMARY KEY,
                reqQty DECIMAL(10,2),
                issuedQty DECIMAL(10,2)
            ) ENGINE=MEMORY
        `);

        // Process each SRN item
        for (const item of items) {
            const { id, jcNos, jcNo, itemId, itemCode, totStk, category, reqQty, issuedQty, shelfLifeItem } = item;

            if (!id || !itemId || !itemCode || !category || !reqQty) {
                console.log(id, itemId, itemCode, category, reqQty);
                throw new CustomError('Missing required parameters in item!', 400);
            }

            const Qty = Number(reqQty) - Number(issuedQty);
            if (Qty <= 0 || (shelfLifeItem && shelfLifeItem.toUpperCase() === 'Y')) {
                continue;
            }

            const { grnNo: grn, totalIssuedQty } = await materialIssue(conn, id, itemId, itemCode, Qty, issueNo, category);

            // if(!grn && !totalIssuedQty) continue;
            if (!grn || !totalIssuedQty || totalIssuedQty <= 0) continue;

            if (grn && totalIssuedQty > 0) {
                if (jcNos) {
                    jcNos.split(',').forEach(jc => {
                        updateGrnNos(grnToJC, jc, grn); // Update each jcNo in the Map
                    });
                } else if (jcNo) {
                    updateGrnNos(grnToJC, jcNo, grn);  // Update the single jcNo
                }

                await conn.execute(`
                    UPDATE srn 
                    SET issuedQty = issuedQty + ?, 
                        grn = TRIM(BOTH ',' FROM CONCAT_WS(',', grn, ?)), 
                        issueNo = TRIM(BOTH ',' FROM CONCAT_WS(',', issueNo, ?)), 
                        issuedBy = ? 
                    WHERE id = ?`,
                    [totalIssuedQty, grn, issueNo, issuedBy, id]);

                await conn.execute(`
                    INSERT INTO material_issue_dtl (issueId, srnId, itemId, itemCode, grnNo, availableStk, issuedQty) VALUES (?, ?, ?, ?, ?, ?, ?)`
                    , [issueId, id, itemId, itemCode, grn, totStk, totalIssuedQty]
                );

                const mergedJcNos = [jcNos, jcNo]
                    .filter(Boolean)                // ignore null / undefined / empty inputs
                    .join(',')                      // merge first
                    .split(',')                     // then normalize
                    .map(j => j.trim())
                    .filter(Boolean)
                    .join(',');


                await allocateIssuedQtyToJCs(conn, itemId, mergedJcNos, totalIssuedQty, issueNo);
            }
            if (grn && totalIssuedQty > 0) {
                issueIds.delete(id);
                isIssued = true;
            }
        }
        if (!isIssued) {
            const shelfLifeItems = items.filter(obj => obj.shelfLifeItem && obj.shelfLifeItem.toUpperCase() === 'Y');
            if (shelfLifeItems.length > 0) {
                const lotItems = shelfLifeItems.map(obj => obj.itemCode).join(', ');
                throw new CustomError(`These items have shelfLifeItem Y: ${lotItems}`, 500);
            }
            throw new CustomError(`No GRN found for Items: ${[...issueIds.values()].join(', ')}`, 500);
        }

        // Update GRNs for Job Cards
        await updateGrnLinks(conn, grnToJC, issueNo);
        await updateDocCounter(conn, 'MaterialIssueNote');

        await conn.commit();

        // issueIds still holds any items that were skipped (no stock found,
        // shelf-life item, or nothing left to issue) even though the batch
        // as a whole succeeded — surface them instead of hiding the gap.
        const skippedItems = [...issueIds.values()];
        const message = skippedItems.length
            ? `Issue successful. Skipped (no GRN found): ${skippedItems.join(', ')}`
            : 'Issue successful';

        return handleSuccessResponse(res, message, { skippedItems });
    } catch (err) {
        await conn.rollback();
        if (err.code === "ER_DUP_ENTRY") {
            const match = err.message.match(/Duplicate entry '(.+?)'/);
            const duplicateValue = match ? match[1] : '';

            return res.status(400).json({
                success: false,
                message: `Issue Number '${duplicateValue}' already exists.`
            });
        }
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

async function materialIssue(conn, srnId, itemId, itemCode, plannedQty, issueNo, srnCategory) {
    try {
        const grnList = [];

        const [[item]] = await conn.execute(`
            SELECT id, category, shelfLifeItem, totStk
            FROM items
            WHERE itemCode = ?
        `, [itemCode]);

        if (!item) throw new CustomError(`Item not found: ${itemCode}`, 404);

        const totalStock = Number(item.totStk || 0);

        // 2. Calculate effective issue qty
        const effectivePlannedQty = Math.min(Number(plannedQty), totalStock);
        if (effectivePlannedQty <= 0) {
            // throw new CustomError(`Insufficient total stock for item: ${itemCode}`, 400);
            return { grnNo: null, totalIssuedQty: 0 };
        }

        const [rows] = await conn.execute(`
            SELECT op.id, op.itemCode, op.grn AS grnRefNO, op.created_at AS grnDate,
                op.issueQoh AS poQty, 'op' AS type
            FROM op_balance op
            WHERE op.itemCode = ? AND op.issueStatus = 0 AND op.issueQoh > 0

            UNION ALL

            SELECT f.id, f.itemCode, f.grn AS grnRefNO, f.created_at AS grnDate,
                f.issueQoh AS poQty, 'fg' AS type
            FROM fg_stock f
            WHERE f.itemCode = ? AND f.issueStatus = 0

            UNION ALL

            SELECT
                pbd.id,
                pbd.itemCode,
                pb.grnRefNO,
                pb.date AS grnDate,
                pbd.issueQoh AS poQty,
                'po' AS type
            FROM po_bill_dtl pbd
            INNER JOIN po_bill pb
                ON pb.digit = pbd.digit
               AND pb.type = pbd.type
            WHERE
            (
                (pbd.conversionPart IS NOT NULL
                AND pbd.conversionPart <> ''
                AND pbd.conversionPartId = ?)
            OR ( (pbd.conversionPart IS NULL OR pbd.conversionPart = '')
                AND pbd.itemName = ?)
            )
            AND pbd.issueStatus = 0

            UNION ALL

            SELECT id, itemCode, grnNo AS grnRefNO, created_at AS grnDate, issueQoh AS poQty, 'mrn' AS type
            FROM store
            WHERE docType = 'Mrn' AND itemId = ? AND issueStatus = 0 AND issueQoh > 0

            UNION ALL

            SELECT id, itemCode, poNo AS grnRefNO, created_at AS grnDate, issueQoh AS poQty, 'pbWithoutPo' AS type
            FROM pob_wo_po_dtl
            WHERE
            (
                (NULLIF(conversionPart, '') IS NOT NULL AND conversionPartId = ?)
            OR (NULLIF(conversionPart, '') IS NULL AND itemId = ?)
            )
            AND issueStatus = 0
            AND issueQoh > 0
        `, [itemCode, itemCode, itemId, itemId, itemId, itemId, itemId]);

        rows.sort((a, b) => {
            const d = new Date(a.grnDate) - new Date(b.grnDate);
            if (d !== 0) return d;
            return a.id - b.id; // strict FIFO tie-breaker
        });

        if (rows.length === 0) {
            return { grnNo: null, totalIssuedQty: null };
        }

        let remainingQty = effectivePlannedQty;
        let totalIssuedQty = 0;

        for (const item of rows) {
            const { id, grnRefNO, poQty, type } = item;
            if (remainingQty <= 0) break;

            const numericPoQty = parseFloat(poQty);
            const allocatableQty = Math.min(numericPoQty, remainingQty);

            remainingQty -= allocatableQty;
            totalIssuedQty += allocatableQty;

            // Update GRN source table (all six source tables carry issueStatus)
            const tableMap = {
                po: 'po_bill_dtl',
                op: 'op_balance',
                fg: 'fg_stock',
                lot: 'po_bill_lot',
                mrn: 'store',
                pbWithoutPo: 'pob_wo_po_dtl'
            };

            const table = tableMap[type];
            if (!table) {
                throw new CustomError('Invalid GRN type!', 400);
            }

            const updateQuery = `
                UPDATE ${table}
                SET issueStatus = CASE WHEN (issueQoh - ?) <= 0 THEN 1 ELSE 0 END,
                    issueQoh = issueQoh - ?
                WHERE id = ? AND issueQoh >= ?`;
            const updateParams = [allocatableQty, allocatableQty, id, allocatableQty];

            const [updateResult] = await conn.execute(updateQuery, updateParams);

            if (updateResult.affectedRows === 0) {
                throw new CustomError('Stock was consumed by another transaction while processing! Please try issuing again.', 409);
            }

            // update store and deduct totStk safely
            await updateStore(conn, itemId, itemCode, grnRefNO, issueNo, srnId, allocatableQty, srnCategory);
            grnList.push(grnRefNO);
        }

        if (totalIssuedQty < 0) {
            throw new CustomError(`Insufficient GRN quantity for item: ${itemCode}`, 400);
        }

        return { grnNo: grnList.join(','), totalIssuedQty };
    } catch (err) {
        throw err;
    }
}

const updateStore = async (conn, itemId, itemCode, grnNo, docNo, outId, outQty, category) => {
    try {
        if (outQty > 0) {
            const openQty = await fetchOpQty(itemId);

            await conn.execute(
                `INSERT INTO store (itemId, itemCode, grnNo, docNo, docType, outwardId, outwardQty, opQty)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [itemId, itemCode, grnNo, docNo, 'Material Issue', outId, outQty, openQty]
            );
        }
    } catch (error) {
        throw error;
    }
};

// Update GRN Links to Job Cards or SRN Helper Function
const updateGrnLinks = async (conn, grnList, issueNo) => {
    try {
        const jcNos = Array.from(grnList.keys());
        if (!jcNos.length) return true;

        const caseStatements = jcNos.map(() => `WHEN ? THEN ?`).join(' ');

        const values = [];
        jcNos.forEach(jcNo => {
            values.push(jcNo, grnList.get(jcNo));
        });

        const updateQuery = `
            UPDATE job_card
            SET 
                grn = CASE jcNo
                    ${caseStatements}
                    ELSE grn
                END,
                issueNo = TRIM(BOTH ',' FROM CONCAT_WS(',', issueNo, ?))
            WHERE jcNo IN (${jcNos.map(() => '?').join(',')})
        `;

        await conn.query(updateQuery, [
            ...values,
            issueNo,
            ...jcNos
        ]);

        return true;
    } catch (err) {
        throw err;
    }
};
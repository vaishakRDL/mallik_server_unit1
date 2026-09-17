const excel = require('exceljs');
const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { decodeExcelBase64 } = require('../utility/utilityFunction');
const { resetIssueQohForIds } = require('./grnController');

// How many item codes to resolve per SELECT ... IN (...) round trip.
// Keeps memory / packet size bounded when the sheet holds 50k-70k rows.
const LOOKUP_CHUNK = 5000;

// How many store rows to write per bulk INSERT (2 rows per uploaded item).
const INSERT_CHUNK = 4000;

// How many items to fold into one CASE-based items.totStk/allocStk UPDATE.
const STOCK_UPDATE_CHUNK = 2000;

/* ------------------------------------------------------------------ helpers */

// Unwrap an exceljs cell value to a primitive (handles formula / hyperlink / rich text).
const cellValue = (cell) => {
    const v = cell && cell.value;
    if (v === null || v === undefined) return null;

    if (typeof v === 'object') {
        if (v instanceof Date) return v;
        if ('result' in v) return v.result;                       // formula cell
        if ('text' in v) return v.text;                           // hyperlink wrapper
        if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
        return null;
    }
    return v;
};

const toText = (v) => (v === null || v === undefined) ? '' : String(v).trim();

const toQty = (v) => {
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return v;
    return Number(String(v).replace(/,/g, '').trim());
};

/* ----------------------------------------------------------------- template */
/**
 * Stream a blank Stock Correction xlsx (header + one sample row) for the user
 * to fill in and upload back through `import`.
 */
exports.template = async (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Stock Correction');

        worksheet.columns = [
            { header: 'itmCode', key: 'itmCode', width: 25 },
            { header: 'qty', key: 'qty', width: 15 },
            { header: 'grn', key: 'grn', width: 25 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).alignment = { horizontal: 'center' };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=StockCorrectionTemplate.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

/* ------------------------------------------------------------------- import */
/**
 * Parse a Stock Correction xlsx (columns: itmCode | qty | grn) and return a
 * validated preview. No writes happen here.
 *
 * Optimised for large files (50k-70k rows):
 *   - the whole sheet is read synchronously into memory first (no awaits in the loop)
 *   - every item code is resolved to an id with a handful of batched IN queries
 *     instead of one query per row
 *   - preview rows are built from an in-memory Map (O(1) lookup, no more DB calls)
 */
exports.import = async (req, res) => {
    try {
        if (!req.body || !req.body.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const buffer = await decodeExcelBase64(req.body.file);

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        if (!worksheet || worksheet.rowCount <= 1) {
            return res.status(400).json({ success: false, message: 'The uploaded file has no data rows' });
        }

        /* 1) Read every data row (sync, no DB) --------------------------------- */
        const rows = [];
        const codeRows = new Map(); // itmCode -> [rowNo, ...]  (used for duplicate detection)

        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // header

            const itmCode = toText(cellValue(row.getCell(1)));
            const qtyRaw = cellValue(row.getCell(2));
            const grn = toText(cellValue(row.getCell(3)));

            // ignore completely blank rows
            if (!itmCode && (qtyRaw === null || qtyRaw === '') && !grn) return;

            rows.push({ rowNo: rowNumber, itmCode, qty: toQty(qtyRaw), grn });

            if (itmCode) {
                if (codeRows.has(itmCode)) codeRows.get(itmCode).push(rowNumber);
                else codeRows.set(itmCode, [rowNumber]);
            }
        });

        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No data rows found in the file' });
        }

        /* 2) Resolve all item codes -> ids in a few batched queries ----------- */
        const codes = [...codeRows.keys()];
        const idByCode = new Map();

        for (let i = 0; i < codes.length; i += LOOKUP_CHUNK) {
            const slice = codes.slice(i, i + LOOKUP_CHUNK);
            const [found] = await connection.query(
                'SELECT id, itemCode FROM items WHERE itemCode IN (?)',
                [slice]
            );
            for (const r of found) idByCode.set(String(r.itemCode), r.id);
        }

        /* 3) Build preview rows (all in memory) ------------------------------- */
        const items = [];
        let validCount = 0;
        let id = 1;

        for (const r of rows) {
            const errors = [];
            const itemId = r.itmCode ? idByCode.get(r.itmCode) : undefined;

            if (!r.itmCode) {
                errors.push('Item Code is required');
            } else {
                if (itemId === undefined) errors.push(`Invalid Item Code ${r.itmCode}`);

                const dupRows = codeRows.get(r.itmCode);
                if (dupRows.length > 1) {
                    errors.push(`Duplicate Item Code ${r.itmCode} (rows ${dupRows.join(', ')})`);
                }
            }

            if (Number.isNaN(r.qty)) errors.push('Qty must be a number');
            if (!r.grn) errors.push('GRN is required');

            if (errors.length === 0) validCount++;

            items.push({
                id: id++,
                rowNo: r.rowNo,
                itemId: itemId ?? null,
                itmCode: r.itmCode,
                qty: Number.isNaN(r.qty) ? null : r.qty,
                grn: r.grn,
                errorRemark: errors.length ? errors.join(', ') : null
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Stock correction file parsed',
            summary: {
                total: items.length,
                valid: validCount,
                invalid: items.length - validCount
            },
            items
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};




/* --------------------------------------------------------------- storeToMain */
/**
 * Commit the corrected stock, in one transaction, in this order:
 *
 *   1. Close off every existing GRN lot for these items across all 6 GRN
 *      source tables (issueQoh = 0, issueStatus = 1) via resetIssueQohForIds —
 *      see grnController. Whatever was still "open" under the old, mismatched
 *      count is no longer issuable.
 *   2. Write TWO `store` ledger rows per uploaded item:
 *        Row 1 - reset : totQty = 0                     -> balance forced to zero
 *        Row 2 - set   : inwardQty = qty, totQty = qty   -> the uploaded quantity
 *      Row 1 always gets a lower id than Row 2 for the same item, so the
 *      ledger reads reset-then-set.
 *   3. Set items.totStk/allocStk to the corrected qty (summed per item across
 *      its rows in this batch).
 *   4. Insert a fresh op_balance row per uploaded item/grn pair, fully
 *      issuable (issueQoh = qty) — this becomes the new opening stock that
 *      GRN issuance draws from going forward, replacing the lots closed off
 *      in step 1.
 *
 * All rows of one upload share a batch reference (docNo/batchNo) so the
 * whole correction can be traced later.
 */
exports.storeToMain = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const user = req.headers.username || 'admin';
        const items = Array.isArray(req.body.items) ? req.body.items : [];

        // keep only rows that carry a resolved itemId, a numeric qty and a grn
        const clean = items
            .map(i => ({
                itemId: i.itemId,
                itemCode: i.itmCode ?? i.itemCode ?? null,
                grn: (i.grn === undefined || i.grn === null) ? null : String(i.grn),
                qty: Number(i.qty)
            }))
            .filter(i => i.itemId && i.grn && !Number.isNaN(i.qty));

        if (clean.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid items to import' });
        }

        const batchNo = `SC-${Date.now()}`;
        const itemIds = [...new Set(clean.map(i => i.itemId))];

        // Received qty per item, summed across every grn/lot row uploaded for
        // that item — this is what items.totStk/allocStk get set to below.
        const qtyByItem = new Map();
        for (const item of clean) {
            qtyByItem.set(item.itemId, (qtyByItem.get(item.itemId) || 0) + item.qty);
        }
        const qtyEntries = [...qtyByItem.entries()]; // [itemId, receivedQty][]

        // 2 rows per item: [itemId, itemCode, docType, docNo, grnNo, inwardQty, totQty, stkCrt, addedBy]
        const values = [];
        for (const item of clean) {
            values.push([item.itemId, item.itemCode, 'Stock Correction-Reset', batchNo, item.grn, null, 0, 1, user]);            // reset
            values.push([item.itemId, item.itemCode, 'Stock Correction-Set', batchNo, item.grn, item.qty, item.qty, 1, user]); // set
        }

        const insertSql = `
            INSERT INTO store
                (itemId, itemCode, docType, docNo, grnNo, inwardQty, totQty, stkCrt, addedBy)
            VALUES ?
        `;

        await conn.beginTransaction();

        // Close off old GRN entries (issueQoh = 0, issueStatus = 1) across all
        // 6 GRN source tables for these items BEFORE writing the corrected
        // balance, so stale/open ledgers don't linger under the new totQty.
        // Same transaction as the correction itself — atomic together.
        const grnReset = await resetIssueQohForIds(conn, itemIds);

        // chunk the bulk insert so a 50k-70k row file stays within packet limits
        for (let i = 0; i < values.length; i += INSERT_CHUNK) {
            await conn.query(insertSql, [values.slice(i, i + INSERT_CHUNK)]);
        }

        // Next, set items.totStk/allocStk to the received qty for each item
        // (summed across its rows in this batch) — the corrected qty replaces
        // whatever was cached there, same as the store ledger's reset-then-set.
        // allocStk mirrors totStk via the same CASE result rather than a second
        // one — single-table UPDATEs evaluate SET assignments left to right, so
        // this halves the WHEN branches and bound params per chunk.
        for (let i = 0; i < qtyEntries.length; i += STOCK_UPDATE_CHUNK) {
            const slice = qtyEntries.slice(i, i + STOCK_UPDATE_CHUNK);
            const caseStatements = slice.map(() => `WHEN ? THEN ?`).join(' ');
            const caseParams = slice.flat(); // [itemId, qty, itemId, qty, ...]
            const ids = slice.map(([itemId]) => itemId);

            await conn.query(`
                UPDATE items
                SET totStk = CASE id ${caseStatements} END,
                    allocStk = totStk
                WHERE id IN (${ids.map(() => '?').join(',')})
            `, [...caseParams, ...ids]);
        }

        // Finally, record the corrected qty as this item's new opening balance —
        // the 6 GRN source tables were just closed off above (issueQoh = 0), so
        // from now on GRN issuance for these items draws from these fresh
        // op_balance rows instead. One row per item/grn pair in the upload,
        // fully issuable (issueQoh = qty, issueStatus defaults to 0/open).
        const opBalanceValues = clean.map(item => [item.itemId, item.itemCode, item.grn, item.qty, user, item.qty]);

        const opBalanceInsertSql = `
            INSERT INTO op_balance (itemId, itemCode, grn, qty, addedBy, issueQoh)
            VALUES ?
        `;

        for (let i = 0; i < opBalanceValues.length; i += INSERT_CHUNK) {
            await conn.query(opBalanceInsertSql, [opBalanceValues.slice(i, i + INSERT_CHUNK)]);
        }

        await conn.commit();

        return handleSuccessResponse(res, 'Stock correction imported successfully', {
            batchNo,
            itemsProcessed: clean.length,
            rowsInserted: values.length,
            itemsStockUpdated: qtyEntries.length,
            opBalanceRowsInserted: opBalanceValues.length,
            grnReset
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};
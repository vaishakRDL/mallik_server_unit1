const excel = require('exceljs');
const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { decodeExcelBase64 } = require('../utility/utilityFunction');

// How many item codes to resolve per SELECT ... IN (...) round trip.
// Keeps memory / packet size bounded when the sheet holds 50k-70k rows.
const LOOKUP_CHUNK = 5000;

// How many store rows to write per bulk INSERT (2 rows per uploaded item).
const INSERT_CHUNK = 4000;

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

// DDMMYYYYHHmmss (Asia/Kolkata), e.g. 12092026142001 - always 14 digits, so batch numbers stay unique and sortable.
const dateTimeStamp = () => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(new Date());

    const get = (type) => parts.find(p => p.type === type).value;
    return `${get('day')}${get('month')}${get('year')}${get('hour')}${get('minute')}${get('second')}`;
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
 * Commit the corrected stock into the `store` ledger (no other stock table is
 * touched). For every uploaded item TWO rows are written, in this order:
 *
 *   Row 1 - reset : totQty = 0            -> the running balance is forced to zero
 *   Row 2 - set   : inwardQty = qty, totQty = qty  -> the uploaded quantity
 *
 * Row 1 always gets a lower id than Row 2 for the same item, so the ledger reads
 * reset-then-set. Everything runs in one transaction; all rows of one upload
 * share a batch reference (docNo) so the pair can be traced later.
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

        const batchNo = `SC-${dateTimeStamp()}`;

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

        // chunk the bulk insert so a 50k-70k row file stays within packet limits
        for (let i = 0; i < values.length; i += INSERT_CHUNK) {
            await conn.query(insertSql, [values.slice(i, i + INSERT_CHUNK)]);
        }

        await conn.commit();

        return handleSuccessResponse(res, 'Stock correction imported successfully', {
            batchNo,
            itemsProcessed: clean.length,
            rowsInserted: values.length
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};
const excel = require('exceljs');
const { connection, handleSuccessResponse, handleErrorResponse } = require('../../config/dbSql');
const { decodeBase64, getUser } = require('../../utility/utilityFunction');
const { incCacheVersion } = require('../itemController');

exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item Code', 'Item Name', 'Item Group', 'In Active', 'UOM', 'Std rate', 'Min Stock Lvl', 'Max Lvl',
            'Shelf LifeItem', 'HSN Code', 'Critical', 'Category', 'Main Location', 'Material', 'Material Thickness',
            'RM Width', 'RM Length', 'Gross Weight', 'Net Weight', 'Scrap Weight', 'Product Finish', 'Coating Area', 'Product Family',
            'FIM Id', 'RM ItemCode', 'Reorder', 'ROL', 'ROQ', 'Non Stockable', 'Under Ledger', 'GST Category', 'Stock Control', 'JC Part']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = Item.xlsx');

        // Write the Excel file to the response
        workbook.xlsx.write(res)
            .then(() => {
                // End the response stream
                res.end();
            })
            .catch(err => {
                console.error('Error writing Excel file:', err);
                res.status(500).send('Error generating Excel file');
            });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};

function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

// Import Items details
async function fetchMaster(table) {
    const [rows] = await connection.execute(
        `SELECT id, name FROM ${table}`
    );
    return rows;
}

const mapify = (rows) =>
    new Map(rows.map(r => [normalize(r.name), r.id]));

async function loadExistingItemCodes() {
    const [rows] = await connection.execute(
        "SELECT itemCode FROM items"
    );
    return new Set(rows.map(r => normalize(r.itemCode)));
}

const normalize = (v) => v ? v.trim().toUpperCase() : null;
const nullify = (v) => (v === "" || v === "NULL") ? null : v;
const yesNo = (v) => normalize(v) === "Y" ? "Y" : "N";
const toNumber = (v) => (v === "" ? null : Number(v) || null);
const toBooleanNumber = (v) => v === true ? 1 : 0;

function resolveId(map, value, errors, label) {
    if (!value) return null;
    const key = normalize(value);
    const id = map.get(key);
    if (!id) errors.push(`${label} not found: ${value}`);
    return id || null;
}

async function preloadMasters() {
    const [
        groups,
        uoms,
        hsn,
        locations,
        finishes,
        families,
        fims,
        ledgers
    ] = await Promise.all([
        fetchMaster("mst_item_group"),
        fetchMaster("mst_uom"),
        fetchMaster("item_hsn_code"),
        fetchMaster("item_main_loc"),
        fetchMaster("item_product_finish"),
        fetchMaster("item_product_family"),
        fetchMaster("item_fim_id"),
        fetchMaster("item_under_ledger")
    ]);

    return {
        itemGroup: mapify(groups),
        uom: mapify(uoms),
        hsn: mapify(hsn),
        location: mapify(locations),
        finish: mapify(finishes),
        family: mapify(families),
        fim: mapify(fims),
        ledger: mapify(ledgers)
    };
}

function processRow(row, rowNumber, existingItems, masters) {
    const errors = [];
    const get = (i) => (row.getCell(i)?.text || "").trim();

    const partNo = normalize(get(1));

    if (!partNo) errors.push("ItemCode is required");
    if (existingItems.has(partNo)) {
        errors.push(`Item ${partNo} already exists`);
    }

    return {
        id: rowNumber,
        rowNo: rowNumber,
        itemCode: partNo,
        itemName: nullify(get(2)),
        itemGroup: resolveId(masters.itemGroup, get(3), errors, "Item Group"),
        itemGroupName: get(3),
        inActive: toBooleanNumber(get(4)),
        uom: resolveId(masters.uom, get(5), errors, "UOM"),
        uomName: get(5),
        stdRate: toNumber(get(6)),
        minStockLvl: toNumber(get(7)),
        maxLvl: toNumber(get(8)),
        shelfLifeItem: nullify(get(9)),
        hsnCode: resolveId(masters.hsn, get(10), errors, "HSN"),
        hsnName: get(10),
        critical: nullify(get(11)),
        category: nullify(get(12)),
        mainLocation: resolveId(masters.location, get(13), errors, "Location"),
        mainLocationName: get(13),
        material: nullify(get(14)),
        materialThickness: nullify(get(15)),
        rmWidth: toNumber(get(16)),
        rmLength: toNumber(get(17)),
        grossWeight: toNumber(get(18)),
        netWeight: toNumber(get(19)),
        scrapWeight: toNumber(get(20)),
        productFinish: resolveId(masters.finish, get(21), errors, "Finish"),
        productFinishName: get(21),
        coatingArea: nullify(get(22)),
        productFamily: resolveId(masters.family, get(23), errors, "Product Family"),
        productFamilyName: get(23),
        fimId: resolveId(masters.fim, get(24), errors, "FIM"),
        fimName: get(24),
        rmItemCode: nullify(get(25)),
        reorder: nullify(get(26)),
        rol: toNumber(get(27)),
        roq: toNumber(get(28)),
        nonStockable: yesNo(get(29)),
        underLedger: resolveId(masters.ledger, get(30), errors, "Ledger"),
        underLedgerName: get(30),
        gstCategory: nullify(get(31)),
        stockControl: nullify(get(32)),
        jcPart: nullify(get(33)),
        errorMessages: errors.join(", ")
    };
}

async function processBatch(rows, startRowNo, existingItems, masters) {
    return rows.map((row, idx) =>
        processRow(
            row,
            startRowNo + idx,
            existingItems,
            masters
        )
    );
}

const BATCH_SIZE = 300;
const INSERT_CHUNK_SIZE = 500;

exports.import = async (req, res) => {
    try {
        const buffer = await decodeBase64(req.body.file);

        const [existingItems, masters] = await Promise.all([
            loadExistingItemCodes(),
            preloadMasters()
        ]);

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        let batch = [];
        const results = [];

        for (let i = 2; i <= worksheet.rowCount; i++) {
            batch.push(worksheet.getRow(i));

            if (batch.length === BATCH_SIZE) {
                const processed = await processBatch(
                    batch,
                    i - BATCH_SIZE + 1,
                    existingItems,
                    masters
                );
                results.push(...processed);
                batch = [];
            }
        }

        if (batch.length) {
            const processed = await processBatch(
                batch,
                worksheet.rowCount - batch.length + 1,
                existingItems,
                masters
            );
            results.push(...processed);
        }

        return handleSuccessResponse(res, "Items imported successfully", results);

    } catch (err) {
        console.error("Import error:", err);
        return handleErrorResponse(res, err);
    }
};

const getValue = (val) => {
    if (val === undefined || val === '') return null;
    return val;
};

exports.bulkCreationItems = async (conn, items, username) => {
    if (!Array.isArray(items) || items.length === 0) return false;

    const insertQuery = `
        INSERT INTO items (
            itemCode, itemName, itemGroup, inActive, uom, stdRate, gstCategory,
            minStockLvl, maxLvl, underLedger, reorder, rol, roq, shelfLifeItem,
            hsnCode, critical, mainLocation, productFinish, productFamily,
            category, fimId, grossWeight, netWeight, scrapWeight,
            rmItemCode, rmThickness, rmWidth, rmLength,
            stockControl, material, materialThickness, jcPart, buyProdJC, nonStockable,
            createdBy
        ) VALUES ?
        ON DUPLICATE KEY UPDATE
            itemName = COALESCE(VALUES(itemName), itemName),
            itemGroup = COALESCE(VALUES(itemGroup), itemGroup),
            inActive = COALESCE(VALUES(inActive), inActive),
            uom = COALESCE(VALUES(uom), uom),
            stdRate = COALESCE(VALUES(stdRate), stdRate),
            gstCategory = COALESCE(VALUES(gstCategory), gstCategory),
            minStockLvl = COALESCE(VALUES(minStockLvl), minStockLvl),
            maxLvl = COALESCE(VALUES(maxLvl), maxLvl),
            underLedger = COALESCE(VALUES(underLedger), underLedger),
            reorder = COALESCE(VALUES(reorder), reorder),
            rol = COALESCE(VALUES(rol), rol),
            roq = COALESCE(VALUES(roq), roq),
            shelfLifeItem = COALESCE(VALUES(shelfLifeItem), shelfLifeItem),
            hsnCode = COALESCE(VALUES(hsnCode), hsnCode),
            critical = COALESCE(VALUES(critical), critical),
            mainLocation = COALESCE(VALUES(mainLocation), mainLocation),
            productFinish = COALESCE(VALUES(productFinish), productFinish),
            productFamily = COALESCE(VALUES(productFamily), productFamily),
            category = COALESCE(VALUES(category), category),
            fimId = COALESCE(VALUES(fimId), fimId),
            grossWeight = COALESCE(VALUES(grossWeight), grossWeight),
            netWeight = COALESCE(VALUES(netWeight), netWeight),
            scrapWeight = COALESCE(VALUES(scrapWeight), scrapWeight),
            rmItemCode = COALESCE(VALUES(rmItemCode), rmItemCode),
            rmThickness = COALESCE(VALUES(rmThickness), rmThickness),
            rmWidth = COALESCE(VALUES(rmWidth), rmWidth),
            rmLength = COALESCE(VALUES(rmLength), rmLength),
            stockControl = COALESCE(VALUES(stockControl), stockControl),
            material = COALESCE(VALUES(material), material),
            materialThickness = COALESCE(VALUES(materialThickness), materialThickness),
            jcPart = COALESCE(VALUES(jcPart), jcPart),
            buyProdJC = COALESCE(VALUES(buyProdJC), buyProdJC),
            nonStockable = COALESCE(VALUES(nonStockable), nonStockable),
            updatedBy = ?,
            updated_at = NOW()
    `;

    const values = items.map(item => ([
        item.itemCode,
        getValue(item.itemName),
        getValue(item.itemGroup),
        toBooleanNumber(item.inActive),
        getValue(item.uom),
        getValue(item.stdRate),
        getValue(item.gstCategory),
        getValue(item.minStockLvl),
        getValue(item.maxLvl),
        getValue(item.underLedger),
        getValue(item.reorder),
        getValue(item.rol),
        getValue(item.roq),
        getValue(item.shelfLifeItem),
        getValue(item.hsnCode),
        getValue(item.critical),
        getValue(item.mainLocation),
        getValue(item.productFinish),
        getValue(item.productFamily),
        getValue(item.category),
        getValue(item.fimId),
        getValue(item.grossWeight),
        getValue(item.netWeight),
        getValue(item.scrapWeight),
        getValue(item.rmItemCode),
        getValue(item.rmThickness),
        getValue(item.rmWidth),
        getValue(item.rmLength),
        getValue(item.stockControl),
        getValue(item.material),
        getValue(item.materialThickness),
        getValue(item.jcPart),
        item.buyProdJC || 'N',
        item.nonStockable ? (item.nonStockable === 'Y' ? 1 : 0) : null,
        username
    ]));

    const chunkArray = (arr, size) => {
        const result = [];
        for (let i = 0; i < arr.length; i += size) {
            result.push(arr.slice(i, i + size));
        }
        return result;
    };

    const chunks = chunkArray(values, INSERT_CHUNK_SIZE);

    for (const chunk of chunks) {
        await conn.query(insertQuery, [chunk, username]);
    }

    return true;
};

exports.store = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { items = [], type = 'Insert' } = req.body;

        if (!items.length) {
            return res.status(400).json({
                success: false,
                message: "No items provided"
            });
        }

        const errorList = items
            .filter(item => item.errorMessages?.trim())
            .map(item => ({
                rowNo: item.rowNo,
                itemCode: item.itemCode,
                error: item.errorMessages
            }));

        if (type === 'Insert' && errorList.length) {
            return res.status(400).json({
                success: false,
                message: "Validation errors found. No data inserted.",
                errors: errorList
            });
        }

        const updatedBy = await getUser(req);

        await conn.beginTransaction();

        await exports.bulkCreationItems(
            conn,
            items,
            updatedBy
        );

        await incCacheVersion();

        await conn.commit();

        return handleSuccessResponse(res, "Items imported successfully");

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

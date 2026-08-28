const { connection, CustomError, handleSuccessResponse, handleErrorResponse } = require('../../config/dbSql');
const excel = require('exceljs');
const { collection: masterCollection } = require('../../utility/master');
const { collection: itemCollection } = require('../../utility/itemMaster');
const { fetchItemId, decodeBase64, fetchItemIds, getUser } = require('../../utility/utilityFunction');
const { bulkCreationItems } = require('./itemExlV2Controller');
const { incCacheVersion } = require('../itemController');

exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item Code', 'Item Name', 'Item Group', 'Tally or Erp', 'In Active', 'UOM', 'Std rate', 'GST Category', 'Min Stock Lvl', 'Max Lvl', 'Under Ledger',
            'Reorder', 'ROL', 'ROQ', 'Shelf LifeItem', 'HSN Code', 'Critical', 'Main Location', 'Sub Location', 'Product Finish', 'Product Family', 'Category', 'FIM Id',
            'Duty', 'Gross Weight', 'Net Weight', 'Scrap Weight', 'RM ItemCode', 'RM Thickness', 'RM Width', 'RM Length', 'Stock Control', 'Material', 'Material Thickness',
            'JC Part', 'Part Type', 'SD Code', 'Del Package Type', 'Del Lot Qty', 'Non Stockable', 'Bin No', 'LotWise Item', 'Lot Type', 'MOQ', 'INVTOOLSEL', 'Tool ID', 'Led Time',
            'STCOND', 'RMItemId']);

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

exports.export = async (req, res) => {
    try {
        // Set response headers for file download up front so stream hits the browser linearly
        res.setHeader('Content-Disposition', 'attachment; filename="Items.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        // Use stream-based WorkbookWriter to bypass heavy RAM constraints
        const options = {
            stream: res,
            useStyles: true,
            useSharedStrings: true
        };
        const workbook = new excel.stream.xlsx.WorkbookWriter(options);
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Set column widths explicitly BEFORE adding any rows
        for (let i = 1; i <= 33; i++) {
            worksheet.getColumn(i).width = (i === 1 || i === 2 || i === 3) ? 45 : 20;
        }

        // Headers
        const headerRow = worksheet.addRow(['Item Code', 'Item Name', 'Item Group', 'In Active', 'UOM', 'Std rate', 'Min Stock Lvl', 'Max Lvl', 'Shelf LifeItem',
            'HSN Code', 'Critical', 'Category', 'Main Location', 'Material', 'Material Thickness', 'RM Width', 'RM Length', 'Gross Weight', 'Net Weight', 'Scrap Weight',
            'Product Finish', 'Coating Area', 'Product Family', 'FIM Id', 'RM ItemCode', 'Reorder', 'ROL', 'ROQ', 'Non Stockable', 'Under Ledger', 'GST Category',
            'Stock Control', 'JC Part']);

        // Apply styles to the header row
        headerRow.font = { bold: true, size: 13 };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text
        headerRow.commit(); // Ensure header row passes to the stream immediately

        // Keyset Pagination over the massive database
        let lastId = 0;
        const chunkSize = 15000;
        let hasMore = true;

        while (hasMore) {
            const items = `
                SELECT 
                    itm.id AS _internalId, itm.itemCode, itm.itemName, ig.name as itemGroup, CASE WHEN itm.inActive = 1 THEN 'Y' ELSE 'N' END AS inActiveStatus, uom.name as uomName,
                    itm.stdRate, itm.minStockLvl, itm.maxLvl, itm.shelfLifeItem, hsn.name as hsnCode, itm.critical, itm.category, loc.name as mainLocation,                 
                    itm.material, itm.materialThickness, itm.rmWidth, itm.rmLength, itm.grossWeight, itm.netWeight, itm.scrapWeight, pFinish.name as productFinish, 
                    null AS coatingArea, pFamily.name as productFamily, fim.name as fimId, itm.rmItemCode, itm.reorder, itm.rol, itm.roq,                                 
                    CASE WHEN itm.nonStockable = 1 THEN 'Y' ELSE 'N' END AS nonStockable, ul.name as underLedger, itm.gstCategory, itm.stockControl, itm.jcPart
                FROM items itm
                    LEFT JOIN mst_uom as uom ON itm.uom = uom.id
                    LEFT JOIN mst_item_group as ig ON itm.itemGroup = ig.id
                    LEFT JOIN item_under_ledger as ul ON itm.underLedger = ul.id
                    LEFT JOIN item_hsn_code as hsn ON itm.hsnCode = hsn.id
                    LEFT JOIN item_main_loc as loc ON itm.mainLocation = loc.id
                    LEFT JOIN item_product_finish as pFinish ON itm.productFinish = pFinish.id
                    LEFT JOIN item_product_family as pFamily ON itm.productFamily = pFamily.id
                    LEFT JOIN item_fim_id as fim ON itm.fimId = fim.id
                WHERE itm.id > ?
                ORDER BY itm.id ASC
                LIMIT ?;
            `;
            const [itemRows] = await connection.execute(items, [lastId, chunkSize]);

            if (itemRows.length === 0) {
                hasMore = false;
                break;
            }

            for (const row of itemRows) {
                lastId = row._internalId;
                delete row._internalId;

                // Cast numeric fields to true Numbers so Excel formats them correctly instead of as Strings
                const numericFields = ['stdRate', 'minStockLvl', 'maxLvl', 'grossWeight', 'netWeight', 'scrapWeight', 'rmWidth', 'rmLength', 'rmThickness', 'reorder', 'rol', 'roq'];
                for (const field of numericFields) {
                    if (row[field] !== null && row[field] !== undefined && row[field] !== '') {
                        const parsed = Number(row[field]);
                        if (!isNaN(parsed)) {
                            row[field] = parsed;
                        }
                    }
                }

                const rowData = Object.values(row);
                worksheet.addRow(rowData).commit(); // Flush directly to disk/network without occupying massive memory blocks
            }
        }

        // Close and flush the stream chunks
        worksheet.commit();
        await workbook.commit();

        // NOTE: No res.send(buffer) is required here! Express effectively exits successfully.
    } catch (err) {
        if (!res.headersSent) {
            return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
        } else {
            res.end();
        }
    }
};

exports.import = async (req, res) => {
    try {
        if (!req.body.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
        const base64Data = req.body.file.replace(base64URL, '');

        const buffer = Buffer.from(base64Data, 'base64');

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const rowsPromises = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                const itemPromise = (async () => {
                    try {
                        const item = {
                            rowNo: rowNumber,
                            itemCode: row.getCell(1).text,
                            itemName: row.getCell(2).text,
                            itemGroup: await fetchId('itemGroup', row.getCell(3).text),
                            tallyOrErp: row.getCell(4).text,
                            inActive: row.getCell(5).text == 'Y' ? 1 : 0,
                            uom: await fetchId('uom', row.getCell(6).text),
                            stdRate: row.getCell(7).text,
                            gstCategory: row.getCell(8).text,
                            minStockLvl: row.getCell(9).text,
                            maxLvl: row.getCell(10).text,
                            underLedger: await fetchId('underLedger', row.getCell(11).text),
                            reorder: row.getCell(12).text,
                            rol: row.getCell(13).text,
                            roq: row.getCell(14).text,
                            shelfLifeItem: row.getCell(15).text,
                            hsnCode: await fetchId('hsnCode', row.getCell(16).text),
                            critical: row.getCell(17).text,
                            mainLocation: await fetchId('mainLocation', row.getCell(18).text),
                            subLocation: await fetchId('subLocation', row.getCell(19).text),
                            productFinish: await fetchId('productFinish', row.getCell(20).text),
                            productFamily: await fetchId('productFamily', row.getCell(21).text),
                            category: row.getCell(22).text,
                            fimId: await fetchId('fim', row.getCell(23).text),
                            duty: row.getCell(24).text,
                            grossWeight: row.getCell(25).text,
                            netWeight: row.getCell(26).text,
                            scrapWeight: row.getCell(27).text,
                            rmItemCode: row.getCell(28).text,
                            rmThickness: row.getCell(29).text,
                            rmWidth: row.getCell(30).text,
                            rmLength: row.getCell(31).text,
                            stockControl: row.getCell(32).text,
                            material: row.getCell(33).text,
                            materialThickness: row.getCell(34).text,
                            jcPart: row.getCell(35).text,
                            partType: row.getCell(36).text,
                            sdCode: row.getCell(37).text,
                            delPackageType: row.getCell(38).text,
                            delLotQty: row.getCell(39).text,
                            nonStockable: row.getCell(40).text == 'Y' ? 1 : 0,
                            binNo: row.getCell(41).text,
                            lotWiseItem: row.getCell(42).text,
                            lotType: row.getCell(43).text,
                            MOQ: row.getCell(44).text,
                            INVTOOLSEL: row.getCell(45).text,
                            TOOLID: row.getCell(46).text,
                            ledTime: row.getCell(47).text,
                            STCOND: row.getCell(48).text,
                            RMItemId: row.getCell(49).text,
                        };
                        return item;
                    } catch (error) {
                        // console.error('Error processing row:', error);
                        throw error; // Propagate the error to reject the promise
                    }
                })();

                rowsPromises.push(itemPromise);
            }
        });

        const items = await Promise.all(rowsPromises);

        const existingItemCodes = (await connection.execute(`SELECT itemCode FROM items`))[0].map(row => row.itemCode);

        const insertItems = [];
        const updateItems = [];

        for (const item of items) {
            if (existingItemCodes.includes(item.itemCode)) {
                updateItems.push(item);
            } else {
                insertItems.push(item);
            }
        }

        if (insertItems.length > 0) {
            await insertItemsToDatabase(insertItems);
        }

        if (updateItems.length > 0) {
            await updateItemsInDatabase(updateItems);
        }

        return res.status(200).json({ success: true, message: 'Successfully imported' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};


async function insertItemsToDatabase(items) {
    try {
        if (items.length === 0) return;
        const insertQuery = `
            INSERT INTO items (
                itemCode, itemName, itemGroup, tallyOrErp, inActive, uom, stdRate, gstCategory, minStockLvl, maxLvl, underLedger,
                reorder, rol, roq, shelfLifeItem, hsnCode, critical, mainLocation, subLocation, productFinish, productFamily, category, fimId,
                duty, grossWeight, netWeight, scrapWeight, rmItemCode, rmThickness, rmWidth, rmLength, stockControl, material, materialThickness,
                jcPart, partType, sdCode, delPackageType, delLotQty, nonStockable, binNo, lotWiseItem, lotType, MOQ, INVTOOLSEL, TOOLID, ledTime,
                STCOND, RMItemId
            ) VALUES ?
        `;

        const values = items.map(item => [
            item.itemCode, item.itemName, item.itemGroup, item.tallyOrErp, item.inActive, item.uom, item.stdRate, item.gstCategory,
            item.minStockLvl, item.maxLvl, item.underLedger, item.reorder, item.rol, item.roq, item.shelfLifeItem,
            item.hsnCode, item.critical, item.mainLocation, item.subLocation, item.productFinish, item.productFamily, item.category,
            item.fimId, item.duty, item.grossWeight, item.netWeight, item.scrapWeight, item.rmItemCode, item.rmThickness, item.rmWidth,
            item.rmLength, item.stockControl, item.material, item.materialThickness, item.jcPart, item.partType, item.sdCode,
            item.delPackageType, item.delLotQty, item.nonStockable,
            item.binNo, item.lotWiseItem, item.lotType, item.MOQ, item.INVTOOLSEL, item.TOOLID, item.ledTime, item.STCOND, item.RMItemId
        ]);

        await connection.query(insertQuery, [values]);

        return true;
    } catch (err) {
        throw err;
    }
}


async function updateItemsInDatabase(items) {
    try {
        if (items.length === 0) return;
        const updatePromises = items.map(async (item) => {
            const updateQuery = `
                UPDATE items 
                SET 
                    itemName = ?, itemGroup = ?, tallyOrErp = ?, inActive = ?, uom = ?, stdRate = ?, gstCategory = ?, minStockLvl = ?, maxLvl = ?, underLedger = ?, 
                    reorder = ?, rol = ?, roq = ?, shelfLifeItem = ?, hsnCode = ?, critical = ?, mainLocation = ?, subLocation = ?, productFinish = ?, productFamily = ?, 
                    category = ?, fimId = ?, duty = ?, grossWeight = ?, netWeight = ?, scrapWeight = ?, rmItemCode = ?, rmThickness = ?, rmWidth = ?, rmLength = ?, 
                    stockControl = ?, material = ?, materialThickness = ?, jcPart = ?, partType = ?, sdCode = ?, delPackageType = ?, delLotQty = ?, 
                    nonStockable = ?, binNo = ?, lotWiseItem = ?, lotType = ?, MOQ = ?, INVTOOLSEL = ?, TOOLID = ?, ledTime = ?, STCOND = ?, RMItemId = ? 
                WHERE 
                    itemCode = ?;
            `;

            const values = [
                item.itemName, item.itemGroup, item.tallyOrErp, item.inActive, item.uom, item.stdRate, item.gstCategory,
                item.minStockLvl, item.maxLvl, item.underLedger, item.reorder, item.rol, item.roq, item.shelfLifeItem,
                item.hsnCode, item.critical, item.mainLocation, item.subLocation, item.productFinish, item.productFamily, item.category,
                item.fimId, item.duty, item.grossWeight, item.netWeight, item.scrapWeight, item.rmItemCode, item.rmThickness, item.rmWidth,
                item.rmLength, item.stockControl, item.material, item.materialThickness, item.jcPart, item.partType, item.sdCode,
                item.delPackageType, item.delLotQty, item.nonStockable,
                item.binNo, item.lotWiseItem, item.lotType, item.MOQ, item.INVTOOLSEL, item.TOOLID, item.ledTime, item.STCOND, item.RMItemId,
                item.itemCode
            ];

            await connection.query(updateQuery, values);
        });

        await Promise.all(updatePromises);

        return true;
    } catch (err) {
        throw err;
    }
}


async function fetchId(master, value) {
    try {
        if (!value || value == 'NULL' || value == '-' || value == '' || value == '0' || value == '#N/A') {
            return null;
        }

        const masterInfo = masterCollection[master] || itemCollection[master];
        if (!masterInfo) {
            throw new Error(`Invalid master: ${master}`);
        }

        const { tbName, mstLable } = masterInfo;
        if (!tbName || !mstLable) {
            throw new Error(`Invalid master info for: ${master}`);
        }

        const [rows, fields] = await connection.execute(`SELECT id FROM ${tbName} WHERE name = ?`, [value]);

        if (rows.length > 0) {
            return rows[0].id;
        }

        throw new Error(`Invalid ${mstLable} : ${value}`);
    } catch (error) {
        console.error(`Error fetching ${master}: ${error.message}`);
        throw error;
    }
}



exports.stockTemplate = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item Code', 'MinQty', 'Max Qty']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = ItemStock.xlsx');

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

exports.stockImport = async (req, res) => {
    try {
        if (!req.body.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        /* ---------- Decode Excel ---------- */
        const base64URL =
            "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,";

        const buffer = Buffer.from(
            req.body.file.replace(base64URL, ""),
            "base64"
        );

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const stocks = [];
        const itemCodes = new Set();

        /* ---------- Parse Excel ---------- */
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;

            const itemCode = String(row.getCell(1).value || "").trim();

            if (!itemCode) return;

            stocks.push({
                itemCode,
                minQty: Number(row.getCell(2).value) || 0,
                maxQty: Number(row.getCell(3).value) || 0
            });

            itemCodes.add(itemCode);
        });

        if (stocks.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid rows found in Excel"
            });
        }

        /* ---------- Fetch ALL item IDs in ONE query ---------- */
        const itemMap = await fetchItemIds([...itemCodes]);

        /* ---------- Attach IDs + Validate ---------- */
        for (const stock of stocks) {
            if (!itemMap[stock.itemCode]) {
                throw new CustomError(
                    `Invalid Item Code: ${stock.itemCode}`
                );
            }
            stock.id = itemMap[stock.itemCode].id;
            stock.itemName = itemMap[stock.itemCode].itemName;
        }

        return res.status(200).json({
            success: true,
            message: "Item Stock fetched successfully",
            data: stocks
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Copy from and Copy to
exports.dupTemplate = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Copy To Item', 'Copy From Item']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = Duplicate-template.xlsx');

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

exports.itemImport = async (req, res) => {
    try {
        if (!req.body.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
        const base64Data = req.body.file.replace(base64URL, '');

        const buffer = Buffer.from(base64Data, 'base64');

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const finalItemCodes = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                finalItemCodes.push(row.getCell(1).value.toString());
            }
        });

        // Query to fetch existing item codes
        const [rows] = await connection.execute('SELECT itemCode FROM items');
        const existingItemCodes = rows.map(row => row.itemCode);

        // Find item codes that are not in the existing items table
        const nonExistingItemCodes = finalItemCodes.filter(itemCode => !existingItemCodes.includes(itemCode));

        return res.status(200).json({ success: true, data: nonExistingItemCodes });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.itemRateTemplate = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item Code', 'Item rate']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = ItemRate.xlsx');

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

exports.itemRateImport = async (req, res) => {
    try {
        const buffer = await decodeBase64(req.body.file);

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const items = [];

        for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) { // Start from the second row
            const row = worksheet.getRow(rowNumber);
            const itemCode = row.getCell(1).value;
            const itemRate = row.getCell(2).value;

            if (itemCode && itemRate) {
                const id = await fetchItemId(itemCode);
                items.push({ id, itemCode, itemRate });
            }
        }

        return handleSuccessResponse(res, 'Items', items);
    } catch (err) {
        return handleErrorResponse(res, err)
    }
};

exports.viewBulkCreationItems = async (req, res) => {
    try {
        const buffer = await decodeBase64(req.body.file);
        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const itemsList = [];
        const newItemSet = new Set();
        const existingItemSet = new Set();
        const seenPairs = new Set();

        // Read rows, build sets, detect duplicates/empty rows
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header

            const id = rowNumber - 1;
            const newItem = (row.getCell(1).text || '').toString().trim();
            const existingItem = (row.getCell(2).text || '').toString().trim();

            // If both empty, flag and continue
            if (!newItem && !existingItem) {
                itemsList.push({ id, copyToItem: newItem, copyFromItem: existingItem, error: 'Empty row' });
                return;
            }

            const key = `${newItem}|${existingItem}`;
            if (seenPairs.has(key)) {
                itemsList.push({ id, copyToItem: newItem, copyFromItem: existingItem, error: 'Duplicate row in file' });
                return;
            }
            seenPairs.add(key);

            itemsList.push({ id, copyToItem: newItem, copyFromItem: existingItem, error: '' });

            if (newItem) newItemSet.add(newItem);
            if (existingItem) existingItemSet.add(existingItem);
        });

        // Helper: chunk an array into pieces (to avoid too many placeholders)
        const chunkArray = (arr, size) => {
            const res = [];
            for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
            return res;
        };

        // Fetch existing itemCodes from DB for the combined set (single query, chunked)
        const fetchItemsDetails = async (itemsSet) => {
            if (!itemsSet || itemsSet.size === 0) return new Set();
            const itemCodes = Array.from(itemsSet);
            const resultSet = new Set();

            // chunk size conservative (adjust if you know DB limit)
            const CHUNK_SIZE = 800;
            const chunks = chunkArray(itemCodes, CHUNK_SIZE);
            for (const part of chunks) {
                const placeholders = part.map(() => '?').join(',');
                const sql = `SELECT itemCode FROM items WHERE itemCode IN (${placeholders})`;
                const [rows] = await connection.execute(sql, part);
                rows.forEach(r => resultSet.add(r.itemCode));
            }
            return resultSet;
        };

        // Merge both sets and query once
        const allItemsSet = new Set([...newItemSet, ...existingItemSet]);
        const existingInDb = await fetchItemsDetails(allItemsSet);

        // Validate each row and collect errors (multiple possible)
        itemsList.forEach(item => {
            const errors = [];

            if (!item.copyFromItem) {
                errors.push('Missing Copy From Item');
            } else if (!existingInDb.has(item.copyFromItem)) {
                errors.push('Copy From Item details not found');
            }

            if (!item.copyToItem) {
                errors.push('Missing Copy To Item');
            } else if (existingInDb.has(item.copyToItem)) {
                errors.push('Copy To ItemCode already exists');
            }

            if (item.copyFromItem && item.copyToItem && item.copyFromItem === item.copyToItem) {
                errors.push('Copy To and Copy From cannot be the same');
            }

            // If no errors collected, keep empty string (matching your original structure)
            item.error = errors.length ? errors.join('; ') : '';
        });

        return handleSuccessResponse(res, 'Successfully fetched items', itemsList);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.storeBulkCreationItems = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('No items to import');
        }
        const user = await getUser(req);

        // Create a mapping for multiple `copyToItem` per `copyFromItem`
        const copyFromMap = new Map();
        items.forEach(({ copyFromItem, copyToItem }) => {
            if (!copyFromMap.has(copyFromItem)) {
                copyFromMap.set(copyFromItem, []);
            }
            copyFromMap.get(copyFromItem).push(copyToItem);
        });

        const itemCodes = [...copyFromMap.keys()];

        const [rows] = await conn.execute(
            `SELECT itemCode, itemName, itemGroup, inActive, uom, stdRate, gstCategory, minStockLvl, maxLvl, underLedger, reorder, rol, roq, shelfLifeItem, 
                hsnCode, critical, mainLocation, productFinish, productFamily, category, fimId, grossWeight, netWeight, scrapWeight, rmItemCode, rmThickness, 
               rmWidth, rmLength, stockControl, material, materialThickness, jcPart, nonStockable 
            FROM items 
            WHERE itemCode IN (${itemCodes.map(() => '?').join(',')})`,
            itemCodes
        );

        const foundItemCodes = new Set(rows.map(row => row.itemCode));
        const missingItems = itemCodes.filter(code => !foundItemCodes.has(code));

        if (missingItems.length > 0) {
            throw new Error(`Some items not found in the database: ${missingItems.join(', ')}`);
        }

        const newItems = [];
        rows.forEach(row => {
            copyFromMap.get(row.itemCode).forEach(copyToItem => {
                newItems.push({
                    ...row,
                    itemCode: copyToItem
                });
            });
        });

        await bulkCreationItems(conn, newItems, user);

        await incCacheVersion();

        await conn.commit();
        return handleSuccessResponse(res, 'Items imported successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

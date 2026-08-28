const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../../config/dbSql');
const excel = require('exceljs');
const { decodeBase64 } = require('../../utility/utilityFunction');
const { parse, format } = require('date-fns'); // Import parse and format functions


exports.poTemplate = async (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item Code', 'Qty', 'Sch Date']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.font = { size: 13 };
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = Po Generation.xlsx');

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





exports.poBillTemplate = async (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item Code', 'Qty']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.font = { size: 13 };
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = Po Generation.xlsx');

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


exports.poImport = async (req, res) => {
    try {
        const { supplierId, file, type } = req.body;
        const buffer = await decodeBase64(file);
        const workbook = new excel.Workbook();

        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        const items = [];
        // worksheet.eachRow((row, rowNumber) => {
        //     if (rowNumber > 1) {
        //         items.push({
        //             itemCode: row.getCell(1).value,
        //             qty: row.getCell(2).value,
        //             schDate: row.getCell(3).value 
        //         });
        //     }
        // });
        worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
            const schDateValue = row.getCell(3).value;

            if (!schDateValue) {
                return res.status(400).json({
                    success: false,
                    message: `schDate is required at row ${rowNumber}`
                });
            }

            items.push({
                itemCode: row.getCell(1).value,
                qty: row.getCell(2).value,
                schDate: schDateValue
            });
        }
        });


        // Check for duplicate itemCode + schDate combinations
        const seenKeys = new Set();
        const duplicateKeys = [];

        items.forEach(({ itemCode, schDate }) => {
            let rawDate = typeof schDate === 'string' ? schDate.trim() : schDate;
            let key = `${itemCode} | ${rawDate}`;

            if (seenKeys.has(key)) {
                duplicateKeys.push(key);
            } else {
                seenKeys.add(key);
            }
        });

        if (duplicateKeys.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Duplicate itemCode & schDate entries found: ${duplicateKeys.join(', ')}`
            });
        }

        // // Prepare item codes (case-insensitive match)
        // const cleanItemCodes = items
        //     .map(item => item.itemCode?.trim())
        //     .filter(Boolean);

        const cleanItemCodes = items
            .map(item => {
                if (item.itemCode === undefined || item.itemCode === null) return null;
                return String(item.itemCode).trim(); // Always convert to string
            })
            .filter(code => code !== null && code !== ''); // Remove empty


        const placeholders = cleanItemCodes.map(() => '?').join(',');

        let fetchQuery;
        let queryParams;

        // if (type === 'J') {
        //     fetchQuery = `
        //         SELECT 
        //             jid.id, jid.id as jobWorkId, si.rate, sup.spCode, sup.spName AS suppName, sup.id AS supId,
        //             CONCAT_WS(' ', sup.spAdd1, sup.spAdd2, sup.spAdd3, sup.spAdd4) AS spAddress, sup.paymentTerms, sup.gstNo, 
        //             supCon.department, cur.name AS currency, cur.id AS currencyId, itm.itemName AS itemName, itm.id AS itemId, 
        //             itm.minStockLvl, itm.maxLvl, itm.itemCode, itm.totStk, jid.Qty as jwQty, itm.poQty AS pendingPo, uomTab.name AS uom, 
        //             uomTab.id AS uomId, jid.Qty as poQty, COALESCE(si.suppDesc, itm.itemName) AS suppDesc
        //         FROM jobwork_issue jw
        //         INNER JOIN jobwork_issue_details jid ON jid.jobWorkId = jw.id
        //         LEFT JOIN supp_vs_item si ON jid.itemId = si.itemName AND jw.supplierId = si.spName
        //         INNER JOIN supplier AS sup ON jw.supplierId = sup.id
        //         LEFT JOIN sup_con_person AS supCon ON sup.sId = supCon.sId
        //         LEFT JOIN mst_currency AS cur ON sup.currency = cur.id
        //         INNER JOIN items AS itm ON jid.itemId = itm.id
        //         LEFT JOIN mst_uom AS uomTab ON itm.uom = uomTab.id
        //         WHERE jid.dc_close = 0 AND itm.itemCode IN (${placeholders})
        //     `;
        //     queryParams = [...cleanItemCodes];

            //  fetchQuery = `
            //     SELECT 
            //         jid.id, jid.id as jobWorkId, COALESCE(NULLIF(supp_vs_item.suppDesc, ''), itm.itemName) AS suppDesc,
            //         supp_vs_item.rate, sup.spCode, sup.spName AS suppName, sup.id AS supId,
            //         CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress, sup.paymentTerms, sup.gstNo, 
            //         supCon.department, cur.name AS currency, cur.id AS currencyId, itm.itemName AS itemName, itm.id AS itemId, 
            //         itm.minStockLvl, itm.maxLvl, itm.itemCode, itm.totStk, itm.poQty AS pendingPo, jid.Qty as jwQty, uomTab.name AS uom, 
            //         uomTab.id AS uomId
            //     FROM supp_vs_item
            //     INNER JOIN supplier AS sup ON supp_vs_item.spName = sup.id
            //     LEFT JOIN sup_con_person AS supCon ON sup.sId = supCon.sId
            //     INNER JOIN mst_currency AS cur ON sup.currency = cur.id
            //     INNER JOIN items AS itm ON supp_vs_item.itemName = itm.id
            //     INNER JOIN mst_uom AS uomTab ON itm.uom = uomTab.id
            //     INNER JOIN jobwork_issue_details AS jid ON jid.itemId = itm.id
            //     WHERE supp_vs_item.dflag = 0 
            //     AND jid.dc_close = 0 
            //     AND itm.itemCode COLLATE utf8mb4_general_ci IN (${placeholders})
            // `;
            // queryParams = [...cleanItemCodes];


            
        // } else {
            fetchQuery = `
                SELECT supp_vs_item.id, supp_vs_item.rate,
                    COALESCE(supp_vs_item.suppDesc, itm.itemName) AS suppDesc,
                    sup.spCode, sup.spName AS suppName, sup.id AS supId, 
                    CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,
                    sup.paymentTerms, sup.gstNo, supCon.department, cur.name as currency, cur.id as currencyId,
                    itm.itemName, itm.id AS itemId, itm.minStockLvl, itm.maxLvl, itm.poQty AS pendingPo,
                    itm.itemCode, itm.totStk, itm.jwQty,
                    uomTab.name as uom, uomTab.id AS uomId
                FROM supp_vs_item
                INNER JOIN supplier as sup ON supp_vs_item.spName = sup.id
                LEFT JOIN sup_con_person as supCon ON sup.sId = supCon.sId
                LEFT JOIN mst_currency as cur ON sup.currency = cur.id
                INNER JOIN items as itm ON supp_vs_item.itemName = itm.id
                LEFT JOIN mst_uom as uomTab ON itm.uom = uomTab.id
                WHERE supp_vs_item.dflag = 0 
                AND sup.id = ? 
                AND itm.itemCode COLLATE utf8mb4_general_ci IN (${placeholders})
            `;
            queryParams = [supplierId, ...cleanItemCodes];
        // }

        const [rows] = await connection.execute(fetchQuery, queryParams);

        const result = [];
        const missingItemCodes = [];

        // Step 1: Fetch latest po_generate id
        const [lastPoRows] = await connection.execute(`SELECT MAX(id) AS lastId FROM po_generate`);
        let nextId = (lastPoRows[0].lastId || 0) + 1;

        // Step 2: Process each matched item and assign uniqueFId
        items.forEach(item => {
            // const matchingRow = rows.find(row =>
            //     String(row.itemCode).trim().toLowerCase() === String(item.itemCode).trim().toLowerCase()
            // );

            const matchingRow = rows.find(row =>
                String(row.itemCode).trim().toLowerCase() === String(item.itemCode).trim().toLowerCase()
            );


            if (matchingRow) {
                let formattedSchDate = null;

                if (item.schDate) {
                    try {
                        if (typeof item.schDate === 'object' && item.schDate instanceof Date) {
                            formattedSchDate = format(item.schDate, 'yyyy-MM-dd');
                        } else if (typeof item.schDate === 'number') {
                            const parsedDate = new Date(Date.UTC(0, 0, item.schDate - 1));
                            formattedSchDate = format(parsedDate, 'yyyy-MM-dd');
                        } else if (typeof item.schDate === 'string') {
                            const parsedDate = parse(item.schDate, 'd/M/yyyy', new Date());
                            formattedSchDate = format(parsedDate, 'yyyy-MM-dd');
                        } else {
                            throw new Error(`Unrecognized date format: ${item.schDate}`);
                        }

                        item.schDate = formattedSchDate;
                    } catch (err) {
                        missingItemCodes.push(`Invalid date format for schDate: ${item.schDate}`);
                        return;
                    }
                }

                result.push({
                    ...matchingRow,
                    poQty: item.qty,
                    schDate: formattedSchDate,
                    amt: parseFloat((item.qty * matchingRow.rate).toFixed(2)),
                    pendingPo: matchingRow.pendingPo ?? 0,
                    uniqueFId: nextId++
                });
            } else {
                missingItemCodes.push(String(item.itemCode));
            }
        });

        return handleSuccessResponse(
            res,
            missingItemCodes.length > 0
                ? `Not linked Items: ${missingItemCodes.join(', ')}`
                : 'All items processed successfully',
            result
        );

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};




// exports.poBillImport = async (req, res) => {
//     try {
//         const { supplierId, file } = req.body;
//         const buffer = await decodeBase64(file);
//         const workbook = new excel.Workbook();

//         await workbook.xlsx.load(buffer);
//         const worksheet = workbook.getWorksheet(1);

//         // Step 1: Parse Excel into Map with key: itemCode|poNo|schDate
//         const itemQtyMap = new Map();
//         const itemKeysSet = new Set();

//         worksheet.eachRow((row, rowNumber) => {
//             if (rowNumber > 1) {
//                 const itemCode = row.getCell(1).text?.trim() || '';
//                 const qtyCell = row.getCell(2).value;
//                 const poNo = row.getCell(3).text?.trim() || row.getCell(3).value;
//                 const rawDate = row.getCell(4).text?.trim() || '';

//                 // Convert date from dd/mm/yyyy to yyyy-mm-dd
//                 let schDate = '';
//                 if (rawDate.includes('/')) {
//                     const [dd, mm, yyyy] = rawDate.split('/');
//                     schDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
//                 }

//                 const qty = typeof qtyCell === 'object' && qtyCell?.result !== undefined
//                     ? Number(qtyCell.result)
//                     : Number(qtyCell) || 0;

//                 if (itemCode && poNo && schDate) {
//                     const key = `${itemCode}|${poNo}|${schDate}`;
//                     itemQtyMap.set(key, qty);
//                     itemKeysSet.add(`('${itemCode}', '${poNo}', '${schDate}')`);
//                 }
//             }
//         });

//         // Step 2: Build SQL IN condition
//         const itemConditions = [...itemKeysSet].join(',');

//         // Step 3: Update SQL to include po.schDate
//         const fetch = `
//             SELECT 
//                 po.id, po.poNo, po.poNo AS mainPoNo, po.digit AS poOrdDigit,
//                 DATE_FORMAT(po.date, '%d-%m-%Y') AS date,
//                 DATE_FORMAT(po.schDate, '%Y-%m-%d') AS schDate,
//                 po_main.id AS poMainId,
//                 po.poQty, po.pendingPo AS accQty, po.pendingPo AS rcvdQty, po.pendingPo,
//                 po.pendingPo AS invQty, po.cumQty, 0 AS rejQty,
//                 po.totalQty, po.grossAmount, po.rate AS pbRate, po.freightType,
//                 po.poQty * po.rate AS pbAmt, po.suppDesc, po.id AS poDtlId,
//                 sup.spCode, sup.spName AS suppName, sup.id AS supId, 
//                 CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,              
//                 sup.paymentTerms, sup.gstNo, sup.state, sup.country, supCon.department, 
//                 cur.name AS currency, cur.id AS currencyId,
//                 itm.itemName AS itemName, itm.id AS itemId, itm.minStockLvl, itm.maxLvl,
//                 itm.itemCode, itm.totStk, itm.shelfLifeItem, 0 AS jcId, 0 AS processId,
//                 hsn.name AS hsn, hsn.id AS hsnId,
//                 uomTab.name AS uom, uomTab.id AS uomId, ledj.name AS itmLedger, ledj.id AS itmLedgerId,
//                 loc.name AS location, loc.id AS locationId,
//                 itmGrp.name AS itemGroup, itmGrp.id AS itemGroupId 
//             FROM po_generate po
//                 INNER JOIN po_main ON po.digit = po_main.digit AND po.type = po_main.type
//                 INNER JOIN supplier AS sup ON po.spName = sup.id
//                 LEFT JOIN sup_con_person AS supCon ON sup.sId = supCon.sId
//                 INNER JOIN mst_currency AS cur ON sup.currency = cur.id
//                 INNER JOIN items AS itm ON po.itemName = itm.id
//                 INNER JOIN mst_uom AS uomTab ON itm.uom = uomTab.id
//                 LEFT JOIN item_under_ledger AS ledj ON itm.underLedger = ledj.id
//                 LEFT JOIN item_main_loc AS loc ON itm.mainLocation = loc.id
//                 LEFT JOIN mst_item_group AS itmGrp ON itm.itemGroup = itmGrp.id
//                 LEFT JOIN item_hsn_code AS hsn ON itm.hsnCode = hsn.id
//             WHERE po_main.authorized = 1 AND po_main.type = 'R' AND po_main.dflag = 0 
//               AND po.pendingPo != 0 AND po.dflag = 0 
//               AND (itm.itemCode, po.poNo, DATE_FORMAT(po.schDate, '%Y-%m-%d')) IN (${itemConditions})
//         `;

//         // Step 4: Execute query
//         const [rows] = await connection.execute(fetch);

//         // Step 5: Override Excel quantity and calculate values
//         rows.forEach(row => {
//             const key = `${row.itemCode}|${row.poNo}|${row.schDate}`;
//             const qtyFromExcel = itemQtyMap.get(key) || 0;
//             row.accQty = qtyFromExcel;
//             row.rcvdQty = qtyFromExcel;
//             row.invQty = qtyFromExcel;
//             row.pbAmt = qtyFromExcel * row.pbRate;
//         });

//         // Step 6: Validate unmatched records
//         const fetchedKeys = new Set(
//             rows.map(row => `${row.itemCode}|${row.poNo}|${row.schDate}`)
//         );

//         itemQtyMap.forEach((qty, key) => {
//             if (!fetchedKeys.has(key)) {
//                 const [itemCode, poNo, schDate] = key.split('|');
//                 throw new CustomError(`PO ${poNo} with Schedule Date ${schDate} not found for ItemCode: ${itemCode}`);
//             }
//         });

//         return handleSuccessResponse(res, 'Items list', rows);
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };




exports.poBillImport = async (req, res) => {
    try {
        const { supplierId, file } = req.body;
        const buffer = await decodeBase64(file);
        const workbook = new excel.Workbook();

        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        // Step 1: Parse Excel rows into (itemCode) → qty map
        const itemQtyMap = new Map(); // key: itemCode → qty
        const itemKeysSet = new Set(); // for SQL IN condition

        const normalizeCode = (code) => code?.toUpperCase().trim();

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                // const itemCode = row.getCell(1).text.trim();
                const rawCode = row.getCell(1).text;
                const itemCode = normalizeCode(rawCode);
                const qtyCell = row.getCell(2).value;

                const qty = typeof qtyCell === 'object' && qtyCell?.result !== undefined
                    ? Number(qtyCell.result)
                    : Number(qtyCell) || 0;

                itemQtyMap.set(itemCode, qty);
                itemKeysSet.add(`('${itemCode}', '${supplierId}')`);
            }
        });

        // Step 2: Construct IN clause for (itemCode, supplierId)
        const itemConditions = [...itemKeysSet].join(',');

        // Step 3: Build SQL query with FIFO ordering
        const fetch = `
            SELECT 
                po.id, po.poNo, po.poNo AS mainPoNo, po.digit AS poOrdDigit, DATE_FORMAT(po.date, '%d-%m-%Y') AS date, po_main.id AS poMainId,
                po.poQty, po.pendingPo AS accQty, po.pendingPo AS rcvdQty, po.pendingPo, po.pendingPo AS invQty, po.cumQty,
                po.schDate, 0 AS rejQty, po.totalQty, po.grossAmount, po.rate AS pbRate, po.freightType,
                ROUND(po.pendingPo * po.rate, 2) AS pbAmt, po.suppDesc, po.id AS poDtlId,
                sup.spCode, sup.spName AS suppName, sup.id AS supId, 
                CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,              
                sup.paymentTerms, sup.gstNo, sup.state, sup.country, supCon.department, 
                cur.name AS currency, cur.id AS currencyId,
                itm.itemName AS itemName, itm.id AS itemId, itm.minStockLvl, itm.maxLvl, itm.itemCode, itm.totStk,
                itm.shelfLifeItem, 0 AS jcId, 0 AS processId, hsn.name AS hsn, hsn.id AS hsnId,
                uomTab.name AS uom, uomTab.id AS uomId, ledj.name AS itmLedger, ledj.id AS itmLedgerId,
                loc.name AS location, loc.id AS locationId, itmGrp.name AS itemGroup, itmGrp.id AS itemGroupId 
            FROM po_generate po
                INNER JOIN po_main ON po.digit = po_main.digit AND po.type = po_main.type
                INNER JOIN supplier AS sup ON po.spName = sup.id
                LEFT JOIN sup_con_person AS supCon ON sup.sId = supCon.sId
                INNER JOIN mst_currency AS cur ON sup.currency = cur.id
                INNER JOIN items AS itm ON po.itemName = itm.id
                INNER JOIN mst_uom AS uomTab ON itm.uom = uomTab.id
                LEFT JOIN item_under_ledger AS ledj ON itm.underLedger = ledj.id
                LEFT JOIN item_main_loc AS loc ON itm.mainLocation = loc.id
                LEFT JOIN mst_item_group AS itmGrp ON itm.itemGroup = itmGrp.id
                LEFT JOIN item_hsn_code AS hsn ON itm.hsnCode = hsn.id
            WHERE po_main.authorized = 1 AND po_main.type = 'R' AND po_main.dflag = 0 
              AND po.pendingPo != 0 AND po.dflag = 0 AND (UPPER(itm.itemCode), sup.id) IN (${itemConditions})
            ORDER BY itm.itemCode, sup.id, po.schDate ASC
        `;

        // (itm.itemCode, sup.id) IN (${itemConditions})
        // Step 4: Execute SQL query
        const [rows] = await connection.execute(fetch);

        // Step 5: Group rows by itemCode|supplierId for FIFO processing
        const grouped = {};
        rows.forEach(row => {
            const key = `${row.itemCode}|${row.supId}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(row);
        });

        // Step 6: Apply FIFO logic
        const finalRows = [];

        for (const [itemCode, requiredQty] of itemQtyMap.entries()) {
            const groupKey = `${itemCode}|${supplierId}`;
            const fifoRows = grouped[groupKey] || [];

            let remainingQty = requiredQty;
            let totalAvailable = 0;

            // //console.log(requiredQty)
            for (const row of fifoRows) {
                const available = Number(row.pendingPo);
                if (remainingQty <= 0) break;

                const usedQty = Math.min(remainingQty, available);
                row.accQty = usedQty;
                row.rcvdQty = usedQty;
                row.invQty = usedQty;
                row.pbAmt = parseFloat((usedQty * row.pbRate).toFixed(2));

                finalRows.push(row);

                remainingQty -= usedQty;
                totalAvailable += available;
            }

            if (remainingQty > 0) {
                throw new CustomError(`Insufficient Pending PO Qty for ItemCode "${itemCode}". Required: ${requiredQty}, Available: ${totalAvailable}`);
            }
        }

        return handleSuccessResponse(res, 'Items list', finalRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};




// Purchase Bill WithoutPo 
exports.purBillWithoutPo = async (req, res) => {
    try {
        const { file } = req.body;

        const buffer = await decodeBase64(file);
        const workbook = new excel.Workbook();

        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1); // Assuming data is in the first worksheet

        const items = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                items.push(row.getCell(1).text);
            }
        });

        // Construct a comma-separated string of item codes
        const itemCodes = items.map(item => `'${item}'`).join(',');

        const fetchQuery = `
            SELECT items.id, items.itemCode as label, items.itemName, items.id as itemId,
                items.minStockLvl, items.maxLvl, items.itemCode, items.totStk,
                uomTab.name as uom, uomTab.id AS uomId, ledj.name as itemsLedger, ledj.id AS itemsLedgerId,
                loc.name as location, loc.id AS locationId, itemsGrp.name as itemGroup, itemsGrp.id AS itemGroupId
            FROM items
                INNER JOIN mst_uom as uomTab ON items.uom = uomTab.id
                INNER JOIN item_under_ledger as ledj ON items.underLedger = ledj.id
                INNER JOIN item_main_loc as loc ON items.mainLocation = loc.id
                INNER JOIN mst_item_group as itemsGrp ON items.itemGroup = itemsGrp.id
            WHERE items.dflag = 0 AND items.itemCode IN (${itemCodes})
        `;

        // Execute the query
        const [rows] = await connection.execute(fetchQuery, []);

        items.forEach(itemCode => {
            const matchingRow = rows.find(row => row.itemCode === itemCode);
            if (!matchingRow) {
                throw new CustomError(`ItemCode: ${itemCode} not found!`, 404);
            }
        });

        return handleSuccessResponse(res, 'Items list', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


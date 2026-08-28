const { getUser, company } = require('../utility/utilityFunction');
const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { generateDocNo, updateDocCounter, formatFinancialYears } = require('../utility/docNo');

exports.uniqueId = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { po: customValue } = req.body;

        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'PurchaseBill', customValue });

        await conn.commit();
        return res.status(200).json({
            id: uniqueNo,
            digit: padStartNo
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

//Get ALL Supplier List
exports.searchSup = async (req, res) => {
    try {
        const { q } = req.query;

        let fetch = `
            SELECT  
                supplier.id, supplier.spCode as label, supplier.spCode,
                 CONCAT(supplier.spAdd1, ' ', supplier.spAdd2, ' ', supplier.spAdd3, ' ', supplier.spAdd4) AS spAddress,
                supplier.country,  supplier.state, cur.name as currency, cur.id as currencyId, supplier.panNo, supplier.gstNo, 
                supplier.distance, supplier.shippingPinCode, supplier.toStateCode, supplier.actToState
            FROM supplier
               LEFT JOIN mst_currency as cur ON supplier.currency = cur.id
            WHERE supplier.dflag = 0
        `;

        const values = [];

        // if (q) {
        //     fetch += ` AND supplier.spCode LIKE ?`;
        //     values.push(`%${q}%`);
        // }
        if (q) {
            fetch += ` AND supplier.spCode LIKE ?`;
            values.push(`%${q}%`);
        }

        fetch += ` LIMIT 20`;

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "SupplierList", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}



//Get ALL Item List
exports.searchItm = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;

        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT 
                i.id, i.itemCode as label, i.itemName, i.id as itemId, i.minStockLvl, i.maxLvl, i.itemCode, i.shelfLifeItem, i.conversionConcept, i.conversionPart,
                i.conversionPartId, i.netWeight, i.totStk, i.stdRate AS pbRate, ''  As rate, uomTab.name as uom, uomTab.id AS uomId, 
                ledj.name as iLedger, ipf.name AS productFamily, ipfi.name AS productFinish, ledj.id AS iLedgerId, loc.name as location, 
                loc.id AS locationId, itemGroup.name as itemGroup, itemGroup.id AS itemGroupId     

            FROM items i
                INNER JOIN mst_uom as uomTab ON i.uom = uomTab.id
                INNER JOIN item_under_ledger as ledj ON i.underLedger = ledj.id
                LEFT JOIN item_main_loc as loc ON i.mainLocation = loc.id
                LEFT JOIN mst_item_group as itemGroup ON i.itemGroup = itemGroup.id
                LEFT JOIN item_product_family as ipf ON i.productFamily = ipf.id
                LEFT JOIN item_product_finish as ipfi ON i.productFinish = ipfi.id

            WHERE i.dflag = 0
        `;

        const values = [];

        // If there's a search query, add a condition to filter i based on the search query
        if (q) {
            fetch += ` AND (i.itemCode LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match any occurrence of the substring within the item code
        }

        fetch += ` LIMIT 50`; // Add LIMIT clause to retrieve only the first 10 records

        const [rows, fields] = await connection.execute(fetch, values);

        //Used in frontend field
        rows.forEach((row, index) => {
            row.lotQtyData = []
        });

        return res.status(200).json({ success: true, message: "ItemLists", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}




// Get Items based on Supplier (Currently not used)
exports.getItems = async (req, res) => {
    let conn;
    try {
        const id = req.params.id;

        conn = await connection.getConnection();

        const fetch = `
            SELECT 
                i.id, i.itemCode, i.itemName, i.minStockLvl, i.maxLvl, i.totStk,
                uom.name AS uom, uom.id AS uomId, ledj.name AS itemsLedger, ledj.id AS itemsLedgerId,
                loc.name AS location, loc.id AS locationId, grp.name AS itemGroup, grp.id AS itemGroupId
            FROM items i
                INNER JOIN mst_uom uom ON i.uom = uom.id
                INNER JOIN item_under_ledger ledj ON i.underLedger = ledj.id
                INNER JOIN item_main_loc loc ON i.mainLocation = loc.id
                INNER JOIN mst_item_group grp ON i.itemGroup = grp.id
                WHERE i.dflag = 0 AND i.id = ?
        `;

        const [results] = await conn.query(fetch, [id]);

        return handleSuccessResponse(
            res,
            "Item list",
            results
        );

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};



exports.grn = async (req, res) => {
    try {
        const [fRows] = await connection.execute('SELECT grnRefNO FROM pob_wo_po ORDER BY id DESC', []);
        let grn = '0001'; // Default fileId if no records exist

        if (fRows.length > 0) {
            const lastFileId = fRows[0].grnRefNO;
            const numericPart = (lastFileId && lastFileId.match(/\d+/)) ? parseInt(lastFileId.match(/\d+/)[0]) : 0;
            // Increment the numeric part
            grn = (numericPart + 1).toString().padStart(4, '0'); // Pad the incremented number to ensure it's always 4 digits long
        }

        return res.status(200).json({
            grnRefNO: grn
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


exports.store = async (req, res) => {
    // await connection.beginTransaction(); // Start transaction
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const poBillArray = req.body;
        let user = req.headers.username;

        if (!Array.isArray(poBillArray) || poBillArray.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid or empty data provided' });
        }


        // Check for duplicate suppInvNo **before processing anything**
        const po = poBillArray[0]; // Assuming all entries share the same suppInvNo
        const checkInv = `SELECT suppInvNo FROM pob_wo_po WHERE dflag = 0 AND supId = ? AND suppInvNo = ?`;
        const [rows] = await conn.query(checkInv, [po.supId, po.suppInvNo]);
        
        if (rows.length > 0) {
            throw new CustomError("Duplicate suppInvNo cannot be added!");
        }

        const uniqueDigits = new Map(); // To store digit -> pob_wo_po.id mapping

        for (const po of poBillArray) {
            let poId; // Store pob_wo_po.id

            const exgRate = po.exgRate === "" || po.exgRate === null || po.exgRate === undefined ? 1 : Number(po.exgRate);

            // Insert into pob_wo_po only once per unique digit
            if (!uniqueDigits.has(po.digit)) {
                const [result] = await conn.query(`
                INSERT INTO pob_wo_po (
                    type, digit, poNo, date, supId, spAddress, grnRefNO, suppInvNo, suppInvoiceDate, csSuppDcNo, accountable, suppDcRate, irNo, carNo, binNo, boeNo, boeDate, packingListNo,
                    packingDate, insurance, insurancePer, exgRate, bcd, bcdPer, miscCharges, subTotalGrsAndMisc, freight, subTotalINSAndFreight, socialWelfareCharges, swcPer, 
                    subTotalSwAndBCD, importGST,  freightCharges, localClearanceCharges, currency, gstType, remarks, qcAuthorize, qcAuthorizeBy, 
                    qcAuthorizeDate, qcRemarks, totalQty, grossAmount, lessDiscount, transport, coolie, subTotal, cgst, cgstPer, sgst, sgstPer, utgst, utgstPer,
                    total, tds, tdsPer, tcs, tcsPer, igst, igstPer, others, grandTotal, user
                    ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                    )
                                    
                `,
                    [
                        po.poNo, po.digit, po.digitString, po.date, po.supId, po.spAddress, po.grnRefNO, po.suppInvNo, po.suppInvoiceDate, po.csSuppDcNo, po.accountable, po.suppDcRate, po.irNo, po.carNo,  
                        po.binNo, po.boeNo, po.boeDate,  po.packingListNo, po.packingDate, po.insurance, po.insurancePer, exgRate, po.bcd, po.bcdPer, po.miscCharges, po.subTotalGrsAndMisc,
                        po.freight, po.subTotalINSAndFreight, po.socialWelfareCharges, po.swcPer, po.subTotalSwAndBCD, po.importGST, po.freightCharges, po.localClearanceCharges,
                        po.currency, po.gstType, po.remarks, po.qcAuthorize, po.qcAuthorizeBy, po.qcAuthorizeDate,
                        po.qcRemarks, po.totalQty, po.grossAmount, po.lessDiscount, po.transport, po.coolie, po.subTotal,
                        po.cgst, po.cgstPer, po.sgst, po.sgstPer, po.utgst, po.utgstPer, po.total, po.tds, po.tdsPer,
                        po.tcs, po.tcsPer, po.igst, po.igstPer, po.others, po.grandTotal, user
                    ]
                );

                poId = result.insertId; // Get the inserted ID
                uniqueDigits.set(po.digit, poId);
            } else {
                poId = uniqueDigits.get(po.digit);
            }

            const conversionRate = (po.conversionPart != null && po.conversionQty > 0) ? Number(po.pbAmt) / Number(po.conversionQty) : null;

            // Insert into pob_wo_po_dtl
            await conn.query(`
                INSERT INTO pob_wo_po_dtl (
                    poId, type, digit, poNo, date, supId, spAddress, itemId, itemCode, itemName, uom, qoh, totStk, cumQty, maxQtyLvl, schDate, poQty, invQty, rcvdQty, accQty, rejQty,
                    totalQty, grossAmount, pbRate, pbAmt, lot, itemsLedger, itemRemarks, lndCost, lndRate, conversionPart, conversionPartId, conversionQty, conversionRate
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    poId, po.poNo, po.digit, po.digitString, po.date, po.supId, po.spAddress, po.itemId, po.itemCode, po.itemName, po.uom,  po.qoh, po.totStk, po.cumQty, po.maxQtyLvl, 
                    po.schDate, po.poQty, po.invQty, po.rcvdQty, po.accQty, po.rejQty, po.totalQty, po.grossAmount, po.pbRate, po.pbAmt, po.lot, po.itemsLedger,
                    po.itemRemarks, po.lndCost, po.lndRate,  po.conversionPart ?? null, po.conversionPartId ?? null, po.conversionQty ?? null, conversionRate
                ]
            );

            // Insert into pob_wo_po_lot if lotQtyData exists
            if (po.lotQtyData && po.lotQtyData.length > 0) {
                for (const lot of po.lotQtyData) {
                    await conn.query(`
                        INSERT INTO pob_wo_po_lot (
                            poId, digit, type, itemId, location, lotNo, lotDate, duration, expiry, lotQty, remarks
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            poId, po.digit, po.poNo, po.itemId, lot.location, lot.lotNo, lot.lotDate, lot.duration, lot.expiry,
                            lot.lotQty, lot.lotQty, lot.remarks
                        ]
                    );
                }
            }
        }

        await conn.commit(); // Commit transaction
        // await updateDocCounter(conn, 'PurchaseBill');
        await updateDocCounter(conn, 'PurchaseBill', { docNo: poBillArray[0].digitString, type: poBillArray[0].poNo });
        return res.status(200).json({ success: true, message: 'Data added successfully' });

    } catch (err) {
        console.error('Error in store function:', err);
        // await conn.rollback(); // Rollback transaction on error
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    } finally {
        conn.release(); // Release conn
    }
};


exports.update = async (req, res) => {
    try {
        const poArray = req.body;
        const user = await getUser(req);

        const updateDetailQuery = `
            UPDATE pob_wo_po_dtl SET 
                qoh = ?, totStk = ?, cumQty = ?, maxQtyLvl = ?, schDate = ?, poQty = ?, invQty = ?, rcvdQty = ?, accQty = ?, rejQty = ?, totalQty = ?, grossAmount = ?, pbRate = ?,
                pbAmt = ?, lot = ?, itemsLedger = ?, itemRemarks = ?, lndCost = ?, lndRate = ?, conversionPart = ?, conversionPartId = ?, conversionQty = ?, conversionRate = ?
            WHERE poNo = ?  AND id = ?
        `;

        const updateMainQuery = `
            UPDATE pob_wo_po SET 
                grnRefNO = ?, suppInvNo = ?, suppInvoiceDate = ?, csSuppDcNo = ?, suppDcRate = ?, irNo = ?, carNo = ?,  accountable=?,
                binNo = ?, exgRate = ?, currency = ?, gstType = ?, remarks = ?, qcAuthorize = ?, qcAuthorizeBy = ?, 
                qcAuthorizeDate = ?, qcRemarks = ?, totalQty = ?, grossAmount = ?, lessDiscount = ?, transport = ?, 
                coolie = ?, subTotal = ?, cgst = ?, cgstPer = ?, sgst = ?, sgstPer = ?, utgst = ?, utgstPer = ?, 
                total = ?, tds = ?, tdsPer = ?, tcs = ?, tcsPer = ?, igst = ?, igstPer = ?, others = ?, 
                grandTotal = ?
            WHERE poNo = ?
        `;

        // Use Promise.all to handle multiple updates concurrently
        await Promise.all(poArray.map(async (po) => {

            const conversionRate = (po.conversionPart != null && po.conversionQty > 0) ? Number(po.pbAmt) / Number(po.conversionQty) : null;

            // Update pob_wo_po_dtl table
            await connection.execute(updateDetailQuery, [
                po.qoh, po.totStk, po.cumQty, po.maxQtyLvl, po.schDate, po.poQty, po.invQty, po.rcvdQty, po.accQty, po.rejQty, po.totalQty, po.grossAmount, po.pbRate, po.pbAmt,
                po.lot, po.itemsLedger, po.itemRemarks, po.lndCost, po.lndRate, po.conversionPart ?? null, po.conversionPartId ?? null, po.conversionQty ?? null, conversionRate,
                po.digitString,  po.id
            ]);

            // Update pob_wo_po table if `digit` exists
            await connection.execute(updateMainQuery, [
                po.grnRefNO, po.suppInvNo, po.suppInvoiceDate, po.csSuppDcNo, po.suppDcRate,
                po.irNo, po.carNo, po.accountable, po.binNo, po.exgRate, po.currencyId, po.gstType, po.remarks,
                po.qcAuthorize, po.qcAuthorizeBy, po.qcAuthorizeDate, po.qcRemarks, po.totalQty,
                po.grossAmount, po.lessDiscount, po.transport, po.coolie, po.subTotal, po.cgst,
                po.cgstPer, po.sgst, po.sgstPer, po.utgst, po.utgstPer, po.total, po.tds,
                po.tdsPer, po.tcs, po.tcsPer, po.igst, po.igstPer, po.others, po.grandTotal,
                po.digitString
            ]);

            // // Insert into `store` table if `approve` is 1
            // if (po.approve == 1) {
            //     const openQty = await fetchOpQty(po.itemName);

            //     const insertQuery = `
            //         INSERT INTO store (itemId, itemCode, grnNo, docNo, docType, rcvdQty, inwardQty, rejQty, opQty, addedBy) 
            //         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            //     `;
            //     await connection.execute(insertQuery, [
            //         po.itemId, po.itemCode, po.grnRefNO, po.digitString, 'Purchase Bill',
            //         po.rcvdQty, po.accQty, po.rejQty, openQty, user
            //     ]);
            // }
        }));

        return res.status(200).json({ success: true, message: "Data updated successfully" });

    } catch (err) {
        console.error('Error in update function:', err);
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};


exports.delete = async (req, res) => {
    let conn;
    try {
        const id = req.params.id;
        const { prefix } = req.query;

        if (!id || !prefix) {
            return res.status(400).json({
                success: false,
                message: "Invalid request parameters"
            });
        }

        conn = await connection.getConnection();
        await conn.beginTransaction();

        // Fetch poNo using digit and type
        const [poNoRow] = await conn.query(
            `SELECT poNo FROM pob_wo_po WHERE digit = ? AND type = ?`,
            [id, prefix]
        );

        if (poNoRow.length === 0) {
            throw new Error("No record found to delete");
        }

        const poNo = poNoRow[0].poNo;

        // 1️⃣ Delete detail records first
        const deleteDtlQuery = `
            DELETE FROM pob_wo_po_dtl
            WHERE poNo = ?
        `;
        await conn.query(deleteDtlQuery, [poNo]);

        // 2️⃣ Delete master record
        const deleteMainQuery = `
            DELETE FROM pob_wo_po
            WHERE poNo = ?
        `;
        const [result] = await conn.query(deleteMainQuery, [poNo]);

        if (result.affectedRows === 0) {
            throw new Error("No record found to delete");
        }

        await conn.commit();

        return handleSuccessResponse(
            res,
            "Successfully Deleted"
        );

    } catch (err) {
        if (conn) await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


exports.showData = async (req, res) => {
    let conn;
    try {
        conn = await connection.getConnection();

        const fetch = `
            SELECT 
                pob_wo_po.*,
                sup.spCode,
                sup.spName AS suppName,
                sup.id AS supId,
                sup.state,
                sup.country,
                cur.name AS currency,
                cur.id AS currencyId,
                DATE_FORMAT(pob_wo_po.created_at, '%d-%m-%Y %H:%i:%s') AS created_at,
                DATE_FORMAT(pob_wo_po.date, '%d-%m-%Y %H:%i:%s') AS date
            FROM pob_wo_po
            INNER JOIN supplier AS sup ON pob_wo_po.supId = sup.id
            LEFT JOIN mst_currency AS cur ON pob_wo_po.currency = cur.id
            WHERE pob_wo_po.dflag = 0
        `;

        const [results] = await conn.query(fetch);

        // Auto serial number
        results.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return handleSuccessResponse(
            res,
            "PO Bill List",
            results
        );

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


exports.viewDtl = async (req, res) => {
    let conn;
    try {
        const { digit, prefix } = req.body;
        const { fyFrom, fyTo } = formatFinancialYears(req);

        conn = await connection.getConnection();

        // Company master data
        const companyData = await company();

        // Fetch poNo using digit and prefix
        const [poNoRow] = await conn.query(
            `SELECT poNo FROM pob_wo_po WHERE digit = ? AND type = ? AND DATE(created_at) BETWEEN ? AND ?`,
            [digit, prefix, fyFrom, fyTo]
        );

        if (poNoRow.length === 0) {
            return res.status(404).json({ success: false, message: "No PO records found." });
        }

        const poNo = poNoRow[0].poNo;

        const fetch = `
            SELECT 
                pob_wo_po.*,
                poWoPoDtl.*,
                sup.spCode,
                sup.spName AS suppName,
                sup.id AS supId,
                sup.state,
                sup.country,

                pob_wo_po.id AS poBillId,
                poWoPoDtl.id AS poBillDtlId,
                poWoPoDtl.lot AS location,
                poWoPoDtl.accQty,

                ig.code AS itemGroupName,
                d.code AS displayName,

                DATE_FORMAT(pob_wo_po.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(pob_wo_po.created_at, '%d-%m-%Y %H:%i:%s') AS created_at,

                mqr.batchQty,
                mqr.batchQtyName,
                qcCnt.poBillDtld_count

            FROM pob_wo_po
                INNER JOIN supplier sup 
                    ON pob_wo_po.supId = sup.id

                INNER JOIN pob_wo_po_dtl poWoPoDtl 
                    ON pob_wo_po.id = poWoPoDtl.poId

                INNER JOIN items i 
                    ON poWoPoDtl.itemId = i.id

                LEFT JOIN mst_item_group ig 
                    ON i.itemGroup = ig.id

                LEFT JOIN qc_rule qc 
                    ON ig.id = qc.itemGroupId

                LEFT JOIN mst_display_name d 
                    ON d.id = qc.displayName

                LEFT JOIN pobil_withoutpo_dtlid_count_view qcCnt 
                    ON qcCnt.poBillDtlId = poWoPoDtl.id

                LEFT JOIN map_qc_rule mqr 
                    ON qc.id = mqr.qcRuleId
                   AND poWoPoDtl.accQty BETWEEN mqr.lotFrom AND mqr.lotTo

            WHERE pob_wo_po.poNo = ?
              AND pob_wo_po.dflag = 0

            GROUP BY poWoPoDtl.id
            ORDER BY poWoPoDtl.id ASC
        `;

        const [results] = await conn.query(fetch, [poNo]);

        // Add serial number & merge company data
        const data = results.map((row, index) => ({
            sNo: index + 1,
            ...row,
            ...companyData
        }));

        return handleSuccessResponse(
            res,
            "POBill Without PO Entry list",
            data
        );

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


exports.getPoItems = async (req, res) => {
    try {
        const { type, id, prefix } = req.query;
        const { fyFrom, fyTo } = formatFinancialYears(req);

        // // Check if type is 'forward' or 'reverse' and validate the presence of 'id'
        // if ((type === 'forward' || type === 'reverse') && (!id || id === '')) {
        //     return res.status(200).json({
        //         success: true,
        //         data: []
        //     });
        // }

        // Determine mainId based on the type and id
        let mainIdQuery = '';
        let queryParams = [];

        switch (type) {
            case 'first':
                mainIdQuery = `
                    SELECT MIN(po.id) AS mainId
                    FROM pob_wo_po AS po
                  WHERE po.dflag = 0 ${prefix ? 'AND po.type = ?' : ''}
                `;
                if (prefix) queryParams.push(prefix);
                break;

            case 'last':
                mainIdQuery = `
                    SELECT MAX(po.id) AS mainId
                    FROM pob_wo_po AS po
                  WHERE po.dflag = 0 ${prefix ? 'AND po.type = ?' : ''}
                `;
                if (prefix) queryParams.push(prefix);
                break;

            case 'forward':
                mainIdQuery = `
                    SELECT MIN(po.id) AS mainId
                    FROM pob_wo_po AS po
                    WHERE po.dflag = 0 AND po.id > ?  AND po.type = ?
                `;
                queryParams = [id, prefix];
                break;

            case 'reverse':
                mainIdQuery = `
                    SELECT MAX(po.id) AS mainId
                    FROM pob_wo_po AS po
                    WHERE po.dflag = 0 AND po.id < ? AND po.type = ?
                `;
                queryParams = [id, prefix];
                break;
        }
        mainIdQuery += ` AND date(po.created_at) BETWEEN ? AND ?`;
        queryParams.push(fyFrom, fyTo);

        // Execute mainIdQuery to get mainId based on the type
        const [mainIdRows] = await connection.execute(mainIdQuery, queryParams);
        const mainId = mainIdRows[0]?.mainId;

        // If mainId is not found, return an empty array
        if (!mainId) {
            return res.status(200).json({
                success: true,
                data: []
            });
        }
            //  cur.name AS currency, cur.id AS currencyId,
            // LEFT JOIN mst_currency AS cur ON pob_wo_po.currency = cur.id 


        // Main query to fetch items based on the determined mainId
        const itemsQuery = `
            SELECT pob_wo_po.*, pob_wo_po.id AS mainId, poWoPoDtl.*, sup.spCode, sup.spName AS suppName, 
                sup.id AS supId, sup.state, sup.country,
                poWoPoDtl.lot AS location,
                DATE_FORMAT(pob_wo_po.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(pob_wo_po.created_at, '%d-%m-%Y %H:%i:%s') AS created_at
            FROM pob_wo_po
                INNER JOIN supplier AS sup ON pob_wo_po.supId = sup.id
                INNER JOIN pob_wo_po_dtl AS poWoPoDtl ON pob_wo_po.id = poWoPoDtl.poId 
            WHERE pob_wo_po.dflag = 0 AND pob_wo_po.id = ?
            ORDER BY poWoPoDtl.id ASC
        `;

       
        const [rows] = await connection.execute(itemsQuery, [mainId]);

        // return res.status(200).json({
        //     success: true,
        //     data: rows
        // });

        const companyData = await company();

     
        const resultWithCompany = rows.map(row => ({
            ...row,
            ...companyData
        }));

        return res.status(200).json({
            success: true,
            data: resultWithCompany
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


// QC Pending po_bill Without PO ShowData
exports.pending = async (req, res) => {
    let conn;
    try {
        conn = await connection.getConnection();

        const fetch = `
            SELECT 
                po.id,
                po.poNo,
                po.type,
                po.suppInvNo,
                po.csSuppDcNo,
                po.digit,
                po.qcApproval,
                sup.spCode,
                sup.spName AS suppName,
                sup.id AS supId,
                DATE_FORMAT(po.suppInvoiceDate, '%d-%m-%Y') AS suppInvoiceDate,
                DATE_FORMAT(po.suppDcRate, '%d-%m-%Y') AS suppDcDate,
                DATE_FORMAT(po.date, '%d-%m-%Y') AS date
            FROM pob_wo_po po
            INNER JOIN supplier sup ON po.supId = sup.id
            WHERE po.dflag = 0
              AND po.qcApproval = 0
            ORDER BY po.id DESC
        `;

        const [results] = await conn.query(fetch);

        // Auto serial number
        results.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return handleSuccessResponse(
            res,
            "PO Bill Without PO List",
            results
        );

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


exports.report = async (req, res) => {
    try {
        const repo = req.body;

        // Ensure dates are in the correct format and include time
        const fromDate = repo.from;
        const toDate = repo.to;
        const sup = repo.supplier; // Expecting an array like [1, 2, 3]
        const item = repo.items;   // Expecting an array like [4, 5]
        const itmGrp = repo.itmGrp;   // Expecting an array like [4, 5]


        // Sub query
        let query = `   
            SELECT 
                po.id As mainId, DATE_FORMAT(po.date, '%d-%m-%Y') AS poDate, po.poNo,
                po.suppInvNo,  po.suppInvoiceDate, po.csSuppDcNo,  po.suppDcRate, 
                pbd.poQty, pbd.invQty, pbd.rcvdQty, pbd.accQty, pbd.rejQty, pbd.lndCost, pbd.lndRate, 
                pbd.pbRate, pbd.pbAmt, pbd.itemRemarks, 
                DATE_FORMAT(pbd.schDate, '%d-%m-%Y') AS schDate, itm.poQty AS pendingPo,
                itm.itemCode, itm.itemName, itm.id AS itemId, itmGrp.name AS itemGroup,
                uomTab.name as uomName, sup.spName, sup.spCode, sup.gstNo, sup.id AS supplierId
            FROM 
                pob_wo_po po
            RIGHT JOIN 
                pob_wo_po_dtl as pbd ON po.poNo = pbd.poNo
            INNER JOIN 
                supplier as sup ON po.supId = sup.id
            INNER JOIN 
                items as itm ON pbd.itemId = itm.id
            LEFT JOIN
                mst_uom as uomTab ON pbd.uom = uomTab.id
            LEFT JOIN
                mst_item_group as itmGrp ON itmGrp.id = itm.itemGroup
            WHERE 
                po.dflag = 0 AND pbd.dflag = 0 
        `;

        // Collect conditions
        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(po.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(sup) && sup.length > 0) {
            conditions.push(`sup.id IN (${sup.map(() => '?').join(', ')})`);
            queryParams.push(...sup);
        }

        if (Array.isArray(item) && item.length > 0) {
            conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
            queryParams.push(...item);
        }

        if (Array.isArray(itmGrp) && itmGrp.length > 0) {
            conditions.push(`itmGrp.id IN (${itmGrp.map(() => '?').join(', ')})`);
            queryParams.push(...itmGrp);
        }

        if (conditions.length) {
            query += ' AND ' + conditions.join(' AND ');
        }

        // Execute the query
        const [rows] = await connection.execute(query, queryParams);


        if (rows.length >= 0) {
            rows.forEach((row, index) => {
                row.id = index + 1;
                row.sNo = index + 1;


            });
        }
        // Group rows by supplierId and then by poNo
        // const groupedData = {};

        // rows.forEach(row => {
        //     if (!groupedData[row.supplierId]) {
        //         groupedData[row.supplierId] = {
        //             supplierId: row.supplierId,
        //             spName: row.spName,
        //             spCode: row.spCode,
        //             gst: row.gstNo,
        //             po: []
        //         };
        //     }

        //     let supplierGroup = groupedData[row.supplierId];

        //     let poGroup = supplierGroup.po.find(po => po.poNo === row.poNo);
        //     if (!poGroup) {
        //         poGroup = {
        //             poNo: row.poNo,
        //             poType: row.poType,
        //             poDate: row.poDate,
        //             items: []
        //         };
        //         supplierGroup.po.push(poGroup);
        //     }

        //     poGroup.items.push({
        //         id: poGroup.items.length + 1,
        //         sNo: poGroup.items.length + 1,
        //         itemGroup: row.itemGroup,
        //         itemId: row.itemId,
        //         itemCode: row.itemCode,
        //         itemName: row.itemName,
        //         suppDesc: row.suppDesc,
        //         schDate:row.schDate,
        //         uom: row.uomName,
        //         unitRate: row.pbRate,
        //         value: row.pbAmt,
        //         qty: row.poQty,
        //         invQty: row.invQty,
        //         rcvdQty: row.rcvdQty,
        //         accQty: row.accQty,
        //         rejQty: row.rejQty,
        //         lndCost: row.lndCost,
        //         lndCost: row.lndCost,
        //         lndCost: row.lndCost,
        //         itemRemarks: row.itemRemarks,
        //         suppInvNo: row.suppInvNo,
        //         suppInvoiceDate: row.suppInvoiceDate,  
        //         suppDcNo: row.csSuppDcNo,
        //         suppDcDate: row.suppDcDate,
        //         // dateDiff: null,


        //     });
        // });

        // // Convert groupedData object to an array
        // const result = Object.values(groupedData);

        return res.status(200).json({
            success: true,
            message: "Po list",
            data: rows
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};




exports.mutliInv = async (req, res) => {
    try {


        const {from, to } = req.body;


        // Construct the SQL query
        let sqlQuery = `
            SELECT 
                pb.id, pb.poNo, pb.suppInvNo, pb.grnRefNO, sup.spCode, sup.spName,
                DATE_FORMAT(pb.date, '%d-%m-%Y ') AS date, grandTotal,
                DATE_FORMAT(pb.suppInvoiceDate, '%d-%m-%Y ') AS suppInvoiceDate
            FROM pob_wo_po pb
                INNER JOIN supplier as sup ON pb.supId = sup.id
            WHERE pb.qcApproval = 1 AND pb.dflag = 0 
           `;

        // Add conditions for 'from' and 'to' if they are provided
        const params = [];

        // Date range filter
        if (from && to) {
            sqlQuery += ` AND DATE(pb.date) BETWEEN ? AND ?`;
            params.push(from, to);
        }

        // Default to today's date ONLY when no filters are given
        if (!(from && to)) {
            sqlQuery += ` AND DATE(pb.date) = CURDATE()`;
        }


        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, params);

        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return handleSuccessResponse(res, 'PoBill Data', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};





exports.multiInvPrint = async (req, res) => {
    try {
        const { invoiceIds } = req.body; // invoiceIds comes from payload array
    
        // Convert invoiceIds array to placeholders (?, ?, ?)
        const placeholders = invoiceIds.map(() => "?").join(",");

        // MAIN QUERY (multiple invoices)
        const itemsQuery = `
            SELECT 
                pob_wo_po.*, pob_wo_po.id AS mainId,
                pob_wo_po_dtl.*, 
                pob_wo_po.id AS poBillId,
                pob_wo_po.qcApproval AS qcFlag,

                sup.spCode, sup.spName AS suppName,
                sup.id AS supId, sup.state, sup.country,
                CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,

                itm.itemName, itm.id AS itemId, itm.shelfLifeItem,
                itm.totStk AS qoh,
                CONCAT(itm.itemCode, ', ', itm.itemName) AS description,

                pob_wo_po_dtl.lot AS location,

                DATE_FORMAT(pob_wo_po.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(pob_wo_po.created_at, '%d-%m-%Y %H:%i:%s') AS created_at

            FROM pob_wo_po
            INNER JOIN supplier AS sup ON pob_wo_po.supId = sup.id
            LEFT JOIN pob_wo_po_dtl ON pob_wo_po.id = pob_wo_po_dtl.poId
            LEFT JOIN items AS itm ON pob_wo_po_dtl.itemId = itm.id
            WHERE pob_wo_po.dflag = 0 AND pob_wo_po.id IN (${placeholders})
        `;

        const [rows] = await connection.execute(itemsQuery, invoiceIds);

        // Fetch company info once
        const companyData = await company();

        // Add lot qty + company data for each row
        const finalData = await Promise.all(
            rows.map(async (row) => {
                const fetchLotQuery = `
                    SELECT * 
                    FROM po_bill_lot 
                    WHERE digit = ? AND type = ? AND itemId = ?
                `;

                const [lotQtyData] = await connection.execute(fetchLotQuery, [
                    row.digit,
                    row.type,
                    row.itemId
                ]);

                return {
                    ...row,
                    lotQtyData,
                    ...companyData
                };
            })
        );

        return res.status(200).json({
            success: true,
            data: finalData
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


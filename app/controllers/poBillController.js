const { storeFile, company } = require('../utility/utilityFunction');
const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { updateDocCounter, generateDocNo, formatFinancialYears } = require('../utility/docNo');
const ExcelJS = require('exceljs');




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



exports.search = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;
        const id = req.params.id;

        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT 
                po.id, po.poNo, po.poQty, po.pendingPo, 
                po.schDate, po.rate AS pbRate, po.suppDesc,
                itm.itemName, itm.itemCode, svi.suppDesc

            FROM po_generate po
                INNER JOIN po_main ON po.poNo = po_main.poNo
                INNER JOIN items as itm ON po.itemName = itm.id
                INNER JOIN supplier as sup ON po.spName = sup.id
                INNER JOIN supp_vs_item as svi ON svi.spName = sup.id AND svi.itemName = itm.id


            WHERE sup.id = ? AND po_main.authorized = 1 AND po_main.dflag = 0 AND po.pendingPo != 0
        `;

        const values = [id];

        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` AND (itm.itemCode LIKE ?) OR ( svi.suppDesc LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
        }

        // Add ORDER BY clause to sort the results with item codes containing special characters last
        // fetch += ` LIMIT 20`;
        // fetch += ` ORDER BY CASE WHEN items.itemCode LIKE '%[^a-zA-Z0-9]%' THEN 1 ELSE 0 END, items.itemCode LIMIT 20`;  // including white space
        fetch += ` ORDER BY CASE WHEN itm.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, itm.itemCode LIMIT 100`;

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "Items", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}

exports.poSupp = async (req, res) => {
    let conn;
    try {
        conn = await connection.getConnection();

        const fetch = `
            SELECT DISTINCT
                po_main.spName AS spTabId, sup.sId, sup.spName AS label,
                CONCAT(
                    sup.spAdd1, ' ',
                    sup.spAdd2, ' ',
                    sup.spAdd3, ' ',
                    sup.spAdd4
                ) AS spAddress,
                sup.state, sup.country, cur.name AS currency, cur.id AS currencyId
            FROM po_main
                INNER JOIN supplier AS sup ON sup.id = po_main.spName
                INNER JOIN mst_currency AS cur ON sup.currency = cur.id
            WHERE po_main.dflag = 0
              AND po_main.authorized = 1
        `;

        const [results] = await conn.query(fetch);

        // Auto index value
        results.forEach((row, index) => {
            row.id = index + 1;
        });

        return handleSuccessResponse(res, "Approved PO Order List", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};



// Get PO + Jobwork Suppliers (Unique)
exports.poSupp2 = async (req, res) => {
    try {
        const { type = null, q } = req.query;

        let whereClausePo = '';
        let whereClauseJw = '';
        const values = [];

        if (q) {
            whereClausePo += ` AND sup.spCode LIKE ?`;
            whereClauseJw += ` AND sup.spCode LIKE ?`;
            values.push(`%${q}%`); // used for po_main
            values.push(`%${q}%`); // used for jobwork_issue (only if type = 'J')
        }

        // Fixed: Added AND and quotes around 'J'
        if (type === "J") {
            whereClausePo += ` AND po_main.type = 'J'`;
        }

        let innerQuery = `
            SELECT 
                sup.sId, sup.spCode, sup.spName AS label, sup.id As spTabId,
                CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,
                sup.state, sup.country, cur.name AS currency, cur.id AS currencyId
            FROM po_main 
                INNER JOIN supplier AS sup ON sup.id = po_main.spName
                INNER JOIN mst_currency AS cur ON sup.currency = cur.id
            WHERE po_main.dflag = 0 AND po_main.authorized = 1 ${whereClausePo}
            GROUP BY sup.sId
        `;

        if (type === 'J') {
            innerQuery += `
                UNION
                SELECT 
                    sup.sId, sup.spCode, sup.spName AS label, sup.id As spTabId,
                    CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,
                    sup.state, sup.country, cur.name AS currency, cur.id AS currencyId
                FROM jobwork_issue ji
                    INNER JOIN supplier AS sup ON sup.id = ji.supplierId
                    INNER JOIN mst_currency AS cur ON sup.currency = cur.id
                WHERE ji.isClosed = 0 ${whereClauseJw}
                GROUP BY sup.sId
            `;
        } else {
            if (q) values.pop();
        }

        // Wrap UNION into subquery so GROUP BY + LIMIT works
        let finalQuery = `
            SELECT * FROM (
                ${innerQuery}
            ) AS all_suppliers
            GROUP BY sId
            ORDER BY label ASC
            LIMIT 20
        `;

        const [rows] = await connection.execute(finalQuery, values);

        return handleSuccessResponse(res, 'Approved PO Supplier List', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};




// Get PO Items (From PO View – only digit will be payload)
exports.poSuppItm = async (req, res) => {
    let conn;
    try {
        const { supTabId: supId, poDigit: digit } = req.body;

        // if (!supId) {
        //     return handleErrorResponse(res, {
        //         message: "Must select supCode"
        //     });
        // }

        conn = await connection.getConnection();

        let fetch = `
            SELECT 
                po.id, po.poNo, po.digit AS poOrdDigit, DATE_FORMAT(po.date, '%d-%m-%Y') AS date, po_main.id AS poMainId, po.poQty, po.pendingPo AS accQty, 
                po.pendingPo AS rcvdQty, po.pendingPo, po.pendingPo AS invQty, po.cumQty, DATE_FORMAT(po.schDate, '%d-%m-%Y') AS schDate, 0 AS rejQty, po.totalQty,
                po.grossAmount, po.rate AS pbRate, po.freightType, ROUND(po.pendingPo * po.rate, 2) AS pbAmt, po.suppDesc, po.id AS poDtlId, po_main.poNo AS mainPoNo,
                sup.spCode, sup.spName AS suppName, sup.id AS supId, sup.paymentTerms, sup.gstNo, sup.state, sup.country, supCon.department,
                CONCAT(
                    sup.spAdd1, ' ',
                    sup.spAdd2, ' ',
                    sup.spAdd3, ' ',
                    sup.spAdd4
                ) AS spAddress,
             
                cur.name AS currency, cur.id AS currencyId, itm.itemName, itm.id AS itemId, itm.minStockLvl, itm.maxLvl, itm.itemCode, itm.totStk, itm.conversionPart, 
                itm.conversionPartId, itm.conversionConcept, itm.shelfLifeItem, 0 AS jcId, 0 AS processId,
                hsn.name AS hsn, hsn.id AS hsnId, uomTab.name AS uom, uomTab.id AS uomId, ledj.name AS itmLedger,
                ledj.id AS itmLedgerId, loc.name AS location, loc.id AS locationId, itmGrp.name AS itemGroup, itmGrp.id AS itemGroupId
            FROM po_generate po
                INNER JOIN po_main 
                    ON po.poNo = po_main.poNo 
                INNER JOIN supplier sup 
                    ON po.spName = sup.id
                LEFT JOIN sup_con_person supCon 
                    ON sup.sId = supCon.sId
                INNER JOIN mst_currency cur 
                    ON sup.currency = cur.id
                INNER JOIN items itm 
                    ON po.itemName = itm.id
                INNER JOIN mst_uom uomTab 
                    ON itm.uom = uomTab.id
                LEFT JOIN item_under_ledger ledj 
                    ON itm.underLedger = ledj.id
                LEFT JOIN item_main_loc loc 
                    ON itm.mainLocation = loc.id
                LEFT JOIN mst_item_group itmGrp 
                    ON itm.itemGroup = itmGrp.id
                LEFT JOIN item_hsn_code hsn 
                    ON itm.hsnCode = hsn.id
            WHERE po_main.authorized = 1
              AND po_main.type = 'R' AND po_main.dflag = 0 AND po.dflag = 0
              AND po.pendingPo > 0 
        `;

        const params = [];


        if (supId) {
            fetch += " AND po.spName = ?";
            params.push(supId);
        }


        if (digit) {
            fetch += ` AND po.digit = ?`;
            params.push(digit);
        }

        fetch += ` ORDER BY po.id ASC`;

        const [results] = await conn.query(fetch, params);

        // Frontend-required fields
        results.forEach(row => {
            row.select = false;
            row.lotQtyData = [];
        });

        return handleSuccessResponse(res, "Supplier Item list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};




// exports.jcPoSuppItm = async (req, res) => {
//     const conn = await connection.getConnection();
//     try {
//         const supId = req.body.supTabId;

//         // linked jobwork POs
//         const jwQuery = `
//             SELECT 
//                 jwDtl.id, jc.jcNo, jwDtl.id as jobWorkId, poGen.id AS poDtlId, poMain.poNo, poMain.poNo as mainPoNo, jwDtl.Qty AS poQty, jwDtl.Qty AS invQty, 
//                 jwDtl.cumQty, jwDtl.cumQty AS accQty, jwDtl.recievedQty AS rcvdQty, 0 AS rejQty, sup.spCode, sup.spName AS suppName, sup.id AS supId, poMain.id AS poMainId, poMain.digit AS poOrdDigit, 
//                 (jwDtl.Qty - jwDtl.recievedQty) as pendingPo, itm.id AS itemId, itm.itemName, itm.itemCode, FALSE AS \`select\`, DATE_FORMAT(jcI.dispatchDate, '%d-%m-%Y') AS date,
//                 COALESCE(svi.rate, jwDtl.rate) AS pbRate, COALESCE(svi.rate, jwDtl.rate) * jwDtl.Qty AS pbAmt, cur.name AS currency, cur.id AS currencyId,
//                 hsn.name AS hsnCode, uom.name AS uom, DATE_FORMAT(poGen.schDate, '%d-%m-%Y') AS schDate, itmGrp.name as itemGroup, itm.totStk, COALESCE(svi.suppDesc, itm.itemName) as suppDesc
//             FROM jobwork_issue_details jwDtl
//             INNER JOIN jobwork_issue jcI ON jcI.id = jwDtl.jobWorkId
//             INNER JOIN po_generate poGen ON poGen.jobWorkId = jwDtl.id AND poGen.itemName = jwDtl.itemId
//             INNER JOIN po_main poMain ON poMain.poNo = poGen.poNo AND poMain.type = poGen.type
//             INNER JOIN supplier sup ON jcI.supplierId = sup.id
//             LEFT JOIN sfg ON sfg.id = jwDtl.sfgId
//             LEFT JOIN job_card jc ON jc.id = sfg.jcId
//             INNER JOIN items itm ON jwDtl.itemId = itm.id
//             LEFT JOIN supp_vs_item svi ON svi.spName = sup.id AND svi.itemName = jwDtl.itemId
//             LEFT JOIN sup_con_person supCon ON sup.sId = supCon.sId
//             LEFT JOIN mst_currency cur ON sup.currency = cur.id
//             LEFT JOIN item_hsn_code hsn ON hsn.id = itm.hsnCode
//             LEFT JOIN mst_uom as uom ON uom.id = itm.uom
//             LEFT JOIN mst_item_group as itmGrp ON itm.itemGroup = itmGrp.id
//             WHERE jcI.supplierId = ? 
//                 AND poMain.type = 'J' 
//                 AND poMain.authorized = 1
//                 AND poGen.dflag = 0 
//                 AND jwDtl.isClosed = 0
//         `;
//         const [jwRows] = await conn.execute(jwQuery, [supId]);

//         const poGenIds = jwRows.map(obj => obj.poDtlId);

//         // PO query
//         let poQuery = `
//             SELECT 
//                 po.id, 0 AS jobWorkId, null as jcNo,  po.id AS poDtlId, po.poNo, po.poNo as mainPoNo, po.poQty, po.pendingPo AS invQty, po.cumQty, po.pendingPo AS accQty, po.pendingPo AS rcvdQty, 
//                 0 AS rejQty, sup.spCode, sup.spName AS suppName, sup.id AS supId, po_main.id AS poMainId, po_main.digit AS poOrdDigit, 
//                 po.pendingPo, itm.id AS itemId, itm.itemName, itm.itemCode, FALSE AS \`select\`, DATE_FORMAT(po.date, '%d-%m-%Y') AS date, 
//                 po.rate AS pbRate, ROUND(po.pendingPo * po.rate, 2) AS pbAmt, cur.name AS currency, cur.id AS currencyId, 
//                 hsn.name AS hsnCode, uom.name AS uom, DATE_FORMAT(po.schDate, '%d-%m-%Y') AS schDate, itmGrp.name as itemGroup, itm.totStk, po.suppDesc
//             FROM po_generate po
//             INNER JOIN po_main ON po.digit = po_main.digit AND po.type = po_main.type
//             INNER JOIN supplier sup ON po.spName = sup.id
//             INNER JOIN items itm ON po.itemName = itm.id
//             LEFT JOIN mst_currency cur ON sup.currency = cur.id
//             LEFT JOIN item_hsn_code hsn ON hsn.id = itm.hsnCode
//             LEFT JOIN mst_uom as uom ON uom.id = itm.uom
//             LEFT JOIN mst_item_group as itmGrp ON itm.itemGroup = itmGrp.id
//             WHERE po_main.authorized = 1 
//                 AND po_main.type = 'J'
//                 AND po_main.dflag = 0 
//                 AND po.dflag = 0 
//                 AND po.pendingPo > 0
//                 AND po.spName = ?
//         `;

//         const params = [supId];

//         if (poGenIds.length > 0) {
//             const placeholders = poGenIds.map(() => '?').join(',');
//             poQuery += ` AND po.id NOT IN (${placeholders})`;
//             params.push(...poGenIds);
//         }

//         const [poRows] = await conn.execute(poQuery, params);

//         return res.status(200).json({
//             success: true,
//             message: "Supplier Item list",
//             data: [...jwRows, ...poRows]
//         });
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// };

exports.jcPoSuppItm = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const supId = req.body.supTabId;

        // linked jobwork POs
        const jwQuery = `
            SELECT 
                jwDtl.id, jc.jcNo, jwDtl.id as jobWorkId, poGen.id AS poDtlId, poMain.poNo, poMain.poNo as mainPoNo, jwDtl.Qty AS poQty, (jwDtl.Qty - jwDtl.recievedQty) AS invQty, 
                jwDtl.cumQty, (jwDtl.Qty - jwDtl.recievedQty) AS accQty, (jwDtl.Qty - jwDtl.recievedQty) AS rcvdQty, 0 AS rejQty, sup.spCode, sup.spName AS suppName, sup.id AS supId, poMain.id AS poMainId, poMain.digit AS poOrdDigit, 
                (jwDtl.Qty - jwDtl.recievedQty) as pendingPo, itm.id AS itemId, itm.itemName, itm.itemCode, FALSE AS \`select\`, DATE_FORMAT(jcI.dispatchDate, '%d-%m-%Y') AS date,
                COALESCE(svi.rate, jwDtl.rate) AS pbRate, COALESCE(svi.rate, jwDtl.rate) * jwDtl.Qty AS pbAmt, cur.name AS currency, cur.id AS currencyId, itm.conversionPart, itm.conversionPartId, itm.conversionPart,
                hsn.name AS hsnCode, uom.name AS uom, DATE_FORMAT(poGen.schDate, '%d-%m-%Y') AS schDate, itmGrp.name as itemGroup, itm.totStk, COALESCE(svi.suppDesc, itm.itemName) as suppDesc
            FROM jobwork_issue_details jwDtl
            INNER JOIN jobwork_issue jcI ON jcI.id = jwDtl.jobWorkId
            INNER JOIN po_generate poGen ON poGen.jobWorkId = jwDtl.id AND poGen.itemName = jwDtl.itemId
            INNER JOIN po_main poMain ON poMain.poNo = poGen.poNo AND poMain.type = poGen.type
            INNER JOIN supplier sup ON jcI.supplierId = sup.id
            LEFT JOIN sfg ON sfg.id = jwDtl.sfgId
            LEFT JOIN job_card jc ON jc.id = sfg.jcId
            INNER JOIN items itm ON jwDtl.itemId = itm.id
            LEFT JOIN supp_vs_item svi ON svi.spName = sup.id AND svi.itemName = jwDtl.itemId
            LEFT JOIN sup_con_person supCon ON sup.sId = supCon.sId
            LEFT JOIN mst_currency cur ON sup.currency = cur.id
            LEFT JOIN item_hsn_code hsn ON hsn.id = itm.hsnCode
            LEFT JOIN mst_uom as uom ON uom.id = itm.uom
            LEFT JOIN mst_item_group as itmGrp ON itm.itemGroup = itmGrp.id
            WHERE jcI.supplierId = ? 
                AND poMain.type = 'J' 
                AND poMain.authorized = 1
                AND poGen.dflag = 0 
                AND jwDtl.isClosed = 0
        `;
        const [jwRows] = await conn.execute(jwQuery, [supId]);

        const poGenIds = jwRows.map(obj => obj.poDtlId);

        // PO query
        let poQuery = `
            SELECT 
                po.id, 0 AS jobWorkId, null as jcNo,  po.id AS poDtlId, po.poNo, po.poNo as mainPoNo, po.poQty, po.pendingPo AS invQty, po.cumQty, po.pendingPo AS accQty, po.pendingPo AS rcvdQty, 
                0 AS rejQty, sup.spCode, sup.spName AS suppName, sup.id AS supId, po_main.id AS poMainId, po_main.digit AS poOrdDigit, 
                po.pendingPo, itm.id AS itemId, itm.itemName, itm.itemCode, FALSE AS \`select\`, DATE_FORMAT(po.date, '%d-%m-%Y') AS date, 
                po.rate AS pbRate, ROUND(po.pendingPo * po.rate, 2) AS pbAmt, cur.name AS currency, cur.id AS currencyId, itm.conversionPart, itm.conversionPartId, itm.conversionPart,
                hsn.name AS hsnCode, uom.name AS uom, DATE_FORMAT(po.schDate, '%d-%m-%Y') AS schDate, itmGrp.name as itemGroup, itm.totStk, po.suppDesc
            FROM po_generate po
            INNER JOIN po_main ON po.digit = po_main.digit AND po.type = po_main.type
            INNER JOIN supplier sup ON po.spName = sup.id
            INNER JOIN items itm ON po.itemName = itm.id
            LEFT JOIN mst_currency cur ON sup.currency = cur.id
            LEFT JOIN item_hsn_code hsn ON hsn.id = itm.hsnCode
            LEFT JOIN mst_uom as uom ON uom.id = itm.uom
            LEFT JOIN mst_item_group as itmGrp ON itm.itemGroup = itmGrp.id
            WHERE po_main.authorized = 1 
                AND po_main.type = 'J'
                AND po_main.dflag = 0 
                AND po.dflag = 0 
                AND po.pendingPo > 0
                AND po.spName = ?
        `;

        const params = [supId];

        if (poGenIds.length > 0) {
            const placeholders = poGenIds.map(() => '?').join(',');
            poQuery += ` AND po.id NOT IN (${placeholders})`;
            params.push(...poGenIds);
        }

        const [poRows] = await conn.execute(poQuery, params);

        return res.status(200).json({
            success: true,
            message: "Supplier Item list",
            data: [...jwRows, ...poRows]
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.grn = async (req, res) => {
    try {
        let lastFileId = null;

        // Fetch the latest grnRefNO from po_bill
        const [fRows] = await connection.execute('SELECT grnRefNO FROM po_bill WHERE dflag = 0 ORDER BY id DESC LIMIT 1');

        if (fRows.length > 0 && fRows[0].grnRefNO) {
            lastFileId = fRows[0].grnRefNO;
        }

        // If po_bill has no grnRefNO, fetch from store table
        if (!lastFileId) {
            const [sRows] = await connection.execute(
                "SELECT MAX(CAST(grnNo AS UNSIGNED)) AS maxGrn FROM store WHERE grnNo REGEXP '^[0-9]+$'"
            );
            if (sRows.length > 0 && sRows[0].maxGrn !== null) {
                lastFileId = sRows[0].maxGrn.toString();
            }
        }

        // If still no lastFileId, return error (no reference exists)
        if (!lastFileId) {
            return res.status(400).json({ success: false, message: "No previous grnRefNO found in po_bill or store" });
        }

        // Extract and increment the numeric part
        const numericPart = parseInt(lastFileId.match(/\d+/)[0], 10);
        const grn = (numericPart + 1).toString().padStart(lastFileId.length, '0'); // Maintain same length format

        return res.status(200).json({ grnRefNO: grn });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
};



exports.checkFright = async (req, res) => {
    try {
        const { po } = req.body; // Extract po array from request body

        if (!po || !Array.isArray(po) || po.length === 0) {
            return res.status(400).json({ success: false, message: "Invalid input" });
        }

        // Check the unique values in the array
        const uniqueValues = new Set(po);

        let responseCode;
        if (uniqueValues.size === 1) {
            if (uniqueValues.has("PAID")) {
                responseCode = 1; // All values are "PAID"
            } else if (uniqueValues.has("TO PAY")) {
                responseCode = 0; // All values are "TO PAY"
            }
        } else {
            responseCode = 2; // Both "PAID" and "TO PAY" are mixed
        }

        return res.status(200).json({ success: true, code: responseCode });

    } catch (err) {
        return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
};




exports.checkInv = async (req, res) => {
    try {
        const id = req.params.id; // Get supplier ID
        const { q } = req.query;  // Get the invoice number

        if (!id) {
            return res.status(400).json({ success: false, message: "Supplier ID is required." });
        }

        if (!q) {
            return res.status(400).json({ success: false, message: "Query parameter 'q' (suppInvNo) is required." });
        }

        // SQL query to check duplicates in both tables
        const fetchQuery = `
            SELECT 'po_bill' AS source, id, suppInvNo FROM po_bill WHERE dflag = 0 AND spName = ? AND suppInvNo = ?
            UNION ALL
            SELECT 'pob_wo_po' AS source, id, suppInvNo FROM pob_wo_po WHERE dflag = 0 AND supId = ? AND suppInvNo = ?
        `;

        const [rows] = await connection.query(fetchQuery, [id, q, id, q]);

        if (rows.length > 0) {
            return res.status(409).json({ success: false, message: "Duplicate suppInvNo cannot be added!" });
        }

        return res.status(200).json({ success: true, message: "suppInvNo is available." });

    } catch (err) {
        console.error("Error in checkInv2:", err);
        return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
};



// Items shelfLifeItem Is checking
exports.checkLot = async (req, res) => {
    try {
        // Get the ID from the request parameters
        const id = req.params.id;

        // Query to check if the item requires mandatory lot quantity
        const [checkLot] = await connection.execute(
            `SELECT itemCode FROM items WHERE id = ? AND shelfLifeItem = 'Y'`,
            [id]
        );

        // If the result exists, return an error response
        if (checkLot.length > 0) {
            return res.status(400).json({
                success: false,
                message: `For item code '${checkLot[0].itemCode}', the lot quantity is mandatory.`,
            });
        } else {
            return res.status(200).json({
                success: true,
            });

        }

    } catch (err) {
        // Handle errors
        return res.status(err.statusCode || 500).json({
            success: false,
            message: "Internal server error",
            error: err.message,
        });
    }
};


const updateJWItems = async (conn, user, items) => {
    try {
        const jwIds = items.map(item => item.jobWorkId).filter(id => (id != '' && id != undefined && id != null));
        if (jwIds.length > 0) {
            const updateJWQuery = `UPDATE jobwork_issue_details SET po_close = ?, status = ? WHERE id IN (${jwIds.map(() => '?').join(',')})`;
            await conn.execute(updateJWQuery, [1, 'Completed', ...jwIds]);
        }
        const jcNos = items.map(item => item.jcNo).filter(jcNo => (jcNo != '' && jcNo != undefined && jcNo != null));
        if (jcNos.length > 0) {
            const jwQuery = `UPDATE job_card SET verifiedBy = ? WHERE jcNo IN (${jcNos.map(() => '?').join(',')})`;
            await conn.execute(jwQuery, [user, ...jcNos]);
        }
        return true; 0
    } catch (err) {
        throw err;
    }
}


exports.store2 = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const poBillArray = req.body;
        let user = req.headers.username;

        const uniqueDigits = new Set(); // Track unique digits
        const processedItemIds = new Set(); // Track unique itemIds

        const store = `
            INSERT INTO po_bill_dtl (
                type, digit, poNo, poMainId, poDtlId, date, jcId, processId, spName, spAddress, itemCode, itemName, uom, hsnCode, totStk, cumQty, maxQtyLvl,
                schDate, poQty, pendingPo, invQty, rcvdQty, accQty, rejQty, totalQty, grossAmount, lessDiscount, transport, coolie, subTotal,
                pbRate, pbAmt, lot, itemLedger, itemRemarks, lndCost, lndRate, issueQoh
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const storeLot = `
            INSERT INTO po_bill_lot (
                digit, type, itemId, location, lotNo, lotDate, duration, expiry, lotQty, issueQoh, remarks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const storeToMain = `
            INSERT INTO po_bill (
                type, digit, poNo, poMainId, date, spName, spAddress, grnRefNO, suppInvNo, suppInvoiceDate, csSuppDcNo, 
                suppDcDate, irNo, carNo, binNo, exgRate, currency, gstType, remarks, qcAuthorize, qcAuthorizeBy, 
                qcAuthorizeDate, qcRemarks, totalQty, grossAmount, lessDiscount, transport, coolie, subTotal,
                cgst, cgstPer, sgst, sgstPer, utgst, utgstPer, total, tds, tdsPer, tcs, tcsPer, igst, igstPer, 
                others, boeNo, boeDate, packingListNo, packingDate, grossAmountINR, miscCharges, subTotalGrsAndMisc,
                insurance, freight, subTotalINSAndFreight, bcd, socialWelfareCharges, subTotalSwAndBCD, importGST, 
                importGstPer, totalWithGST, freightCharges, localClearanceCharges, grandTotal, file, poOrdDigit, user
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const po of poBillArray) {
            // Skip duplicate itemIds
            if (processedItemIds.has(po.itemId)) {
                continue; // Skip this iteration
            }
            processedItemIds.add(po.itemId); // Mark itemId as processed

            const processId = po.processId || 0;
            const pendingPo = (Number(po.pendingPo) - Number(po.rcvdQty) || 0);
            const cum = (Number(po.cumQty) + Number(po.rcvdQty) || 0);

            // Insert into po_bill_dtl
            await conn.query(store, [
                po.poNo, po.digit, po.digitString, po.poMainId, po.poDtlId, po.date, po.jcId, processId, po.supId, po.spAddress, po.itemCode, po.itemId, po.uom,
                po.hsnCode, po.totStk, cum, po.maxLvl, po.schDate, po.poQty, pendingPo, po.rcvdQty, po.rcvdQty, po.rcvdQty,
                po.rejQty, po.totalQty, po.grossAmount, po.lessDiscount, po.transport, po.coolie, po.subTotal,
                po.pbRate, po.pbAmt, po.location, po.itmLedger, po.itemRemarks, po.lndCost, po.lndRate, po.rcvdQty
            ]);

            // Insert into po_bill_lot for each lot, only if lotQtyData is present and is an array
            if (po.lotQtyData && Array.isArray(po.lotQtyData) && po.lotQtyData.length > 0) {
                for (const lot of po.lotQtyData) {
                    if (!lot.lotQty) continue;
                    await connection.query(storeLot, [
                        po.digit, po.poNo, po.itemId, lot.location, lot.lotNo, lot.lotDate, lot.duration, lot.expiry,
                        lot.lotQty, lot.lotQty, lot.remarks,
                    ]);
                }
            }

            // Update po_generate
            const query = `
              UPDATE po_generate 
              SET rcvdQty = rcvdQty + ?, pendingPo = ?, cumQty = cumQty + ?  
              WHERE id = ? AND itemName = ?
            `;

            await conn.query(query, [po.rcvdQty, pendingPo, po.rcvdQty, po.poDtlId, po.itemId]);

            // Insert into po_bill only if digit is unique
            if (!uniqueDigits.has(po.digit)) {
                uniqueDigits.add(po.digit);
                const filePath = storeFile(po.file, 'poBill');

                await conn.query(storeToMain, [
                    po.poNo, po.digit, po.digitString, po.poMainId, po.date, po.supId, po.spAddress, po.grnRefNO, po.suppInvNo,
                    po.suppInvoiceDate, po.csSuppDcNo, po.suppDcDate, po.irNo, po.carNo, po.binNo, po.exgRate,
                    po.currency, po.gstType, po.remarks, po.qcAuthorize, po.qcAuthorizeBy, po.qcAuthorizeDate,
                    po.qcRemarks, po.totalQty, po.grossAmount, po.lessDiscount, po.transport, po.coolie, po.subTotal,
                    po.cgst, po.cgstPer, po.sgst, po.sgstPer, po.utgst, po.utgstPer, po.total, po.tds, po.tdsPer,
                    po.tcs, po.tcsPer, po.igst, po.igstPer, po.others, po.boeNo, po.boeDate, po.packingListNo,
                    po.packingDate, po.grossAmountINR, po.miscCharges, po.subTotalGrsAndMisc, po.insurance, po.freight,
                    po.subTotalINSAndFreight, po.bcd, po.socialWelfareCharges, po.subTotalSwAndBCD, po.importGST, po.importGstPer,
                    po.totalWithGST, po.freightCharges, po.localClearanceCharges, po.grandTotal, filePath, po.poOrdDigit, user
                ]);
            }
        }
        await updateJWItems(conn, user, poBillArray);
        await conn.commit();
        return handleSuccessResponse(res, 'Data Stored Successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const poBillArray = req.body;
        let user = req.headers.username;


        // Prevent duplicate poMainId + itemId + schDate in input
        const uniqueCombinations = new Set();
        if (poBillArray[0]?.poNo === 'R') {
            for (const po of poBillArray) {
                const key = `${po.poMainId}-${po.itemId}-${po.schDate}`;
                if (uniqueCombinations.has(key)) {
                    throw new CustomError(`Duplicate itemCode "${po.itemCode}" found for poNo "${po.mainPoNo}" on scheduled date "${po.schDate}"`);
                }
                uniqueCombinations.add(key);
            }
        }

        const uniqueDigits = new Set(); // Track unique digits
        // const processedItemIds = new Set(); // Track unique itemIds

        // Check for duplicate suppInvNo **before processing anything**
        const po = poBillArray[0]; // Assuming all entries share the same suppInvNo
        const checkInv = `SELECT suppInvNo FROM po_bill WHERE dflag = 0 AND spName = ? AND suppInvNo = ?`;
        const [rows] = await conn.query(checkInv, [po.supId, po.suppInvNo]);

        if (rows.length > 0) {
            throw new CustomError("Duplicate suppInvNo cannot be added!");
        }

        const store = `
            INSERT INTO po_bill_dtl (
                type, digit, poNo, poMainId, poDtlId, date, jcNo, processId, spName, spAddress, itemCode, itemName, uom, hsnCode, totStk, cumQty, maxQtyLvl,
                schDate, poQty, pendingPo, invQty, rcvdQty, accQty, rejQty, totalQty, grossAmount, lessDiscount, transport, coolie, subTotal,
                pbRate, pbAmt, lot, itemLedger, itemRemarks, lndCost, lndRate, conversionPart, conversionPartId, conversionQty, conversionRate
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const storeLot = `
            INSERT INTO po_bill_lot (
                digit, type, itemId, location, lotNo, lotDate, duration, expiry, lotQty, issueQoh, remarks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const storeToMain = `
            INSERT INTO po_bill (
                type, digit, poNo, poMainId, date, spName, spAddress, accountable, grnRefNO, suppInvNo, suppInvoiceDate, csSuppDcNo, 
                suppDcDate, irNo, carNo, binNo, exgRate, currency, gstType, remarks, qcAuthorize, qcAuthorizeBy, 
                qcAuthorizeDate, qcRemarks, totalQty, grossAmount, lessDiscount, transport, coolie, subTotal,
                cgst, cgstPer, sgst, sgstPer, utgst, utgstPer, total, tds, tdsPer, tcs, tcsPer, igst, igstPer, 
                others, boeNo, boeDate, packingListNo, packingDate, grossAmountINR, miscCharges, subTotalGrsAndMisc,
                insurance, insurancePer, freight, subTotalINSAndFreight, bcd, bcdPer, socialWelfareCharges, swcPer, subTotalSwAndBCD, importGST, 
                importGstPer, totalWithGST, freightCharges, localClearanceCharges, grandTotal, file, poOrdDigit, user
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const po of poBillArray) {

            const processId = po.processId || 0;
            const pendingPo = (Number(po.pendingPo) - Number(po.rcvdQty) || 0);
            const cum = (Number(po.cumQty) + Number(po.rcvdQty) || 0);

            const conversionRate = (po.conversionPart != null && po.conversionQty > 0) ? Number(po.pbAmt) / Number(po.conversionQty) : null;

            // Insert into po_bill_dtl
            await conn.query(store, [
                po.poNo, po.digit, po.digitString, po.poMainId, po.poDtlId, po.date, po.jcNo, processId, po.supId, po.spAddress, po.itemCode, po.itemId, po.uom,
                po.hsnCode, po.totStk, cum, po.maxLvl, po.schDate, po.poQty, pendingPo, po.invQty, po.rcvdQty, po.rcvdQty,
                po.rejQty, po.totalQty, po.grossAmount, po.lessDiscount, po.transport, po.coolie, po.subTotal,
                po.pbRate, po.pbAmt, po.location, po.itmLedger, po.itemRemarks, po.lndCost, po.lndRate,
                po.conversionPart === "" ? null : po.conversionPart, po.conversionPartId ?? null, po.conversionQty ?? null, conversionRate,
            ]);

            // Insert into po_bill_lot for each lot, only if lotQtyData is present and is an array
            if (po.lotQtyData && Array.isArray(po.lotQtyData) && po.lotQtyData.length > 0) {
                for (const lot of po.lotQtyData) {
                    if (!lot.lotQty) continue;
                    await conn.query(storeLot, [
                        po.digit, po.poNo, po.itemId, lot.location, lot.lotNo, lot.lotDate, lot.duration, lot.expiry,
                        lot.lotQty, lot.lotQty, lot.remarks,
                    ]);
                }
            }

            // Update po_generate
            const query = `
              UPDATE po_generate 
              SET rcvdQty = rcvdQty + ?, cumQty = cumQty + ?  
              WHERE id = ? AND itemName = ?
            `;

            await conn.query(query, [po.rcvdQty, po.rcvdQty, po.poDtlId, po.itemId]);

            // Insert into po_bill only if digit is unique
            if (!uniqueDigits.has(po.digit)) {
                uniqueDigits.add(po.digit);
                const filePath = storeFile(po.file, 'poBill');

                await conn.query(storeToMain, [
                    po.poNo, po.digit, po.digitString, po.poMainId, po.date, po.supId, po.spAddress, po.accountable, po.digitString, po.suppInvNo,
                    po.suppInvoiceDate, po.csSuppDcNo, po.suppDcDate, po.irNo, po.carNo, po.binNo, po.exgRate,
                    po.currency, po.gstType, po.remarks, po.qcAuthorize, po.qcAuthorizeBy, po.qcAuthorizeDate,
                    po.qcRemarks, po.totalQty, po.grossAmount, po.lessDiscount, po.transport, po.coolie, po.subTotal,
                    po.cgst, po.cgstPer, po.sgst, po.sgstPer, po.utgst, po.utgstPer, po.total, po.tds, po.tdsPer,
                    po.tcs, po.tcsPer, po.igst, po.igstPer, po.others, po.boeNo, po.boeDate, po.packingListNo,
                    po.packingDate, po.grossAmountINR, po.miscCharges, po.subTotalGrsAndMisc, po.insurance, po.insurancePer, po.freight,
                    po.subTotalINSAndFreight, po.bcd, po.bcdPer, po.socialWelfareCharges, po.swcPer, po.subTotalSwAndBCD, po.importGST, po.importGstPer,
                    po.totalWithGST, po.freightCharges, po.localClearanceCharges, po.grandTotal, filePath, po.poOrdDigit, user
                ]);
            }
        }
        // await storeRejectedParts(conn, poBillArray, user);
        await updateJWItems(conn, user, poBillArray);

        await updateDocCounter(conn, 'PurchaseBill', { docNo: poBillArray[0].digitString, type: poBillArray[0].poNo });

        await conn.commit();

        return handleSuccessResponse(res, 'Data Stored Successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


// Utility function to replace undefined values with null
function sanitize(value) {
    return value === undefined ? null : value;
}

exports.update = async (req, res) => {
    try {
        const poArray = req.body;
        let user = req.headers.username;


        const updateDetailQuery = `
            UPDATE po_bill_dtl SET  
            totStk = ?, cumQty = ?, maxQtyLvl = ?, schDate = ?,  poQty = ?, invQty = ?, rcvdQty = ?, accQty = ?, rejQty = ?, 
            totalQty = ?, grossAmount = ?,  lessDiscount = ?, transport = ?, coolie = ?, subTotal = ?, 
            pbRate = ?, pbAmt = ?, lot = ?, itemLedger = ?, itemRemarks = ?, lndCost = ?, lndRate = ?,
            conversionPart = ?, conversionPartId = ?, conversionQty = ?, conversionRate = ?
            WHERE poNo = ?  AND id = ?
        `;

        const updateMainQuery = `
            UPDATE po_bill SET 
            suppInvNo = ?, suppInvoiceDate = ?, csSuppDcNo = ?,  accountable = ?,
            suppDcDate = ?, irNo = ?, carNo = ?, binNo = ?, exgRate = ?, currency = ?, gstType = ?, remarks = ?, 
            qcAuthorize = ?, qcAuthorizeBy = ?, qcAuthorizeDate = ?, qcRemarks = ?, totalQty = ?, grossAmount = ?, 
            lessDiscount = ?, transport = ?, coolie = ?, subTotal = ?, 
            cgst = ?, cgstPer = ?, sgst = ?, sgstPer = ?, utgst = ?, utgstPer = ?, total = ?, tds = ?, tdsPer = ?, 
            tcs = ?, tcsPer = ?, igst = ?, igstPer = ?, others = ?, boeNo = ?, boeDate = ?, packingListNo = ?, 
            packingDate = ?, grossAmountINR = ?, miscCharges = ?, subTotalGrsAndMisc = ?, insurance = ?, insurancePer = ?, freight = ?, 
            subTotalINSAndFreight = ?, bcd = ?, bcdPer = ?,  socialWelfareCharges = ?, swcPer = ?, subTotalSwAndBCD = ?, importGST = ?, 
            importGstPer = ?, totalWithGST = ?, freightCharges = ?, localClearanceCharges = ?, grandTotal = ?, 
            file = ?,  poOrdDigit = ? 
            WHERE poNo = ?
        `;

        for (const po of poArray) {
            // Store file
            const filePath = storeFile(sanitize(po.file), 'poBill');

            // const pendingPo = Number(sanitize(po.pendingPo)) +  Number(sanitize(po.rejQty));
            // const cum = Number(sanitize(po.cumQty)) - Number(sanitize(po.rejQty));

            const conversionRate = (po.conversionPart != null && po.conversionQty > 0) ? Number(po.pbAmt) / Number(po.conversionQty) : null;


            // Update po_bill_dtl table
            await connection.execute(updateDetailQuery, [
                sanitize(po.totStk), sanitize(po.cumQty), sanitize(po.maxQtyLvl), sanitize(po.schDate),
                sanitize(po.poQty), sanitize(po.invQty), sanitize(po.rcvdQty), sanitize(po.accQty), sanitize(po.rejQty),
                sanitize(po.totalQty), sanitize(po.grossAmount), sanitize(po.lessDiscount), sanitize(po.transport),
                sanitize(po.coolie), sanitize(po.subTotal), sanitize(po.pbRate), sanitize(po.pbAmt), sanitize(po.lot),
                sanitize(po.itmLedger), sanitize(po.itemRemarks), sanitize(po.lndCost), sanitize(po.lndRate),
                sanitize(po.conversionPart), sanitize(po.conversionPartId), sanitize(po.conversionQty), conversionRate,
                sanitize(po.digitString), sanitize(po.id)
            ]);

            // Update po_bill table
            await connection.execute(updateMainQuery, [
                sanitize(po.suppInvNo), sanitize(po.suppInvoiceDate), sanitize(po.csSuppDcNo), sanitize(po.accountable),
                sanitize(po.suppDcDate), sanitize(po.irNo), sanitize(po.carNo), sanitize(po.binNo), sanitize(po.exgRate),
                sanitize(po.currencyId), sanitize(po.gstType), sanitize(po.remarks), sanitize(po.qcAuthorize), sanitize(po.qcAuthorizeBy),
                sanitize(po.qcAuthorizeDate), sanitize(po.qcRemarks), sanitize(po.totalQty), sanitize(po.grossAmount),
                sanitize(po.lessDiscount), sanitize(po.transport), sanitize(po.coolie), sanitize(po.subTotal), sanitize(po.cgst),
                sanitize(po.cgstPer), sanitize(po.sgst), sanitize(po.sgstPer), sanitize(po.utgst), sanitize(po.utgstPer),
                sanitize(po.total), sanitize(po.tds), sanitize(po.tdsPer), sanitize(po.tcs), sanitize(po.tcsPer), sanitize(po.igst),
                sanitize(po.igstPer), sanitize(po.others), sanitize(po.boeNo), sanitize(po.boeDate), sanitize(po.packingListNo),
                sanitize(po.packingDate), sanitize(po.grossAmountINR), sanitize(po.miscCharges), sanitize(po.subTotalGrsAndMisc),
                sanitize(po.insurance), sanitize(po.insurancePer), sanitize(po.freight), sanitize(po.subTotalINSAndFreight), sanitize(po.bcd), sanitize(po.bcdPer),
                sanitize(po.socialWelfareCharges), sanitize(po.swcPer), sanitize(po.subTotalSwAndBCD), sanitize(po.importGST), sanitize(po.importGstPer),
                sanitize(po.totalWithGST), sanitize(po.freightCharges), sanitize(po.localClearanceCharges), sanitize(po.grandTotal),
                sanitize(filePath), sanitize(po.poOrdDigit), sanitize(po.digitString)
            ]);


            // const query = `
            //   UPDATE po_generate  SET  pendingPo = ?, cumQty = ?  WHERE digit = ? AND itemName  = ?`;

            // [rows] = await connection.query(query, [pendingPo, cum, po.poOrdDigit, po.itemName]);

            if (po.approve == 1) {
                // Insert into pm_inspeclist_mst if poNo is "J"
                if (po.poNo === "J") {
                    const qcStore = `INSERT INTO pm_inspeclist_mst (jcId, itemId, processId, totQty) 
                        VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE totQty = VALUES(totQty)`;

                    await connection.execute(qcStore, [
                        sanitize(po.jcId), sanitize(po.itemName), sanitize(po.processId), sanitize(po.accQty)
                    ]);

                    // // Update next process
                    // await updateNextProcess(req, connection, sanitize(po.jcId), sanitize(po.itemName), sanitize(po.processId), sanitize(po.accQty));
                }

            }
        }

        return res.status(200).json({ success: true, message: "Data updated successfully" });
    } catch (err) {
        //console.log(err)
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};



exports.delete = async (req, res) => {
    let conn;
    try {
        const { id } = req.params;
        const { prefix } = req.query;

        if (!id || !prefix) {
            return handleErrorResponse(res, {
                message: "Digit and prefix are required"
            });
        }

        conn = await connection.getConnection();
        await conn.beginTransaction();

        // Fetch poNo using digit and prefix
        const [poNoRow] = await conn.query(
            `SELECT poNo FROM po_bill WHERE digit = ? AND type = ?`,
            [id, prefix]
        );

        if (poNoRow.length === 0) {
            await conn.rollback();
            return handleErrorResponse(res, {
                message: "No data found to delete"
            });
        }

        const poNo = poNoRow[0].poNo;

        // Delete child records first
        await conn.query(
            `DELETE FROM po_bill_dtl WHERE poNo = ?`,
            [poNo]
        );

        // Delete parent record
        const [result] = await conn.query(
            `DELETE FROM po_bill WHERE poNo = ?`,
            [poNo]
        );

        if (result.affectedRows === 0) {
            await conn.rollback();
            return handleErrorResponse(res, {
                message: "No data found to delete"
            });
        }

        await conn.commit();

        return handleSuccessResponse(res, "Successfully deleted");

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

        const fetchQuery = `
        SELECT 
            po_bill.*,
            sup.spCode,
            sup.spName AS suppName,
            sup.id AS supId,
            sup.state,
            sup.country,
            cur.name AS currency,
            cur.id AS currencyId,
            DATE_FORMAT(po_bill.created_at, '%d-%m-%Y %H:%i:%s') AS created_at,
            DATE_FORMAT(po_bill.date, '%d-%m-%Y %H:%i:%s') AS date
        FROM po_bill
        INNER JOIN supplier AS sup 
            ON po_bill.spName = sup.id
        LEFT JOIN mst_currency AS cur 
            ON po_bill.currency = cur.id
        WHERE po_bill.dflag = 0
        `;

        const [results] = await conn.query(fetchQuery);

        // Auto serial number
        results.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return handleSuccessResponse(res, "Po Bill list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};



exports.viewDtl = async (req, res) => {
    try {
        const digit = req.body.digit;
        const prefix = req.body.prefix;
        const { fyFrom, fyTo } = formatFinancialYears(req);

        //  cur.name AS currency,
        //   cur.id AS currencyId, 

        // LEFT JOIN mst_currency AS cur ON po_bill.currency = cur.id

        // Fetch poNo using digit and prefix
        // const [poNoRow] = await connection.query(
        //     `SELECT poNo FROM po_bill WHERE digit = ? AND type = ?`,
        //     [digit, prefix]
        // );

        const [poNoRow] = await connection.query(
            `SELECT poNo FROM po_bill WHERE digit = ? AND type = ? AND DATE(created_at) BETWEEN ? AND ?`,
            [digit, prefix, fyFrom, fyTo]
        );

        if (poNoRow.length === 0) {
            return res.status(404).json({ success: false, message: "No PO records found." });
        }

        const poNo = poNoRow[0].poNo;

        // First query to fetch po_bill and related data
        const fetch = `
               SELECT po_bill.*,
                po_bill_dtl.*, 
                po_bill.id AS poBillId,
                po_bill.qcApproval As qcFlag,
                sup.spCode, 
                sup.spName AS suppName,
                i.itemName As itemName, 
                i.id As itemId, i.conversionConcept,
                CONCAT(i.itemCode, ', ', i.itemName) As description,
                i.totStk As qoh,
                ig.code As itemGroupName,
                d.code As displayName,
                sup.id AS supId, 
                sup.state,
                sup.country,
                po_bill_dtl.jcId, 
                po_bill_dtl.id As poBillDtlId,
                poMain.poNo As mainPoNo,
                CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,              
                po_bill_dtl.lot AS location,
                DATE_FORMAT(po_bill.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(po_bill.created_at, '%d-%m-%Y %H:%i:%s') AS created_at,
                po_bill_dtl.accQty,
                mqr.batchQty,
                mqr.batchQtyName,
                qcCnt.poBillDtld_count
            FROM po_bill
                INNER JOIN supplier AS sup ON po_bill.spName = sup.id
                LEFT JOIN po_bill_dtl AS po_bill_dtl ON po_bill.poNo = po_bill_dtl.poNo
                INNER JOIN po_main As poMain ON poMain.id = po_bill_dtl.poMainId
                INNER JOIN items AS i ON i.id = po_bill_dtl.itemName
                LEFT JOIN mst_item_group AS ig ON i.itemGroup = ig.id
                LEFT JOIN qc_rule AS qc ON ig.id = qc.itemGroupId
                LEFT JOIN mst_display_name AS d ON d.id = qc.displayName
                LEFT JOIN view_pobilldtld_counts AS qcCnt ON qcCnt.poBillDtlId = po_bill_dtl.id

                LEFT JOIN map_qc_rule AS mqr 
                  ON qc.id = mqr.qcRuleId 
                  AND po_bill_dtl.rcvdQty BETWEEN mqr.lotFrom AND mqr.lotTo
                WHERE po_bill.poNo = ? AND  po_bill.dflag = 0
                GROUP BY po_bill_dtl.id;
        `;

        const fetch2 = `
            SELECT * FROM po_bill_lot WHERE digit = ? AND type = ?;
        `;

        // Execute the first query and await the result
        const [dataResult] = await connection.query(fetch, [poNo]);

        // Check if any result is found for the first query
        if (dataResult.length === 0) {
            return res.status(404).json({ success: false, message: "No PO records found." });
        }

        // Execute the second query to fetch lotQtyData
        const [lotQtyData] = await connection.query(fetch2, [digit, prefix]);


        const companyData = await company();

        // Map each object in dataResult to include lotQtyData
        const data = dataResult.map((item) => ({
            ...item, // Spread the individual object
            lotQtyData,
            ...companyData // Add lotQtyData to each object
        }));

        // Send the response with the data array
        return res.status(200).json({
            success: true,
            message: "PO list",
            data
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};

exports.getItems = async (req, res) => {
    try {
        const { type, id, prefix } = req.query;
        const { fyFrom, fyTo } = formatFinancialYears(req);

        // Check if type is 'forward' or 'reverse' and validate the presence of 'id'
        if ((type === 'forward' || type === 'reverse') && (!id || id === '')) {
            return res.status(200).json({
                success: true,
                data: []
            });
        }

        // Determine mainId based on the type and id
        let mainIdQuery = '';
        let queryParams = [];

        switch (type) {
            case 'first':
                mainIdQuery = `
                    SELECT MIN(po.id) AS mainId
                    FROM po_bill AS po
                WHERE po.dflag = 0 ${prefix ? 'AND po.type = ?' : ''}
                `;
                if (prefix) queryParams.push(prefix);
                break;

            case 'last':
                mainIdQuery = `
                    SELECT MAX(po.id) AS mainId
                    FROM po_bill AS po
                WHERE po.dflag = 0 ${prefix ? 'AND po.type = ?' : ''}
                `;
                if (prefix) queryParams.push(prefix);
                break;

            case 'forward':
                mainIdQuery = `
                    SELECT MIN(po.id) AS mainId
                    FROM po_bill AS po
                    WHERE po.dflag = 0 AND po.id > ? AND po.type = ?
                `;
                queryParams = [id, prefix];
                break;

            case 'reverse':
                mainIdQuery = `
                    SELECT MAX(po.id) AS mainId
                    FROM po_bill AS po
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

        //  cur.name AS currency, cur.id AS currencyId,
        // LEFT JOIN mst_currency AS cur ON po_bill.currency = cur.id

        // Main query to fetch items based on the determined mainId
        let itemsQuery = ` 
            SELECT po_bill.*, po_bill.id AS mainId, po_bill_dtl.*, po_bill.id AS poBillId, poMain.poNo As mainPoNo, po_bill.qcApproval As qcFlag,
                sup.spCode, sup.spName AS suppName, itm.itemName, itm.id As itemId, itm.shelfLifeItem, itm.totStk As qoh, itm.conversionConcept,
                sup.id AS supId, sup.state, sup.country, po_bill_dtl.jcId, CONCAT(itm.itemCode, ', ', itm.itemName) As description,
                CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,              
                 po_bill_dtl.lot AS location,
                DATE_FORMAT(po_bill.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(po_bill.created_at, '%d-%m-%Y %H:%i:%s') AS created_at
            FROM po_bill
                INNER JOIN supplier AS sup ON po_bill.spName = sup.id
                LEFT JOIN po_bill_dtl AS po_bill_dtl ON po_bill.poNo = po_bill_dtl.poNo
                LEFT JOIN items AS itm ON po_bill_dtl.itemName = itm.id
                INNER JOIN po_main AS poMain ON poMain.id = po_bill_dtl.poMainId
            WHERE po_bill.dflag = 0 AND po_bill.id = ?
        `;

        const [rows] = await connection.execute(itemsQuery, [mainId]);


        const companyData = await company();


        // Fetch lotQtyData for each item in rows based on matching digit and itemId
        const resultWithLotQtyData = await Promise.all(rows.map(async row => {

            const fetchLotQuery = `
                SELECT * 
                FROM po_bill_lot 
                WHERE digit = ? AND type = ? AND itemId = ?
            `;
            const [lotQtyData] = await connection.execute(fetchLotQuery, [row.digit, row.type, row.itemId]);

            return {
                ...row,
                lotQtyData, // Add lotQtyData array for each item
                ...companyData //merge company info directly into each item

            };
        }));

        return res.status(200).json({
            success: true,
            data: resultWithLotQtyData
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


// QC Pending po_bill ShowData
exports.pending = async (req, res) => {
    let conn;
    try {
        conn = await connection.getConnection();

        /* ---------------- UPDATE QC APPROVAL ---------------- */
        await conn.query(`
            UPDATE po_bill pb
            SET pb.qcApproval = 1
            WHERE pb.dflag = 0
              AND NOT EXISTS (
                  SELECT 1
                  FROM po_bill_dtl pbd
                  WHERE pbd.poNo = pb.poNo
                    AND pbd.qcApproval != 1
              )
        `);

        /* ---------------- FETCH PENDING DATA ---------------- */
        const fetch = `
            SELECT 
                pb.id,
                pb.poNo,
                pb.type,
                pb.suppInvNo,
                pb.csSuppDcNo,
                pb.digit,
                pb.qcApproval,
                sup.spCode,
                sup.spName AS suppName,
                sup.id AS supId,
                DATE_FORMAT(pb.suppInvoiceDate, '%d-%m-%Y') AS suppInvoiceDate,
                DATE_FORMAT(pb.suppDcDate, '%d-%m-%Y') AS suppDcDate,
                DATE_FORMAT(pb.date, '%d-%m-%Y') AS date
            FROM po_bill pb
                INNER JOIN supplier sup ON pb.spName = sup.id
            WHERE pb.dflag = 0
              AND pb.qcApproval = 0
            ORDER BY pb.date DESC
        `;

        const [results] = await conn.query(fetch);

        // Auto S.No
        results.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return handleSuccessResponse(res, "PO Bill Pending QC List", results);

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
                po_bill.id As mainId, DATE_FORMAT(po_bill.date, '%d-%m-%Y') AS poDate, po_bill.poNo,
                po_bill.suppInvNo,  po_bill.suppInvoiceDate, po_bill.csSuppDcNo,  po_bill.suppDcDate, 
                pbd.poQty, pbd.invQty, pbd.rcvdQty, pbd.accQty, pbd.rejQty, pbd.lndCost, pbd.lndRate, 
                pbd.pbRate, pbd.pbAmt, pbd.itemRemarks, 
                DATE_FORMAT(pbd.schDate, '%d-%m-%Y') AS schDate, itm.poQty AS pendingPo,
                itm.itemCode, itm.itemName, itm.id AS itemId, itmGrp.name AS itemGroup,
                uomTab.name as uomName, sup.spName, sup.spCode, sup.gstNo, sup.id AS supplierId
            FROM 
                po_bill
            RIGHT JOIN 
                po_bill_dtl as pbd ON po_bill.poNo = pbd.poNo
            INNER JOIN 
                supplier as sup ON po_bill.spName = sup.id
            INNER JOIN 
                items as itm ON pbd.itemName = itm.id
            LEFT JOIN
                mst_uom as uomTab ON pbd.uom = uomTab.id
            LEFT JOIN
                mst_item_group as itmGrp ON itmGrp.id = itm.itemGroup
            WHERE 
                po_bill.dflag = 0 AND pbd.dflag = 0 
        `;

        // Collect conditions
        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(po_bill.created_at) BETWEEN ? AND ?');
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

        return res.status(200).json({
            success: true,
            message: "Po list",
            data: rows
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};




exports.postPoReport = async (req, res) => {
    try {
        const { fromDate, toDate, category, supplier: sup } = req.body;

        const sharedConditions = [];
        const sharedParams = [];

        // Date condition
        if (fromDate && toDate) {
            sharedConditions.push(`DATE(pb.date) BETWEEN ? AND ?`);
            sharedParams.push(fromDate, toDate);
        }

        // Supplier condition
        if (Array.isArray(sup) && sup.length > 0) {
            const placeholders = sup.map(() => '?').join(', ');
            sharedConditions.push(`sup.id IN (${placeholders})`);
            sharedParams.push(...sup);
        }


        // Query builder
        const buildCategoryQuery = (table, joinKey, joinKey2) => {
            const localConditions = [];
            const localParams = [];

            let baseQuery = `
                SELECT 
                    pb.id AS mainId, pb.poNo, DATE_FORMAT(pb.date, '%d-%m-%Y') AS date, DATE_FORMAT(pb.schDate, '%d-%m-%Y') AS schDate, po.suppInvNo, 
                    DATE_FORMAT(po.suppInvoiceDate, '%d-%m-%Y') AS suppInvoiceDate,  pb.uom, pb.invQty, pb.rcvdQty, pb.accQty, pb.rejQty, pb.itemRemarks,  
                    sup.spName, sup.spCode, sup.gstNo, i.itemCode, i.itemName

                FROM 
                    ${table} pb
                INNER JOIN 
                    supplier AS sup ON pb.${joinKey} = sup.id
                INNER JOIN 
                    po_bill AS po ON pb.poNo= po.poNo    
                INNER JOIN 
                    items AS i ON pb.${joinKey2} = i.id   
                LEFT JOIN 
                    mst_currency AS cur ON cur.id = sup.currency
                WHERE 
                    pb.dflag = 0 AND pb.itemRemarks IS NOT NULL AND pb.itemRemarks != ""
            `;



            if (sharedConditions.length > 0) {
                localConditions.push(...sharedConditions);
                localParams.push(...sharedParams);
            }

            if (localConditions.length > 0) {
                baseQuery += ' AND ' + localConditions.join(' AND ');
            }

            return { query: baseQuery, params: localParams };
        };

        // Build queries
        const queries = [];
        const queryParams = [];

        if (category == 0) {
            const q1 = buildCategoryQuery('po_bill_dtl', 'spName', 'itemName');
            const q2 = buildCategoryQuery('pob_wo_po_dtl', 'supId', 'itemId');
            queries.push(q1.query, q2.query);
            queryParams.push(...q1.params, ...q2.params);
        } else if (category == 1) {
            const q = buildCategoryQuery('po_bill_dtl', 'spName', 'itemName');
            queries.push(q.query);
            queryParams.push(...q.params);
        } else if (category == 2) {
            const q = buildCategoryQuery('pob_wo_po_dtl', 'supId', 'itemId');
            queries.push(q.query);
            queryParams.push(...q.params);
        }

        const finalQuery = queries.join(' UNION ALL ') + ' ORDER BY date DESC';

        const [rows] = await connection.execute(finalQuery, queryParams);

        // Add serial numbers
        rows.forEach((row, index) => {
            row.id = index + 1;
            row.sNo = index + 1;
        });

        return res.status(200).json({
            success: true,
            message: "PoBill  Inward Discrepancy ",
            data: rows
        });

    } catch (err) {
        console.error("Error in summary:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};




exports.summary = async (req, res) => {
    try {
        const { from: fromDate, to: toDate, category, type, supplier: sup } = req.body;

        const sharedConditions = [];
        const sharedParams = [];

        /* ---------- DATE FILTER ---------- */
        if (fromDate && toDate) {
            sharedConditions.push(`DATE(pb.date) BETWEEN ? AND ?`);
            sharedParams.push(fromDate, toDate);
        }

        /* ---------- SUPPLIER FILTER ---------- */
        if (Array.isArray(sup) && sup.length > 0) {
            const placeholders = sup.map(() => '?').join(', ');
            sharedConditions.push(`sup.id IN (${placeholders})`);
            sharedParams.push(...sup);
        }

        /* ---------- ACCOUNTABLE FILTER ---------- */
        const accountableFilter = (type == 0 || type == 1) ? type : null;

        /* ---------- QUERY BUILDER ---------- */
        const buildCategoryQuery = (cat, table, joinKey) => {
            const localConditions = [];
            const localParams = [];

            // 🔹 DETAIL TABLE JOIN (CATEGORY-WISE)
            const detailJoin =
                cat === 1
                    ? `LEFT JOIN po_bill_dtl dtl ON dtl.poNo = pb.poNo`
                    : `LEFT JOIN pob_wo_po_dtl dtl ON dtl.poNo = pb.poNo`;

            let baseQuery = `
                SELECT 
                    pb.id AS mainId, pb.poNo, DATE_FORMAT(pb.date, '%d-%m-%Y') AS pbDate,
                    pb.grnRefNO, pb.suppInvNo, pb.suppInvoiceDate, pb.csSuppDcNo,

                    ${cat === 1 ? 'pb.suppDcDate' : 'pb.suppDcRate'} AS suppDcDate,
                    ${cat === 1 ? 'pb.totalWithGST' : 'pb.subTotal'} AS totalWithGST,

                    pb.irNo, pb.carNo, pb.binNo, pb.exgRate, pb.currency, pb.gstType, pb.remarks, pb.qcAuthorize, pb.qcAuthorizeBy, 
                    pb.qcAuthorizeDate, pb.qcRemarks, pb.totalQty,pb.grossAmount, pb.lessDiscount, pb.transport, pb.coolie, pb.subTotal, pb.cgst,
                    pb.cgstPer, pb.sgst, pb.sgstPer, pb.utgst, pb.utgstPer, pb.total, pb.tds, pb.tdsPer, pb.tcs, pb.tcsPer, pb.igst, pb.igstPer, pb.others,
                    pb.boeNo, pb.boeDate, pb.miscCharges, pb.subTotalGrsAndMisc, pb.insurance, pb.insurancePer, pb.freight, pb.subTotalINSAndFreight,

                    ROUND(pb.exgRate * pb.grossAmount, 3) AS grossAmountINR,

                    pb.bcd, pb.bcdPer, pb.socialWelfareCharges, pb.swcPer, pb.subTotalSwAndBCD, pb.importGST, pb.importGstPer, pb.freightCharges, pb.localClearanceCharges,
                    pb.grandTotal, pb.file, pb.statusSign, pb.status, pb.user,

                    sup.spName, sup.spCode, sup.gstNo, cur.code AS currencyCode,

                    CASE 
                        WHEN pb.accountable = 1 THEN 'Accountable'
                        ELSE 'Non-Accountable'
                    END AS docType,

                    -- 🔹 REQUIRED AGGREGATE
                    COALESCE(SUM(dtl.rejQty), 0) AS totalRejQty

                FROM ${table} pb
                INNER JOIN supplier sup ON pb.${joinKey} = sup.id
                LEFT JOIN mst_currency cur ON cur.id = sup.currency
                ${detailJoin}

                WHERE pb.dflag = 0
            `;

            if (accountableFilter !== null) {
                localConditions.push(`pb.accountable = ?`);
                localParams.push(accountableFilter);
            }

            if (sharedConditions.length > 0) {
                localConditions.push(...sharedConditions);
                localParams.push(...sharedParams);
            }

            if (localConditions.length > 0) {
                baseQuery += ' AND ' + localConditions.join(' AND ');
            }

            // 🔹 IMPORTANT FOR SUM()
            baseQuery += ` GROUP BY pb.id`;

            return { query: baseQuery, params: localParams };
        };

        /* ---------- BUILD QUERIES ---------- */
        const queries = [];
        const queryParams = [];

        if (category == 0) {
            const q1 = buildCategoryQuery(1, 'po_bill', 'spName');
            const q2 = buildCategoryQuery(2, 'pob_wo_po', 'supId');
            queries.push(q1.query, q2.query);
            queryParams.push(...q1.params, ...q2.params);
        } else if (category == 1) {
            const q = buildCategoryQuery(1, 'po_bill', 'spName');
            queries.push(q.query);
            queryParams.push(...q.params);
        } else if (category == 2) {
            const q = buildCategoryQuery(2, 'pob_wo_po', 'supId');
            queries.push(q.query);
            queryParams.push(...q.params);
        }

        const finalQuery = queries.join(' UNION ALL ') + ' ORDER BY pbDate DESC';

        const [rows] = await connection.execute(finalQuery, queryParams);

        /* ---------- SERIAL NUMBERS ---------- */
        rows.forEach((row, index) => {
            row.id = index + 1;
            row.sNo = index + 1;
        });

        return res.status(200).json({
            success: true,
            message: "PoBill Summary",
            data: rows
        });

    } catch (err) {
        console.error("Error in summary:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "An error occurred"
        });
    }
};

//Working code Not Optimized
// exports.detailed = async (req, res) => {
//     try {
//         const { from: fromDate, to: toDate, supplier: sup, items: item, itmGrp, category, type } = req.body;

//         const sharedConditions = [];
//         const sharedParams = [];
//         const accountableFilter = (type == 0 || type == 1) ? type : null;

//         if (fromDate && toDate) {
//             sharedConditions.push(`DATE(pb.date) BETWEEN ? AND ?`);
//             sharedParams.push(fromDate, toDate);
//         }

//         if (Array.isArray(sup) && sup.length > 0) {
//             sharedConditions.push(`sup.id IN (${sup.map(() => '?').join(', ')})`);
//             sharedParams.push(...sup);
//         }

//         if (Array.isArray(item) && item.length > 0) {
//             sharedConditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
//             sharedParams.push(...item);
//         }

//         if (Array.isArray(itmGrp) && itmGrp.length > 0) {
//             sharedConditions.push(`itmGrp.id IN (${itmGrp.map(() => '?').join(', ')})`);
//             sharedParams.push(...itmGrp);
//         }

//         const buildCategoryQuery = (cat, pbTable, pbDtlTable, pbJoinKey) => {
//             const localConditions = [];
//             const localParams = [];
//             //pb.grossAmountINR,

//             // INNER JOIN 
//             // items AS itm ON pbd.itemName = itm.id
//             let baseQuery = `
//             SELECT 
//                 pb.id AS mainId, pb.poNo, DATE_FORMAT(pb.date, '%d-%m-%Y') AS poDate, pb.suppInvNo, pb.suppInvoiceDate, pb.csSuppDcNo, pb.accountable, pb.qcRemarks, pb.gstType, 
//                 pb.qcAuthorizeBy, pb.exgRate,  pb.grandTotal, pb.user, pb.grnRefNO, pb.transport, pb.coolie, pb.importGST, pb.importGstPer, pb.subTotalINSAndFreight,  
//                 pb.boeNo, pb.boeDate, pb.miscCharges, pb.bcd, pb.bcdPer, pb.socialWelfareCharges, pb.swcPer, pb.subTotalSwAndBCD, pb.freightCharges, pb.localClearanceCharges,
//                 pb.cgst, pb.cgstPer, pb.sgst, pb.sgstPer, pb.utgst, pb.utgstPer, pb.tcs, pb.tcsPer, pb.igst, pb.igstPer, pb.others, pb.lessDiscount, pb.grossAmountINR, 
//                 ${cat === 1 ? 'pb.suppDcDate' : 'pb.suppDcRate'} AS suppDcDate, ${cat === 1 ? 'pb.totalWithGST' : 'pb.subTotal'} AS totalWithGST, 
//                 pbd.poQty, pbd.invQty, pbd.rcvdQty, pbd.accQty, pbd.rejQty, pbd.lndCost, pbd.lndRate,  pbd.itemRemarks, ROUND(pb.exgRate * pb.grossAmount, 3) AS grossAmountINR,
//                 CASE 
//                     WHEN pb.gstType = 'IGST' 
//                     THEN ROUND(pbd.pbRate * pb.exgRate, 3)
//                     ELSE pbd.pbRate
//                 END AS pbRate,

//                 CASE 
//                     WHEN pb.gstType = 'IGST' 
//                     THEN ROUND((pbd.pbRate * pb.exgRate) * pbd.rcvdQty, 3)
//                     ELSE pbd.pbAmt
//                 END AS pbAmt,
//                 DATE_FORMAT(pbd.schDate, '%d-%m-%Y') AS schDate, itm.poQty AS pendingPo, itm.itemCode, itm.itemName, itm.id AS itemId, 
//                 itmGrp.name AS itemGroup, pFam.name AS productFamily,  pbd.uom AS uomName, cur.code AS currencyCode, 
//                 sup.id AS supplierId, sup.spName, sup.spCode, sup.gstNo, sup.paymentTerms, svi.suppDesc, a.firstAuthBy, a.secondAuthBy,
//                 ${cat === 1 ? 'po_main.refNoDate' : 'NULL'} AS refNoDate, ${cat === 1 ? 'po_main.poNo' : 'NULL'} AS printPoNo, ${cat} AS sourceType
//             FROM 
//                 ${pbTable} pb
//             LEFT JOIN 
//                 ${pbDtlTable} pbd ON ${pbTable === 'po_bill'
//                     ? 'pb.digit = pbd.digit AND pb.type = pbd.type'
//                     : 'pbd.poNo = pb.poNo'
//                 }
//             INNER JOIN 
//                 supplier AS sup ON pb.${pbJoinKey} = sup.id
//             INNER JOIN 
//                 items AS itm ON ${pbDtlTable === 'po_bill_dtl'
//                     ? 'pbd.itemName = itm.id'
//                     : 'pbd.itemId = itm.id'
//                 }
                
//             LEFT JOIN 
//                 supp_vs_item AS svi ON pbd.${pbJoinKey} = svi.spName AND itm.id = svi.itemName     
          
//             LEFT JOIN 
//                 mst_item_group AS itmGrp ON itmGrp.id = itm.itemGroup
//             LEFT JOIN 
//                 mst_currency AS cur ON cur.id = sup.currency
//             LEFT JOIN 
//                 auth_docs AS a ON a.refNo = pb.poNo
//             LEFT JOIN 
//                 item_product_family AS pFam ON pFam.id = itm.productFamily
//             ${cat === 1 ? 'LEFT JOIN po_main ON po_main.id = pb.poMainId' : ''}
//             WHERE 
//                 pb.dflag = 0 AND (pbd.dflag = 0 OR pbd.dflag IS NULL)
//         `;

//             if (accountableFilter !== null) {
//                 localConditions.push(`pb.accountable = ?`);
//                 localParams.push(accountableFilter);
//             }

//             if (sharedConditions.length > 0) {
//                 localConditions.push(...sharedConditions);
//                 localParams.push(...sharedParams);
//             }

//             if (localConditions.length > 0) {
//                 baseQuery += ' AND ' + localConditions.join(' AND ');
//             }

//             return { query: baseQuery, params: localParams };
//         };

//         const queries = [];
//         const queryParams = [];

//         if (category == 0) {
//             const q1 = buildCategoryQuery(1, 'po_bill', 'po_bill_dtl', 'spName');
//             const q2 = buildCategoryQuery(2, 'pob_wo_po', 'pob_wo_po_dtl', 'supId');
//             queries.push(q1.query, q2.query);
//             queryParams.push(...q1.params, ...q2.params);
//         } else if (category == 1) {
//             const q = buildCategoryQuery(1, 'po_bill', 'po_bill_dtl', 'spName');
//             queries.push(q.query);
//             queryParams.push(...q.params);
//         } else if (category == 2) {
//             const q = buildCategoryQuery(2, 'pob_wo_po', 'pob_wo_po_dtl', 'supId');
//             queries.push(q.query);
//             queryParams.push(...q.params);
//         }

//         const finalQuery = queries.join(' UNION ALL ') + ' ORDER BY poDate DESC';
//         const [rows] = await connection.execute(finalQuery, queryParams);

//         rows.forEach((row, index) => {
//             row.sNo = index + 1;
//         });

//         return res.status(200).json({
//             success: true,
//             message: "Detailed Po Report",
//             data: rows
//         });

//     } catch (err) {
//         console.error("Error in detailed:", err);
//         return res.status(err.statusCode || 500).json({
//             success: false,
//             message: err.message || 'An error occurred'
//         });
//     }
// };

exports.detailed = async (req, res) => {
    try {
        const {
            from: fromDate, to: toDate,
            supplier: sup, items: item,
            itmGrp, category, type
        } = req.body;

        const sharedConditions = [];
        const sharedParams     = [];
        const accountableFilter = (type == 0 || type == 1) ? type : null;

        // ✅ FIX 1: Avoid DATE() wrapper — use range on raw column so index is used
        if (fromDate && toDate) {
            sharedConditions.push(`pb.date >= ? AND pb.date < DATE_ADD(?, INTERVAL 1 DAY)`);
            sharedParams.push(fromDate, toDate);
        }

        if (Array.isArray(sup)    && sup.length    > 0) {
            sharedConditions.push(`sup.id IN (${sup.map(() => '?').join(', ')})`);
            sharedParams.push(...sup);
        }
        if (Array.isArray(item)   && item.length   > 0) {
            sharedConditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
            sharedParams.push(...item);
        }
        if (Array.isArray(itmGrp) && itmGrp.length > 0) {
            sharedConditions.push(`itmGrp.id IN (${itmGrp.map(() => '?').join(', ')})`);
            sharedParams.push(...itmGrp);
        }

        const buildCategoryQuery = (cat, pbTable, pbDtlTable, pbJoinKey) => {
            const localConditions = [...sharedConditions];
            const localParams     = [...sharedParams];

            if (accountableFilter !== null) {
                localConditions.push(`pb.accountable = ?`);
                localParams.push(accountableFilter);
            }

            // ✅ FIX 2: Remove DATE_FORMAT() — format dates in JS after fetch (saves CPU on 4000+ rows)
            // ✅ FIX 3: Compute grossAmountINR only once using a subquery/alias — no duplicate ROUND()
            // ✅ FIX 4: Drop auth_docs from JOIN — fetch separately below to avoid per-row full scan
            const baseQuery = `
            SELECT
                pb.id AS mainId, pb.poNo, pb.date AS poDate,
                pb.suppInvNo, pb.suppInvoiceDate, pb.csSuppDcNo, pb.accountable,
                pb.qcRemarks, pb.gstType, pb.qcAuthorizeBy, pb.exgRate,
                pb.grandTotal, pb.user, pb.grnRefNO, pb.transport, pb.coolie,
                pb.importGST, pb.importGstPer, pb.subTotalINSAndFreight,
                pb.boeNo, pb.boeDate, pb.miscCharges, pb.bcd, pb.bcdPer,
                pb.socialWelfareCharges, pb.swcPer, pb.subTotalSwAndBCD,
                pb.freightCharges, pb.localClearanceCharges,
                pb.cgst, pb.cgstPer, pb.sgst, pb.sgstPer,
                pb.utgst, pb.utgstPer, pb.tcs, pb.tcsPer,
                pb.igst, pb.igstPer, pb.others, pb.lessDiscount, pb.grossAmountINR,

                ${cat === 1 ? 'pb.suppDcDate' : 'pb.suppDcRate'} AS suppDcDate,
                ${cat === 1 ? 'pb.totalWithGST' : 'pb.subTotal'} AS totalWithGST,

                pbd.poQty, pbd.invQty, pbd.rcvdQty, pbd.accQty, pbd.rejQty,
                pbd.lndCost, pbd.lndRate, pbd.itemRemarks,
                pbd.schDate,

                -- ✅ Single ROUND() — no duplicate computation
                ROUND(pb.exgRate * pb.grossAmount, 3) AS grossAmountINR,

                CASE
                    WHEN pb.gstType = 'IGST'
                    THEN ROUND(pbd.pbRate * pb.exgRate, 3)
                    ELSE pbd.pbRate
                END AS pbRate,

                CASE
                    WHEN pb.gstType = 'IGST'
                    THEN ROUND((pbd.pbRate * pb.exgRate) * pbd.rcvdQty, 3)
                    ELSE pbd.pbAmt
                END AS pbAmt,

                itm.poQty AS pendingPo, itm.itemCode, itm.itemName, itm.id AS itemId,
                itmGrp.name AS itemGroup,
                pFam.name AS productFamily,
                pbd.uom AS uomName,
                cur.code AS currencyCode,
                sup.id AS supplierId, sup.spName, sup.spCode, sup.gstNo,
                sup.paymentTerms, svi.suppDesc,

                -- ✅ auth_docs columns returned as NULL — joined separately after fetch
                NULL AS firstAuthBy, NULL AS secondAuthBy,

                ${cat === 1 ? 'po_main.refNoDate' : 'NULL'} AS refNoDate,
                ${cat === 1 ? 'po_main.poNo'      : 'NULL'} AS printPoNo,
                ${cat} AS sourceType

            FROM ${pbTable} pb

            LEFT JOIN ${pbDtlTable} pbd ON pbd.poNo = pb.poNo

            INNER JOIN supplier AS sup
                ON pb.${pbJoinKey} = sup.id
            INNER JOIN items AS itm
                ON ${pbDtlTable === 'po_bill_dtl' ? 'pbd.itemName = itm.id' : 'pbd.itemId = itm.id'}
            LEFT JOIN supp_vs_item AS svi
                ON pbd.${pbJoinKey} = svi.spName AND itm.id = svi.itemName
            LEFT JOIN mst_item_group AS itmGrp
                ON itmGrp.id = itm.itemGroup
            LEFT JOIN mst_currency AS cur
                ON cur.id = sup.currency
            LEFT JOIN item_product_family AS pFam
                ON pFam.id = itm.productFamily
            ${cat === 1 ? 'LEFT JOIN po_main ON po_main.id = pb.poMainId' : ''}

            WHERE pb.dflag = 0
              AND (pbd.dflag = 0 OR pbd.dflag IS NULL)
              ${localConditions.length > 0 ? 'AND ' + localConditions.join(' AND ') : ''}
            `;

            return { query: baseQuery, params: localParams };
        };

        // Build UNION ALL
        const queries     = [];
        const queryParams = [];

        if (category == 0) {
            const q1 = buildCategoryQuery(1, 'po_bill',    'po_bill_dtl',    'spName');
            const q2 = buildCategoryQuery(2, 'pob_wo_po',  'pob_wo_po_dtl',  'supId');
            queries.push(q1.query, q2.query);
            queryParams.push(...q1.params, ...q2.params);
        } else if (category == 1) {
            const q = buildCategoryQuery(1, 'po_bill', 'po_bill_dtl', 'spName');
            queries.push(q.query);
            queryParams.push(...q.params);
        } else if (category == 2) {
            const q = buildCategoryQuery(2, 'pob_wo_po', 'pob_wo_po_dtl', 'supId');
            queries.push(q.query);
            queryParams.push(...q.params);
        }

        const finalQuery = queries.join(' UNION ALL ') + ' ORDER BY mainId ASC';
        const [rows] = await connection.execute(finalQuery, queryParams);

        // ✅ FIX 5: Batch-fetch auth_docs by poNo list (1 query instead of N per-row joins)
        let authMap = {};
        if (rows.length > 0) {
            const poNos = [...new Set(rows.map(r => r.poNo).filter(Boolean))];
            if (poNos.length > 0) {
                const placeholders = poNos.map(() => '?').join(', ');
                const [authRows] = await connection.execute(
                    `SELECT refNo, firstAuthBy, secondAuthBy FROM auth_docs WHERE refNo IN (${placeholders})`,
                    poNos
                );
                authMap = Object.fromEntries(authRows.map(a => [a.refNo, a]));
            }
        }

        // ✅ FIX 6: Format dates in JS — much faster than DATE_FORMAT() on 4000+ rows in SQL
        const pad  = n => String(n).padStart(2, '0');
        const fmtDate = raw => {
            if (!raw) return null;
            const d = new Date(raw);
            return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
        };

        rows.forEach((row, index) => {
            row.sNo         = index + 1;
            row.poDate      = fmtDate(row.poDate);
            row.schDate     = fmtDate(row.schDate);
            // Merge auth_docs data
            const auth      = authMap[row.poNo] || {};
            row.firstAuthBy  = auth.firstAuthBy  ?? null;
            row.secondAuthBy = auth.secondAuthBy ?? null;
        });

        return res.status(200).json({
            success: true,
            message: "Detailed Po Report",
            data: rows
        });

    } catch (err) {
        console.error("Error in detailed:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};


//Pagination Code
// exports.detailed = async (req, res) => {
//     try {
//         // 1. Extract inputs (Prioritize Body Payload as requested)
//         let { from: fromDate, to: toDate, supplier: sup, items: item, itmGrp, category, type, page = 1, limit = 100 } = req.body;
        
//         // Ensure integers
//         page = parseInt(page);
//         limit = parseInt(limit);
//         const offset = (page - 1) * limit;

//         // --- 2. Filter Logic ---
//         const commonConditions = [];
//         const commonParams = [];
        
//         let needSupJoin = false;
//         let needItemJoin = false;
//         let needItmGrpJoin = false;

//         const accountableFilter = (type == 0 || type == 1) ? type : null;

//         if (fromDate && toDate) {
//             commonConditions.push(`DATE(pb.date) BETWEEN ? AND ?`);
//             commonParams.push(fromDate, toDate);
//         }

//         if (Array.isArray(sup) && sup.length > 0) {
//             needSupJoin = true; 
//             commonConditions.push(`sup.id IN (${sup.map(() => '?').join(', ')})`);
//             commonParams.push(...sup);
//         }

//         if (Array.isArray(item) && item.length > 0) {
//             needItemJoin = true; 
//             commonConditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
//             commonParams.push(...item);
//         }

//         if (Array.isArray(itmGrp) && itmGrp.length > 0) {
//             needItemJoin = true; 
//             needItmGrpJoin = true; 
//             commonConditions.push(`itmGrp.id IN (${itmGrp.map(() => '?').join(', ')})`);
//             commonParams.push(...itmGrp);
//         }

//         // --- 3. Optimized Query Builder ---
//         const buildMinimalQuery = (cat, pbTable, pbDtlTable, pbJoinKey, isCount) => {
//             let query = `FROM ${pbTable} pb `;
//             const params = [];

//             // [CRITICAL CHANGE]: Always join Detail table because we paginate by Line Item
//             query += `JOIN ${pbDtlTable} pbd ON ${pbTable === 'po_bill' 
//                 ? 'pb.digit = pbd.digit AND pb.type = pbd.type' 
//                 : 'pbd.poNo = pb.poNo'} `;

//             if (needSupJoin) query += `INNER JOIN supplier AS sup ON pb.${pbJoinKey} = sup.id `;
//             if (needItemJoin) query += `INNER JOIN items AS itm ON ${pbDtlTable === 'po_bill_dtl' ? 'pbd.itemName = itm.id' : 'pbd.itemId = itm.id'} `;
//             if (needItmGrpJoin) query += `LEFT JOIN mst_item_group AS itmGrp ON itmGrp.id = itm.itemGroup `;

//             query += `WHERE pb.dflag = 0 AND (pbd.dflag = 0 OR pbd.dflag IS NULL) `;

//             if (accountableFilter !== null) {
//                 query += `AND pb.accountable = ? `;
//                 params.push(accountableFilter);
//             }
            
//             if (commonConditions.length > 0) {
//                 query += ' AND ' + commonConditions.join(' AND ');
//                 params.push(...commonParams);
//             }

//             if (isCount) {
//                 return { query: `SELECT COUNT(*) as total ${query}`, params };
//             } else {
//                 // [CRITICAL CHANGE]: Select pbd.id (Detail ID) instead of pb.id
//                 // This ensures we get unique IDs for every single row in the final report
//                 return { query: `SELECT pbd.id as detailId, pb.date as sortDate, ${cat} as originCat ${query}`, params };
//             }
//         };

//         // --- 4. Execution: Count & ID Fetch ---
        
//         const countPromises = [];
//         // Helper to add query only if category matches
//         if (category == 0 || category == 1) {
//             const q = buildMinimalQuery(1, 'po_bill', 'po_bill_dtl', 'spName', true);
//             countPromises.push(connection.execute(q.query, q.params));
//         }
//         if (category == 0 || category == 2) {
//             const q = buildMinimalQuery(2, 'pob_wo_po', 'pob_wo_po_dtl', 'supId', true);
//             countPromises.push(connection.execute(q.query, q.params));
//         }

//         const idQueries = [];
//         const idParams = [];
//         if (category == 0 || category == 1) {
//             const q = buildMinimalQuery(1, 'po_bill', 'po_bill_dtl', 'spName', false);
//             idQueries.push(q.query);
//             idParams.push(...q.params);
//         }
//         if (category == 0 || category == 2) {
//             const q = buildMinimalQuery(2, 'pob_wo_po', 'pob_wo_po_dtl', 'supId', false);
//             idQueries.push(q.query);
//             idParams.push(...q.params);
//         }
        
//         // Fetch strictly 'limit' number of Detail IDs
//         const finalIdQuery = idQueries.join(' UNION ALL ') + ' ORDER BY sortDate DESC LIMIT ? OFFSET ?';
//         idParams.push(limit, offset);

//         const [countResults, [idRows]] = await Promise.all([
//             Promise.all(countPromises),
//             connection.execute(finalIdQuery, idParams)
//         ]);

//         let total = 0;
//         countResults.forEach(([rows]) => {
//             if (rows && rows[0]) total += rows[0].total;
//         });
//         const totalPages = Math.ceil(total / limit);

//         if (idRows.length === 0) {
//             return res.status(200).json({ success: true, message: "Detailed Po Report", page, total, totalPages, data: [] });
//         }

//         // --- 5. Fetch Full Data (Using Detail IDs) ---
//         const cat1Ids = idRows.filter(r => r.originCat === 1).map(r => r.detailId);
//         const cat2Ids = idRows.filter(r => r.originCat === 2).map(r => r.detailId);

//         const buildFullDataQuery = (cat, pbTable, pbDtlTable, pbJoinKey, detailIds) => {
//             const select = `
//             SELECT 
//                 pb.id AS mainId, pbd.id AS detailId, pb.poNo, DATE_FORMAT(pb.date, '%d-%m-%Y') AS poDate, pb.suppInvNo, pb.suppInvoiceDate, pb.csSuppDcNo, pb.accountable, pb.qcRemarks, pb.gstType, 
//                 pb.qcAuthorizeBy, pb.exgRate,  pb.grandTotal, pb.user, pb.grnRefNO, pb.transport, pb.coolie, pb.importGST, pb.importGstPer, pb.subTotalINSAndFreight,  
//                 pb.boeNo, pb.boeDate, pb.miscCharges, pb.bcd, pb.bcdPer, pb.socialWelfareCharges, pb.swcPer, pb.subTotalSwAndBCD, pb.freightCharges, pb.localClearanceCharges,
//                 pb.cgst, pb.cgstPer, pb.sgst, pb.sgstPer, pb.utgst, pb.utgstPer, pb.tcs, pb.tcsPer, pb.igst, pb.igstPer, pb.others, pb.lessDiscount, pb.grossAmountINR, 
//                 ${cat === 1 ? 'pb.suppDcDate' : 'pb.suppDcRate'} AS suppDcDate, ${cat === 1 ? 'pb.totalWithGST' : 'pb.subTotal'} AS totalWithGST, 
//                 pbd.poQty, pbd.invQty, pbd.rcvdQty, pbd.accQty, pbd.rejQty, pbd.lndCost, pbd.lndRate,  pbd.itemRemarks, ROUND(pb.exgRate * pb.grossAmount, 3) AS grossAmountINR,
//                 CASE WHEN pb.gstType = 'IGST' THEN ROUND(pbd.pbRate * pb.exgRate, 3) ELSE pbd.pbRate END AS pbRate,
//                 CASE WHEN pb.gstType = 'IGST' THEN ROUND((pbd.pbRate * pb.exgRate) * pbd.rcvdQty, 3) ELSE pbd.pbAmt END AS pbAmt,
//                 DATE_FORMAT(pbd.schDate, '%d-%m-%Y') AS schDate, itm.poQty AS pendingPo, itm.itemCode, itm.itemName, itm.id AS itemId, 
//                 itmGrp.name AS itemGroup, pFam.name AS productFamily,  pbd.uom AS uomName, cur.code AS currencyCode, 
//                 sup.id AS supplierId, sup.spName, sup.spCode, sup.gstNo, sup.paymentTerms, svi.suppDesc, a.firstAuthBy, a.secondAuthBy,
//                 ${cat === 1 ? 'po_main.refNoDate' : 'NULL'} AS refNoDate, ${cat === 1 ? 'po_main.poNo' : 'NULL'} AS printPoNo, ${cat} AS sourceType
//             `;

//             // [CRITICAL CHANGE]: WHERE clause now filters by pbd.id (Detail ID)
//             return `
//                 ${select}
//                 FROM ${pbTable} pb
//                 LEFT JOIN ${pbDtlTable} pbd ON ${pbTable === 'po_bill' ? 'pb.digit = pbd.digit AND pb.type = pbd.type' : 'pbd.poNo = pb.poNo'}
//                 INNER JOIN supplier AS sup ON pb.${pbJoinKey} = sup.id
//                 INNER JOIN items AS itm ON ${pbDtlTable === 'po_bill_dtl' ? 'pbd.itemName = itm.id' : 'pbd.itemId = itm.id'}
//                 LEFT JOIN supp_vs_item AS svi ON pbd.${pbJoinKey} = svi.spName AND itm.id = svi.itemName     
//                 LEFT JOIN mst_item_group AS itmGrp ON itmGrp.id = itm.itemGroup
//                 LEFT JOIN mst_currency AS cur ON cur.id = sup.currency
//                 LEFT JOIN auth_docs AS a ON a.refNo = pb.poNo
//                 LEFT JOIN item_product_family AS pFam ON pFam.id = itm.productFamily
//                 ${cat === 1 ? 'LEFT JOIN po_main ON po_main.id = pb.poMainId' : ''}
//                 WHERE pbd.id IN (${detailIds.map(() => '?').join(', ')})
//             `;
//         };

//         const finalQueries = [];
//         const finalParams = [];

//         if (cat1Ids.length > 0) {
//             finalQueries.push(buildFullDataQuery(1, 'po_bill', 'po_bill_dtl', 'spName', cat1Ids));
//             finalParams.push(...cat1Ids);
//         }
//         if (cat2Ids.length > 0) {
//             finalQueries.push(buildFullDataQuery(2, 'pob_wo_po', 'pob_wo_po_dtl', 'supId', cat2Ids));
//             finalParams.push(...cat2Ids);
//         }

//         const [fullRows] = await connection.execute(finalQueries.join(' UNION ALL '), finalParams);

//         // --- 6. Restore Order ---
//         // Map unique Detail IDs to their original sort index
//         const orderMap = new Map();
//         idRows.forEach((row, index) => {
//             orderMap.set(`${row.originCat}-${row.detailId}`, index);
//         });

//         // Sort the heavy data to match the ID query order
//         fullRows.sort((a, b) => {
//             const indexA = orderMap.get(`${a.sourceType}-${a.detailId}`);
//             const indexB = orderMap.get(`${b.sourceType}-${b.detailId}`);
//             return indexA - indexB;
//         });

//         let sNo = offset + 1;
//         fullRows.forEach(row => row.sNo = sNo++);

//         return res.status(200).json({
//             success: true,
//             message: "Detailed Po Report",
//             page,
//             total,
//             totalPages,
//             data: fullRows
//         });

//     } catch (err) {
//         console.error("Error in detailed:", err);
//         return res.status(err.statusCode || 500).json({
//             success: false,
//             message: err.message || 'An error occurred'
//         });
//     }
// };

exports.lotwiseStock = async (req, res) => {
    try {
        const repo = req.body;

        // Ensure dates are in the correct format and include time
        const fromDate = repo.from;
        const toDate = repo.to;
        const item = repo.items;   // Expecting an array like [4, 5]
        const category = repo.category;

        let query;

        if (category == 0) {

            query = `   
                SELECT 
                    pbl.id, DATE_FORMAT(pbl.lotDate, '%d-%m-%Y') AS lotDate, pbl.lotNo, pbl.expiry, pbl.lotQty, pbl.issueQoh, 
                    (pbl.lotQty - pbl.issueQoh) AS issueQty,
                    pbd.poNo, itm.itemCode, itm.itemName, itm.id AS itemId,  sup.spCode, sup.spName, loc.name As location, ig.code As itemGroup
                FROM 
                    po_bill_lot pbl
                RIGHT JOIN 
                    po_bill_dtl as pbd ON pbl.digit = pbd.digit AND pbl.type = pbd.type AND pbl.itemId = pbd.itemName
                INNER JOIN 
                    items as itm ON pbl.itemId = itm.id
                INNER JOIN 
                    supplier as sup ON sup.id = pbd.spName
                INNER JOIN
                    mst_item_group as ig ON ig.id = itm.itemGroup
                LEFT JOIN
                    item_main_loc as loc ON loc.id = itm.mainLocation
                WHERE 
                pbd.dflag = 0 

            `;
        } else {

            query = `   
                SELECT 
                    pbl.id, DATE_FORMAT(pbl.lotDate, '%d-%m-%Y') AS lotDate, pbl.lotNo, pbl.expiry, pbl.lotQty, pbl.issueQoh, (pbl.lotQty - pbl.issueQoh) AS issueQty,
                    pbd.poNo, itm.itemCode, itm.itemName, itm.id AS itemId,  sup.spCode, sup.spName, loc.name As location, ig.code As itemGroup
                FROM 
                    pob_wo_po_lot pbl
                RIGHT JOIN 
                    pob_wo_po_dtl as pbd ON pbl.digit = pbd.digit AND pbl.type = pbd.type AND pbl.itemId = pbd.itemId
                INNER JOIN 
                    items as itm ON pbl.itemId = itm.id
                INNER JOIN 
                    supplier as sup ON sup.id = pbd.supId
                INNER JOIN
                    mst_item_group as ig ON ig.id = itm.itemGroup
                LEFT JOIN    
                    item_main_loc as loc ON loc.id = itm.mainLocation
                WHERE 
                pbd.dflag = 0 

            `;
        }

        // Collect conditions
        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(pbl.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }


        if (Array.isArray(item) && item.length > 0) {
            conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
            queryParams.push(...item);
        }


        if (conditions.length) {
            query += ' AND ' + conditions.join(' AND ');
        }

        query += ' GROUP BY pbl.id';


        // Execute the query
        const [rows] = await connection.execute(query, queryParams);


        if (rows.length >= 0) {
            rows.forEach((row, index) => {
                row.sNo = index + 1;

            });
        }

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


        const { from, to } = req.body;


        // Construct the SQL query
        let sqlQuery = `
            SELECT 
                pb.id, pb.poNo, pb.suppInvNo, pb.grnRefNO, sup.spCode, sup.spName,
                DATE_FORMAT(pb.date, '%d-%m-%Y') AS date, grandTotal,
                DATE_FORMAT(pb.suppInvoiceDate, '%d-%m-%Y') AS suppInvoiceDate
            FROM po_bill pb
                INNER JOIN supplier as sup ON pb.spName = sup.id
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

        //  Handle null / undefined / empty array
        if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
            return res.status(200).json({
                success: true,
                data: [],
                message: "No invoice IDs provided"
            });
        }

        // Convert invoiceIds array to placeholders (?, ?, ?)
        const placeholders = invoiceIds.map(() => "?").join(",");

        // MAIN QUERY (multiple invoices)
        const itemsQuery = `
            SELECT 
                po_bill.*, po_bill.id AS mainId,
                po_bill_dtl.*, 
                po_bill.id AS poBillId,
                poMain.poNo AS mainPoNo,
                po_bill.qcApproval AS qcFlag,

                sup.spCode, sup.spName AS suppName,
                sup.id AS supId, sup.state, sup.country,
                CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,

                itm.itemName, itm.id AS itemId, itm.shelfLifeItem,
                itm.totStk AS qoh,
                CONCAT(itm.itemCode, ', ', itm.itemName) AS description,

                po_bill_dtl.lot AS location,

                DATE_FORMAT(po_bill.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(po_bill.created_at, '%d-%m-%Y %H:%i:%s') AS created_at

            FROM po_bill
            INNER JOIN supplier AS sup ON po_bill.spName = sup.id
            LEFT JOIN po_bill_dtl ON po_bill.poNo = po_bill_dtl.poNo
            LEFT JOIN items AS itm ON po_bill_dtl.itemName = itm.id
            INNER JOIN po_main AS poMain ON poMain.id = po_bill_dtl.poMainId
            WHERE po_bill.dflag = 0 
              AND po_bill.id IN (${placeholders})
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




exports.itcRepo = async (req, res) => {
    try {
        const { from, to, supplier, items } = req.body;

        let query = `
            SELECT 
                pb.poNo, pb.grnRefNO, pb.suppInvNo, pb.subTotal,
                pb.cgstPer, pb.sgstPer, pb.igstPer,
                pb.cgst, pb.sgst, pb.igst,
                DATE_FORMAT(pb.suppInvoiceDate, '%d-%m-%Y') AS suppInvoiceDate,
                DATE_FORMAT(pb.date, '%d-%m-%Y') AS date,
                sup.id AS supplierId, sup.spName, sup.spCode, sup.gstNo, sup.spType,
                hsn.name AS hsnCode,
                itm.id AS itemId, itm.itemCode, itm.itemName,
                uomTab.name AS uomName,
                pbd.pbAmt, pbd.rcvdQty
            FROM po_bill pb
            INNER JOIN po_bill_dtl pbd ON pb.poNo = pbd.poNo
            INNER JOIN supplier sup ON pbd.spName = sup.id
            INNER JOIN items itm ON pbd.itemName = itm.id
            INNER JOIN mst_uom uomTab ON itm.uom = uomTab.id
            INNER JOIN item_hsn_code hsn ON itm.hsnCode = hsn.id
            WHERE 1 = 1
        `;

        const queryParams = [];

        if (from && to) {
            query += ` AND DATE(pb.created_at) BETWEEN ? AND ?`;
            queryParams.push(from, to);
        }

        if (Array.isArray(supplier) && supplier.length > 0) {
            query += ` AND sup.id IN (${supplier.map(() => '?').join(',')})`;
            queryParams.push(...supplier);
        }

        if (Array.isArray(items) && items.length > 0) {
            query += ` AND itm.id IN (${items.map(() => '?').join(',')})`;
            queryParams.push(...items);
        }

        const [rows] = await connection.execute(query, queryParams);

        /* ---------- GROUP BY PO ---------- */

        const groupedData = {};
        let slNoCounter = 1;

        const totalObject = {
            taxableValue: 0,
            "2.5_CGST": 0, "6_CGST": 0, "9_CGST": 0, "14_CGST": 0,
            "2.5_SGST": 0, "6_SGST": 0, "9_SGST": 0, "14_SGST": 0,
            "5_IGST": 0, "12_IGST": 0, "18_IGST": 0, "28_IGST": 0,
            items: []
        };

        rows.forEach(row => {
            if (!groupedData[row.poNo]) {
                const taxable = Number(row.subTotal || 0);

                groupedData[row.poNo] = {
                    slNo: slNoCounter++,
                    typeOfDoc: "INVOICE",
                    typeOfTransaction: "PURCHASE",
                    supplierId: row.supplierId,
                    spType: row.spType,
                    grnRefNO: row.grnRefNO,
                    date: row.date,
                    spName: row.spName,
                    spCode: row.spCode,
                    gstNo: row.gstNo,
                    suppInvNo: row.suppInvNo,
                    suppInvoiceDate: row.suppInvoiceDate,
                    taxableValue: taxable,

                    "2.5_CGST": 0, "6_CGST": 0, "9_CGST": 0, "14_CGST": 0,
                    "2.5_SGST": 0, "6_SGST": 0, "9_SGST": 0, "14_SGST": 0,
                    "5_IGST": 0, "12_IGST": 0, "18_IGST": 0, "28_IGST": 0,

                    items: []
                };

                totalObject.taxableValue += taxable;

                // CGST
                if (row.cgstPer) {
                    const cgstKey = `${row.cgstPer}_CGST`;
                    const cgstAmt = Number(row.cgst || 0);
                    if (groupedData[row.poNo][cgstKey] !== undefined) {
                        groupedData[row.poNo][cgstKey] += cgstAmt;
                        totalObject[cgstKey] += cgstAmt;
                    }
                }

                // SGST
                if (row.sgstPer) {
                    const sgstKey = `${row.sgstPer}_SGST`;
                    const sgstAmt = Number(row.sgst || 0);
                    if (groupedData[row.poNo][sgstKey] !== undefined) {
                        groupedData[row.poNo][sgstKey] += sgstAmt;
                        totalObject[sgstKey] += sgstAmt;
                    }
                }

                // IGST
                if (row.igstPer) {
                    const igstKey = `${row.igstPer}_IGST`;
                    const igstAmt = Number(row.igst || 0);
                    if (groupedData[row.poNo][igstKey] !== undefined) {
                        groupedData[row.poNo][igstKey] += igstAmt;
                        totalObject[igstKey] += igstAmt;
                    }
                }
            }

            // Items still use pbAmt (line item value)
            const po = groupedData[row.poNo];
            const value = Number(row.pbAmt || 0);

            po.items.push({
                itemId: row.itemId,
                itemCode: row.itemCode,
                itemName: row.itemName,
                hsn: row.hsnCode,
                uom: row.uomName,
                qty: row.rcvdQty,
                tax: row.cgstPer ?? row.igstPer,
                value
            });
        });

        /* ---------- FORMAT & RESPONSE ---------- */

        const result = Object.values(groupedData);

        [...result, totalObject].forEach(obj => {
            Object.keys(obj).forEach(k => {
                if (k.includes('_CGST') || k.includes('_SGST') || k.includes('_IGST')) {
                    obj[k] = Number(obj[k]).toFixed(2);
                }
            });
            if (obj.taxableValue !== undefined) {
                obj.taxableValue = Number(obj.taxableValue).toFixed(2);
            }
        });

        result.push(totalObject);

        return handleSuccessResponse(res, 'ITC Repo list', result);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


exports.itcRepoExcel = async (req, res) => {
    try {
        const repo = Object.keys(req.body || {}).length ? req.body : req.query;

        const from = repo.from;
        const to = repo.to;

        const supplier = repo.supplier
            ? (Array.isArray(repo.supplier) ? repo.supplier : JSON.parse(repo.supplier))
            : [];

        const items = repo.items
            ? (Array.isArray(repo.items) ? repo.items : JSON.parse(repo.items))
            : [];

        /* ================= COMPANY ================= */

        const companyData = await company();

        /* ================= QUERY ================= */

        let query = `
            SELECT 
                pb.poNo, pb.grnRefNO, pb.suppInvNo, pb.subTotal,
                pb.cgstPer, pb.sgstPer, pb.igstPer,
                pb.cgst, pb.sgst, pb.igst,
                DATE_FORMAT(pb.date, '%d-%m-%Y') AS date,
                sup.spName, sup.gstNo, sup.spType,
                hsn.name AS hsnCode,
                itm.itemCode, itm.itemName,
                uomTab.name AS uomName,
                pbd.pbAmt, pbd.rcvdQty
            FROM po_bill pb
            INNER JOIN po_bill_dtl pbd ON pb.poNo = pbd.poNo
            INNER JOIN supplier sup ON pbd.spName = sup.id
            INNER JOIN items itm ON pbd.itemName = itm.id
            INNER JOIN mst_uom uomTab ON itm.uom = uomTab.id
            INNER JOIN item_hsn_code hsn ON itm.hsnCode = hsn.id
            WHERE 1=1
        `;

        const params = [];

        if (from && to) {
            query += ` AND DATE(pb.created_at) BETWEEN ? AND ?`;
            params.push(from, to);
        }

        if (supplier?.length) {
            query += ` AND sup.id IN (${supplier.map(() => '?').join(',')})`;
            params.push(...supplier);
        }

        if (items?.length) {
            query += ` AND itm.id IN (${items.map(() => '?').join(',')})`;
            params.push(...items);
        }

        const [rows] = await connection.execute(query, params);

        /* ================= GROUPING ================= */

        const grouped = {};
        let slNo = 1;

        rows.forEach(r => {
            if (!grouped[r.poNo]) {
                grouped[r.poNo] = {
                    slNo: slNo++,
                    date: r.date,
                    docNo: r.suppInvNo,
                    supplier: r.spName,
                    gstNo: r.gstNo,
                    type: r.spType,
                    taxable: Number(r.subTotal || 0),
                    cgst: {},
                    sgst: {},
                    igst: {},
                    items: []
                };

                const po = grouped[r.poNo];

                // ✅ Use pb.cgst / pb.sgst / pb.igst — set once per PO
                if (r.cgstPer) po.cgst[r.cgstPer] = Number(r.cgst || 0);
                if (r.sgstPer) po.sgst[r.sgstPer] = Number(r.sgst || 0);
                if (r.igstPer) po.igst[r.igstPer] = Number(r.igst || 0);
            }

            const po = grouped[r.poNo];
            const val = Number(r.pbAmt || 0);

            po.items.push({
                itemName: r.itemName,
                hsn: r.hsnCode,
                qty: r.rcvdQty,
                uom: r.uomName,
                value: val,
                tax: r.cgstPer ?? r.igstPer
            });
        });

        const data = Object.values(grouped);

        /* ================= HELPERS ================= */

        const MONTHS = [
            'JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
            'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'
        ];

        // Format "2026-01-01" → "01-JANUARY-26"
        const formatDateLabel = (dateStr) => {
            const d = new Date(dateStr);
            const dd   = String(d.getDate()).padStart(2, '0');
            const mon  = MONTHS[d.getMonth()];
            const yy   = String(d.getFullYear()).slice(2);
            return `${dd}-${mon}-${yy}`;
        };

        const thinSide  = { style: 'thin' };
        const thickSide = { style: 'medium' };

        const applyThinBorder = (cell) => {
            cell.border = {
                top: thinSide, bottom: thinSide,
                left: thinSide, right: thinSide
            };
        };

        // Apply thick outer box border to a range of rows (startRow–endRow) across all 27 cols
        const applyBoxBorder = (ws, startRow, endRow, totalCols) => {
            for (let r = startRow; r <= endRow; r++) {
                for (let c = 1; c <= totalCols; c++) {
                    const cell = ws.getCell(r, c);
                    const isTop    = r === startRow;
                    const isBottom = r === endRow;
                    const isLeft   = c === 1;
                    const isRight  = c === totalCols;

                    cell.border = {
                        top:    isTop    ? thickSide : thinSide,
                        bottom: isBottom ? thickSide : thinSide,
                        left:   isLeft   ? thickSide : thinSide,
                        right:  isRight  ? thickSide : thinSide
                    };
                }
            }
        };

        /* ================= WORKBOOK ================= */

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('ITC');

        /* ===== COLUMN WIDTHS (matching original) ===== */
        const colWidths = [6, 10.4, 7.4, 8.9, 13.9, 26.4, 15.3, 14.6, 11.4,
                           7.9, 8.6, 9.6, 10, 7.7, 8.9, 9.9, 9.6,
                           7.3, 7.6, 8.6, 8.6, 16.3, 7.7, 7, 10, 11.3, 7.6];
        ws.columns = colWidths.map(w => ({ width: w }));

        /* ===== ROW 1: Main Title ===== */
        ws.mergeCells('A1:AA1');
        const titleCell = ws.getCell('A1');
        titleCell.value = 'GST - INPUT TAX CREDIT - REGISTER';
        titleCell.font = { bold: true, size: 14 };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

        /* ===== ROW 2: GST No ===== */
        ws.mergeCells('T2:X2');
        ws.getCell('T2').value = `GST No.  ${companyData?.cmpGstNo || ''}`;
        ws.getCell('T2').alignment = { horizontal: 'left' };

        /* ===== ROW 3: Type of Doc + Company Name ===== */
        ws.getCell('A3').value = 'Type of Document - Invoice/BOE/DC etc';
        ws.getCell('H3').value = companyData?.companyName || '';
        ws.getCell('H3').font = { bold: true };

        /* ===== ROW 4: Type of Transaction + Address Line 1 + Range ===== */
        ws.getCell('A4').value = 'Type of Transaction - Purchase';
        ws.getCell('H4').value = companyData?.companyAdd || '';

        const rangeLabel = (from && to)
            ? `${formatDateLabel(from)}  TO  ${formatDateLabel(to)}`
            : '';
        ws.getCell('V4').value = `Range   ${rangeLabel}`;
        ws.getCell('V4').font  = { bold: true };

        /* ===== ROW 5: Type of Supplier ===== */
        ws.getCell('A5').value = 'Type of Supplier - Supply/Service';



        /* ===== ROW 8: INPUTS ===== */
        ws.getCell('A8').value = 'INPUTS';
        ws.getCell('A8').font = { bold: true };

        /* ===== ROW 9: Sub-header groups ===== */
        // ws.mergeCells('J9:U9');
        // const itcCell = ws.getCell('J9');
        // itcCell.value = 'Details of Input Tax Credit Taken';
        // itcCell.alignment = { horizontal: 'center', vertical: 'middle' };
        // itcCell.font = { bold: true };

        ws.mergeCells('J9:U9');
        const itcCell = ws.getCell('J9');
        itcCell.value = 'Details of Input Tax Credit Taken';
        itcCell.alignment = { horizontal: 'center', vertical: 'middle' };
        itcCell.font = { bold: true };

        // Apply border across all cells in the merged range
        for (let col = 10; col <= 21; col++) { // J=10, U=21
            const cell = ws.getCell(9, col);
            cell.border = {
                top:    { style: 'medium' },
                bottom: { style: 'medium' },
                left:   col === 10 ? { style: 'medium' } : { style: 'thin' },
                right:  col === 21 ? { style: 'medium' } : { style: 'thin' }
            };
        }

        // ws.mergeCells('V9:AA9');
        // const itemCell = ws.getCell('V9');
        // itemCell.value = 'For the main item in the document';
        // itemCell.alignment = { horizontal: 'center', vertical: 'middle' };
        // itemCell.font = { bold: true };


        ws.mergeCells('V9:AA9');
        const itemCell = ws.getCell('V9');
        itemCell.value = 'For the main item in the document';
        itemCell.alignment = { horizontal: 'center', vertical: 'middle' };
        itemCell.font = { bold: true };

        // Apply border across all cells in the merged range
        for (let col = 22; col <= 27; col++) { // V=22, AA=27
            const cell = ws.getCell(9, col);
            cell.border = {
                top:    { style: 'medium' },
                bottom: { style: 'medium' },
                left:   col === 22 ? { style: 'medium' } : { style: 'thin' },
                right:  col === 27 ? { style: 'medium' } : { style: 'thin' }
            };
        }

        /* ===== ROW 10: Column Headers ===== */
        const headerRow = ws.addRow([
            'Sl. No.', 'Date on which inputs received', 'Type of Document',
            'Type of Transaction', 'No. and date of document', 'Name of the Supplier',
            'Type of Supplier', 'GST No. of the Supplier', 'Taxable Value',
            '2.5%\nCGST', '6% CGST', '9% CGST', '14% CGST',
            '2.5%\nSGST', '6% SGST', '9% SGST', '14% SGST',
            '5% IGST', '12%\nIGST', '18% IGST', '28% IGST',
            'Description', 'HSN', 'Qty', 'UOM', 'VALUE', '% OF TAX'
        ]);
        headerRow.height = 51;
        headerRow.eachCell(cell => {
            cell.font = { bold: true };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            applyThinBorder(cell);
        });

        /* ================= DATA ROWS ================= */

        const TOTAL_COLS = 27;

        data.forEach(po => {
            const groupStartRow = ws.lastRow.number + 1;  // track first row of this PO group

            po.items.forEach((item, idx) => {
                const row = ws.addRow([
                    idx === 0 ? po.slNo     : '',
                    idx === 0 ? po.date     : '',
                    idx === 0 ? 'INVOICE'   : '',
                    idx === 0 ? 'PURCHASE'  : '',
                    idx === 0 ? po.docNo    : '',
                    idx === 0 ? po.supplier : '',
                    idx === 0 ? po.type     : '',
                    idx === 0 ? po.gstNo    : '',
                    idx === 0 ? po.taxable  : '',

                    idx === 0 ? (po.cgst[2.5] || '') : '',
                    idx === 0 ? (po.cgst[6]   || '') : '',
                    idx === 0 ? (po.cgst[9]   || '') : '',
                    idx === 0 ? (po.cgst[14]  || '') : '',

                    idx === 0 ? (po.sgst[2.5] || '') : '',
                    idx === 0 ? (po.sgst[6]   || '') : '',
                    idx === 0 ? (po.sgst[9]   || '') : '',
                    idx === 0 ? (po.sgst[14]  || '') : '',

                    idx === 0 ? (po.igst[5]   || '') : '',
                    idx === 0 ? (po.igst[12]  || '') : '',
                    idx === 0 ? (po.igst[18]  || '') : '',
                    idx === 0 ? (po.igst[28]  || '') : '',

                    item.itemName,
                    item.hsn,
                    item.qty,
                    item.uom,
                    item.value,
                    item.tax
                ]);

                // Apply thin inner border to every cell first
                row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    if (colNumber <= TOTAL_COLS) applyThinBorder(cell);
                });
            });

            // ✅ After all item rows added — apply thick outer BOX border for this PO group
            const groupEndRow = ws.lastRow.number;
            applyBoxBorder(ws, groupStartRow, groupEndRow, TOTAL_COLS, itcCell, itemCell);
        });

        /* ================= DOWNLOAD ================= */

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=ITC03_Register.xlsx');

        await wb.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
};

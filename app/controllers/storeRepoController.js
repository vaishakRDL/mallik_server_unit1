const excel = require('exceljs');
const { connection, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');
const { decodeBase64 } = require('../utility/utilityFunction');
const { fetchItemId } = require("../utility/utilityFunction");


exports.referenceLatest = async (req, res) => {
    try {
        const id = req.params.id;

        // Helper function to add docName and doc-info
        const formatRow = (rows, docName, infoFields) => {
            return rows.map(row => ({
                id: row.id,
                docName,
                "docInfo": infoFields.map(field => row[field]).join(',')  // Combine specified fields with a comma
            }));
        };


        //Location
        const locQuery = `
            SELECT items.id, loc.name AS locName, store.totQty
            FROM items
                INNER JOIN item_main_loc as loc ON items.mainLocation = loc.id
                INNER JOIN store ON items.id = store.itemId
            WHERE items.id = ?
            ORDER BY store.id DESC LIMIT 1`;

        //Production
        const poWoPoQuery = `
            SELECT po.id, po.poNo, DATE_FORMAT(po.date, '%d-%m-%Y') AS date, sup.spCode
            FROM pob_wo_po po
                INNER JOIN pob_wo_po_dtl as podtl ON podtl.digit = po.digit AND po.type = podtl.type
                INNER JOIN supplier as sup ON po.supId = sup.id
            WHERE podtl.itemName = ?
            ORDER BY po.id DESC LIMIT 1`;

        //Purchase
        const poQuery = `
            SELECT po.id, po.poNo, DATE_FORMAT(po.date, '%d-%m-%Y') AS date, sup.spCode
            FROM po_main po
                INNER JOIN po_generate as podtl ON podtl.poNo = po.poNo
                INNER JOIN supplier as sup ON po.spName = sup.id
            WHERE podtl.itemName = ?
            ORDER BY po.id DESC LIMIT 1`;

        const poBillQuery = `
            SELECT poBill.id, poBill.poNo, sup.spCode, DATE_FORMAT(poBill.date, '%d-%m-%Y') AS date
           
            FROM po_bill poBill
                INNER JOIN po_bill_dtl as podtl ON podtl.digit = poBill.digit AND poBill.type = podtl.type
                INNER JOIN supplier as sup ON poBill.spName = sup.id
            WHERE podtl.itemName = ?
            ORDER BY poBill.id DESC LIMIT 1`;

        //Stores    
        const jwIssuQuery = `
            SELECT jwIss.id, jwIss.dcNo, DATE_FORMAT(jwIss.created_at, '%d-%m-%Y') AS date, sup.spCode
            FROM jobwork_issue jwIss
                INNER JOIN jobwork_issue_details as jwIssuDtl ON jwIssuDtl.jobWorkId = jwIss.id
                INNER JOIN supplier as sup ON jwIss.supplierId = sup.id
            WHERE jwIssuDtl.itemId = ?
            ORDER BY jwIss.id DESC LIMIT 1`;


        const jwReciQuery = `
            SELECT jw.id, jw.jwrNo, DATE_FORMAT(jw.created_at, '%d-%m-%Y') AS date, sup.spCode
            FROM jobwork_reciept jw
                INNER JOIN jobwork_reciept_details as jwDtl ON jwDtl.jwrId = jw.id
                INNER JOIN supplier as sup ON jw.supplierId = sup.id
            WHERE jwDtl.itemId = ?
            ORDER BY jw.id DESC LIMIT 1`;


        const mrnQuery = `
            SELECT mrn.id, mrn.mrnNo, DATE_FORMAT(mrn.date, '%d-%m-%Y') AS date
            FROM mrn 
                INNER JOIN mrn_details as mrnDtl ON mrnDtl.mrnId = mrn.id
            WHERE mrnDtl.itemId = ?
            ORDER BY mrn.id DESC LIMIT 1`;

        const srnQuery = `
          SELECT srn_mst.id, srn_mst.srnNo, DATE_FORMAT(srn_mst.created_at, '%d-%m-%Y') AS date
          FROM srn_mst
              INNER JOIN srn ON srn.srnMstId = srn_mst.id
          WHERE srn.itemId = ?
          ORDER BY srn_mst.id DESC LIMIT 1`;


        const matIssQuery = `
          SELECT mst.id, mst.issueNo, DATE_FORMAT(mst.created_at, '%d-%m-%Y') AS date
          FROM material_issue_note mst
            INNER JOIN material_issue_dtl dtl  ON dtl.issueId = mst.id
          WHERE dtl.itemId = ?
          ORDER BY mst.id DESC LIMIT 1`;

        // Execute queries concurrently
        const [[locRows], [poWoPoRows], [poRows], [poBillRows], [jwIssuRows], [jwReciRows], [mrnRows], [srnRows], [matIssRows]]
            = await Promise.all([

                connection.execute(locQuery, [id]),
                connection.execute(poWoPoQuery, [id]),
                connection.execute(poQuery, [id]),
                connection.execute(poBillQuery, [id]),
                connection.execute(jwIssuQuery, [id]),
                connection.execute(jwReciQuery, [id]),
                connection.execute(mrnQuery, [id]),
                connection.execute(srnQuery, [id]),
                connection.execute(matIssQuery, [id])


            ]);

        // Format rows using the helper function
        const formattedPoWoPoRows = formatRow(poWoPoRows, "ForeCast Entry", ['poNo', 'date', 'spCode']);
        const formattedSfgRows = formatRow(jwIssuRows, "SFG Entry", ['dcNo', 'date']);
        const formattedPoRows = formatRow(poRows, "Purchase Order", ['poNo', 'date', 'spCode']);
        const formattedPoBillRows = formatRow(poBillRows, "Purchase Bill Against PO", ['poNo', 'date', 'spCode']);
        const formattedJwIssuRows = formatRow(jwIssuRows, "Job Work Issue", ['dcNo', 'date', 'spCode']);
        const formattedJwReciRows = formatRow(jwReciRows, "Job Work Receipt", ['jwrNo', 'date', 'spCode']);
        const formattedMrnRows = formatRow(mrnRows, "Material Return Note", ['mrnNo', 'date']);
        const formattedSrnRows = formatRow(srnRows, "Store Request Note", ['srnNo', 'date']);
        const formattedmatIssRows = formatRow(matIssRows, "Material Issue Note", ['issueNo', 'date']);


        // Combine poRows and poBillRows into a string array
        const production = [...formattedPoWoPoRows, ...formattedSfgRows];
        const purchase = [...formattedPoRows, ...formattedPoBillRows];
        const store = [...formattedJwIssuRows, ...formattedJwReciRows, ...formattedMrnRows, ...formattedSrnRows, ...formattedmatIssRows];


        return res.status(200).json({
            success: true,
            message: "Store Item References",
            location: locRows,
            production,
            purchase,
            store
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};




exports.referenceAll = async (req, res) => {
    try {
        const id = req.params.id;
        const { from, to, category } = req.body;

        // Define allowed categories and their respective columns and joins
        const categoryConfig = {

            'po_forecast_dtl': {
                columns: `
                    po_forecast_dtl.uniqueId AS FcNo, 
                    DATE_FORMAT(po_forecast_dtl.date, "%d-%m-%Y") AS Date, 
                    po_forecast_dtl.fcQty AS FcQty,
                    supplier.spCode AS SuppCode,
                    supplier.spName AS SuppName       
                `,
                join: `
                    INNER JOIN supplier ON po_forecast_dtl.supId = supplier.id
                `,
                where: 'po_forecast_dtl.itemId = ? AND DATE(po_forecast_dtl.created_at) BETWEEN ? AND ?'
            },
            'po_generate': {
                columns: `
                    po_generate.poNo AS PoNo, 
                    DATE_FORMAT(po_generate.date, "%d-%m-%Y") AS PoDate, 
                    po_generate.poQty AS PoQty,
                    supplier.spCode AS SuppCode,
                    supplier.spName AS SuppName       
                `,
                join: `
                    INNER JOIN supplier ON po_generate.spName = supplier.id
                `,
                where: 'po_generate.itemName = ? AND DATE(po_generate.date) BETWEEN ? AND ?'
            },
            'po_bill_dtl': {
                columns: `
                    po_bill_dtl.poNo AS PBNo, 
                    DATE_FORMAT(po_bill_dtl.date, "%d-%m-%Y") AS PBDate, 
                    po_bill_dtl.invQty AS PBQty,
                    po_bill_dtl.pbRate AS PBRate,
                    supplier.spCode AS SuppCode,
                    supplier.spName AS SuppName 
                `,
                join: `
                    INNER JOIN supplier ON po_bill_dtl.spName = supplier.id
                `,
                where: 'po_bill_dtl.itemName = ? AND DATE(po_bill_dtl.date) BETWEEN ? AND ?'
            },
            'jobwork_issue_details': {
                columns: `
                    DATE_FORMAT(jobwork_issue_details.created_at, "%d-%m-%Y") AS Date, 
                    jobwork_issue_details.Qty AS Qty,
                    jobwork_issue_details.rate AS Rate,
                    jobwork_issue.dcNo AS DcNo,
                    supplier.spCode AS SuppCode,
                    supplier.spName AS SuppName
                `,
                join: `
                    INNER JOIN jobwork_issue ON jobwork_issue_details.jobWorkId = jobwork_issue.id
                    INNER JOIN supplier ON jobwork_issue.supplierId = supplier.id 
                `,
                where: 'jobwork_issue_details.itemId = ? AND DATE(jobwork_issue_details.created_at) BETWEEN ? AND ?'
            },
            'jobwork_reciept_details': {
                columns: `
                    DATE_FORMAT(jobwork_reciept_details.created_at, "%d-%m-%Y") AS Date, 
                    jobwork_reciept_details.jwiQty AS Qty,
                    jobwork_reciept.jwrNo AS JwRecieptNo
                `,
                join: `
                    INNER JOIN jobwork_reciept ON jobwork_reciept_details.jwrId = jobwork_reciept.id
                `,
                where: 'jobwork_reciept_details.itemId = ? AND DATE(jobwork_reciept_details.created_at) BETWEEN ? AND ?'
            },
            'mrn_details': {
                columns: `
                    DATE_FORMAT(mrn.date, "%d-%m-%Y") AS Date, 
                    mrn_details.returnQty AS ReturnQty,
                    mrn.mrnNo AS MRN_No,
                    mrn_details.lot AS Lot,
                    mrn_details.remarks AS Remarks
                `,
                join: `
                    INNER JOIN mrn ON mrn_details.mrnId = mrn.id
                `,
                where: 'mrn_details.itemId = ? AND DATE(mrn.date) BETWEEN ? AND ?'
            },
            'srn': {
                columns: `
                    DATE_FORMAT(srn.created_at, "%d-%m-%Y") AS Date, 
                    srn.Qty AS SrnQty,
                    srn_mst.srnNo AS SrnNo
                `,
                join: `
                    INNER JOIN srn_mst ON srn.srnMstId = srn_mst.id
                `,
                where: 'srn.itemId = ? AND DATE(srn.created_at) BETWEEN ? AND ?'
            },
            'material_issue_dtl': {
                columns: `
                    DATE_FORMAT(material_issue_dtl.created_at, "%d-%m-%Y") AS Date, 
                    material_issue_dtl.issuedQty AS IssuedQty,
                    material_issue_note.issueNo AS IssueNo
                `,
                join: `
                    INNER JOIN material_issue_note ON material_issue_dtl.issueId = material_issue_note.id
                `,
                where: 'material_issue_dtl.itemId = ? AND DATE(material_issue_dtl.created_at) BETWEEN ? AND ?'
            }
        };

        // Check if the provided category is valid
        if (!categoryConfig[category]) {
            return res.status(400).json({
                success: false,
                message: "Invalid category provided."
            });
        }

        const { columns, join, where } = categoryConfig[category];

        // Construct query
        let query = `SELECT ${columns} FROM ${category} ${join} WHERE ${where}`;

        // Execute query
        const [rows] = await connection.execute(query, [id, from, to]);

        // If rows found, return the result
        if (rows.length > 0) {
            return res.status(200).json({
                success: true,
                message: "Store Item References List",
                data: rows
            });
        }

        // No data found, return empty structure based on columns
        const columnList = columns.match(/AS\s+(\w+)/g).map(alias => alias.replace(/AS\s+/g, '').trim());
        const emptyData = Object.fromEntries(columnList.map(col => [col, '']));

        return res.status(200).json({
            success: true,
            message: "No data found for the given criteria.",
            data: [emptyData] // Empty array format
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};


exports.grnLogData = async (req, res) => {
    try {
        const id = req.params.id; // The id from the request parameters
        const { from, to } = req.body; // The from and to dates from the request body

        // Corrected query
        const query = `
            SELECT 
                store.*, DATE_FORMAT(store.created_at, '%d-%m-%Y') AS date,
                itm.id AS itemId, itm.itemCode, itm.itemName, loc.name AS location
            FROM store
            INNER JOIN 
                items as itm ON store.itemId = itm.id
            LEFT JOIN 
                item_main_loc as loc ON itm.mainLocation = loc.id  
            WHERE itm.id = ? AND DATE(store.created_at) BETWEEN ? AND ?      
        `;

        // Execute the query with the corrected parameters
        const [rows] = await connection.execute(query, [id, from, to]);

        if (rows.length >= 0) {
            // Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1; // Add serial number (sNo)
            });

            return res.status(200).json({
                success: true,
                message: "GRN Fifo",
                data: rows
            });
        } else {
            return res.status(404).json({
                success: false,
                message: "No data found"
            });
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};


exports.stkLedger = async (req, res) => {
    try {
        const {
            from,
            to,
            items,
            locId,
            itmGrpId,
            page = 1,
            limit = 100
        } = req.body;

        const currentPage = parseInt(page);
        const pageLimit = parseInt(limit);
        const offset = (currentPage - 1) * pageLimit;

        /* =====================================================
           STEP 1: FETCH PAGINATED ITEM IDs
        ===================================================== */

        let itemQuery = `
            SELECT DISTINCT itm.id AS itemId
            FROM store
            INNER JOIN items itm ON store.itemId = itm.id
            WHERE 1 = 1
        `;

        const itemParams = [];

        if (from && to) {
            itemQuery += ` AND DATE(store.created_at) BETWEEN ? AND ?`;
            itemParams.push(from, to);
        }

        if (Array.isArray(items) && items.length > 0) {
            itemQuery += ` AND itm.id IN (${items.map(() => '?').join(', ')})`;
            itemParams.push(...items);
        }

        if (locId) {
            itemQuery += ` AND itm.mainLocation = ?`;
            itemParams.push(locId);
        }

        if (itmGrpId) {
            itemQuery += ` AND itm.itemGroup = ?`;
            itemParams.push(itmGrpId);
        }

        itemQuery += `
            ORDER BY itm.itemCode ASC
            LIMIT ? OFFSET ?
        `;
        itemParams.push(pageLimit, offset);

        const [itemRows] = await connection.execute(itemQuery, itemParams);
        const itemIds = itemRows.map(r => r.itemId);

        if (!itemIds.length) {
            return res.status(200).json({
                success: true,
                message: "Stock Ledger list",
                page: currentPage,
                limit: pageLimit,
                total: 0,
                totalPages: 0,
                data: []
            });
        }

        /* =====================================================
           STEP 2: FETCH STOCK DETAILS
        ===================================================== */

        let query = `
            SELECT 
                store.*,
                DATE_FORMAT(store.created_at, '%d-%m-%Y') AS date,
                itm.id AS itemId,
                itm.itemCode,
                itm.itemName,
                itmGrp.name AS itemGroup,
                po.suppInvNo,
                po.suppInvoiceDate,
                sp.spName,
                sp.spCode,
                uomTab.code AS uom,
                loc.name AS location
            FROM store
            INNER JOIN items itm ON store.itemId = itm.id
            INNER JOIN mst_uom uomTab ON itm.uom = uomTab.id
            INNER JOIN mst_item_group itmGrp ON itm.itemGroup = itmGrp.id
            LEFT JOIN item_main_loc loc ON itm.mainLocation = loc.id    
            LEFT JOIN po_bill po 
                ON store.inwardId = po.id 
                AND store.docType = 'Purchase Bill'
            LEFT JOIN pob_wo_po powo
                ON store.inwardId = powo.id
                AND store.docType = 'Purchase Bill without Po'
            LEFT JOIN supplier sp 
                ON (po.spName = sp.id OR powo.supId = sp.id)
            WHERE itm.id IN (${itemIds.map(() => '?').join(', ')})
        `;

        const queryParams = [...itemIds];

        if (from && to) {
            query += ` AND DATE(store.created_at) BETWEEN ? AND ?`;
            queryParams.push(from, to);
        }

        if (locId) {
            query += ` AND itm.mainLocation = ?`;
            queryParams.push(locId);
        }

        if (itmGrpId) {
            query += ` AND itm.itemGroup = ?`;
            queryParams.push(itmGrpId);
        }

        query += ` ORDER BY itm.itemCode ASC, store.id ASC`;

        const [rows] = await connection.execute(query, queryParams);

        /* =====================================================
           STEP 3: GROUP BY ITEM
        ===================================================== */

        const groupedData = {};

        rows.forEach(row => {
            if (!groupedData[row.itemId]) {
                groupedData[row.itemId] = {
                    itemId: row.itemId,
                    itemCode: row.itemCode,
                    itemName: row.itemName,
                    itemGroup: row.itemGroup,
                    location: row.location,
                    uom: row.uom,
                    stkDtl: []
                };
            }

            groupedData[row.itemId].stkDtl.push({
                id: row.id,
                docType: row.docType,
                docNo: row.docNo,
                date: row.date,
                grnNo: row.grnNo,
                spName: row.spName,
                spCode: row.spCode,
                invNo: row.suppInvNo,
                invDate: row.suppInvoiceDate,
                receipts: parseFloat(row.rcvdQty) || 0,
                accQty: row.docType === "Opening Balance" ? 0 : parseFloat(row.inwardQty) || 0,
                rejQty: parseFloat(row.rejQty) || 0,
                issue: parseFloat(row.outwardQty) || 0,
                disposal: parseFloat(row.rejOutQty) || 0,
                rejBalQty: parseFloat(row.rejTotQty) || 0,
                balQty: parseFloat(row.totQty) || 0
            });
        });

        /* =====================================================
           STEP 4: TOTAL ROW PER ITEM
        ===================================================== */

        Object.values(groupedData).forEach(item => {
            let totalReceipts = 0;
            let totalAcc = 0;
            let totalRej = 0;
            let totalIssue = 0;
            let totalDisposal = 0;

            item.stkDtl.forEach(d => {
                totalReceipts += d.receipts;
                totalAcc += d.accQty;
                totalRej += d.rejQty;
                totalIssue += d.issue;
                totalDisposal += d.disposal;
            });

            item.stkDtl.push({
                receipts: totalReceipts.toFixed(2),
                accQty: totalAcc.toFixed(2),
                rejQty: totalRej.toFixed(2),
                issue: totalIssue.toFixed(2),
                disposal: totalDisposal.toFixed(2),
                row: "total"
            });
        });

        const result = Object.values(groupedData);

        /* =====================================================
           STEP 5: FILTER-AWARE TOTAL COUNT (FIXED)
        ===================================================== */

        let countQuery = `
            SELECT COUNT(DISTINCT itm.id) AS total
            FROM store
            INNER JOIN items itm ON store.itemId = itm.id
            WHERE 1 = 1
        `;

        const countParams = [];

        if (from && to) {
            countQuery += ` AND DATE(store.created_at) BETWEEN ? AND ?`;
            countParams.push(from, to);
        }

        if (Array.isArray(items) && items.length > 0) {
            countQuery += ` AND itm.id IN (${items.map(() => '?').join(', ')})`;
            countParams.push(...items);
        }

        if (locId) {
            countQuery += ` AND itm.mainLocation = ?`;
            countParams.push(locId);
        }

        if (itmGrpId) {
            countQuery += ` AND itm.itemGroup = ?`;
            countParams.push(itmGrpId);
        }

        const [countRows] = await connection.execute(countQuery, countParams);

        const total = countRows[0]?.total || 0;
        const totalPages = Math.ceil(total / pageLimit);

        return res.status(200).json({
            success: true,
            message: "Stock Ledger list",
            page: currentPage,
            limit: pageLimit,
            total,
            totalPages,
            data: result
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


//old Intial Code
// exports.stkBalance = async (req, res) => {
//     try {
//         const repo = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;

//         const fromDate = repo.from || null;
//         const toDate = repo.to || null;

//         const item = repo.items ? (Array.isArray(repo.items) ? repo.items : repo.items.split(',').map(i => Number(i.trim()))) : [];
//         const itmGrpId = repo.itmGrpId ? (Array.isArray(repo.itmGrpId) ? repo.itmGrpId : repo.itmGrpId.split(',').map(id => id.trim())) : [];
//         const locId = repo.locId;
//         const notDisplay = repo.notDisplay;

//         let query = `
//             SELECT 
//                 itm.id AS itemId,
//                 itm.itemCode,
//                 itm.itemName,

//                 COALESCE(
//                     (
//                         SELECT 
//                             CASE 
//                                 WHEN pb.exgRate > 1 THEN (pbd.pbRate * pb.exgRate)
//                                 ELSE pbd.pbRate
//                             END AS finalRate
//                         FROM po_bill_dtl pbd
//                         INNER JOIN po_bill pb ON pb.poNo = pbd.poNo
//                         WHERE pbd.itemName = itm.id AND pbd.type = 'R'
//                         ORDER BY pbd.id DESC
//                         LIMIT 1
//                     ),
//                     itm.stdRate
//                 ) AS stdRate,


//                 (SELECT DATE_FORMAT(po3.date, '%d-%m-%Y') 
//                     FROM po_generate po3 
//                     WHERE po3.itemName = itm.id 
//                     ORDER BY po3.id DESC 
//                     LIMIT 1
//                 ) AS poDate,

//                 (SELECT DATEDIFF(?, po4.date)
//                     FROM po_generate po4
//                     WHERE po4.itemName = itm.id
//                     ORDER BY po4.id DESC
//                     LIMIT 1
//                 ) AS ageInDays,

//                 uomTab.code AS uom,
//                 itmGrp.id AS itmGrpId,
//                 itmGrp.name AS itemGroup,
//                 loc.name AS location,
//                 prdFam.name AS productFamily,

//                 (
//                     SELECT COALESCE(s1.totQty, 0)
//                     FROM store s1
//                     WHERE s1.itemId = itm.id
//                         AND DATE(s1.created_at) < ?
//                     ORDER BY s1.created_at DESC, s1.id DESC
//                     LIMIT 1
//                 ) AS opQty,

//                 COALESCE(SUM(CASE WHEN DATE(store.created_at) BETWEEN ? AND ? THEN store.inwardQty ELSE 0 END), 0) AS receipts,

//                 COALESCE(SUM(CASE WHEN DATE(store.created_at) BETWEEN ? AND ? THEN store.outwardQty ELSE 0 END), 0) AS issue,

//                 (
//                     SELECT COALESCE(s2.totQty, 0)
//                     FROM store s2
//                     WHERE s2.itemId = itm.id
//                       AND DATE(s2.created_at) <= ?
//                     ORDER BY s2.id DESC
//                     LIMIT 1
//                 ) AS clsQty

//             FROM 
//                 store
//             INNER JOIN items AS itm ON store.itemId = itm.id
//             INNER JOIN mst_item_group AS itmGrp ON itm.itemGroup = itmGrp.id
//             INNER JOIN mst_uom AS uomTab ON itm.uom = uomTab.id
//             LEFT JOIN item_main_loc AS loc ON itm.mainLocation = loc.id
//             LEFT JOIN item_product_family AS prdFam ON itm.productFamily = prdFam.id
//             WHERE 1=1
//         `;

//         const queryParams = [toDate, fromDate, fromDate, toDate, fromDate, toDate, toDate];

//         if (item.length > 0) {
//             query += ` AND itm.id IN (${item.map(() => '?').join(', ')})`;
//             queryParams.push(...item);
//         }

//         if (itmGrpId.length > 0) {
//             query += ` AND itm.itemGroup IN (${itmGrpId.map(() => '?').join(', ')})`;
//             queryParams.push(...itmGrpId);
//         }

//         if (locId) {
//             query += ` AND itm.mainLocation = ?`;
//             queryParams.push(locId);
//         }

//         query += ` GROUP BY itm.id`;
//         // query += ` ORDER BY itmGrp.name ASC, itm.itemCode ASC`; // <-- Added sorting here

//         if (notDisplay == 1) {
//             query += ` HAVING clsQty != 0`;
//         }

//         query += ` ORDER BY itmGrp.name ASC, itm.itemCode ASC LIMIT 50`;


//         const [rows] = await connection.execute(query, queryParams);

//         if (!rows || rows.length === 0) {
//             return res.status(404).json({ success: false, message: "No stock balance data found", data: [] });
//         }

//         const formatDecimal = (val) => Number(val || 0).toFixed(2);

//         const groupedData = {};
//         rows.forEach(r => {
//             if (!groupedData[r.itmGrpId]) {
//                 groupedData[r.itmGrpId] = {
//                     itmGrpId: r.itmGrpId,
//                     itemGroup: r.itemGroup,
//                     location: r.location,
//                     stkDtl: []
//                 };
//             }

//             const itemData = {
//                 itemId: r.itemId,
//                 itemCode: r.itemCode,
//                 itemName: r.itemName,
//                 productFamily: r.productFamily,
//                 uom: r.uom,
//                 stdRate: formatDecimal(r.stdRate),
//                 poDate: r.poDate,
//                 ageInDays: r.ageInDays !== null ? r.ageInDays : '',
//                 opQty: formatDecimal(r.opQty),
//                 opValue: formatDecimal(r.opQty * r.stdRate),
//                 receipts: formatDecimal(r.receipts),
//                 receiptValue: formatDecimal(r.receipts * r.stdRate),
//                 issue: formatDecimal(r.issue),
//                 issueValue: formatDecimal(r.issue * r.stdRate),
//                 clsQty: formatDecimal(r.clsQty),
//                 clsValue: formatDecimal(r.clsQty * r.stdRate)
//             };

//             groupedData[r.itmGrpId].stkDtl.push(itemData);
//         });

//         let result = Object.values(groupedData);

//         // Sort groups by itemGroup name A–Z
//         result.sort((a, b) => {
//             if (!a.itemGroup) return 1;
//             if (!b.itemGroup) return -1;
//             return a.itemGroup.localeCompare(b.itemGroup);
//         });

//         // Sort items within each group by itemCode A–Z
//         result.forEach(group => {
//             group.stkDtl.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
//         });

//         let totalReceipts = 0;
//         let totalReceiptValue = 0;
//         let totalIssue = 0;
//         let totalIssueValue = 0;

//         result.forEach(group => {
//             group.stkDtl.forEach(item => {
//                 totalReceipts += parseFloat(item.receipts);
//                 totalReceiptValue += parseFloat(item.receiptValue);
//                 totalIssue += parseFloat(item.issue);
//                 totalIssueValue += parseFloat(item.issueValue);
//             });
//         });

//         result.push({
//             itmGrpId: null,
//             itemGroup: 'TOTAL',
//             location: null,
//             stkDtl: [{
//                 itemId: null,
//                 itemCode: '',
//                 itemName: '',
//                 productFamily: '',
//                 uom: '',
//                 stdRate: '',
//                 poDate: '',
//                 ageInDays: '',
//                 opQty: '',
//                 opValue: '',
//                 receipts: totalReceipts.toFixed(2),
//                 receiptValue: totalReceiptValue.toFixed(2),
//                 issue: totalIssue.toFixed(2),
//                 issueValue: totalIssueValue.toFixed(2),
//                 clsQty: '',
//                 clsValue: '',
//                 isClr: 1
//             }]
//         });

//         return res.status(200).json({
//             success: true,
//             message: "Stock Balance Grouped by Item Group",
//             data: result
//         });
//     } catch (err) {
//         return res.status(err.statusCode || 500).json({
//             success: false,
//             message: err.message || 'An error occurred'
//         });
//     }
// };








// exports.repoStkBalance = async (req, res) => {
//     try {
//         const repo = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;

//         // ─────────────────────────────────────────────────────────────────────
//         // showVal parse — MUST handle query string "false" explicitly
//         //
//         //  showVal=false  (query param) → repo.showVal = "false" (string)
//         //                                 "false" === 'true' is FALSE  ✓
//         //                                 old code: "false" == 1 was also FALSE ✓
//         //                                 BUT spread columns still showed — fixed below
//         //
//         //  Root cause: the Excel columns array was always built at require-time
//         //  in old code. Now it is built at runtime using showVal.
//         // ─────────────────────────────────────────────────────────────────────
//         const rawShowVal = repo.showVal;
//         const showVal = (rawShowVal === true || rawShowVal === 1)
//             ? true
//             : (typeof rawShowVal === 'string')
//                 ? (rawShowVal.trim().toLowerCase() === 'true' || rawShowVal.trim() === '1')
//                 : false;

//         // stkBalance reads showVal from the same req — value fields will be
//         // present or absent in the data depending on showVal
//         const stkBalanceData = await getStkBalanceData(req);

//         const workbook  = new excel.Workbook();
//         const worksheet = workbook.addWorksheet('Stock Balance');

//         // ─────────────────────────────────────────────────────────────────────
//         // Build columns at runtime — value columns only when showVal = true
//         // Using explicit filter instead of spread to avoid any edge cases
//         // ─────────────────────────────────────────────────────────────────────
//         const allColumns = [
//             { header: 'Item Group',          key: 'itemGroup',     width: 30,  showAlways: true  },
//             { header: 'Last Purchase Date',  key: 'poDate',        width: 18,  showAlways: true  },
//             { header: 'Location',            key: 'location',      width: 30,  showAlways: true  },
//             { header: 'Age In Days',         key: 'ageInDays',     width: 12,  showAlways: true  },
//             { header: 'Product Family',      key: 'productFamily', width: 20,  showAlways: true  },
//             { header: 'Item Code',           key: 'itemCode',      width: 20,  showAlways: true  },
//             { header: 'Item Name',           key: 'itemName',      width: 30,  showAlways: true  },
//             { header: 'UOM',                 key: 'uom',           width: 10,  showAlways: true  },
//             { header: 'Standard Rate',       key: 'stdRate',       width: 15,  showAlways: true  },
//             { header: 'Opening Quantity',    key: 'opQty',         width: 20,  showAlways: true  },
//             { header: 'Opening Value',       key: 'opValue',       width: 20,  showAlways: false }, // ← showVal
//             { header: 'Receipts',            key: 'receipts',      width: 15,  showAlways: true  },
//             { header: 'Receipt Value',       key: 'receiptValue',  width: 20,  showAlways: false }, // ← showVal
//             { header: 'Issue',               key: 'issue',         width: 15,  showAlways: true  },
//             { header: 'Issue Value',         key: 'issueValue',    width: 20,  showAlways: false }, // ← showVal
//             { header: 'Closing Quantity',    key: 'clsQty',        width: 20,  showAlways: true  },
//             { header: 'Closing Value',       key: 'clsValue',      width: 20,  showAlways: false }, // ← showVal
//         ];

//         // Filter out value columns when showVal = false, then strip the
//         // internal showAlways flag before passing to exceljs
//         worksheet.columns = allColumns
//             .filter(col => col.showAlways || showVal)
//             .map(({ showAlways, ...col }) => col);

//         // Bold header row
//         worksheet.getRow(1).eachCell(cell => {
//             cell.font = { bold: true };
//         });

//         // ─────────────────────────────────────────────────────────────────────
//         // Add data rows — value fields only added when showVal = true
//         // (stkBalance already strips them from response when showVal = false,
//         //  but we guard here too so Number(undefined) never writes NaN)
//         // ─────────────────────────────────────────────────────────────────────
//         stkBalanceData.forEach(group => {
//             group.stkDtl.forEach(stock => {
//                 const row = {
//                     itemGroup:     group.itemGroup     || '',
//                     poDate:        stock.poDate        || '',
//                     location:      group.location      || '',
//                     ageInDays:     stock.ageInDays     || '',
//                     productFamily: stock.productFamily || '',
//                     itemCode:      stock.itemCode      || '',
//                     itemName:      stock.itemName      || '',
//                     uom:           stock.uom           || '',
//                     stdRate:       Number(stock.stdRate)   || 0,
//                     opQty:         Number(stock.opQty)     || 0,
//                     receipts:      Number(stock.receipts)  || 0,
//                     issue:         Number(stock.issue)     || 0,
//                     clsQty:        Number(stock.clsQty)    || 0,
//                 };

//                 // Only add value fields when showVal = true
//                 if (showVal) {
//                     row.opValue      = Number(stock.opValue)      || 0;
//                     row.receiptValue = Number(stock.receiptValue) || 0;
//                     row.issueValue   = Number(stock.issueValue)   || 0;
//                     row.clsValue     = Number(stock.clsValue)     || 0;
//                 }

//                 worksheet.addRow(row);
//             });
//         });

//         const buffer = await workbook.xlsx.writeBuffer();

//         res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
//         res.setHeader('Content-Disposition', 'attachment; filename=StockBalance.xlsx');
//         res.send(buffer);

//     } catch (err) {
//         console.error('Error exporting Stock Balance to Excel:', err);
//         return res.status(err.statusCode || 500).json({
//             success: false,
//             message: err.message || 'An error occurred'
//         });
//     }
// };

// // Helper — calls stkBalance internally and resolves its response data
// async function getStkBalanceData(req) {
//     return new Promise((resolve, reject) => {
//         exports.stkBalance(req, {
//             status: (code) => ({
//                 json: (response) => {
//                     if (code === 200) {
//                         resolve(response.data);
//                     } else {
//                         reject(new Error(response.message || 'Failed to fetch Stock Balance data.'));
//                     }
//                 },
//             }),
//         });
//     });
// }









//Report Download-itemGroup Filter issue
exports.repoStkBalanceDownload2 = async (req, res) => {
    try {
        const repo = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;

        const fromDate = repo.from;
        const toDate = repo.to;

        const showVal = repo.showVal == true || repo.showVal == 1 || repo.showVal == 'true';
        const hideZeroClose = repo.notDisplay == true || repo.notDisplay == 1 || repo.notDisplay == 'true';

        const locId = (repo.locId && String(repo.locId).trim() !== '') ? repo.locId : null;
        const showLoc = locId !== null;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=StockBalance.xlsx');

        const workbook = new excel.stream.xlsx.WorkbookWriter({ stream: res });
        const worksheet = workbook.addWorksheet('Stock Balance');

        const colDefs = [
            { header: 'Item Group', key: 'itemGroup' },
            ...(showLoc ? [{ header: 'Location', key: 'location' }] : []),
            { header: 'Item Code', key: 'itemCode' },
            { header: 'Item Name', key: 'itemName' },
            { header: 'Product Family', key: 'productFamily' },
            { header: 'Last Purchase Date', key: 'poDate' },
            { header: 'Age In Days', key: 'ageInDays' },
            { header: 'UOM', key: 'uom' },
            { header: 'Standard Rate', key: 'stdRate' },
            { header: 'Opening Qty', key: 'opQty' },
            ...(showVal ? [{ header: 'Opening Value', key: 'opValue' }] : []),
            { header: 'Receipts', key: 'receipts' },
            ...(showVal ? [{ header: 'Receipt Value', key: 'receiptValue' }] : []),
            { header: 'Issue', key: 'issue' },
            ...(showVal ? [{ header: 'Issue Value', key: 'issueValue' }] : []),
            { header: 'Closing Qty', key: 'clsQty' },
            ...(showVal ? [{ header: 'Closing Value', key: 'clsValue' }] : [])
        ];

        const query = `
            SELECT 
                itm.id AS itemId,
                itm.itemCode,
                itm.itemName,
                itm.stdRate,
                uomTab.code AS uom,
                itmGrp.name AS itemGroup,
                loc.name AS location,
                prdFam.name AS productFamily,

                (SELECT DATE_FORMAT(po.date, '%d-%m-%Y')
                 FROM po_generate po
                 WHERE po.itemName = itm.id
                 ORDER BY po.id DESC LIMIT 1) AS poDate,

                (SELECT DATEDIFF(?, po2.date)
                 FROM po_generate po2
                 WHERE po2.itemName = itm.id
                 ORDER BY po2.id DESC LIMIT 1) AS ageInDays,

                COALESCE(so.opQty, 0) AS opQty,

                SUM(CASE WHEN store.created_at >= ? AND store.created_at < ? THEN store.inwardQty ELSE 0 END) AS receipts,
                SUM(CASE WHEN store.created_at >= ? AND store.created_at < ? THEN store.outwardQty ELSE 0 END) AS issue,

                COALESCE(sc.clsQty, 0) AS clsQty

            FROM store
            INNER JOIN items itm ON store.itemId = itm.id
            INNER JOIN mst_item_group itmGrp ON itm.itemGroup = itmGrp.id
            INNER JOIN mst_uom uomTab ON itm.uom = uomTab.id
            LEFT JOIN item_main_loc loc ON itm.mainLocation = loc.id
            LEFT JOIN item_product_family prdFam ON itm.productFamily = prdFam.id

            LEFT JOIN (
                SELECT s1.itemId, s1.totQty AS opQty
                FROM store s1
                JOIN (
                    SELECT itemId, MAX(created_at) AS maxDate
                    FROM store WHERE created_at < ?
                    GROUP BY itemId
                ) s2 ON s1.itemId = s2.itemId AND s1.created_at = s2.maxDate
            ) so ON so.itemId = itm.id

            LEFT JOIN (
                SELECT s1.itemId, s1.totQty AS clsQty
                FROM store s1
                JOIN (
                    SELECT itemId, MAX(created_at) AS maxDate
                    FROM store WHERE created_at <= ?
                    GROUP BY itemId
                ) s2 ON s1.itemId = s2.itemId AND s1.created_at = s2.maxDate
            ) sc ON sc.itemId = itm.id

            GROUP BY itm.id
            ORDER BY itmGrp.name ASC, itm.itemCode ASC
        `;

        const params = [
            toDate,
            fromDate, toDate,
            fromDate, toDate,
            fromDate,
            toDate
        ];

        const [rows] = await connection.execute(query, params);

        const num = (v) => parseFloat(Number(v || 0).toFixed(2));

        let totalReceipts = 0, totalReceiptValue = 0, totalIssue = 0, totalIssueValue = 0;

        const dataRows = [];

        for (const r of rows) {
            if (hideZeroClose && Number(r.clsQty) === 0) continue;

            const rate = Number(r.stdRate || 0);

            totalReceipts += Number(r.receipts || 0);
            totalReceiptValue += Number(r.receipts || 0) * rate;
            totalIssue += Number(r.issue || 0);
            totalIssueValue += Number(r.issue || 0) * rate;

            const row = {
                itemGroup: r.itemGroup,
                ...(showLoc && { location: r.location }),
                itemCode: r.itemCode,
                itemName: r.itemName,
                productFamily: r.productFamily || '',
                poDate: r.poDate || '',
                ageInDays: r.ageInDays || '',
                uom: r.uom,
                stdRate: num(rate),
                opQty: num(r.opQty),
                receipts: num(r.receipts),
                issue: num(r.issue),
                clsQty: num(r.clsQty)
            };

            if (showVal) {
                row.opValue = num(r.opQty * rate);
                row.receiptValue = num(r.receipts * rate);
                row.issueValue = num(r.issue * rate);
                row.clsValue = num(r.clsQty * rate);
            }

            dataRows.push(row);
        }

        // ✅ Auto width
        // const colWidths = colDefs.map(col => col.header.length);
        // for (const row of dataRows) {
        //     colDefs.forEach((col, i) => {
        //         colWidths[i] = Math.max(colWidths[i], String(row[col.key] ?? '').length);
        //     });
        // }

        // worksheet.columns = colDefs.map((c, i) => ({
        //     key: c.key,
        //     width: colWidths[i] + 3
        // }));

        // // ✅ Header
        // const headerRow = worksheet.addRow(colDefs.map(c => c.header));
        // colDefs.forEach((_, i) => headerRow.getCell(i + 1).font = { bold: true });
        // headerRow.commit();

        // ✅ Auto width — capped smartly
        const colWidths = colDefs.map(col => col.header.length);
        for (const row of dataRows) {
            colDefs.forEach((col, i) => {
                const val = String(row[col.key] ?? '');
                colWidths[i] = Math.max(colWidths[i], Math.min(val.length, 40)); // cap at 40
            });
        }

        worksheet.columns = colDefs.map((c, i) => ({
            key: c.key,
            width: Math.max(colWidths[i] + 2, 10) // min width 10, padding +2 instead of +3
        }));

        // ✅ Header — bold + background fill
        const headerRow = worksheet.addRow(colDefs.map(c => c.header));
        headerRow.eachCell(cell => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF2F75B6' } // blue header background
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        headerRow.height = 20;
        headerRow.commit();

        // ✅ Data
        for (const row of dataRows) {
            worksheet.addRow(row).commit();
        }

        // ✅ TOTAL ROW (ADDED)
        const totalRow = {
            itemGroup: 'TOTAL',
            ...(showLoc && { location: '' }),
            itemCode: '',
            itemName: '',
            productFamily: '',
            poDate: '',
            ageInDays: '',
            uom: '',
            stdRate: '',
            opQty: '',
            receipts: num(totalReceipts),
            issue: num(totalIssue),
            clsQty: ''
        };

        if (showVal) {
            totalRow.opValue = '';
            totalRow.receiptValue = num(totalReceiptValue);
            totalRow.issueValue = num(totalIssueValue);
            totalRow.clsValue = '';
        }

        const tRow = worksheet.addRow(totalRow);

        tRow.eachCell(cell => {
            cell.font = { bold: true };
        });

        tRow.commit();

        await workbook.commit();

    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: err.message });
        } else {
            res.end();
        }
    }
};



//Report Download
exports.repoStkBalanceDownload = async (req, res) => {
    try {
        const repo = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;

        const fromDate = repo.from; // 'YYYY-MM-DD'
        const toDate   = repo.to;   // 'YYYY-MM-DD'

        const showVal       = repo.showVal == true || repo.showVal == 1 || repo.showVal == 'true';
        const hideZeroClose = repo.notDisplay == true || repo.notDisplay == 1 || repo.notDisplay == 'true';

        const locId   = (repo.locId && String(repo.locId).trim() !== '') ? repo.locId : null;
        const showLoc = locId !== null;

        const item = repo.items
            ? (Array.isArray(repo.items) ? repo.items : repo.items.split(',').map(i => Number(i.trim())))
            : [];

        const itmGrpId = repo.itmGrpId
            ? (Array.isArray(repo.itmGrpId) ? repo.itmGrpId : repo.itmGrpId.split(',').map(id => id.trim()))
            : [];

        let filterClause = '';
        let filterParams = [];

        if (item.length > 0) {
            filterClause += ` AND itm.id IN (${item.map(() => '?').join(',')})`;
            filterParams.push(...item);
        }
        if (itmGrpId.length > 0) {
            filterClause += ` AND itm.itemGroup IN (${itmGrpId.map(() => '?').join(',')})`;
            filterParams.push(...itmGrpId);
        }
        if (locId) {
            filterClause += ` AND itm.mainLocation = ?`;
            filterParams.push(locId);
        }

        // ─── STEP 1: Get filtered item IDs first (fast, small) ───────────────
        const [itemRows] = await connection.execute(`
            SELECT itm.id
            FROM items itm
            INNER JOIN mst_item_group itmGrp ON itm.itemGroup = itmGrp.id
            WHERE itm.id IN (SELECT DISTINCT itemId FROM store)
            ${filterClause}
        `, filterParams);

        if (!itemRows || itemRows.length === 0) {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=StockBalance.xlsx');
            const wb = new excel.stream.xlsx.WorkbookWriter({ stream: res });
            wb.addWorksheet('Stock Balance').commit();
            await wb.commit();
            return;
        }

        const itemIds      = itemRows.map(r => r.id);
        const idList       = itemIds.map(() => '?').join(',');
        const toDateNext   = `DATE_ADD('${toDate}', INTERVAL 1 DAY)`;   // avoids DATE() on column → uses index
        const fromDateTime = `'${fromDate} 00:00:00'`;

        // ─── STEP 2: Run all 6 subqueries IN PARALLEL ────────────────────────
        const [
            baseRows,
            saRows,
            soRows,
            scRows,
            lrRows,
            lpRows
        ] = await Promise.all([

            // Base item info
            connection.execute(`
                SELECT
                    itm.id           AS itemId,
                    itm.itemCode,
                    itm.itemName,
                    itm.stdRate,
                    uomTab.code      AS uom,
                    itmGrp.id        AS itmGrpId,
                    itmGrp.name      AS itemGroup,
                    loc.name         AS location,
                    prdFam.name      AS productFamily
                FROM items itm
                INNER JOIN mst_item_group      itmGrp ON itm.itemGroup     = itmGrp.id
                INNER JOIN mst_uom             uomTab ON itm.uom           = uomTab.id
                LEFT  JOIN item_main_loc       loc    ON itm.mainLocation  = loc.id
                LEFT  JOIN item_product_family prdFam ON itm.productFamily = prdFam.id
                WHERE itm.id IN (${idList})
                ORDER BY itmGrp.name ASC, itm.itemCode ASC
            `, itemIds),

            // ✅ Receipts & Issue — range instead of DATE() → hits index
            connection.execute(`
                SELECT itemId,
                       COALESCE(SUM(inwardQty),  0) AS receipts,
                       COALESCE(SUM(outwardQty), 0) AS issue
                FROM store
                WHERE created_at >= ?
                  AND created_at < ${toDateNext}
                  AND itemId IN (${idList})
                GROUP BY itemId
            `, [fromDate, ...itemIds]),

            // ✅ Opening Qty — range, ROW_NUMBER on small filtered set
            connection.execute(`
                SELECT itemId, totQty AS opQty
                FROM (
                    SELECT itemId, totQty,
                           ROW_NUMBER() OVER (PARTITION BY itemId ORDER BY created_at DESC, id DESC) AS rn
                    FROM store
                    WHERE created_at < ${fromDateTime}
                      AND itemId IN (${idList})
                ) t
                WHERE t.rn = 1
            `, itemIds),

            // ✅ Closing Qty — range, ROW_NUMBER on small filtered set
            connection.execute(`
                SELECT itemId, totQty AS clsQty
                FROM (
                    SELECT itemId, totQty,
                           ROW_NUMBER() OVER (PARTITION BY itemId ORDER BY id DESC) AS rn
                    FROM store
                    WHERE created_at < ${toDateNext}
                      AND itemId IN (${idList})
                ) t
                WHERE t.rn = 1
            `, itemIds),

            // ✅ Latest Rate
            connection.execute(`
                SELECT pbd.itemName,
                       CASE WHEN pb.exgRate > 1
                            THEN pbd.pbRate * pb.exgRate
                            ELSE pbd.pbRate END AS stdRate
                FROM (
                    SELECT itemName, MAX(id) AS maxId
                    FROM po_bill_dtl
                    WHERE type = 'R'
                      AND itemName IN (${idList})
                    GROUP BY itemName
                ) lid
                INNER JOIN po_bill_dtl pbd ON pbd.id  = lid.maxId
                INNER JOIN po_bill     pb  ON pb.poNo = pbd.poNo
            `, itemIds),

            // ✅ Latest PO date
            connection.execute(`
                SELECT itemName,
                       DATE_FORMAT(date, '%d-%m-%Y')  AS poDate,
                       DATEDIFF(?, date)               AS ageInDays
                FROM (
                    SELECT itemName, date,
                           ROW_NUMBER() OVER (PARTITION BY itemName ORDER BY id DESC) AS rn
                    FROM po_generate
                    WHERE itemName IN (${idList})
                ) t
                WHERE t.rn = 1
            `, [toDate, ...itemIds])
        ]);

        // ─── STEP 3: Merge all results in JS (instant) ───────────────────────
        const saMap = Object.fromEntries(saRows[0].map(r => [r.itemId, r]));
        const soMap = Object.fromEntries(soRows[0].map(r => [r.itemId, r]));
        const scMap = Object.fromEntries(scRows[0].map(r => [r.itemId, r]));
        const lrMap = Object.fromEntries(lrRows[0].map(r => [r.itemName, r]));
        const lpMap = Object.fromEntries(lpRows[0].map(r => [r.itemName, r]));

        const merged = baseRows[0].map(r => ({
            ...r,
            stdRate:  lrMap[r.itemId]?.stdRate  ?? r.stdRate,
            poDate:   lpMap[r.itemId]?.poDate    ?? '',
            ageInDays:lpMap[r.itemId]?.ageInDays ?? '',
            opQty:    soMap[r.itemId]?.opQty     ?? 0,
            receipts: saMap[r.itemId]?.receipts  ?? 0,
            issue:    saMap[r.itemId]?.issue      ?? 0,
            clsQty:   scMap[r.itemId]?.clsQty    ?? 0,
        }));

        // ─── STEP 4: Build Excel ──────────────────────────────────────────────
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=StockBalance.xlsx');

        const workbook  = new excel.stream.xlsx.WorkbookWriter({ stream: res });
        const worksheet = workbook.addWorksheet('Stock Balance');

        const colDefs = [
            { header: 'Item Group',         key: 'itemGroup'     },
            ...(showLoc ? [{ header: 'Location', key: 'location' }] : []),
            { header: 'Item Code',          key: 'itemCode'      },
            { header: 'Item Name',          key: 'itemName'      },
            { header: 'Product Family',     key: 'productFamily' },
            { header: 'Last Purchase Date', key: 'poDate'        },
            { header: 'Age In Days',        key: 'ageInDays'     },
            { header: 'UOM',                key: 'uom'           },
            { header: 'Standard Rate',      key: 'stdRate'       },
            { header: 'Opening Qty',        key: 'opQty'         },
            ...(showVal ? [{ header: 'Opening Value',  key: 'opValue'      }] : []),
            { header: 'Receipts',           key: 'receipts'      },
            ...(showVal ? [{ header: 'Receipt Value',  key: 'receiptValue' }] : []),
            { header: 'Issue',              key: 'issue'         },
            ...(showVal ? [{ header: 'Issue Value',    key: 'issueValue'   }] : []),
            { header: 'Closing Qty',        key: 'clsQty'        },
            ...(showVal ? [{ header: 'Closing Value',  key: 'clsValue'     }] : [])
        ];

        worksheet.columns = colDefs.map(c => ({
            key:   c.key,
            width: Math.max(c.header.length + 4, 12)
        }));

        const headerRow = worksheet.addRow(colDefs.map(c => c.header));
        headerRow.eachCell(cell => {
            cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F75B6' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        headerRow.height = 20;
        headerRow.commit();

        const num = (v) => parseFloat(Number(v || 0).toFixed(2));

        let totalReceipts     = 0, totalReceiptValue = 0;
        let totalIssue        = 0, totalIssueValue   = 0;

        for (const r of merged) {
            if (hideZeroClose && Number(r.clsQty) === 0) continue;

            const rate      = Number(r.stdRate   || 0);
            const rReceipts = Number(r.receipts  || 0);
            const rIssue    = Number(r.issue     || 0);
            const rOpQty    = Number(r.opQty     || 0);
            const rClsQty   = Number(r.clsQty    || 0);

            totalReceipts     += rReceipts;
            totalReceiptValue += rReceipts * rate;
            totalIssue        += rIssue;
            totalIssueValue   += rIssue    * rate;

            const row = {
                itemGroup:     r.itemGroup,
                ...(showLoc && { location: r.location }),
                itemCode:      r.itemCode,
                itemName:      r.itemName,
                productFamily: r.productFamily || '',
                poDate:        r.poDate        || '',
                ageInDays:     r.ageInDays     || '',
                uom:           r.uom,
                stdRate:       num(rate),
                opQty:         num(rOpQty),
                receipts:      num(rReceipts),
                issue:         num(rIssue),
                clsQty:        num(rClsQty)
            };

            if (showVal) {
                row.opValue      = num(rOpQty    * rate);
                row.receiptValue = num(rReceipts * rate);
                row.issueValue   = num(rIssue    * rate);
                row.clsValue     = num(rClsQty   * rate);
            }

            worksheet.addRow(row).commit();
        }

        // Total row
        const totalRow = {
            itemGroup: 'TOTAL',
            ...(showLoc && { location: '' }),
            itemCode: '', itemName: '', productFamily: '',
            poDate: '', ageInDays: '', uom: '', stdRate: '', opQty: '',
            receipts: num(totalReceipts),
            issue:    num(totalIssue),
            clsQty:   ''
        };
        if (showVal) {
            totalRow.opValue      = '';
            totalRow.receiptValue = num(totalReceiptValue);
            totalRow.issueValue   = num(totalIssueValue);
            totalRow.clsValue     = '';
        }

        const tRow = worksheet.addRow(totalRow);
        tRow.eachCell(cell => { cell.font = { bold: true }; });
        tRow.commit();

        await workbook.commit();

    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: err.message });
        } else {
            res.end();
        }
    }
};

// Display Data Pagination
exports.stkBalanceDisplay = async (req, res) => {
    try {
        const repo = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;

        const fromDate = repo.from || null;
        const toDate = repo.to || null;

        const locId = (repo.locId && String(repo.locId).trim() !== '') ? repo.locId : null;
        const showLoc = locId !== null;

        const rawShowVal = repo.showVal;
        const showVal = (rawShowVal === true || rawShowVal === 1)
            ? true
            : (typeof rawShowVal === 'string')
                ? (rawShowVal.trim().toLowerCase() === 'true' || rawShowVal.trim() === '1')
                : false;

        const rawNotDisplay = repo.notDisplay;
        const hideZeroClose = (rawNotDisplay === true || rawNotDisplay === 1)
            ? true
            : (typeof rawNotDisplay === 'string')
                ? (rawNotDisplay.trim().toLowerCase() === 'true' || rawNotDisplay.trim() === '1')
                : false;

        const page = (repo.page && Number(repo.page) > 0) ? Number(repo.page) : 1;
        const limit = 100;
        const rowStart = (page - 1) * limit + 1;
        const rowEnd = page * limit;

        const item = repo.items
            ? (Array.isArray(repo.items) ? repo.items : repo.items.split(',').map(i => Number(i.trim())))
            : [];
        const itmGrpId = repo.itmGrpId
            ? (Array.isArray(repo.itmGrpId) ? repo.itmGrpId : repo.itmGrpId.split(',').map(id => id.trim()))
            : [];

        let filterClause = '';
        let filterParams = [];

        if (item.length > 0) {
            filterClause += ` AND itm.id IN (${item.map(() => '?').join(',')})`;
            filterParams.push(...item);
        }
        if (itmGrpId.length > 0) {
            filterClause += ` AND itm.itemGroup IN (${itmGrpId.map(() => '?').join(',')})`;
            filterParams.push(...itmGrpId);
        }
        if (locId) {
            filterClause += ` AND itm.mainLocation = ?`;
            filterParams.push(locId);
        }

        let cteStoreFilter = '';
        let cteStoreParams = [];
        if (item.length > 0) {
            cteStoreFilter = ` AND itemId IN (${item.map(() => '?').join(',')})`;
            cteStoreParams = [...item];
        }

        const query = `
            WITH

            active_ids AS (
                SELECT DISTINCT itemId
                FROM store
                WHERE 1=1 ${cteStoreFilter}
            ),

            ranked_items AS (
                SELECT
                    itm.id,
                    COUNT(*) OVER ()                                               AS totalRecords,
                    ROW_NUMBER() OVER (ORDER BY itmGrp.name ASC, itm.itemCode ASC) AS rn
                FROM active_ids ai
                INNER JOIN items          AS itm    ON itm.id        = ai.itemId
                INNER JOIN mst_item_group AS itmGrp ON itm.itemGroup = itmGrp.id
                WHERE 1=1 ${filterClause}
            ),

            page_items AS (
                SELECT id, totalRecords
                FROM ranked_items
                WHERE rn BETWEEN ? AND ?
            ),

            store_agg AS (
                SELECT
                    itemId,
                    COALESCE(SUM(inwardQty),  0) AS receipts,
                    COALESCE(SUM(outwardQty), 0) AS issue
                FROM store
                WHERE DATE(created_at) BETWEEN ? AND ?
                  AND itemId IN (SELECT id FROM page_items)
                GROUP BY itemId
            ),

            store_open AS (
                SELECT itemId, totQty AS opQty
                FROM (
                    SELECT itemId, totQty,
                           ROW_NUMBER() OVER (PARTITION BY itemId ORDER BY created_at DESC, id DESC) AS rn
                    FROM store
                    WHERE created_at < ?
                      AND itemId IN (SELECT id FROM page_items)
                ) t
                WHERE t.rn = 1
            ),

            store_close AS (
                SELECT itemId, totQty AS clsQty
                FROM (
                    SELECT itemId, totQty,
                           ROW_NUMBER() OVER (PARTITION BY itemId ORDER BY id DESC) AS rn
                    FROM store
                    WHERE DATE(created_at) <= ?
                      AND itemId IN (SELECT id FROM page_items)
                ) t
                WHERE t.rn = 1
            ),

            latest_rate AS (
                SELECT pbd.itemName,
                       CASE WHEN pb.exgRate > 1 THEN pbd.pbRate * pb.exgRate ELSE pbd.pbRate END AS stdRate
                FROM (
                    SELECT itemName, MAX(id) AS maxId
                    FROM po_bill_dtl
                    WHERE type = 'R'
                      AND itemName IN (SELECT id FROM page_items)
                    GROUP BY itemName
                ) lid
                INNER JOIN po_bill_dtl pbd ON pbd.id  = lid.maxId
                INNER JOIN po_bill     pb  ON pb.poNo = pbd.poNo
            ),

            latest_po AS (
                SELECT itemName,
                       DATE_FORMAT(date, '%d-%m-%Y') AS poDate,
                       DATEDIFF(?, date)              AS ageInDays
                FROM (
                    SELECT itemName, date,
                           ROW_NUMBER() OVER (PARTITION BY itemName ORDER BY id DESC) AS rn
                    FROM po_generate
                    WHERE itemName IN (SELECT id FROM page_items)
                ) t
                WHERE t.rn = 1
            )

            SELECT
                pi.totalRecords,
                itm.id                                    AS itemId,
                itm.itemCode,
                itm.itemName,
                COALESCE(lr.stdRate, itm.stdRate)         AS stdRate,
                lp.poDate,
                lp.ageInDays,
                uomTab.code                               AS uom,
                itmGrp.id                                 AS itmGrpId,
                itmGrp.name                               AS itemGroup,
                loc.name                                  AS location,
                prdFam.name                               AS productFamily,
                COALESCE(so.opQty,    0)                  AS opQty,
                COALESCE(sa.receipts, 0)                  AS receipts,
                COALESCE(sa.issue,    0)                  AS issue,
                COALESCE(sc.clsQty,   0)                  AS clsQty

            FROM page_items pi
            INNER JOIN items               AS itm    ON itm.id            = pi.id
            INNER JOIN mst_item_group      AS itmGrp ON itm.itemGroup     = itmGrp.id
            INNER JOIN mst_uom             AS uomTab ON itm.uom           = uomTab.id
            LEFT  JOIN item_main_loc       AS loc    ON itm.mainLocation  = loc.id
            LEFT  JOIN item_product_family AS prdFam ON itm.productFamily = prdFam.id
            LEFT  JOIN store_agg           AS sa     ON sa.itemId         = pi.id
            LEFT  JOIN store_open          AS so     ON so.itemId         = pi.id
            LEFT  JOIN store_close         AS sc     ON sc.itemId         = pi.id
            LEFT  JOIN latest_rate         AS lr     ON lr.itemName       = pi.id
            LEFT  JOIN latest_po           AS lp     ON lp.itemName       = pi.id

            ${hideZeroClose ? 'HAVING clsQty != 0' : ''}

            ORDER BY itmGrp.name ASC, itm.itemCode ASC
        `;

        const queryParams = [
            ...cteStoreParams,
            ...filterParams,
            rowStart, rowEnd,
            fromDate, toDate,
            fromDate,
            toDate,
            toDate
        ];

        const [rows] = await connection.execute(query, queryParams);

        if (!rows || rows.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No stock balance data found",
                pagination: { currentPage: page, itemsPerPage: limit, totalRecords: 0, totalPages: 0 },
                data: []
            });
        }

        const totalRecords = rows[0].totalRecords;

        const fmt = (val) => Number(val || 0).toFixed(2);
        const groupedData = {};

        let totalReceipts = 0, totalReceiptValue = 0;
        let totalIssue = 0, totalIssueValue = 0;

        rows.forEach(r => {
            const rate = Number(r.stdRate || 0);
            const rReceipts = Number(r.receipts || 0);
            const rIssue = Number(r.issue || 0);
            const rOpQty = Number(r.opQty || 0);
            const rClsQty = Number(r.clsQty || 0);

            if (!groupedData[r.itmGrpId]) {
                groupedData[r.itmGrpId] = {
                    itmGrpId: r.itmGrpId,
                    itemGroup: r.itemGroup,
                    ...(showLoc && { location: r.location }),
                    stkDtl: []
                };
            }

            groupedData[r.itmGrpId].stkDtl.push({
                itemId: r.itemId,
                itemCode: r.itemCode,
                itemName: r.itemName,
                productFamily: r.productFamily,
                uom: r.uom,
                stdRate: fmt(rate),
                poDate: r.poDate || '',
                ageInDays: r.ageInDays !== null ? r.ageInDays : '',
                opQty: fmt(rOpQty),
                ...(showVal && { opValue: fmt(rOpQty * rate) }),
                receipts: fmt(rReceipts),
                ...(showVal && { receiptValue: fmt(rReceipts * rate) }),
                issue: fmt(rIssue),
                ...(showVal && { issueValue: fmt(rIssue * rate) }),
                clsQty: fmt(rClsQty),
                ...(showVal && { clsValue: fmt(rClsQty * rate) })
            });

            totalReceipts += rReceipts;
            totalReceiptValue += rReceipts * rate;
            totalIssue += rIssue;
            totalIssueValue += rIssue * rate;
        });

        const result = Object.values(groupedData);

        result.sort((a, b) => {
            if (!a.itemGroup) return 1;
            if (!b.itemGroup) return -1;
            return a.itemGroup.localeCompare(b.itemGroup);
        });

        result.forEach(grp => {
            grp.stkDtl.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
        });

        result.push({
            itmGrpId: null,
            itemGroup: 'TOTAL',
            ...(showLoc && { location: null }),
            stkDtl: [{
                itemId: null, itemCode: '', itemName: '', productFamily: '',
                uom: '', stdRate: '', poDate: '', ageInDays: '',
                opQty: '',
                ...(showVal && { opValue: '' }),
                receipts: totalReceipts.toFixed(2),
                ...(showVal && { receiptValue: totalReceiptValue.toFixed(2) }),
                issue: totalIssue.toFixed(2),
                ...(showVal && { issueValue: totalIssueValue.toFixed(2) }),
                clsQty: '',
                ...(showVal && { clsValue: '' }),
                isClr: 1
            }]
        });

        return res.status(200).json({
            success: true,
            message: "Stock Balance Grouped by Item Group",
            pagination: {
                currentPage: page,
                itemsPerPage: limit,
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit)
            },
            data: result
        });

    } catch (err) {
        console.error("stkBalanceDisplay error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};


exports.quarantine = async (req, res) => {
    try {
        const { from: fromDate, to: toDate, items: item } = req.body;

        // Wrap UNION in a subquery
        let query = `
            SELECT * FROM (
                SELECT 
                    quaStock.*, DATE_FORMAT(quaStock.created_at, '%d-%m-%Y') AS date,
                    DATE_FORMAT(quaStock.created_at, '%H-%i-%s') AS time,
                    pb.suppInvNo, pb.user AS purchaseUser, pb.poNo As pbNo,
                    DATE_FORMAT(pb.suppInvoiceDate, '%d-%m-%Y') AS suppInvoiceDate,
                    DATE_FORMAT(pb.date, '%d-%m-%Y') AS docDate,
                    s.spCode, s.spName
                FROM quarantine_stock quaStock
                LEFT JOIN po_bill_dtl pbDtl ON pbDtl.id = quaStock.poBillDtlId
                LEFT JOIN po_bill pb ON pb.id = quaStock.poBillId
                LEFT JOIN supplier s ON s.id = pb.spName

                WHERE quaStock.withPo = 1 
 
                UNION ALL

                SELECT 
                    quaStock.*, DATE_FORMAT(quaStock.created_at, '%d-%m-%Y') AS date,
                    DATE_FORMAT(quaStock.created_at, '%H-%i-%s') AS time,
                    pb.suppInvNo, pb.user AS purchaseUser, pb.poNo As pbNo,
                    DATE_FORMAT(pb.suppInvoiceDate, '%d-%m-%Y') AS suppInvoiceDate,
                    DATE_FORMAT(pb.date, '%d-%m-%Y') AS docDate,
                    s.spCode, s.spName
                FROM quarantine_stock quaStock
                LEFT JOIN pob_wo_po_dtl pbDtl ON pbDtl.id = quaStock.poBillDtlId
                LEFT JOIN pob_wo_po pb ON pb.id = quaStock.poBillId
                LEFT JOIN supplier s ON s.id = pb.supId

                WHERE  quaStock.withPo = 0
            ) AS q
        `;

        const conditions = [];
        const queryParams = [];

        // Apply conditions on outer query
        if (fromDate && toDate) {
            conditions.push('DATE(q.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(item) && item.length > 0) {
            conditions.push(`q.itemId IN (${item.map(() => '?').join(', ')})`);
            queryParams.push(...item);
        }

        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        const [result] = await connection.execute(query, queryParams);

        return handleSuccessResponse(res, 'Quarantine Stock list', result);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


exports.itemCons = async (req, res) => {
    try {
        const { from, to, mrn, itemId, supId, itemGroup, category } = req.body;

        if (!from || !to || mrn === undefined || !category) {
            return res.status(400).json({
                success: false,
                message: "Invalid input: Ensure 'from', 'to', 'mrn', and 'category' are provided."
            });
        }

        const table = mrn === 1 ? 'sfg_stock' : 'store';
        const columns = `
            items.id As itemId, items.itemCode, items.itemName, items.stdRate, 
            iG.name AS itemGroup,  pF.name AS productFamily, 
            pb.poNo,  ${table}.totQty, ${table}.created_at
        `;
        const joins = `
            INNER JOIN items ON items.id = ${table}.itemId
            INNER JOIN mst_item_group iG ON iG.id = items.itemGroup
            INNER JOIN item_product_family pF ON pF.id = items.productFamily
            LEFT JOIN po_bill_dtl pbDtl ON pbDtl.id = ${table}.inwardId
            LEFT JOIN po_bill pb ON pb.digit = pbDtl.digit
        `;

        const conditions = [];
        const queryParams = [];
        conditions.push(`DATE(${table}.created_at) BETWEEN ? AND ?`);
        queryParams.push(from, to);

        if (mrn === 0) {
            conditions.push(`${table}.docType = "Purchase Bill"`);
        }

        if (Array.isArray(itemId) && itemId.length > 0) {
            conditions.push(`${table}.itemId IN (${itemId.map(() => '?').join(', ')})`);
            queryParams.push(...itemId);
        }

        if (mrn === 0 && supId) {
            conditions.push(`pb.supId = ?`);
            queryParams.push(supId);
        }

        if (itemGroup) {
            conditions.push(`items.itemGroup = ?`);
            queryParams.push(itemGroup);
        }

        const query = `
            SELECT ${columns} 
            FROM ${table} 
            ${joins} 
            WHERE ${conditions.join(' AND ')}
            ORDER BY ${table}.id DESC
        `;

        const [rows] = await connection.execute(query, queryParams);

        if (rows.length > 0) {
            const dateFrom = new Date(from);
            const dateTo = new Date(to);
            let periods = [];

            if (category === 'w') { // Weekly
                let weekNumber = 1;
                let currentDate = new Date(dateFrom);
                while (currentDate <= dateTo) {
                    let startOfWeek = new Date(currentDate);
                    let endOfWeek = new Date(currentDate);
                    endOfWeek.setDate(endOfWeek.getDate() + 6);

                    if (endOfWeek > dateTo) endOfWeek = dateTo;

                    periods.push({ period: `week${weekNumber}`, start: startOfWeek, end: endOfWeek });
                    currentDate.setDate(currentDate.getDate() + 7);
                    weekNumber++;
                }
            } else if (category === 'm') { // Monthly
                let currentDate = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1);
                const endDate = new Date(dateTo.getFullYear(), dateTo.getMonth() + 1, 0);

                while (currentDate <= endDate) {
                    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
                    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
                    periods.push({
                        period: startOfMonth.toLocaleString('default', { month: 'short' }),
                        start: startOfMonth,
                        end: endOfMonth
                    });
                    currentDate.setMonth(currentDate.getMonth() + 1);
                }
            }

            const groupedData = {};

            rows.forEach(row => {
                const createdAt = new Date(row.created_at);
                if (!groupedData[row.itemId]) {
                    groupedData[row.itemId] = {
                        ...row,
                        id: row.itemId,
                        periods: {},
                        totalQty: 0,
                    };
                }

                periods.forEach(({ period, start, end }) => {
                    if (createdAt >= start && createdAt <= end) {
                        groupedData[row.itemId].periods[period] =
                            (groupedData[row.itemId].periods[period] || 0) + row.totQty;
                    }
                });

                groupedData[row.itemId].totalQty += row.totQty;
            });

            const result = Object.values(groupedData).map(item => {
                const periodData = item.periods;
                let totalQty = 0;
                let highestQty = 0;

                Object.values(periodData).forEach(qty => {
                    totalQty += qty;
                    if (qty > highestQty) highestQty = qty;
                });

                const avgQty = Object.keys(periodData).length > 0
                    ? totalQty / Object.keys(periodData).length
                    : 0;

                return {
                    ...item,
                    periods: {
                        ...periodData,
                        avgQty: parseFloat(avgQty.toFixed(2)),
                        highestQty,
                    },
                };
            });

            return res.status(200).json({
                success: true,
                message: "Item Consumptions List",
                data: result,
            });
        } else {
            return res.status(404).json({
                success: false,
                message: "No data found for the given criteria.",
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred while fetching data.',
        });
    }
};




exports.stkAge = async (req, res) => {
    try {
        const repo = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
        const toDate = repo.date || null;

        if (!toDate) {
            return res.status(400).json({ success: false, message: "Please provide a valid toDate." });
        }

        const item = repo.items ? (Array.isArray(repo.items) ? repo.items : repo.items.split(',').map(i => i.trim())) : [];
        const itmGrpId = repo.itmGrpId ? (Array.isArray(repo.itmGrpId) ? repo.itmGrpId : repo.itmGrpId.split(',').map(id => id.trim())) : [];
        const locId = repo.locId;

        let query = `
            SELECT 
                store.*, 
                DATE_FORMAT(store.created_at, '%d-%m-%Y') AS date,
                itmGrp.id AS itmGrpId,
                itmGrp.name AS itemGroup,
                loc.name AS location,
                itm.id AS itemId,
                itm.itemCode,
                itm.itemName,
                itm.stdRate,
                uomTab.code AS uom,
                IFNULL(prdFam.name, 'Unknown') AS productFamily
            FROM store
            INNER JOIN items AS itm ON store.itemId = itm.id
            INNER JOIN mst_item_group AS itmGrp ON itm.itemGroup = itmGrp.id
            INNER JOIN mst_uom AS uomTab ON itm.uom = uomTab.id
            LEFT JOIN item_main_loc AS loc ON itm.mainLocation = loc.id
            LEFT JOIN item_product_family AS prdFam ON itm.productFamily = prdFam.id
            WHERE store.inwardQty IS NOT NULL
              AND store.inwardQty > 0
        `;

        const queryParams = [];
        const conditions = [];

        if (Array.isArray(item) && item.length > 0) {
            conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
            queryParams.push(...item);
        }

        if (Array.isArray(itmGrpId) && itmGrpId.length > 0) {
            conditions.push(`itm.itemGroup IN (${itmGrpId.map(() => '?').join(', ')})`);
            queryParams.push(...itmGrpId);
        }

        if (locId) {
            conditions.push(`itm.mainLocation = ?`);
            queryParams.push(locId);
        }

        if (conditions.length) query += ' AND ' + conditions.join(' AND ');
        query += ` ORDER BY itm.id, store.created_at DESC`;

        const [rows] = await connection.execute(query, queryParams);

        const formatNumber = (val) => parseFloat((Number(val) || 0).toFixed(3));

        const totals = {
            "0-30": { clsQty: 0, clsValue: 0 },
            "31-60": { clsQty: 0, clsValue: 0 },
            "61-90": { clsQty: 0, clsValue: 0 },
            "91-180": { clsQty: 0, clsValue: 0 },
            "181-365": { clsQty: 0, clsValue: 0 },
            ">365": { clsQty: 0, clsValue: 0 },
            mainTotal: { clsQty: 0, clsValue: 0 }
        };

        const groupedData = {};
        const itemsGrouped = {};

        rows.forEach(r => {
            if (!itemsGrouped[r.itemId]) itemsGrouped[r.itemId] = [];
            itemsGrouped[r.itemId].push(r);
        });

        const toDateObj = new Date(toDate);

        const shiftDate = (base, days) => {
            const d = new Date(base);
            d.setDate(d.getDate() - days);
            return d;
        };

        const endOfDay = (d) => {
            const dt = new Date(d);
            dt.setHours(23, 59, 59, 999);
            return dt;
        };

        const startOfDay = (d) => {
            const dt = new Date(d);
            dt.setHours(0, 0, 0, 0);
            return dt;
        };

        const dateWindows = {
            "0-30": { from: startOfDay(shiftDate(toDateObj, 30)), to: endOfDay(toDateObj) },
            "31-60": { from: startOfDay(shiftDate(toDateObj, 60)), to: endOfDay(shiftDate(toDateObj, 31)) },
            "61-90": { from: startOfDay(shiftDate(toDateObj, 90)), to: endOfDay(shiftDate(toDateObj, 61)) },
            "91-180": { from: startOfDay(shiftDate(toDateObj, 180)), to: endOfDay(shiftDate(toDateObj, 91)) },
            "181-365": { from: startOfDay(shiftDate(toDateObj, 365)), to: endOfDay(shiftDate(toDateObj, 181)) },
            ">365": {
                from: new Date("1970-01-01"),
                to: endOfDay(shiftDate(toDateObj, 366))
            }
        };

        const qtyQuery = `
            SELECT s.itemId, s.totQty
            FROM store s
            WHERE DATE(s.created_at) <= ?
            ORDER BY s.created_at DESC, s.id DESC
        `;

        const [qtyRows] = await connection.execute(qtyQuery, [toDate]);

        const latestQtyMap = {};
        qtyRows.forEach(r => {
            if (!latestQtyMap[r.itemId]) latestQtyMap[r.itemId] = r.totQty;
        });

        // 💥 MAIN LOGIC UPDATE APPLIED HERE
        for (const itemId in itemsGrouped) {
            const itemRows = itemsGrouped[itemId];
            const latestRow = itemRows[0];
            const groupId = latestRow.itmGrpId;

            if (!groupedData[groupId]) {
                groupedData[groupId] = {
                    itmGrpId: groupId,
                    itemGroup: latestRow.itemGroup,
                    location: latestRow.location,
                    prdFam: []
                };
            }

            let productFamilyGroup = groupedData[groupId].prdFam.find(
                fam => fam.productFamily === latestRow.productFamily
            );

            if (!productFamilyGroup) {
                productFamilyGroup = {
                    productFamily: latestRow.productFamily,
                    stkDtl: []
                };
                groupedData[groupId].prdFam.push(productFamilyGroup);
            }

            // RAW SUMS
            const ageBrackets = {
                "0-30": { clsQty: 0, clsValue: 0 },
                "31-60": { clsQty: 0, clsValue: 0 },
                "61-90": { clsQty: 0, clsValue: 0 },
                "91-180": { clsQty: 0, clsValue: 0 },
                "181-365": { clsQty: 0, clsValue: 0 },
                ">365": { clsQty: 0, clsValue: 0 }

            };

            const clsQty = Number(latestQtyMap[itemId] || 0);
            const stdRate = Number(latestRow.stdRate) || 0;

            Object.keys(dateWindows).forEach(range => {
                const { from, to } = dateWindows[range];

                const filteredRows = itemRows.filter(r => {
                    if (!r.created_at || r.inwardQty == null) return false;
                    const created = new Date(r.created_at);
                    return created >= from && created <= to;
                });

                const sumInwardQty = filteredRows.reduce(
                    (sum, r) => sum + (Number(r.inwardQty) || 0), 0
                );

                ageBrackets[range].clsQty = sumInwardQty;
                ageBrackets[range].clsValue = sumInwardQty * stdRate;

                totals[range].clsQty += sumInwardQty;
                totals[range].clsValue += sumInwardQty * stdRate;
            });

            totals.mainTotal.clsQty += clsQty;
            totals.mainTotal.clsValue += clsQty * stdRate;

            // NEW BUCKET LOGIC 
            let remainingQty = clsQty;
            const bucketOrder = ["0-30", "31-60", "61-90", "91-180", "181-365", ">365"];

            bucketOrder.forEach(range => {
                const sumInward = ageBrackets[range].clsQty;

                if (remainingQty <= 0) {
                    ageBrackets[range].clsQty = 0;
                    ageBrackets[range].clsValue = 0;
                    return;
                }

                const allocQty = Math.min(sumInward, remainingQty);

                ageBrackets[range].clsQty = allocQty;
                ageBrackets[range].clsValue = allocQty * stdRate;

                remainingQty -= allocQty;
            });


            // Skip if item has 0 clsQty and 0 clsValue
            if (clsQty === 0 || clsQty * stdRate === 0) {
                continue;
            }

            productFamilyGroup.stkDtl.push({
                storeId: latestRow.id,
                location: latestRow.location,
                itemId: latestRow.itemId,
                itemCode: latestRow.itemCode,
                itemName: latestRow.itemName,
                uom: latestRow.uom,
                stdRate: formatNumber(stdRate),
                clsQty: formatNumber(clsQty),
                clsValue: formatNumber(clsQty * stdRate),
                "0-30": ageBrackets["0-30"],
                "31-60": ageBrackets["31-60"],
                "61-90": ageBrackets["61-90"],
                "91-180": ageBrackets["91-180"],
                "181-365": ageBrackets["181-365"],
                ">365": ageBrackets[">365"]

            });

        }

        const result = Object.values(groupedData);

        return res.status(200).json({
            success: true,
            message: "Reverse Stock Age Report - Updated Bucket Allocation",
            data: result
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "An error occurred"
        });
    }
};


exports.stkAgeAbove45 = async (req, res) => {
    try {
        const repo = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
        const toDate = repo.date;

        if (!toDate) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid toDate."
            });
        }

        const toDateObj = new Date(toDate);

        const item = repo.items
            ? (Array.isArray(repo.items) ? repo.items : repo.items.split(',').map(i => i.trim()))
            : [];

        const itmGrpId = repo.itmGrpId
            ? (Array.isArray(repo.itmGrpId) ? repo.itmGrpId : repo.itmGrpId.split(',').map(id => id.trim()))
            : [];

        const locId = repo.locId;

        let query = `
            SELECT 
                s.*, 
                itm.id AS itemId,
                itm.itemCode,
                itm.itemName,
                itm.stdRate,
                uom.code AS uom
            FROM store s
            INNER JOIN items itm ON s.itemId = itm.id
            INNER JOIN mst_uom uom ON itm.uom = uom.id
            WHERE s.inwardQty > 0
              AND DATE(s.created_at) <= ?
        `;

        const queryParams = [toDate];
        const conditions = [];

        if (item.length) {
            conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
            queryParams.push(...item);
        }

        if (itmGrpId.length) {
            conditions.push(`itm.itemGroup IN (${itmGrpId.map(() => '?').join(', ')})`);
            queryParams.push(...itmGrpId);
        }

        if (locId) {
            conditions.push(`itm.mainLocation = ?`);
            queryParams.push(locId);
        }

        if (conditions.length) query += ' AND ' + conditions.join(' AND ');
        query += ` ORDER BY itm.id, s.created_at DESC`;

        const [rows] = await connection.execute(query, queryParams);

        /** GROUP STORE ROWS BY ITEM **/
        const itemsGrouped = {};
        rows.forEach(r => {
            if (!itemsGrouped[r.itemId]) itemsGrouped[r.itemId] = [];
            itemsGrouped[r.itemId].push(r);
        });

        /** GET LATEST CLOSING QTY (ONE ROW PER ITEM) **/
        const qtyQuery = `
            SELECT s1.itemId, s1.totQty
            FROM store s1
            INNER JOIN (
                SELECT itemId, MAX(id) AS max_id
                FROM store
                WHERE DATE(created_at) <= ?
                GROUP BY itemId
            ) x ON x.itemId = s1.itemId AND x.max_id = s1.id
        `;

        const [qtyRows] = await connection.execute(qtyQuery, [toDate]);

        const latestQtyMap = {};
        qtyRows.forEach(r => {
            latestQtyMap[r.itemId] = Number(r.totQty) || 0;
        });

        const result = [];

        /** MAIN LOGIC **/
        for (const itemId in itemsGrouped) {
            const itemRows = itemsGrouped[itemId];
            const latestRow = itemRows[0];

            const clsQty = latestQtyMap[itemId] || 0;
            if (clsQty <= 0) continue;

            const stdRate = Number(latestRow.stdRate) || 0;

            /** >45 DAYS INWARD QTY **/
            const above45Qty = itemRows.reduce((sum, r) => {
                const ageDays =
                    (toDateObj - new Date(r.created_at)) / (1000 * 60 * 60 * 24);
                return ageDays > 45 ? sum + (Number(r.inwardQty) || 0) : sum;
            }, 0);

            /** REVERSE ALLOCATION **/
            const allocQty = Math.min(above45Qty, clsQty);
            if (allocQty <= 0) continue;

            result.push({
                itemId: latestRow.itemId,
                itemCode: latestRow.itemCode,
                itemName: latestRow.itemName,
                uom: latestRow.uom,
                stdRate: stdRate.toFixed(3),
                clsQty: clsQty.toFixed(3),
                clsValue: (clsQty * stdRate).toFixed(3),
                ">45": {
                    clsQty: allocQty.toFixed(3),
                    clsValue: (allocQty * stdRate).toFixed(3)
                }
            });
        }

        return res.status(200).json({
            success: true,
            message: "Stock Aging Report (>45 Days)",
            data: result
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || "Something went wrong"
        });
    }
};


exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item code', 'Qty', 'GRN', 'Remarks']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text


        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Template.xlsx');

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


// Display data of Opening Balance xlsx file
exports.import = async (req, res) => {
    try {
        const buffer = await decodeBase64(req.body.file);

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const rowsPromises = [];
        let autoIncrementId = 1; // Initialize the auto-increment ID

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                const itemCode = row.getCell(1).value;
                const qty = row.getCell(2).value;
                const grn = row.getCell(3).value;
                const remarks = row.getCell(4).value;

                // Push a promise to rowsPromises array for each row
                rowsPromises.push(
                    (async () => {
                        try {
                            const itemId = await fetchItemId(itemCode); // Assuming fetchItemId is defined elsewhere

                            // Return valid row with no error
                            return {
                                id: autoIncrementId++, // Assign auto-increment ID and increment
                                rowNo: rowNumber,
                                itemId,
                                itemCode,
                                qty,
                                grn,
                                remarks,
                                errorRemark: null // No error
                            };
                        } catch (error) {
                            // Return row with error details in the `remark` key
                            return {
                                id: autoIncrementId++, // Assign auto-increment ID and increment
                                rowNo: rowNumber,
                                itemId: null, // Null for invalid item
                                itemCode,
                                qty,
                                grn,
                                remarks,
                                errorRemark: `Invalid Item code` // Add error remark here
                            };
                        }
                    })()
                );
            }
        });

        // Await all rows (including valid and invalid ones)
        const items = await Promise.all(rowsPromises);

        return res.status(200).json({
            success: true,
            message: 'Items details',
            items: items // Return the full array with valid and error rows
        });
    } catch (err) {
        console.error('Error importing items:', err);
        return res.status(500).json({
            success: false,
            message: 'An error occurred',
            error: err.message
        });
    }
};


exports.store = async (req, res) => {
    try {
        let user = req.headers.username;
        const { items } = req.body;

        // Prepare values for bulk insert with update on duplicate key
        const values = items.map(item => [
            item.itemId,
            item.itemCode,
            item.qty,
            item.grn,
            item.remarks,
            user
        ]);

        // Perform insert with ON DUPLICATE KEY UPDATE
        await connection.query(
            `INSERT INTO approval_stock (itemId, itemCode, qty, grn, remarks, addedBy)
             VALUES ? 
             ON DUPLICATE KEY UPDATE 
                qty = VALUES(qty), 
                grn = VALUES(grn), 
                remarks = VALUES(remarks), 
                addedBy = VALUES(addedBy)`,
            [values]
        );

        return handleSuccessResponse(res, 'Data Uploded successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};







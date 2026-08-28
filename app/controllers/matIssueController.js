const { connection, handleErrorResponse, handleSuccessResponse } = require("../config/dbSql")
const excel = require('exceljs');
const { formatFinancialYears } = require("../utility/docNo");
const { getFYRange } = require("../../cache/fyRange.cache");

exports.fetchMRP = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const offset = (page - 1) * limit;

        // Main query with pagination and fixed serial numbers
        const fetchQuery = `
            SELECT 
                (ROW_NUMBER() OVER (ORDER BY sm.id DESC)) AS sNo,
                sm.id, sm.category, sm.srnNo, mm.mrpNo, mm.orderNo, mm.poNo, sm.requestedBy,
                cust.cName AS customerName,
                DATE_FORMAT(sm.created_at, '%d-%m-%Y') AS date,
                DATE_FORMAT(sm.created_at, '%d-%m-%Y') AS requestedDate,
                DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate,
                ad.firstAuthBy AS approvedBy,
                DATE_FORMAT(ad.firstAuthDate, '%d-%m-%Y') AS approvedDate
            FROM srn_mst sm
            LEFT JOIN mrp_mst mm ON mm.id = sm.mrpMstId
            LEFT JOIN customer cust ON cust.id = mm.customerId
            LEFT JOIN order_plannings op ON op.id = mm.orderPlnId
            LEFT JOIN (
                SELECT refNo, 
                    MAX(firstAuthDate) AS firstAuthDate,
                    MAX(firstAuthBy) AS firstAuthBy
                FROM auth_docs
                GROUP BY refNo
            ) ad ON ad.refNo = sm.srnNo
            WHERE sm.authorized = ? 
            AND sm.issueStatus = ? 
            AND EXISTS (
                    SELECT 1
                    FROM srn s 
                    JOIN items i ON i.id = s.itemId
                    JOIN (
                        SELECT st1.itemId, st1.totQty 
                        FROM store st1
                        INNER JOIN (
                            SELECT itemId, MAX(id) AS lastId 
                            FROM store 
                            GROUP BY itemId
                        ) st2 ON st1.itemId = st2.itemId AND st1.id = st2.lastId
                    ) stk ON stk.itemId = i.id
                    WHERE s.srnMstId = sm.id
                    AND stk.totQty > 0 
                    AND s.issuedQty < (s.Qty - s.shortCloseQty)
            )
            ORDER BY sm.id DESC
            LIMIT ? OFFSET ?
        `;

        // Correct parameters - no offset for serial number
        const [material] = await connection.execute(fetchQuery, [
            1,       // sm.authorized
            0,       // sm.issueStatus
            limit,
            offset
        ]);

        // Count query (distinct SRNs only)
        const [countResult] = await connection.execute(`
            SELECT COUNT(DISTINCT sm.id) AS total
            FROM srn_mst sm
            WHERE sm.authorized = ? 
              AND sm.issueStatus = ? 
              AND EXISTS (
                    SELECT 1
                    FROM srn s 
                    JOIN items i ON i.id = s.itemId
                    JOIN (
                        SELECT st1.itemId, st1.totQty 
                        FROM store st1
                        INNER JOIN (
                            SELECT itemId, MAX(id) AS lastId 
                            FROM store 
                            GROUP BY itemId
                        ) st2 ON st1.itemId = st2.itemId AND st1.id = st2.lastId
                    ) stk ON stk.itemId = i.id
                    WHERE s.srnMstId = sm.id
                      AND stk.totQty > 0 
                      AND s.issuedQty < s.Qty 
                      AND s.shortClose = 0
              )
        `, [1, 0]);

        const totRows = countResult[0].total;
        const totalPages = Math.ceil(totRows / limit);

        return res.status(200).json({
            success: true,
            message: "Material-Issue lists",
            data: material,
            totRows,
            totalPages,
            currentPage: page,
            pageSize: limit
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

async function fetchAllocatedMaterials(srnMstId, loc) {
    try {
        let fetchQuery = `
            SELECT 
                ROW_NUMBER() OVER (ORDER BY srn.id) AS sNo, 
                srn.id, jc.jcNo, items.itemCode, srn.fim, items.material AS rawMaterialName,  
                items.id AS itemId, items.itemName, items.shelfLifeItem, items.stockControl AS defaultStockLock, 
                st.totStk, uom.name AS uom, srn.nestNo, srn.jcNos, (srn.Qty - srn.shortCloseQty) AS reqQty, 
                0 AS allocQty, srn.issuedQty, loc.name AS location, srn_mst.requestedBy, 
                srn_mst.srnNo, srn_mst.category, DATE_FORMAT(srn_mst.created_at, '%d-%m-%Y') AS srnDate
            FROM srn
            INNER JOIN srn_mst ON srn.srnMstId = srn_mst.id
            INNER JOIN items ON items.id = srn.itemId
            LEFT JOIN item_main_loc AS loc ON loc.id = items.mainLocation
            LEFT JOIN job_card jc ON jc.id = srn.jcId
            INNER JOIN mst_uom AS uom ON uom.id = items.uom
            LEFT JOIN (
                SELECT s1.itemId, s1.totQty AS totStk
                FROM store s1
                INNER JOIN (
                    SELECT itemId, MAX(id) AS lastId
                    FROM store
                    GROUP BY itemId
                ) x ON s1.itemId = x.itemId AND s1.id = x.lastId
            ) st ON st.itemId = items.id
            WHERE srn.srnMstId = ? 
              AND srn.shortCloseQty < srn.Qty 
              AND st.totStk > 0
              AND srn.issuedQty < srn.Qty
        `;

        const params = [srnMstId];

        if (Array.isArray(loc) && loc.length > 0) {
            const placeholders = loc.map(() => '?').join(', ');
            fetchQuery += ` AND loc.id IN (${placeholders})`;
            params.push(...loc);
        }

        const [data] = await connection.execute(fetchQuery, params);
        return data;
    } catch (err) {
        throw err;
    }
}

exports.allocatedMaterials = async (req, res) => {
    try {
        const mrpMstId = req.params.id;
        const loc = req.body.loc; // Should be an array like [2, 4, 5]   //Loc updated on 29-04-2025

        const materials = await fetchAllocatedMaterials(mrpMstId, loc);
        return res.status(200).json({ success: true, message: "Material-Issue lists", data: materials })
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message })
    }
}

exports.materialIsuueExport = async (req, res) => {
    try {
        const { mrpMstId } = req.query;

        const materials = await fetchAllocatedMaterials(mrpMstId);

        const [srnRows] = await connection.execute(`SELECT category FROM srn_mst WHERE id = ?`, [mrpMstId]);

        const categoryHeaders = srnRows[0]?.category === 'Production'
            ? [{ header: 'Nesting No', key: 'nestNo', width: 25 }, { header: 'JobCards', key: 'jcNos', width: 25 }]
            : [{ header: 'JobCard No', key: 'jcNo', width: 20 }];

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Materials');

        worksheet.columns = [
            { header: 'Sl No', key: 'sNo', width: 10 },
            { header: 'SRN No', key: 'srnNo', width: 20 },
            { header: 'SRN Date', key: 'srnDate', width: 18 },
            ...categoryHeaders,
            { header: 'Item Code', key: 'itemCode', width: 30 },
            { header: 'Fim', key: 'fim', width: 20 },
            { header: 'Raw Material', key: 'rawMaterialName', width: 20 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Default Stock', key: 'defaultStockLock', width: 20 },
            { header: 'Availabel Stock', key: 'totStk', width: 20 },
            { header: 'Uom', key: 'uom', width: 20 },
            { header: 'Requested Qty', key: 'reqQty', width: 20 },
            { header: 'Allocated Qty', key: 'allocQty', width: 20 },
            { header: 'Issued Qty', key: 'issuedQty', width: 20 },
            { header: 'location', key: 'location', width: 20 },
            { header: 'Requested By', key: 'requestedBy', width: 20 },
        ];

        // Apply styles to the header row
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, size: 12 }; // Make text bold
        headerRow.alignment = { horizontal: "center" }; // Center align text

        materials.forEach(row => {
            worksheet.addRow(row);
        });

        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                cell.alignment = { horizontal: 'center' };
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();

        res.setHeader('Content-Disposition', 'attachment; filename="Material-Issue.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.viewIssueNote = async (req, res) => {
    try {
        const { type, id } = req.query;
        const { from, to } = getFYRange(req);

        let issueQuery = `
            SELECT mi.id, mi.docNo, mi.issueNo, mi.issuedBy, DATE_FORMAT(mi.issueDate, '%d-%m-%Y') AS issuedDate
            FROM material_issue_note mi
            WHERE mi.created_at BETWEEN ? AND ?
        `;
        let params = [from, to];

        switch (type) {
            case 'first':
                issueQuery += ` ORDER BY mi.id ASC LIMIT 1`;
                break;
            case 'last':
                issueQuery += ` ORDER BY mi.id DESC LIMIT 1`;
                break;
            case 'forward':
                issueQuery += ` AND mi.id > ? ORDER BY mi.id ASC LIMIT 1`;
                params.push(id);
                break;
            case 'reverse':
                issueQuery += ` AND mi.id < ? ORDER BY mi.id DESC LIMIT 1`;
                params.push(id);
                break;
            case 'view':
                issueQuery += ` AND mi.id = ?`;
                params.push(id);
                break;
        }
        const [rows] = await connection.execute(issueQuery, params);

        const [issueItems] = await connection.execute(`
            SELECT ROW_NUMBER() OVER (ORDER BY id) AS sNo, m.id, sm.srnNo, sm.category, sm.requestedBy, DATE_FORMAT(sm.created_at, '%d-%m-%Y') AS srnDate, items.itemCode, items.itemName, 
            srn.fim, srn.grn, uom.name as uom, srn.Qty as srnQty, m.availableStk as totStk, m.issuedQty
            FROM material_issue_dtl m
            INNER JOIN srn ON srn.id = m.srnId 
            INNER JOIN srn_mst sm ON sm.id = srn.srnMstId 
            INNER JOIN items ON items.id = m.itemId            
            LEFT JOIN item_main_loc AS loc ON loc.id = items.mainLocation            
            INNER JOIN mst_uom as uom ON uom.id = items.uom           
            WHERE m.issueId = ?
        `, [rows[0]?.id || 0]);

        return res.status(200).json({
            success: true,
            issueDetails: rows[0],
            issueItems
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.searchIssueNo = async (req, res) => {
    try {
        const { q } = req.query;

        let fetchQuery = `SELECT id, issueNo FROM material_issue_note`;
        let values = [];

        if (q) {
            fetchQuery += ` WHERE issueNo LIKE ?`;
            values.push(`%${q}%`);
        }
        const [rows] = await connection.execute(fetchQuery, values);

        return handleSuccessResponse(res, 'Issue No list', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.indentReport = async (req, res) => {
    try {
        let { fromDate, toDate, itemCode, page = 1, limit = 100 } = req.query;

        if (!fromDate || !toDate) {
            throw new CustomError("fromDate and toDate are required");
        }

        page = parseInt(page);
        limit = parseInt(limit);
        const offset = (page - 1) * limit;

        const from = `${fromDate} 00:00:00`;
        const to = `${toDate} 23:59:59`;

        const params = [from, to];
        let itemCodeQuery = "";

        if (itemCode) {
            itemCodeQuery = " AND srn.itemCode = ? ";
            params.push(itemCode);
        }

        const [rows] = await connection.execute(`
            SELECT 
                srn.id,
                sm.srnNo,
                srn.itemCode,
                itm.itemName,
                srn.Qty AS srnQty,
                COALESCE(SUM(mid.issuedQty), 0) AS issuedQty,
                DATE_FORMAT(srn.created_at, '%d-%m-%Y') AS srnDate
            FROM srn
            LEFT JOIN items itm 
                ON itm.id = srn.itemId
            LEFT JOIN srn_mst sm 
                ON sm.id = srn.srnMstId
            LEFT JOIN material_issue_dtl mid 
                ON mid.srnId = srn.id
            WHERE srn.created_at BETWEEN ? AND ?
            ${itemCodeQuery}
            GROUP BY srn.id
            ORDER BY srn.created_at DESC
            LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const [countRows] = await connection.execute(
            `
            SELECT COUNT(*) AS total
            FROM srn
            WHERE srn.created_at BETWEEN ? AND ?
            ${itemCode ? " AND srn.itemCode = ?" : ""}
            `,
            params
        );

        const total = countRows[0].total;
        const totalPages = Math.ceil(total / limit);

        let sNo = offset + 1;
        const finalRows = rows.map(r => ({
            sNo: sNo++,
            ...r
        }));

        return res.status(200).json({
            success: true,
            message: 'Requirement V/S IndentIssue details',
            page,
            total,
            totalPages,
            data: finalRows
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.srnReport = async (req, res) => {
    try {
        let { fromDate, toDate } = req.query;

        if (!fromDate || !toDate) {
            throw new CustomError("fromDate and toDate are required");
        }

        const from = `${fromDate} 00:00:00`;
        const to = `${toDate} 23:59:59`;

        const params = [from, to];

        const [rows] = await connection.execute(`
            SELECT 
                srn.id,
                sm.srnNo,
                srn.itemCode,
                itm.itemName,
                srn.Qty AS srnQty,
                COALESCE(SUM(mid.issuedQty), 0) AS issuedQty,
                DATE_FORMAT(srn.created_at, '%d-%m-%Y') AS srnDate
            FROM srn
            LEFT JOIN items itm 
                ON itm.id = srn.itemId
            LEFT JOIN srn_mst sm 
                ON sm.id = srn.srnMstId
            LEFT JOIN material_issue_dtl mid 
                ON mid.srnId = srn.id
            WHERE srn.created_at BETWEEN ? AND ?
            GROUP BY srn.id
            ORDER BY srn.created_at DESC
            LIMIT ? OFFSET ?`,
            params
        );

        const total = countRows[0].total;
        const totalPages = Math.ceil(total / limit);

        let sNo = offset + 1;
        const finalRows = rows.map(r => ({
            sNo: sNo++,
            ...r
        }));

        return res.status(200).json({
            success: true,
            message: 'Requirement V/S IndentIssue details',
            totalPages,
            data: finalRows
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

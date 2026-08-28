const { getFYRange } = require("../../cache/fyRange.cache");
const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require("../config/dbSql");
const { generateDocNo, updateDocCounter } = require("../utility/docNo");
const { decodeBase64, updateCounter } = require("../utility/utilityFunction");
const excel = require('exceljs');

exports.generateSrnNo = async (req) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { uniqueNo: srn } = await generateDocNo(conn, req, { docType: 'Srn' });
        const { uniqueNo: issue } = await generateDocNo(conn, req, { docType: 'MaterialIssueNote' });

        await conn.commit();

        return { srn, issue };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

exports.getSrnNo = async (req, res) => {
    try {
        let { srn, issue } = await this.generateSrnNo(req);

        return handleSuccessResponse(res, 'Srn number', { srnNo: srn, issueNo: issue });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.items = async (req, res) => {
    try {
        const { q } = req.query;

        let fetch = `
            SELECT items.id, items.itemCode as label, items.itemName, uom.name as uom, pf.name as productFamily FROM items 
            INNER JOIN mst_uom uom ON items.uom = uom.id
            INNER JOIN item_product_family pf ON items.productFamily = pf.id
            WHERE items.inActive = 0
        `;

        const values = [];
        if (q) {
            fetch += ` AND (items.itemCode LIKE ?)`;
            values.push(`%${q}%`);
        }

        // Add ORDER BY clause to sort the results with item codes containing special characters last
        // fetch += ` ORDER BY CASE WHEN items.itemCode LIKE '%[^a-zA-Z0-9]%' THEN 1 ELSE 0 END, items.itemCode LIMIT 20`;  // including white space
        fetch += ` ORDER BY CASE WHEN items.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, items.itemCode LIMIT 30`;

        const [rows] = await connection.execute(fetch, values);

        return handleSuccessResponse(res, 'Items list', rows)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.getData = async (req, res) => {
    try {
        const { id } = req.params; // Destructure `id` from `req.params`

        // Query for `srn_mst`
        const mainQuery = `
            SELECT 
                srn.*,
                DATE_FORMAT(srn.created_at, '%d-%m-%Y') AS srnDate
            FROM srn_mst srn
            WHERE srn.id = ?
        `;

        // Query for `srn` details
        const detailsQuery = `
            SELECT 
                srn.id, 
                items.itemCode AS label, 
                srn.fim, 
                srn.nestNo, 
                srn.jcNos, 
                items.material AS rawMaterialName, 
                items.itemName, 
                items.totStk, 
                uom.name AS uom, 
                srn.Qty AS srnQty, 
                srn.remarks, 
                pf.name AS pf, 
                loc.name AS location
            FROM srn
            INNER JOIN items ON items.id = srn.itemId
            LEFT JOIN item_main_loc loc ON loc.id = items.mainLocation
            LEFT JOIN mst_uom uom ON uom.id = items.uom
            LEFT JOIN item_product_family pf ON items.productFamily = pf.id
            WHERE srn.srnMstId = ?
        `;

        // Execute queries in parallel
        const [mainResult, detailsResult] = await Promise.all([
            connection.execute(mainQuery, [id]),
            connection.execute(detailsQuery, [id]),
        ]);

        const [data] = mainResult;
        const [data2] = detailsResult;

        // Return the response
        return res.status(200).json({
            success: true,
            data, // Renamed to indicate it's the main result
            data2, // Renamed to indicate it's the detailed result
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.getSrnByType = async (req, res) => {
    try {
        const { type } = req.params;

        const cleanType = type.trim().toUpperCase();
        if (!cleanType) {
            throw new CustomError("Type parameter cannot be empty", 400);
        }

        const [rows] = await connection.execute(`
            SELECT id, srnNo 
            FROM srn_mst 
            WHERE UPPER(srnNo) LIKE ? 
            ORDER BY id DESC 
            LIMIT 20
        `, [`%${cleanType}%`]);

        return handleSuccessResponse(res, "SRN List", rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.display = async (req, res) => {
    try {
        const { type, id } = req.query;
        const { from, to } = getFYRange(req);

        // Base SRN master query
        let srnMstQuery = `
            SELECT 
                srn.id, srn.srnNo, srn.category, srn.authorized,
                DATE_FORMAT(srn.created_at, '%d-%m-%Y') AS srnDate, 
                DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate 
            FROM srn_mst srn
            LEFT JOIN mrp_mst mm ON mm.id = srn.mrpMstId
            LEFT JOIN order_plannings op ON op.id = mm.orderPlnId
            WHERE srn.created_at BETWEEN ? AND ?
        `;
        const srnMstParams = [from, to];

        // Determine SRN navigation type
        switch (type) {
            case 'first':
                srnMstQuery += ` ORDER BY srn.id ASC LIMIT 1`;
                break;
            case 'last':
                srnMstQuery += ` ORDER BY srn.id DESC LIMIT 1`;
                break;
            case 'forward':
                srnMstQuery += ` AND srn.id > ? ORDER BY srn.id ASC LIMIT 1`;
                srnMstParams.push(id);
                break;
            case 'reverse':
                srnMstQuery += ` AND srn.id < ? ORDER BY srn.id DESC LIMIT 1`;
                srnMstParams.push(id);
                break;
            case 'view':
                srnMstQuery += ` AND srn.id = ? ORDER BY srn.id DESC LIMIT 1`;
                srnMstParams.push(id);
                break;
            default:
                return res.status(400).json({ success: false, message: 'Invalid type' });
        }

        // Execute SRN master query
        const [srnMstResult] = await connection.execute(srnMstQuery, srnMstParams);

        if (srnMstResult.length === 0) {
            return res.status(200).json({ success: true, data: [], data2: [] });
        }

        const srnMstId = srnMstResult[0].id;

        // SRN detail query
        const srnDetailQuery = `
            SELECT 
                ROW_NUMBER() OVER (ORDER BY srn.id) AS sNo,
                srn.id, 
                jc.jcNo, 
                items.itemCode AS label,  
                srn.fim, 
                items.material AS rawMaterialName, 
                items.itemName, 
                items.totStk, 
                uom.name AS uom, 
                srn.Qty AS srnQty, 
                srn.remarks, 
                pf.name AS pf, 
                loc.name AS location     
            FROM srn
            INNER JOIN items ON items.id = srn.itemId            
            LEFT JOIN item_main_loc AS loc ON loc.id = items.mainLocation            
            LEFT JOIN job_card jc ON jc.id = srn.jcId            
            INNER JOIN mst_uom AS uom ON uom.id = items.uom      
            LEFT JOIN item_product_family pf ON items.productFamily = pf.id 
            WHERE srn.srnMstId = ?
        `;

        const [srnDetailResult] = await connection.execute(srnDetailQuery, [srnMstId]);

        return res.status(200).json({
            success: true,
            data: srnMstResult,
            data2: srnDetailResult,
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

//Download Template only for Item_VS_ Process 
exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Part No', 'SRN QTY', 'Remarks']);

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

exports.import = async (req, res) => {
    try {
        const buffer = decodeBase64(req.body.file)

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const items = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) {
                const dtl = {
                    rowNo: rowNumber,
                    label: row.getCell(1).value,
                    srnQty: row.getCell(2).value,
                    remarks: row.getCell(3).value,
                };

                items.push(dtl);
            }
        });
        const itemCodes = items.map(dtl => dtl.label);
        const placeholders = itemCodes.map(() => '?').join(', ');

        const itemQuery = `
            SELECT items.id AS itemId, items.itemCode, items.itemName, uom.name as uom, pf.name as pf
            FROM items
            LEFT JOIN mst_uom uom ON items.uom = uom.id
            LEFT JOIN item_product_family pf ON items.productFamily = pf.id
            WHERE items.itemCode IN (${placeholders})
        `;
        const [itemResults] = await connection.execute(itemQuery, itemCodes);

        const itemMap = new Map();
        itemResults.forEach(item => {
            itemMap.set(item.itemCode, item);
        });

        const itemList = [];

        for (const dtl of items) {
            const itemDetails = itemMap.get(dtl.label);

            if (!itemDetails) {
                itemList.push(dtl.label);
            } else {
                dtl.itemId = itemDetails.itemId;
                dtl.itemName = itemDetails.itemName;
                dtl.uom = itemDetails.uom;
                dtl.productFamily = itemDetails.pf;
            }
        }

        if (itemList.length) throw new CustomError(`Invalid Items ${itemList.join(', ')}`, 404);

        return res.status(200).json({
            success: true,
            message: 'Items fetched successfully',
            display: items
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

async function fetchId(itemCode) {
    try {
        const query = `
            SELECT items.id AS itemId, items.itemName, uom.name as uom, pf.name as pf FROM items
            LEFT JOIN mst_uom uom ON items.uom = uom.id
            LEFT JOIN item_product_family pf ON items.productFamily = pf.id 
            WHERE items.itemCode = ?`;

        const [result] = await connection.execute(query, [itemCode]);

        if (result.length > 0) {
            return result[0];
        } else {
            return null;
        }
    } catch (error) {
        throw new Error(`Error fetching data for itemCode: ${itemCode}`);
    }
}


exports.update = async (req, res) => {
    try {
        const id = req.params.id; // `srnMstId`
        const data2 = req.body.data2; // Array of objects

        if (!Array.isArray(data2) || data2.length === 0) {
            return res.status(400).json({ success: false, message: "data2 must be a non-empty array" });
        }

        const updateQuery = `
            UPDATE srn  SET Qty = ? 
            WHERE id = ? AND srnMstId = ?
            `;

        for (const dtl of data2) {
            await connection.execute(updateQuery, [dtl.srnQty, dtl.id, id]);
        }

        return res.status(200).json({ success: true, message: "Successfully updated all records" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || "An error occurred" });
    }
};

exports.delete = async (req, res) => {
    try {
        const id = req.params.id;

        // Execute the DELETE query
        const [result] = await connection.execute('DELETE FROM srn_mst WHERE id = ?', [id]);

        // Check if any rows were affected (deleted)
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Record not found" });
        }

        return res.status(200).json({ success: true, message: "Successfully deleted" })

    } catch (err) {
        return res.status(401).json({ success: false, message: err.message || "An error occurred" });
    }
};

exports.insertSrnItems = async (conn, req, mrpMstId, orderId, srnNo, issueNo, fimNo, shipmentDate, requestedBy, srnItems, category) => {
    try {
        if (!Array.isArray(srnItems) || srnItems.length === 0) {
            return null;
        }
        let uniqueSrnNo = srnNo, uniqueIssueNo = issueNo;

        const [srnRows] = await conn.execute(`SELECT id FROM srn_mst WHERE srnNo = ?`, [srnNo]);
        if (srnRows.length > 0) {
            await updateCounter('Srn');
            const { srn, issue } = await this.generateSrnNo(req);
            uniqueSrnNo = srn;
            uniqueIssueNo = issue;
        }
        const [srnMst] = await conn.execute(`INSERT INTO srn_mst (srnNo, issueNo, category, mrpMstId, orderId, fim, shipmentDate, requestedBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
            [uniqueSrnNo, uniqueIssueNo, category ?? null, mrpMstId ?? null, orderId ?? null, fimNo ?? null, shipmentDate ?? null, requestedBy ?? null]
        );

        if (srnMst.affectedRows > 0) {
            const insertedId = srnMst.insertId;

            const insertPromises = srnItems.map(item => {
                const mrpId = item.mrpId ?? null;
                const sobId = item.sobId ?? null;
                const jcId = item.jcId ?? null;
                const itemId = item.itemId ?? item.id ?? null;
                const itemCode = item.label ?? item.itemCode ?? null;
                const qty = item.srnQty ?? item.Qty ?? null;
                const fim = item.fim ?? fimNo ?? null;
                const remarks = item.remarks ?? null;
                const jcNos = item.jcNos ?? null;

                return conn.execute(
                    'INSERT INTO srn (srnMstId, mrpId, sobId, jcId, jcNos, itemId, itemCode, Qty, fim, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [insertedId, mrpId, sobId, jcId, jcNos, itemId, itemCode, qty, fim, remarks]
                );
            });

            // Wait for all insert operations to complete
            await Promise.all(insertPromises);

            await updateDocCounter(conn, 'Srn');
            await updateDocCounter(conn, 'MaterialIssueNote');

            await conn.commit();
            return insertedId;
        }
        throw new CustomError('Insertion failed!', 400);
    } catch (err) {
        await conn.rollback();  // Rollback transaction on error
        throw err;
    } finally {
        conn.release();  // Release the connection back to the pool
    }
}


exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { srnNo, fim, srnItems, isAssembly } = req.body;
        const requestedBy = req.headers.username ?? 'admin';
        const srnType = isAssembly == 1 ? 'Assembly SRN' : 'Manual SRN';

        const items = srnItems.filter(item => item.itemName !== undefined);
        if (items.length === 0) throw new CustomError('Please select Items!', 400);

        const { issue: issueNo } = await this.generateSrnNo(req);

        let uniqueSrnNo = srnNo, uniqueIssueNo = issueNo;

        const [srnRows] = await conn.execute(`SELECT id FROM srn_mst WHERE srnNo = ?`, [srnNo]);
        if (srnRows.length > 0) {
            await updateCounter('Srn');
            const { srn, issue } = await this.generateSrnNo(req);
            uniqueSrnNo = srn;
            uniqueIssueNo = issue;
        }

        await this.insertSrnItems(conn, req, null, null, uniqueSrnNo, uniqueIssueNo, fim ?? null, null, requestedBy, items, srnType);

        // Update counter
        await updateDocCounter(conn, 'Srn');
        await updateDocCounter(conn, 'MaterialIssueNote');

        return handleSuccessResponse(res, 'Srn successful');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}


async function fetchItemsDetails(bomMstId) {
    const query = `
        SELECT items.id as itemId, items.itemCode, items.isBom, bom.Qty as bomQty, items.itemName, uom.name as uom, pf.name as pf FROM bom 
            INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
            INNER JOIN items ON items.id = bom.itemId
            INNER JOIN mst_uom uom ON items.uom = uom.id
            INNER JOIN item_product_family pf ON items.productFamily = pf.id
        WHERE bom_mst.itemId = ?
    `;
    const [bom] = await connection.execute(query, [bomMstId]);
    return bom;
}


// Recursive function to fetch child details
async function childItems(bomMstItem, mainItemId, mainItemCode, bomMstQty, srnQty) {
    try {
        const itemsList = [];
        const bom = await fetchItemsDetails(mainItemId);

        for (const element of bom) {
            const { itemId, itemCode, isBom, bomQty, itemName, uom, pf } = element;

            if (isBom == 'Y') {
                const childParts = await childItems(bomMstItem, itemId, itemCode, bomQty, srnQty); // Recursive call
                itemsList.push(...childParts);
            } else {
                const Qty = Number(bomQty) * Number(srnQty) * Number(bomMstQty);
                itemsList.push({ mainItemCode: bomMstItem, itemId, label: itemCode, Qty, itemName, uom, pf });
            }
        }

        return itemsList;
    } catch (error) {
        throw error;
    }
}


exports.assemblySrn = async (req, res) => {
    try {
        const { file } = req.body;

        const buffer = await decodeBase64(file);

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const items = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                items.push({
                    itemCode: row.getCell(1).text,
                    srnQty: row.getCell(2).text,
                });
            }
        });

        const itemsList = [];
        for (const element of items) {
            const { itemCode: mainItemCode, srnQty } = element;

            const fetch = `
                SELECT items.id as mainItemId, items.itemName as mainItemName, uom.name as mainUom, pf.name as mainPf FROM items 
                    INNER JOIN mst_uom uom ON items.uom = uom.id
                    INNER JOIN item_product_family pf ON items.productFamily = pf.id
                WHERE items.dflag = ? AND items.itemCode = ?
            `;

            const [rows] = await connection.execute(fetch, ['0', mainItemCode]);

            if (rows.length < 0) {
                throw new CustomError('Item not found!', 404);
            }
            const { mainItemId, mainItemName, mainUom, mainPf } = rows[0];

            const query = `
                SELECT items.id as itemId, items.itemCode, items.isBom, bom.Qty as bomQty, items.itemName, uom.name as uom, pf.name as pf FROM bom 
                    INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
                    INNER JOIN items ON items.id = bom.itemId
                    INNER JOIN mst_uom uom ON items.uom = uom.id
                    INNER JOIN item_product_family pf ON items.productFamily = pf.id
                WHERE bom_mst.itemCode = ?
            `;

            const [bomMst] = await connection.execute(query, [mainItemCode]);

            if (bomMst.length > 0) {
                for (const items of bomMst) {
                    const { itemId, itemCode, isBom, bomQty, itemName, uom, pf } = items;

                    if (isBom == 'Y') {
                        const childParts = await childItems(mainItemCode, itemId, itemCode, bomQty, srnQty); // Recursive call
                        itemsList.push(...childParts);
                    } else {
                        const Qty = Number(srnQty) * Number(bomQty);
                        itemsList.push({ mainItemCode, itemId, label: itemCode, Qty, itemName, uom, pf });
                    }
                }
            } else {
                itemsList.push({ mainItemCode: mainItemCode, itemId: mainItemId, label: mainItemCode, Qty: srnQty, itemName: mainItemName, uom: mainUom, pf: mainPf });
            }
        }
        const finalResult = itemsList.map((item, index) => ({ id: index + 1, ...item }))

        return handleSuccessResponse(res, 'Successful', finalResult);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.srnReport = async (req, res) => {
    try {
        const { fromDate, toDate, items = [], locations = [], type, view } = req.body;

        let srnQuery = `
            SELECT 
                x.id,
                x.requestedBy,
                x.srnNo,
                x.srnDate,
                x.location,
                x.itemCode,
                x.itemName,
                x.uom,

                x.actualSrnQty AS srnQty,
                (x.srnQty - x.issuedQty) AS pendingQty,

                COALESCE(stk.totStk, 0) AS totStk,
                x.fim,
                x.category,

                CASE
                    WHEN COALESCE(stk.totStk, 0) < (x.srnQty - x.issuedQty)
                        THEN (x.srnQty - x.issuedQty) - COALESCE(stk.totStk, 0)
                    ELSE 0
                END AS shortage

            FROM (
                SELECT
                    s.id,
                    sm.requestedBy,
                    sm.srnNo,
                    DATE_FORMAT(sm.created_at, '%d-%m-%Y') AS srnDate,
                    loc.name AS location,
                    s.itemCode,
                    s.itemId,
                    i.itemName,
                    uom.name AS uom,

                    s.Qty AS actualSrnQty,
                    (s.Qty - s.shortCloseQty) AS srnQty,
                    s.issuedQty,

                    s.fim,
                    i.category,
                    sm.issueStatus

                FROM srn s
                INNER JOIN srn_mst sm ON sm.id = s.srnMstId
                INNER JOIN items i ON i.id = s.itemId
                LEFT JOIN mst_uom uom ON uom.id = i.uom
                LEFT JOIN item_main_loc loc ON loc.id = i.mainLocation

                WHERE DATE(sm.created_at) >= ?
                  AND DATE(sm.created_at) <= ?
            ) x
            LEFT JOIN (
                SELECT st1.itemId, st1.totQty AS totStk
                FROM store st1
                INNER JOIN (
                    SELECT itemId, MAX(id) AS lastId
                    FROM store
                    GROUP BY itemId
                ) st2 ON st1.itemId = st2.itemId AND st1.id = st2.lastId
            ) stk ON stk.itemId = x.itemId
            WHERE 1 = 1
        `;

        const values = [fromDate, toDate];

        // 🔹 Shortage view filter
        if (view === 'Shortage') {
            srnQuery += `
                AND x.issueStatus = 0
                AND COALESCE(stk.totStk, 0) < (x.srnQty - x.issuedQty)
            `;
        }

        // 🔹 Item filter
        if (items.length > 0) {
            const placeholders = items.map(() => '?').join(',');
            srnQuery += ` AND x.itemId IN (${placeholders})`;
            values.push(...items);
        }

        // 🔹 Location filter
        if (locations.length > 0) {
            const placeholders = locations.map(() => '?').join(',');
            srnQuery += ` AND x.location IS NOT NULL
                          AND x.itemId IN (
                              SELECT id FROM items WHERE mainLocation IN (${placeholders})
                          )`;
            values.push(...locations);
        }

        const [srnData] = await connection.execute(srnQuery, values);

        return handleSuccessResponse(res, 'SRN Report', srnData);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

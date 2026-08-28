const { connection, handleSuccessResponse, handleErrorResponse, CustomError } = require("../config/dbSql");
const { decodeBase64, getUser } = require("../utility/utilityFunction");
const excel = require('exceljs');
const { generateDocNo, updateDocCounter } = require("../utility/docNo");

exports.template = async (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('PCN Template', { properties: { tabColor: { argb: 'FFC0000' } } });

        const headerRow = worksheet.addRow(['Part No', 'Basic Rate', 'LCR', 'Freight', 'Remarks']);

        headerRow.font = { bold: true, size: 13 };
        headerRow.alignment = { horizontal: 'center' };

        worksheet.columns.forEach((column) => {
            column.width = 22;
        });

        const buffer = await workbook.xlsx.writeBuffer();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=PCN_Template.xlsx');

        res.send(buffer);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.getSrnNo = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'Pcn' });

        await conn.commit(); 

        return handleSuccessResponse(res, 'Pcn number', { docNo: padStartNo, pcnNo: uniqueNo });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

exports.import = async (req, res) => {
    try {
        const buffer = await decodeBase64(req.body.file);

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const items = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                const item = {
                    itemCode: row.getCell(1).value,
                    basicRate: row.getCell(2).value,
                    lcr: row.getCell(3).value,
                    freight: row.getCell(4).value,
                    remarks: row.getCell(5).value,
                }
                items.push(item);
            }
        });

        const finalSet = await Promise.all(items.map(async (item, index) => {
            const { itemCode, basicRate } = item;

            const [rows] = await connection.execute(`
                SELECT items.id as itemId, items.itemName, mst_uom.name as uom,
                    COALESCE(pcn.basicRate, 0) as prevBasePrice,
                    DATE_FORMAT(pcn_mst.effectiveFromDt, '%d-%m-%Y') AS lastEffectivefromDt, pcn.existingRate, pcn.existingLcr, pcn.existingFreight, pcn.existingLanding
                FROM items
                LEFT JOIN mst_uom ON mst_uom.id = items.uom
                LEFT JOIN pcn ON pcn.id = (
                    SELECT pcn2.id
                    FROM pcn pcn2
                    WHERE pcn2.itemCode = items.itemCode
                    ORDER BY pcn2.id DESC
                    LIMIT 1
                )
                LEFT JOIN pcn_mst ON pcn_mst.id = pcn.pcnMstId
                WHERE items.itemCode = ?
            `, [itemCode]);

            if (rows.length > 0) {
                const { itemId, itemName, uom, prevBasePrice, lastEffectivefromDt, existingRate, existingLcr, existingFreight, existingLanding } = rows[0];
                const diffrence = parseFloat(prevBasePrice) === 0 ? 0 : parseFloat(basicRate) - parseFloat(prevBasePrice)

                return { id: index + 1, itemId, itemName, uom, lastEffectivefromDt, existingRate, existingLcr, existingFreight, existingLanding, ...item, landing: null, diffrence: diffrence.toFixed(2), errorMessages: null };
            } else {
                return { id: index + 1, itemId: null, itemName: null, uom: null, lastEffectivefromDt: null, existingRate: null, existingLcr: null, existingFreight: null, existingLanding: null, ...item, landing: null, diffrence: 0, errorMessages: `Invalid Part: ${itemCode}` };
            }
        }));

        return handleSuccessResponse(res, 'Items-details', finalSet);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


exports.storePCN = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { docNo, pcnNo, effectiveFromDt, refNo, pcnItems } = req.body;
        const createdBy = await getUser(req);

        if(!pcnItems.length) {
            throw new CustomError('Please select items!', 400);
        }

        const [pcnMst] = await conn.execute(`
            INSERT INTO pcn_mst (docNo, pcnNo, effectiveFromDt, refNo, createdBy, authorized) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, [docNo, pcnNo, effectiveFromDt, refNo, createdBy, 0]);

        if (pcnMst.affectedRows > 0) {
            const pcnMstId = pcnMst.insertId;

            const insertPromises = pcnItems.map(item => {
                if (item.itemName == null) {
                    throw new CustomError(`Item not registered: ${item.itemCode}`)
                }
                return conn.execute(
                    'INSERT INTO pcn (pcnMstId, itemId, itemCode, lastEffectivefromDt, existingRate, existingLcr, existingFreight, existingLanding, basicRate, landing, difference, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [pcnMstId, item.itemId, item.itemCode, item.lastEffectivefromDt, item.existingRate ?? 0, item.existingLcr ?? 0, item.existingFreight ?? 0, item.existingLanding ?? 0, item.basicRate, item.landing, item.diffrence, item.remarks]
                );
            });

            await Promise.all(insertPromises);  // Wait for all insert operations to complete`
            await updateDocCounter(conn, 'Pcn');
            await conn.commit();

            return handleSuccessResponse(res, 'Price change successful');
        }

        throw new CustomError('Something went wrong!', 500);
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}


exports.showData = async (req, res) => {
    try {
        const { q } = req.query;

        let pcnQuery = `
            SELECT 
                p.itemCode, items.itemName, p.basicRate, p.lcr, p.freight, p.landing, pm.pcnNo, pm.remarks,
                DATE_FORMAT(pm.effectiveFromDt, '%d-%m-%Y') AS effectiveFromDt,
                DATE_FORMAT(p.lastEffectivefromDt, '%d-%m-%Y') AS lastEffectivefromDt,
                DATE_FORMAT(pm.created_at, '%d-%m-%Y') AS created_at
            FROM pcn AS p
            INNER JOIN (
                SELECT itemCode, MAX(id) AS latestId
                FROM pcn
                GROUP BY itemCode
            ) AS latestPcn ON p.itemCode = latestPcn.itemCode AND p.id = latestPcn.latestId
            INNER JOIN pcn_mst pm ON pm.id = p.pcnMstId
            INNER JOIN items ON items.itemCode = p.itemCode
        `;
        let values = [];

        if (q) {
            pcnQuery += ` WHERE p.itemCode LIKE ?`;
            values.push(`%${q}%`)
        }
        const [pcnRows] = await connection.execute(pcnQuery, values);
        const finalResult = pcnRows.map((item, index) => ({ id: index + 1, ...item }));

        return handleSuccessResponse(res, 'PCN Item list', finalResult)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

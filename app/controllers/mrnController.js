const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require("../config/dbSql");
const { docNoReset, generateDocNo, updateDocCounter } = require("../utility/docNo");
const { getUser, fetchOpQty } = require("../utility/utilityFunction");
const ExcelJS = require('exceljs');
const XLSX = require("xlsx");

exports.uniqueId = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { type: customValue } = req.body;

        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'Materialreturnnote', customValue });

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
        const { q } = req.query;

        let fetch = `SELECT id, type, mrnNo FROM mrn`;
        const values = [];

        if (q) {
            fetch += ` WHERE mrnNo LIKE ?`;
            values.push(`%${q}%`);
        }
        fetch += ` ORDER BY CASE WHEN mrnNo REGEXP '[^a-zA-Z0-9]' THEN 1 ELSE 0 END LIMIT 20`;

        const [rows] = await connection.execute(fetch, values);

        return handleSuccessResponse(res, 'MRN details', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { mrn, items } = req.body;
        const { username } = req.headers;

        if (!items || items.length === 0) {
            throw new CustomError('No items to insert!', 400);
        }

        const { type, digit, mrnNo, date, totalQty } = mrn;

        const storeQuery = `
            INSERT INTO mrn (type, digit, mrnNo, date, totalQty, createdBy)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const [rows] = await conn.execute(storeQuery, [type, digit, mrnNo, date, totalQty, username]);

        if (rows.affectedRows > 0) {
            const mrnId = rows.insertId;
            const userName = await getUser(req);  // Assuming this returns a string like a username

            await Promise.all(items.map(async (item) => {
                const { itemId, returnQty, lot, remarks } = item;

                if (itemId && returnQty && returnQty > 0) {
                    const openQty = await fetchOpQty(itemId);

                    await conn.execute(`
                        INSERT INTO mrn_details (mrnId, itemId, returnQty, lot, remarks)
                        VALUES (?, ?, ?, ?, ?)
                    `, [mrnId, itemId, returnQty, lot || '', remarks || '']);

                    await conn.execute(`
                        INSERT INTO store 
                        (itemId, docNo, grnNo, docType, inwardQty, issueQoh, opQty, addedBy)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [itemId, mrnNo, mrnNo, 'Mrn', returnQty, returnQty, openQty, userName]);
                }
            }));

            await conn.commit();
            await updateDocCounter(conn, 'Materialreturnnote', { docNo: mrnNo, type });
            return handleSuccessResponse(res, 'Data added successfully');
        }

        throw new CustomError('Data insert failed!', 400);
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};




exports.show = async (req, res) => {
    try {
        const [rows] = await connection.execute(`
            SELECT mrn.*,  DATE_FORMAT(date, '%d-%m-%Y') AS date FROM  mrn `, []
        );

        return handleSuccessResponse(res, 'Mrn lists', rows);
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}

exports.viewMrn = async (req, res) => {
    try {
        const { type, id, category } = req.query;

        let mainQuery = `
            SELECT id, type, digit, mrnNo, totalQty, DATE_FORMAT(date, '%d-%m-%Y') AS date, createdBy
            FROM mrn 
        `;
        let params = [];

        switch (type) {
            case 'first':
                mainQuery += ` WHERE type = ? ORDER BY id ASC LIMIT 1`;
                params = [category];
                break;
            case 'last':
                mainQuery += ` WHERE type = ? ORDER BY id DESC LIMIT 1`;
                params = [category];
                break;
            case 'forward':
                mainQuery += ` WHERE type = ? AND id > ? ORDER BY id ASC LIMIT 1`;
                params = [category, id];
                break;
            case 'reverse':
                mainQuery += ` WHERE type = ? AND id < ? ORDER BY id DESC LIMIT 1`;
                params = [category, id];
                break;
            case 'view':
                mainQuery += ` WHERE type = ? AND id = ?`;
                params = [category, id];
                break;
            default:
                return res.status(400).json({ success: false, message: 'Invalid type parameter' });
        }

        const [rows] = await connection.execute(mainQuery, params);

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'No MRN record found' });
        }

        const [mrnItems] = await connection.execute(`
            SELECT 
                mdtl.id, ROW_NUMBER() OVER (ORDER BY mdtl.id) AS mdtlNo, mdtl.itemId,
                mdtl.returnQty, mdtl.lot, mdtl.remarks, u.code As uom,
                i.itemCode, i.itemName, loc.name AS location
            FROM mrn_details mdtl
            INNER JOIN items AS i ON i.id = mdtl.itemId
            LEFT JOIN item_main_loc AS loc ON loc.id = i.mainLocation
            LEFT JOIN mst_uom AS u ON u.id = i.uom

            WHERE mdtl.mrnId = ?
        `, [rows[0].id]);

        return res.status(200).json({
            success: true,
            mrn: rows[0],
            mrnItems
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



exports.mrnItem = async (req, res) => {
    try {
        const id = req.params.id;

        const [mrn] = await connection.execute(`SELECT mrn.*, DATE_FORMAT(date, '%d-%m-%Y') AS date
            FROM mrn 
            WHERE id = ?`,
            [id]
        );

        const [items] = await connection.execute(`SELECT
            mrnD.*, uom.name as uom, items.itemCode, items.itemName, loc.name AS location
            FROM mrn_details mrnD
                INNER JOIN items ON items.id = mrnD.itemId
                LEFT JOIN mst_uom AS uom ON uom.id = items.uom
                LEFT JOIN item_main_loc AS loc ON loc.id = items.mainLocation
            WHERE mrnId = ?
            `, [mrn[0].id]
        );

        items.forEach((element, index) => {
            element.sNo = index + 1;
        });

        return res.status(200).json({
            success: true,
            message: 'MRN lists',
            mrn: mrn[0],
            itemsList: items
        })
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}


exports.update = async (req, res) => {
    const conn = await connection.getConnection();  // Obtain a connection from the pool
    await conn.beginTransaction();  // Begin transaction

    try {

        const mrnId = req.params.id;

        const { mrn, items } = req.body;  // Extract `mrn` and `items` from the request body
        const { username } = req.headers;  // Get the username from headers

        // Ensure there are items to insert into `mrn_details`
        if (!items || items.length === 0) {
            throw new CustomError('No items to update!', 400);
        }

        // Destructure the mrn object
        const { date, totalQty } = mrn;

        // Update the `mrn` table with new values
        const updateMrn = `
            UPDATE mrn
            SET  date = ?, totalQty = ?, updatedBy = ?
            WHERE id = ?
        `;
        const updateValues = [date, totalQty, username, mrnId];
        const [updatedRows] = await conn.execute(updateMrn, updateValues);

        if (updatedRows.affectedRows === 0) {
            throw new CustomError('MRN update failed!', 400);
        }

        // Update or insert items into `mrn_details` table
        await Promise.all(items.map(async (item) => {
            const { itemId, returnQty, lot, remarks } = item;

            // Check if the item exists in `mrn_details`
            const [existingItem] = await conn.execute(`
                SELECT id FROM mrn_details WHERE mrnId = ? AND itemId = ? `, [mrnId, itemId]);

            if (existingItem.length > 0) {
                // Update the existing item
                await conn.execute(`
                    UPDATE mrn_details
                    SET returnQty = ?, lot = ?, remarks = ?
                    WHERE mrnId = ? AND itemId = ? `,
                    [returnQty || 0, lot, remarks, mrnId, itemId]);

            } else {
                // Insert the new item
                await conn.execute(`
                    INSERT INTO mrn_details (mrnId, itemId, returnQty, lot, remarks)
                    VALUES (?, ?, ?, ?, ?)`,
                    [mrnId, itemId, returnQty || 0, lot, remarks]);
            }
        }));

        await conn.commit();  // Commit transaction

        return handleSuccessResponse(res, 'Data updated successfully');
    } catch (err) {
        await conn.rollback();  // Rollback transaction on error
        return handleErrorResponse(res, err);
    } finally {
        conn.release();  // Release the connection back to the pool
    }
};



exports.deleteMrn = async (req, res) => {
    try {
        const id = req.params.id;

        await connection.execute(`DELETE FROM mrn WHERE id = ?`, [id]);
        await docNoReset(connection, req, { docType: 'Materialreturnnote', table: 'mrn', col: 'digit' });

        return handleSuccessResponse(res, 'Deleted successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}



exports.getMrnDetails = async (req, res) => {
    try {
        const { fromDate, toDate, items } = req.body;

        let query = `
     SELECT
        mrn.id,
        mrn.type,
        mrn.digit,
        mrn.mrnNo,
        DATE_FORMAT(mrn.date, '%d-%m-%Y') AS mrndate,
        mrn.totalQty,
        mrn.totalValue,
        mrn.createdBy,
        mrn.updatedBy,
        mrn.isClosed,
        md.itemId,
        md.returnQty,
        md.lot,
        md.remarks,
        md.isClosed,
        i.itemCode,
        i.itemName,
        i.uom,
        i.mainLocation,
        iml.name,
        u.code AS uomCode
      FROM mrn
      JOIN mrn_details md ON mrn.id = md.mrnId
      JOIN items i ON md.itemId = i.id
      JOIN mst_uom u ON i.uom = u.id
      JOIN item_main_loc iml ON i.mainLocation = iml.id
      WHERE mrn.date BETWEEN ? AND ?
    `;

        const params = [fromDate, toDate];

        if (items && Array.isArray(items) && items.length > 0) {
            const placeholders = items.map(() => '?').join(',');
            query += ` AND md.itemId IN (${placeholders})`;
            params.push(...items);
        }

        const [rows] = await connection.query(query, params);

        return res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching MRN details:', error);
        return res.status(500).json({ success: false, message: 'Server Error' });
    }
};



///download excel 
exports.downloadItemExcel = async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Items");

        // Only header columns — NO DATA
        worksheet.columns = [
            { header: "ItemCode", key: "ItemCode", width: 20 },
            { header: "Qty", key: "Qty", width: 10 }
        ];

        // Send file
        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            "attachment; filename=item_template.xlsx"
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: "Failed to generate Excel"
        });
    }
};



exports.importItems = async (req, res) => {
    try {
        if (!req.body.file) {
            return res.status(400).json({
                success: false,
                message: "Base64 Excel file is required"
            });
        }

        const base64File = req.body.file.replace(/^data:.*;base64,/, "");
        const excelBuffer = Buffer.from(base64File, "base64");

        const workbook = XLSX.read(excelBuffer, { type: "buffer" });
        const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const matchedItems = [];
        const notMatched = [];

        for (const row of sheet) {
            let itemCode =
                row.itemCode ||
                row.ItemCode ||
                row.ITEMCODE ||
                row["Item Code"] ||
                row["ITEM CODE"] ||
                row["item code"] ||
                null;

            let qty =
                row.qty ||
                row.Qty ||
                row.QTY ||
                row.Quantity ||
                row["Quantity"] ||
                0;

            if (!itemCode) continue;

            itemCode = itemCode.toString().trim();

            const [itemRows] = await connection.execute(
                "SELECT id, uom, itemName, mainLocation FROM items WHERE itemCode = ?",
                [itemCode]
            );

            if (itemRows.length === 0) {
                notMatched.push(itemCode);
                continue;
            }

            const id = itemRows[0].id;
            const uomId = itemRows[0].uom;
            const itemName = itemRows[0].itemName;
            const mainLocation = itemRows[0].mainLocation;

            // Get UOM
            const [uomRows] = await connection.execute(
                "SELECT code FROM mst_uom WHERE id = ?",
                [uomId]
            );

            // Get location name
            const [locRows] = await connection.execute(
                "SELECT name FROM item_main_loc WHERE id = ?",
                [mainLocation]
            );

            matchedItems.push({
                id,
                itemId: id,
                itemCode,
                itemName,
                returnQty: qty,
                uom: uomRows.length ? uomRows[0].code : null,
                location: locRows.length ? locRows[0].name : null
            });
        }

        return res.json({
            success: true,
            totalImported: sheet.length,
            matchedCount: matchedItems.length,
            notMatchedCount: notMatched.length,
            nonLinkedItems: notMatched.length
                ? `NonLinked Items: ${notMatched.join(",")}`
                : "NonLinked Items: None",
            matchedItems
        });

    } catch (err) {
        console.error("Import Error:", err);
        return res.status(500).json({
            success: false,
            message: "Import failed",
            error: err.message
        });
    }
};





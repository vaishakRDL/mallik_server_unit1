const { connection, CustomError, handleErrorResponse } = require("../../config/dbSql");
const excel = require("exceljs");
const { decodeBase64 } = require("../../utility/utilityFunction");

exports.mstImport = async (req, res) => {
    try {
        if (!req.body.file) {
            return res
                .status(400)
                .json({ success: false, message: "No file uploaded" });
        }

        const base64URL =
            "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,";
        const base64Data = req.body.file.replace(base64URL, "");

        const buffer = Buffer.from(base64Data, "base64");

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const items = [];

        worksheet.eachRow((row, rowNumber) => {
            items.push(row.getCell(1).value);
        });

        //console.log("len", items.length)

        // Array to store itemId and itemCode pairs
        const itemsToInsert = [];

        for (const itemCode of items) {
            const [itemRows] = await connection.execute(
                `SELECT id FROM items WHERE itemCode = ?`,
                [itemCode]
            );

            if (itemRows.length > 0) {
                const itemId = itemRows[0].id;
                // Push itemId and itemCode pair into the array
                itemsToInsert.push([itemId, itemCode]);
            }
        }

        //console.log("itemsToInsert ", itemsToInsert.length)

        // Construct the VALUES clause dynamically
        const placeholders = itemsToInsert.map(() => "(?, ?)").join(", ");
        const values = itemsToInsert.flat();

        // Perform bulk insert
        if (itemsToInsert.length > 0) {
            await connection.execute(
                `INSERT INTO bom_mst (itemId, itemCode) VALUES ${placeholders}`,
                values
            );
        }

        return res
            .status(200)
            .json({ success: true, message: "Successfully Imported", data: itemsToInsert });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};


exports.bomPart = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        if (!req.body.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const base64URL = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,";
        const base64Data = req.body.file.replace(base64URL, "");

        const buffer = Buffer.from(base64Data, "base64");

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const items = [];

        const [itemsRow] = await conn.execute(`SELECT id as itemId, itemCode FROM items`);
        const [bomRow] = await conn.execute(`SELECT id as bomMstId, itemCode FROM bom_mst`);

        const itemMap = new Map(itemsRow.map(item => [item.itemCode, item.itemId]));
        const bomMap = new Map(bomRow.map(bom => [bom.itemCode, bom.bomMstId]));

        worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header row if there is one

            const bomId = bomMap.get(row.getCell(1).text);
            const itemId = itemMap.get(row.getCell(2).text);

            if (bomId && itemId) {
                items.push({
                    bomId,
                    itemId,
                    qty: row.getCell(3).text,
                    jcPart: row.getCell(4).text
                });
            } else {
                //console.log(bomId, itemId + ' rowNumber: ' + rowNumber)
                throw new Error(`Item not found: ${row.getCell(1).text}`);
            }
        });

        const insertQuery = `INSERT INTO bom (bomMstId, itemId, Qty, jcPart) VALUES ?`;
        const values = items.map(item => [item.bomId, item.itemId, item.qty, item.jcPart]);

        // Split the insertion if values array is too large
        const chunkSize = 5000; // Adjust based on your DB's packet size limit
        for (let i = 0; i < values.length; i += chunkSize) {
            const chunk = values.slice(i, i + chunkSize);
            await conn.query(insertQuery, [chunk]);
        }

        await conn.commit();
        return res.json({ success: true, message: "File processed successfully", items });
    } catch (err) {
        //console.log(err)
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.bomMstUpdate = async (req, res) => {
    try {
        const [bomRows] = await connection.execute(`
            SELECT bom_mst.id, bom_mst.itemId, items.category 
            FROM bom_mst 
            INNER JOIN items ON items.id = bom_mst.itemId 
            WHERE items.isBom != 'Y'`, []);

        const itemIds = bomRows.map(row => row.itemId);

        //console.log(itemIds);
        //console.log(itemIds.length);

        // Dynamically generate placeholders for the itemIds array
        const placeholders = itemIds.map(() => '?').join(',');

        // Construct SQL query with dynamically generated placeholders
        const query = `UPDATE items SET isBom = 'Y' WHERE id IN (${placeholders})`;

        // Execute the SQL query with itemIds as parameters
        await connection.execute(query, itemIds);

        res.json({ success: true, message: "Items table updated successfully." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}


exports.importFim = async (req, res) => {
    try {
        const buffer = await decodeBase64(req.body.file);
        const workbook = new excel.Workbook();

        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1); // Assuming data is in the first worksheet

        const fims = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) { // Skip header row
                fims.push(
                    [row.getCell(1).value,
                    row.getCell(2).value,
                    row.getCell(3).value,
                    row.getCell(4).value]
                );
            }
        });

        for (const fim of fims) {
            // Check if the record already exists based on the unique identifier
            const [existingRows] = await connection.execute(
                'SELECT * FROM item_fim_id_old WHERE name = ?',
                [fim[0]]
            );

            if (existingRows.length > 0) {
                // Update existing record
                await connection.execute(
                    'UPDATE item_fim_id_old SET description = ?, inActive = ?, sob = ? WHERE name = ?',
                    [fim[1], fim[2], fim[3], fim[0]]
                );
            } else {
                // Insert new record
                await connection.execute(
                    'INSERT INTO item_fim_id_old (name, description, inActive, sob) VALUES (?, ?, ?, ?)',
                    fim
                );
            }
        }
        res.send("success");
    } catch (error) {
        res.send(error.message)
    }
}

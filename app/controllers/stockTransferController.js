const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');

//Auto generate number
exports.uniqueId = async (req, res) => {
    try {
        const [fRows] = await connection.execute('SELECT digit FROM stock_transfer ORDER BY id DESC', []);
        let lastFourDigits = '00001'; // Default fileId if no records exist
        let currentYear = new Date().getFullYear().toString().substring(2); // Get the last two uniqueDigit of the current year
        let str = `${currentYear}/00001`;

        if (fRows.length > 0) {
            const lastFileId = fRows[0].digit;
            const numericPart = (lastFileId && lastFileId.match(/\d+/)) ? parseInt(lastFileId.match(/\d+/)[0]) : 0;
            // Increment the numeric part
            lastFourDigits = (numericPart + 1).toString().padStart(5, '0'); // Pad the incremented number to ensure it's always 4 digits long
            str = `${currentYear}/${lastFourDigits}`;
        }

        return res.status(200).json({
            digit: lastFourDigits,
            stNo: str
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
}



exports.store = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        const data = req.body;
        const user = req.headers.username;

        const commonData = data.mainData;
        const variableData = data.items;

        /* ===========================
           INSERT INTO stock_transfer
        ============================ */
        const insertStockTransferSql = `
            INSERT INTO stock_transfer (digit, stNo, date, addedBy)
            VALUES (?, ?, ?, ?)
        `;

        const [stockTransferResult] = await conn.execute(
            insertStockTransferSql,
            [
                commonData.digit, commonData.stNo, commonData.date, user
            ]
        );

        const stockTransferId = stockTransferResult.insertId;

        /* ===========================
           INSERT INTO stock_transfer_items
           + UPDATE items subLocation
        ============================ */
        const insertStockTransferItemSql = `
            INSERT INTO stock_transfer_items
            (itemId, fromLoc, stQty, toLoc, remarks, stock_transfer_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        const updateItemLocationSql = `
            UPDATE items
            SET subLocation = ?
            WHERE id = ?
        `;

        for (const item of variableData) {

            // Insert item row
            await conn.execute(
                insertStockTransferItemSql,
                [
                    item.itemId, item.fromLoc, item.stQty, item.toLoc, item.remarks, stockTransferId
                ]
            );

            // Update item location
            await conn.execute(
                updateItemLocationSql,
                [
                    item.toLocId,  item.itemId
                ]
            );
        }

        await conn.commit();

        return res.status(200).json({
            success: true,
            message: "Data Added Successfully"
        });

    } catch (err) {
        await conn.rollback();
        return res.status(400).json({
            success: false,
            message: err.message || "An error occurred"
        });
    } finally {
        conn.release();
    }
};

//Get ALL List
exports.search = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;

        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT st.id, st.digit, st.stNo
                FROM stock_transfer st
        `;

        const values = [];

        // If there's a search query, add a condition to filter i based on the search query
        if (q) {
            fetch += ` WHERE (st.digit LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match any occurrence of the substring within the item code
        }

        fetch += ` LIMIT 30`; // Add LIMIT clause to retrieve only the first 10 records

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "data", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}


// View by ID
exports.showById = async (req, res) => {
    try {
        const invoiceId = req.params.id;

        // MAIN QUERY
        const mainQuery = `
            SELECT 
                st.*,
                DATE_FORMAT(st.date, '%d-%m-%Y') AS date
            FROM stock_transfer st
            WHERE st.id = ?
        `;

        const [mainRows] = await connection.execute(mainQuery, [invoiceId]);

        if (mainRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found"
            });
        }

        const invoiceData = mainRows[0];

        // DETAIL QUERY
        const detailedQuery = `
            SELECT 
                sti.*,
                sti.stQty AS totStk,
                sti.fromLoc AS location,
                i.itemCode AS label,
                i.itemName,
                uomTab.name AS uom
            FROM stock_transfer_items sti
                INNER JOIN items i ON i.id = sti.itemId
                INNER JOIN mst_uom uomTab ON i.uom = uomTab.id
            WHERE sti.stock_transfer_id = ?
        `;

        const [itemsData] = await connection.execute(detailedQuery, [invoiceData.id]);

        return res.status(200).json({
            success: true,
            mainData: invoiceData,
            items: itemsData
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


// Showdata APIs for credit_note_mst & credit_note_dtl
exports.getItems = async (req, res) => {
    try {
        const { type, id } = req.query;

        // Query for purchase_order
        let main = `
            SELECT st.*, 
                DATE_FORMAT(st.date, '%d-%m-%Y') AS date
            FROM stock_transfer st
        `;

        let params = [];

        // Query for purchase_order_item
        let dtl = `
            SELECT 
              sti.*, sti.stQty As totStk, sti.fromLoc AS location,
              i.itemCode As label, i.itemName, uomTab.name as uom 
            FROM stock_transfer_items sti 
                INNER JOIN items i ON i.id = sti.itemId 
                INNER JOIN mst_uom as uomTab ON i.uom = uomTab.id
 
  
        `;

        let params2 = [];

        // Modify queries based on type
        switch (type) {
            case 'first':
                main += ` ORDER BY st.id ASC LIMIT 1`;
                break;
            case 'last':
                main += ` ORDER BY st.id DESC LIMIT 1`;
                break;
            case 'forward':
                main += ` WHERE st.id > ? ORDER BY st.id ASC LIMIT 1`;
                params = [id];
                break;
            case 'reverse':
                main += ` WHERE st.id < ? ORDER BY st.id DESC LIMIT 1`;
                params = [id];
                break;
        }

        // Execute the first query
        const [rows] = await connection.execute(main, params);

        // If no matching purchase_order is found, return an empty result
        if (rows.length === 0) {
            return res.status(200).json({
                success: true,
                mainData: {}, // Return as empty object if no data
                items: [],
            });
        }

        // Extract the matching id from the first query
        const matchingId = rows[0].id;

        // Add a condition to the second query to filter by the matching id
        dtl += ` WHERE sti.stock_transfer_id = ?`;
        params2 = [matchingId];

        // Execute the second query
        const [rows2] = await connection.execute(dtl, params2);

        // Return the filtered results
        return res.status(200).json({
            success: true,
            mainData: rows[0], // Return only the first object, no array
            items: rows2,
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


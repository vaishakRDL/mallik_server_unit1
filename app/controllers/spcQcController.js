const { connection, CustomError } = require('../config/dbSql');



exports.searchItems = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;

        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT 
            items.id, items.itemCode as label
             FROM items 
            INNER JOIN  qc_spc spc ON items.id = spc.item
            WHERE items.dflag = 0
            GROUP BY  items.id
        `;

        const values = [];

        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` AND (items.itemCode LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
        }

      
        fetch += ` ORDER BY CASE WHEN items.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, items.itemCode LIMIT 100`;

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "Items", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}




exports.searchQp = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;

        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT 
            qc_field.id, qc_field.label
              FROM qc_field 
            INNER JOIN  qlty_template qt ON qc_field.tempId = qt.id
            INNER JOIN  qc_spc spc ON qc_field.id = spc.qcFieldId
            GROUP BY  qc_field.label

        `;

        const values = [];

        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` AND (qc_field.label LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
        }

      
        // fetch += ` ORDER BY CASE WHEN items.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, items.itemCode LIMIT 100`;

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "Items", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}




exports.showData = async (req, res) => {
    try {
        const qlty = req.body;

        // Ensure dates are in the correct format and include time
        const fromDate = qlty.from;
        const toDate = qlty.to;
        const item = qlty.itemId;
        const process = qlty.processId;
        const qp = qlty.parametrId;

        if (!fromDate && !toDate) {
            return res.status(400).json({ success: false, message: "Machine can't be empty!" });
        }

        // Base query
        let query = `
            SELECT 
                itm.itemCode, itm.npdFile, 
                DATE_FORMAT(spc.created_at, '%d-%m-%Y') AS date, 
                pm.name As process, qInspec.inspectionType, qc_field.label
            FROM qc_spc spc
                LEFT JOIN items itm ON spc.item = itm.id
                LEFT JOIN mst_pm pm ON spc.process = pm.id
                LEFT JOIN qc_field ON spc.qcFieldId = qc_field.id
                LEFT JOIN mst_qlty_inspections qInspec  ON spc.inspectionId = qInspec.id
            WHERE DATE(spc.created_at) BETWEEN ? AND ?`;

        // Collect conditions
        const queryParams = [fromDate,toDate];
        const conditions = [];


        if (item) {
            conditions.push('itm.id = ?');
            queryParams.push(item);
        }

        if (process) {
            conditions.push('pm.id = ?');
            queryParams.push(process);
        }

        if (qp) {
            conditions.push('qc_field.id = ?');
            queryParams.push(qp);
        }

      
        if (conditions.length) {
            query += ' AND ' + conditions.join(' AND ');
        }

        // Execute the query
        const [rows] = await connection.execute(query, queryParams);

        // Add serial numbers
        rows.forEach((element, index) => {
            element.sNo = index + 1;
            element.id = index + 1;
        });

        // Return response
        return res.status(200).json({
            success: true,
            message: "list",
            data: rows
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}


const excel = require('exceljs');
const { connection, CustomError } = require('../../config/dbSql');



exports.scrapExport = async (req, res) => {
    try {

        const {id, from, to} = req.query;

        // Construct the SQL query
        let sqlQuery = ` 

            SELECT  
                ROUND(itm.scrapWeight * mrp.Qty, 2) AS totQty,  
                itm.itemCode AS item, itm.netWeight AS totalWt, itm.material, itm.rmItemCode
            FROM  
                mrp   
            INNER JOIN 
                items AS itm ON mrp.itemId = itm.id
            WHERE 
                mrp.orderPlnId = ? 
                AND itm.dflag = 0
                AND itm.material IS NOT NULL 
                AND itm.material <> ''
        `;

        const params = [id];

        if (from && to) {
            sqlQuery += ` AND mrp.created_at >= ? AND mrp.created_at <= ?`;
            params.push(from, to);
 
        }   

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, params);

        rows.forEach((row, index) => {
            row.slNo = index + 1;
        });

        
       
        const customHeaders = [
            "Sl No",
            "Material",
            "Total Quantity",
            "Total Wt",
            "RM Item"
        ];

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Scrap Info Report');

        const headerRow = worksheet.addRow(customHeaders);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };

        const columnSize = 17;
        worksheet.columns.forEach((column) => {
            column.width = columnSize;
        });

        rows.forEach(row => {
            const customValues = [
                row.slNo,
                row.material,
                row.totQty,
                row.totalWt,
                row.rmItemCode,

            ];
            worksheet.addRow(customValues);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Supplier_Items.xlsx');

        workbook.xlsx.write(res)
            .then(() => {
                res.status(200).end();
            })
            .catch(error => {
                console.error('Error generating Excel file:', error);
                res.status(500).json({ success: false, message: 'Error generating Excel file' });
            });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};



exports.sheetExport = async (req, res) => {
    try {

        const {id, from, to } = req.query;

        // Construct the SQL query
        let sqlQuery = ` 

            SELECT  
                ROUND(itm.netWeight * mrp.Qty, 2) AS totalWt,  
                itm.rmThickness, 
                itm.rmWidth, 
                itm.rmLength, 
                itm.material, 
                itm.rmItemCode
            FROM  
                mrp   
            INNER JOIN 
                items AS itm ON mrp.itemId = itm.id
            WHERE 
                mrp.orderPlnId = ? 
                AND itm.dflag = 0
                AND itm.material IS NOT NULL 
                AND itm.material <> ''
            `;

        const params = [id];

        if (from && to) {
            sqlQuery += ` AND mrp.created_at >= ? AND mrp.created_at <= ?`;
            params.push(from, to);
 
        }   


        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, params);

        rows.forEach((row, index) => {
            row.slNo = index + 1;
        });

        
       
        const customHeaders = [
            "Sl No",
            "T",
            "W",
            "L",
            "Total Wt",
            "Material",
            "RM Item"
        ];

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Scrap Info Report');

        const headerRow = worksheet.addRow(customHeaders);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };

        const columnSize = 17;
        worksheet.columns.forEach((column) => {
            column.width = columnSize;
        });

        rows.forEach(row => {
            const customValues = [
                row.slNo,
                row.rmThickness,
                row.rmWidth,
                row.rmLength,
                row.totalWt,
                row.material,
                row.rmItemCode,

            ];
            worksheet.addRow(customValues);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Supplier_Items.xlsx');

        workbook.xlsx.write(res)
            .then(() => {
                res.status(200).end();
            })
            .catch(error => {
                console.error('Error generating Excel file:', error);
                res.status(500).json({ success: false, message: 'Error generating Excel file' });
            });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};

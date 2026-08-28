const { connection, CustomError } = require('../config/dbSql');
const excel = require('exceljs');


exports.sheetShow = async (req, res) => {
    try {

        const id = req.params.id;

        const from = req.body.from;
        const to = req.body.to;


        let query = `

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
            query += ` AND mrp.created_at >= ? AND mrp.created_at <= ?`;
            params.push(from, to);
 
        }   

        const [rows] = await connection.execute(query, params);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;
                element.id = index + 1;

            });

            return res.status(200).json({
                success: true,
                message: "Sheet Info",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}


exports.scrapShow = async (req, res) => {
    try {

        const id = req.params.id;

        const from = req.body.from;
        const to = req.body.to;


        let query = `

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
            query += ` AND mrp.created_at >= ? AND mrp.created_at <= ?`;
            params.push(from, to);
 
        }   

        const [rows] = await connection.execute(query, params);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;
                element.id = index + 1;

            });

            return res.status(200).json({
                success: true,
                message: "Scrap Info",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require('../config/dbSql');
const { paginateQuery, totRowCount } = require("../utility/pagination");




exports.searchCust = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { q } = req.query;

        let fetch = `
            SELECT 
                cName,  id,  cId,  cCode 
            FROM customer
        `;

        const values = [];

        if (q) {
            fetch += ` WHERE cCode LIKE ?`;
            values.push(`${q}%`);
        }

        fetch += ` LIMIT 20`;

        const [results] = await conn.query(fetch, values);

        return handleSuccessResponse(res, "Customer List", results);

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.searchItem = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;

        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT i.id, i.id AS itemId, i.itemCode, i.itemName, i.stdRate As rate,
               uom.code as uom, uom.id as uomId, hsnCode.name as hsnCode,  ig.id as itemGroup, ig.name as itemGroupName, 
               il.id as underLedger, il.name as underLedgerName, null AS customerDesc
            FROM items i
            INNER JOIN mst_uom as uom ON uom.id = i.uom
            LEFT JOIN item_hsn_code hsnCode  ON hsnCode.id = i.hsnCode
            LEFT JOIN mst_item_group ig  ON ig.id = i.itemGroup
            LEFT JOIN item_under_ledger il  ON il.id = i.underLedger

            WHERE i.dflag = 0
        `;

        const values = [];

        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` AND (i.itemCode LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
        }

        fetch += ` ORDER BY CASE WHEN i.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, i.itemCode LIMIT 100`;

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "Items", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}



exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const { items: detailyArray, customerId } = req.body;

        if (!Array.isArray(detailyArray)) throw new CustomError('Invalid request format!', 400);

        for (const item of detailyArray) {
            const { itemId, rate, uom, hsnCode = null, customerDesc, itemGroup, underLedger } = item;

            const [existingRows] = await conn.query(
                `SELECT rate as oldRate
                FROM cust_vs_item WHERE customerId = ? AND itemId = ?`,
                [customerId, itemId]
            );

            if (existingRows.length > 0) {

                const { oldRate } = existingRows[0];

                // console.log(existingRows)
                let lessRate = 0;

                if (oldRate !== rate) {
                    if (rate < oldRate) {
                        // console.log("rate descrease")
                        lessRate = 1;

                        // Insert history only, skip updating cust_vs_item
                        await conn.execute(
                            `INSERT INTO cust_vs_item_history (customerId, itemId, old_rate, new_rate, lessRate) 
                            VALUES (?, ?, ?, ?, ?)`,
                            [customerId, itemId, oldRate, rate, lessRate]
                        );

                        // Skip update
                        continue;
                    }

                   

                    await conn.execute(
                        `INSERT INTO cust_vs_item_history (customerId, itemId, old_rate, new_rate, lessRate) 
                        VALUES (?, ?, ?, ?, ?)`,
                        [customerId, itemId, oldRate, rate, lessRate]  // lessRate remains 0
                    );
                }

                if (rate > oldRate || oldRate == rate ) {


                    // Proceed with normal update if rate increased
                    await conn.query(
                        `UPDATE cust_vs_item 
                        SET rate = ?, uom = ?, hsnCode = ?, customerDesc = ?, itemGroup = ?, underLedger = ?
                        WHERE customerId = ? AND itemId = ?`,
                        [rate, uom, hsnCode,  customerDesc, itemGroup, underLedger, customerId, itemId]
                    );
                }


            } else {
                // Insert new record
                await conn.query(
                    `INSERT INTO cust_vs_item (customerId, itemId, rate, uom, hsnCode, customerDesc, itemGroup, underLedger) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [customerId, item.itemId, item.rate, item.uom, item.hsnCode, item.customerDesc, item.itemGroup, item.underLedger ]
                );
            }
        }
        await conn.commit();
        return handleSuccessResponse(res, 'Data Stored Successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.showData = async (req, res) => {
    try {
        const id = req.params.id;
        const q = req.query.q;
        let rows;
        let totRows;
        let values = [id];

        let fetchQuery = `
           SELECT  
                cVsI.id, cVsI.rate, cVsI.customerDesc, cVsI.customerId, 
                cVsI.itemId, cVsI.hsnCode, cVsI.itemGroup, cVsI.underLedger,
                c.cCode, c.cName, itm.itemCode, itm.itemName, 
                cVsI.uom 
            FROM cust_vs_item cVsI
            INNER JOIN customer c ON cVsI.customerId = c.id
            INNER JOIN items itm ON cVsI.itemId = itm.id
            WHERE cVsI.customerId = ?
        `;

        totRows = await totRowCount('cust_vs_item');

        if (q) {
           

            fetchQuery += ` AND cVsI.itemId = ?`;
            values.push(q);
            [rows] = await connection.execute(fetchQuery, values);

        } else {
            // Pagination
            const paginatedQuery = await paginateQuery(fetchQuery, req.query);

            [rows] = await connection.execute(paginatedQuery, values);

        }


        // Add serial numbers
        rows.forEach((element, index) => {
            element.sNo = index + 1;
        });

        return res.status(200).json({
            success: true,
            message: "Cust Vs Item list",
            data: rows,
            currentPage: Number(req.query.page || 0),
            totRows: totRows
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



// Delete Row of cust_vs_item tab (with dependency check)
exports.delete = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { id } = req.params;

        await conn.beginTransaction();

        // 1️⃣ Get PartNo & customer from cust_vs_item
        const [itemRows] = await conn.query(
            `SELECT i.itemCode, cvi.customerId 
             FROM cust_vs_item cvi
             INNER JOIN items i ON i.id = cvi.itemId
             WHERE cvi.id = ?`,
            [id]
        );

        if (itemRows.length === 0) {
            await conn.rollback();
            throw new CustomError("Record not found");

        }

        const { itemCode, customerId } = itemRows[0];

        // 2️⃣ Check in purchase_order_item for PartNo + Customer
        const [poCheck] = await conn.query(
            `SELECT poi.id 
             FROM purchas_order_item poi
             INNER JOIN purchase_order po 
                ON po.id = poi.purchase_order_id
             WHERE po.customer = ? 
               AND poi.PartNo = ?
             LIMIT 1`,
            [customerId, itemCode]
        );

        if (poCheck.length > 0) {
            await conn.rollback();
           
            throw new CustomError("Cannot delete. PartNo is already used in Purchase Order");

        }

        // 3️⃣ Safe to delete
        const [results] = await conn.query(
            `DELETE FROM cust_vs_item WHERE id = ?`,
            [id]
        );

        await conn.commit();
        return handleSuccessResponse(res, "Record deleted successfully", results);

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.rateApproval = async (req, res) => {
    try {

        const { fromDate, toDate } = req.query;


        let query = `
            SELECT cih.id, i.itemCode, i.itemName, c.cCode as customer, ci.customerDesc, cih.old_rate, cih.new_rate, ci.id As custItemId
            FROM cust_vs_item_history cih
            INNER JOIN cust_vs_item ci ON ci.customerId = cih.customerId AND ci.itemId = cih.itemId

            INNER JOIN customer c ON c.id = cih.customerId
            INNER JOIN items i ON i.id = cih.itemId
            WHERE cih.lessRate = 1
       
        `;
        const values = [];

        if (fromDate && toDate) {
            query += ` AND  DATE(cih.created_at) BETWEEN ? AND ?`;
            values.push(fromDate, toDate);
        }

        const [rows] = await connection.execute(query, values);

        return handleSuccessResponse(res, 'Customer vs Item Report', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}





exports.updateApproval = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { data: detailyArray } = req.body;

        if (!Array.isArray(detailyArray)) {
            throw new CustomError('Invalid request format!', 400);
        }

        for (const item of detailyArray) {
            const { id, new_rate, custItemId } = item;

            await conn.query(
                `UPDATE cust_vs_item 
                 SET rate = ? 
                 WHERE id = ?`,
                [new_rate, custItemId]
            );

            
            await conn.query(
                `UPDATE cust_vs_item_history 
                 SET lessRate = 0
                 WHERE id = ?`,
                [id]
            );
        }

        await conn.commit();
        return handleSuccessResponse(res, 'Data Updated Successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};





exports.rejected = async (req, res) => {
    try {

        const { fromDate, toDate } = req.query;


        let query = `
            SELECT cih.id, i.itemCode, i.itemName, c.cCode as customer, ci.customerDesc, cih.old_rate, cih.new_rate, ci.id As custItemId
            FROM cust_vs_item_history cih
            INNER JOIN cust_vs_item ci ON ci.customerId = cih.customerId AND ci.itemId = cih.itemId

            INNER JOIN customer c ON c.id = cih.customerId
            INNER JOIN items i ON i.id = cih.itemId
            WHERE cih.lessRate = 2
       
        `;
        const values = [];

        if (fromDate && toDate) {
            query += ` AND  DATE(cih.created_at) BETWEEN ? AND ?`;
            values.push(fromDate, toDate);
        }

        const [rows] = await connection.execute(query, values);

        return handleSuccessResponse(res, 'Customer vs Item Rate Rejected Report', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}



exports.rejecteApproval = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { data: detailyArray } = req.body;

        if (!Array.isArray(detailyArray)) {
            throw new CustomError('Invalid request format!', 400);
        }

        for (const item of detailyArray) {
            const { id, new_rate, custItemId } = item;

         
            await conn.query(
                `UPDATE cust_vs_item_history 
                 SET lessRate = 2
                 WHERE id = ?`,
                [id]
            );
        }

        await conn.commit();
        return handleSuccessResponse(res, 'Data Updated Successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};



exports.custVsItemReport = async (req, res) => {
    try {
        const { fromDate, toDate, customerId } = req.query;

        if (!customerId) throw new CustomError('Customer ID is required!', 400);

        let query = `
            SELECT cih.id, i.itemCode, i.itemName, c.cCode as customer, ci.customerDesc, cih.old_rate, cih.new_rate, ci.uom, hsn.name as hsnCode
              FROM cust_vs_item_history cih
            INNER JOIN customer c ON c.id = cih.customerId
            INNER JOIN items i ON i.id = cih.itemId
            LEFT JOIN item_hsn_code AS hsn ON hsn.id = i.hsnCode
            LEFT JOIN cust_vs_item ci ON ci.customerId = cih.customerId AND ci.itemId = cih.itemId
            WHERE cih.customerId = ? AND  cih.lessRate = 0
        `;
        const values = [customerId];

        if (fromDate && toDate) {
            query += ` AND Date(cih.created_at) BETWEEN ? AND ?`;
            values.push(fromDate, toDate);
        }

        const [rows] = await connection.execute(query, values);

        return handleSuccessResponse(res, 'Customer vs Item Report', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


const { connection, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');



exports.showData = async (req, res) => {
    try {
        const { category, type, fromDate, toDate, customer, item } = req.body;
        let rows = [];

        // Base conditions array
        let conditions = [];
        let params = [];

        // Category condition
        if (category === 1) {
            conditions.push(`poi.isShortCls = 1`);
        } else if (category === 0) {
            conditions.push(`poi.isShortCls = 0 AND poi.pendQty > 0`);
        } else if (category === 2) {
            conditions.push(`(poi.isShortCls IN (0,1) OR poi.pendQty > 0)`);
        }

        // Add customer filter
        if (Array.isArray(customer) && customer.length > 0) {
            conditions.push(`c.id IN (${customer.map(() => '?').join(', ')})`);
            params.push(...customer);
        }

        // Add item filter
        if (Array.isArray(item) && item.length > 0) {
            conditions.push(`i.id IN (${item.map(() => '?').join(', ')})`);
            params.push(...item);
        }

        // Date condition will be added later based on type
        let whereClause = conditions.length ? conditions.join(' AND ') : '1=1';

        if (type === "custPo") {
            const query = `
                SELECT
                    poi.id, po.customer, po.sodigit, po.poNo, 'custPo' as type, poi.isShortCls,
                    DATE_FORMAT(po.date, '%d-%m-%Y') AS soDate, DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
                    i.itemCode, i.itemName, poi.UOM as uom, i.totStk, c.cCode, c.cName, itmGrp.name as itemGroup,
                    poi.Qty as soQty, poi.pendQty, poi.cumQty, poi.shortclsBy, poi.shortclsDate, poi.shortclsQty 
                FROM purchas_order_item poi
                INNER JOIN purchase_order po ON po.id = poi.purchase_order_id 
                INNER JOIN customer c ON c.cId = po.customer 
                INNER JOIN items i ON i.itemCode = poi.PartNo  
                INNER JOIN mst_item_group itmGrp ON itmGrp.id = i.itemGroup 
                WHERE ${whereClause} AND DATE(po.date) BETWEEN ? AND ?
            `;
            params.push(fromDate, toDate);
            [rows] = await connection.execute(query, params);

        } else if (type === "custDc") {
            const query = `
                SELECT
                    poi.id, po.cdcNo AS sodigit, DATE_FORMAT(po.date, '%d-%m-%Y') AS soDate, 'custDc' as type,
                    i.itemCode, i.itemName, c.cCode, c.cName, itmGrp.name as itemGroup, poi.isShortCls, poi.shortclsBy,
                    poi.shortclsDate, poi.shortclsQty,  poi.uom, poi.qty as soQty, 0 as pendQty, 0 as cumQty, NULL AS poDate
                FROM customer_dc_parts poi
                INNER JOIN customer_dc po ON po.id = poi.CDC_no 
                INNER JOIN customer c ON c.cId = po.cust 
                INNER JOIN items i ON i.itemCode = poi.partNo  
                INNER JOIN mst_item_group itmGrp ON itmGrp.id = i.itemGroup 
                WHERE ${whereClause} AND DATE(po.date) BETWEEN ? AND ?
            `;
            params.push(fromDate, toDate);
            [rows] = await connection.execute(query, params);
        }


        // Transform rows to display `dflag` as true/false
        const transformedRows = rows.map((row) => ({
            ...row,
            selected: row.isShortCls === 1, // Convert `isShortCls` to true/false
        }));

        return res.status(200).json({
            success: true,
            message: "ShortClosed items list",
            data: transformedRows
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};



exports.save = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { type, items, shortclsBy, shortclsDate } = req.body;

        if (!type || !Array.isArray(items) || items.length === 0) {
            throw new Error('Invalid payload: type and items are required');
        }

        for (const itm of items) {
            if (type === "custPo") {
                await conn.execute(
                    `UPDATE purchas_order_item 
                     SET isShortCls = ?, shortclsBy = ?, shortclsDate = ?, shortclsQty = ? 
                     WHERE id = ?`,
                    [itm.isShortCls ? 1 : 0, shortclsBy, shortclsDate, itm.shortclsQty || 0, itm.id]
                );
            }
        }

        await conn.commit();
        res.status(200).json({ success: true, message: 'Saved successfully' });

    } catch (err) {
        await conn.rollback();
        res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    } finally {
        conn.release();
    }
};

// Updated but not deplyoed or not imlemy in frontend
// exports.save = async (req, res) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();

//     try {
//         const { type, items, shortclsBy, shortclsDate } = req.body;

//         if (!type || !Array.isArray(items) || items.length === 0) {
//             return res.status(200).json({
//                 success: true,
//                 message: "No items to update"
//             });
//         }

//         for (const itm of items) {
//             if (type === "custPo") {

//                 const isShortCls = itm.isShortCls ? 1 : 0;
//                 const shortclsQty = Number(itm.shortclsQty) || 0;

//                 // pendQty logic
//                 const pendQty = isShortCls === 1 ? 0 : shortclsQty;

//                 await conn.execute(
//                     `UPDATE purchas_order_item 
//                      SET 
//                         isShortCls   = ?,
//                         shortclsBy  = ?,
//                         shortclsDate= ?,
//                         shortclsQty = ?,
//                         pendQty     = ?
//                      WHERE id = ?`,
//                     [
//                         isShortCls,
//                         shortclsBy || null,
//                         shortclsDate || null,
//                         shortclsQty,
//                         pendQty,
//                         itm.id
//                     ]
//                 );
//             }
//         }

//         await conn.commit();
//         return handleSuccessResponse(res, 'Data Upadted Successfully');
//     } catch (err) {
//         await conn.rollback();
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// };






// Test Function
exports.shortCls = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const date = new Date();
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const formattedDate = `${year}-${month}-${day}`;

        const updateQuery1 = `
            UPDATE purchas_order_item 
            SET isShortCls = ?, shortclsBy = ?, shortclsDate = ?, shortclsQty = pendQty
            WHERE SchDate < ? AND isShortCls = 0
        `;

        const values = [1, 'Admin', formattedDate, formattedDate];

        // //console.log('formattedDate:', formattedDate);

        await conn.execute(updateQuery1, values);

        await conn.commit();
        res.status(200).json({ success: true, message: 'Short close updated successfully' });

    } catch (error) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


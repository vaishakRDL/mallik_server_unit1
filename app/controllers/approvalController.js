const { connection, handleSuccessResponse, handleErrorResponse, CustomError } = require('../config/dbSql');
const { getUser } = require("../utility/utilityFunction");
const { formatFinancialYears } = require('../utility/docNo');


// -----------------------------------------  Price Revision Approval  --------------------------------------//

// Get Approval Rate List
exports.rateList = async (req, res) => {
    const conn = await connection.getConnection();
    try {

        const fetch = `
            SELECT 
                pl.*, 
                sup.spCode, 
                sup.spName AS suppName, 
                sup.id AS supId, 
                itm.itemName AS itemName, 
                itm.id AS itemId, 
                itm.itemCode,
                uomTab.name AS uom, 
                uomTab.id AS uomId,
                DATE_FORMAT(pl.changedBy, '%d-%m-%Y') AS changedBy,
                svi.suppDesc
            FROM price_revision_log pl
            INNER JOIN supplier AS sup 
                ON pl.spName = sup.id
            INNER JOIN items AS itm 
                ON pl.itemName = itm.id
            INNER JOIN mst_uom AS uomTab 
                ON itm.uom = uomTab.id
            INNER JOIN supp_vs_item AS svi 
                ON pl.supItmId = svi.id    
            WHERE pl.isApprove = 1
        `;

        const [results] = await conn.query(fetch);

        results.forEach((element, index) => {
            element.sNo = index + 1;
            element.selected = false;
        });

        return handleSuccessResponse(res, "Approvals Data", results);

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};



exports.rateStatus = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { items, dept, module, pass } = req.body;
        const user = await getUser(req);


        if (!Array.isArray(items) || items.length === 0) {

            throw new CustomError(`Invalid or empty items array`);
        }

        await conn.beginTransaction();

        await validateApprovalPassword(
            conn,
            { dept, module, pass },
            user
        );

        const results = [];
        const changedBy = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        for (const status of items) {

            if (status.sighn == 0) {
                /* ---------------- APPROVE ---------------- */

                // Update supplier vs item rate
                await conn.execute(
                    `UPDATE supp_vs_item 
                     SET rate = ?, isRate = 0, notAllow = 0
                     WHERE id = ?`,
                    [status.newRate, status.supItmId]
                );


                // await conn.query(
                //     `UPDATE items SET isPoRate = 0 WHERE id = ?`,
                //     [status.itemId]
                // );

                // Update price revision log
                await conn.execute(
                    `UPDATE price_revision_log 
                     SET isApprove = 0 
                     WHERE id = ?`,
                    [status.id]
                );

                results.push({
                    id: status.supItmId,
                    message: 'Approved Successfully'
                });

            } else if (status.sighn == 1) {
                /* ---------------- REJECT ---------------- */

                await conn.execute(
                    `UPDATE price_revision_log 
                        SET isApprove = 0,
                            rejDate = ?,
                            rejRemarks = ?,
                            isReject = 1
                        WHERE id = ?`,
                    [changedBy, status.remarks, status.id]
                );

                // await conn.query(
                //     `UPDATE items SET isPoRate = 0 WHERE id = ?`,
                //     [status.itemId]
                // );


                results.push({
                    id: status.supItmId,
                    message: 'Rejected Successfully'
                });

            } else {
                throw new CustomError(`Invalid sighn value for item with id: ${status.supItmId}`);
            }
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



const validateApprovalPassword = async (conn, { dept, module, pass }, user) => {
    if (!dept || !module || !pass) {
        throw new CustomError("Dept, Module and Password are required");
    }

    const fetchSql = `
        SELECT id
        FROM approval_cred
        WHERE dept = ?
        AND module = ?
        AND password = ?
        LIMIT 1
    `;

    const [rows] = await conn.execute(fetchSql, [dept, module, pass]);

    if (rows.length === 0) {
        throw new CustomError("Invalid Password");
    }

    const approvalId = rows[0].id;

    const updateSql = `
        UPDATE approval_cred
        SET validatedBy = ?, validatedAt = NOW()
        WHERE id = ?
    `;

    const [result] = await conn.execute(updateSql, [user, approvalId]);

    if (result.affectedRows === 0) {
        throw new CustomError("Validation failed");
    }

    return true; //  validated
};


// exports.validate = async (req, res) => {

//     const conn = await connection.getConnection();

//     try {
//         const { dept, module, pass } = req.body;
//         const user = await getUser(req);

//         /* ================= REQUIRED VALIDATION ================= */
//         if (!dept || !module || !pass) {
//             return handleErrorResponse(res, "Dept, Module and Password are required");
//         }

//         /* ================= PASSWORD VALIDATION ================= */
//         const fetchSql = `
//       SELECT id
//       FROM approval_cred
//       WHERE dept = ?
//         AND module = ?
//         AND password = ?
//       LIMIT 1
//     `;

//         const [rows] = await conn.execute(fetchSql, [dept, module, pass]);

//         if (rows.length === 0) {
//             return handleErrorResponse(res, "Invalid password");
//         }

//         const approvalId = rows[0].id;

//         /* ================= UPDATE VALIDATION INFO ================= */
//         const updateSql = `
//       UPDATE approval_cred
//       SET 
//         validatedBy = ?,
//         validatedAt = NOW()
//       WHERE id = ?
//     `;

//         const [result] = await conn.execute(updateSql, [user, approvalId]);

//         if (result.affectedRows === 0) {
//             return handleErrorResponse(res, "Validation failed");
//         }

//         return handleSuccessResponse(res, "Password validated successfully");

//     } catch (err) {
//         return handleErrorResponse(res, err.message || err);
//     } finally {
//         if (conn) conn.release();
//     }
// };


// Get Rejected Rate List
exports.rateRejected = async (req, res) => {
    const conn = await connection.getConnection();
    try {

        const fetch = `
            SELECT 
                price_revision_log.*, 
                sup.spCode, 
                sup.spName AS suppName, 
                sup.id AS supId, 
                itm.itemName AS itemName, 
                itm.id AS itemId, 
                itm.itemCode,
                uomTab.name AS uom, 
                uomTab.id AS uomId,
                DATE_FORMAT(price_revision_log.rejDate, '%d-%m-%Y') AS changedBy
            FROM price_revision_log
            INNER JOIN supplier AS sup 
                ON price_revision_log.spName = sup.id
            INNER JOIN items AS itm 
                ON price_revision_log.itemName = itm.id
            INNER JOIN mst_uom AS uomTab 
                ON itm.uom = uomTab.id
            WHERE price_revision_log.isReject = 1
        `;

        const [results] = await conn.query(fetch);

        return handleSuccessResponse(res, "Rejected Data", results);

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};





// -----------------------------------------  Purchase Order Approval  --------------------------------------// 


// Get Pending PO For Admin User
exports.pendingPo = async (req, res) => {
    const conn = await connection.getConnection();
    try {

        const fetch = `
            SELECT 
                po_main.*, 
                sup.spCode, 
                sup.spName AS suppName, 
                sup.id AS supId, 
                cur.name AS currency, 
                cur.id AS currencyId,
                DATE_FORMAT(po_main.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(po_main.created_at, '%d-%m-%Y %H:%i:%s') AS created_at
            FROM po_main
            INNER JOIN supplier AS sup 
                ON po_main.spName = sup.id
            INNER JOIN mst_currency AS cur 
                ON po_main.currency = cur.id
            WHERE po_main.dflag = 0 
              AND po_main.statusSign = 0
        `;

        const [results] = await conn.query(fetch);

        return handleSuccessResponse(res, "Pending PO Order List", results);

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

// // Get Items based on PoNo
// exports.poView = async (req, res) => {
//     const conn = await connection.getConnection();
//     try {
//         const { poDigit: poNo, prefix } = req.body;

//         const fetch = `
//             SELECT  
//                 po_generate.*, po_generate.id AS poGenId,  po_generate.refNoDate,  
//                 po.specification,  po.authorized,  po.ammend, po.freightType,  po.paymentTerms,  po.gst, po.shipAddress, po.deliveryMode, 
//                 po.suppOfMat, po.splInstr1, po.addedBy AS preparedBy,po.caption, po.amountInWords, po.totalQty, po.grossAmount, po.id AS mainId,
//                 sup.spCode, sup.spName AS suppName, sup.id AS supId, sup.paymentTerms AS supPaymentTerms, sup.gstNo,  supCon.department, 

//                 CONCAT(
//                     sup.spAdd1, ' ', 
//                     sup.spAdd2, ' ', 
//                     sup.spAdd3, ' ', 
//                     sup.spAdd4
//                 ) AS spAddress,


//                 cur.name AS currency, cur.id AS currencyId, cur.code, itm.itemName AS label,  itm.itemName AS itemName,  itm.id AS itemId,  itm.minStockLvl, 
//                 itm.maxLvl, itm.itemCode, itm.totStk, uomTab.name AS uom, uomTab.id AS uomId
                
//             FROM po_generate
//             INNER JOIN po_main AS po 
//                 ON po_generate.poNo = po.poNo
//             INNER JOIN supplier AS sup 
//                 ON po_generate.spName = sup.id
//             LEFT JOIN sup_con_person AS supCon 
//                 ON sup.id = supCon.sId
//             INNER JOIN mst_currency AS cur 
//                 ON sup.currency = cur.id
//             INNER JOIN items AS itm 
//                 ON po_generate.itemName = itm.id
//             INNER JOIN mst_uom AS uomTab 
//                 ON itm.uom = uomTab.id
//             WHERE po_generate.digit = ? 
//               AND po_generate.type = ?
//             GROUP BY po_generate.id
//         `;

//         const [results] = await conn.query(fetch, [poNo, prefix]);

//         return handleSuccessResponse(res, "Po  Data", results);

//     } catch (err) {
//         await conn.rollback();
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// };

exports.poView = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { poDigit: poNo, prefix } = req.body;
        const { fyFrom, fyTo } = formatFinancialYears(req);


        let fetch = `
            SELECT
                po_generate.*, po_generate.id AS poGenId,  po_generate.refNoDate,
                po.specification,  po.authorized,  po.ammend, po.freightType,  po.paymentTerms,  po.gst, po.shipAddress, po.deliveryMode,
                po.suppOfMat, po.splInstr1, po.addedBy AS preparedBy,po.caption, po.amountInWords, po.totalQty, po.grossAmount, po.id AS mainId,
                sup.spCode, sup.spName AS suppName, sup.id AS supId, sup.paymentTerms AS supPaymentTerms, sup.gstNo,  supCon.department,

                CONCAT(
                    sup.spAdd1, ' ',
                    sup.spAdd2, ' ',
                    sup.spAdd3, ' ',
                    sup.spAdd4
                ) AS spAddress,


                cur.name AS currency, cur.id AS currencyId, cur.code, itm.itemName AS label,  itm.itemName AS itemName,  itm.id AS itemId,  itm.minStockLvl,
                itm.maxLvl, itm.itemCode, itm.totStk, uomTab.name AS uom, uomTab.id AS uomId

            FROM po_generate
            INNER JOIN po_main AS po
                ON po_generate.poNo = po.poNo
            INNER JOIN supplier AS sup
                ON po_generate.spName = sup.id
            LEFT JOIN sup_con_person AS supCon
                ON sup.id = supCon.sId
            INNER JOIN mst_currency AS cur
                ON sup.currency = cur.id
            INNER JOIN items AS itm
                ON po_generate.itemName = itm.id
            INNER JOIN mst_uom AS uomTab
                ON itm.uom = uomTab.id
            WHERE po_generate.digit = ?
              AND po_generate.type = ?
        `;

        const queryParams = [poNo, prefix];

        fetch += ` AND DATE(po.created_at) BETWEEN ? AND ? `;
        queryParams.push(fyFrom, fyTo);

        fetch += ` GROUP BY po_generate.id`;

        const [results] = await conn.query(fetch, queryParams);

        return handleSuccessResponse(res, "Po  Data", results);

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

// Update Approve or Reject PO For Admin User
exports.poStatus = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { id } = req.params;
        const { status, remarks: rmk } = req.body;

        let result;

        if (status == 1) {
            const data = "Approved";

            const update = `
                UPDATE po_main 
                SET statusSign = ?, status = ? 
                WHERE id = ?
            `;

            [result] = await conn.query(update, [status, data, id]);

            return handleSuccessResponse(res, "Successfully Approved", result);

        } else if (status == 2) {
            const data = "Rejected";
            const changedBy = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

            const update = `
                UPDATE po_main 
                SET statusSign = ?,  status = ?,  rejDate = ?,  rejRemarks = ?,  isReject = 1 
                WHERE id = ?
            `;

            [result] = await conn.query(update, [
                status, data, changedBy, rmk, id
            ]);

            return handleSuccessResponse(res, "Successfully Rejected", result);
        }

        // fallback (invalid status)
        throw new Error("Invalid status value");

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


// Reject PO (Admin)
exports.poRejected = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { id } = req.params;
        const { remarks: rmk, delay = 0 } = req.body;

        const status = 2;
        const data = "Rejected";
        const changedBy = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        const update = `
            UPDATE po_main 
            SET delay = ?,  statusSign = ?,  status = ?,  rejDate = ?,  rejRemarks = ?,  isReject = 1 
            WHERE id = ?
        `;

        const [results] = await conn.query(update, [
            delay, status, data, changedBy, rmk, id
        ]);

        return handleSuccessResponse(res, "Successfully Rejected", results);

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


// *****************************    UPLOAD OPENING BALANCE  APPROVAL   ***********************************   //


//Display the Opening Balnce Items list
exports.pendingStock = async (req, res) => {
    try {

        // Corrected query
        const query = `
            SELECT 
                approval_stock.*
            FROM approval_stock 
        `;

        // Execute the query with the corrected parameters
        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {
            // Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1; // Add serial number (sNo)
                element.selected = false; // Add serial number (sNo)
            });

            return res.status(200).json({
                success: true,
                message: "Pending Items",
                data: rows
            });
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};


//Submit The all data trasnfer to store 
exports.storeToMain = async (req, res) => {
    try {
        const user = req.headers.username;
        const { items } = req.body;

        // Check if items is an array and not empty
        if (!Array.isArray(items) || items.length === 0) {
            return handleErrorResponse(res, 'No items provided');
        }

        // Prepare values for batch insert
        const values = items.map(item => [item.itemId, item.itemCode, "Opening Balance", item.grn, item.qty, item.qty, item.qty, user]);
        const opValues = items.map(item => [item.itemId, item.itemCode, item.grn, item.qty, user, item.qty]);

        // Get all item IDs for deletion
        const itemIds = items.map(item => item.itemId);

        // Delete items in bulk
        await connection.query(
            `DELETE FROM approval_stock WHERE itemId IN (?)`,
            [itemIds]
        );

        // Insert new values in bulk
        await connection.query(
            `INSERT INTO store (itemId, itemCode, docType, grnNo, inwardQty, totQty, opQty, addedBy) VALUES ?`,
            [values]
        );

        // Insert new values in bulk
        await connection.query(
            `INSERT INTO op_balance (itemId, itemCode, grn, qty, addedBy, issueQoh) VALUES ?`,
            [opValues]
        );

        return handleSuccessResponse(res, 'Approved Successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.opStock = async () => {
    try {
        //console.log("Running the opStock cron job...");

        // Fetch the latest `itemId` and `totQty` for each `itemId` in the `store` table
        const [storeRows] = await connection.query(`
            SELECT itemId, totQty
            FROM store AS s1
            WHERE id = (
                SELECT MAX(id)
                FROM store AS s2
                WHERE s2.itemId = s1.itemId
            )
            ORDER BY id DESC
        `);

        // Delete old data from the `opening_stock` table if necessary
        // await connection.query(`DELETE FROM opening_stock WHERE DATE(created_at) < CURDATE()`);

        if (storeRows.length > 0) {
            for (const row of storeRows) {
                // Check if data for the current `itemId` already exists in the `opening_stock` table
                const [checkRows] = await connection.query(
                    `SELECT id, opQty FROM opening_stock WHERE itemId = ?`,
                    [row.itemId]
                );

                if (checkRows.length > 0) {
                    // Update existing record
                    await connection.query(
                        `UPDATE opening_stock SET opQty = ?, updated_at = ? WHERE id = ?`,
                        [row.totQty, new Date(), checkRows[0].id]
                    );
                    //console.log(`Updated opening_stock for itemId: ${row.itemId}`);
                } else {
                    // Insert new record
                    await connection.query(
                        `INSERT INTO opening_stock (itemId, opQty, created_at) VALUES (?, ?, ?)`,
                        [row.itemId, row.totQty, new Date()]
                    );
                    //console.log(`Inserted new record into opening_stock for itemId: ${row.itemId}`);
                }
            }
            //console.log("Processed all items successfully.");
        } else {
            //console.log("No data found in the store table.");
        }
    } catch (error) {
        console.error("Error in opStock cron job:", error);
    }
};


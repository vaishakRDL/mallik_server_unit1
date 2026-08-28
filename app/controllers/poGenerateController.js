const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { generateDocNo, formatFinancialYears, updateDocCounter } = require('../utility/docNo');
const { company } = require('../utility/utilityFunction');
const { v4: uuidv4 } = require('uuid');



exports.uniqueId = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { po: customValue } = req.body;

        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'PurchaseOrder', customValue });

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


exports.getSuggeation = async (req, res) => {
    try {

        const query1 = `

            SELECT  DISTINCT paymentTerms
              FROM po_main   
            WHERE paymentTerms IS NOT NULL AND  dflag = 0`;

        const [rows1] = await connection.execute(query1, []);

        const query2 = `

            SELECT  DISTINCT splInstr1
            FROM po_main   
            WHERE splInstr1 IS NOT NULL AND  dflag = 0`;

        const [rows2] = await connection.execute(query2, []);


        const query3 = `

            SELECT  DISTINCT gst
            FROM po_main   
            WHERE gst IS NOT NULL AND  dflag = 0`;

        const [rows3] = await connection.execute(query3, []);

        const query4 = `

            SELECT  DISTINCT caption
            FROM po_main   
            WHERE caption IS NOT NULL AND  dflag = 0`;

        const [rows4] = await connection.execute(query4, []);


        const query5 = `

            SELECT  DISTINCT specification
            FROM po_main   
            WHERE specification IS NOT NULL AND  dflag = 0`;

        const [rows5] = await connection.execute(query5, []);


        return res.status(200).json({
            success: true,
            paymentTerms: rows1,
            splInstr1: rows2,
            gst: rows3,
            caption: rows4,
            specification: rows5,

        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



//Get totStk from store table
exports.getSuppItm2 = async (req, res) => {
    try {
        const supplierId = req.params.id;
        const { q, type } = req.query;

        if (!supplierId) {
            return res.status(400).json({ success: false, message: "Supplier ID is required." });
        }

        // Conditional Query based on `type`
        const JW_joinQuery = type === 'J' ? `LEFT JOIN jobwork_issue_details AS jid ON jid.itemId = itm.id` : '';
        const JW_selectQuery = type === 'J' ? `jid.id as jobWorkId,` : '';

        // Base query
        let query = `
            SELECT 
                supp_vs_item.id, ${JW_selectQuery}
                CASE WHEN supp_vs_item.isRate = 1 THEN 0.000 ELSE supp_vs_item.rate END AS rate,
                sup.spCode, sup.spName AS suppName, sup.id AS supId, cur.code,
                CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress, sup.paymentTerms, sup.gstNo, 
                supCon.department, cur.name AS currency, cur.id AS currencyId, itm.itemName AS itemName, itm.id AS itemId, 
                itm.minStockLvl, itm.maxLvl, itm.itemCode, s.totQty AS totStk, itm.jwQty, itm.poQty AS pendingPo,
                uomTab.name AS uom, uomTab.id AS uomId,
                COALESCE(NULLIF(supp_vs_item.suppDesc, ''), itm.itemName) AS suppDesc
            FROM 
                supp_vs_item
            INNER JOIN supplier AS sup ON supp_vs_item.spName = sup.id
            INNER JOIN items AS itm ON supp_vs_item.itemName = itm.id
            LEFT JOIN sup_con_person AS supCon ON sup.sId = supCon.sId
            LEFT JOIN mst_currency AS cur ON sup.currency = cur.id
            LEFT JOIN store AS s 
                ON s.id = (
                    SELECT MAX(id) 
                    FROM store 
                    WHERE store.itemId = itm.id
                )
            INNER JOIN mst_uom AS uomTab ON itm.uom = uomTab.id
            ${JW_joinQuery}
            WHERE supp_vs_item.notAllow = 0 AND sup.id = ?
        `;
        const values = [supplierId];

        if (q) {
            query += `
                AND (itm.itemCode LIKE ? OR itm.itemName LIKE ? OR COALESCE(supp_vs_item.suppDesc, itm.itemName) LIKE ?)
            `;
            values.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }

        query += `
            ORDER BY 
                CASE WHEN itm.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, 
                itm.itemCode
            LIMIT 50
        `;

        const [rows] = await connection.execute(query, values);

        return res.status(200).json({ success: true, message: "Item lists retrieved successfully.", data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'An internal server error occurred.', error: err.message });
    }
};


//Not Used Testing Purpose Implemented
exports.poType2 = async (req, res) => {
    try {

        const poGen = req.body;

        let value;
        const type = poGen.poType;
        const itemId = poGen.itemId;


        const reqQty = parseInt(poGen.poQty);
        const pndQty = parseInt(poGen.pendingPo);
        const stk = parseInt(poGen.totStk);


        // const cons = 500;
        const day = 90;

        const query = `
             SELECT 
              jwDtl.id, jwDtl.Qty AS sfgQty 
            FROM 
              jobwork_issue_details jwDtl  WHERE itemId = ?

            `;

        const [rows] = await connection.execute(query, [itemId]);


        // Initialize dcQty and cons to 0 in case rows are null or empty
        let dcQty = 0;
        let cons = 0;

        // Check if rows is not null and not empty
        if (rows && rows.length > 0) {
            dcQty = parseInt(rows[0].sfgQty) || 0; // Ensure dcQty is a number
            cons = dcQty / day;
        }



        if (type == "OPEN PO" && rows.length > 0) {

            value = cons - (reqQty + pndQty + stk);

        } else if (type == "OPEN PO" && rows.length < 0) {

            value = reqQty + pndQty + stk;


        } else {

            value = reqQty + pndQty + stk + dcQty;

        }

        return res.status(200).json({
            success: true,
            data: value
        });

        // return { success: true, data: value };

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



//Used in Store Function
exports.poType = async (poGen, res) => {
    try {

        let value;
        const type = poGen.poType;
        const itemId = poGen.itemId;


        const reqQty = parseInt(poGen.poQty);
        const pndQty = parseInt(poGen.pendingPo);
        const stk = parseInt(poGen.totStk);


        // const cons = 500;
        const day = 90;

        const query = `
            SELECT 
              jwDtl.id, jwDtl.Qty AS sfgQty 
            FROM 
              jobwork_issue_details jwDtl  WHERE itemId = ?

            `;

        const [rows] = await connection.execute(query, [itemId]);


        // const dcQty =  rows[0].sfgQty;
        // const cons = dcQty / day;

        // Initialize dcQty and cons to 0 in case rows are null or empty
        let dcQty = 0;
        let cons = 0;

        // Check if rows is not null and not empty
        if (rows && rows.length > 0) {
            dcQty = parseInt(rows[0].sfgQty) || 0; // Ensure dcQty is a number
            cons = dcQty / day;
        }


        if (type == "OPEN PO" && rows.length > 0) {

            value = cons - (reqQty + pndQty + stk);

        } else if (type == "OPEN PO" && rows.length < 0) {

            value = reqQty + pndQty + stk;

        } else {

            value = reqQty + pndQty + stk + dcQty;
        }

        // return res.status(200).json({
        //     success: true,
        //     data: value
        // });

        return { success: true, data: value };

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}


//Not Used Testing Purpose Implemented
exports.checkMax = async (req, res) => {
    try {
        const poGenArray = req.body;
        const resultsArray = [];

        for (const poGen of poGenArray) {
            // const poTypeResult = await exports.poType(poGen);

            // if (poTypeResult.data > poGen.maxLvl) {
            //     return res.status(400).json({ 
            //         success: false, 
            //         message: `PO order can't be added for itemCode ${poGen.itemCode} Exceeds:${poGen.maxLvl} of max quantity level!` 
            //     });

            // } else if (poGen.maxLvl <= 0) {
            //     return res.status(400).json({ 
            //         success: false, 
            //         message: `PO order can't be added for itemCode ${poGen.itemCode}!` 
            //     });
            // }

            let value;

            const type = poGen.poType;
            const itemId = poGen.itemId;

            const reqQty = parseInt(poGen.poQty) || 0;
            const pndQty = parseInt(poGen.pendingPo);
            const stk = parseInt(poGen.totStk);

            const day = 90;

            const query = `
                SELECT 
                  delDtl.id, delDtl.sfgQty

                FROM del_schedule_details delDtl

                    INNER JOIN sfg_verification ON sfg_verification.id = delDtl.sfgId
                    INNER JOIN mrp ON mrp.id = sfg_verification.mrpId
                WHERE mrp.itemId = ?
            `;

            const [rows] = await connection.execute(query, [itemId]);

            let dcQty = 0;
            let cons = 0;

            if (rows && rows.length > 0) {
                dcQty = parseInt(rows[0].sfgQty) || 0;
                cons = dcQty / day;
            }

            if (type == "OPEN PO" && rows.length > 0) {
                value = cons - (reqQty + pndQty + stk);

            } else if (type == "OPEN PO") {
                value = reqQty + pndQty + stk;

            } else {

                value = reqQty + pndQty + stk + dcQty;
            }

            resultsArray.push({
                itemCode: poGen.itemCode,
                value: value
            });
        }

        return res.status(200).json({ success: true, results: resultsArray });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};


exports.store = async (req, res) => {
    const poGenArray = req.body;
    const user = req.headers.username;

    const uniqueDigits = new Set();
    const digitCounts = poGenArray.reduce((acc, poGen) => {
        const digit = parseInt(poGen.digit);
        acc[digit] = (acc[digit] || 0) + 1;
        return acc;
    }, {});

    const totalCount = Object.values(digitCounts).reduce((a, b) => a + b, 0);

    const store = `INSERT INTO po_generate (type, digit, poNo, date, spName, spAddress, uniqueFId, itemCode, itemName, 
        uom, suppDesc, jobWorkId, totStk, pendingPo, pendingJwQty, maxQtyLvl, schDate, poQty, rate, amt, refNoDate, poType, 
        department, currency, freightType, paymentTerms, gst, deliveryMode, suppOfMat, splInstr1, caption, 
        amountInWords, totalQty, grossAmount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const storeToMain = `INSERT INTO  po_main (type, digit, poNo, date, spName, spAddress, shipAddress, refNoDate, poType, currency,
        department, freightType, paymentTerms, gst, deliveryMode, suppOfMat, splInstr1, specification, caption, amountInWords, totalQty,
        grossAmount, poItmCnt, userBy, addedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const con = await connection.getConnection(); // Get a database connection

    try {
        await con.beginTransaction(); // Start transaction

        for (const poGen of poGenArray) {
            if (!poGen.poQty || !poGen.rate || parseFloat(poGen.rate) <= 0) {
                await con.rollback(); // Rollback if validation fails
                return res.status(400).json({
                    success: false,
                    message: `PO Quantity and Rate cannot be empty for itemCode ${poGen.itemCode}.`
                });
            }

            await con.query(store, [
                poGen.poNo, poGen.digit, poGen.digitString, poGen.date, poGen.supId, poGen.spAddress, poGen.uniqueFId,
                poGen.itemCode, poGen.itemId, poGen.uomId, poGen.suppDesc, poGen.jobWorkId || null, poGen.totStk,
                poGen.poQty, poGen.pendingJwQty, poGen.maxLvl, poGen.schDate, poGen.poQty, poGen.rate,
                poGen.amt, poGen.refNoDate, poGen.poType, poGen.department, poGen.currencyId, poGen.freightType,
                poGen.paymentTerms, poGen.gst, poGen.deliveryMode, poGen.suppOfMat, poGen.splInstr1,
                poGen.caption, poGen.amountInWords, poGen.totalQty, poGen.grossAmount
            ]);

            if (!uniqueDigits.has(poGen.digit)) {
                uniqueDigits.add(poGen.digit);
                await con.query(storeToMain, [
                    poGen.poNo, poGen.digit, poGen.digitString, poGen.date, poGen.supId, poGen.spAddress, poGen.shipAddress,
                    poGen.refNoDate, poGen.poType, poGen.currencyId, poGen.department, poGen.freightType,
                    poGen.paymentTerms, poGen.gst, poGen.deliveryMode, poGen.suppOfMat, poGen.splInstr1,
                    poGen.specification, poGen.caption, poGen.amountInWords, poGen.totalQty, poGen.grossAmount,
                    totalCount, user, user
                ]);
            }
        }

        await updateJWItems(con, poGenArray);
        await updateDocCounter(con, 'PurchaseOrder', { docNo: poGenArray[0].digitString, type: poGenArray[0].poNo });
        await con.commit(); // Commit transaction if all inserts succeed

//         res.status(200).json({ success: true, message: "Data added successfully" });

//     } catch (error) {
//         await con.rollback(); // Rollback transaction on error
//         console.error('Error:', error);
//         res.status(400).json({ success: false, message: error.message });

//     } finally {
//         con.release(); // Release database connection
//     }
// };

    return handleSuccessResponse(res, "Data added successfully");
    } catch (err) {
        await con.rollback(); 
        return handleErrorResponse(res, err);
    } finally {
        con.release();; // release connection if using pool
    }
    };



// Get Multiple Address of Supplier
exports.getAddress = async (req, res) => {
    let conn;
    try {
        const { sId } = req.body;

        if (!sId) {
            return res.status(400).json({
                success: false,
                message: "Supplier sId is required"
            });
        }

        conn = await connection.getConnection();

        const fetchQuery = `
        SELECT
            sup_multi_add.*, sup_multi_add.category AS state, s.country
        FROM sup_multi_add
        INNER JOIN supplier AS s
            ON s.sId = sup_multi_add.sId
        WHERE sup_multi_add.sId = ?
        `;

        const [results] = await conn.query(fetchQuery, [sId]);

        return handleSuccessResponse(res, "Supplier Address list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


exports.getItems = async (req, res) => {
    try {
        const { type, id, prefix } = req.query;
        const { fyFrom, fyTo } = formatFinancialYears(req);

        // Check if type is 'forward' or 'reverse' and validate the presence of 'id'
        if ((type === 'forward' || type === 'reverse') && (!id || id === '')) {
            return res.status(200).json({
                success: true,
                data: []
            });
        }

        // Determine mainId based on the type and id
        let mainIdQuery = '';
        let queryParams = [];

        switch (type) {
            case 'first':
                mainIdQuery = `
                    SELECT MIN(po.id) AS mainId
                    FROM po_main AS po
                    WHERE po.dflag = 0
                `;
                if (prefix) {
                    mainIdQuery += ` AND po.type = ?`;
                    queryParams.push(prefix);
                }
                break;

            case 'last':
                mainIdQuery = `
                    SELECT MAX(po.id) AS mainId
                    FROM po_main AS po
                    WHERE po.dflag = 0
                `;
                if (prefix) {
                    mainIdQuery += ` AND po.type = ?`;
                    queryParams.push(prefix);
                }
                break;

            case 'forward':
                mainIdQuery = `
                    SELECT MIN(po.id) AS mainId
                    FROM po_main AS po
                    WHERE po.dflag = 0 AND po.id > ?
                `;
                queryParams.push(id);

                if (prefix) {
                    mainIdQuery += ` AND po.type = ?`;
                    queryParams.push(prefix);
                }
                break;

            case 'reverse':
                mainIdQuery = `
                    SELECT MAX(po.id) AS mainId
                    FROM po_main AS po
                    WHERE po.dflag = 0 AND po.id < ?
                `;
                queryParams.push(id);

                if (prefix) {
                    mainIdQuery += ` AND po.type = ?`;
                    queryParams.push(prefix);
                }
                break;

            default:
                //  Prevent SQL syntax error
                return res.status(200).json({
                    success: true,
                    data: []
                });
        }

        // Always add financial year filter
        mainIdQuery += ` AND DATE(po.created_at) BETWEEN ? AND ?`;
        queryParams.push(fyFrom, fyTo);


        // //console.log(mainIdQuery, queryParams);
        // Execute mainIdQuery to get mainId based on the type
        const [mainIdRows] = await connection.execute(mainIdQuery, queryParams);
        const mainId = mainIdRows[0]?.mainId;

        // //console.log(mainId);

        // Main query to fetch items based on the determined mainId
        let items = `
            SELECT po_generate.*, po_generate.id as poGenId, po.addedBy As preparedBy,
                po.specification, po.id AS mainId, po.authorized, po.ammend, po.freightType, 
                po.paymentTerms, po.gst, po.deliveryMode, po.suppOfMat, po.splInstr1, 
                po.specification, po.caption, po.amountInWords, po.totalQty, po.grossAmount, 
                sup.spCode, sup.spName AS suppName, sup.id AS supId, sup.paymentTerms, sup.gstNo,
                CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,
                supCon.department, po_generate.refNoDate, po.shipAddress,
                cur.name AS currency, cur.id AS currencyId, cur.code,
                itm.itemName AS label, itm.itemName AS itemName, itm.id AS itemId, itm.minStockLvl, 
                itm.maxLvl, itm.itemCode, itm.totStk, 
                uomTab.name AS uom, uomTab.id AS uomId
            FROM po_generate
                INNER JOIN po_main AS po ON po_generate.poNo = po.poNo
                INNER JOIN supplier AS sup ON po_generate.spName = sup.id
                LEFT JOIN sup_con_person AS supCon ON sup.sId = supCon.sId
                LEFT JOIN mst_currency AS cur ON sup.currency = cur.id
                LEFT JOIN items AS itm ON po_generate.itemName = itm.id
                LEFT JOIN mst_uom AS uomTab ON itm.uom = uomTab.id
            WHERE po.id = ?
            ORDER BY po_generate.id ASC
        `;

        const [rows] = await connection.execute(items, [mainId]);

        return res.status(200).json({
            success: true,
            data: rows
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


exports.pendPoDtl = async (req, res) => {
    let conn;
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Item id is required"
            });
        }

        conn = await connection.getConnection();

        const fetchQuery = `
        SELECT
            po.id, po.poNo, po.poQty, po.pendingPo, po.rate, sup.spName AS suppName,
            DATE_FORMAT(po.date, '%d-%m-%Y') AS date,
            DATE_FORMAT(po.schDate, '%d-%m-%Y') AS schDate
        FROM po_generate po
        INNER JOIN supplier AS sup
            ON po.spName = sup.id
        WHERE po.dflag = 0
            AND po.pendingPo > 0
            AND po.itemName = ?
        `;

        const [results] = await conn.query(fetchQuery, [id]);

        return handleSuccessResponse(res, "Pending poqty list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


// Get Suppliers based on items
exports.getSupRates = async (req, res) => {
    let conn;
    try {
        const { id } = req.params;

        conn = await connection.getConnection();

        const fetchQuery = `
      SELECT DISTINCT
      svi.id, svi.rate, svi.sob, po.rate AS dcRate, sup.spName, sup.spCode
      FROM supp_vs_item svi
      INNER JOIN supplier AS sup
        ON svi.spName = sup.id
      LEFT JOIN po_generate AS po
        ON svi.itemName = po.itemName  AND svi.spName = po.spName
      WHERE svi.itemName = ?
    `;

        const [results] = await conn.query(fetchQuery, [id]);

        return handleSuccessResponse(res, "Supplier Rate list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


// Get QOH based on item
exports.getLocQoh = async (req, res) => {
    let conn;
    try {
        const { id } = req.params;

        conn = await connection.getConnection();

        const fetchQuery = `
        SELECT
            i.id,
            i.totStk,
            loc.name AS location
        FROM items i
        LEFT JOIN item_main_loc AS loc
            ON loc.id = i.mainLocation
        WHERE i.id = ?
        `;

        const [results] = await conn.query(fetchQuery, [id]);

        return handleSuccessResponse(res, "Item QOH by Location", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};


exports.update = async (req, res) => {
    try {
        const poArray = req.body;

        const checkReferenceQuery = `
            SELECT COUNT(*) AS refCount
            FROM po_bill_dtl
            WHERE poDtlId IN (SELECT id FROM po_generate WHERE poNo = ?)
        `;

        const deleteDetailQuery = `
            DELETE FROM po_generate
            WHERE poNo = ?
        `;

        const insertDetailQuery = `
            INSERT INTO po_generate (
                poNo, date, spName, spAddress, uniqueFId, itemCode, suppDesc, totStk, pendingPo, maxQtyLvl, schDate, poQty, rate, amt, refNoDate, poType, 
                department, currency, freightType, paymentTerms, gst, deliveryMode, suppOfMat, splInstr1, caption, amountInWords, 
                digit, type, itemName
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `;

        const updateMainQuery = `
            UPDATE po_main SET 
                refNoDate = ?, poType = ?, currency = ?, department = ?, freightType = ?, paymentTerms = ?, gst = ?,
                deliveryMode = ?, suppOfMat = ?, splInstr1 = ?, caption = ?, amountInWords = ?, totalQty = ?, grossAmount = ?
            WHERE poNo = ?
        `;

        if (poArray.length > 0) {
            // Step 1: Check if any rows are already referenced
            const [refCheck] = await connection.execute(checkReferenceQuery, [poArray[0].digitString]);

            if (refCheck[0].refCount > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot delete or update as these items have already been received in PO Bill"
                });
            }

            // Step 2: Delete old rows if no reference found
            await connection.execute(deleteDetailQuery, [poArray[0].digitString]);
        }

        for (const poGen of poArray) {
            // Insert new rows
            await connection.execute(insertDetailQuery, [
                poGen.digitString, poGen.date, poGen.supId, poGen.spAddress, poGen.uniqueFId, poGen.itemCode, poGen.suppDesc,
                poGen.totStk, poGen.poQty, poGen.maxLvl, poGen.schDate, poGen.poQty, poGen.rate, poGen.amt, poGen.refNoDate, // Recentlty chnaged pendingPo value as poQty before it was pendingPo 
                poGen.poType, poGen.department, poGen.code, poGen.freightType, poGen.paymentTerms, poGen.gst,
                poGen.deliveryMode, poGen.suppOfMat, poGen.splInstr1, poGen.caption, poGen.amountInWords,
                poGen.digit, poGen.poNo, poGen.itemId
            ]);

            // Update main table (can be optimized to once)
            await connection.execute(updateMainQuery, [
                poGen.refNoDate, poGen.poType, poGen.code, poGen.department, poGen.freightType, poGen.paymentTerms, poGen.gst,
                poGen.deliveryMode, poGen.suppOfMat, poGen.splInstr1, poGen.caption, poGen.amountInWords,
                poGen.totalQty, poGen.grossAmount,
                poGen.digitString
            ]);
        }

        return res.status(200).json({
            success: true,
            message: "Data updated successfully"
        });

    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};




exports.updateOpt = async (req, res) => {
    try {
        const poArray = req.body;
        const type = req.query.type;

        const updateDetailQuery = `
            UPDATE po_generate SET 
                spName = ?, itemCode = ?, itemName = ?, uom = ?, suppDesc = ?, totStk = ?, pendingPo = ?, pendingJwQty = ?, 
                maxQtyLvl = ?, schDate = ?, poQty = ?, rate = ?, amt = ?, refNoDate = ?, poType = ?, department = ?, 
                currency = ?, freightType = ?, paymentTerms = ?, gst = ?, deliveryMode = ?, suppOfMat = ?, splInstr1 = ?, 
                caption = ?, amountInWords = ?, totalQty = ?, grossAmount = ? 
            WHERE digit = ? AND id = ?
        `;

        const updateMainQuery = `
            UPDATE po_main SET 
                spName = ?, spAddress = ?, refNoDate = ?, poType = ?, currency = ?, department = ?, 
                freightType = ?, paymentTerms = ?, gst = ?, deliveryMode = ?, suppOfMat = ?, splInstr1 = ?, 
                caption = ?, amountInWords = ?, totalQty = ?, grossAmount = ?, 
                ammend = ?, 
                authorized = ?, 
                firstAuth = ? 
            WHERE poNo = ?
        `;

        const checkAuth = `SELECT authorized, firstAuth FROM po_main WHERE poNo = ?`;

        const insertDetailQuery = `
            INSERT INTO po_generate 
                (spName, spAddress, type, digit, poNo, date, itemCode, itemName, uom, suppDesc, totStk, pendingPo, pendingJwQty, maxQtyLvl, 
                schDate, poQty, rate, amt, refNoDate, poType, department, currency, freightType, paymentTerms, gst, uniqueFId,
                deliveryMode, suppOfMat, splInstr1, caption, amountInWords, totalQty, grossAmount) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await Promise.all(
            poArray.map(async (poGen) => {
                if (!poGen.poQty) {
                    throw new Error(`PO Qty can't be empty for itemCode ${poGen.itemCode}!`);
                }

                const [authData] = await connection.query(checkAuth, [poGen.digitString]);

                if (!("poGenId" in poGen) || poGen.poGenId == null || poGen.poGenId === 0) {
                    // Insert new item
                    await connection.query(insertDetailQuery, [
                        poGen.supId, poGen.spAddress, poGen.poNo, poGen.digit, poGen.digitString, poGen.date, poGen.itemCode, poGen.itemId, poGen.uomId,
                        poGen.suppDesc, poGen.totStk, poGen.poQty, poGen.pendingJwQty, poGen.maxQtyLvl,
                        poGen.schDate, poGen.poQty, poGen.rate, poGen.amt, poGen.refNoDate, poGen.poType,
                        poGen.department, poGen.currencyId, poGen.freightType, poGen.paymentTerms, poGen.gst, poGen.uniqueFId,
                        poGen.deliveryMode, poGen.suppOfMat, poGen.splInstr1, poGen.caption, poGen.amountInWords,
                        poGen.totalQty, poGen.grossAmount
                    ]);
                } else {
                    // Get old poQty and pendingPo for the existing item
                    const [oldRowData] = await connection.query(
                        `SELECT poQty, pendingPo FROM po_generate WHERE digit = ? AND id = ?`,
                        [poGen.digit, poGen.poGenId]
                    );

                    if (oldRowData.length > 0) {
                        const oldPoQty = parseFloat(oldRowData[0].poQty || 0);
                        const oldPendingPo = parseFloat(oldRowData[0].pendingPo || 0);
                        const newPoQty = parseFloat(poGen.poQty || 0);

                        // if (newPoQty > oldPoQty) {
                        //     const diff = newPoQty - oldPoQty;
                        //     poGen.pendingPo = oldPendingPo + diff;
                        // } else {
                        //     poGen.pendingPo = oldPendingPo;
                        // }
                        const diff = newPoQty - oldPoQty;
                        poGen.pendingPo = oldPendingPo + diff;

                    }

                    // Update existing item
                    await connection.query(updateDetailQuery, [
                        poGen.supId, poGen.itemCode, poGen.itemId, poGen.uomId, poGen.suppDesc, poGen.totStk,
                        poGen.pendingPo, poGen.pendingJwQty, poGen.maxQtyLvl, poGen.schDate,
                        poGen.poQty, poGen.rate, poGen.amt, poGen.refNoDate, poGen.poType, poGen.department,
                        poGen.currencyId, poGen.freightType, poGen.paymentTerms, poGen.gst, poGen.deliveryMode,
                        poGen.suppOfMat, poGen.splInstr1, poGen.caption, poGen.amountInWords,
                        poGen.totalQty, poGen.grossAmount,
                        poGen.digit, poGen.poGenId
                    ]);
                }

                // Handle ammend & deauth
                let ammend = poGen.ammend;
                let authorized = authData[0].authorized;
                let firstAuth = authData[0].firstAuth;

                if (type === "ammend") {
                    ammend = 1;
                }
                if (type === "deauth") {
                    authorized = 0;
                    firstAuth = 0;
                }

                // Update po_main
                await connection.query(updateMainQuery, [
                    poGen.supId, poGen.spAddress, poGen.refNoDate, poGen.poType, poGen.currencyId, poGen.department,
                    poGen.freightType, poGen.paymentTerms, poGen.gst, poGen.deliveryMode, poGen.suppOfMat,
                    poGen.splInstr1, poGen.caption, poGen.amountInWords, poGen.totalQty, poGen.grossAmount,
                    ammend, authorized, firstAuth, poGen.digitString
                ]);
            })
        );

        return res.status(200).json({ success: true, message: "Data updated successfully" });

    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || "An error occurred" });
    }
};


//while Ammend Po
exports.deleteItm = async (req, res) => {
    try {
        const id = req.params.id;
        const { prefix } = req.query;

        if (prefix === 'J') {
            const [jobWork] = await connection.execute(
                `SELECT po_generate.jobWorkId FROM po_generate 
                WHERE id = ?`,
                [id]
            );
            const jwIds = jobWork.map(jw => jw.jobWorkId);

            if (jwIds.length > 0) {
                const updateJWQuery = `UPDATE jobwork_issue_details 
                    SET dc_close = ? 
                    WHERE id IN (${jwIds.map(() => '?').join(',')})`;
                await connection.execute(updateJWQuery, [0, ...jwIds]);
            }
        }


        const checkReferenceQuery = `
            SELECT COUNT(*) AS refCount
            FROM po_bill_dtl
            WHERE poDtlId = ?
        `;

        const [refCheck] = await connection.execute(checkReferenceQuery, [id]);

        if (refCheck[0].refCount > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete or update as these items have already been received in PO Bill"
            });
        }

        await connection.execute(`DELETE FROM po_generate WHERE id = ?`, [id]);

        return handleSuccessResponse(res, 'Deleted Successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


exports.delete = async (req, res) => {
    try {
        const id = req.params.id;
        const { prefix } = req.query;

        const [poNoRow] = await connection.execute(
            `SELECT poNo FROM po_main WHERE digit = ? AND type = ?`,
            [id, prefix]
        );

        if (poNoRow.length === 0) {
            return res.status(404).json({ success: false, message: 'Purchase Order not found' });
        }

        const poNo = poNoRow[0].poNo;

        if (prefix === 'J') {
            const [jobWork] = await connection.execute(
                `SELECT po_generate.jobWorkId FROM po_generate 
                 WHERE poNo = ?`,
                [poNo]
            );
            const jwIds = jobWork.map(jw => jw.jobWorkId);

            if (jwIds.length > 0) {
                const updateJWQuery = `UPDATE jobwork_issue_details 
                    SET dc_close = ? 
                    WHERE id IN (${jwIds.map(() => '?').join(',')})`;
                await connection.execute(updateJWQuery, [0, ...jwIds]);
            }
        }

        await connection.execute(`DELETE FROM po_generate WHERE poNo = ?`, [poNo]);
        await connection.execute(`DELETE FROM po_main WHERE poNo = ?`, [poNo]);

        return handleSuccessResponse(res, 'Deleted Successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


//  /* ************************            VIEW PURCHASE ORDER            ********************************* */ //


// //Update Day Counts against scheduledDate
// const updateDelayCount2 = () => {
//     return new Promise((resolve, reject) => {
//         try {
//             // Fetch the date from the po_main table
//             const fetchScheduledDateQuery = 'SELECT id, date FROM po_main'; // Fetching the id and date from po_main table
//             sql.query(fetchScheduledDateQuery, (fetchErr, fetchResult) => {
//                 if (fetchErr) {
//                     console.error('Error fetching scheduledDate:', fetchErr);
//                     reject(fetchErr);
//                 }

//                 const promises = fetchResult.map(row => {
//                     return new Promise((resolveUpdate, rejectUpdate) => {
//                         const id = row.id;
//                         const scheduledDate = new Date(row.date);

//                         // Get the current date
//                         const currentDate = new Date();

//                         // Calculate the delay in days
//                         const timeDifferenceMs = scheduledDate.getTime() - currentDate.getTime();
//                         const delayInDays = Math.ceil(timeDifferenceMs / (1000 * 60 * 60 * 24));

//                         // Prepare the message based on the delay count
//                         let message;
//                         if (delayInDays < 0) {
//                             message = `${Math.abs(delayInDays)} days delayed`;
//                         } else {
//                             message = `${delayInDays} days remaining`;
//                         }

//                         // Update the delay count and message in the po_main table for each row
//                         const updateDelayCountQuery = 'UPDATE po_main SET delay = ?, delayCnt = ? WHERE id = ?';
//                         sql.query(updateDelayCountQuery, [message, delayInDays, id], (updateErr, updateResult) => {
//                             if (updateErr) {
//                                 console.error('Error updating delay count:', updateErr);
//                                 rejectUpdate(updateErr);
//                             }
//                             resolveUpdate();
//                         });
//                     });
//                 });

//                 Promise.all(promises)
//                     .then(() => {
//                         resolve();
//                     })
//                     .catch(error => {
//                         reject(error);
//                     });
//             });
//         } catch (err) {
//             reject(err);
//         }
//     });
// };



// const sqlQuery = (query, params) => {
//     return new Promise((resolve, reject) => {
//         sql.query(query, params, (err, result) => {
//             if (err) {
//                 return reject(err);
//             }
//             resolve(result);
//         });
//     });
// };


// const updateDelayCount = async () => {
//     try {
//         // Fetch the date from the po_main table
//         const fetchScheduledDateQuery = 'SELECT id, date FROM po_main';
//         const fetchResult = await sqlQuery(fetchScheduledDateQuery);

//         const currentDate = new Date();

//         const updatePromises = fetchResult.map(async (row) => {
//             const id = row.id;
//             const scheduledDate = new Date(row.date);

//             // Calculate the delay in days
//             const timeDifferenceMs = scheduledDate.getTime() - currentDate.getTime();
//             const delayInDays = Math.ceil(timeDifferenceMs / (1000 * 60 * 60 * 24));

//             // Prepare the message based on the delay count
//             const message = delayInDays < 0 ? `${Math.abs(delayInDays)} days delayed` : `${delayInDays} days remaining`;

//             // Update the delay count and message in the po_main table for each row
//             const updateDelayCountQuery = 'UPDATE po_main SET delay = ?, delayCnt = ? WHERE id = ?';
//             await sqlQuery(updateDelayCountQuery, [message, delayInDays, id]);
//         });

//         await Promise.all(updatePromises);
//     } catch (err) {
//         console.error('Error in updateDelayCount:', err);
//         throw err;
//     }
// };


exports.showData = async (req, res) => {
    let conn;
    try {
        conn = await connection.getConnection();

        const fetchQuery = `
        SELECT
            po_main.*, sup.spCode, sup.spName AS suppName, sup.id AS supId, sup.state, sup.country, cur.name AS currency, cur.id AS currencyId,
            DATE_FORMAT(po_main.date, '%d-%m-%Y') AS date, DATE_FORMAT(po_main.created_at, '%d-%m-%Y %H:%i:%s') AS created_at
        FROM po_main
        INNER JOIN supplier AS sup
            ON po_main.spName = sup.id
        INNER JOIN mst_currency AS cur
            ON po_main.currency = cur.id
        WHERE po_main.dflag = 0
            AND po_main.statusSign IN (0, 1, 2, 3)
        `;

        const [results] = await conn.query(fetchQuery);


        return handleSuccessResponse(res, 'PO Order List', results);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};



// exports.invoice = async (req, res) => {
//     let conn;
//     try {
//         const { poDigit: poNo, prefix } = req.body;

//         if (!poNo || !prefix) {
//             return res.status(400).json({
//                 success: false,
//                 message: "poDigit and prefix are required"
//             });
//         }

//         conn = await connection.getConnection();

//         const companyData = await company();

//         const fetchQuery = `
//         SELECT 
//             po_main.type, po_main.poNo, po_main.shipAddress, po_main.poType, po_main.refNoDate, po_main.amountInWords, po_main.ammend, po_main.gst, po_main.grossAmount,
//             po_main.paymentTerms, po_main.deliveryMode, po_main.suppOfMat, po_main.splInstr1, DATE_FORMAT(po_main.date, '%d-%m-%Y') AS poDate, po_main.addedBy,
//             pOg.rate AS unitRate, pOg.amt AS value, pOg.suppDesc, pOg.poQty, DATE_FORMAT(pOg.schDate, '%d-%m-%Y') AS schDate, 
//             itm.itemCode, itm.itemName, itm.stdRate, uomTab.name AS uomName,

//             CONCAT(
//             COALESCE(sup.spAdd1, ''),
//             ' ',
//             COALESCE(sup.spAdd2, ''),
//             ' ',
//             COALESCE(sup.spAdd3, ''),
//             ' ',
//             COALESCE(sup.spAdd4, '')
//             ) AS spAddress,

//             cur.name AS currency, cur.id AS currencyId, cur.code, sup.spName AS suppName, sup.panNo, sup.gstNo AS supGst, auth.firstAuthBy, auth.secondAuthBy
//         FROM po_main
//         RIGHT JOIN po_generate AS pOg
//             ON po_main.poNo = pOg.poNo
//         INNER JOIN supplier AS sup
//             ON po_main.spName = sup.id
//         INNER JOIN items AS itm
//             ON pOg.itemName = itm.id
//         LEFT JOIN mst_uom AS uomTab
//             ON itm.uom = uomTab.id
//         LEFT JOIN auth_docs AS auth
//             ON auth.refNo = po_main.poNo
//         LEFT JOIN mst_currency AS cur
//             ON sup.currency = cur.id
//         WHERE po_main.dflag = 0
//             AND po_main.digit = ?
//             AND po_main.type = ?
//         GROUP BY pOg.id
//         `;

//         const [poData] = await conn.query(fetchQuery, [poNo, prefix]);

//         if (!poData || poData.length === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: "No purchase order found"
//             });
//         }

//         const testData = {
//             type: poData[0].type,
//             poNo: poData[0].poNo,
//             toName: poData[0].suppName,
//             toAddress: poData[0].spAddress,
//             shipAddress: poData[0].shipAddress,
//             poType: poData[0].poType,
//             date: poData[0].poDate,
//             refNoDate: poData[0].refNoDate,
//             amountInWords: poData[0].amountInWords,
//             ammend: poData[0].ammend,
//             gst: poData[0].gst,
//             panNo: poData[0].panNo,
//             code: poData[0].code,
//             supGst: poData[0].supGst,
//             total: poData[0].grossAmount,
//             paymentTerms: poData[0].paymentTerms,
//             deliveryMode: poData[0].deliveryMode,
//             supplyOfMaterial: poData[0].suppOfMat,
//             specialInstruction1: poData[0].splInstr1,
//             preparedBy: poData[0].addedBy,
//             reviewedBy: poData[0].firstAuthBy,
//             approvedBy: poData[0].secondAuthBy,

//             // company details
//             ...companyData,

//             // items
//             data: poData.map((row, index) => ({
//                 id: index + 1,
//                 sNo: index + 1,
//                 itemCode: row.itemCode,
//                 itemDescription: row.itemName,
//                 suppDesc: row.suppDesc,
//                 schDate: row.schDate,
//                 qty: row.poQty,
//                 uom: row.uomName,
//                 unitRate: Number(row.unitRate).toFixed(3),
//                 value: Number(row.value).toFixed(3)
//             }))
//         };

//         return res.status(200).json({
//             success: true,
//             testData
//         });

//     } catch (err) {
//         return handleErrorResponse(res, err);
//     } finally {
//         if (conn) conn.release();
//     }
// };

exports.invoice = async (req, res) => {
    let conn;
    try {
        const { poDigit: poNo, prefix } = req.body;
        const { fyFrom, fyTo } = formatFinancialYears(req);


        if (!poNo || !prefix) {
            return res.status(400).json({
                success: false,
                message: "poDigit and prefix are required"
            });
        }

        conn = await connection.getConnection();

        const companyData = await company();

        const fetchQuery = `
        SELECT
            po_main.type, po_main.poNo, po_main.shipAddress, po_main.poType, po_main.refNoDate, po_main.amountInWords, po_main.ammend, po_main.gst, po_main.grossAmount,
            po_main.paymentTerms, po_main.deliveryMode, po_main.suppOfMat, po_main.splInstr1, DATE_FORMAT(po_main.date, '%d-%m-%Y') AS poDate, po_main.addedBy,
            pOg.rate AS unitRate, pOg.amt AS value, pOg.suppDesc, pOg.poQty, DATE_FORMAT(pOg.schDate, '%d-%m-%Y') AS schDate,
            itm.itemCode, itm.itemName, itm.stdRate, uomTab.name AS uomName,

            CONCAT(
            COALESCE(sup.spAdd1, ''),
            ' ',
            COALESCE(sup.spAdd2, ''),
            ' ',
            COALESCE(sup.spAdd3, ''),
            ' ',
            COALESCE(sup.spAdd4, '')
            ) AS spAddress,

            cur.name AS currency, cur.id AS currencyId, cur.code, sup.spName AS suppName, sup.panNo, sup.gstNo AS supGst, auth.firstAuthBy, auth.secondAuthBy
        FROM po_main
        RIGHT JOIN po_generate AS pOg
            ON po_main.poNo = pOg.poNo
        INNER JOIN supplier AS sup
            ON po_main.spName = sup.id
        INNER JOIN items AS itm
            ON pOg.itemName = itm.id
        LEFT JOIN mst_uom AS uomTab
            ON itm.uom = uomTab.id
        LEFT JOIN auth_docs AS auth
            ON auth.refNo = po_main.poNo
        LEFT JOIN mst_currency AS cur
            ON sup.currency = cur.id
        WHERE po_main.dflag = 0
            AND po_main.digit = ?
            AND po_main.type = ?
            AND DATE(po_main.created_at) BETWEEN ? AND ?
        GROUP BY pOg.id
        `;

        const [poData] = await conn.query(fetchQuery, [poNo, prefix, fyFrom, fyTo]);

        if (!poData || poData.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No purchase order found"
            });
        }

        const testData = {
            type: poData[0].type,
            poNo: poData[0].poNo,
            toName: poData[0].suppName,
            toAddress: poData[0].spAddress,
            shipAddress: poData[0].shipAddress,
            poType: poData[0].poType,
            date: poData[0].poDate,
            refNoDate: poData[0].refNoDate,
            amountInWords: poData[0].amountInWords,
            ammend: poData[0].ammend,
            gst: poData[0].gst,
            panNo: poData[0].panNo,
            code: poData[0].code,
            supGst: poData[0].supGst,
            total: poData[0].grossAmount,
            paymentTerms: poData[0].paymentTerms,
            deliveryMode: poData[0].deliveryMode,
            supplyOfMaterial: poData[0].suppOfMat,
            specialInstruction1: poData[0].splInstr1,
            preparedBy: poData[0].addedBy,
            reviewedBy: poData[0].firstAuthBy,
            approvedBy: poData[0].secondAuthBy,

            // company details
            ...companyData,

            // items
            data: poData.map((row, index) => ({
                id: index + 1,
                sNo: index + 1,
                itemCode: row.itemCode,
                itemDescription: row.itemName,
                suppDesc: row.suppDesc,
                schDate: row.schDate,
                qty: row.poQty,
                uom: row.uomName,
                unitRate: Number(row.unitRate).toFixed(3),
                value: Number(row.value).toFixed(3)
            }))
        };

        return res.status(200).json({
            success: true,
            testData
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};
// View Main PO Bill
exports.poBill = async (req, res) => {
  let conn;
  try {
    const { poDigit: poNo } = req.body;

    if (!poNo) {
      return res.status(400).json({
        success: false,
        message: "poDigit is required"
      });
    }

    conn = await connection.getConnection();

    const fetchQuery = `
      SELECT 
        po_bill.id, po_bill.digit, po_bill.poNo, po_bill.grnRefNO, po_bill.suppInvNo, po_bill.suppInvoiceDate, po_bill.suppDcDate, po_bill.csSuppDcNo,
        DATE_FORMAT(po_bill.date, '%d-%m-%Y') AS date, po_bill.file
      FROM po_bill
      WHERE po_bill.dflag = 0
        AND po_bill.poOrdDigit = ?
    `;

    const [results] = await conn.query(fetchQuery, [poNo]);

    // Auto index (sNo)
    const data = results.map((row, index) => ({
      sNo: index + 1,
      ...row
    }));

   return handleSuccessResponse(res, 'Po Bill List', data);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


// View PO Bill Items Based on PO Bill Digit
exports.poBillDtl = async (req, res) => {
  let conn;
  try {
    const { poDigit: poNo, prefix } = req.body;

    if (!poNo || !prefix) {
      return res.status(400).json({
        success: false,
        message: "poDigit and prefix are required"
      });
    }

    conn = await connection.getConnection();

    const fetchQuery = `
      SELECT 
        po_bill.*, poBilDtl.*, sup.spName AS suppName, sup.state, sup.country, cur.name AS currency, cur.id AS currencyId,
        itm.itemCode, itm.itemName, itm.stdRate, uomTab.name AS uomName
      FROM po_bill
      RIGHT JOIN po_bill_dtl AS poBilDtl
        ON po_bill.digit = poBilDtl.digit
       AND po_bill.type = poBilDtl.type
      INNER JOIN supplier AS sup
        ON po_bill.spName = sup.id
      INNER JOIN items AS itm
        ON poBilDtl.itemName = itm.id
      LEFT JOIN mst_uom AS uomTab
        ON poBilDtl.uom = uomTab.id
      LEFT JOIN mst_currency AS cur
        ON sup.currency = cur.id
      WHERE po_bill.dflag = 0
        AND po_bill.digit = ?
        AND po_bill.type = ?
    `;

    const [results] = await conn.query(fetchQuery, [poNo, prefix]);

    return handleSuccessResponse(res, 'Po Bill Details List', results );

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


//Get Supplier
exports.searchSup = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;

        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT DISTINCT

             supplier.id, supplier.spCode AS label, supplier.spName
            FROM 
             supplier

                INNER JOIN po_main ON po_main.spName = supplier.id

            `;

        const values = [];

        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` WHERE (supplier.spCode LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
        }

        const [rows, fields] = await connection.execute(fetch, values);

        return handleSuccessResponse(res, 'Supplier', rows );

    } catch (err) {
        return handleErrorResponse(res, err);
    } 
};


// Items stored in item_vs_pm table
exports.searchItems = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;

        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT DISTINCT 
             items.id, items.itemCode as label 
            FROM items 
            INNER JOIN 
              po_generate  ON po_generate.itemName = items.id
            WHERE items.dflag = 0
        `;

        const values = [];


        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` AND (items.itemCode LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
        }

        // Add ORDER BY clause to sort the results with item codes containing special characters last
        fetch += ` ORDER BY CASE WHEN items.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, items.itemCode LIMIT 100`;

        const [rows, fields] = await connection.execute(fetch, values);


        return res.status(200).json({ success: true, message: "Items", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}






exports.report = async (req, res) => {
    try {
        const repo = req.body;

        const { from, to, supplier, items, itmGrp, type } = repo;

        // SQL Query
        let query = `
            SELECT 
                po_main.id AS poMainId, po_main.poNo, po_main.poType, po_main.refNoDate, 
                DATE_FORMAT(po_main.date, '%d-%m-%Y') AS poDate,
                pOg.id AS poGenId, pOg.rate, pOg.poQty, pOg.rcvdQty, pOg.suppDesc, 
                pOg.cumQty, pOg.amt, 
                DATE_FORMAT(pOg.schDate, '%d-%m-%Y') AS schDate, pOg.pendingPo,
                itm.itemCode, itm.itemName, itm.stdRate, itm.id AS itemId, 
                itmGrp.name AS itemGroup, uomTab.name AS uomName, 
                sup.spName, sup.spCode, sup.gstNo, sup.id AS supplierId
                ${type === 0 ? `,
                po_bill.suppInvNo, DATE_FORMAT(po_bill.suppInvoiceDate, '%d-%m-%Y') AS suppInvoiceDate,
                po_bill.csSuppDcNo, DATE_FORMAT(po_bill.suppDcDate, '%d-%m-%Y') AS suppDcDate` : ''}
            FROM po_main
            RIGHT JOIN po_generate AS pOg 
                ON po_main.poNo = pOg.poNo
            INNER JOIN supplier AS sup ON po_main.spName = sup.id
            INNER JOIN items AS itm ON pOg.itemName = itm.id
            INNER JOIN mst_uom AS uomTab ON itm.uom = uomTab.id
            INNER JOIN mst_item_group AS itmGrp ON itmGrp.id = itm.itemGroup
            LEFT JOIN po_bill ON po_main.id = po_bill.poMainId
            WHERE po_main.dflag = 0 AND pOg.dflag = 0
            ${type === 1 ? ' AND pOg.pendingPo > 0' : ''}  
        `;


        const queryParams = [];
        const conditions = [];

        // Filters
        if (from && to) {
            conditions.push('DATE(po_main.created_at) BETWEEN ? AND ?');
            queryParams.push(from, to);
        }

        if (Array.isArray(supplier) && supplier.length > 0) {
            conditions.push(`sup.id IN (${supplier.map(() => '?').join(', ')})`);
            queryParams.push(...supplier);
        }

        if (Array.isArray(items) && items.length > 0) {
            conditions.push(`itm.id IN (${items.map(() => '?').join(', ')})`);
            queryParams.push(...items);
        }

        if (Array.isArray(itmGrp) && itmGrp.length > 0) {
            conditions.push(`itmGrp.id IN (${itmGrp.map(() => '?').join(', ')})`);
            queryParams.push(...itmGrp);
        }

        if (conditions.length > 0) {
            query += ' AND ' + conditions.join(' AND ');
        }

        query += ' GROUP BY pOg.id';

        const [rows] = await connection.execute(query, queryParams);

        // Group rows by supplier
        const groupedData = {};

        rows.forEach(row => {
            if (!groupedData[row.supplierId]) {
                groupedData[row.supplierId] = {
                    supplierId: row.supplierId,
                    spName: row.spName,
                    spCode: row.spCode,
                    gst: row.gstNo,
                    po: []
                };
            }

            let supplierGroup = groupedData[row.supplierId];

            let poGroup = supplierGroup.po.find(po => po.poNo === row.poNo);
            if (!poGroup) {
                poGroup = {
                    poNo: row.poNo,
                    poType: row.poType,
                    poDate: row.poDate,
                    items: []
                };
                supplierGroup.po.push(poGroup);
            }

            const itemData = {
                id: poGroup.items.length + 1,
                poGenId: row.poGenId,
                itemGroup: row.itemGroup,
                itemId: row.itemId,
                itemCode: row.itemCode,
                itemName: row.itemName,
                suppDesc: row.suppDesc,
                schDate: row.schDate,
                uom: row.uomName,
                unitRate: row.rate,
                qty: row.poQty,
                pbCumQty: row.cumQty,
                recptQty: row.rcvdQty,
                pendingPo: row.pendingPo,
                rate: row.rate,
                amt: row.amt,
                dateDiff: null
            };

            if (type === 0) {
                itemData.suppInvNo = row.suppInvNo;
                itemData.suppInvoiceDate = row.suppInvoiceDate;
                itemData.suppDcNo = row.csSuppDcNo;
                itemData.suppDcDate = row.suppDcDate;
            }

            poGroup.items.push(itemData);
        });

        const result = Object.values(groupedData);

        return res.status(200).json({
            success: true,
            message: "Po list",
            data: result
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "An error occurred",
            error: err.message
        });
    }
};



exports.searchPo = async (req, res) => {
    try {
        const { type, q } = req.query;
        const { fyFrom, fyTo } = formatFinancialYears(req);

        if (!fyFrom || !fyTo) {
            return res.status(400).json({ success: false, message: "Missing financial year range (fyfrom, fyto)" });
        }

        let table, digitColumn, poNoColumn, typeColumn;

        switch (type) {
            case "poOrder":
                table = "po_main";
                digitColumn = "digit";
                poNoColumn = "poNo";
                typeColumn = "type";
                break;
            case "poBill":
                table = "po_bill";
                digitColumn = "digit";
                poNoColumn = "poNo";
                typeColumn = "type";
                break;
            case "withoutPoBill":
                table = "pob_wo_po";
                digitColumn = "digit";
                poNoColumn = "poNo";
                typeColumn = "type";
                break;
            case "poFc":
                table = "po_forecast";
                digitColumn = "uniqueDigit AS digit";
                poNoColumn = "uniqueId";
                typeColumn = "supId";
                break;
            default:
                return res.status(400).json({ success: false, message: "Invalid type parameter" });
        }

        let fetch = `SELECT id, ${digitColumn}, ${poNoColumn}, ${typeColumn} FROM ${table}`;
        const whereConditions = [];
        const values = [];

        // Optional search query
        if (q) {
            if (type === "poFc") {
                whereConditions.push(`uniqueDigit LIKE ?`);
            } else {
                whereConditions.push(`digit LIKE ?`);
            }
            values.push(`%${q}%`);
        }

        // Financial year condition
        whereConditions.push(`DATE(${table}.created_at) > ?`);
        values.push(fyFrom);
        whereConditions.push(`DATE(${table}.created_at) < ?`);
        values.push(fyTo);

        if (whereConditions.length > 0) {
            fetch += " WHERE " + whereConditions.join(" AND ");
        }

        const [rows] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "PO", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: "Internal server error",
            error: err.message
        });
    }
};

exports.shortClose2 = async (req, res) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "No items provided in the payload" });
    }

    // Ensure items are valid
    const validItems = items.filter((item) => item != null && item !== "");

    if (validItems.length === 0) {
        return res.status(400).json({ error: "Invalid items provided in the payload" });
    }

    try {
        const shortClosedUser = req.body.shortClosedBy;
        const shortCloseDate = req.body.shortClosedDate;

        // Prepare SQL placeholders
        const placeholders = validItems.map(() => "?").join(",");

        // Fetch po_generate rows for validItems
        const fetchPoGenerateQuery = `
            SELECT id, itemName, poQty 
            FROM po_generate 
            WHERE id IN (${placeholders})
        `;

        const [poGenerateRows] = await connection.execute(fetchPoGenerateQuery, validItems);

        if (poGenerateRows.length === 0) {
            return res.status(400).json({ error: "No matching records found in po_generate" });
        }

        // Update po_generate table
        const updateGenerateQuery = `
            UPDATE po_generate 
            SET dflag = ?, shortClosedBy = ?, shortClosedDate = ? 
            WHERE id IN (${placeholders})
        `;
        const updateParams = [1, shortClosedUser, shortCloseDate, ...validItems];

        // Execute update for po_generate
        await connection.execute(updateGenerateQuery, updateParams);

        // Update items table by reducing poQty
        for (const row of poGenerateRows) {
            const updateItemsQuery = `
                UPDATE items 
                SET poQty = GREATEST(0, poQty - ?) 
                WHERE id = ?
            `;
            await connection.execute(updateItemsQuery, [row.poQty, row.itemName]);
        }

        return handleSuccessResponse(res, "ShortClosed Successfully");
    } catch (err) {
        console.error("Error in shortClose:", err);
        return handleErrorResponse(res, err);
    }
};



exports.shortClose = async (req, res) => {
    const { items, shortClosedBy, shortClosedDate } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "No items provided in the payload" });
    }

    try {
        // Filter items with valid IDs
        const validItems = items.filter(item => item.id != null);
        if (validItems.length === 0) {
            return res.status(400).json({ error: "Invalid items provided in the payload" });
        }

        const placeholders = validItems.map(() => "?").join(",");
        const itemIds = validItems.map(item => item.id);

        // Fetch matching po_generate rows
        const fetchPoGenerateQuery = `
            SELECT id, itemName, poQty 
            FROM po_generate 
            WHERE id IN (${placeholders})
        `;
        const [poGenerateRows] = await connection.execute(fetchPoGenerateQuery, itemIds);

        if (poGenerateRows.length === 0) {
            return res.status(400).json({ error: "No matching records found in po_generate" });
        }

        // Update po_generate records based on status
        for (const item of validItems) {
            const updateGenerateQuery = `
                UPDATE po_generate 
                SET dflag = ?, 
                    shortClosedBy = ?, 
                    shortClosedDate = ? 
                WHERE id = ?
            `;

            const updateValues = item.status
                ? [item.status, shortClosedBy, shortClosedDate, item.id]
                : [item.status, null, null, item.id]; // Set NULLs when status is false

            await connection.execute(updateGenerateQuery, updateValues);
        }

        // Update items table poQty (+ or - based on status)
        for (const row of poGenerateRows) {
            const matchedItem = validItems.find(item => item.id === row.id);
            if (!matchedItem) continue;

            const updateItemsQuery = `
                UPDATE items 
                SET poQty = GREATEST(0, poQty ${matchedItem.status ? '-' : '+'} ?) 
                WHERE id = ?
            `;

            await connection.execute(updateItemsQuery, [row.poQty, row.itemName]);
        }

        return handleSuccessResponse(res, "ShortClose status updated successfully");
    } catch (err) {
        console.error("Error in shortClose:", err);
        return handleErrorResponse(res, err);
    }
};


exports.shortClosedRepo = async (req, res) => {
    try {
        const { fromDate: fromDate, toDate: toDate, supplier: sup, type } = req.body;

        // Base query
        let query = `
            SELECT 
                pOg.id, pOg.poNo, pOg.id, pOg.poNo, pOg.poQty, 
                pOg.shortClosedBy, pOg.shortClosedDate, pOg.refNoDate, pOg.rate,
                DATE_FORMAT(pOg.date, '%d-%m-%Y') AS poDate, pOg.dflag,
                itm.itemCode,  itm.itemName, itm.id AS itemId, pOg.pendingPo,
                uomTab.name AS uomName, sup.spName, sup.spCode
            FROM 
                po_generate AS pOg 
            INNER JOIN 
                supplier AS sup ON pOg.spName = sup.id
            INNER JOIN 
                items AS itm ON pOg.itemName = itm.id
            INNER JOIN
                mst_uom AS uomTab ON pOg.uom = uomTab.id
        
        `;

        // Collect conditions
        const queryParams = [];
        const conditions = [];

        // Build query conditions
        if (type == 0) {       // take also " " value
            conditions.push('pOg.pendingPo > 0 AND pOg.dflag = 0');
            //console.log("sucess")
        }

        if (type == 1) {       // take also " " value
            conditions.push('pOg.pendingPo > 0');
        }

        if (fromDate && toDate) {
            conditions.push('DATE(pOg.date) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(sup) && sup.length > 0) {
            conditions.push(`sup.id IN (${sup.map(() => '?').join(', ')})`);
            queryParams.push(...sup);
        }

        // Add conditions to the query
        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        // Execute the query
        const [rows] = await connection.execute(query, queryParams);

        // Transform rows to display `dflag` as true/false
        const transformedRows = rows.map((row) => ({
            ...row,
            selected: row.dflag === 1, // Convert `dflag` to true/false
        }));

        return res.status(200).json({
            success: true,
            message: "Po list",
            data: transformedRows,
        });
    } catch (err) {
        console.error("Error in shortClosedRepo:", err); // Log error for debugging
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "An error occurred" });
    }
};


// exports.pendingJW = async (req, res) => {
//     try {
//         const { supplierId } = req.query;

//         let query = `
//             SELECT 
//                 jid.id, jid.id as jobWorkId, supp_vs_item.suppDesc, supp_vs_item.rate, sup.spCode, sup.spName AS suppName, sup.id AS supId,
//                 CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress, sup.paymentTerms, sup.gstNo, 
//                 supCon.department, cur.name AS currency, cur.id AS currencyId, itm.itemName AS itemName, itm.id AS itemId, 
//                 itm.minStockLvl, itm.maxLvl, itm.itemCode, itm.totStk, jid.Qty as jwQty, itm.poQty AS pendingPo, uomTab.name AS uom, 
//                 uomTab.id AS uomId, jid.Qty as poQty
//             FROM 
//                 supp_vs_item
//             INNER JOIN 
//                 supplier AS sup ON supp_vs_item.spName = sup.id
//             LEFT JOIN  
//                 sup_con_person AS supCon ON sup.sId = supCon.sId
//             INNER JOIN 
//                 mst_currency AS cur ON sup.currency = cur.id
//             INNER JOIN 
//                 items AS itm ON supp_vs_item.itemName = itm.id
//             INNER JOIN 
//                 mst_uom AS uomTab ON itm.uom = uomTab.id
//             INNER JOIN 
//                 jobwork_issue_details AS jid ON jid.itemId = itm.id
//             WHERE 
//                 supp_vs_item.dflag = 0 AND jid.dc_close = 0
//         `;
//         let values = [];

//         if (supplierId) {
//             query += `  AND sup.id = ?`;
//             values.push(supplierId);
//         }

//         const [rows] = await connection.execute(query, values);


//         rows.forEach((row, index) => {
//             row.uniqueFId = index + 1;
//             row.select = false;
//         });


//         return res.status(200).json({ success: true, message: "Item lists retrieved successfully.", data: rows });
//     } catch (err) {
//         //console.log(err)
//         return res.status(500).json({ success: false, message: 'An internal server error occurred.', error: err.message });
//     }
// };

exports.pendingJW = async (req, res) => {
    try {
        const { supplierId } = req.query;

        let query = `
            SELECT 
                jid.id, jid.id as jobWorkId, si.rate, sup.spCode, sup.spName AS suppName, sup.id AS supId,
                CONCAT_WS(' ', sup.spAdd1, sup.spAdd2, sup.spAdd3, sup.spAdd4) AS spAddress, sup.paymentTerms, sup.gstNo, 
                supCon.department, cur.name AS currency, cur.id AS currencyId, itm.itemName AS itemName, itm.id AS itemId, 
                itm.minStockLvl, itm.maxLvl, itm.itemCode, itm.totStk, jid.Qty as jwQty, itm.poQty AS pendingPo, uomTab.name AS uom, 
                uomTab.id AS uomId, jid.Qty as poQty, COALESCE(si.suppDesc, itm.itemName) AS suppDesc
            FROM jobwork_issue jw
            INNER JOIN jobwork_issue_details jid ON jid.jobWorkId = jw.id
            LEFT JOIN supp_vs_item si ON jid.itemId = si.itemName AND jw.supplierId = si.spName
            INNER JOIN supplier AS sup ON jw.supplierId = sup.id
            LEFT JOIN sup_con_person AS supCon ON sup.sId = supCon.sId
            LEFT JOIN mst_currency AS cur ON sup.currency = cur.id
            INNER JOIN items AS itm ON jid.itemId = itm.id
            LEFT JOIN mst_uom AS uomTab ON itm.uom = uomTab.id
            WHERE jid.dc_close = 0
        `;
        let values = [];

        if (supplierId) {
            query += `  AND jw.supplierId = ?`;
            values.push(supplierId);
        }
        const [rows] = await connection.execute(query, values);

        rows.forEach((row) => {
            row.uniqueFId = `${Date.now()}-${uuidv4()}`;
            row.select = false;
        });

        return res.status(200).json({ success: true, message: "Item lists retrieved successfully.", data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'An internal server error occurred.', error: err.message });
    }
};

// const updateJWItems = async (conn, items) => {
//     try {
//         const jwIds = items.map(item => item.jobWorkId).filter(id => (id != '' && id != undefined && id != null));
//         if (jwIds.length > 0) {
//             const updateJWQuery = `UPDATE jobwork_issue_details SET dc_close = ? WHERE id IN (${jwIds.map(() => '?').join(',')})`;
//             await conn.execute(updateJWQuery, [1, ...jwIds]);
//         }
//         return true;
//     } catch (err) {
//         throw err;
//     }
// }

const updateJWItems = async (conn, items) => {
    try {
        const jwIds = items
            .map(item => item.jobWorkId)
            .filter(id => (id !== '' && id !== undefined && id !== null));

        if (jwIds.length > 0) {
            const updateJWQuery = `
                UPDATE jobwork_issue_details 
                SET dc_close = 1 
                WHERE id IN (${jwIds.map(() => '?').join(',')})
            `;
            await conn.execute(updateJWQuery, jwIds);
        }

        return true;
    } catch (err) {
        throw err;
    }
};

exports.purchaseVsReceiept = async (req, res) => {
    try {
        const repo = req.body;

        // Ensure dates are in the correct format and include time
        const fromDate = repo.from;
        const toDate = repo.to;
        const sup = repo.supplier; // Expecting an array like [1, 2, 3]


        let query = `   
            SELECT 
                po.id AS poMainId, po.poNo, po.poType, DATE_FORMAT(po.date, '%d-%m-%Y') AS poDate,
                pOg.id AS poGenId, pOg.rate, pOg.poQty, pOg.rcvdQty, sup.spCode, sup.spName,
                ROUND((pOg.rcvdQty / pOg.poQty) * 100, 2) AS percentage,
                itm.itemCode, itm.itemName, itm.id AS itemId, itmGrp.name AS itemGroup,
                uomTab.name AS uomName, loc.name As location
               
            FROM po_generate pOg
                RIGHT JOIN po_main AS po ON po.poNo = pOg.poNo
                INNER JOIN supplier AS sup ON po.spName = sup.id
                INNER JOIN items AS itm ON pOg.itemName = itm.id
                INNER JOIN mst_uom AS uomTab ON pOg.uom = uomTab.id
                INNER JOIN mst_item_group AS itmGrp ON itmGrp.id = itm.itemGroup
                LEFT JOIN item_main_loc AS loc ON loc.id = itm.mainLocation

            WHERE po.dflag = 0 
        `;


        // Collect conditions
        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(pOg.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(sup) && sup.length > 0) {
            conditions.push(`sup.id IN (${sup.map(() => '?').join(', ')})`);
            queryParams.push(...sup);
        }

        if (conditions.length) {
            query += ' AND ' + conditions.join(' AND ');
        }

        // Execute the query
        const [rows] = await connection.execute(query, queryParams);


        if (rows.length >= 0) {
            rows.forEach((row, index) => {
                row.sNo = index + 1;

            });
        }

        return res.status(200).json({
            success: true,
            message: "Purchase Vs Receiept list",
            data: rows
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};


exports.authorization = async (req, res) => {
    try {
        const repo = req.body;
        const { from, to, supplier, items, category } = repo;

        let query = `
            SELECT 
                pog.id,  ad.id As authId,  ad.first_lvl_auth,  ad.firstAuthBy, ad.second_lvl_auth, ad.secondAuthBy, po_main.id AS poMainId, po_main.poNo, po_main.poType, 
                DATE_FORMAT(po_main.date, '%d-%m-%Y') AS poDate, pog.id AS poGenId,
                pog.poQty, pog.suppDesc, pog.cumQty, pog.pendingPo, DATE_FORMAT(pog.schDate, '%d-%m-%Y') AS schDate,
                itm.itemCode, itm.itemName, itm.stdRate, itm.id AS itemId, uomTab.name AS uomName,
                sup.spName, sup.spCode, sup.gstNo, sup.id AS supplierId,
                po_bill.suppInvNo, po_bill.suppInvoiceDate, po_bill.csSuppDcNo, po_bill.suppDcDate
            FROM po_generate pog
            INNER JOIN po_main ON po_main.poNo = pog.poNo
            LEFT JOIN auth_docs ad ON ad.refNo = po_main.poNo
            INNER JOIN supplier AS sup ON po_main.spName = sup.id
            INNER JOIN items AS itm ON pog.itemName = itm.id
            INNER JOIN mst_uom AS uomTab ON pog.uom = uomTab.id
            LEFT JOIN po_bill ON po_main.id = po_bill.poMainId
            WHERE 
                (ad.id IS NULL OR ad.docType = "PO")
                AND po_main.dflag = 0 
                AND pog.dflag = 0
        `;

        const queryParams = [];
        const conditions = [];

        // if (from && to) {
        //     conditions.push('DATE(ad.created_at) BETWEEN ? AND ?');
        //     queryParams.push(from, to);
        // }

        if (from && to) {
            conditions.push(`(
                (ad.id IS NOT NULL AND DATE(ad.created_at) BETWEEN ? AND ?)
                OR
                (ad.id IS NULL AND DATE(po_main.date) BETWEEN ? AND ?)
            )`);
            queryParams.push(from, to, from, to);
        }

        if (Array.isArray(supplier) && supplier.length > 0) {
            conditions.push(`sup.id IN (${supplier.map(() => '?').join(', ')})`);
            queryParams.push(...supplier);
        }

        if (Array.isArray(items) && items.length > 0) {
            conditions.push(`itm.id IN (${items.map(() => '?').join(', ')})`);
            queryParams.push(...items);
        }

        if (category === 2 || category === 3) {
            // //console.log("2nd")
            conditions.push(`po_main.firstAuth = 0`);
        }

        if (category === 4) {
            conditions.push(`po_main.firstAuth = 1 AND po_main.authorized = 0`);
        }

        if (conditions.length) {
            query += ' AND ' + conditions.join(' AND ');
        }

        query += ' GROUP BY pog.id';

        const [rows] = await connection.execute(query, queryParams);

        return handleSuccessResponse(res, 'PO list', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};






exports.purchaseDeliveryRate = async (req, res) => {
    try {
        const repo = req.body;
        const fromDate = repo.fromDate;
        const toDate = repo.toDate;
        const sup = repo.suppliers;

        // Ensure dates are provided
        if (!fromDate || !toDate) {
            return res.status(400).json({
                success: false,
                message: "fromDate and toDate are required"
            });
        }

        //  Call stored procedure
        const [resultSets] = await connection.query(
            `CALL get_purchase_delivery_rate(?, ?)`,
            [fromDate, toDate]
        );

        // MySQL returns result sets inside an array
        let rows = resultSets[0] || [];

        // Optional: filter by supplier list after procedure call
        if (Array.isArray(sup) && sup.length > 0) {
            rows = rows.filter(row => sup.includes(row.id));
        }

        // Add serial numbers
        if (rows.length > 0) {
            rows.forEach((row, index) => {
                row.sNo = index + 1;
            });
        }

        return res.status(200).json({
            success: true,
            message: "Purchase Delivery Rate list (from procedure)",
            data: rows
        });

    } catch (err) {
        console.error("Error in DeliveryRate:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred while fetching data'
        });
    }
};


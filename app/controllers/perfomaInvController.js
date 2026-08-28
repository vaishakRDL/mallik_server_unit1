const { handleErrorResponse, handleSuccessResponse, connection, CustomError } = require("../config/dbSql");
const { getUser, company } = require("../utility/utilityFunction");
const { generateDocNo, updateDocCounter, docNoReset } = require("../utility/docNo");
const { ToWords } = require('to-words');


exports.uniqueId = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const { po: customValue } = req.body;

    const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'PerformaInvoice', customValue });

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


exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const data = req.body;

        const m = data.commonData;
        const d = data.dtlData;
        const createdBy = await getUser(req);

        const [rows] = await conn.execute(
            `INSERT INTO perfoma_invoice (invSt, invCode, invNo, date, custId, billAdd, shipAdd, subTotal, frightCharges, remarks, cgstPer, cgst, sgstPer, sgst, 
            igstPer, igst, totalValue, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

            [m.invSt, m.invCode, m.invNo, m.date, m.custId, m.billAdd, m.shipAdd, m.subTotal, m.frightCharges, m.remarks, m.cgstPer, m.cgst, m.sgstPer, m.sgst,
            m.igstPer, m.igst, m.totalValue, createdBy]
        );

        if (rows.affectedRows < 1) throw new CustomError(`Insertion failed!`, 400);

        const insertId = rows.insertId;

        const dtlQuery = `
            INSERT INTO perfoma_invoice_dtl  (performaId, itemId, uom,  hsnCode, qty, rate, amt) VALUES ?
        `;

        const values = d.map(i => [
            insertId, i.itemId, i.uom, i.hsnCode, i.qty, i.rate, i.amt
        ]);

        await conn.query(dtlQuery, [values]);
        await updateDocCounter(conn, 'PerformaInvoice');

        await conn.commit();

        return handleSuccessResponse(res, 'Successful');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.update = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const data = req.body;
        const m = data.commonData;
        const d = data.dtlData;
        const invoiceId = m.id; // Assuming ID is passed in commonData
        const updatedBy = await getUser(req);

        // Update main invoice details
        const [updateMain] = await conn.execute(
            `UPDATE perfoma_invoice 
            SET  custId = ?, billAdd = ?, shipAdd = ?, subTotal = ?, frightCharges = ?, remarks = ?, cgstPer = ?, cgst = ?, 
                sgstPer = ?, sgst = ?, igstPer = ?, igst = ?, totalValue = ?, updatedBy = ?
            WHERE id = ?`,

            [m.custId, m.billAdd, m.shipAdd,  m.subTotal, m.frightCharges, m.remarks, m.cgstPer, m.cgst, m.sgstPer, m.sgst,
            m.igstPer, m.igst, m.totalValue, updatedBy, invoiceId]
        );

        if (updateMain.affectedRows < 1) throw new CustomError(`Update failed!`, 400);

        // Update existing details data based on d.id
        for (const item of d) {
            await conn.execute(
                `UPDATE perfoma_invoice_dtl 
                SET itemId = ?, uom = ?, hsnCode = ?, qty = ?, rate = ?, amt = ?
                WHERE id = ? AND performaId = ?`,
                [item.itemId, item.uom, item.hsnCode, item.qty, item.rate, item.amt, item.id, invoiceId]
            );
        }

        await conn.commit();

        return handleSuccessResponse(res, 'Update successful');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};




exports.getItems = async (req, res) => {
    try {
        const { type, id } = req.query;

        // Query for purchase_order
        let po = `
            SELECT po.*, c.cCode, c.cName, c.cId, 
            DATE_FORMAT(po.date, '%d-%m-%Y') as date
            FROM 
            perfoma_invoice po
            INNER JOIN customer c ON c.id = po.custId`;

        let params = [];

        // Query for purchas_Order_item
        let poItems = `
            SELECT poDtl.*,  i.itemCode, i.itemName
            FROM perfoma_invoice_dtl poDtl 
            INNER JOIN items i ON i.id = poDtl.itemId
            WHERE poDtl.dflag = 0`;

        let params2 = [];

        // Modify queries based on type
        switch (type) {
            case 'first':
                po += ` ORDER BY po.id ASC LIMIT 1`;
                break;
            case 'last':
                po += ` ORDER BY po.id DESC LIMIT 1`;
                break;
            case 'forward':
                po += ` WHERE po.id > ? ORDER BY po.id ASC LIMIT 1`;
                params = [id];
                break;
            case 'reverse':
                po += ` WHERE po.id < ? ORDER BY po.id DESC LIMIT 1`;
                params = [id];
                break;
        }

        // Execute the first query
        const [rows] = await connection.execute(po, params);

        // If no matching purchase_order is found, return an empty object for invoice
        if (rows.length === 0) {
            return res.status(200).json({
                success: true,
                data: {
                    invoice: {}, // Empty object
                    items: [],
                },
            });
        }

        // Extract the matching id from the first query
        const invoice = rows[0]; // Use the first result as the object

        // Add a condition to the second query to filter by the matching id
        poItems += ` AND poDtl.performaId = ?`;
        params2 = [invoice.id];

        // Execute the second query
        const [rows2] = await connection.execute(poItems, params2);

        // Return the filtered results within the main data object
        return res.status(200).json({
            success: true,
            data: {
                invoice, // Use the object directly
                items: rows2, // Items remain as an array
            },
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'An error occurred',
        });
    }
};

// Assuming you have required necessary modules and set up SQL connection (`connection`)
exports.invShow = async (req, res) => {
    try {
        const invoiceId = req.params.id;

        const companyData = await company();

        const mainQuery = `
            SELECT 
                po.*, 
                c.cCode, 
                c.cName, 
                c.cId, 
                c.gstNo, 
                c.panNo, 
                c.id AS custId,
                sp.name AS placeSupply, 
                DATE_FORMAT(po.date, '%d-%m-%Y') AS date
            FROM perfoma_invoice po
            INNER JOIN customer c ON c.id = po.custId
            LEFT JOIN mst_sup_place sp ON sp.id = c.placeOfSupply
            WHERE po.id = ? 
        `;

        const dtlQuery = `
            SELECT 
                poDtl.*, 
                i.itemCode, 
                i.itemName,
                ul.name As itemLedger,
                hsn.description As hsnDesc
            FROM perfoma_invoice_dtl poDtl 
            INNER JOIN items i ON i.id = poDtl.itemId
            INNER JOIN cust_vs_item cvi 
                ON cvi.itemId = poDtl.itemId 
               AND cvi.customerId = ?
            INNER JOIN item_under_ledger ul ON ul.id = cvi.underLedger
            LEFT JOIN item_hsn_code hsn ON hsn.name = poDtl.hsnCode
            WHERE poDtl.dflag = 0 
              AND poDtl.performaId = ?
        `;

        // Fetch invoice data
        const [invoiceRows] = await connection.query(mainQuery, [invoiceId]);

        if (invoiceRows.length === 0) {
            return res.status(404).json({ success: false, message: "Invoice not found" });
        }

        const toWords = new ToWords({
            localeCode: 'en-IN',       // Indian numbering system (Lakhs, Crores)
            converterOptions: {
                ignoreDecimal: true
            }
        });

        const invoiceData = invoiceRows[0]; // get first row

        // Fetch item details
        const [itemsData] = await connection.query(dtlQuery, [invoiceData.custId, invoiceId]);

        const totalQty = itemsData.reduce((sum, item) => sum + Number(item.qty || 0), 0);
        // Add to invoice object
        invoiceData.totQty = totalQty;

        // Add itemLedger only if it exists in your schema (currently not in SELECT)
        invoiceData.itemLedger = itemsData.length > 0 && itemsData[0].itemLedger ? itemsData[0].itemLedger : null;
        invoiceData.hsnDesc = itemsData.length > 0 && itemsData[0].hsnDesc ? itemsData[0].hsnDesc : null;

        // Convert number to words
        let amount = Number(invoiceData.totalValue || 0);
        invoiceData.totalValueInWords = toWords.convert(amount);

        if (companyData) {
            Object.assign(invoiceData, companyData);
        }

        return res.status(200).json({
            success: true,
            data: {
                invoice: invoiceData,
                items: itemsData
            }
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err.message || "An error occurred"
        });
    }
};




exports.delete = async (req, res) => {
    try {

        const id = req.params.id;

        const [rows] = await connection.execute(`
            DELETE from perfoma_invoice WHERE id = ? `, [id]
        );

        return handleSuccessResponse(res, 'Deleted Sucessfully');
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}

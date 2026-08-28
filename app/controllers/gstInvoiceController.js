const { handleErrorResponse, handleSuccessResponse, connection, CustomError } = require("../config/dbSql");
const excel = require("exceljs");
const { company, getUser } = require("../utility/utilityFunction");
const utility = require('../utility/utilityFunction');
const { toWords } = require('number-to-words');
const { generateDocNo, updateDocCounter, docNoReset } = require("../utility/docNo");
const { getFYRange } = require("../../cache/fyRange.cache");
require("dotenv").config();

exports.uniqueId = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const { po: customValue } = req.body;

    const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'GSTSalesinvoice', customValue });

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





exports.search = async (req, res) => {
  try {
    const { q, type: typeQuery } = req.query;
    const id = req.params.id;

    const type = typeQuery === "Others" ? 1 : 0;

    let sqlQuery = `
      SELECT DISTINCT 
        items.id,
        items.itemCode AS label
      FROM items
      JOIN purchas_order_item AS po 
        ON po.PartNo = items.itemCode
      JOIN purchase_order 
        ON purchase_order.id = po.purchase_order_id
      WHERE po.isShortCls = 0
        AND po.pendQty > 0
        AND purchase_order.customer = ?
        AND purchase_order.isVerbal = ?
    `;

    const values = [id, type];

    if (q) {
      sqlQuery += ` AND items.itemCode LIKE ? `;
      values.push(`${q}%`);
    }

    sqlQuery += ` LIMIT 20`;

    const [rows] = await connection.execute(sqlQuery, values);

    return handleSuccessResponse(res, 'Items', rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};



exports.getCustomer = async (req, res) => {
  try {
    const { q } = req.query;

    let sqlQuery = `
      SELECT DISTINCT 
        c.cName, c.id, c.cId, c.cCode, c.maxLineItem
      FROM purchase_order
      INNER JOIN customer AS c 
        ON c.cId = purchase_order.customer
    `;

    const values = [];

    if (q) {
      sqlQuery += ` WHERE c.cCode LIKE ? `;
      values.push(`${q}%`);
    }

    sqlQuery += ` LIMIT 20`;

    const [rows] = await connection.execute(sqlQuery, values);

    return handleSuccessResponse(res, 'Customers', rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.showaddress = async (req, res) => {
  try {
    const id = req.params.id;

    const sqlQuery = `
      SELECT 
        TRIM(CONCAT(
          COALESCE(c.cAddress1, ''), ' ',
          COALESCE(c.cAddress2, ''), ' ',
          COALESCE(c.cAddress3, ''), ' ',
          COALESCE(c.cAddress4, '')
        )) AS cAddress, 
        c.payTerm, c.id, c.cId, c.gstNo, c.city, c.pincode, c.state, c.maxLineItem,
        c.country, c.panNo, c.email, c.cName, c.cgst, c.sgst, c.igst, c.utgst,
        c.tcsCollected, c.SubcharOnTcs, c.CessOnTcs,
        LEFT(c.gstNo, 2) AS stateCode
      FROM customer c
      WHERE c.cId = ?
    `;

    const [rows] = await connection.execute(sqlQuery, [id]);

    return handleSuccessResponse(res, 'Customer address list', rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.updateGSTSalesInvoice = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    const id = req.params.id;
    const user = req.headers.username;
    const action = 'Update';

    const { gstOrderData: gst, gstOrderItemData: variableData } = req.body;

    await conn.beginTransaction();

    /* ---------------- UPDATE gstsalesinvo (MASTER) ---------------- */
    const updateGSTSalesInvoiceQuery = `
      UPDATE gstsalesinvo SET
        date = ?, billAdd = ?, invoIssuDate = ?, dcNO = ?, dcDate = ?, modelOfDis = ?,
        vechileNO = ?, custPoNo = ?, gstNo = ?, panNo = ?, trType = ?, modeOfType = ?,
        docketNo = ?, traDate = ?, transporter = ?, TransporterGSTIN = ?, distKms = ?,
        shipPincode = ?, stateCode = ?, actualToState = ?, goodsOrService = ?,
        labourCharge = ?, labourCrgesHdingReqed = ?, reverseCharge = ?,
        supplyTypeCode = ?, dispatchFrom = ?, resonForNoTax = ?, resonForNoduty = ?,
        remrk1 = ?, remrk2 = ?, remrk3 = ?, remrk4 = ?, remrk5 = ?, dcDetails = ?,
        dutyInwords = ?, totalInWords = ?, totalQty = ?, taxableValueforGST = ?,
        lessDisc = ?, lessOther = ?, subTotAfterDisc = ?, packingForw = ?,
        transportCharges = ?, subtotal = ?, Insurance = ?, custMeterialValue = ?,
        AmmortisationCost = ?, amtOfGstPay = ?, CGST = ?, CGSTPer = ?,
        SGST = ?, SGSTPer = ?, IGST = ?, IGSTPer = ?, UTGST = ?, UTGSTPer = ?,
        totGst = ?, tcs = ?, tcsPer = ?, subChargeOnTcs = ?, subChargeOnTcsPer = ?,
        cessOnTcs = ?, cessOnTcsPer = ?, totalValue = ?, roundOff = ?, invValue = ?
      WHERE id = ?
    `;

    await conn.execute(updateGSTSalesInvoiceQuery, [
      gst.date, gst.billAdd, gst.invoIssuDate, gst.dcNO, gst.dcDate, gst.modelOfDis, gst.vechileNO, gst.custPoNo, gst.gstNo, gst.panNo, gst.trType, gst.modeOfType,
      gst.docketNo, gst.traDate, gst.transporter, gst.TransporterGSTIN, gst.distKms, gst.shipPincode, gst.stateCode, gst.actualToState, gst.goodsOrService, gst.labourCharge,
      gst.labourCrgesHdingReqed, gst.reverseCharge, gst.supplyTypeCode, gst.dispatchFrom, gst.resonForNoTax, gst.resonForNoduty, gst.remrk1, gst.remrk2, gst.remrk3, gst.remrk4, gst.remrk5,
      gst.dcDetails, gst.dutyInwords, gst.totalInWords, gst.totalQty, gst.taxableValueforGST, gst.lessDisc, gst.lessOther, gst.subTotAfterDisc, gst.packingForw, gst.transportCharges,
      gst.subtotal, gst.Insurance, gst.custMeterialValue, gst.AmmortisationCost, gst.amtOfGstPay, gst.CGST, gst.CGSTPer, gst.SGST, gst.SGSTPer, gst.IGST, gst.IGSTPer, gst.UTGST,
      gst.UTGSTPer, gst.totGst, gst.tcs, gst.tcsPer, gst.subChargeOnTcs, gst.subChargeOnTcsPer, gst.cessOnTcs, gst.cessOnTcsPer, gst.totalValue, gst.roundOff, gst.invValue, id
    ]);

    /* ---------------- UPDATE gstsalesinvoItem (DETAILS) ---------------- */
    const updateItemQuery = `
      UPDATE gstsalesinvoItem SET
        partNo = ?, partName = ?, uom = ?, soNo = ?, soQty = ?, cumQty = ?,
        pendQty = ?, hsnCode = ?, schDate = ?, invQty = ?, invRate = ?,
        invAmt = ?, descOfPackage = ?
      WHERE id = ?
    `;

    for (const item of variableData) {
      await conn.execute(updateItemQuery, [
        item.itemCode, item.itemName, item.uom, item.soNo, item.Qty, item.cumQty, item.pendQty, item.hsnCode, item.schDate, item.invQty, item.stdRate,
        item.amt, item.descOfPackage, item.id
      ]);
    }

    /* ---------------- AUDIT LOG ---------------- */
    await logGSTSalesInvoice({ conn, invoiceId: id, user, action });

    await conn.commit();

    return handleSuccessResponse(res, 'Successfully Updated');

  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


async function logGSTSalesInvoice({ conn, invoiceId, user, action }) {


  /* ---- fetch BEFORE ---- */
  const [[fetch]] = await conn.execute(
    'SELECT * FROM gstsalesinvo WHERE id = ?',
    [invoiceId]
  );


  /* ---- insert audit log ---- */
  const insertAuditLog = `
    INSERT INTO gstsalesinvo_audit_log
    (
      invoice_id,
      invNo,
      updated_by,
      action
    )
    VALUES (?, ?, ?, ?)
  `;

  await conn.execute(insertAuditLog, [
    invoiceId,
    fetch.invNo,
    user,
    action
  ]);
}


exports.delete = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    const id = req.params.id;
    const user = req.headers.username;
    const action = 'Delete';


    // Check if the invoice has already been generated
    const [rows] = await conn.execute(
      `SELECT id FROM gstsalesinvo WHERE invoiceGen = 1 AND id = ?`,
      [id]
    );

    if (rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete. E-Invoice has already been generated.",
      });
    }

    /* ---------------- AUDIT LOG ---------------- */
    await logGSTSalesInvoice({ conn, invoiceId: id, user, action });

    // Delete the invoice
    await conn.execute(`DELETE FROM gstsalesinvo WHERE id = ?`, [id]);

    // Reset document number if needed
    await docNoReset(conn, req, {
      docType: 'GSTSalesinvoice',
      table: 'gstsalesinvo',
      col: 'invSt'
    });


    await conn.commit();

    return handleSuccessResponse(res, 'Successfully Deleted');

  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};






exports.cancelInvoice = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const id = req.params.id;
    const user = await getUser(req); // assume you get username/id

    // 1. Update gstsalesinvo
    const update1 = `
      UPDATE gstsalesinvo SET isCancelAuth = 1, cancelBy = ? WHERE id = ?
    `;
    await conn.execute(update1, [user, id]);

    // 2. Update gstsalesinvoitem
    const update2 = `
      UPDATE gstsalesinvoitem  SET dflag = 1  WHERE gstsalesinvo_id = ?
    `;
    await conn.execute(update2, [id]);

    await conn.commit();

    return handleSuccessResponse(res, "Invoice Get Cancelled");

  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};




exports.canceledInvoiceshow = async (req, res) => {
  let conn;
  try {
    const invoiceId = req.params.id;

    conn = await connection.getConnection();

    const invoiceQuery = `
      SELECT 
        gsi.*, c.cCode, c.cName, c.cId,
        DATE_FORMAT(gsi.date, '%d-%m-%Y') AS date,
        TRIM(CONCAT(
          COALESCE(disp.add1, ''), ' ',
          COALESCE(disp.add2, ''), ' ',
          COALESCE(disp.add3, ''), ' ',
          COALESCE(disp.add4, '')
        )) AS dispatchFromAdd,
        disp.irn, disp.ackNo, DATE_FORMAT(disp.ackDate, '%d-%m-%Y') AS ackDate
      FROM gstsalesinvo gsi
      INNER JOIN customer c 
        ON c.cId = gsi.custName
      LEFT JOIN dispatch_mst disp 
        ON disp.id = gsi.dispatchId
      WHERE gsi.id = ?
    `;

    const itemQuery = `
      SELECT 
        gstItm.*, gstItm.partNo AS itemCode, gstItm.partName AS itemName, gstItm.soQty AS Qty, gstItm.invRate AS stdRate, gstItm.invAmt AS amt, po.pay_term
      FROM gstsalesinvoItem gstItm
      INNER JOIN purchase_order po 
        ON po.poNo = gstItm.poNo
      WHERE gstsalesinvo_id = ?
        AND gstItm.partNo NOT LIKE '%-DC'
        AND gstItm.dflag != 1
      ORDER BY gstItm.id ASC
    `;

    const [[invoiceData]] = await conn.query(invoiceQuery, [invoiceId]);

    if (!invoiceData) {
      return handleErrorResponse(res, "Invoice not found", 404);
    }

    const [itemsData] = await conn.query(itemQuery, [invoiceId]);

    return res.status(200).json({
      success: true,
      message: 'Cancelled Invoice',
      // invoice: invoiceData,
      // items: itemsData
      data: {
        invoice: invoiceData,
        items: itemsData,
      },
    })
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};




exports.approveSubmit = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const ids = req.body.ids;
    const { type } = req.query;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or missing IDs" });
    }

    const placeholders = ids.map(() => '?').join(', ');

    if (type === "approve") {
      // Step 1: Fetch all invoice items for the given invoice IDs
      const [rows] = await conn.execute(
        `SELECT poItemId, invQty 
          FROM gstsalesinvoitem 
        WHERE gstsalesinvo_id IN (${placeholders})`, ids
      );

      // Step 2: Update invoice and items flags
      await conn.execute(
        `UPDATE gstsalesinvo 
          SET isCancelAuth = 0, dflag = 1 
        WHERE id IN (${placeholders})`, ids
      );

      await conn.execute(
        `UPDATE gstsalesinvoitem 
          SET dflag = 1 
        WHERE gstsalesinvo_id IN (${placeholders})`, ids
      );

      // Step 3: Update each related purchase order item
      for (const row of rows) {
        const { poItemId, invQty } = row;

        await conn.execute(
          `UPDATE purchas_order_item 
            SET 
              pendQty = pendQty + ?, 
              cumQty = GREATEST(cumQty - ?, 0) 
            WHERE id = ?`,
          [invQty, invQty, poItemId]
        );
      }

      await conn.commit();
      return res.status(200).json({ success: true, message: "Invoice approved and items updated" });

    } else if (type === "reject") {
      // Reject case – reset cancel flag
      await conn.execute(
        `UPDATE gstsalesinvo 
          SET isCancelAuth = 0 
        WHERE id IN (${placeholders})`, ids
      );

      await conn.commit();
      return res.status(200).json({ success: true, message: "Invoice rejected" });
    } else {
      return res.status(400).json({ success: false, message: "Invalid type parameter" });
    }

  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};




exports.showdata = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const sqlQuery = `
      SELECT  
        gSI.id,
        gSI.invNo,
        gSI.custPoNo,
        gSI.labourCharge,
        c.cCode,
        c.cName,
        c.cId
      FROM gstsalesinvo gSI
      INNER JOIN customer c 
        ON c.cId = gSI.custName
      ORDER BY gSI.id DESC
    `;

    const [rows] = await conn.query(sqlQuery);

    return handleSuccessResponse(
      res,
      "GST invoice list fetched successfully",
      rows
    );

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};




exports.pendCancelInvoice = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const sqlQuery = `
      SELECT  
        gSI.id,
        gSI.invNo,
        gSI.custPoNo,
        gSI.labourCharge,
        c.cCode,
        c.cName,
        c.cId
      FROM gstsalesinvo gSI
      INNER JOIN customer c 
        ON c.cId = gSI.custName
      WHERE gSI.isCancelAuth = 1
      ORDER BY gSI.id DESC
    `;

    const [rows] = await conn.query(sqlQuery);

    // add UI helper fields
    rows.forEach(row => {
      row.selected = false;
    });

    return handleSuccessResponse(
      res,
      "Cancel GST Invoice list",
      rows
    );

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};



exports.showdatabyid = async (req, res) => {
  let conn;
  try {
    const id = req.params.id;

    conn = await connection.getConnection();

    const sqlQuery = `
      SELECT  
        gst.*,
        prl.preRate
      FROM gstsalesinvoItem gst
      INNER JOIN items i 
        ON i.itemCode = gst.partNo
      LEFT JOIN price_revision_log prl 
        ON prl.itemName = i.id
      WHERE gst.gstsalesinvo_id = ?
        AND gst.partNo NOT LIKE '%-DC'
    `;

    const [rows] = await conn.query(sqlQuery, [id]);

    return handleSuccessResponse(
      res,
      "GST Invoice item list",
      rows
    );

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};


exports.showitemsbyid = async (req, res) => {
  let conn;
  try {
    const itemCode = req.params.id;

    conn = await connection.getConnection();

    const sqlQuery = `
      SELECT 
        i.id,
        hsn.name AS hsnCode,
        i.totStk,
        il.name AS itemLedger,
        poi.id AS poiId,
        po.sino,
        po.sodigit AS soNo,
        po.poNo,
        del.id AS delDtlId,
        delMst.id AS delMstId,
        poi.PartNo AS itemCode,
        poi.PartName AS itemName,
        1 AS descOfPackage,
        delMst.vehicleNo,
        poi.UOM AS uom,
        poi.purchase_order_id AS poId,
        poi.id AS poItemId,
        poi.Qty,
        poi.pendQty,
        poi.invQty,
        poi.Rate AS stdRate,
        poi.cumQty,
        (poi.Rate * poi.invQty) AS amt,
        DATE_FORMAT(poi.SchDate, '%d-%m-%Y') AS schDate
      FROM purchase_order po
      INNER JOIN purchas_Order_item poi 
        ON poi.purchase_order_id = po.id
      INNER JOIN items i 
        ON i.itemCode = poi.PartNo
      INNER JOIN cust_vs_item cVi  
        ON cVi.customerId = po.customer 
       AND cVi.itemId = i.id
      LEFT JOIN del_note del 
        ON del.poNo = po.poNo
      LEFT JOIN del_note_mst delMst 
        ON delMst.delNoteNo = del.delNoteNo
      LEFT JOIN item_under_ledger il 
        ON il.id = cVi.underLedger
      LEFT JOIN item_hsn_code hsn 
        ON hsn.id = i.hsnCode
      WHERE 
        poi.isShortCls = 0
        AND i.itemCode = ?
      GROUP BY  i.id
      ORDER BY poi.id ASC
    `;

    const [rows] = await conn.query(sqlQuery, [itemCode]);

    return handleSuccessResponse(
      res,
      "Item list fetched successfully",
      rows
    );

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};

exports.exportGstInvice = async (req, res) => {
  try {

    const id = req.params.id;

    const query = `
      SELECT * FROM gstsalesinvoitem where gstsalesinvo_id = ? 
      AND partNo NOT LIKE '%-DC' AND dflag != 1 `;

    const [rows] = await connection.execute(query, [id]);


    rows.forEach((row, index) => {
      row.slNo = index + 1;
    });

    const customHeaders = ['Sl.No', 'Part No', 'Part Name', 'UOM', 'SO Qty', 'Pending Qty', 'Cum Qty',
      'HSN Code', 'Sch Date', 'Inv Qty', 'Inv Rate', 'Inv Amt', 'Item Ledger', 'Desc of Package'];

    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Po OrderList Report');

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
        row.partNo,
        row.partName,
        row.uom,
        row.soQty,
        row.pendQty,
        row.cumQty,
        row.hsnCode,
        row.schDate,
        row.invQty,
        row.invRate,
        row.invAmt,
        row.itemLedger,
        row.descOfPackage,
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



exports.template = async (req, res) => {
  try {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet("Sheet 1");

    // Add headers
    const headerRow = worksheet.addRow(["Item Code", "Contract No", "Qty"]);

    // Apply styles to the header row
    headerRow.font = { bold: true }; // Make text bold
    headerRow.alignment = { horizontal: "center" }; // Center align text

    worksheet.columns.forEach((column) => {
      column.width = 20;
    });

    // Set content type and disposition including desired filename
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename = CSL.xlsx");

    // Write the Excel file to the response
    workbook.xlsx
      .write(res)
      .then(() => {
        // End the response stream
        res.end();
      })
      .catch((err) => {
        console.error("Error writing Excel file:", err);
        res.status(500).send("Error generating Excel file");
      });
  } catch (err) {
    return res
      .status(400)
      .json({ success: false, message: err.message || "An error occurred" });
  }
};


exports.pendingso = async (req, res) => {
  let conn;
  try {
    const { id } = req.params;
    const type = req.query.type === "Others" ? 1 : 0;

    conn = await connection.getConnection();

    const sqlQuery = `
      SELECT 
        poi.id, poi.id AS poItemId, poi.PartNo AS itemCode, poi.PartName AS itemName, po.id AS poId, poi.UOM AS uom, poi.Qty, poi.invQty, poi.pendQty,
        poi.Rate AS stdRate, poi.Rate * poi.invQty AS amt, po.sino, po.sodigit, po.poNo, po.sodigit AS soNo, DATE_FORMAT(po.date, '%d-%m-%Y') AS date,
        c.cCode, c.cName, DATE_FORMAT(poi.SchDate, '%d-%m-%Y') AS schDate, 1 AS descOfPackage, poi.cumQty, cvi.hsnCode, i.totStk,
        il.name AS itemLedger, ig.code AS itemGroupCode, delMst.vehicleNo, del.delNoteNo, delMst.id AS delMstId, del.id AS delDtlId
      FROM purchase_order po
      INNER JOIN purchas_Order_item poi 
        ON poi.purchase_order_id = po.id
      INNER JOIN items i 
        ON i.itemCode = poi.PartNo
      INNER JOIN customer c 
        ON c.cId = po.customer
      INNER JOIN cust_vs_item cvi  
        ON cvi.customerId = po.customer
       AND cvi.itemId = i.id
      LEFT JOIN del_note del 
        ON del.poNo = po.poNo
      LEFT JOIN del_note_mst delMst 
        ON delMst.delNoteNo = del.delNoteNo
      LEFT JOIN item_under_ledger il 
        ON il.id = cvi.underLedger
      LEFT JOIN mst_item_group ig 
        ON ig.id = cvi.itemGroup
      WHERE 
        poi.pendQty > 0 AND poi.isShortCls = 0 AND po.customer = ? AND po.isVerbal = ?
      GROUP BY poi.id
      ORDER BY po.date ASC
    `;

    const [rows] = await conn.query(sqlQuery, [id, type]);

    return handleSuccessResponse(res, "Item list", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};





exports.pendingDel = async (req, res) => {
  let conn;
  try {
    const { id } = req.params;
    const delNos = req.body.delNo;

    if (!Array.isArray(delNos) || delNos.length === 0) {
      return handleErrorResponse(res, "Invalid or empty delivery numbers");
    }

    conn = await connection.getConnection();

    const placeholders = delNos.map(() => "?").join(", ");

    const sqlQuery = `
      SELECT 
        poi.id, po.id AS poId, poi.id AS poItemId, poi.PartNo AS itemCode, poi.PartName AS itemName, poi.UOM AS uom, poi.Qty, poi.invQty, poi.pendQty, poi.cumQty, 
        poi.Rate, poi.Rate AS stdRate, poi.Rate * poi.invQty AS amt, DATE_FORMAT(poi.SchDate, '%d-%m-%Y') AS schDate, delMst.id AS delMstId, delMst.vehicleNo, 
        po.sino, po.sodigit, po.poNo, po.sodigit AS soNo,COALESCE(del1.qty, del2.qty) AS qty,COALESCE(del1.id, del2.id) AS delDtlId, DATE_FORMAT(po.date, '%d-%m-%Y') AS date, 
        c.cCode,c.cName,cvi.hsnCode, i.totStk, 1 AS descOfPackage, il.name AS itemLedger, ig.code AS itemGroupCode,  COALESCE(del1.delNoteNo, del2.delNoteNo) AS delNoteNo
      FROM purchase_order po
      INNER JOIN purchas_Order_item poi 
        ON poi.purchase_order_id = po.id
      INNER JOIN items i 
        ON i.itemCode = poi.PartNo 
      INNER JOIN customer c 
        ON c.cId = po.customer    
      INNER JOIN cust_vs_item cvi 
        ON cvi.customerId = po.customer 
       AND cvi.itemId = i.id 
      LEFT JOIN item_under_ledger il 
        ON il.id = cvi.underLedger
      LEFT JOIN mst_item_group ig 
        ON ig.id = cvi.itemGroup
      LEFT JOIN del_note del1 
        ON poi.PartNo = del1.contractNo 
       AND po.poNo = del1.poNo
      LEFT JOIN del_note del2 
        ON poi.PartNo = CONCAT(del2.contractNo, '-', del2.fimNo) 
       AND po.poNo = del2.poNo
      LEFT JOIN del_note_mst delMst 
        ON delMst.delNoteNo = COALESCE(del1.delNoteNo, del2.delNoteNo)  
      WHERE  
        poi.isShortCls = 0 AND poi.pendQty > 0 AND po.customer = ?
          AND COALESCE(del1.status, del2.status) = 0
          AND COALESCE(del1.delNoteNo, del2.delNoteNo) IN (${placeholders})
      GROUP BY COALESCE(del1.id, del2.id)
    `;

    const [rows] = await conn.query(sqlQuery, [id, ...delNos]);

    rows.forEach((row, index) => {
      row.slNo = index + 1;
      row.selected = false;
    });

    return handleSuccessResponse(
      res,
      rows.length ? "Item list retrieved successfully" : "No items found",
      rows
    );

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};




exports.showgstinvoice = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const sqlQuery = `
      SELECT
        g.invNo,
        po.customer,
        DATE_FORMAT(g.date, '%d-%m-%Y') AS date
      FROM gstsalesinvo g
      INNER JOIN purchase_order po 
        ON g.custPoNo = po.poNo
      ORDER BY g.date DESC
    `;

    const [rows] = await conn.query(sqlQuery);

    return handleSuccessResponse(
      res,
      "Item list",
      rows
    );

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};





exports.getGSTSalesInvoiceshow = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const invoiceId = req.params.id;

    const companyData = await company();

    /* -------------------- INVOICE HEADER -------------------- */
    const invoiceQuery = `
      SELECT gst.*, 
        c.cCode, c.cName, c.cId, c.city, c.state, c.country, c.gstNo, c.panNo,
        DATE_FORMAT(gst.date, '%d-%m-%Y') AS date, gstInv.Irn, gstInv.EwbNo,
        DATE_FORMAT(gstInv.AckDt, '%d-%m-%Y') AS AckDt, DATE_FORMAT(gstInv.EwbDt, '%d-%m-%Y') AS EwbDt,
        gstInv.AckNo, gstInv.SignedQrCodeImgUrl, gstInv.InvoicePdfUrl, gst.taxableValueforGST, gst.subTotAfterDisc, gst.subtotal, gst.amtOfGstPay,
        gst.CGST, gst.SGST, gst.IGST, gst.totGst, gst.totalValue, gst.invValue, disp.name AS dispatchName,
        TRIM(CONCAT(
          COALESCE(disp.add1,''),' ',
          COALESCE(disp.add2,''),' ',
          COALESCE(disp.add3,''),' ',
          COALESCE(disp.add4,''),' ',
          COALESCE(disp.city,''),' ',
          COALESCE(disp.state,''),' ',
          COALESCE(disp.pinCode,'')
        )) AS dispatchFromAdd
      FROM gstsalesinvo gst
      INNER JOIN customer c ON c.cId = gst.custName
      LEFT JOIN dispatch_mst disp ON disp.id = gst.dispatchId
      LEFT JOIN gst_einvoice_data gstInv ON gstInv.gstInvId = gst.id
      WHERE gst.id = ?
    `;

    const [invoiceRows] = await conn.query(invoiceQuery, [invoiceId]);
    if (!invoiceRows.length) {
      return handleErrorResponse(res, new Error("Invoice not found"));
    }

    const invoiceData = invoiceRows[0];

    /* -------------------- FORMAT DECIMALS -------------------- */
    [
      'taxableValueforGST',
      'subTotAfterDisc',
      'subtotal',
      'amtOfGstPay',
      'CGST',
      'SGST',
      'IGST',
      'totGst',
      'totalValue',
      'invValue'
    ].forEach(field => {
      if (invoiceData[field] != null) {
        invoiceData[field] = Number(invoiceData[field]).toFixed(2);
      }
    });

    /* -------------------- INVOICE ITEMS -------------------- */
    const itemQuery = `
      SELECT gstItm.*,
        gstItm.partNo AS itemCode, gstItm.partName AS itemName, gstItm.soQty AS Qty, po.pay_term, gstItm.invRate AS stdRate,
        gstItm.invAmt AS amt, DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate, DATE_FORMAT(gstItm.schDate, '%d/%m/%Y') AS schDate
      FROM gstsalesinvoItem gstItm
      INNER JOIN purchase_order po ON po.id = gstItm.poId
      WHERE gstsalesinvo_id = ?
        AND gstItm.partNo NOT LIKE '%-DC'
        AND gstItm.dflag != 1
      GROUP BY gstItm.id
    `;

    const [itemsData] = await conn.query(itemQuery, [invoiceId]);

    itemsData.forEach(itm => {
      if (itm.stdRate != null) itm.stdRate = Number(itm.stdRate).toFixed(2);
      if (itm.amt != null) itm.amt = Number(itm.amt).toFixed(2);
      if (itm.invRate != null) itm.invRate = Number(itm.invRate).toFixed(2);
      if (itm.invAmt != null) itm.invAmt = Number(itm.invAmt).toFixed(2);
    });

    /* -------------------- DC DETAILS -------------------- */
    const dcQuery = `
      SELECT 
        cdc.cdcNo,  cdc.cust_Dc_no,
        CONCAT(cdc.cust_Dc_no, ':', cdcp.partno, ': ', cdcp.uom, ': ', gstItm.invQty) AS dcDetails,
        DATE_FORMAT(cdc.customerDcDate, '%d-%m-%Y') AS cdcDate
      FROM gstsalesinvoItem gstItm
      INNER JOIN customer_dc_parts cdcp ON cdcp.id = gstItm.cdcItmId
      INNER JOIN customer_dc cdc ON cdc.id = cdcp.CDC_no
      WHERE gstsalesinvo_id = ?
        AND gstItm.partNo LIKE '%-DC'
        AND gstItm.dflag != 1
      LIMIT 1
    `;

    const [dcRows] = await conn.query(dcQuery, [invoiceId]);

    if (dcRows.length) {
      invoiceData.dcDetails = dcRows[0].dcDetails;
      invoiceData.customerDcNo = dcRows[0].cust_Dc_no;
      invoiceData.customerDcDate = dcRows[0].cdcDate;
    } else {
      invoiceData.dcDetails = null;
      invoiceData.customerDcNo = null;
      invoiceData.customerDcDate = null;
    }

    /* -------------------- COMPANY DATA -------------------- */
    if (companyData) {
      Object.assign(invoiceData, companyData);
    }

    invoiceData.itemLedger = itemsData.length ? itemsData[0].itemLedger : null;

    // return res.status(200).json({
    //   success: true,
    //   message: "GST Invoice fetched successfully",
    //   invoice: invoiceData,
    //   items: itemsData
    // })

    return res.status(200).json({
      success: true,
      message: "GST Invoice fetched successfully",
      data: {
        invoice: invoiceData,
        items: itemsData,
      },
    });



  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};



exports.multiInvoice = async (req, res) => {
  let conn;
  try {
    const { gstids } = req.body;

    if (!Array.isArray(gstids) || gstids.length === 0) {
      return handleErrorResponse(res, "Invalid or empty gstids array", 400);
    }

    conn = await connection.getConnection();

    /* -------------------- FETCH INVOICES -------------------- */
    const invoiceQuery = `
      SELECT 
        gst.*, c.cCode, c.cName, c.cId, c.city, c.state, c.country, c.gstNo, c.panNo, c.tallyAlias,
        DATE_FORMAT(gst.date, '%d-%m-%Y') AS date, gstInv.Irn,
        DATE_FORMAT(gstInv.AckDt, '%d-%m-%Y') AS AckDt, gstInv.EwbNo,
        DATE_FORMAT(gstInv.EwbDt, '%d-%m-%Y') AS EwbDt,
        gstInv.AckNo, gstInv.SignedQrCodeImgUrl, gstInv.InvoicePdfUrl, gst.taxableValueforGST, gst.subTotAfterDisc, gst.subtotal, gst.amtOfGstPay,
        gst.CGST, gst.SGST, gst.IGST, gst.totGst, gst.totalValue, gst.invValue,
        TRIM(CONCAT(
          COALESCE(disp.add1, ''), ' ',
          COALESCE(disp.add2, ''), ' ',
          COALESCE(disp.add3, ''), ' ',
          COALESCE(disp.add4, '')
        )) AS dispatchFromAdd
      FROM gstsalesinvo gst
      INNER JOIN customer c ON c.cId = gst.custName
      LEFT JOIN dispatch_mst disp ON disp.id = gst.dispatchId
      LEFT JOIN gst_einvoice_data gstInv ON gstInv.gstInvId = gst.id
      WHERE gst.id IN (${gstids.map(() => "?").join(",")})
      ORDER BY gst.id
    `;

    const [invoices] = await conn.query(invoiceQuery, gstids);

    if (!invoices.length) {
      return handleErrorResponse(res, "No invoices found", 404);
    }

    /* -------------------- FORMAT INVOICE DECIMALS -------------------- */
    invoices.forEach(inv => {
      [
        "taxableValueforGST", "subTotAfterDisc", "subtotal", "amtOfGstPay",
        "CGST", "SGST", "IGST", "totGst", "totalValue", "invValue"
      ].forEach(f => {
        if (inv[f] != null) inv[f] = Number(inv[f]).toFixed(2);
      });
    });

    /* -------------------- FETCH ALL ITEMS (ONE QUERY) -------------------- */
    const itemQuery = `
      SELECT 
        gstItm.*,
        gstItm.gstsalesinvo_id,
        il.code AS itemLedgerCode,
        gstItm.partName AS itemName,
        gstItm.soQty AS Qty,
        po.pay_term,
        gstItm.invRate AS stdRate,
        gstItm.invAmt AS amt,
        DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
        DATE_FORMAT(gstItm.schDate, '%d/%m/%Y') AS schDate,
        CONCAT(
          po.poNo, '; ',
          DATE_FORMAT(po.poDate, '%d-%m-%Y'), ', ',
          gstItm.partNo, ', ',
          gstItm.invQty
        ) AS narration
      FROM gstsalesinvoItem gstItm
      INNER JOIN purchase_order po ON po.poNo = gstItm.poNo
      LEFT JOIN item_under_ledger il ON il.name = gstItm.itemLedger
      WHERE gstItm.gstsalesinvo_id IN (${gstids.map(() => "?").join(",")})
        AND gstItm.partNo NOT LIKE '%-DC'
        AND gstItm.dflag != 1
      ORDER BY gstItm.gstsalesinvo_id, gstItm.id
    `;

    const [items] = await conn.query(itemQuery, gstids);

    /* -------------------- FORMAT ITEM DECIMALS -------------------- */
    items.forEach(itm => {
      ["stdRate", "amt", "invRate", "invAmt"].forEach(f => {
        if (itm[f] != null) itm[f] = Number(itm[f]).toFixed(2);
      });
    });

    /* -------------------- MAP ITEMS TO INVOICES -------------------- */
    const itemMap = {};
    items.forEach(itm => {
      if (!itemMap[itm.gstsalesinvo_id]) itemMap[itm.gstsalesinvo_id] = [];
      itemMap[itm.gstsalesinvo_id].push(itm);
    });

    const responseData = invoices.map(inv => ({
      invoice: inv,
      items: itemMap[inv.id] || []
    }));

    return handleSuccessResponse(res, "Multiple invoices fetched successfully", responseData);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};

exports.multiGSTsalesInvoice = async (req, res) => {
  try {
    const { invoiceIds } = req.body; // Expecting an array of invoice IDs

    const companyData = await company();


    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid invoice IDs" });
    }

    const selectGSTSalesInvoiceByIdQuery = `
      SELECT 
        gstsalesinvo.*, c.cCode, c.cName, c.cId, c.city, c.state, c.country, 
        DATE_FORMAT(gstsalesinvo.date, '%d-%m-%Y') as date, 
        gstInv.Irn, DATE_FORMAT(gstInv.AckDt, '%d-%m-%Y') as AckDt, gstInv.AckNo,  
        gstInv.EwbNo,  DATE_FORMAT(gstInv.EwbDt, '%d-%m-%Y') as EwbDt, disp.name As dispatchName,
        gstInv.SignedQrCodeImgUrl, gstInv.InvoicePdfUrl,
        TRIM(CONCAT(
          COALESCE(disp.add1, ''), ' ',
          COALESCE(disp.add2, ''), ' ',
          COALESCE(disp.add3, ''), ' ',
          COALESCE(disp.add4, ''), ' ',
          COALESCE(disp.city, ''), ' ',
          COALESCE(disp.state, ''), ' ',
          COALESCE(disp.pinCode, '')
        )) AS dispatchFromAdd
      FROM gstsalesinvo 
      LEFT JOIN dispatch_mst disp ON disp.id = gstsalesinvo.dispatchId
      INNER JOIN customer c ON c.cId = gstsalesinvo.custName
      LEFT JOIN gst_einvoice_data gstInv ON gstInv.gstInvId = gstsalesinvo.id
      WHERE gstsalesinvo.id = ?
    `;

    const selectGSTSalesInvoiceItemByInvoiceIdQuery = `
      SELECT gstItm.*, gstItm.partNo AS itemCode, gstItm.partName AS itemName, gstItm.soQty AS Qty, il.code As itemLedgerCode, gstItm.itemLedger,
        gstItm.invRate AS stdRate, gstItm.invAmt AS amt, po.pay_term,  DATE_FORMAT(po.poDate, '%d-%m-%Y') as poDate
      FROM gstsalesinvoItem gstItm 
      INNER JOIN purchase_order po ON po.poNo = gstItm.poNo
      INNER JOIN item_under_ledger il ON il.name = gstItm.itemLedger
      WHERE gstsalesinvo_id = ? AND gstItm.partNo NOT LIKE '%-DC' AND gstItm.dflag != 1
    `;


    const dcQuery = `
      SELECT 
        cdc.cdcNo,  cdc.cust_Dc_no,
        CONCAT(cdc.cust_Dc_no, ':', cdcp.partno, ': ', cdcp.uom, ': ', gstItm.invQty) AS dcDetails,
        DATE_FORMAT(cdc.customerDcDate, '%d-%m-%Y') AS cdcDate
      FROM gstsalesinvoItem gstItm
      INNER JOIN customer_dc_parts cdcp ON cdcp.id = gstItm.cdcItmId
      INNER JOIN customer_dc cdc ON cdc.id = cdcp.CDC_no
      WHERE gstsalesinvo_id = ?
        AND gstItm.partNo LIKE '%-DC'
        AND gstItm.dflag != 1
      LIMIT 1
    `;

    // Fetch all invoices and their items concurrently
    const invoices = await Promise.all(
      invoiceIds.map(async (id) => {
        const [invoiceData] = await connection.execute(selectGSTSalesInvoiceByIdQuery, [id]);

        if (!invoiceData.length) return null; // Skip if no data found

        const [itemsData] = await connection.execute(selectGSTSalesInvoiceItemByInvoiceIdQuery, [id]);


        const [dcRows] = await connection.execute(dcQuery, [id]);

        if (dcRows.length) {
          invoiceData[0].dcDetails = dcRows[0].dcDetails;
          invoiceData[0].customerDcNo = dcRows[0].cust_Dc_no;
          invoiceData[0].customerDcDate = dcRows[0].cdcDate;
        } else {
          invoiceData[0].dcDetails = null;
          invoiceData[0].customerDcNo = null;
          invoiceData[0].customerDcDate = null;
        }


        // Determine if all poNo are the same
        // const allPoSame = itemsData.length > 0 && itemsData.every(item => item.poNo === itemsData[0].poNo);
        let allPoSame = false;
        let commonPoNo = null;
        let commonPoDate = null;


        if (itemsData.length > 0) {
          const firstPoNo = itemsData[0].poNo;
          const firstPoDate = itemsData[0].poDate;
          allPoSame = itemsData.every(item => item.poNo === firstPoNo);
          if (allPoSame) {
            commonPoNo = firstPoNo;
            commonPoDate = firstPoDate;

          }
        }

        invoiceData[0].itemLedger = itemsData.length > 0 ? itemsData[0].itemLedger : null;
        invoiceData[0].itemLedgerCode = itemsData.length > 0 ? itemsData[0].itemLedgerCode : null;


        return {
          invoice: {
            ...invoiceData[0],
            allPoSame,
            ...companyData,
            ...(allPoSame && { poNo: commonPoNo, poDate: commonPoDate }) // Conditionally add poNo
          },       // Extract single row object
          items: itemsData, // Array of items
        };
      })
    );

    // Remove null values (in case some invoice IDs didn't exist)
    const filteredInvoices = invoices.filter((inv) => inv !== null);

    return res.status(200).json({
      success: true,
      data: filteredInvoices,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message || "An error occurred" });
  }
};


exports.getItems = async (req, res) => {
  try {
    const { type, id } = req.query;
    const { from, to } = getFYRange(req);


    // Main invoice query
    let poQuery = `
      SELECT 
        po.*, c.cCode, c.cName, c.cId, c.city, c.state, c.country, 
        DATE_FORMAT(po.date, '%d-%m-%Y') AS date, 
        TRIM(CONCAT(
          COALESCE(disp.add1, ''), ' ',
          COALESCE(disp.add2, ''), ' ',
          COALESCE(disp.add3, ''), ' ',
          COALESCE(disp.add4, '')
        )) AS dispatchFromAdd,
        disp.irn, disp.ackNo, disp.ackDate
      FROM gstsalesinvo po
      LEFT JOIN dispatch_mst disp ON disp.id = po.dispatchId
      INNER JOIN customer c ON c.cId = po.custName
      WHERE po.created_at BETWEEN ? AND ?
    `;

    let poParams = [from, to];


    // Modify main query based on type
    switch (type) {
      case 'first':
        poQuery += ` ORDER BY po.id ASC LIMIT 1`;
        break;
      case 'last':
        poQuery += ` ORDER BY po.id DESC LIMIT 1`;
        break;
      case 'forward':
        poQuery += ` AND po.id > ? ORDER BY po.id ASC LIMIT 1`;
        poParams.push(id);
        break;
      case 'reverse':
        poQuery += ` AND po.id < ? ORDER BY po.id DESC LIMIT 1`;
        poParams.push(id);
        break;
    }

    // Execute main invoice query
    const [invoiceResult] = await connection.execute(poQuery, poParams);

    if (invoiceResult.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          invoice: {},
          items: [],
        },
      });
    }

    const invoice = invoiceResult[0];
    // //console.log('Fetched invoice ID:', invoice.id);

    // Items query with alias fix and no GROUP BY
    let itemsQuery = `
      SELECT 
        gstItm.*,
        gstItm.partNo AS itemCode,
        gstItm.partName AS itemName,
        gstItm.soQty AS Qty,
        DATE_FORMAT(gstItm.schDate, '%d/%m/%Y') AS schDate,
        gstItm.invRate AS stdRate,
        gstItm.invAmt AS amt,
        po2.pay_term,
        gstItm.gstsalesinvo_id
      FROM gstsalesinvoItem gstItm
      INNER JOIN purchase_order po2 ON po2.id = gstItm.poId
      WHERE gstItm.dflag = 0
        AND gstItm.partNo NOT LIKE '%-DC'
        AND gstItm.gstsalesinvo_id = ?
    `;

    const itemParams = [invoice.id];

    // Execute item query
    const [itemResults] = await connection.execute(itemsQuery, itemParams);

    // Respond with invoice and item data
    return res.status(200).json({
      success: true,
      data: {
        invoice,
        items: itemResults,
      },
    });

  } catch (err) {
    console.error('Error fetching items:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'An error occurred',
    });
  }
};





exports.getGSTInvoiceshowTally = async (req, res) => {
  let conn;
  try {
    const invoiceId = req.params.id;

    conn = await connection.getConnection();

    const query = `
      SELECT 
        gt.id,
        gt.invNo,
        DATE_FORMAT(gt.date, '%d-%m-%Y') AS date,
        gt.custName,
        gt.billAdd,
        gt.invoIssuDate,
        gt.totalValue,
        gt.taxableValueforGST,
        gt.CGST,
        gt.SGST,
        gt.IGST,
        gt.UTGST,
        gt.roundOff,
        c.payTerm,
        po.poNo,
        DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
        po.Narration
      FROM gstsalesinvo gt
      INNER JOIN customer c ON gt.custName = c.cId
      INNER JOIN purchase_order po ON gt.custPoNo = po.poNo
      WHERE gt.id = ?
    `;

    const [rows] = await conn.query(query, [invoiceId]);

    if (!rows.length) {
      return handleErrorResponse(res, "Invoice not found", 404);
    }

    return res.status(200).json({
      success: true,
      message: "Invoice data fetched successfully",
      invoice: rows[0]
    })
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};




//************************************       DISPATCH MASTER     *************************************************// 

exports.dispatchAdd = async (req, res) => {
  try {
    const disp = req.body;

    const [rows, fields] = await connection.execute(`SELECT * FROM dispatch_mst WHERE  name = ? `, [disp.name]);

    if (rows.length > 0) {
      return res.status(400).json({ success: false, message: "Name is already exists!" });
    }


    const storeQuery = `INSERT INTO dispatch_mst (code, name, add1, add2, add3, add4, city, state, pinCode, country,
     gstNo, stateCode, panNo, placeOfSupply, defaultField) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [disp.code, disp.name, disp.add1, disp.add2, disp.add3, disp.add4, disp.city, disp.state, disp.pinCode,
    disp.country, disp.gstNo, disp.stateCode, disp.panNo, disp.placeOfSupply, disp.defaultField
    ];

    const [sRows] = await connection.execute(storeQuery, values);

    if (sRows.affectedRows > 0) {
      return res.status(200).json({ success: true, message: "data addded successfully" });
    } else {
      throw new CustomError("Something went wrong!");
    }

  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
  }
};


exports.dispatchUpdate = async (req, res) => {
  try {
    const id = req.params.id;
    const disp = req.body;

    const [fRows] = await connection.execute(`SELECT * FROM dispatch_mst WHERE id = ?`, [id]);

    if (fRows.length == 0) {
      throw new CustomError("data not found!", 404);
    }

    const updateQuery = `UPDATE dispatch_mst SET code = ?, name = ?, add1 = ?, add2 = ?, add3 = ?, add4 = ?, city = ?, state = ?, pinCode = ?, 
      country = ?, gstNo = ?, stateCode = ?, panNo = ?, placeOfSupply = ?, defaultField = ? WHERE id = ?`;

    const values = [disp.code, disp.name, disp.add1, disp.add2, disp.add3, disp.add4, disp.city, disp.state, disp.pinCode,
    disp.country, disp.gstNo, disp.stateCode, disp.panNo, disp.placeOfSupply, disp.defaultField, id];

    const [uRows] = await connection.execute(updateQuery, values);

    if (uRows.affectedRows > 0) {
      return res.status(200).json({ success: true, message: "Successfully updated" });
    } else {
      throw new CustomError("Something went wrong!");
    }

  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
  }
};



exports.dispatchDelete = async (req, res) => {
  try {
    const id = req.params.id;

    const [fRows] = await connection.execute(`SELECT * FROM dispatch_mst WHERE id = ?`, [id]);

    if (fRows.length == 0) {
      throw new CustomError("rsn not found!", 404);
    }

    const [DRows] = await connection.execute(`DELETE FROM dispatch_mst  WHERE id = ?`, [id]);

    return res.status(200).json({ success: true, message: "Successfully deleted" });

  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
  }
}



exports.dispatchShow = async (req, res) => {
  try {

    const query = `
      SELECT disp.*,        
       TRIM(CONCAT(
              COALESCE(disp.name, ''), ' ',
              COALESCE(disp.add1, ''), ' ',
              COALESCE(disp.add2, ''), ' ',
              COALESCE(disp.add3, ''), ' ',
              COALESCE(disp.add4, ''), ' ',
              COALESCE(disp.city, ''), ' ',
              COALESCE(disp.state, ''), ' ',
              COALESCE(disp.pinCode, '')
            )) AS  dispatchAdd

      FROM dispatch_mst disp 
      WHERE dflag = 0`;

    const [rows] = await connection.execute(query, []);

    if (rows.length >= 0) {

      //Auto Index value
      rows.forEach((element, index) => {
        element.sNo = index + 1;
      });

      return res.status(200).json({
        success: true,
        message: "disp list",
        data: rows
      });
    }
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
  }
}




exports.searchDel = async (req, res) => {
  try {
    const { from, to, isWareHouse } = req.query;

    // Query to fetch del_note_mst records without matching gstsalesinvoitem
    let po = `
      SELECT 
        del.id, 
        del.delNoteNo
      FROM 
        del_note_mst del
      INNER JOIN 
        del_note ON del_note.delMstId = del.id
      LEFT JOIN 
        gstsalesinvoitem gsi ON gsi.delDtlId = del_note.id
      WHERE 
        gsi.delDtlId IS NULL
        AND del.status = 0
        AND DATE(del.created_at) >= ?
        AND DATE(del.created_at) <= ?
        AND del.isWareHouse = ?
      GROUP BY 
        del.id
    `;

    let params = [from, to, isWareHouse];

    const [rows] = await connection.execute(po, params);

    return res.status(200).json({
      success: true,
      message: "DelNote List (Not Joined with GST Sales)",
      data: rows,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "An error occurred",
    });
  }
};



// ******************************     DC SELECTION          ****************************************//




exports.getFgDc = async (req, res) => {
  let conn;
  try {
    const customerId = req.params.id;
    const payloadData = req.body.poItemId;

    /* -------------------- VALIDATION -------------------- */
    if (!Array.isArray(payloadData) || payloadData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing payload data",
      });
    }

    /* -------------------- MAP invQty -------------------- */
    const invQtyMap = {};
    payloadData.forEach(itm => {
      invQtyMap[itm.id] = Number(itm.invQty) || 0;
    });

    const poItemIds = payloadData.map(itm => itm.id);

    conn = await connection.getConnection();

    /* -------------------- QUERY -------------------- */
    const fetchQuery = `
      SELECT DISTINCT 
        fi.id,
        fi.fgitemCode,
        fi.dcItemCode AS itemCode,
        fi.uom,
        fi.qty AS perQty,

        poi.id AS poItemId,
        poi.purchase_order_id,
        poi.Qty,
        poi.pendQty,
        poi.PartName AS itemName,

        po.poNo,
        po.sodigit
      FROM fg_ItemList fi
      INNER JOIN purchas_order_item poi ON poi.id = fi.poItemsId
      INNER JOIN purchase_order po ON po.id = poi.purchase_order_id
      INNER JOIN customer_dc cdc ON cdc.cust = po.customer
      WHERE po.customer = ?
        AND poi.id IN (?)
    `;

    const [results] = await conn.query(fetchQuery, [
      customerId,
      poItemIds
    ]);

    if (!results.length) {
      return res.status(404).json({
        success: false,
        message: "No FG items found for the given criteria.",
      });
    }

    /* -------------------- BUSINESS LOGIC -------------------- */
    results.forEach(row => {
      const invQty = invQtyMap[row.poItemId] || 0;

      row.invQty = invQty;
      row.qty = row.perQty * invQty;
      row.reqQty = row.qty;
      row.balQty = row.qty;
      row.shortage = null;
    });

    return res.status(200).json({
      success: true,
      message: "FG list fetched successfully",
      data: results,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "An internal server error occurred",
    });
  } finally {
    if (conn) conn.release();
  }
};



exports.pendingDc = async (req, res) => {
  let conn;
  try {
    const customerId = req.params.id;
    const items = req.body.poItemId; // array of poi.id

    conn = await connection.getConnection();

    let fetch = `
      SELECT   
        cdc.id,
        cdc.cdcNo,
        cdc.cust_Dc_no,
        DATE_FORMAT(cdc.customerDcDate, '%d-%m-%Y') AS customerDcDate
      FROM customer_dc cdc
      INNER JOIN customer_dc_parts cdcp ON cdcp.CDC_no = cdc.id  
      INNER JOIN fg_itemlist fi ON fi.custDcItemsId = cdcp.id  
      INNER JOIN purchas_order_item poi ON poi.id = fi.poItemsId
      WHERE cdc.cust = ?
        AND cdcp.pendQty > 0
    `;

    const params = [customerId];

    // Apply item filter only if provided
    if (Array.isArray(items) && items.length > 0) {
      fetch += ` AND poi.id IN (?)`;
      params.push(items);
    }

    fetch += ` GROUP BY cdc.id ORDER BY cdc.id DESC`;

    const [results] = await conn.query(fetch, params);

    if (!results.length) {
      return handleErrorResponse(res, "No pending DCs found for the given criteria.", 404);
    }

    return handleSuccessResponse(res, "DC list fetched successfully.", results);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};



exports.getFgDcAll = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const id = req.params.id;

    const query = `
      SELECT   
        i.itemCode, i.itemName, il.name AS itemLedger, po.sodigit AS soNo, po.poNo, poi.SchDate AS schDate, poi.pendQty, poi.invQty,
        cdcp.qty AS Qty, cdcp.rate AS stdRate, cdcp.uom, cdcp.id AS cdcItmId, cdc.cdcNo, cdc.cust_Dc_no, cdc.po_ref, cdc.customerDcDate,
        fi.fgitemCode, fi.flag, fi.qty, fi.qty * poi.invQty AS adjQty, (fi.qty * poi.invQty) * cdcp.rate AS amt
      FROM customer_dc_parts cdcp
      INNER JOIN items i ON i.itemCode = cdcp.partno  
      INNER JOIN customer_dc cdc ON cdc.id = cdcp.CDC_no   
      INNER JOIN fg_itemlist fi ON fi.custDcItemsId = cdcp.id  
      INNER JOIN purchas_order_item poi ON poi.id = fi.poItemsId
      INNER JOIN purchase_order po ON po.id = poi.purchase_order_id   
      LEFT JOIN item_under_ledger il ON il.id = i.underLedger
      WHERE cdcp.CDC_no = ? 
        AND cdcp.pendQty > 0
    `;

    const [rows] = await conn.query(query, [id]);

    rows.forEach((row, index) => {
      row.id = index + 1;
      row.slNo = index + 1;
      row.selected = false;
    });

    return handleSuccessResponse(res, "FG list fetched successfully", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};


// ******************************             E-INVOICE               ****************************************//

exports.einvoice = async (req, res) => {
  try {
    const { isPending, from, to } = req.body;

    // Base SQL Query
    let sqlQuery = `
      SELECT 
        gst.id, gst.type, gst.invNo, gst.gstNo, 'INV' AS docType, 
        ROUND(gst.invValue, 2) AS totalValue, gst.invoiceGen, gst.trType,
        c.cName, c.cCode, DATE_FORMAT(gst.date, '%d-%m-%Y') AS date,
        e.Status, e.IRN, e.AckNo, e.AckDt, e.EwbNo
      FROM 
        gstsalesinvo gst
      INNER JOIN 
        customer AS c ON c.cId = gst.custName
      LEFT JOIN
        gst_einvoice_data AS e ON e.gstInvId = gst.id  
      WHERE  
        gst.dflag = 0
    `;

    const params = [];
    const conditions = [];

    // Filter by date range if provided
    if (from && to) {
      conditions.push(`DATE(gst.created_at) >= ? AND DATE(gst.created_at) <= ?`);
      params.push(from, to);
    }

    // Handle isPending conditions
    if (isPending === true) {
      // Show only records where gst.invoiceGen = 0
      conditions.push(`gst.invoiceGen = 0`);
    }

    // If neither "from/to" nor "isPending" is provided, default to today's date
    if (!(from && to) && isPending === undefined) {
      conditions.push(`DATE(gst.created_at) = CURDATE()`);
    }

    // Append conditions to SQL query
    if (conditions.length > 0) {
      sqlQuery += ` AND ` + conditions.join(` AND `);
    }

    sqlQuery += ' ORDER BY gst.id';

    // Execute the SQL query
    const [rows] = await connection.execute(sqlQuery, params);

    // Add serial number
    rows.forEach((row, index) => {
      row.sNo = index + 1;
    });

    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching e-invoice data:", err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};







exports.makeInvoice = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {

    const ids = req.body.polist; // Array of IDs
    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid invoice list" });
    }

    const placeholders = ids.map(() => "?").join(",");


    // Fetch invoices
    const fetchInvoices = `
      SELECT 
        gst.id, gst.invNo, gst.supplyTypeCode, gst.reverseCharge, gst.stateCode AS cStateCode, gst.vechileNO,
        DATE_FORMAT(gst.date, '%d/%m/%Y') AS date, t.transportName, t.gstin, gst.modeOfType, gst.trType, gst.distKms,
        gst.CGSTPer, gst.SGSTPer, gst.IGSTPer, gst.UTGSTPer, gst.tcsPer, gst.taxableValueforGST, gst.amtOfGstPay, gst.subChargeOnTcs, 
        gst.totalValue, gst.lessDisc, gst.lessOther, gst.subTotAfterDisc, gst.roundOff, gst.shipAdd, gst.shipPincode,
        gst.packingForw, gst.transportCharges, gst.Insurance, gst.custMeterialValue, gst.AmmortisationCost, 
        gst.tcsPer, gst.subChargeOnTcsPer, gst.cessOnTcsPer, gst.tcs, gst.subChargeOnTcs, gst.cessOnTcs,

        TRIM(CONCAT(
          COALESCE(c.cAddress1, ''), ' ',
          COALESCE(c.cAddress2, ''), ' ',
          COALESCE(c.cAddress3, ''), ' ',
          COALESCE(c.cAddress4, '')
        )) AS cAddress, c.cName, c.cCode, c.city AS cCity, c.state AS cState, c.pinCode AS cPincode, c.gstNo AS cGstNo, 
        d.code AS dispatchCode, d.name AS dispatchName, d.city, d.state, d.stateCode, d.pinCode,  
        TRIM(CONCAT(
          COALESCE(d.add1, ''), ' ',
          COALESCE(d.add2, ''), ' ',
          COALESCE(d.add3, ''), ' ',
          COALESCE(d.add4, '')
        )) AS dispatchAddress     
      FROM gstsalesinvo gst 
        INNER JOIN customer c ON c.cId = gst.custName  
        LEFT JOIN dispatch_mst d ON d.id = gst.dispatchId  
        LEFT JOIN mst_transport t ON t.id = gst.transporter  
      WHERE gst.id IN (${placeholders})
    `;

    const [invoiceResults] = await conn.query(fetchInvoices, ids);
    if (invoiceResults.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Invoices not found" });
    }

    // Fetch items
    const fetchItems = `
      SELECT 
        gstItem.id AS SlNo, gstItem.partName, gstItem.uom, i.id AS itemId, i.itemCode, i.itemName,
        gstItem.invRate, gstItem.invAmt, gstItem.invQty, gstItem.hsnCode,
        gstItem.gstsalesinvo_id, COUNT(*) OVER() AS totalCount
      FROM gstsalesinvoitem gstItem 
      INNER JOIN gstsalesinvo gst ON gst.id = gstItem.gstsalesinvo_id  
      INNER JOIN items i ON i.itemCode = gstItem.partNo  
      WHERE gstItem.gstsalesinvo_id IN (${placeholders})
    `;

    const [itemResults] = await conn.query(fetchItems, ids);

    // Fetch company address dynamically
    const companyQuery = `
      SELECT 
        cd.companyName, cd.address, cd.gstNo, cd.city,  cd.pincode, cd.stateCode
      FROM company_details cd
      LIMIT 1
    `;

    const [companyRows] = await conn.query(companyQuery);
    if (!companyRows.length) {
      return res.status(404).json({ success: false, message: "Company details not found" });
    }

    const company = companyRows[0];


    // Build invoice map
    const invoiceMap = {};
    for (const inv of invoiceResults) {
      invoiceMap[inv.id] = {
        gstInvId: inv.id,
        TranDtls: {
          TaxSch: "GST",
          SupTyp: inv.supplyTypeCode,
          RegRev: inv.reverseCharge,
          name: inv.transportName,
        },
        DocDtls: {
          Typ: "INV",
          No: inv.invNo,
          Dt: inv.date,
        },
        // SellerDtls: {
        //   Gstin: "29AAICM4744Q1ZM",
        //   LglNm: "MALLIK ENGINEERING (INDIA) PVT. LTD.",
        //   Addr1:
        //     "Plot No. 126, Road No 3, KIADB Industrial Estate II Phase, Jigani Industrial Area, Jigani,Anekal Taluk",
        //   Loc: "Bengaluru",
        //   Pin: 560105,
        //   Stcd: "29",
        // },

        SellerDtls: {
          Gstin: company.gstNo || "",
          LglNm: company.companyName || "",
          Addr1: company.address || "",
          Loc: company.city || "",
          Pin: Number(company.pincode) || 0,
          Stcd: company.stateCode || "",
        },

        valDtls: {
          AssVal: 0,
          CgstVal: 0,
          SgstVal: 0,
          IgstVal: 0,
          utgstVal: 0,
          tcsVal: 0,
          Discount: 0,
          OthChrg: 0,
          packingForw: Number(inv.packingForw),
          transportCharges: Number(inv.transportCharges),
          Insurance: inv.Insurance,
          custMeterialValue: Number(inv.custMeterialValue),
          AmmortisationCost: Number(inv.AmmortisationCost),
          tcs: Number(inv.tcs) || 0,
          subChargeOnTcs: Number(inv.subChargeOnTcs) || 0,
          cessOnTcs: Number(inv.cessOnTcs) || 0,
          tcsPer: inv.tcsPer,
          subChargeOnTcsPer: inv.subChargeOnTcsPer,
          cessOnTcsPer: inv.cessOnTcsPer,
          RndOffAmt: inv.roundOff,
          TotInvVal: 0,
          CGSTPer: parseFloat(inv.CGSTPer) || 0,
          SGSTPer: parseFloat(inv.SGSTPer) || 0,
          IGSTPer: parseFloat(inv.IGSTPer) || 0,
          UTGSTPer: parseFloat(inv.UTGSTPer) || 0,
        },
        BuyerDtls: {
          Gstin: inv.cGstNo,
          LglNm: inv.cName,
          Pos: inv.cStateCode,
          cCode: inv.cCode,
          Addr1: inv.cAddress,
          Loc: inv.cCity,
          state: inv.cState,
          Pin: inv.cPincode,
          Stcd: inv.cStateCode,
        },
        ...(inv.trType == 2 || inv.trType == 4
          ? {
            ShipDtls: {
              Gstin: inv.cGstNo,
              LglNm: inv.cName,
              Addr1: inv.shipAdd,
              Loc: inv.cCity,
              Pin: inv.shipPincode,
              Stcd: inv.cStateCode,
            },
          }
          : {}),
        EwbDtls: {
          TransId: inv.gstin,
          TransName: inv.transportName,
          TransMode: inv.modeOfType,
          Distance: inv.distKms,
          VehNo: inv.vechileNO,
          VehType: inv.modeOfType == 1 ? "R" : "O",
        },
        ...(inv.trType == 3 || inv.trType == 4
          ? {
            DispDtls: {
              Nm: inv.dispatchName?.trim() || "N/A",
              code: inv.dispatchCode?.trim() || "N/A",
              Addr1: inv.dispatchAddress?.trim() || "N/A",
              Loc: inv.city?.trim() || "N/A",
              state: inv.state?.trim() || "N/A",
              Pin: inv.pinCode,
              Stcd: inv.stateCode?.trim() || "N/A",
            },
          }
          : {}),
        ItemList: [],
      };
    }

    // -------------------------------
    // Process items
    // -------------------------------
    const itemCountMap = {};
    for (const it of itemResults) {
      itemCountMap[it.gstsalesinvo_id] =
        (itemCountMap[it.gstsalesinvo_id] || 0) + 1;
    }


    for (const it of itemResults) {
      const inv = invoiceMap[it.gstsalesinvo_id];
      if (!inv) continue;

      const totalItems = itemCountMap[it.gstsalesinvo_id] || 1;

      // Sum of all additional charges
      const totalOthChrg =
        (inv.valDtls.OthChrg || 0) +
        (inv.valDtls.packingForw || 0) +
        (inv.valDtls.transportCharges || 0) +
        (inv.valDtls.custMeterialValue || 0) +
        (inv.valDtls.AmmortisationCost || 0) +
        (inv.valDtls.tcs || 0) +
        (inv.valDtls.subChargeOnTcs || 0) +
        (inv.valDtls.cessOnTcs || 0);

      // Distribute equally across items
      const dividedOthChrg = totalOthChrg / totalItems;

      // const dividedOthChrg = (inv.valDtls.OthChrg || 0) / totalItems;

      const invAmt = parseFloat(it.invAmt) || 0;

      let cgstAmt = 0, sgstAmt = 0, igstAmt = 0;

      if (inv.valDtls.IGSTPer && inv.valDtls.IGSTPer > 0) {
        // IGST calculation
        igstAmt = parseFloat(((invAmt * inv.valDtls.IGSTPer) / 100).toFixed(2));
      } else {
        // CGST + SGST calculation
        cgstAmt = parseFloat(((invAmt * inv.valDtls.CGSTPer) / 100).toFixed(2));
        sgstAmt = parseFloat(((invAmt * inv.valDtls.SGSTPer) / 100).toFixed(2));
      }

      const totItemVal = parseFloat(
        (invAmt + cgstAmt + sgstAmt + igstAmt + dividedOthChrg).toFixed(2)
      );

      const itemObj = {
        SlNo: it.SlNo,
        itemCount: it.totalCount,
        ItemNo: it.itemId,
        IsServc: "N",
        PrdDesc: `${it.itemCode} - ${it.partName}`,
        HsnCd: it.hsnCode,
        Qty: it.invQty,
        FreeQty: 0,
        Unit: it.uom,
        // UnitPrice: it.invRate,
        // TotAmt: it.invAmt,
        // Discount: 0,
        // PreTaxVal: it.invAmt,
        // AssAmt: it.invAmt,
        // GstRt: inv.valDtls.IGSTPer > 0 ? inv.valDtls.IGSTPer : (inv.valDtls.CGSTPer + inv.valDtls.SGSTPer),
        // CgstAmt: cgstAmt,
        // SgstAmt: sgstAmt,
        // IgstAmt: igstAmt,
        // TotItemVal: totItemVal,
        // OthChrg: parseFloat(dividedOthChrg.toFixed(2)),
        UnitPrice: Number(parseFloat(it.invRate).toFixed(2)),
        TotAmt: Number(parseFloat(it.invAmt).toFixed(2)),
        Discount: 0,
        PreTaxVal: Number(parseFloat(it.invAmt).toFixed(2)),
        AssAmt: Number(parseFloat(it.invAmt).toFixed(2)),
        GstRt: inv.valDtls.IGSTPer > 0 ? inv.valDtls.IGSTPer : (inv.valDtls.CGSTPer + inv.valDtls.SGSTPer),
        CgstAmt: cgstAmt,
        SgstAmt: sgstAmt,
        IgstAmt: igstAmt,
        TotItemVal: totItemVal,
        OthChrg: parseFloat(dividedOthChrg.toFixed(2)),
      };

      inv.ItemList.push(itemObj);

      inv.valDtls.AssVal = parseFloat(
        (Number(inv.valDtls.AssVal) + Number(itemObj.AssAmt)).toFixed(2)
      );
      inv.valDtls.CgstVal = parseFloat(
        (Number(inv.valDtls.CgstVal) + Number(cgstAmt)).toFixed(2)
      );
      inv.valDtls.SgstVal = parseFloat(
        (Number(inv.valDtls.SgstVal) + Number(sgstAmt)).toFixed(2)
      );
      inv.valDtls.IgstVal = parseFloat(
        (Number(inv.valDtls.IgstVal) + Number(igstAmt)).toFixed(2)
      );
      inv.valDtls.Discount = parseFloat(
        (Number(inv.valDtls.Discount) + Number(itemObj.Discount)).toFixed(2)
      );
      inv.valDtls.TotInvVal = parseFloat(
        (Number(inv.valDtls.TotInvVal) + Number(itemObj.TotItemVal)).toFixed(2)
      );

    }


    // -------------------------------
    // Final round-off adjustment
    // -------------------------------
    for (const inv of Object.values(invoiceMap)) {
      const dbRoundOff = parseFloat(inv.valDtls.RndOffAmt || 0);
      const originalTotal = parseFloat(inv.valDtls.TotInvVal || 0);
      const finalTotal = Math.round(originalTotal + dbRoundOff);

      inv.valDtls.RndOffAmt = dbRoundOff;
      inv.valDtls.TotInvVal = finalTotal;
    }

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: "Po list",
      data: Object.values(invoiceMap),
    });
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

//enable when trType 3 or 4 is required for dispatch details in the invoice. Currently, it is commented out for simplicity.
// exports.makeInvoice = async (req, res) => {
//   const conn = await connection.getConnection();
//   await conn.beginTransaction();

//   try {

//     const ids = req.body.polist; // Array of IDs
//     if (!Array.isArray(ids) || ids.length === 0) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid invoice list" });
//     }

//     const placeholders = ids.map(() => "?").join(",");



//     // Fetch invoices
//     const fetchInvoices = `
//       SELECT
//         gst.id, gst.invNo, gst.supplyTypeCode, gst.reverseCharge, gst.stateCode AS cStateCode, gst.vechileNO,
//         DATE_FORMAT(gst.date, '%d/%m/%Y') AS date, t.transportName, t.gstin, gst.modeOfType, gst.trType, gst.distKms,
//         gst.CGSTPer, gst.SGSTPer, gst.IGSTPer, gst.UTGSTPer, gst.tcsPer, gst.taxableValueforGST, gst.amtOfGstPay, gst.subChargeOnTcs,
//         gst.totalValue, gst.lessDisc, gst.lessOther, gst.subTotAfterDisc, gst.roundOff, gst.shipAdd, gst.shipPincode,
//         gst.packingForw, gst.transportCharges, gst.Insurance, gst.custMeterialValue, gst.AmmortisationCost,
//         gst.tcsPer, gst.subChargeOnTcsPer, gst.cessOnTcsPer, gst.tcs, gst.subChargeOnTcs, gst.cessOnTcs,

//         TRIM(CONCAT(
//           COALESCE(c.cAddress1, ''), ' ',
//           COALESCE(c.cAddress2, ''), ' ',
//           COALESCE(c.cAddress3, ''), ' ',
//           COALESCE(c.cAddress4, '')
//         )) AS cAddress, c.cName, c.cCode, c.city AS cCity, c.state AS cState, c.pinCode AS cPincode, c.gstNo AS cGstNo,
//         d.code AS dispatchCode, d.name AS dispatchName, d.city, d.state, d.stateCode, d.pinCode,
//         TRIM(CONCAT(
//           COALESCE(d.add1, ''), ' ',
//           COALESCE(d.add2, ''), ' ',
//           COALESCE(d.add3, ''), ' ',
//           COALESCE(d.add4, '')
//         )) AS dispatchAddress
//       FROM gstsalesinvo gst
//         INNER JOIN customer c ON c.cId = gst.custName
//         LEFT JOIN dispatch_mst d ON d.id = gst.dispatchId
//         LEFT JOIN mst_transport t ON t.id = gst.transporter
//       WHERE gst.id IN (${placeholders})
//     `;

//     const [invoiceResults] = await conn.query(fetchInvoices, ids);
//     if (invoiceResults.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Invoices not found" });
//     }

//     // Fetch items
//     const fetchItems = `
//       SELECT
//         gstItem.id AS SlNo, gstItem.partName, gstItem.uom, i.id AS itemId, i.itemCode, i.itemName,
//         gstItem.invRate, gstItem.invAmt, gstItem.invQty, gstItem.hsnCode,
//         gstItem.gstsalesinvo_id, COUNT(*) OVER() AS totalCount
//       FROM gstsalesinvoitem gstItem
//       INNER JOIN gstsalesinvo gst ON gst.id = gstItem.gstsalesinvo_id
//       INNER JOIN items i ON i.itemCode = gstItem.partNo
//       WHERE gstItem.gstsalesinvo_id IN (${placeholders})
//     `;

//     const [itemResults] = await conn.query(fetchItems, ids);

//     // Fetch company address dynamically
//     const companyQuery = `
//       SELECT
//         cd.companyName, cd.address, cd.gstNo, cd.city,  cd.pincode, cd.stateCode
//       FROM company_details cd
//       LIMIT 1
//     `;

//     const [companyRows] = await conn.query(companyQuery);
//     if (!companyRows.length) {
//       return res.status(404).json({ success: false, message: "Company details not found" });
//     }

//     const company = companyRows[0];



//     // Build invoice map
//     const invoiceMap = {};
//     for (const inv of invoiceResults) {
//       invoiceMap[inv.id] = {
//         gstInvId: inv.id,
//         TranDtls: {
//           TaxSch: "GST",
//           SupTyp: inv.supplyTypeCode,
//           RegRev: inv.reverseCharge,
//           name: inv.transportName,
//         },
//         DocDtls: {
//           Typ: "INV",
//           No: inv.invNo,
//           Dt: inv.date,
//         },

//         SellerDtls: {
//           Gstin: company.gstNo || "",
//           LglNm: company.companyName || "",
//           Addr1: company.address || "",
//           Loc: company.city || "",
//           Pin: Number(company.pincode) || 0,
//           Stcd: company.stateCode || "",
//         },

//         valDtls: {
//           AssVal: 0,
//           CgstVal: 0,
//           SgstVal: 0,
//           IgstVal: 0,
//           utgstVal: 0,
//           tcsVal: 0,
//           Discount: 0,
//           OthChrg: 0,
//           packingForw: Number(inv.packingForw),
//           transportCharges: Number(inv.transportCharges),
//           Insurance: inv.Insurance,
//           custMeterialValue: Number(inv.custMeterialValue),
//           AmmortisationCost: Number(inv.AmmortisationCost),
//           tcs: Number(inv.tcs) || 0,
//           subChargeOnTcs: Number(inv.subChargeOnTcs) || 0,
//           cessOnTcs: Number(inv.cessOnTcs) || 0,
//           tcsPer: inv.tcsPer,
//           subChargeOnTcsPer: inv.subChargeOnTcsPer,
//           cessOnTcsPer: inv.cessOnTcsPer,
//           RndOffAmt: inv.roundOff,
//           TotInvVal: 0,
//           CGSTPer: parseFloat(inv.CGSTPer) || 0,
//           SGSTPer: parseFloat(inv.SGSTPer) || 0,
//           IGSTPer: parseFloat(inv.IGSTPer) || 0,
//           UTGSTPer: parseFloat(inv.UTGSTPer) || 0,
//         },
//         BuyerDtls: {
//           Gstin: inv.cGstNo,
//           LglNm: inv.cName,
//           Pos: inv.cStateCode,
//           cCode: inv.cCode,
//           Addr1: inv.cAddress,
//           Loc: inv.cCity,
//           state: inv.cState,
//           Pin: inv.cPincode,
//           Stcd: inv.cStateCode,
//         },
//         // ShipDtls intentionally omitted (1 Aug 2026 GSTN/NIC change):
//         // our Ship-to data is always sourced from the same customer record as
//         // BuyerDtls, so ShipDtls.Gstin would always equal BuyerDtls.Gstin.
//         // The circular disallows Bill-to GSTIN == Ship-to GSTIN, and explicitly
//         // treats "goods delivered to Bill-to party" as not requiring a Ship-to
//         // block. If a genuine third-party ship-to is ever captured separately,
//         // reintroduce ShipDtls sourced from that data instead of the customer table.
//         EwbDtls: {
//           TransId: inv.gstin,
//           TransName: inv.transportName,
//           TransMode: inv.modeOfType,
//           Distance: inv.distKms,
//           VehNo: inv.vechileNO,
//           VehType: inv.modeOfType == 1 ? "R" : "O",
//         },
//         ...(inv.trType == 3 || inv.trType == 4
//           ? {
//             DispDtls: {
//               Nm: inv.dispatchName?.trim() || "N/A",
//               code: inv.dispatchCode?.trim() || "N/A",
//               Addr1: inv.dispatchAddress?.trim() || "N/A",
//               Loc: inv.city?.trim() || "N/A",
//               state: inv.state?.trim() || "N/A",
//               Pin: inv.pinCode,
//               Stcd: inv.stateCode?.trim() || "N/A",
//             },
//           }
//           : {}),
//         ItemList: [],
//       };
//     }

//     // -------------------------------
//     // Process items
//     // -------------------------------
//     const itemCountMap = {};
//     for (const it of itemResults) {
//       itemCountMap[it.gstsalesinvo_id] =
//         (itemCountMap[it.gstsalesinvo_id] || 0) + 1;
//     }



//     for (const it of itemResults) {
//       const inv = invoiceMap[it.gstsalesinvo_id];
//       if (!inv) continue;

//       const totalItems = itemCountMap[it.gstsalesinvo_id] || 1;

//       // Sum of all additional charges
//       const totalOthChrg =
//         (inv.valDtls.OthChrg || 0) +
//         (inv.valDtls.packingForw || 0) +
//         (inv.valDtls.transportCharges || 0) +
//         (inv.valDtls.custMeterialValue || 0) +
//         (inv.valDtls.AmmortisationCost || 0) +
//         (inv.valDtls.tcs || 0) +
//         (inv.valDtls.subChargeOnTcs || 0) +
//         (inv.valDtls.cessOnTcs || 0);

//       // Distribute equally across items
//       const dividedOthChrg = totalOthChrg / totalItems;

//       const invAmt = parseFloat(it.invAmt) || 0;

//       let cgstAmt = 0, sgstAmt = 0, igstAmt = 0;

//       if (inv.valDtls.IGSTPer && inv.valDtls.IGSTPer > 0) {
//         // IGST calculation
//         igstAmt = parseFloat(((invAmt * inv.valDtls.IGSTPer) / 100).toFixed(2));
//       } else {
//         // CGST + SGST calculation
//         cgstAmt = parseFloat(((invAmt * inv.valDtls.CGSTPer) / 100).toFixed(2));
//         sgstAmt = parseFloat(((invAmt * inv.valDtls.SGSTPer) / 100).toFixed(2));
//       }

//       const totItemVal = parseFloat(
//         (invAmt + cgstAmt + sgstAmt + igstAmt + dividedOthChrg).toFixed(2)
//       );

//       const itemObj = {
//         SlNo: it.SlNo,
//         itemCount: it.totalCount,
//         ItemNo: it.itemId,
//         IsServc: "N",
//         PrdDesc: `${it.itemCode} - ${it.partName}`,
//         HsnCd: it.hsnCode,
//         Qty: it.invQty,
//         FreeQty: 0,
//         Unit: it.uom,
//         UnitPrice: Number(parseFloat(it.invRate).toFixed(2)),
//         TotAmt: Number(parseFloat(it.invAmt).toFixed(2)),
//         Discount: 0,
//         PreTaxVal: Number(parseFloat(it.invAmt).toFixed(2)),
//         AssAmt: Number(parseFloat(it.invAmt).toFixed(2)),
//         GstRt: inv.valDtls.IGSTPer > 0 ? inv.valDtls.IGSTPer : (inv.valDtls.CGSTPer + inv.valDtls.SGSTPer),
//         CgstAmt: cgstAmt,
//         SgstAmt: sgstAmt,
//         IgstAmt: igstAmt,
//         TotItemVal: totItemVal,
//         OthChrg: parseFloat(dividedOthChrg.toFixed(2)),
//       };

//       inv.ItemList.push(itemObj);

//       inv.valDtls.AssVal = parseFloat(
//         (Number(inv.valDtls.AssVal) + Number(itemObj.AssAmt)).toFixed(2)
//       );
//       inv.valDtls.CgstVal = parseFloat(
//         (Number(inv.valDtls.CgstVal) + Number(cgstAmt)).toFixed(2)
//       );
//       inv.valDtls.SgstVal = parseFloat(
//         (Number(inv.valDtls.SgstVal) + Number(sgstAmt)).toFixed(2)
//       );
//       inv.valDtls.IgstVal = parseFloat(
//         (Number(inv.valDtls.IgstVal) + Number(igstAmt)).toFixed(2)
//       );
//       inv.valDtls.Discount = parseFloat(
//         (Number(inv.valDtls.Discount) + Number(itemObj.Discount)).toFixed(2)
//       );
//       inv.valDtls.TotInvVal = parseFloat(
//         (Number(inv.valDtls.TotInvVal) + Number(itemObj.TotItemVal)).toFixed(2)
//       );

//     }



//     // -------------------------------
//     // Final round-off adjustment
//     // -------------------------------
//     for (const inv of Object.values(invoiceMap)) {
//       const dbRoundOff = parseFloat(inv.valDtls.RndOffAmt || 0);
//       const originalTotal = parseFloat(inv.valDtls.TotInvVal || 0);
//       const finalTotal = Math.round(originalTotal + dbRoundOff);

//       inv.valDtls.RndOffAmt = dbRoundOff;
//       inv.valDtls.TotInvVal = finalTotal;
//     }

//     await conn.commit();

//     return res.status(200).json({
//       success: true,
//       message: "Po list",
//       data: Object.values(invoiceMap),
//     });
//   } catch (err) {
//     await conn.rollback();
//     return handleErrorResponse(res, err);
//   } finally {
//     conn.release();
//   }
// };

exports.saveEinvoice = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const data = req.body;
    const user = req.headers.username;
    const prefix = "https://my.gstzen.in";

    // Construct full image URL
    const qrImageUrl = `${prefix}${data.SignedQrCodeImgUrl}`;

    const qrImage = await utility.urlSaveDownload(qrImageUrl, 'qr_images');

    // //console.log("qrImage", qrImage);
    // Check if gstInvId already exists
    const [existingRecord] = await connection.execute(
      `SELECT gstInvId FROM gst_einvoice_data WHERE gstInvId = ?`,
      [data.gstInvId]
    );

    if (existingRecord.length > 0) {
      // Update existing record
      await connection.execute(
        `UPDATE gst_einvoice_data SET 
          distance = ?, Irn = ?, AckDt = ?, AckNo = ?, EwbDt = ?, EwbNo = ?, Status = ?, Remarks = ?, 
          AckNoStr = ?, EwbValidTill = ?, uuid = ?, SignedQrCodeImgUrl = ?, InvoicePdfUrl = ?, 
          EWayBillPdfUrl = ?, EWayBillQrCodeUrl = ?, DigitallySignedInvoicePdfUrl = ?, EWayBillBarCodeUrl = ?, 
          EWayBillPartaSlipPdfUrl = ?, IrnStatus = ?, EwbStatus = ?, Irp = ?, IrpPortal = ?, EwbPortal = ?, 
          addedBy = ? 
        WHERE gstInvId = ?`,
        [
          data.distance, data.Irn, data.AckDt, data.AckNo, data.EwbDt, data.EwbNo, data.Status, data.Remarks,
          data.AckNoStr, data.EwbValidTill, data.uuid, qrImage, data.InvoicePdfUrl,
          data.EWayBillPdfUrl, data.EWayBillQrCodeUrl, data.DigitallySignedInvoicePdfUrl,
          data.EWayBillBarCodeUrl, data.EWayBillPartaSlipPdfUrl, data.IrnStatus, data.EwbStatus,
          data.Irp, data.IrpPortal, data.EwbPortal, user, data.gstInvId
        ]
      );
    } else {
      // Insert new record
      await connection.execute(
        `INSERT INTO gst_einvoice_data (
          gstInvId, distance, Irn, AckDt, AckNo, EwbDt, EwbNo, Status, Remarks, AckNoStr, 
          EwbValidTill, uuid, SignedQrCodeImgUrl, InvoicePdfUrl, EWayBillPdfUrl, EWayBillQrCodeUrl, 
          DigitallySignedInvoicePdfUrl, EWayBillBarCodeUrl, EWayBillPartaSlipPdfUrl, IrnStatus, 
          EwbStatus, Irp, IrpPortal, EwbPortal, addedBy) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.gstInvId, data.distance, data.Irn, data.AckDt, data.AckNo, data.EwbDt, data.EwbNo, data.Status,
          data.Remarks, data.AckNoStr, data.EwbValidTill, data.uuid, qrImage, data.InvoicePdfUrl,
          data.EWayBillPdfUrl, data.EWayBillQrCodeUrl, data.DigitallySignedInvoicePdfUrl, data.EWayBillBarCodeUrl,
          data.EWayBillPartaSlipPdfUrl, data.IrnStatus, data.EwbStatus, data.Irp, data.IrpPortal, data.EwbPortal, user
        ]
      );
    }

    // Update gstsalesinvo table
    await connection.execute(
      `UPDATE gstsalesinvo SET invoiceGen = ? WHERE id = ?`,
      [data.status, data.gstInvId]
    );

    await conn.commit();
    return handleSuccessResponse(res, "Data Stored successfully.");
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


exports.showInvoice = async (req, res) => {
  try {
    const id = req.params.id;

    const fetchQuery =
      `SELECT gEinv.*, DATE_FORMAT(gEinv.created_at, '%d-%m-%Y') AS eInvDate,
            DATE_FORMAT(gst.date, '%d-%m-%Y') AS gstDate, gst.invSt, gst.type, gst.invNo, gst.addedBy As gstBy, gst.invoiceGen,
            c.cCode, c.cName, c.gstNo, c.id AS custId
          FROM gst_einvoice_data gEinv
          INNER JOIN gstsalesinvo gst ON gst.id = gEinv.gstInvId
          INNER JOIN customer c ON c.id = gst.custName
        
      `;
    const [rows] = await connection.execute(fetchQuery, [id]);

    return res.status(200).json({
      success: true,
      message: 'Geneated Invoice List',
      data: rows
    });
  } catch (err) {
    handleErrorResponse(res, err);
  }
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, (w) =>
    w.charAt(0).toUpperCase() + w.substring(1).toLowerCase()
  );
}


// GST calcualtion for Invoice
const gstCalculation = (GD, items) => {
  let { lessDisc, lessOther, packingForw, transportCharges, Insurance, custMeterialValue, AmmortisationCost, CGSTPer, SGSTPer, tcsPer, IGSTPer, subChargeOnTcsPer, cessOnTcsPer } = GD;

  let { totQty, totAmt } = items.reduce(
    (acc, { invQty, amt }) => {
      acc.totQty += Number(invQty) || 0;
      acc.totAmt += parseFloat(amt) || 0;
      return acc;
    },
    { totQty: 0, totAmt: 0 }
  );

  let calculations = {
    totalQty: totQty,
    taxableValueforGST: parseFloat(totAmt.toFixed(2))
  };

  if (lessDisc) totAmt -= parseFloat(lessDisc);
  if (lessOther) totAmt -= parseFloat(lessOther);
  calculations.afterDiscounts = parseFloat(totAmt.toFixed(2));

  if (packingForw) totAmt += parseFloat(packingForw);
  if (transportCharges) totAmt += parseFloat(transportCharges);
  calculations.afterAdditionalCharges = parseFloat(totAmt.toFixed(2));

  if (Insurance) totAmt += parseFloat(((totAmt * parseFloat(Insurance)) / 100).toFixed(2));
  if (custMeterialValue) totAmt += parseFloat(custMeterialValue);
  if (AmmortisationCost) totAmt += parseFloat(AmmortisationCost);
  calculations.amountForGSTpayable = parseFloat(totAmt.toFixed(2));

  // let cgstAmount = 0, sgstAmount = 0;
  // if (CGSTPer) {
  //   cgstAmount = parseFloat(((totAmt * Number(CGSTPer)) / 100).toFixed(2));
  // }
  // if (SGSTPer) {
  //   sgstAmount = parseFloat(((totAmt * Number(SGSTPer)) / 100).toFixed(2));
  // }
  // totAmt += (cgstAmount + sgstAmount);

  // calculations.cgstAmount = cgstAmount;
  // calculations.sgstAmount = sgstAmount;
  // calculations.afterGST = parseFloat(totAmt.toFixed(2));

  let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;  // ← add igstAmount

  if (CGSTPer) {
    cgstAmount = parseFloat(((totAmt * Number(CGSTPer)) / 100).toFixed(2));
  }
  if (SGSTPer) {
    sgstAmount = parseFloat(((totAmt * Number(SGSTPer)) / 100).toFixed(2));
  }
  if (IGSTPer) {  // ← add this block
    igstAmount = parseFloat(((totAmt * Number(IGSTPer)) / 100).toFixed(2));
  }

  totAmt += (cgstAmount + sgstAmount + igstAmount);  // ← include igstAmount

  calculations.cgstAmount = cgstAmount;
  calculations.sgstAmount = sgstAmount;
  calculations.igstAmount = igstAmount;  // ← add to returned calculations
  calculations.afterGST = parseFloat(totAmt.toFixed(2));

  if (custMeterialValue) totAmt -= parseFloat(custMeterialValue);
  if (AmmortisationCost) totAmt -= parseFloat(AmmortisationCost);

  let tcsAmount = 0, subTcsAmount = 0, cessAmount = 0;
  if (tcsPer) {
    tcsAmount = parseFloat(((totAmt * tcsPer) / 100).toFixed(2));
  }
  if (subChargeOnTcsPer) {
    subTcsAmount = parseFloat(((tcsAmount * subChargeOnTcsPer) / 100).toFixed(2));
  }
  if (cessOnTcsPer) {
    cessAmount = parseFloat((((tcsAmount + subTcsAmount) * cessOnTcsPer) / 100).toFixed(2));
  }
  totAmt += (tcsAmount + subTcsAmount + cessAmount);
  calculations.tcsAmount = tcsAmount;
  calculations.subTcsAmount = subTcsAmount;
  calculations.cessAmount = cessAmount;

  totAmt = parseFloat(totAmt.toFixed(2));

  const roundedAmount = Math.round(totAmt);
  const roundDiff = parseFloat((roundedAmount - totAmt).toFixed(2));

  calculations.totalAmount = totAmt;
  calculations.roundDiff = roundDiff;
  calculations.invoiceAmount = roundedAmount;
  // calculations.totalInWords = toTitleCase(roundedAmount);
  let words = String(toWords(roundedAmount));
  calculations.totalInWords = toTitleCase(words);


  return calculations;
};

const groupItemsByPO = (items, singleOrder, maxLineItem) => {
  if (!Array.isArray(items) || items.length === 0) return {};
  if (maxLineItem === 0) {
    maxLineItem = items.length;
  }
  const groupedItems = {};

  if (singleOrder === "N") {
    // Single Order Mode: Group items into batches of maxLineItem
    let batchIndex = 1;
    let tempBatch = [];

    items.forEach((item) => {
      if (tempBatch.length < maxLineItem) {
        tempBatch.push(item);
      } else {
        groupedItems[`Batch_${batchIndex}`] = tempBatch;
        tempBatch = [item]; // Start new batch
        batchIndex++;
      }
    });

    if (tempBatch.length) groupedItems[`Batch_${batchIndex}`] = tempBatch;
  } else {
    // Multi-PO Mode: Group by PO with maxLineItem constraint
    items.forEach((item) => {
      const poKey = item.poNo;
      if (!groupedItems[poKey]) groupedItems[poKey] = [[]];

      let lastBatch = groupedItems[poKey][groupedItems[poKey].length - 1];

      if (lastBatch.length < maxLineItem) {
        lastBatch.push(item);
      } else {
        groupedItems[poKey].push([item]); // Start a new batch
      }
    });

    // Rename keys (e.g., PO1_1, PO1_2, ...)
    const finalGroupedItems = {};
    Object.entries(groupedItems).forEach(([poNo, batches]) => {
      batches.forEach((batch, index) => {
        finalGroupedItems[`${poNo}_${index + 1}`] = batch;
      });
    });

    return Object.values(finalGroupedItems);
  }

  return Object.values(groupedItems);
};


// exports.insertGSTSalesInvoice = async (req, res) => {
//   const conn = await connection.getConnection();
//   await conn.beginTransaction();

//   try {
//     const { gstOrderData: GD, gstOrderItemData: gstItems } = req.body;

//     if (!gstItems || !Array.isArray(gstItems) || gstItems.length === 0) {
//       throw new CustomError("Please select Items", 400);
//     }
//     const [custRows] = await connection.execute(`
//       SELECT id, singleSaleOrd as singleOrder, maxLineItem FROM customer WHERE id = ?`
//       , [GD.custName]
//     );

//     if (!custRows.length) {
//       throw new CustomError("Customer not found", 404);
//     }
//     const { singleOrder, maxLineItem = 0 } = custRows[0];

//     const itemsList = groupItemsByPO(gstItems, singleOrder, parseInt(maxLineItem));

//     const invoiceQuery = `
//       INSERT INTO gstsalesinvo (
//         invSt, invNo, type, invCode, date, custName, billAdd, shipAdd, invoIssuDate, dcNO, dcDate, modelOfDis, vechileNO, custPoNo, Consignee, gstNo,
//         panNo, trType, modeOfType, docketNo, traDate, transporter, TransporterGSTIN, distKms, shipPincode, stateCode, actualToState, goodsOrService,
//         labourCharge, labourCrgesHdingReqed, reverseCharge, supplyTypeCode, dcSelectionRequired, dispatchFrom, dispatchId, resonForNoTax, resonForNoduty, remrk1, remrk2, remrk3, remrk4, remrk5,
//         dcDetails, dutyInwords, lessDisc, lessOther, packingForw, transportCharges, 
//         Insurance, custMeterialValue, AmmortisationCost, CGSTPer, SGSTPer, IGSTPer, UTGST, UTGSTPer, tcsPer,
//         subChargeOnTcsPer, cessOnTcsPer, allTcsTotal, dcSelected, addedBy,
//         totalQty, taxableValueforGST, subTotAfterDisc, subtotal, amtOfGstPay, CGST, SGST, IGST, totGst, tcs, subChargeOnTcs, cessOnTcs, totalValue, roundOff, invValue, totalInWords
//       ) 
//       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
//     `;
//     const invoiceValues = [
//       GD.type, GD.invCode, GD.date, GD.custName, GD.billAdd, GD.shipAdd, GD.invoIssuDate, GD.dcNO, GD.dcDate, GD.modelOfDis, GD.vechileNO, GD.custPoNo, GD.Consignee, GD.gstNo, GD.panNo, GD.trType,
//       GD.modeOfType, GD.docketNo, GD.traDate, GD.transporter, GD.TransporterGSTIN, GD.distKms, GD.shipPincode, GD.stateCode, GD.actualToState, GD.goodsOrService, GD.labourCharge, GD.labourCrgesHdingReqed,
//       GD.reverseCharge, GD.supplyTypeCode, GD.dcSelectionRequired, GD.dispatchFrom, GD.dispatchId, GD.resonForNoTax, GD.resonForNoduty, GD.remrk1, GD.remrk2, GD.remrk3, GD.remrk4, GD.remrk5, GD.dcDetails, GD.dutyInwords, GD.lessDisc,
//       GD.lessOther, GD.packingForw, GD.transportCharges, GD.Insurance, GD.custMeterialValue, GD.AmmortisationCost, GD.CGSTPer, GD.SGSTPer, GD.IGSTPer, GD.UTGST, GD.UTGSTPer, GD.tcsPer, GD.subChargeOnTcsPer,
//       GD.cessOnTcsPer, GD.allTcsTotal, GD.dcSelected, req.headers.username
//     ];

//     const [docPrefix, incNo] = [GD.invNo.split(GD.invSt)[0], GD.invSt]
//     let gstIncNo = Number(incNo);

   

//     for (let itemsArr of itemsList) {

//       // Validate quantities for ALL items (including -DC)
//       for (const dt of itemsArr) {
//         const invQty = parseFloat(dt.invQty);
//         const soQty = parseFloat(dt.Qty);

//         if (invQty > soQty) {
//           throw new CustomError(
//             `InvQty: ${invQty} cannot be greater than SoQty: ${soQty} for Item Code: ${dt.itemCode}`,
//             400
//           );
//         }

//         if (invQty <= 0) {
//           throw new CustomError(
//             `InvQty Can't be 0 for Item Code: ${dt.itemCode}`,
//             400
//           );
//         }
//       }

//       // ✅ Separate -DC items — include in INSERT but exclude from GST calculation
//       const calcItems = itemsArr.filter(dt => !dt.itemCode.endsWith('-DC'));
//       // itemsArr still has ALL items (including -DC) for DB insert

//       const invSt = String(gstIncNo).padStart(incNo.length, '0');
//       const invNo = `${docPrefix}${invSt}`;

//       // ✅ Pass only non-DC items to GST calculation
//       const GC = gstCalculation(GD, calcItems);
//       const gstValues = [
//         GC.totalQty, GC.taxableValueforGST, GC.afterDiscounts, GC.afterAdditionalCharges,
//         GC.amountForGSTpayable, GC.cgstAmount, GC.sgstAmount, GC.igstAmount, GC.afterGST,
//         GC.tcsAmount, GC.subTcsAmount, GC.cessAmount, GC.totalAmount,
//         GC.roundDiff, GC.invoiceAmount, GC.totalInWords
//       ];

//       const [gstRows] = await conn.execute(invoiceQuery, [invSt, invNo, ...invoiceValues, ...gstValues]);

//       if (gstRows.affectedRows === 0) {
//         throw new CustomError(`Error inserting into gstsalesinvo for ${invNo}`, 500);
//       }
//       const invoiceID = gstRows.insertId;

//       // ✅ Insert ALL items including -DC rows
//       await conn.query(
//         `INSERT INTO gstsalesinvoItem (gstsalesinvo_id, partNo, partName, uom, soNo, poNo, poId, poItemId, soQty, cumQty, pendQty, hsnCode, schDate, invQty, invRate, invAmt, itemLedger, descOfPackage, cdcItmId, fgitemCode, nrdc, delMstId, delDtlId) VALUES ?`,
//         [itemsArr.map((dt) => [
//           invoiceID, dt.itemCode, dt.itemName, dt.uom, dt.soNo, dt.poNo, dt.poId, dt.poItemId, dt.Qty, dt.cumQty ?? 0, dt.pendQty,
//           dt.hsnCode, dt.schDate, (dt.cdcItmId && dt.cdcItmId !== '' && dt.cdcItmId !== 0 ? dt.adjQty : dt.invQty), dt.stdRate, dt.amt, dt.itemLedger, dt.descOfPackage, dt.cdcItmId, dt.itemCode, dt.nrdc, dt.delMstId, dt.delDtlId
//         ])]
//       );
//       gstIncNo++;
//       await updateDocCounter(conn, 'GSTSalesinvoice');
//     }

//     await conn.commit();
//     return handleSuccessResponse(res, "Data inserted successfully.");
//   } catch (err) {
//     await conn.rollback();
//     return handleErrorResponse(res, err);
//   } finally {
//     conn.release();
//   }
// };


exports.insertGSTSalesInvoice = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const { gstOrderData: GD, gstOrderItemData: gstItems } = req.body;

    if (!gstItems || !Array.isArray(gstItems) || gstItems.length === 0) {
      throw new CustomError("Please select Items", 400);
    }
    const [custRows] = await connection.execute(`
      SELECT id, singleSaleOrd as singleOrder, maxLineItem FROM customer WHERE id = ?`
      , [GD.custName]
    );

    if (!custRows.length) {
      throw new CustomError("Customer not found", 404);
    }
    const { singleOrder, maxLineItem = 0 } = custRows[0];

    const itemsList = groupItemsByPO(gstItems, singleOrder, parseInt(maxLineItem));

    const invoiceQuery = `
      INSERT INTO gstsalesinvo (
        invSt, invNo, type, invCode, date, custName, billAdd, shipAdd, invoIssuDate, dcNO, dcDate, modelOfDis, vechileNO, custPoNo, Consignee, gstNo,
        panNo, trType, modeOfType, docketNo, traDate, transporter, TransporterGSTIN, distKms, shipPincode, stateCode, actualToState, goodsOrService,
        labourCharge, labourCrgesHdingReqed, reverseCharge, supplyTypeCode, dcSelectionRequired, dispatchFrom, dispatchId, resonForNoTax, resonForNoduty, remrk1, remrk2, remrk3, remrk4, remrk5,
        dcDetails, dutyInwords, lessDisc, lessOther, packingForw, transportCharges, 
        Insurance, custMeterialValue, AmmortisationCost, CGSTPer, SGSTPer, IGSTPer, UTGST, UTGSTPer, tcsPer,
        subChargeOnTcsPer, cessOnTcsPer, allTcsTotal, dcSelected, addedBy,
        totalQty, taxableValueforGST, subTotAfterDisc, subtotal, amtOfGstPay, CGST, SGST, IGST, totGst, tcs, subChargeOnTcs, cessOnTcs, totalValue, roundOff, invValue, totalInWords
      ) 
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;
    const invoiceValues = [
      GD.type, GD.invCode, GD.date, GD.custName, GD.billAdd, GD.shipAdd, GD.invoIssuDate, GD.dcNO, GD.dcDate, GD.modelOfDis, GD.vechileNO, GD.custPoNo, GD.Consignee, GD.gstNo, GD.panNo, GD.trType,
      GD.modeOfType, GD.docketNo, GD.traDate, GD.transporter, GD.TransporterGSTIN, GD.distKms, GD.shipPincode, GD.stateCode, GD.actualToState, GD.goodsOrService, GD.labourCharge, GD.labourCrgesHdingReqed,
      GD.reverseCharge, GD.supplyTypeCode, GD.dcSelectionRequired, GD.dispatchFrom, GD.dispatchId, GD.resonForNoTax, GD.resonForNoduty, GD.remrk1, GD.remrk2, GD.remrk3, GD.remrk4, GD.remrk5, GD.dcDetails, GD.dutyInwords, GD.lessDisc,
      GD.lessOther, GD.packingForw, GD.transportCharges, GD.Insurance, GD.custMeterialValue, GD.AmmortisationCost, GD.CGSTPer, GD.SGSTPer, GD.IGSTPer, GD.UTGST, GD.UTGSTPer, GD.tcsPer, GD.subChargeOnTcsPer,
      GD.cessOnTcsPer, GD.allTcsTotal, GD.dcSelected, req.headers.username
    ];

    // const [yr, type, index] = GD.invNo.split('/');
    // const prefix = `${yr}/${type}`;
    // let uniqueIndex = Number(index);
    if (!GD.invNo || String(GD.invNo).startsWith('undefined')) {
      throw new CustomError("Invalid invoice number: cannot be undefined or start with 'undefined'", 400);
    }
    if (GD.invSt === undefined || GD.invSt === null || String(GD.invSt) === '') {
      throw new CustomError("Invalid invoice starting number (invSt)", 400);
    }

    const invNoStr = String(GD.invNo);
    const invStStr = String(GD.invSt);

    let docPrefix = '';
    if (invNoStr.endsWith(invStStr)) {
      docPrefix = invNoStr.substring(0, invNoStr.length - invStStr.length);
    } else {
      const lastIndex = invNoStr.lastIndexOf(invStStr);
      if (lastIndex !== -1) {
        docPrefix = invNoStr.substring(0, lastIndex);
      } else {
        docPrefix = invNoStr.split(invStStr)[0] || '';
      }
    }

    if (docPrefix.startsWith('undefined')) {
      throw new CustomError("Invalid invoice number format: generated prefix cannot start with 'undefined'", 400);
    }

    const incNo = invStStr;
    let gstIncNo = Number(incNo);


    for (let itemsArr of itemsList) {

      // Validate quantities for ALL items (including -DC)
      for (const dt of itemsArr) {
        const invQty = parseFloat(dt.invQty);
        const soQty = parseFloat(dt.Qty);

        if (invQty > soQty) {
          throw new CustomError(
            `InvQty: ${invQty} cannot be greater than SoQty: ${soQty} for Item Code: ${dt.itemCode}`,
            400
          );
        }

        if (invQty <= 0) {
          throw new CustomError(
            `InvQty Can't be 0 for Item Code: ${dt.itemCode}`,
            400
          );
        }
      }

      // ✅ Separate -DC items — include in INSERT but exclude from GST calculation
      const calcItems = itemsArr.filter(dt => !dt.itemCode.endsWith('-DC'));
      // itemsArr still has ALL items (including -DC) for DB insert

      const invSt = String(gstIncNo).padStart(incNo.length, '0');
      const invNo = `${docPrefix}${invSt}`;

      // ✅ Pass only non-DC items to GST calculation
      const GC = gstCalculation(GD, calcItems);
      const gstValues = [
        GC.totalQty, GC.taxableValueforGST, GC.afterDiscounts, GC.afterAdditionalCharges,
        GC.amountForGSTpayable, GC.cgstAmount, GC.sgstAmount, GC.igstAmount, GC.afterGST,
        GC.tcsAmount, GC.subTcsAmount, GC.cessAmount, GC.totalAmount,
        GC.roundDiff, GC.invoiceAmount, GC.totalInWords
      ];

      const [gstRows] = await conn.execute(invoiceQuery, [invSt, invNo, ...invoiceValues, ...gstValues]);

      if (gstRows.affectedRows === 0) {
        throw new CustomError(`Error inserting into gstsalesinvo for ${invNo}`, 500);
      }
      const invoiceID = gstRows.insertId;

      // ✅ Insert ALL items including -DC rows
      await conn.query(
        `INSERT INTO gstsalesinvoItem (gstsalesinvo_id, partNo, partName, uom, soNo, poNo, poId, poItemId, soQty, cumQty, pendQty, hsnCode, schDate, invQty, invRate, invAmt, itemLedger, descOfPackage, cdcItmId, fgitemCode, nrdc, delMstId, delDtlId) VALUES ?`,
        [itemsArr.map((dt) => [
          invoiceID, dt.itemCode, dt.itemName, dt.uom, dt.soNo, dt.poNo, dt.poId, dt.poItemId, dt.Qty, dt.cumQty ?? 0, dt.pendQty,
          dt.hsnCode, dt.schDate, (dt.cdcItmId && dt.cdcItmId !== '' && dt.cdcItmId !== 0 ? dt.adjQty : dt.invQty), dt.stdRate, dt.amt, dt.itemLedger, dt.descOfPackage, dt.cdcItmId, dt.itemCode, dt.nrdc, dt.delMstId, dt.delDtlId
        ])]
      );

      gstIncNo++;
      await updateDocCounter(conn, 'GSTSalesinvoice');
    }

    await conn.commit();
    return handleSuccessResponse(res, "Data inserted successfully.");
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


exports.fetchGSTInvoice = async (req, res) => {
  try {
    const { fromDate, toDate, rangeFrom, rangeTo, isPrinted } = req.query;

    let whereClause = rangeFrom && rangeTo ? `g.invSt >= ? AND g.invSt <= ?` : `DATE(g.created_at) BETWEEN ? AND ?`;
    whereClause += isPrinted === 'false' ? ` AND g.isPrinted = 0` : ``; // Include printed docs if isPrinted is true
    const values = rangeFrom && rangeTo ? [Number(rangeFrom), Number(rangeTo)] : [fromDate, toDate];

    const fetch = `
      SELECT g.id, g.invSt, g.invNo, g.custPoNo, DATE_FORMAT(g.date, '%d-%m-%Y') AS invDate, invValue, c.cCode as custCode,
        CASE WHEN g.isPrinted = 1 THEN 'YES' ELSE 'NO' END AS printedStatus,
        inv.Irn, inv.AckNo, inv.AckDt, inv.EwbNo, inv.EwbDt, inv.EwbStatus
      FROM gstsalesinvo g
      LEFT JOIN customer c ON c.id = g.custName
      LEFT JOIN gst_einvoice_data inv ON inv.gstInvId = g.id
      WHERE ${whereClause}
    `;
    const [rows] = await connection.execute(fetch, values);

    return handleSuccessResponse(res, "Invoice List", rows);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}

exports.updateInovicePrintStatus = async (req, res) => {
  try {
    const { invoiceIds } = req.body;

    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      throw new CustomError(`Invoice IDs are required`, 400);
    }

    const [rows] = await connection.execute(`
      UPDATE gstsalesinvo SET isPrinted = 1 WHERE id IN (${invoiceIds.map(() => '?').join(',')})`,
      invoiceIds
    );

    return handleSuccessResponse(res, "Successfully updated", rows);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}




exports.getDispatchList = async (req, res) => {
  try {
    const query = `
      SELECT 
        disp.id, disp.code, disp.name,
        CONCAT('GST Sale Invoice-', disp.code) AS document
      
      FROM 
        dispatch_mst disp 
      WHERE 
        dflag = 0
    `;

    const [rows] = await connection.execute(query);

    return res.status(200).json({
      success: true,
      message: "disp list",
      data: rows
    });
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


//  gsi.itemLedger,
exports.multiInvoiceXml = async (req, res) => {
  try {
    const { customer, option, from, to } = req.body;

    let sqlQuery = `
      SELECT 
        gst.id, gst.invNo, gst.gstNo, ROUND(gst.invValue, 2) AS totalValue, gst.invoiceGen, gst.trType, gst.isCancelAuth,
        DATE_FORMAT(gst.date, '%d-%m-%Y') AS date, CONCAT(gst.invNo, '/',DATE_FORMAT(gst.date, '%d-%m-%Y')) AS refNo, c.creditday,
        c.cName, c.cCode, il.code As itemLedger, gst.taxableValueforGST, gst.CGSTPer, gst.CGST, gst.SGSTPer, gst.SGST, gst.packingForw,
        gst.transportCharges, gst.UTGSTPer, gst.UTGST, gst.totalValue, gst.roundOff, disp.code,
        GROUP_CONCAT(gsi.partNo SEPARATOR ', ') AS partNos,
        CONCAT(
          po.poNo, '; ', 
          DATE_FORMAT(po.poDate, '%d-%m-%Y'), ', ',
          GROUP_CONCAT(CONCAT(gsi.partNo, ', ', gsi.invQty) SEPARATOR ', ')
        ) AS narration
      FROM 
        gstsalesinvo gst
      INNER JOIN 
        customer AS c ON c.cId = gst.custName
      INNER JOIN 
        gstsalesinvoitem AS gsi ON gsi.gstsalesinvo_id = gst.id  
      INNER JOIN 
        purchase_order AS po ON po.id = gsi.poId    
      INNER JOIN 
        purchas_order_item AS poi ON poi.id = gsi.poItemId 
      INNER JOIN 
        item_under_ledger AS il ON il.name = gsi.itemLedger      
      LEFT JOIN 
         dispatch_mst disp ON disp.id = gst.dispatchId
      WHERE   
        gst.dflag = 0
    `;


    const params = [];
    const conditions = [];

    // Filter by date range if provided
    if (from && to) {
      conditions.push(`DATE(gst.date) >= ? AND DATE(gst.date) <= ?`);
      params.push(from, to);
    }

    if (customer) {
      conditions.push(`c.id = ?`);
      params.push(customer);
    }

    // // Handle dispatch filter if option is passed
    // if (option) {
    //   conditions.push(`gst.dispatchCode = ?`);
    //   params.push(option);
    // }

    if (Array.isArray(option) && option.length > 0) {
      const placeholders = option.map(() => '?').join(', ');
      conditions.push(`disp.code IN (${placeholders})`);
      params.push(...option);
    }


    // If no from/to provided, default to today's date
    if (!(from && to)) {
      conditions.push(`DATE(gst.date) = CURDATE()`);
    }

    // Append conditions to SQL query
    if (conditions.length > 0) {
      sqlQuery += ` AND ` + conditions.join(` AND `);
    }

    sqlQuery += ` GROUP BY gst.id`;

    // Execute the SQL query
    const [rows] = await connection.execute(sqlQuery, params);

    // Add serial number
    rows.forEach((row, index) => {
      row.sNo = index + 1;
      // row.document = doc || null; // Added document key from request body
      row.document = `GST Sale Invoice - ${row.code || ''}`;


    });

    return res.status(200).json({
      success: true,
      message: "E-Invoice data",

      data: rows
    });
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.gstzenFix = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    await conn.beginTransaction();

    const axios = require("axios");

    const response = await axios.post(
      "https://my.gstzen.in/~gstzen/a/post-einvoice-data/einvoice-json/",
      req.body,
      {

        headers: {
          "Content-Type": "application/json",
          "Token": process.env.GSTZEN_IRP_TOKEN  //  exactly like frontend
        },
        timeout: 30000
      }
    );

    // If IRN generated successfully, commit
    await conn.commit();

    return res.json(response.data);

  } catch (error) {
    await conn.rollback();

    console.error(
      "GSTZEN E-INVOICE ERROR:",
      error?.response?.data || error.message
    );

    return res.status(500).json(
      error?.response?.data || {
        status: 0,
        message: "GSTZEN API error"
      }
    );

  } finally {
    conn.release();
  }
};




exports.jsonDoc = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();
    const invoiceId = req.params.id;
    const companyData = await company();

    const invoiceQuery = `
      SELECT gst.id,gst.invNo,DATE_FORMAT(gst.date,'%d/%m/%Y') AS date,
      gst.taxableValueforGST,gst.CGST,gst.SGST,gst.IGST,gst.invValue,
      c.cName,c.city,c.state,c.pinCode,c.gstNo
      FROM gstsalesinvo gst
      INNER JOIN customer c ON c.cId=gst.custName
      WHERE gst.id=?
    `;
    const [invoiceRows] = await conn.query(invoiceQuery, [invoiceId]);
    if (!invoiceRows.length) {
      return handleErrorResponse(res, new Error("Invoice not found"));
    }
    const invoice = invoiceRows[0];

    const itemQuery = `
      SELECT partNo,partName,hsnCode,invQty,uom,invAmt AS taxableValue
      FROM gstsalesinvoItem
      WHERE gstsalesinvo_id=? AND dflag!=1 AND partNo NOT LIKE '%-DC'
    `;
    const [items] = await conn.query(itemQuery, [invoiceId]);

    const taxableTotal = Number(invoice.taxableValueforGST || 0);
    const cgstRate = taxableTotal > 0 ? (Number(invoice.CGST || 0) / taxableTotal) * 100 : 0;
    const sgstRate = taxableTotal > 0 ? (Number(invoice.SGST || 0) / taxableTotal) * 100 : 0;
    const igstRate = taxableTotal > 0 ? (Number(invoice.IGST || 0) / taxableTotal) * 100 : 0;

    const itemList = items.map((item, index) => ({
      itemNo: index + 1,
      productName: item.partNo,
      productDesc: item.partName,
      hsnCode: Number(item.hsnCode) || 0,
      quantity: Number(item.invQty).toFixed(2),
      qtyUnit: item.uom || "NOS",
      taxableAmount: Number(item.taxableValue || 0).toFixed(4),
      sgstRate: sgstRate.toFixed(2),
      cgstRate: cgstRate.toFixed(2),
      igstRate: igstRate.toFixed(2),
      cessRate: 0,
      cessNonAdvol: 0
    }));

    const fromAddr1 = companyData?.name || "";
    const fromAddr2 = companyData?.address || "";

    const response = {
      version: "1.0.0219",
      billLists: [{
        userGstin: companyData?.gstNo || "",
        supplyType: "O",
        subSupplyType: 1,
        docType: "INV",
        docNo: invoice.invNo,
        docDate: invoice.date,
        transType: 1,
        fromGstin: companyData?.gstNo || "",
        fromTrdName: companyData?.name || "",
        fromAddr1,
        fromAddr2,
        fromPlace: companyData?.city || "",
        fromPincode: Number(companyData?.pinCode) || 0,
        fromStateCode: Number(companyData?.stateCode) || 0,
        actualFromStateCode: Number(companyData?.stateCode) || 0,
        toGstin: invoice.gstNo || "",
        toTrdName: invoice.cName || "",
        toAddr1: invoice.city || "",
        toAddr2: invoice.state || "",
        toPlace: invoice.city || "",
        toPincode: Number(invoice.pinCode) || 0,
        toStateCode: Number(invoice.state) || 0,
        actualToStateCode: Number(invoice.state) || 0,
        totalValue: Number(invoice.taxableValueforGST || 0).toFixed(2),
        cgstValue: Number(invoice.CGST || 0).toFixed(2),
        sgstValue: Number(invoice.SGST || 0).toFixed(2),
        igstValue: Number(invoice.IGST || 0).toFixed(2),
        cessValue: 0,
        TotNonAdvolVal: 0,
        OthValue: 0,
        totInvValue: Number(invoice.invValue || 0).toFixed(2),
        transMode: "1",
        transDistance: 0,
        transporterName: "",
        transporterId: "",
        transDocNo: "",
        transDocDate: invoice.date,
        vehicleNo: "",
        vehicleType: "R",
        mainHsnCode: itemList.length > 0 ? itemList[0].hsnCode : 0,
        itemList
      }]
    };

    return res.status(200).json(response);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};

const utility = require("../utility/utilityFunction");
const excel = require("exceljs");
const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { generateDocNo, updateDocCounter, docNoReset } = require("../utility/docNo");
const { company } = require("../utility/utilityFunction");
const { getFYRange } = require("../../cache/fyRange.cache");

exports.uniqueId = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const { po: customValue } = req.body;

    const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'NonReturnableDC', customValue });

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

exports.insertNonReturnableDCData = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const data = req.body;
    const purchaseOrderData = data.purchaseOrderData;
    const itemData = data.purchaseOrderItemData;

    // Insert common data into NonReturnableDc table
    const insertNonReturnableDCQuery = `
      INSERT INTO NonReturnableDc 
      (digit, nrdcNo, date, custo, billAdd, shipAdd, challenNo, challenDate, 
      modeOfDispatch, vechileNo, consignee, gstno, panNo, sub_supply_type, sub_supply_desc, Doc_Type, 
      Transaction_Type, modeOfType, docketNo, transportDate, transporter, transporterGstin, distanceKms, 
      shippingPincode, toStateCode, actualStateCode, Remarks, poNo, totalQty, total, cgst, sgst, igst, cgstPer, sgstPer, igstPer, totalValue) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    const [insertResult] = await conn.query(insertNonReturnableDCQuery, [
      purchaseOrderData.digit,
      purchaseOrderData.nrdcNo,
      purchaseOrderData.date,
      purchaseOrderData.custo,
      purchaseOrderData.billAdd,
      purchaseOrderData.shipAdd,
      purchaseOrderData.challenNo,
      purchaseOrderData.challenDate,
      purchaseOrderData.modeOfDispatch,
      purchaseOrderData.vechileNo,
      purchaseOrderData.consignee,
      purchaseOrderData.gstno,
      purchaseOrderData.panNo,
      purchaseOrderData.sub_supply_type,
      purchaseOrderData.sub_supply_desc,
      purchaseOrderData.Doc_Type,
      purchaseOrderData.Transaction_Type,
      purchaseOrderData.modeOfType,
      purchaseOrderData.docketNo,
      purchaseOrderData.transportDate,
      purchaseOrderData.transporter,
      purchaseOrderData.transporterGstin,
      purchaseOrderData.distanceKms,
      purchaseOrderData.shippingPincode,
      purchaseOrderData.toStateCode,
      purchaseOrderData.actualStateCode,
      purchaseOrderData.Remarks,
      purchaseOrderData.poNo,
      purchaseOrderData.totalQty,
      purchaseOrderData.total,
      purchaseOrderData.cgst,
      purchaseOrderData.sgst,
      purchaseOrderData.igst,
      purchaseOrderData.cgstPer,
      purchaseOrderData.sgstPer,
      purchaseOrderData.igstPer,
      Math.round(parseFloat(purchaseOrderData.totalValue)),
    ]);

    const lastInsertId = insertResult.insertId;

    // Insert variable data into NonReturnableDcItem table
    const insertNonReturnableDCItemQuery = `
      INSERT INTO NonReturnableDcItem 
      (itemCode, itemName, uom, fgItem, hsnCode, invNo, cdcNo, manualCdcNo, pendQty, nrdcQty, nrdcRate, nrdcAmt, nonDcid) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    for (const item of itemData) {
      // Insert into NonReturnableDcItem
      await conn.query(insertNonReturnableDCItemQuery, [
        item.itemCode,
        item.itemName,
        item.uom,
        item.fgItem,
        item.hsnCode,
        item.invNo,
        item.cdcNo,
        item.cust_Dc_no,
        item.pendQty,
        item.qty,
        item.newRate,
        item.amt,
        lastInsertId,
      ]);
    }

    await updateDocCounter(conn, 'NonReturnableDC');
    await conn.commit();
    return handleSuccessResponse(res, "Data successfully added");

  } catch (err) {
    await conn.rollback();
    console.error("Catch error:", err);
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.updateNonReturnableDCData = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();

    const data = req.body;
    const id = req.params.id;
    const { purchaseOrderData, purchaseOrderItemData } = data;

    // Update NonReturnableDC table
    const updateNonReturnableDCQuery = `
      UPDATE nonreturnabledc 
      SET date = ?, custo = ?, billAdd = ?, shipAdd = ?, challenNo = ?, challenDate = ?, 
          modeOfDispatch = ?, vechileNo = ?, consignee = ?, add1 = ?, add2 = ?, add3 = ?, add4 = ?, 
          gstno = ?, panNo = ?, sub_supply_type = ?, sub_supply_desc = ?, Doc_Type = ?, Transaction_Type = ?, 
          modeOfType = ?, docketNo = ?, transporter = ?, transportDate = ?, transporterGstin = ?, distanceKms = ?, 
          shippingPincode = ?, toStateCode = ?, actualStateCode = ?, Remarks = ?, poNo = ?, totalQty = ?, total = ?, 
          cgst = ?, sgst = ?, igst = ?, cgstPer = ?, sgstPer = ?, igstPer = ?, totalValue = ? 
      WHERE id = ?`;

    await conn.query(updateNonReturnableDCQuery, [
      purchaseOrderData.date,
      purchaseOrderData.custo,
      purchaseOrderData.billAdd,
      purchaseOrderData.shipAdd,
      purchaseOrderData.challenNo,
      purchaseOrderData.challenDate,
      purchaseOrderData.modeOfDispatch,
      purchaseOrderData.vechileNo,
      purchaseOrderData.consignee,
      purchaseOrderData.add1,
      purchaseOrderData.add2,
      purchaseOrderData.add3,
      purchaseOrderData.add4,
      purchaseOrderData.gstno,
      purchaseOrderData.panNo,
      purchaseOrderData.sub_supply_type,
      purchaseOrderData.sub_supply_desc,
      purchaseOrderData.Doc_Type,
      purchaseOrderData.Transaction_Type,
      purchaseOrderData.modeOfType,
      purchaseOrderData.docketNo,
      purchaseOrderData.transporter,
      purchaseOrderData.transportDate,
      purchaseOrderData.transporterGstin,
      purchaseOrderData.distanceKms,
      purchaseOrderData.shippingPincode,
      purchaseOrderData.toStateCode,
      purchaseOrderData.actualStateCode,
      purchaseOrderData.Remarks,
      purchaseOrderData.poNo,
      purchaseOrderData.totalQty,
      purchaseOrderData.total,
      purchaseOrderData.cgst,
      purchaseOrderData.sgst,
      purchaseOrderData.igst,
      purchaseOrderData.cgstPer,
      purchaseOrderData.sgstPer,
      purchaseOrderData.igstPer,
      purchaseOrderData.totalValue,
      id,
    ]);

    // Delete all existing items for this nonDcid
    await conn.query(`DELETE FROM nonreturnabledcitem WHERE nonDcid = ?`, [id]);

    // Insert fresh items
    const insertQuery = `
      INSERT INTO nonreturnabledcitem 
        (nonDcid, itemCode, itemName, uom, fgItem, hsnCode, invNo, cdcNo, manualCdcNo, pendQty, nrdcQty, nrdcRate, nrdcAmt) 
      VALUES ?`;

    const filteredItems = purchaseOrderItemData.filter(item => item.itemCode && item.itemName);

    if (filteredItems.length > 0) {
      const values = filteredItems.map(item => [
        id,
        item.itemCode,
        item.itemName,
        item.uom,
        item.fgItem,
        item.hsnCode,
        item.invNo,
        item.cdcNo,
        item.cust_Dc_no,
        item.qty,
        item.qty,
        item.newRate,
        item.amt,
      ]);
      await conn.query(insertQuery, [values]);
    }

    await conn.commit();
    return handleSuccessResponse(res, "Successfully updated");

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
    const fetch = `
      SELECT ndc.*, c.cCode As custo, c.cName, c.city, c.state, c.country
      FROM nonreturnabledc ndc
      INNER JOIN customer c ON c.cId = ndc.custo 
      WHERE ndc.id = ?
    `;

    const [results] = await connection.execute(fetch, [id]);

    const fetch2 = `
      SELECT
        ndc.id, ndc.nonDcid, ndc.itemCode, ndc.itemName, ndc.uom AS uom, ndc.fgItem AS fgItem, ndc.invNo AS invNo, ndc.hsnCode,
        ndc.cdcNo, ndc.manualCdcNo As cust_Dc_no, ndc.pendQty AS pendingQty, ndc.nrdcQty As qty, ndc.nrdcRate As newRate, ndc.nrdcAmt As amt
      FROM nonreturnabledcitem ndc
      WHERE ndc.nonDcid = ?
    `;

    const [results2] = await connection.execute(fetch2, [id]);

    return handleSuccessResponse(res, "Po list", {
      data: results,
      data2: results2
    });

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.getItems = async (req, res) => {
  try {
    const { type, id } = req.query;
    const { from, to } = getFYRange(req);

    let po = `
      SELECT ndc.*, c.cCode As custo, c.cName, c.id As cust, c.city, c.state, c.country
      FROM nonreturnabledc ndc
      INNER JOIN customer c ON c.cId = ndc.custo
      WHERE ndc.created_at BETWEEN ? AND ?
    `;

    let params = [from, to];

    let poItems = `
      SELECT ndc.id,  ndc.nonDcid,  ndc.itemCode,  ndc.itemName, ndc.uom AS uom, ndc.hsnCode,
        ndc.fgItem AS fgItem, ndc.invNo AS invNo, ndc.cdcNo, ndc.manualCdcNo AS cust_Dc_no,
        ndc.pendQty, ndc.nrdcQty As qty, ndc.nrdcRate As newRate, ndc.nrdcAmt As amt
      FROM nonreturnabledcitem ndc
    `;

    let params2 = [];

    switch (type) {
      case 'first':
        po += ` ORDER BY ndc.id ASC LIMIT 1`;
        break;
      case 'last':
        po += ` ORDER BY ndc.id DESC LIMIT 1`;
        break;
      case 'forward':
        po += ` AND ndc.id > ? ORDER BY ndc.id ASC LIMIT 1`;
        params.push(id);
        break;
      case 'reverse':
        po += ` AND ndc.id < ? ORDER BY ndc.id DESC LIMIT 1`;
        params.push(id);
        break;
    }

    const [rows] = await connection.execute(po, params);

    if (rows.length === 0) {
      return handleSuccessResponse(res, "No data found", { data: [], data2: [] });
    }

    const matchingId = rows[0].id;
    poItems += ` WHERE ndc.nonDcid = ?`;
    params2 = [matchingId];

    const [rows2] = await connection.execute(poItems, params2);

    return res.status(200).json({
      success: true,
      data: rows,
      data2: rows2,
    });

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.downloadTemplate = (req, res) => {
  try {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Template');
    const headers = ['PartNo', 'Qty'];
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };
    const columnSize = 17;
    worksheet.columns.forEach((column) => {
      column.width = columnSize;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Template.xlsx');

    workbook.xlsx.write(res)
      .then(() => {
        res.status(200).end();
      })
      .catch(error => {
        console.error('Error generating template:', error);
        return handleErrorResponse(res, new Error('Error generating template Excel file'));
      });
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.importndc = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const { file } = req.body;
    if (!file) throw new CustomError('No file uploaded', 400);

    const buffer = await utility.decodeBase64(file);
    const workbook = new excel.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(1);
    const items = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        items.push({
          partNo: row.getCell(1).value,
          partName: row.getCell(2).value,
          uom: row.getCell(3).value,
          fgItem: row.getCell(4).value,
          hsnCode: row.getCell(5).value,
          invNo: row.getCell(6).value,
          cdcNo: row.getCell(7).value,
          cust_Dc_no: row.getCell(8).value,
          pendQty: row.getCell(9).value,
          nrdcQty: row.getCell(10).value,
          nrdcRate: row.getCell(11).value,
          nrdcAmt: row.getCell(12).value
        });
      }
    });

    const query = `
      INSERT INTO nonreturnabledcitem (itemCode, itemName, uom, fgItem, hsnCode, invNo, cdcNo, manualCdcNo, pendQty, nrdcQty, nrdcRate, nrdcAmt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const row of items) {
      await conn.execute(query, [
        row.partNo, row.partName, row.uom, row.fgItem, row.hsnCode, row.invNo, row.cdcNo, row.cust_Dc_no, row.pendQty, row.nrdcQty, row.nrdcRate, row.nrdcAmt
      ]);
    }

    await conn.commit();
    return handleSuccessResponse(res, 'File imported successfully');

  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.showaddress = async (req, res) => {
  try {
    const id = req.params.id;
    const fetch = `
      SELECT c.payTerm, c.id, c.cId, c.gstNo, c.city, c.pincode, c.state, c.country, c.panNo, c.email, c.cName,
             TRIM(CONCAT(COALESCE(c.cAddress1, ''), ' ', COALESCE(c.cAddress2, ''), ' ', COALESCE(c.cAddress3, ''), ' ', COALESCE(c.cAddress4, ''))) AS cAddress
      FROM customer c
      WHERE c.cId = ?
    `;

    const [results] = await connection.execute(fetch, [id]);
    return handleSuccessResponse(res, "Customer address list", results);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.importExeldata = async (req, res) => {
  try {
    if (!req.body.file) throw new CustomError("No file uploaded", 400);

    const custId = req.params.id;
    const base64URL = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,";
    const base64Data = req.body.file.replace(base64URL, "");
    const buffer = Buffer.from(base64Data, "base64");

    const workbook = new excel.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(1);

    const sup = [];
    const seenItems = new Set();

    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const itemCode = row.getCell(1).value;
      if (!itemCode) continue;

      if (seenItems.has(itemCode)) throw new CustomError(`Duplicate item code: ${itemCode}`, 400);
      seenItems.add(itemCode);

      const fetch = `
        SELECT cvi.rate as newRate, cvi.hsnCode, cvi.customerDesc, cvi.uom As code, i.id as itemId,
               COALESCE(cvi.customerDesc, i.itemName) AS itemName
        FROM items i
        INNER JOIN cust_vs_item cvi ON cvi.itemId = i.id AND cvi.customerId = ?
        WHERE i.itemCode = ?
      `;

      const [results] = await connection.execute(fetch, [custId, itemCode]);

      if (results.length === 0 || !results[0].newRate) {
        throw new CustomError(`ItemCode not mapped: ${itemCode}`, 404);
      }

      const qty = row.getCell(2).value;
      sup.push({
        itemCode, qty, id: sup.length + 1, match: 0,
        itemName: results[0].itemName, uom: results[0].code, hsnCode: results[0].hsnCode,
        newRate: results[0].newRate, amt: Math.round(qty * results[0].newRate * 100) / 100,
        error: "No",
      });
    }

    return handleSuccessResponse(res, "Excel processed", sup);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.exportndc = async (req, res) => {
  try {
    const id = req.params.id;
    const query = `SELECT * FROM nonreturnabledcitem WHERE nonDcid = ?`;
    const [rows] = await connection.execute(query, [id]);

    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Report');
    const headers = ['Sl.No', 'Part No', 'Part Name', 'UOM', 'Fg Item', 'HsnCode', 'Invoice no', 'cdcNo', 'manualCdcNo', 'Pending Qty', 'NRDC Qty', 'NRDC Rate', 'NRDC Amt'];
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    rows.forEach((row, index) => {
      worksheet.addRow([
        index + 1, row.itemCode, row.itemName, row.uom, row.fgItem, row.hsnCode, row.invNo, row.cdcNo, row.manualCdcNo, row.pendQty, row.nrdcQty, row.nrdcRate, row.nrdcAmt
      ]).alignment = { horizontal: 'left' };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Nonreturnabledc.xlsx');

    return workbook.xlsx.write(res).then(() => res.status(200).end());

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.showAddedNonReturnableDC = async (req, res) => {
  try {
    const fetch = `
      SELECT ndc.id, ndc.custo, ndc.nrdcNo, ndc.poNo, c.cCode, c.cName
      FROM nonreturnabledc ndc
      INNER JOIN customer c ON c.cId = ndc.custo
    `;
    const [results] = await connection.execute(fetch);
    return handleSuccessResponse(res, "NonReturnableDc list", results);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.shownoDcById = async (req, res) => {
  try {
    const id = req.params.id;
    const [results] = await connection.execute(`SELECT * FROM NonReturnableDcItem WHERE nonDcid = ?`, [id]);
    return handleSuccessResponse(res, "NonReturnableDc items", results);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.delete = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();
  try {
    const id = req.params.id;
    if (!id) throw new CustomError("ID is required", 400);

    const [result] = await conn.execute(`DELETE FROM NonReturnableDc WHERE id = ?`, [id]);
    if (result.affectedRows === 0) throw new CustomError("Record not found", 404);

    await docNoReset(conn, req, { docType: 'NonReturnableDC', table: 'nonreturnabledc', col: 'digit' });

    await conn.commit();
    return handleSuccessResponse(res, "Successfully deleted");
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.showitemsbyid = async (req, res) => {
  try {
    const id = req.params.id;
    const fetch = `
      SELECT i.id, po.sino, poi.PartNo, poi.PartName, poi.UOM, i.hsnCode, i.totStk, il.name as ledger, i.stdRate,
             0 as cdcNo, 0 as nrdcrate, 0 as nrdcamt, 0 as fgItem
      FROM purchase_order po
      INNER JOIN purchas_Order_item poi ON poi.purchase_order_id = po.id
      INNER JOIN Customer_dc c ON poi.purchase_order_id = po.id
      INNER JOIN items i ON i.itemCode = poi.PartNo 
      INNER JOIN item_under_ledger il ON il.id = i.underLedger
      WHERE i.itemCode = ?
    `;
    const [results] = await connection.execute(fetch, [id]);
    return handleSuccessResponse(res, "item list", results);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.showitemsbyidinvoice = async (req, res) => {
  try {
    const id = req.params.id;
    const { fromDate, toDate } = req.body;
    if (!fromDate || !toDate) throw new CustomError("Date range required", 400);

    const fetch = `
      SELECT gst.id, gst.invNo, gst.custPoNo, DATE_FORMAT(gst.date, '%d-%m-%Y') AS date, gst.totalValue
      FROM gstsalesinvo gst
      INNER JOIN customer c ON c.cId = gst.custName
      WHERE gst.custName = ? AND DATE(gst.date) BETWEEN ? AND ?
    `;
    const [results] = await connection.execute(fetch, [id, fromDate, toDate]);
    return handleSuccessResponse(res, "Invoice items", results);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.getitemsbyidinvoice = async (req, res) => {
  try {
    const id = req.body.id;
    const fetch1 = `
      SELECT gst.partNo, gst.partName, gst.uom, fg.fgitemCode, gst.hsnCode, gs.invNo, gst.pendQty,
             0 as nrdcrate, 0 as nrdcamt, 0 as fgitemCode, 0 as nrdcqty
      FROM gstsalesinvoItem gst
      INNER JOIN fg_ItemList fg ON fg.custDcItemsId = gst.cdcItmId
      INNER JOIN gstsalesinvo gs ON gs.id = gst.gstsalesinvo_id 
      WHERE gs.id = ?
    `;
    const [results] = await connection.execute(fetch1, [id]);

    const fetch2 = `
      SELECT fi.fgitemCode AS partNo, poi.PartName AS partName, poi.UOM AS uom, gst.hsnCode, gs.invNo, gst.pendQty,
             0 as nrdcrate, 0 as nrdcamt
      FROM fg_itemlist fi
      INNER JOIN gstsalesinvoItem gst ON fi.fgitemCode = gst.fgitemCode
      INNER JOIN gstsalesinvo gs ON gs.id = gst.gstsalesinvo_id 
      INNER JOIN purchas_order_item poi ON poi.id = fi.poItemsId
      WHERE gs.id = ?
    `;
    const [secondResults] = await connection.execute(fetch2, [id]);

    return res.status(200).json({
      success: true,
      message: 'Item list',
      firstQueryResults: results,
      secondQueryResults: secondResults
    })
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.invoiceData = async (req, res) => {
  try {
    const id = req.params.id;
    const companyData = await company();

    const [dc] = await connection.execute(`
      SELECT ndc.*, c.gstNo As gstno, c.cCode, c.cName, c.id As cust, c.city, c.state, c.country,
             DATE_FORMAT(ndc.date, '%d-%m-%Y') AS date,
             DATE_FORMAT(ndc.challenDate, '%d-%m-%Y') AS challenDate,
             DATE_FORMAT(ndc.transportDate, '%d-%m-%Y') AS transportDate
      FROM nonreturnabledc ndc
      INNER JOIN customer c ON c.cId = ndc.custo 
      WHERE ndc.id = ?`, [id]
    );

    if (dc.length === 0) throw new CustomError('NRDC details not found!', 404);

    const [items] = await connection.execute(`
      SELECT ndc.id,  ndc.itemCode,  ndc.itemName, ndc.uom AS uom,
             ndc.fgItem AS fgItem, ndc.invNo AS invNo, ndc.cdcNo , ndc.manualCdcNo AS cust_Dc_no,
             ndc.pendQty AS pendingQty,ndc.nrdcQty,ndc.nrdcRate,ndc.nrdcAmt, ndc.hsnCode, dc.cust_Dc_no
      FROM nonreturnabledcitem ndc
      LEFT JOIN customer_dc dc ON dc.cdcNo = ndc.cdcNo
      WHERE ndc.nonDcid = ? ORDER BY ndc.id`, [dc[0].id]
    );

    items.forEach((element, index) => { element.sNo = index + 1; });
    if (companyData) Object.assign(dc[0], companyData);

    return res.status(200).json({
      success: true,
      message: 'NRDC details',
      data: dc[0],
      data2: items
    })
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

// exports.getData = async (req, res) => {
//   try {
//     const { from, to, item = [], customer = [] } = req.body;
//     let query = `
//       SELECT nri.*, DATE_FORMAT(nrdc.date, '%d-%m-%Y') AS nrdcDate, cdc.cust_Dc_no, DATE_FORMAT(cdc.customerDcDate, '%d-%m-%Y') AS customerDcDate,
//              nrdc.id AS nrdcId, nrdc.digit, nrdc.nrdcNo, nrdc.date, nrdc.custo, c.cName, nrdc.billAdd, nrdc.shipAdd, nrdc.challenNo, nrdc.challenDate, nrdc.modeOfDispatch, nrdc.vechileNo,
//              nrdc.gstno, nrdc.panNo, nrdc.sub_supply_type, nrdc.sub_supply_desc, nrdc.Doc_Type, nrdc.Transaction_Type, nrdc.modeOfType, nrdc.docketNo, nrdc.transportDate, nrdc.transporter,
//              nrdc.transporterGstin, nrdc.distanceKms, nrdc.shippingPincode, nrdc.toStateCode, nrdc.actualStateCode, nrdc.Remarks, nrdc.poNo, nrdc.totalQty,
//              nrdc.total, nrdc.cgstPer, nrdc.cgst, nrdc.sgstPer, nrdc.sgst, nrdc.igstPer, nrdc.igst, nrdc.totalValue
//       FROM nonreturnabledcitem AS nri
//       JOIN nonreturnabledc AS nrdc ON nri.nonDcid = nrdc.id
//       JOIN customer AS c ON nrdc.custo = c.id
//       JOIN items AS i ON nri.itemCode = i.itemCode  
//       LEFT JOIN customer_dc AS cdc ON cdc.id = nri.cdcNo    
//       WHERE 1 = 1
//     `;

//     const queryParams = [];
//     if (from && to) {
//       query += ' AND DATE(nri.created_at) BETWEEN ? AND ?';
//       queryParams.push(from, to);
//     }
//     if (customer.length > 0) {
//       query += ` AND c.id IN (${customer.map(() => '?').join(', ')})`;
//       queryParams.push(...customer);
//     }
//     if (item.length > 0) {
//       query += ` AND i.id IN (${item.map(() => '?').join(', ')})`;
//       queryParams.push(...item);
//     }

//     const [result] = await connection.execute(query, queryParams);
//     return handleSuccessResponse(res, "NRDC Items list", result);
//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };

exports.getData = async (req, res) => {
  try {
    const { from, to, item = [], customer = [] } = req.body;

    let query = `
    SELECT 
        nri.*,

        /* ✅ If nri.nrdcQty is NULL take from invoice item */
        COALESCE(nri.nrdcQty, gsii.invQty) AS nrdcQty,
        COALESCE(nri.nrdcRate, gsii.invRate) AS nrdcRate,

        DATE_FORMAT(nrdc.date, '%d-%m-%Y') AS nrdcDate, 
        cdc.cust_Dc_no,  c.cName, 
        DATE_FORMAT(cdc.customerDcDate, '%d-%m-%Y') AS customerDcDate,

        nrdc.id AS nrdcId, nrdc.digit, nrdc.nrdcNo, nrdc.date, nrdc.custo, nrdc.billAdd,
        nrdc.shipAdd, nrdc.challenNo, nrdc.challenDate, nrdc.modeOfDispatch, nrdc.vechileNo, nrdc.gstno,
        nrdc.panNo, nrdc.sub_supply_type, nrdc.sub_supply_desc, nrdc.Doc_Type, nrdc.Transaction_Type,  
        nrdc.modeOfType,  nrdc.docketNo,  nrdc.transportDate,  nrdc.transporter, nrdc.transporterGstin, 
        nrdc.distanceKms,  nrdc.shippingPincode,  nrdc.toStateCode,  nrdc.actualStateCode, nrdc.Remarks, nrdc.poNo, nrdc.totalQty,
        nrdc.total, nrdc.cgstPer, nrdc.cgst, nrdc.sgstPer, nrdc.sgst, nrdc.igstPer, nrdc.igst, nrdc.totalValue
    FROM nonreturnabledcitem AS nri

    JOIN nonreturnabledc AS nrdc 
        ON nri.nonDcid = nrdc.id

    JOIN customer AS c 
        ON nrdc.custo = c.id

    JOIN items AS i 
        ON (
            CASE 
                WHEN nri.invNo IS NOT NULL 
                    AND nri.cdcNo IS NOT NULL
                    AND nri.itemCode LIKE '%-DC'
                THEN REPLACE(nri.itemCode, '-DC', '')
                ELSE nri.itemCode
            END
        ) = i.itemCode

    LEFT JOIN customer_dc AS cdc 
        ON cdc.id = nri.cdcNo    

    /* ✅ Invoice Join */
    LEFT JOIN gstsalesinvo AS gsi
        ON gsi.invNo = nri.invNo

    LEFT JOIN gstsalesinvoitem AS gsii
        ON gsi.id = gsii.gstsalesinvo_id
        AND gsii.partNo = nri.itemCode

    WHERE 1 = 1
`;

    const queryParams = [];
    if (from && to) {
      query += ' AND DATE(nri.created_at) BETWEEN ? AND ?';
      queryParams.push(from, to);
    }
    if (customer.length > 0) {
      query += ` AND c.id IN (${customer.map(() => '?').join(', ')})`;
      queryParams.push(...customer);
    }
    if (item.length > 0) {
      query += ` AND i.id IN (${item.map(() => '?').join(', ')})`;
      queryParams.push(...item);
    }

    const [result] = await connection.execute(query, queryParams);
    return handleSuccessResponse(res, "NRDC Items list", result);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.pendInvoice = async (req, res) => {
  try {
    const id = req.params.id;
    const { fromDate, toDate } = req.body;
    const [results] = await connection.execute(`
      SELECT po.id, po.invNo, po.totalValue, DATE_FORMAT(po.invoIssuDate, '%d-%m-%Y') AS invoIssuDate
      FROM gstsalesinvo po
      JOIN gstsalesinvoitem poi ON poi.gstsalesinvo_id = po.id
      WHERE po.custName = ? AND poi.created_at BETWEEN ? AND ? AND poi.nrdc = 1
      GROUP BY po.id
    `, [id, fromDate, toDate]);
    return handleSuccessResponse(res, "Pending invoices", results);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.invItems = async (req, res) => {
  try {
    const ids = req.body.items;
    if (!Array.isArray(ids) || ids.length === 0) throw new CustomError("Invalid items array", 400);

    const [results] = await connection.query(`
      SELECT poi.id, poi.partNo AS itemCode, poi.partName AS itemName, poi.uom, poi.fgitemCode, 
             CASE WHEN po.dcSelected = 1 AND poi.partNo NOT LIKE '%-DC' THEN NULL ELSE poi.invQty END AS pendQty, 
             poi.poNo, 
             CASE WHEN po.dcSelected = 1 AND poi.partNo NOT LIKE '%-DC' THEN NULL ELSE poi.invQty END AS qty, 
             CASE WHEN po.dcSelected = 1 AND poi.partNo NOT LIKE '%-DC' THEN NULL ELSE poi.invRate END AS newRate, 
             poi.invAmt AS amt, po.invNo, cdc.cdcNo, fg.fgitemCode AS fgItem, cdc.cust_Dc_no, hsn.name AS hsnCode,
             DATE_FORMAT(po.invoIssuDate, '%d-%m-%Y') AS invoIssuDate
      FROM gstsalesinvo po
      JOIN gstsalesinvoitem poi ON poi.gstsalesinvo_id = po.id
      LEFT JOIN customer_dc_parts cdcp ON cdcp.id = poi.cdcItmId  
      LEFT JOIN items i ON i.itemCode = SUBSTRING_INDEX(poi.partNo, '-DC', 1)  
      LEFT JOIN item_hsn_code hsn ON hsn.id = i.hsnCode      
      LEFT JOIN fg_itemlist fg ON fg.custDcItemsId = cdcp.id    
      LEFT JOIN customer_dc cdc ON cdc.id = cdcp.CDC_no    
      WHERE po.id IN (${ids.map(() => '?').join(', ')})
      GROUP BY poi.id
    `, ids);
    return handleSuccessResponse(res, "Invoice items", results);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};




// exports.jsonDoc = async (req, res) => {
//     try {
//         const { nrdcId } = req.query;

//         const fromGstin = "29AAICM4744Q1ZM";
//         const fromTrdName = "MALLIK ENGINEERING (INDIA) PVT. LTD.";
//         const fromAddr1 = "Plot No. 126, Road No 3, KIADB Industrial Estate,";
//         const fromAddr2 = "II Phase, Jigani Industrial Area, Jigani,Anekal Taluk,Bengaluru - 560105.";
//         const fromPlace = "Bangalore";
//         const fromPincode = 560105;
//         const fromStateCode = 29;
//         const actualFromStateCode = 29;
//         const vechileType = "R";
//         const supplyType = "O";



//         const [nrdc] = await connection.execute(`
//             SELECT 
//                     '${fromGstin}'as userGstin, 
//                     '${supplyType}' as supplyType,
//                     ndc.sub_supply_type as subSupplyType, 
//                     ndc.sub_supply_desc as subSupplyDesc, 
//                     ndc.Doc_Type as docType, 
//                     ndc.nrdcNo as docNo, 
//                     DATE_FORMAT(ndc.created_at, '%d/%m/%Y') AS docDate, 
//                     ndc.Transaction_Type as transType,
//                     '${fromGstin}' as fromGstin, 
//                     '${fromTrdName}' as fromTrdName, 
//                     '${fromAddr1}' as fromAddr1, 
//                     '${fromAddr2}' as fromAddr2,
//                     '${fromPlace}' as fromPlace, 
//                     ${fromPincode} as fromPincode, 
//                     ${fromStateCode} as fromStateCode,
//                     ${actualFromStateCode} as actualFromStateCode,
//                     c.gstNo as toGstin, 
//                     c.cName as toTrdName, 
//                     c.cAddress1 as toAddr1, 
//                     c.cAddress2 as toAddr2,
//                     c.city as toPlace, 
//                     c.pincode as toPincode, 
//                     ndc.toStateCode, 
//                     ndc.actualStateCode As actualToStateCode,
//                     CAST(ndc.total AS DECIMAL(10,2)) AS totalValue,
//                     CAST(ndc.cgst AS DECIMAL(10,2)) AS cgstValue,
//                     CAST(ndc.sgst AS DECIMAL(10,2)) AS sgstValue, 
//                     CAST(ndc.igst AS DECIMAL(10,2)) AS igstValue,
//                     CAST(ndc.total AS DECIMAL(10,2)) AS totInvValue,
//                     0 as cessValue, 0 as TotNonAdvolVal, 0 as OthValue, 
//                     ndc.modeOfType as transMode, 
//                     ndc.distanceKms as transDistance,
//                     tr.transportName as transporterName, 
//                     tr.gstin as transporterId, 
//                     ndc.docketNo as transDocNo, 
//                     '' as transDocDate,
//                     ndc.vechileNo As vehicleNo, 
//                     '${vechileType}'  as vehicleType
//             FROM nonreturnabledc ndc
//             INNER JOIN customer c ON c.id = ndc.custo
//             LEFT JOIN mst_transport tr ON tr.id = ndc.transporter
//             WHERE ndc.id = ?
//         `, [nrdcId]);

//         if (nrdc.length === 0) throw new Error('NRDC details not found!');

//         const header = nrdc[0];

//         // Fix integer fields
//         header.subSupplyType   = parseInt(header.subSupplyType) || 0;
//         header.toStateCode     = parseInt(header.toStateCode);
//         header.actualToStateCode = parseInt(header.actualToStateCode);
//         header.fromStateCode   = parseInt(header.fromStateCode);
//         header.actualFromStateCode = parseInt(header.actualFromStateCode);
//         header.fromPincode     = parseInt(header.fromPincode);
//         header.toPincode       = parseInt(header.toPincode);
//         header.transDistance   = parseInt(header.transDistance) || 0;
//         header.transType       = parseInt(header.transType);

//         // Fix float fields
//         header.totalValue      = parseFloat(header.totalValue);
//         header.cgstValue       = parseFloat(header.cgstValue);
//         header.sgstValue       = parseFloat(header.sgstValue);
//         header.igstValue       = parseFloat(header.igstValue);
//         header.totInvValue     = parseFloat(header.totInvValue);
//         header.cessValue       = parseFloat(header.cessValue) || 0;

//         const [items] = await connection.execute(`
//             SELECT  ndc.itemCode as productName, ndc.itemName as productDesc, ndc.uom as qtyUnit,
//                     CAST(ndc.hsnCode AS UNSIGNED) as hsnCode,
//                     CAST(ndc.nrdcQty AS DECIMAL(10,2)) as quantity,
//                     CAST(ndc.nrdcAmt AS DECIMAL(10,2)) as taxableAmount,
//                     0 as cessRate, 0 as cessNonAdvol
//             FROM nonreturnabledcitem ndc
//             WHERE nonDcid = ?
//         `, [nrdcId]);

//         items.forEach((row, index) => {
//             row.itemNo = index + 1;
//         });

//         if (items.length > 0) {
//             header.mainHsnCode = items[0].hsnCode;
//         }

//         //  Determine tax structure: IGST or SGST/CGST
//         const isIntraState = header.fromStateCode === header.toStateCode;

//         // const itemsWithTax = items.map(item => ({
//         //     ...item,
//         //     sgstRate: isIntraState ? parseFloat(header.sgstValue) : 0,
//         //     cgstRate: isIntraState ? parseFloat(header.cgstValue) : 0,
//         //     igstRate: isIntraState ? 0 : parseFloat(header.igstValue)
//         // }));

//         const itemsWithTax = items.map(item => ({
//           ...item,
//           quantity:      parseFloat(item.quantity),      //  number
//           taxableAmount: parseFloat(item.taxableAmount), //  number
//           hsnCode:       parseInt(item.hsnCode),         //  integer
//           cessRate:      parseFloat(item.cessRate) || 0,
//           cessNonAdvol:  parseFloat(item.cessNonAdvol) || 0,
//           sgstRate: isIntraState ? parseFloat(header.sgstValue) : 0,
//           cgstRate: isIntraState ? parseFloat(header.cgstValue) : 0,
//           igstRate: isIntraState ? 0 : parseFloat(header.igstValue)
//         }));

//         // Fix taxable total mismatch issue
//         const totalTaxable = items.reduce((sum, item) => sum + parseFloat(item.taxableAmount || 0), 0);
//         header.totalValue = totalTaxable.toFixed(2);
//         header.totInvValue = totalTaxable.toFixed(2);



//         header.itemList = itemsWithTax;

//         return res.status(200).json({
//             version: "1.0.0219",
//             billLists: [header]
//         });

//     } catch (err) {
//         console.error("Error in jsonDoc:", err);
//         return res.status(500).json({
//             success: false,
//             message: err.message || "Server Error"
//         });
//     }
// };





// ================= VALIDATOR =================
function validateGSTPayload(payload) {
  const errors = [];
  const bill = payload.billLists?.[0];

  if (!bill) {
    errors.push("billLists missing");
    return errors;
  }

  const requiredFields = [
    "userGstin", "supplyType", "subSupplyType",
    "docType", "docNo", "docDate",
    "fromGstin", "toGstin",
    "fromPincode", "toPincode",
    "fromStateCode", "totalValue", "totInvValue"
  ];

  requiredFields.forEach(field => {
    if (bill[field] === undefined || bill[field] === null || bill[field] === "") {
      errors.push(`${field} is missing`);
    }
  });

  const gstRegex = /^[0-9]{2}[A-Z0-9]{13}$/;

  if (bill.fromGstin && !gstRegex.test(bill.fromGstin)) {
    errors.push("Invalid fromGstin");
  }
  if (bill.toGstin && !gstRegex.test(bill.toGstin)) {
    errors.push("Invalid toGstin");
  }

  if (!bill.itemList || bill.itemList.length === 0) {
    errors.push("itemList empty");
  }

  return errors;
}


// ================= AUTO FIX =================
function autoFixGSTPayload(payload) {
  const bill = payload.billLists[0];

  const fixString = (val) => val || "";
  const fixNumber = (val) => (val === null || isNaN(val)) ? 0 : Number(val);

  // Header fixes
  bill.toStateCode = fixNumber(bill.toStateCode);
  bill.actualToStateCode = fixNumber(bill.actualToStateCode);
  bill.transDistance = fixNumber(bill.transDistance);

  bill.totalValue = fixNumber(bill.totalValue);
  bill.totInvValue = fixNumber(bill.totInvValue);

  bill.transporterName = fixString(bill.transporterName);
  bill.transporterId = fixString(bill.transporterId);
  bill.transDocNo = fixString(bill.transDocNo);
  bill.transDocDate = fixString(bill.transDocDate);

  bill.toPlace = fixString(bill.toPlace) || "NA";

  // Item fixes
  const fixedItems = bill.itemList.map((item, index) => ({
    itemNo:         index + 1,
    productName:    fixString(item.productName),
    productDesc:    fixString(item.productDesc),
    hsnCode:        fixNumber(item.hsnCode),       
    quantity:       fixNumber(item.quantity),
    qtyUnit:        fixString(item.qtyUnit) || "NOS", 
    taxableAmount:  fixNumber(item.taxableAmount),
    sgstRate:       fixNumber(item.sgstRate),
    cgstRate:       fixNumber(item.cgstRate),
    igstRate:       fixNumber(item.igstRate),
    cessRate:       fixNumber(item.cessRate),
    cessNonAdvol:   fixNumber(item.cessNonAdvol)
  }));

  // ✅ Force mainHsnCode BEFORE itemList
  delete bill.mainHsnCode;
  delete bill.itemList;

  bill.mainHsnCode = fixedItems.length > 0 ? fixedItems[0].hsnCode : 0;
  bill.itemList = fixedItems;

  return payload;
}

// ================= MAIN FUNCTION =================
// exports.jsonDoc = async (req, res) => {
//   try {
//     const { nrdcId } = req.query;
//     const fromGstin = "29AAICM4744Q1ZM", fromTrdName = "MALLIK ENGINEERING (INDIA) PVT. LTD.", fromPlace = "Bangalore", fromPincode = 560105, fromStateCode = 29, actualFromStateCode = 29, vechileType = "R", supplyType = "O";
//     const fromAddr1 = "Plot No. 126, Road No 3, KIADB Industrial Estate,", fromAddr2 = "II Phase, Jigani Industrial Area, Jigani,Anekal Taluk,Bengaluru - 560105.";

//     const [nrdc] = await connection.execute(`
//       SELECT '${fromGstin}'as userGstin, '${supplyType}' as supplyType, ndc.sub_supply_type as subSupplyType, ndc.sub_supply_desc as subSupplyDesc, ndc.Doc_Type as docType, ndc.nrdcNo as docNo, 
//              DATE_FORMAT(ndc.created_at, '%d/%m/%Y') AS docDate, ndc.Transaction_Type as transType, '${fromGstin}' as fromGstin, '${fromTrdName}' as fromTrdName, '${fromAddr1}' as fromAddr1, '${fromAddr2}' as fromAddr2,
//              '${fromPlace}' as fromPlace, ${fromPincode} as fromPincode, ${fromStateCode} as fromStateCode, ${actualFromStateCode} as actualFromStateCode, c.gstNo as toGstin, c.cName as toTrdName, c.cAddress1 as toAddr1, c.cAddress2 as toAddr2,
//              c.city as toPlace, c.pincode as toPincode, ndc.toStateCode, ndc.actualStateCode As actualToStateCode, CAST(ndc.total AS DECIMAL(10,2)) AS totalValue, CAST(ndc.cgst AS DECIMAL(10,2)) AS cgstValue, CAST(ndc.sgst AS DECIMAL(10,2)) AS sgstValue, 
//              CAST(ndc.igst AS DECIMAL(10,2)) AS igstValue, CAST(ndc.total AS DECIMAL(10,2)) AS totInvValue, 0 as cessValue, 0 as TotNonAdvolVal, 0 as OthValue, ndc.modeOfType as transMode, ndc.distanceKms as transDistance,
//              tr.transportName as transporterName, tr.gstin as transporterId, ndc.docketNo as transDocNo, '' as transDocDate, ndc.vechileNo As vehicleNo, '${vechileType}' as vehicleType
//       FROM nonreturnabledc ndc
//       INNER JOIN customer c ON c.id = ndc.custo
//       LEFT JOIN mst_transport tr ON tr.id = ndc.transporter
//       WHERE ndc.id = ?`, [nrdcId]);

//     if (nrdc.length === 0) throw new Error('NRDC details not found!');
//     const header = nrdc[0];
//     const fields = ['subSupplyType', 'toStateCode', 'actualToStateCode', 'fromStateCode', 'actualFromStateCode', 'fromPincode', 'toPincode', 'transDistance', 'transType'];
//     fields.forEach(f => header[f] = parseInt(header[f]) || 0);
//     ['totalValue', 'cgstValue', 'sgstValue', 'igstValue', 'totInvValue', 'cessValue'].forEach(f => header[f] = parseFloat(header[f]) || 0);

//     const [items] = await connection.execute(`
//       SELECT ndc.itemCode as productName, ndc.itemName as productDesc, ndc.uom as qtyUnit, CAST(ndc.hsnCode AS UNSIGNED) as hsnCode, CAST(ndc.nrdcQty AS DECIMAL(10,2)) as quantity, CAST(ndc.nrdcAmt AS DECIMAL(10,2)) as taxableAmount, 0 as cessRate, 0 as cessNonAdvol
//       FROM nonreturnabledcitem ndc WHERE nonDcid = ?`, [nrdcId]);

//     header.itemList = items.map((item, idx) => ({
//       ...item, itemNo: idx + 1, quantity: parseFloat(item.quantity), taxableAmount: parseFloat(item.taxableAmount), hsnCode: parseInt(item.hsnCode), cessRate: 0, cessNonAdvol: 0,
//       sgstRate: header.fromStateCode === header.toStateCode ? parseFloat(header.sgstValue) : 0, cgstRate: header.fromStateCode === header.toStateCode ? parseFloat(header.cgstValue) : 0, igstRate: header.fromStateCode === header.toStateCode ? 0 : parseFloat(header.igstValue)
//     }));

//     const totalTaxable = items.reduce((sum, item) => sum + parseFloat(item.taxableAmount || 0), 0);
//     header.totalValue = header.totInvValue = totalTaxable.toFixed(2);
//     if (items.length > 0) header.mainHsnCode = items[0].hsnCode;

//     return res.status(200).json({ version: "1.0.0219", billLists: [header] });
//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };

exports.jsonDoc = async (req, res) => {
  try {
    const { nrdcId } = req.query;

    // FETCH COMPANY DATA
    const companyData = await company();

    if (!companyData) {
      throw new Error("Company details not found");
    }
    let address = companyData.companyAdd || "";

    // ✅ Remove newlines (\n, \r) and extra spaces
    address = address.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();


    let parts = address.split(',');
    let fromAddr1 = parts.slice(0, 2).join(',').trim();
    let fromAddr2 = parts.slice(2).join(',').trim();

    // ✅ COMPANY VALUES
    const fromGstin = companyData.cmpGstNo;
    const fromTrdName = companyData.companyName;

    const fromPlace = "Bangalore";
    const fromPincode = 560105;
    const fromStateCode = 29;
    const actualFromStateCode = 29;
    const vechileType = "R";
    const supplyType = "O";

    // ================= HEADER QUERY =================
    const [nrdc] = await connection.execute(`
            SELECT 
                '${supplyType}' as supplyType,
                ndc.sub_supply_type as subSupplyType, 
                ndc.sub_supply_desc as subSupplyDesc, 
                ndc.Doc_Type as docType, 
                ndc.nrdcNo as docNo, 
                DATE_FORMAT(ndc.created_at, '%d/%m/%Y') AS docDate, 
                ndc.Transaction_Type as transType,
                c.gstNo as toGstin, 
                c.cName as toTrdName, 
                c.cAddress1 as toAddr1, 
                c.cAddress2 as toAddr2,
                c.city as toPlace, 
                c.pincode as toPincode, 
                ndc.toStateCode, 
                ndc.actualStateCode As actualToStateCode,
                CAST(ndc.total AS DECIMAL(10,2)) AS totalValue,
                CAST(ndc.cgst AS DECIMAL(10,2)) AS cgstValue,
                CAST(ndc.sgst AS DECIMAL(10,2)) AS sgstValue, 
                CAST(ndc.igst AS DECIMAL(10,2)) AS igstValue,
                CAST(ndc.total AS DECIMAL(10,2)) AS totInvValue,
                0 as cessValue, 0 as TotNonAdvolVal, 0 as OthValue, 
                ndc.modeOfType as transMode, 
                ndc.distanceKms as transDistance,
                tr.transportName as transporterName, 
                tr.gstin as transporterId, 
                ndc.docketNo as transDocNo, 
                '' as transDocDate,
                ndc.vechileNo As vehicleNo, 
                '${vechileType}' as vehicleType
            FROM nonreturnabledc ndc
            INNER JOIN customer c ON c.id = ndc.custo
            LEFT JOIN mst_transport tr ON tr.id = ndc.transporter
            WHERE ndc.id = ?
        `, [nrdcId]);

    if (nrdc.length === 0) {
      throw new Error('NRDC details not found!');
    }

    // const header = nrdc[0];

    // // ✅ ASSIGN COMPANY VALUES
    // header.userGstin = fromGstin;
    // header.fromGstin = fromGstin;
    // header.fromTrdName = fromTrdName;
    // header.fromAddr1 = fromAddr1;
    // header.fromAddr2 = fromAddr2;
    // header.fromPlace = fromPlace;
    // header.fromPincode = fromPincode;
    // header.fromStateCode = fromStateCode;
    // header.actualFromStateCode = actualFromStateCode;

    // // ================= TYPE FIX =================
    // header.subSupplyType = parseInt(header.subSupplyType) || 0;
    // header.toStateCode = parseInt(header.toStateCode);
    // header.actualToStateCode = parseInt(header.actualToStateCode);
    // header.transType = parseInt(header.transType);
    // header.transDistance = parseInt(header.transDistance) || 0;

    // header.cgstValue = parseFloat(header.cgstValue) || 0;
    // header.sgstValue = parseFloat(header.sgstValue) || 0;
    // header.igstValue = parseFloat(header.igstValue) || 0;

    // // Default fix
    // header.transporterName = header.transporterName || "";
    // header.transporterId = header.transporterId || "";
    // header.transDocNo = header.transDocNo || "";


    const raw = nrdc[0];

    // ✅ Rebuild header in correct key order + toStateCode fallback fix
    const header = {
      userGstin:            fromGstin,
      supplyType:           raw.supplyType,
      subSupplyType:        parseInt(raw.subSupplyType) || 0,
      subSupplyDesc:        raw.subSupplyDesc || "",
      docType:              raw.docType,
      docNo:                raw.docNo,
      docDate:              raw.docDate,
      transType:            parseInt(raw.transType),
      fromGstin:            fromGstin,
      fromTrdName:          fromTrdName,
      fromAddr1:            fromAddr1,
      fromAddr2:            fromAddr2,
      fromPlace:            fromPlace,
      fromPincode:          fromPincode,
      fromStateCode:        fromStateCode,
      actualFromStateCode:  actualFromStateCode,
      toGstin:              raw.toGstin,
      toTrdName:            raw.toTrdName,
      toAddr1:              raw.toAddr1,
      toAddr2:              raw.toAddr2,
      toPlace:              raw.toPlace || "NA",
      toPincode:            raw.toPincode,
      toStateCode:          parseInt(raw.toStateCode) || fromStateCode,      // ✅ fallback to 29
      actualToStateCode:    parseInt(raw.actualToStateCode) || fromStateCode, // ✅ fallback to 29
      totalValue:           parseFloat(raw.totalValue) || 0,
      cgstValue:            parseFloat(raw.cgstValue) || 0,
      sgstValue:            parseFloat(raw.sgstValue) || 0,
      igstValue:            parseFloat(raw.igstValue) || 0,
      totInvValue:          parseFloat(raw.totInvValue) || 0,
      cessValue:            0,
      TotNonAdvolVal:       0,
      OthValue:             0,
      transMode:            raw.transMode,
      transDistance:        parseInt(raw.transDistance) || 0,
      transporterName:      raw.transporterName || "",
      transporterId:        raw.transporterId || "",
      transDocNo:           raw.transDocNo || "",
      transDocDate:         raw.transDocDate || "",
      vehicleNo:            raw.vehicleNo,
      vehicleType:          vechileType
    };

    // ================= ITEMS =================
    const [items] = await connection.execute(`
            SELECT  
                ndc.itemCode as productName, 
                ndc.itemName as productDesc, 
                ndc.uom as qtyUnit,
                CAST(ndc.hsnCode AS UNSIGNED) as hsnCode,
                CAST(ndc.nrdcQty AS DECIMAL(10,2)) as quantity,
                CAST(ndc.nrdcAmt AS DECIMAL(10,2)) as taxableAmount,
                0 as cessRate, 
                0 as cessNonAdvol
            FROM nonreturnabledcitem ndc
            WHERE nonDcid = ?
        `, [nrdcId]);

    const isIntraState = header.fromStateCode === header.toStateCode;

    const itemList = items.map((item, index) => ({
      itemNo: index + 1,
      productName: item.productName,
      productDesc: item.productDesc,
      qtyUnit: item.qtyUnit,
      hsnCode: parseInt(item.hsnCode) || 0,
      quantity: parseFloat(item.quantity) || 0,
      taxableAmount: parseFloat(item.taxableAmount) || 0,
      sgstRate: isIntraState ? header.sgstValue : 0,
      cgstRate: isIntraState ? header.cgstValue : 0,
      igstRate: isIntraState ? 0 : header.igstValue,
      cessRate: 0,
      cessNonAdvol: 0
    }));

    header.itemList = itemList;

    const finalPayload = {
      version: "1.0.0219",
      billLists: [header]
    };

    // ================= AUTO FIX =================
    const fixedPayload = autoFixGSTPayload(finalPayload);

    // ================= VALIDATION =================
    const errors = validateGSTPayload(fixedPayload);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "GST Validation Failed",
        errors,
        payload: fixedPayload
      });
    }

    // ================= SUCCESS =================
    return res.status(200).json(fixedPayload);

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};


//**********************************         PENDING DC          ****************************************//

exports.pendingDc = async (req, res) => {
  try {
    const id = req.params.id;
    const { fromDate, toDate } = req.body;
    const [results] = await connection.execute(`
      SELECT cdc.id, cdc.cdcNo, cdc.cust_Dc_no, cdc.po_ref, cdcp.id AS cdcpId, DATE_FORMAT(cdc.customerDcDate, '%d-%m-%Y') AS customerDcDate
      FROM customer_dc cdc
      INNER JOIN customer_dc_parts cdcp ON cdcp.CDC_no = cdc.id
      WHERE cdc.cust = ? AND cdcp.pendQty > 0 AND DATE(cdc.created_at) BETWEEN ? AND ?
      GROUP BY cdc.id, cdc.cdcNo, cdc.cust_Dc_no, cdc.po_ref, cdc.customerDcDate
    `, [id, fromDate, toDate]);
    return handleSuccessResponse(res, "Dc list", results);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.pendingDcItems = async (req, res) => {
  try {
    const ids = req.body.items;
    if (!Array.isArray(ids) || ids.length === 0) throw new CustomError("Invalid items array", 400);

    const [results] = await connection.query(`
      SELECT cdp.*, cdp.rate AS newRate, cdp.pendQty, cdp.partNo AS itemCode, cdp.partName AS itemName, cdp.id AS cdcpId, cdp.pendQty As qty,
             cd.cdcNo, cd.date, cd.cust_Dc_no, cd.customerDcDate
      FROM customer_dc_parts cdp
      INNER JOIN customer_dc cd ON cd.id = cdp.CDC_no 
      WHERE cdp.pendQty > 0 AND cd.id IN (${ids.map(() => '?').join(', ')})
    `, ids);
    return handleSuccessResponse(res, "Dc Item list", results);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

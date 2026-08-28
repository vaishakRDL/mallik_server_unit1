const excel = require("exceljs");
const { connection, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');
const { generateDocNo, updateDocCounter, docNoReset } = require("../utility/docNo");
const { getFYRange } = require("../../cache/fyRange.cache");



exports.uniqueId = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const { type = '' } = req.query;
    const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'CustomerDeliveryChallan', customValue: type });

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
  let conn;
  try {
    conn = await connection.getConnection();
    await conn.beginTransaction();

    const data = req.body;
    const user = req.headers.username;

    const commonData = data.purchaseOrderData;
    const variableData = data.purchaseOrderItemData;

    // ---------- Insert into customer_dc ----------
    const insertCustomerDCQuery = `
      INSERT INTO customer_dc (
        digit, cdcNo, date, cust, bill_add, multi_Dc, po_ref, grnRefNo, nrdc_No, nrdc_date,cust_Dc_no, customerDcDate, remark, addedBy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [dcResult] = await conn.query(insertCustomerDCQuery, [
      commonData.digit, commonData.cdcNo, commonData.date, commonData.cust, commonData.bill_add, commonData.multi_Dc, commonData.po_ref, commonData.grnRefNo,
      commonData.nrdc_No, commonData.nrdc_date, commonData.cust_Dc_no, commonData.customerDcDate, commonData.remark, user
    ]);

    const lastInsertId = dcResult.insertId;

    // ---------- Insert into customer_dc_parts ----------
    const insertCustomerDCPartsQuery = `
      INSERT INTO customer_dc_parts ( partno, partName, uom, hsnCode, cdc_po, qty, pendQty, rate, amt, CDC_no)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const item of variableData) {
      await conn.query(insertCustomerDCPartsQuery, [
        item.itemCode, item.itemName, item.uom, item.hsnCode, item.cdc_po, item.qty, item.qty, item.rate, item.amt, lastInsertId
      ]);
    }

    // ---------- Update document counter ----------
    await updateDocCounter(conn, 'CustomerDeliveryChallan');

    await conn.commit();

    return handleSuccessResponse(res, "Data Added Successfully");

  } catch (err) {
    if (conn) await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};


exports.update = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();
    await conn.beginTransaction();

    const { id } = req.params;
    const data = req.body;
    // const user = req.headers.username;

    const commonData = data.purchaseOrderData;
    const variableData = data.purchaseOrderItemData;

    // ---------- Update customer_dc (Header) ----------
    const updateCustomerDCQuery = `
      UPDATE customer_dc
      SET
        bill_add = ?, multi_Dc = ?, po_ref = ?, grnRefNo = ?, nrdc_No = ?, nrdc_date = ?, cust_Dc_no = ?, customerDcDate = ?, remark = ?
      WHERE id = ?
    `;

    await conn.query(updateCustomerDCQuery, [
      commonData.bill_add, commonData.multi_Dc, commonData.po_ref, commonData.grnRefNo, commonData.nrdc_No, commonData.nrdc_date, commonData.cust_Dc_no,
      commonData.customerDcDate, commonData.remark, id
    ]);

    // ---------- Update customer_dc_parts (Items) ----------
    const updateCustomerDCPartsQuery = `
      UPDATE customer_dc_parts
      SET
        partno = ?, partName = ?, uom = ?, hsnCode = ?, cdc_po = ?, qty = ?, accQty = ?, rejQty = ?, rate = ?, amt = ?
      WHERE id = ?
    `;

    for (const item of variableData) {
      await conn.query(updateCustomerDCPartsQuery, [
        item.itemCode, item.itemName, item.uom, item.hsnCode, item.cdc_po, item.qty, item.accQty, item.rejQty, item.rate, item.amt, item.id
      ]);
    }

    // // ---------- Stock Update (QC Approved) ----------
    // if (Number(commonData.qcApproval) === 1) {
    //   await exports.stock(commonData, variableData, user, conn);
    // }

    await conn.commit();

    return handleSuccessResponse(res, "Successfully Updated");

  } catch (err) {
    if (conn) await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};


exports.delete = async (req, res) => {
  try {
    const id = req.params.id;

    // Check if the ID is provided
    if (!id) {
      return res.status(400).json({ success: false, message: "ID is required" });
    }

    // Delete the record
    const [result] = await connection.execute(
      'DELETE FROM customer_dc WHERE id = ?', [id]
    );

    // Check if any rows were actually deleted
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Record not found" });
    }

    // Reset document number if needed
    await docNoReset(connection, req, { docType: 'CustomerDeliveryChallan', table: 'customer_dc', col: 'digit' });

    return res.status(200).json({
      success: true,
      message: "Successfully deleted"
    });

  } catch (err) {
    console.error("Delete Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "An error occurred"
    });
  }
};

exports.show = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const query = `
      SELECT 
        dc.*,
        c.cName,
        c.cCode
      FROM customer_dc dc
      INNER JOIN customer c ON c.cId = dc.cust
      ORDER BY dc.id DESC
    `;

    const [rows] = await conn.query(query);

    return handleSuccessResponse(res, "Customer DC List", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};

exports.showData = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const { id } = req.params;

    // -------- Fetch Customer DC Header --------
    const headerQuery = `
      SELECT 
        cdc.*,
        c.cName,
        c.cCode
      FROM customer_dc cdc
      INNER JOIN customer c 
        ON c.cId = cdc.cust
      WHERE cdc.id = ?
    `;

    const [headerRows] = await conn.query(headerQuery, [id]);

    // -------- Fetch Customer DC Parts --------
    const partsQuery = `
      SELECT 
        cdp.*,
        i.hsnCode,
        i.itemCode,
        i.itemName
      FROM customer_dc_parts cdp
      INNER JOIN items i 
        ON i.itemCode = cdp.partno
      WHERE cdp.CDC_no = ?
    `;

    const [partsRows] = await conn.query(partsQuery, [id]);

    return res.status(200).json({
      success: true,
      message: "Customer Dc list",
      data: headerRows,
      data2: partsRows
    });


  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};




exports.qcPending = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const query = `
      SELECT 
        cdc.id,
        cdc.cdcNo,
        cdc.cust_Dc_no,
        cdc.po_ref,
        DATE_FORMAT(cdc.customerDcDate, '%d-%m-%Y') AS customerDcDate,
        c.cName,
        c.cCode
      FROM customer_dc cdc
      INNER JOIN customer c 
        ON c.cId = cdc.cust
      WHERE cdc.qcApproval = 0
      ORDER BY cdc.id DESC
    `;

    const [rows] = await conn.query(query);

    // Add default UI flags
    rows.forEach(row => {
      row.selected = false;
    });

    return handleSuccessResponse(res, "Customer DC List", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};



exports.qcSubmit = async (req, res) => {
  try {
    const user = req.headers.username;
    const items = req.body.data;

    // Check if items is an array and not empty
    if (!Array.isArray(items) || items.length === 0) {
      return handleErrorResponse(res, 'No items provided');
    }

    // Delete items in bulk
    await connection.query(
      `UPDATE customer_dc SET qcApproval = 1, approvedBy = ? WHERE id IN (?)`,
      [user, items]
    );

    // await exports.stock(user, items);
    return handleSuccessResponse(res, 'Approved Successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.getItems = async (req, res) => {
  try {
    const { type, id } = req.query;
    const { from, to } = getFYRange(req);

    // Query for purchase_order
    let po = `
      SELECT cdc.*, c.cName, c.cCode 
        FROM customer_dc cdc 
        INNER JOIN customer c ON c.cId = cdc.cust  
        WHERE cdc.created_at BETWEEN ? AND ?
      `;

    let params = [from, to];

    // Query for purchas_Order_item
    let poItems = `
     SELECT cdcparts.*,  i.itemCode, i.itemName
      FROM customer_dc_parts cdcparts 
      INNER JOIN items i ON i.itemCode = cdcparts.partno  
    `;

    let params2 = [];

    // Modify queries based on type
    switch (type) {
      case 'first':
        po += ` ORDER BY cdc.id ASC LIMIT 1`;
        break;
      case 'last':
        po += ` ORDER BY cdc.id DESC LIMIT 1`;
        break;
      case 'forward':
        po += ` AND cdc.id > ? ORDER BY cdc.id ASC LIMIT 1`;
        params.push(id);
        break;
      case 'reverse':
        po += ` AND cdc.id < ? ORDER BY cdc.id DESC LIMIT 1`;
        params.push(id);
        break;
    }

    // Execute the first query
    const [rows] = await connection.execute(po, params);

    // If no matching purchase_order is found, return an empty result
    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        data2: [],
      });
    }

    // Extract the matching id from the first query
    const matchingId = rows[0].id;

    // Add a condition to the second query to filter by the matching id
    poItems += ` WHERE cdcparts.CDC_no = ?`;
    params2 = [matchingId];

    // Execute the second query
    const [rows2] = await connection.execute(poItems, params2);

    // Return the filtered results
    return res.status(200).json({
      success: true,
      data: rows,
      data2: rows2,
    });

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.template = async (req, res) => {
  try {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet("Sheet 1");

    // Add headers
    const headerRow = worksheet.addRow([
      "Part No",
      "CDC Po",
      "Qty",
    ]);

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
    res.setHeader("Content-Disposition", "attachment; filename = CustomerDC-Template.xlsx");

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


exports.importExeldata = async (req, res) => {
  let conn;
  try {
    if (!req.body.file) {
      return handleErrorResponse(res, "No file uploaded");
    }

    conn = await connection.getConnection();

    const base64URL =
      "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,";
    const base64Data = req.body.file.replace(base64URL, "");
    const buffer = Buffer.from(base64Data, "base64");

    const workbook = new excel.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet(1);
    const sup = [];
    let id = 1;

    const fetchQuery = `
      SELECT 
        i.stdRate,
        i.hsnCode,
        i.itemName,
        u.code AS uom
      FROM items i
      INNER JOIN mst_uom u ON i.uom = u.id
      WHERE i.itemCode = ?
    `;

    // Loop rows sequentially (safe)
    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);

      const sp = {
        id: id++,
        itemCode: row.getCell(1).value,
        qty: Number(row.getCell(3).value) || 0,
        cdcPo: row.getCell(4).value || ""
      };

      const [rows] = await conn.query(fetchQuery, [sp.itemCode]);

      if (rows.length > 0) {
        const item = rows[0];

        sup.push({
          ...sp,
          itemName: item.itemName,
          uom: item.uom,
          rate: item.stdRate,
          amt: sp.qty * item.stdRate,
          hsnCode: item.hsnCode
        });
      } else {
        sup.push({
          ...sp,
          match: null
        });
      }
    }

    return handleSuccessResponse(res, "Excel Data Imported", sup);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};


exports.exportCustDc = async (req, res) => {
  try {

    const id = req.params.id;

    const query = `
      SELECT * FROM customer_dc_parts where CDC_no = ?`;

    const [rows] = await connection.execute(query, [id]);


    rows.forEach((row, index) => {
      row.slNo = index + 1;
    });

    const customHeaders = ['Sl.No', 'Part No', 'Part Name', 'UOM', 'CDC PO', 'Qty', 'Rate', 'Amt'];
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Customer DC Report');

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
        row.partno,
        row.partName,
        row.uom,
        row.cdc_po,
        row.qty,
        row.rate,
        row.amt,
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



// Get Customer (Search)
exports.searchCust = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const { q } = req.query;

    let query = `
      SELECT DISTINCT
        c.cId AS id,
        c.cCode AS label,
        c.cName
      FROM customer c
      INNER JOIN customer_dc cdc 
        ON cdc.cust = c.cId
    `;

    const params = [];

    if (q) {
      query += ` WHERE c.cCode LIKE ?`;
      params.push(`%${q}%`);
    }

    query += ` ORDER BY c.cCode ASC`;

    const [rows] = await conn.query(query, params);

    return handleSuccessResponse(res, "Customer  List", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};





// Search Items
exports.searchItems = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const { q } = req.query;

    let query = `
      SELECT DISTINCT
        i.id,
        i.itemCode AS label
      FROM items i
      INNER JOIN customer_dc_parts cdp
        ON cdp.partno = i.itemCode
      WHERE i.dflag = 0
    `;

    const params = [];

    if (q) {
      query += ` AND i.itemCode LIKE ?`;
      params.push(`%${q}%`);
    }

    query += `
      ORDER BY 
        CASE 
          WHEN i.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 
          ELSE 0 
        END,
        i.itemCode
      LIMIT 100
    `;

    const [rows] = await conn.query(query, params);

    return handleSuccessResponse(res, "Customer DC Items List", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};


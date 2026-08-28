const utility = require("../utility/utilityFunction");
const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const excel = require("exceljs");
const { generateDocNo, updateDocCounter, formatFinancialYears, docNoReset } = require("../utility/docNo");
const { getUser, currentDateTime } = require("../utility/utilityFunction")
const { getFYRange } = require("../../cache/fyRange.cache");


exports.uniqueId = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'Customer-POsalesorder' });

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


exports.template = async (req, res) => {
  try {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet("Sheet 1");

    // Add headers
    const headerRow = worksheet.addRow([
      "Item Code",
      "Contract No",
      "Qty",
      "Rate",
      "Sch Date",
      "PoNo",
      "PoDate",
      "GST%"
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

exports.import = async (req, res) => {
  try {
    return res
      .send(200)
      .json({ success: true, message: "Successfully imported" });
  } catch (err) {
    return res
      .status(400)
      .json({ success: false, message: err.message || "An error occurred" });
  }
};

exports.export = async (req, res) => {
  try {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet("Sheet 1");

    // Add headers
    const headerRow = worksheet.addRow([
      "Item Code",
      "Contract No",
      "Qty",
      "Rate",
      "Sch Date",
      "PoNo",
      "PoDate",
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


exports.verfiedItems = async (req, res) => {
  try {

    const { customerId, from, to } = req.body;

    const query = `
      SELECT 
        pvd.orderedQty As qty, pv.soNo, pv.poNo, pv.verifiedBy, pv.verifiedDate, 
        cVsI.rate, cVsI.customerDesc, cVsI.customerId, cVsI.hsnCode, pvd.orderedQty *  cVsI.rate As amt,
        cVih.old_rate AS preRate, cVsI.rate AS newRate, 
        c.cCode, c.cName,  COALESCE(cVsI.customerDesc, itm.itemName) AS itemName,
        itm.itemCode, cVsI.uom   
      FROM 
        price_verification_details pvd
        INNER JOIN price_verification AS pv ON pvd.pvMstId = pv.id
        INNER JOIN items AS itm ON pvd.itemNo = itm.itemCode
        INNER JOIN cust_vs_item AS cVsI ON cVsI.itemId = itm.id 
        LEFT JOIN (
            SELECT itemId, customerId, old_rate 
            FROM cust_vs_item_history 
            ORDER BY id DESC LIMIT 1
        ) AS cVih ON cVih.itemId = itm.id AND cVih.customerId = cVsI.customerId
        INNER JOIN customer AS c ON cVsI.customerId = c.id
      WHERE 
        pv.authorized = 1 
        AND cVsI.customerId = ? 
        AND pv.created_at BETWEEN ? AND ?
      GROUP BY 
        cVsI.itemId;
`;

    const [rows] = await connection.execute(query, [customerId, from, to]);

    if (rows.length >= 0) {

      //Auto Index value
      rows.forEach((element, index) => {
        element.sNo = index + 1;
        element.id = index + 1;
      });

      return res.status(200).json({
        success: true,
        message: "Price Verified ItemList",
        data: rows
      });
    }
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
  }
}


exports.insertPurchaseOrderAndItems = async (req, res) => {
  let conn;
  try {
    const data = req.body;
    const { purchaseOrderData, purchaseOrderItemData } = data;

    const user = await getUser(req);

    if (!purchaseOrderData?.poNo) {
      throw new CustomError("PO Number is required!", 400);
    }

    if (!purchaseOrderData?.poDate) {
      throw new CustomError("PO Date can't be empty!", 400);
    }

    conn = await connection.getConnection();
    await conn.beginTransaction();

    /* ---------- DUPLICATE PO CHECK ---------- */
    const [existingPo] = await conn.query(
      `SELECT id FROM purchase_order WHERE poNo = ? LIMIT 1`,
      [purchaseOrderData.poNo]
    );

    if (existingPo.length > 0) {
      throw new CustomError(
        `Duplicate entry for PoNo: ${purchaseOrderData.poNo}!`,
        400
      );
    }

    /* ---------- INSERT PURCHASE ORDER ---------- */
    const insertPoQuery = `
      INSERT INTO purchase_order ( sino, sodigit, date, isVerbal, customer, billAdd, shipAdd, poNo, poDate, pay_term, narration, totalQty, grossAmt, gstPer,
        gst, grandTotal, addedBy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [poResult] = await conn.query(insertPoQuery, [
      purchaseOrderData.sino, purchaseOrderData.sodigit, purchaseOrderData.date, purchaseOrderData.isVerbal, purchaseOrderData.customer, purchaseOrderData.billAdd,
      purchaseOrderData.shipAdd, purchaseOrderData.poNo, utility.dateFormat(purchaseOrderData.poDate), purchaseOrderData.pay_term, purchaseOrderData.Narration, 
      purchaseOrderData.total_qty, purchaseOrderData.gross_amt, purchaseOrderData.gstPer, purchaseOrderData.gst, purchaseOrderData.grandTotal, user
    ]);

    const purchaseOrderId = poResult.insertId;

    /* ---------- INSERT PO ITEMS ---------- */
    const insertItemQuery = `
      INSERT INTO purchas_Order_item ( PartNo, PartName, UOM, Qty, pendQty, SchDate, PrewRate, Rate, Amt, remarks, purchase_order_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const item of purchaseOrderItemData) {
      await conn.query(insertItemQuery, [
        item.part_No, item.part_name, item.UOM, item.Qty, item.Qty,  utility.dateFormat(item.schDate), item.pre_Rate, item.Rate, item.Amt, item.remarks, purchaseOrderId
      ]);
    }

    /* ---------- UPDATE DOC COUNTER ---------- */
    await updateDocCounter(conn, "Customer-POsalesorder");

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
    const { id } = req.params;
    const data = req.body;
    const action ='Update';
    const user = await getUser(req);
    const currentDate = await currentDateTime();

    const { purchaseOrderData, purchaseOrderItemData } = data;

    conn = await connection.getConnection();
    await conn.beginTransaction();

    /* ---------- UPDATE PURCHASE ORDER HEADER ---------- */
    const updatePoQuery = `
      UPDATE purchase_order 
      SET 
        date = ?, customer = ?, billAdd = ?, shipAdd = ?, poNo = ?, poDate = ?, pay_term = ?, narration = ?, totalQty = ?, 
        gstPer = ?, gst = ?, grossAmt = ?, grandTotal = ?, changedBy = ?, updated_at = ?
      WHERE id = ?
    `;

    await conn.query(updatePoQuery, [
      purchaseOrderData.date, purchaseOrderData.customer, purchaseOrderData.billAdd, purchaseOrderData.shipAdd, purchaseOrderData.poNo, utility.dateFormat(purchaseOrderData.poDate),
      purchaseOrderData.pay_term, purchaseOrderData.Narration, purchaseOrderData.total_qty, purchaseOrderData.gstPer, purchaseOrderData.gst, purchaseOrderData.gross_amt, 
      purchaseOrderData.grandTotal, user, currentDate, id
    ]);

    /* ---------- DELETE UNUSED ITEMS (append = 0) ---------- */
    if (purchaseOrderData.append == 0) {
      await conn.query(
        `DELETE FROM purchas_Order_item 
         WHERE purchase_order_id = ? AND cumQty = 0`,
        [id]
      );
    }

    /* ---------- PROCESS ITEMS ---------- */
    for (const item of purchaseOrderItemData) {

      if (purchaseOrderData.append == 1) {
        /* --- CHECK EXISTING ITEM --- */
        const [existingRows] = await conn.query(
          `SELECT id, Qty, pendQty 
           FROM purchas_Order_item
           WHERE purchase_order_id = ? AND PartNo = ?
           LIMIT 1`,
          [id, item.part_No]
        );

        if (existingRows.length) {
          const existingItem = existingRows[0];

          const diff = item.Qty - existingItem.Qty;
          const newPendQty = Math.max(existingItem.pendQty + diff, 0);

          /* --- UPDATE EXISTING ITEM --- */
          await conn.query(
            `
            UPDATE purchas_Order_item
            SET Qty = ?,SchDate = ?,PrewRate = ?,Rate = ?,Amt = ?,pendQty = ?
            WHERE id = ?
            `,
            [
              item.Qty, utility.dateFormat(item.schDate), item.pre_Rate, item.Rate, item.Amt, newPendQty, existingItem.id
            ]
          );

        } else {
          /* --- INSERT NEW ITEM --- */
          await conn.query(
            `
            INSERT INTO purchas_Order_item
            (purchase_order_id, PartNo, PartName, Qty, pendQty, UOM, SchDate, PrewRate, Rate, Amt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              id, item.part_No, item.part_name, item.Qty, item.Qty, item.UOM, utility.dateFormat(item.schDate), item.pre_Rate, item.Rate, item.Amt
            ]
          );
        }

      } else {
        /* ---------- APPEND = 0 → INSERT IF NOT EXISTS ---------- */
        await conn.query(
          `
          INSERT INTO purchas_Order_item
          (purchase_order_id, PartNo, PartName, Qty, pendQty, UOM, SchDate, PrewRate, Rate, Amt)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM purchas_Order_item
            WHERE purchase_order_id = ? AND PartNo = ?
          )
          `,
          [
            id, item.part_No, item.part_name, item.Qty, item.Qty, item.UOM, utility.dateFormat(item.schDate), item.pre_Rate, item.Rate, item.Amt, id, item.part_No
          ]
        );
      }
    }

    /* ---------------- AUDIT LOG ---------------- */
    await logSo({conn, soId: id, user, action});
    await conn.commit();

    return handleSuccessResponse(res, "Updated Successfully");

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
    const action ='Delete';
    const user = await getUser(req);

    // Fetch the record before deletion
    const [rows] = await connection.execute(`SELECT * FROM purchase_order WHERE id = ?`, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }

    const deletedUser = req.headers.username;

    // Log the deleted record
    await exports.handleDeletedRecords('purchase_order', rows[0], deletedUser);

    // Delete the record
    await connection.execute(`DELETE FROM purchase_order WHERE id = ?`, [id]);

    // Reset document number if needed
    await docNoReset(connection, req, { docType: 'Customer-POsalesorder', table: 'purchase_order', col: 'sino' });


    await logSo({connection, soId: id, user, action});

    return res.status(200).json({ success: true, message: "Successfully deleted" });


  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: err.message || "An error occurred" });
  }
};



exports.handleDeletedRecords = async (recordType, records, deletedUser) => {
  await connection.execute(`INSERT INTO deleted_records (type, records, deletedBy) VALUES(?, ?, ?)`,
    [recordType, JSON.stringify(records), deletedUser]
  );

  return true;
}


exports.showitemsbyid = async (req, res) => {
  let conn;
  try {
    const { id, id2 } = req.params; // id = customerId, id2 = itemId

    conn = await connection.getConnection();

    const sqlQuery = `
      SELECT
        i.id,
        i.id AS itemId,
        i.itemCode,
        COALESCE(cvi.customerDesc, i.itemName) AS itemName,
        cvi.hsnCode,
        cvi.uom,
        cvih.old_rate AS preRate,
        cvi.rate AS newRate,
        cvi.rate,
        NULL AS schDate,
        NULL AS qty,
        NULL AS amt
      FROM items i
      INNER JOIN cust_vs_item cvi
        ON cvi.itemId = i.id
        AND cvi.customerId = ?
      LEFT JOIN cust_vs_item_history cvih
        ON cvih.itemId = i.id
        AND cvih.customerId = ?
      WHERE i.id = ?
      LIMIT 1
    `;

    const values = [id, id, id2];

    const [rows] = await conn.query(sqlQuery, values);

    return handleSuccessResponse(res, "Item list retrieved successfully", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};


exports.showaddress = async (req, res) => {
  let conn;
  try {
    const { id } = req.params;

    conn = await connection.getConnection();

    const sqlQuery = `
      SELECT 
        TRIM(CONCAT_WS(' ',
          c.cAddress1,
          c.cAddress2,
          c.cAddress3,
          c.cAddress4
        )) AS cAddress,

        c.id, c.cId, c.gstNo, c.panNo, c.state, c.country, c.cgst, c.sgst, c.igst, c.utgst, c.payTerm, c.maxLineItem,

        TRIM(CONCAT_WS(' ',
          c.cAddress1,
          c.cAddress2,
          c.cAddress3,
          c.cAddress4
        )) AS multiAddress

      FROM customer c
      WHERE c.cId = ?
    `;

    const [rows] = await conn.query(sqlQuery, [id]);

    return handleSuccessResponse(res, "Customer address list", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};

exports.multiAddress = async (req, res) => {
  let conn;
  try {
    const { id } = req.params;

    conn = await connection.getConnection();

    const sqlQuery = `
      SELECT 
        mAdd.id,
        mAdd.cId,
        mAdd.address,
        mAdd.gstNo
      FROM cus_multi_add mAdd
      WHERE mAdd.cId = ?
      ORDER BY mAdd.id ASC
    `;

    const [rows] = await conn.query(sqlQuery, [id]);

    return handleSuccessResponse(res, "Customer address list", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};

exports.showaddedpo = async (req, res) => {
  let conn;
  try {
    conn = await connection.getConnection();

    const query = `
      SELECT  
        po.*,
        c.cCode,
        DATE_FORMAT(po.poDate, '%d/%m/%Y') AS poDate
      FROM purchase_order po
      INNER JOIN customer c ON c.cId = po.customer
      ORDER BY po.id DESC
    `;

    const [rows] = await conn.query(query);

    return res.status(200).json({
      success: true,
      message: "Purchase order list",
      data: rows || [],
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "An error occurred",
    });
  } finally {
    if (conn) conn.release(); //  very important
  }
};

// exports.importExeldata = async (req, res) => {
//   let conn;
//   try {
//     if (!req.body.file) {
//       return handleErrorResponse(res, "No file uploaded");
//     }

//     const custId = req.params.id;

//     const base64URL =
//       "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,";
//     const base64Data = req.body.file.replace(base64URL, "");
//     const buffer = Buffer.from(base64Data, "base64");

//     const workbook = new excel.Workbook();
//     await workbook.xlsx.load(buffer);
//     const worksheet = workbook.getWorksheet(1);

//     /* ---------- PRE-VALIDATE DUPLICATES BEFORE DB CALLS ---------- */
//     const seenItems = new Set();
//     const duplicates = [];

//     for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber++) {
//       const row = worksheet.getRow(rowNumber);
//       const itemCode = row.getCell(1).value;
//       if (!itemCode) continue;

//       if (seenItems.has(itemCode)) {
//         duplicates.push(itemCode);
//       } else {
//         seenItems.add(itemCode);
//       }
//     }

//     if (duplicates.length > 0) {
//       throw new CustomError(`Duplicate item code(s) found: ${duplicates.join(", ")}`)
//     }

//     /* ---------- NOW SAFE TO OPEN CONNECTION & PROCESS ---------- */
//     conn = await connection.getConnection();

//     const result = [];

//     const excelDateToFormattedDate = (serial) => {
//       const utc_days = Math.floor(serial - 25569);
//       const date = new Date(utc_days * 86400 * 1000);
//       const day = String(date.getUTCDate()).padStart(2, "0");
//       const month = String(date.getUTCMonth() + 1).padStart(2, "0");
//       const year = date.getUTCFullYear();
//       return `${day}/${month}/${year}`;
//     };

//     for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber++) {
//       const row = worksheet.getRow(rowNumber);
//       const itemCode = row.getCell(1).value;
//       if (!itemCode) continue;

//       const schDateRaw = row.getCell(5).value;
//       const poDateRaw = row.getCell(7).value;

//       const schDate =
//         typeof schDateRaw === "number"
//           ? excelDateToFormattedDate(schDateRaw)
//           : schDateRaw;

//       const poDate =
//         typeof poDateRaw === "number"
//           ? excelDateToFormattedDate(poDateRaw)
//           : poDateRaw;

//       const excelItem = {
//         itemCode,
//         Contract_No: row.getCell(2).value,
//         qty: Number(row.getCell(3).value || 0),
//         newRate: Number(row.getCell(4).value || 0),
//         schDate,
//         PoNo: row.getCell(6).value,
//         PoDate: poDate,
//       };

//       const [rows] = await conn.query(
//         `
//         SELECT 
//           cvi.rate AS newRate, cvih.old_rate AS preRate, cvi.hsnCode, cvi.uom, COALESCE(cvi.customerDesc, i.itemName) AS itemName
//         FROM items i
//         INNER JOIN cust_vs_item cvi 
//           ON cvi.itemId = i.id AND cvi.customerId = ?
//         LEFT JOIN cust_vs_item_history cvih 
//           ON cvih.itemId = i.id AND cvih.customerId = ?
//         WHERE i.itemCode = ?
//         LIMIT 1
//         `,
//         [custId, custId, excelItem.itemCode]
//       );

//       if (rows.length) {
//         const dbItem = rows[0];

//         if (Number(dbItem.newRate) === Number(excelItem.newRate)) {
//           result.push({
//             ...excelItem,
//             id: result.length + 1,
//             match: 0,
//             itemName: dbItem.itemName,
//             uom: dbItem.uom,
//             hsnCode: dbItem.hsnCode,
//             preRate: dbItem.preRate,
//             amt: Math.round(excelItem.qty * excelItem.newRate * 100) / 100,
//             error: "No",
//           });
//         } else {
//           result.push({
//             ...excelItem,
//             id: result.length + 1,
//             match: 1,
//             itemName: dbItem.itemName,
//             uom: dbItem.uom,
//             preRate: dbItem.preRate,
//             newrate: dbItem.newRate,
//             error: "Yes",
//             discription: "Rate Mismatch",
//           });
//         }
//       } else {
//         result.push({
//           ...excelItem,
//           id: result.length + 1,
//           match: 1,
//           itemName: null,
//           uom: null,
//           preRate: null,
//           newrate: null,
//           error: "Yes",
//           discription: "ItemCode not mapped",
//         });
//       }
//     }

//     return handleSuccessResponse(res, "Excel data processed successfully", result);

//   } catch (err) {
//     return handleErrorResponse(res, err);
//   } finally {
//     if (conn) conn.release();
//   }
// };

exports.importExeldata = async (req, res) => {
  let conn;
  try {
    if (!req.body.file) {
      return handleErrorResponse(res, "No file uploaded");
    }

    const custId = req.params.id;

    const base64URL =
      "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,";
    const base64Data = req.body.file.replace(base64URL, "");
    const buffer = Buffer.from(base64Data, "base64");

    const workbook = new excel.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(1);

    /* ---------- PRE-VALIDATE DUPLICATES BEFORE DB CALLS ---------- */
    const seenItems = new Set();
    const duplicates = [];

    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const itemCode = row.getCell(1).value;
      if (!itemCode) continue;

      if (seenItems.has(itemCode)) {
        duplicates.push(itemCode);
      } else {
        seenItems.add(itemCode);
      }
    }

    if (duplicates.length > 0) {
      throw new CustomError(`Duplicate item code(s) found: ${duplicates.join(", ")}`)
    }

    /* ---------- NOW SAFE TO OPEN CONNECTION & PROCESS ---------- */
    conn = await connection.getConnection();

    const result = [];

    const excelDateToFormattedDate = (serial, isPoDate = false) => {
      let date;
      if (typeof serial === "number") {
        const utc_days = Math.floor(serial - 25569);
        date = new Date(utc_days * 86400 * 1000);
      } else if (serial instanceof Date) {
        date = serial;
      } else {
        return serial;
      }

      const day = String(date.getUTCDate()).padStart(2, "0");
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const year = date.getUTCFullYear();

      if (isPoDate) {
        return `${year}-${month}-${day}`;
      }
      return `${day}/${month}/${year}`;
    };

    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const itemCode = row.getCell(1).value;
      if (!itemCode) continue;

      const schDateRaw = row.getCell(5).value;
      const poDateRaw = row.getCell(7).value;

      const schDate =
        typeof schDateRaw === "number" || schDateRaw instanceof Date
          ? excelDateToFormattedDate(schDateRaw)
          : schDateRaw;

      const poDate =
        typeof poDateRaw === "number" || poDateRaw instanceof Date
          ? excelDateToFormattedDate(poDateRaw, true)
          : poDateRaw;

      const excelItem = {
        itemCode,
        Contract_No: row.getCell(2).value,
        qty: Number(row.getCell(3).value || 0),
        newRate: Number(row.getCell(4).value || 0),
        schDate,
        PoNo: row.getCell(6).value,
        PoDate: poDate,
        poLineItem: row.getCell(9).value || '',
      };

      const [rows] = await conn.query(
        `
        SELECT 
          cvi.rate AS newRate, cvih.old_rate AS preRate, cvi.hsnCode, cvi.uom, COALESCE(cvi.customerDesc, i.itemName) AS itemName
        FROM items i
        INNER JOIN cust_vs_item cvi 
          ON cvi.itemId = i.id AND cvi.customerId = ?
        LEFT JOIN cust_vs_item_history cvih 
          ON cvih.itemId = i.id AND cvih.customerId = ?
        WHERE i.itemCode = ?
        LIMIT 1
        `,
        [custId, custId, excelItem.itemCode]
      );

      if (rows.length) {
        const dbItem = rows[0];

        if (Number(dbItem.newRate) === Number(excelItem.newRate)) {
          result.push({
            ...excelItem,
            id: result.length + 1,
            match: 0,
            itemName: dbItem.itemName,
            uom: dbItem.uom,
            hsnCode: dbItem.hsnCode,
            preRate: dbItem.preRate,
            amt: Math.round(excelItem.qty * excelItem.newRate * 100) / 100,
            error: "No",
          });
        } else {
          result.push({
            ...excelItem,
            id: result.length + 1,
            match: 1,
            itemName: dbItem.itemName,
            uom: dbItem.uom,
            preRate: dbItem.preRate,
            newrate: dbItem.newRate,
            error: "Yes",
            discription: "Rate Mismatch",
          });
        }
      } else {
        result.push({
          ...excelItem,
          id: result.length + 1,
          match: 1,
          itemName: null,
          uom: null,
          preRate: null,
          newrate: null,
          error: "Yes",
          discription: "ItemCode not mapped",
        });
      }
    }

    return handleSuccessResponse(res, "Excel data processed successfully", result);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};

exports.search = async (req, res) => {
  let conn;
  try {
    const { id } = req.params;
    const { q } = req.query;

    conn = await connection.getConnection();

    let sqlQuery = `
      SELECT DISTINCT
        i.id,
        i.itemCode AS label,
        COALESCE(cvi.customerDesc, i.itemName) AS itemName,
        cvi.uom
      FROM items i
      INNER JOIN cust_vs_item cvi 
        ON cvi.itemId = i.id
      WHERE i.dflag = 0
        AND cvi.customerId = ?
    `;

    const values = [id];

    if (q) {
      sqlQuery += ` AND i.itemCode LIKE ? `;
      values.push(`${q}%`);
    }

    sqlQuery += ` ORDER BY i.itemCode ASC LIMIT 60`;

    const [rows] = await conn.query(sqlQuery, values);

    return handleSuccessResponse(res, "Items fetched successfully", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};



async function searchItems(q, id) {
  const raw = (q || "").trim();
  if (!raw) return [];

  const clean = raw.toUpperCase();
  const CACHE_TTL = 60 * 60 * 8; // 8 hrs
  const PREFIX_LIMIT = 60;
  const NGRAM_LIMIT = 5000;
  const conn = connection;
  const cacheKey = `cust_vs_item:${clean}`;

  // 1) Redis Cache
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (_) { }

  // 2) Strategy
  const hasDigit = /\d/.test(clean);
  const useNgram = hasDigit || clean.length >= 2;

  let results = [];

  // 3) PREFIX SEARCH
  if (!useNgram) {
    const [rows] = await conn.execute(
      `SELECT i.id, i.itemCode AS label
             FROM cust_vs_item 
             INNER JOIN items i ON i.id = cust_vs_item.itemId
             WHERE i.dflag = 0 AND  cust_vs_item.customerId = ? AND i.itemCode LIKE ?
             GROUP BY i.id
             ORDER BY i.hasSpecial ASC, i.itemCode ASC
             LIMIT ?`,
      [id, `${clean}%`, PREFIX_LIMIT]
    );
    results = rows;
  }

  // 4) N-GRAM SEARCH
  else {
    const grams = generateNgrams(clean, 2);
    if (grams.length === 0) return [];

    const unique = [...new Set(grams)];
    const gramCount = unique.length;
    const gramPlace = unique.map(() => "?").join(",");

    // Step A: ranked candidate IDs
    const [idRows] = await conn.execute(
      `
            SELECT itemId, COUNT(DISTINCT ng) AS matchCount
            FROM item_ngrams
            WHERE ng IN (${gramPlace})
            GROUP BY itemId
            HAVING matchCount >= ?
            ORDER BY matchCount DESC
            LIMIT ?
            `,
      [...unique, Math.max(1, gramCount), NGRAM_LIMIT]
    );



    if (!idRows.length) {
      // fallback to LIKE substring
      const [rows] = await conn.execute(
        `SELECT i.id, i.itemCode AS label
                FROM cust_vs_item 
                INNER JOIN items i ON i.id = cust_vs_item.itemId
                WHERE i.dflag = 0 AND  cust_vs_item.customerId = ? AND i.itemCode LIKE ?
                GROUP BY i.id
                ORDER BY i.hasSpecial ASC, i.itemCode ASC
                LIMIT ?`,
        [id, `%${clean}%`, PREFIX_LIMIT]
      );
      results = rows;
    } else {
      const itemIds = idRows.map(r => r.itemId);
      const idPlace = itemIds.map(() => "?").join(",");

      // Step B: fetch items
      const [rows] = await conn.execute(
        `
                SELECT i.id, i.itemCode AS label
                FROM cust_vs_item 
                INNER JOIN items i ON i.id = cust_vs_item.itemId
                WHERE  cust_vs_item.customerId = ? AND  i.id IN (${idPlace})
                GROUP BY i.id
                ORDER BY i.hasSpecial ASC, i.itemCode ASC
                LIMIT ?
                `,
        [id, ...itemIds, PREFIX_LIMIT]
      );

      // Step C: strict filter
      results = rows
        .filter(r => r.label?.toUpperCase().includes(clean))
        .slice(0, PREFIX_LIMIT);
    }
  }

  // 5) Cache & return
  const finalData = results.map(r => ({
    id: r.id,
    itemId: r.itemId,
    label: r.label,
    itemName: r.itemName
  }));

  try {
    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(finalData));
  } catch (_) { }

  return finalData;
}


exports.itemSearch = async (req, res) => {
  try {
    const q = req.query.q || "";
    const id = req.params.id;

    const data = await searchItems(q, id);

    return handleSuccessResponse(res, "Items", data);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


function generateNgrams(str, size = 2) {
  if (!str) return [];
  const s = String(str).trim().toUpperCase();

  const grams = [];
  for (let i = 0; i <= s.length - size; i++) {
    grams.push(s.substring(i, i + size));
  }
  return grams;
}


exports.getItems = async (req, res) => {
  try {
    const { type, id } = req.query;
    // const { fyFrom, fyTo } = formatFinancialYears(req);
    const { from, to } = getFYRange(req);


    let po = `
      SELECT po.*, c.cName, c.cCode, c.cId AS CustomerId,
        DATE_FORMAT(po.poDate, '%Y-%m-%d') As poDate
      FROM purchase_order po 
      INNER JOIN customer c ON c.cId = po.customer
      WHERE DATE(po.created_at) >= ? AND DATE(po.created_at) <= ?`;

    let params = [from, to]; // Initialize params with fyFrom and fyTo

    // Modify queries based on type
    switch (type) {
      case 'first':
        po += ` ORDER BY po.id ASC LIMIT 1`;
        break;
      case 'last':
        po += ` ORDER BY po.id DESC LIMIT 1`;
        break;
      case 'forward':
        po += ` AND po.id > ? ORDER BY po.id ASC LIMIT 1`;
        params.push(id); // Add id to the existing fyfrom, fyto
        break;
      case 'reverse':
        po += ` AND po.id < ? ORDER BY po.id DESC LIMIT 1`;
        params.push(id); // Add id to the existing fyfrom, fyto
        break;
    }

    // Execute purchase_order query
    const [rows] = await connection.execute(po, params);

    if (rows.length === 0) {
      return res.status(200).json({ success: true, data: [], data2: [] });
    }

    const matchingId = rows[0].id;

    // Query for purchas_order_item
    const poItems = `
      SELECT po.id, po.PartName AS itemName, po.UOM AS uom, po.purchase_order_id,
        po.PrewRate AS preRate, po.Rate AS newRate, po.Amt AS amt, po.cumQty,
        DATE_FORMAT(po.SchDate, '%d/%m/%Y') AS schDate, po.isShortCls,
        po.Qty AS qty, i.itemCode, cvi.hsnCode
      FROM purchas_Order_item po 
      INNER JOIN purchase_order p  ON p.id = po.purchase_order_id 
      INNER JOIN items i ON i.itemCode = po.PartNo   
      INNER JOIN cust_vs_item cvi ON cvi.itemId = i.id AND cvi.customerId = p.customer
      WHERE po.purchase_order_id = ?`;

    const [rows2] = await connection.execute(poItems, [matchingId]);

    return res.status(200).json({
      success: true,
      data: rows,
      data2: rows2,
    });

  } catch (err) {
    console.error("Error in getItems:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


exports.showname = async (req, res) => {
  let conn;
  try {
    const { q } = req.query;

    conn = await connection.getConnection();

    let sqlQuery = `
      SELECT cName, id, cId, cCode
      FROM customer
    `;

    const values = [];

    if (q) {
      sqlQuery += ` WHERE cName LIKE ? `;
      values.push(`${q}%`);
    }

    sqlQuery += ` ORDER BY cName ASC LIMIT 20`;

    const [rows] = await conn.query(sqlQuery, values);

    return handleSuccessResponse(res, "Items fetched successfully", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};


exports.exportPo2 = async (req, res) => {
  try {

    const id = req.params.id;

    const query = `
      SELECT 
        po.id, po.soNo, po.poNo, DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
        c.cName, c.cCode, c.id As CustomerId, po.gstPer, po.gst, po.grandTotal, po.totalQty, po.grossAmt,
        poi.PartNo, poi.PartName, poi.UOM, poi.Rate, poi.PrewRate, poi.Qty, poi.SchDate, poi.Amt,

       INNER JOIN purchase_order po ON po.id = poi.purchase_order_id
       INNER JOIN customer c ON c.cId = po.customer
      
      FROM 
       purchas_Order_item poi
      
      where po.id = ?`;

    const [rows] = await connection.execute(query, [id]);


    rows.forEach((row, index) => {
      row.slNo = index + 1;
    });

    const customHeaders = ['Sl.No', 'Po No', 'Po Date', 'Customer Code', 'Part No', 'Part Name', 'UOM', 'Rate', 'PrewRate', 'Qty', 'SchDate', 'Amt'];
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
        row.poNo,
        row.poDate,
        row.cCode,
        row.PartNo,
        row.PartName,
        row.UOM,
        row.Rate,
        row.PrewRate,
        row.Qty,
        row.SchDate,
        row.Amt,
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



exports.exportPo = async (req, res) => {
  try {
    const id = req.params.id;

    const query = `
      SELECT 
        po.id, po.sodigit, po.poNo, DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
        c.cName, c.cCode, c.id AS CustomerId, po.gstPer, po.gst, po.grandTotal, po.totalQty, po.grossAmt,
        poi.PartNo, poi.PartName, poi.UOM, poi.Rate, poi.PrewRate, poi.Qty, poi.SchDate, poi.Amt
      FROM 
        purchase_order po
      INNER JOIN purchas_Order_item poi ON po.id = poi.purchase_order_id
      INNER JOIN customer c ON c.cId = po.customer
      WHERE po.id = ?`;

    const [rows] = await connection.execute(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "No data found" });
    }

    rows.forEach((row, index) => {
      row.slNo = index + 1;
    });

    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Po OrderList Report');

    // Define headers
    const customHeaders = [
      'Po No', 'Po Date', 'Customer Code', 'Part No', 'Part Name', 'UOM', 'Rate', 'PrewRate', 'Qty', 'SchDate', 'Amt',
      'Total Qty', 'Gross Amt', 'GST %', 'GST Amt', 'Grand Total',
    ];

    // Add headers with bold font
    const headerRow = worksheet.addRow(customHeaders);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    // Column widths
    worksheet.columns = customHeaders.map(() => ({ width: 17 }));

    // Merge cells for repeating values
    const mergeColumns = [1, 2, 3, 12, 13, 14, 15, 16,]; // Columns for poNo, poDate, etc.

    let startRow = 2; // Data starts from row 2
    const rowCount = rows.length + 1; // Number of rows including header

    rows.forEach((row, index) => {
      const customValues = [
        row.poNo, row.poDate, row.cCode, row.PartNo, row.PartName, row.UOM, row.Rate, row.PrewRate, row.Qty, row.SchDate, row.Amt,
        row.totalQty, row.grossAmt, row.gstPer, row.gst, row.grandTotal,
      ];

      worksheet.addRow(customValues);
    });

    // Merging repeated values for poNo, poDate, etc.
    mergeColumns.forEach((col) => {
      worksheet.mergeCells(startRow, col, rowCount, col);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Purchase_Order_Report.xlsx');

    workbook.xlsx.write(res)
      .then(() => res.status(200).end())
      .catch(error => {
        console.error('Error generating Excel file:', error);
        res.status(500).json({ success: false, message: 'Error generating Excel file' });
      });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
  }
};


exports.showData = async (req, res) => {
  let conn;
  try {
    const { id } = req.params;

    conn = await connection.getConnection();

    /* ---------- FETCH PO HEADER ---------- */
    const headerQuery = `
      SELECT 
        po.*, c.cName, c.cCode, c.id AS CustomerId,
        DATE_FORMAT(po.poDate, '%Y-%m-%d') As poDate
      FROM purchase_order po
      INNER JOIN customer c 
        ON c.cId = po.customer
      WHERE po.id = ?
      LIMIT 1
    `;

    const [header] = await conn.query(headerQuery, [id]);

    if (!header.length) {
      return handleSuccessResponse(res, "Po not found", []);
    }

    /* ---------- FETCH PO ITEMS ---------- */
    const itemQuery = `
      SELECT 
        poi.id, poi.UOM AS uom, poi.cumQty, poi.PrewRate AS preRate, poi.Rate AS newRate, poi.Amt AS amt,
        COALESCE(cvi.customerDesc, i.itemName) AS itemName,
        DATE_FORMAT(poi.SchDate, '%d/%m/%Y') AS schDate,
        poi.isShortCls, poi.Qty AS qty, cvi.hsnCode, i.itemCode
      FROM purchas_Order_item poi
      INNER JOIN purchase_order p 
        ON p.id = poi.purchase_order_id
      INNER JOIN items i 
        ON i.itemCode = poi.PartNo
      INNER JOIN cust_vs_item cvi 
        ON cvi.itemId = i.id
       AND cvi.customerId = p.customer
      WHERE poi.purchase_order_id = ?
      ORDER BY poi.id ASC
    `;

    const [items] = await conn.query(itemQuery, [id]);

    return res.status(200).json({
      success: true,
      message: "Po list",
      data: header,
      data2: items
    });

  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};


exports.shortClose = async (req, res) => {
  try {

    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const formattedDate = `${year}-${month}-${day}`; // Format date to YYYY-MM-DD


    const updateQuery1 = `UPDATE purchas_order_item SET flag = ? WHERE STR_TO_DATE(SchDate, '%d/%m/%Y') < ?`;
    const updateQuery2 = `UPDATE gstsalesinvoitem SET flag = ? WHERE STR_TO_DATE(schDate, '%d/%m/%Y') < ?`;

    const values = [1, formattedDate];

    const [uRows1] = await connection.execute(updateQuery1, values);
    const [uRows2] = await connection.execute(updateQuery2, values);


    if (uRows1.affectedRows > 0 || uRows2.affectedRows > 0) {
      return res.status(200).json({ data: formattedDate, message: "Successfully updated" });
    } else {
      return res.status(200).json({ data: formattedDate, message: "No matching date found" });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};



exports.searchPo = async (req, res) => {
  try {
    const { type, q } = req.query;
    const { fyFrom, fyTo } = formatFinancialYears(req);

    if (!fyFrom || !fyTo) {
      return res.status(400).json({
        success: false,
        message: "Missing financial year range (fyfrom, fyto)"
      });
    }

    const typeMapping = {
      soOrder: { table: "purchase_order", digitColumn: "poNo", poNoColumn: "poNo" },
      gstInvoice: { table: "gstsalesinvo", digitColumn: "invNo", poNoColumn: "invNo" },
      perfomaInvoice: { table: "perfoma_invoice", digitColumn: "invSt", poNoColumn: "invNo" },
      customerDc: { table: "customer_dc", digitColumn: "cust_Dc_no", poNoColumn: "cust_Dc_no" },
      nonCustomerDc: { table: "nonreturnabledc", digitColumn: "digit", poNoColumn: "nrdcNo" },
      creditNote: { table: "credit_note_mst", digitColumn: "digit", poNoColumn: "returnNo" },
    };

    const mapping = typeMapping[type];

    if (!mapping) {
      return res.status(400).json({
        success: false,
        message: "Invalid type parameter"
      });
    }

    const { table, digitColumn, poNoColumn } = mapping;

    // Build query with dynamic WHERE conditions
    let fetch = `SELECT id, ${digitColumn} AS digit, ${poNoColumn} AS no FROM ${table}`;
    const whereConditions = [];
    const values = [];

    if (q) {
      whereConditions.push(`${digitColumn} LIKE ?`);
      values.push(`%${q}%`);
    }

    whereConditions.push(`DATE(${table}.created_at) >= ?`);
    values.push(fyFrom);

    whereConditions.push(`DATE(${table}.created_at) <= ?`);
    values.push(fyTo);

    // Combine conditions
    if (whereConditions.length > 0) {
      fetch += ` WHERE ` + whereConditions.join(" AND ");
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



exports.updateRate = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const user = req.headers.username;
    const poId = req.body.poId;
    const cust = req.body.customerId;

    const query = `
      SELECT items.id AS itemId, items.itemCode, cust_vs_item.rate
      FROM cust_vs_item 
      INNER JOIN items ON items.id = cust_vs_item.itemId
      WHERE customerId = ?`;

    const [rows] = await conn.execute(query, [cust]);

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "No items found for the given customer.",
      });
    }

    for (const row of rows) {
      const [existing] = await conn.execute(
        `SELECT id, Rate, Qty 
         FROM purchas_order_item 
         WHERE purchase_order_id = ? AND PartNo = ?`,
        [poId, row.itemCode]
      );

      const [existingGst] = await conn.execute(
        `SELECT gsi.id, gsi.invQty, gsi.invRate 
         FROM gstsalesinvoitem gsi
         INNER JOIN gstsalesinvo g ON gsi.gstsalesinvo_id = g.id
         WHERE gsi.poId = ? AND gsi.partNo = ? AND g.invoiceGen = 0`,
        [poId, row.itemCode]
      );

      if (existing.length > 0) {
        const poItemsId = existing[0].id;
        const currentRate = Number(existing[0].Rate);
        const qty = Number(existing[0].Qty);
        const newRate = Number(row.rate);
        const newAmt = qty * newRate;

        await conn.execute(
          `UPDATE purchas_order_item 
           SET PrewRate = ?, Rate = ?, Amt = ? 
           WHERE purchase_order_id = ? AND PartNo = ?`,
          [currentRate, newRate, newAmt, poId, row.itemCode]
        );

        if (existingGst.length > 0) {
          const gstQty = Number(existingGst[0].invQty);

          await conn.execute(
            `UPDATE gstsalesinvoitem 
             SET invRate = ?, invAmt = ? 
             WHERE poId = ? AND partNo = ?`,
            [newRate, gstQty * newRate, poId, row.itemCode]
          );
        }

        await conn.execute(
          `INSERT INTO cust_rate_update_log 
           (customerId, itemId, poMstId, poItemsId, preRate, newRate, changedBy) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [cust, row.itemId, poId, poItemsId, currentRate, newRate, user]
        );
      }
    }

    await conn.commit();
    return handleSuccessResponse(res, "Data Updated successfully");
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};







exports.updateRate2 = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const user = req.headers.username;
    const poId = req.body.poId;
    const cust = req.body.customerId;

    const [rows] = await conn.execute(
      `SELECT cvi.id, i.id AS itemId, i.itemCode, cvi.rate
       FROM cust_vs_item cvi
       INNER JOIN items i ON i.id = cvi.itemId
       WHERE cvi.rateChng = 1 AND cvi.customerId = ?`,
      [cust]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "No items found for the given customer.",
      });
    }

    for (const row of rows) {
      const itemCode = row.itemCode;
      const itemId = row.itemId;
      const newRate = Number(row.rate);

      const [[poItem]] = await conn.execute(
        `SELECT id, Rate, Qty 
         FROM purchas_order_item 
         WHERE purchase_order_id = ? AND PartNo = ?`,
        [poId, itemCode]
      );

      if (!poItem) continue;

      const poItemsId = poItem.id;
      const currentRate = Number(poItem.Rate);
      const qty = Number(poItem.Qty);
      const diffRate = newRate - currentRate;
      const diffAmt = qty * diffRate;
      const newAmt = qty * newRate;

      await conn.execute(
        `UPDATE purchas_order_item 
         SET PrewRate = ?, Rate = ?, Amt = ?
         WHERE purchase_order_id = ? AND PartNo = ?`,
        [currentRate, newRate, newAmt, poId, itemCode]
      );

      await conn.execute(
        `UPDATE purchase_order 
         SET grossAmt = grossAmt + ?, grandTotal = grandTotal + ?
         WHERE id = ?`,
        [diffAmt, diffAmt, poId]
      );

      const [gstItems] = await conn.execute(
        `SELECT gsi.id, gsi.gstsalesinvo_id, gsi.invQty 
         FROM gstsalesinvoitem gsi
         INNER JOIN gstsalesinvo g ON gsi.gstsalesinvo_id = g.id
         WHERE gsi.poId = ? AND gsi.partNo = ? AND g.invoiceGen = 0`,
        [poId, itemCode]
      );

      for (const gstItem of gstItems) {
        const gstQty = Number(gstItem.invQty);
        const gstDiffAmt = gstQty * diffRate;
        const gstAmt = gstQty * newRate;
        const gstId = gstItem.gstsalesinvo_id;

        await conn.execute(
          `UPDATE gstsalesinvoitem 
          SET invRate = ?, invAmt = ?
          WHERE id = ?`,
          [newRate, gstAmt, gstItem.id]
        );

        await conn.execute(
          `UPDATE gstsalesinvo 
          SET taxableValueforGST = taxableValueforGST + ?, 
              subTotAfterDisc = subTotAfterDisc + ?, 
              subtotal = subtotal + ?, 
              amtOfGstPay = amtOfGstPay + ?, 
              totGst = totGst + ?, 
              totalValue = totalValue + ?, 
              invValue = invValue + ?
          WHERE id = ?`,
          [gstDiffAmt, gstDiffAmt, gstDiffAmt, gstDiffAmt, gstDiffAmt, gstDiffAmt, gstDiffAmt, gstId]
        );
      }

      await conn.execute(
        `INSERT INTO cust_rate_update_log 
         (customerId, itemId, poMstId, poItemsId, preRate, newRate, changedBy) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [cust, itemId, poId, poItemsId, currentRate, newRate, user]
      );
    }

    const itemIds = rows.map(row => row.id);
    if (itemIds.length > 0) {
      const placeholders = itemIds.map(() => '?').join(',');
      await conn.execute(
        `UPDATE cust_vs_item SET rateChng = 0 WHERE id IN (${placeholders})`,
        itemIds
      );
    }

    await conn.commit();
    return handleSuccessResponse(res, "Data Updated successfully");
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

const generatePurchaseID = async (conn, req) => {
  const { uniqueNo } = await generateDocNo(conn, req, { docType: 'Customer-POsalesorder' });

  const parts = uniqueNo.split('/');
  const lastNumber = parts.pop();
  const prefix = parts.join('/');

  return {
    prefix,
    nextNumber: Number(lastNumber),
    padLen: lastNumber.length
  };
};



exports.importMultiSO = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const { file, isVerbal = null, custId = null, custAdd = null, billAdd = null } = req.body;

    const buffer = await utility.decodeBase64(file);
    const workbook = new excel.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet(1);
    const soItems = new Map();
    const itemsSet = new Set();
    const rows = [];

    // Collect all rows first
    worksheet.eachRow((row, rowNo) => {
      if (rowNo === 1) return;
      rows.push(row);
    });

    // Generate initial PO ID sequence
    const { prefix, nextNumber, padLen } = await generatePurchaseID(conn, req);
    let currentNumber = nextNumber;

    function excelDateToFormattedDate(serial) {
      const utc_days = Math.floor(serial - 25569);
      const utc_value = utc_days * 86400; // seconds
      const date = new Date(utc_value * 1000);

      // Format to Y-m-d
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-based
      const day = String(date.getUTCDate()).padStart(2, '0');

      return `${year}-${month}-${day}`;
    }

    // Process each row
    for (const row of rows) {
      const itemCode = row.getCell(1).text.trim();
      const contractNo = row.getCell(2).text.trim();
      const qty = parseFloat(row.getCell(3).text) || 0;
      const rate = parseFloat(row.getCell(4).text) || 0;
      // const schDate = row.getCell(5).text.trim();
      const schDateRaw = row.getCell(5).value;
      const schDate = typeof schDateRaw === 'number' ? excelDateToFormattedDate(schDateRaw) : schDateRaw;

      const poNo = row.getCell(6).text.trim();
      const poDateRaw = row.getCell(7).value;
      const poDate = typeof poDateRaw === 'number' ? excelDateToFormattedDate(poDateRaw) : poDateRaw;

      const gstPer = row.getCell(8).text.trim();
      if (!itemCode || !poNo || qty <= 0) {
        throw new CustomError(`Invalid data in row ${row.rowNumber}: Missing required fields or invalid values`);
      }
      const amount = qty * rate;

      // Initialize PO if it doesn't exist
      if (!soItems.has(poNo)) {
        const sequence = currentNumber.toString().padStart(padLen, '0');
        soItems.set(poNo, {
          poDetails: { sino: sequence, sodigit: `${prefix}/${sequence}`, poNo, poDate, gstPer, payTerm: '30 Days', totQty: 0, grossAmt: 0 },
          items: []
        });
        currentNumber++;
      }

      // Add item to PO
      itemsSet.add(itemCode);
      const poData = soItems.get(poNo);
      poData.poDetails.totQty += qty;
      poData.poDetails.grossAmt += amount;
      poData.items.push({ itemCode, contractNo, qty, rate, schDate, amount });
    }

    if (soItems.size === 0) {
      throw new CustomError("No valid purchase orders found in the Excel file");
    }

    // Fetch item details in a single query
    const itemCodes = Array.from(itemsSet);
    const itemCodeMap = new Map();

    if (itemCodes.length > 0) {
      // const [itemRows] = await conn.execute(
      //   `SELECT itemCode, itemName, u.code As uom FROM items 
      //   INNER JOIN mst_uom u ON items.uom = u.id
      //   WHERE items.itemCode IN (${itemCodes.map(() => '?').join(',')})`,
      //   itemCodes
      // );

      const [itemRows] = await conn.execute(
        `
        SELECT 
          items.itemCode, 
          COALESCE(cvi.customerDesc, items.itemName) AS itemName, cvi.uom
        FROM items
       
        LEFT JOIN cust_vs_item cvi 
            ON cvi.itemId = items.id 
          AND cvi.customerId = ?
        WHERE items.itemCode IN (${itemCodes.map(() => '?').join(',')})
        `,
        [custId, ...itemCodes]
      );


      // Check for missing items
      const foundItems = new Set(itemRows.map(row => row.itemCode));
      const missingItems = itemCodes.filter(code => !foundItems.has(code));

      if (missingItems.length > 0) {
        throw new CustomError(`The following items were not found: ${missingItems.join(', ')}`);
      }

      itemRows.forEach(row => {
        itemCodeMap.set(row.itemCode, {
          itemName: row.itemName,
          uom: row.uom
        });
      });
    }

    const dateTime = await utility.currentDateTime();

    // Process each purchase order
    for (const [poNo, { poDetails, items }] of soItems) {
      const gst = (parseFloat((poDetails.grossAmt * poDetails.gstPer) / 100)).toFixed(2);
      const grandTotal = poDetails.grossAmt + gst;

      const [check] = await conn.execute(
        `SELECT id FROM purchase_order WHERE poNo = ?`,
        [poNo]
      );
      // console.log("Check result for poNo:", poNo, check); // <-- This will log the database result


      if (check.length > 0) {
        throw new CustomError(`Duplicate poNo: ${poNo} can't be added`);
      }

      const [purchaseRow] = await conn.execute(
        `INSERT INTO purchase_order (sino, sodigit, date, isVerbal, customer, billAdd, shipAdd, poNo, poDate, pay_term, totalQty, grossAmt, gstPer, gst, grandTotal) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [poDetails.sino, poDetails.sodigit, dateTime.split(' ')[0], isVerbal ? 1 : 0, custId, billAdd, custAdd, poNo, poDetails.poDate, poDetails.payTerm, poDetails.totQty, poDetails.grossAmt, poDetails.gstPer, gst, grandTotal]
      );

      if (purchaseRow.affectedRows !== 1) {
        throw new CustomError(`Failed to insert purchase order ${poNo}`);
      }
      const purchaseId = purchaseRow.insertId;

      const itemValues = items.map(item => {
        const itemData = itemCodeMap.get(item.itemCode) || { itemName: item.itemCode, uom: 'EA' };
        return [purchaseId, item.itemCode, itemData.itemName, itemData.uom, item.qty, item.qty, item.schDate, item.rate, item.amount];
      });

      await conn.query(
        `INSERT INTO purchas_order_item (purchase_order_id, PartNo, PartName, UOM, Qty, pendQty, SchDate, Rate, Amt) VALUES ?`,
        [itemValues]
      );

      await updateDocCounter(conn, 'Customer-POsalesorder');
    }

    await conn.commit();
    return handleSuccessResponse(res, "Data imported successfully");
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};



exports.shortCloseCron = async (req, res) => {

  let conn;
  try {
    const tabId = req.body?.id; // Safe access


    const date = new Date();
    const formattedDate = date.toISOString().slice(0, 10); // YYYY-MM-DD

    console.log(formattedDate)
    const updateQuery = `
            UPDATE purchas_order_item poi
            INNER JOIN purchase_order po ON po.id = poi.purchase_order_id
            INNER JOIN customer c ON c.id = po.customer
            SET poi.isShortCls = ?, 
                poi.shortclsBy = ?, 
                poi.shortclsDate = ?, 
                poi.shortclsQty = poi.pendQty
            WHERE poi.SchDate < ? 
              AND poi.id = ? 
              AND c.shortClose = 'Y' 
              AND poi.pendQty > 0
              AND poi.isShortCls = 0
        `;

    const values = [1, 'Admin', formattedDate, formattedDate, tabId];

    conn = await connection.getConnection();
    await conn.beginTransaction();

    const [result] = await conn.execute(updateQuery, values);
    await conn.commit();

    return res.json({
      success: true,
      message: `Short close update completed: ${result.affectedRows} rows updated.`,
    });
  } catch (error) {
    console.error('Error in shortCloseCron function:', error);
    if (conn) await conn.rollback();
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (conn) conn?.release();
  }
};



async function logSo({ conn, soId, user, action}) {

  /* ---- fetch BEFORE ---- */
  const [[fetch]] = await conn.execute(
    'SELECT * FROM purchase_order WHERE id = ?',
    [soId]
  );

 
  /* ---- insert audit log ---- */
  const insertAuditLog = `
    INSERT INTO so_audit_log
    (
      so_id,
      soNo,
      poNo,
      updated_by,
      action
    )
    VALUES (?, ?, ?, ?, ?)
  `;

  await conn.execute(insertAuditLog, [
    soId,
    fetch.sodigit,
    fetch.poNo,
    user,
    action
  ]);
}

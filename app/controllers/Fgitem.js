const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { getFYRange } = require("../../cache/fyRange.cache");

exports.getPo = async (req, res) => {
  try {
    const { q } = req.query;

    let fetch = `
      SELECT po.id, po.poNo, po.sodigit
      FROM purchase_order po 
    `;

    const values = [];

    if (q) {
      fetch += ` WHERE (po.poNo LIKE ?)`;
      values.push(`${q}%`);
    }

    fetch += ` LIMIT 10`;

    const [rows] = await connection.execute(fetch, values);

    return handleSuccessResponse(res, "PO", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.poItm = async (req, res) => {
  try {
    const id = req.params.id;
    const { q } = req.query;

    let fetch = `
      SELECT 
        DISTINCT items.id, poItm.id AS poItmId, items.itemCode as label 
        FROM items 
      INNER JOIN purchas_order_item AS poItm ON poItm.PartNo = items.itemCode
      LEFT JOIN purchase_order AS po ON po.id = poItm.purchase_order_id
      WHERE items.dflag = 0 AND po.id = ?
    `;

    const values = [id];

    if (q) {
      fetch += ` AND (items.itemCode LIKE ?)`;
      values.push(`${q}%`);
    }

    fetch += ` LIMIT 10`;

    const [rows] = await connection.execute(fetch, values);

    return handleSuccessResponse(res, "Items", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.dcItm = async (req, res) => {
  try {
    const { q } = req.query;

    let fetch = `
        SELECT  
            cdcp.id, items.id As itemId, items.itemCode as label, 
            cdcp.partno AS itemCode, cdcp.partName AS itemName,
            cdcp.uom, cdcp.accQty AS qty
          FROM items 
        JOIN customer_dc_parts AS cdcp ON cdcp.partno = items.itemCode
        JOIN customer_dc AS cdc ON cdc.id = cdcp.CDC_no
        WHERE cdcp.fgAdded = 0 AND items.dflag = 0
      `;

    const values = [];

    if (q) {
      fetch += ` AND (items.itemCode LIKE ?)`;
      values.push(`${q}%`);
    }

    fetch += ` LIMIT 10`;

    const [rows] = await connection.execute(fetch, values);

    return handleSuccessResponse(res, "Items", rows);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

// exports.custDcpartAll = async (req, res) => {
//   try {
//     const fetch = `
//       SELECT cdp.id, cdp.partno AS itemCode, cdp.partName AS itemName, cdp.uom, cdp.qty AS dcQty
//       FROM customer_dc_parts cdp
//       JOIN customer_dc AS cdc ON cdc.id = cdp.CDC_no
//       WHERE cdp.fgAdded = 0
//     `;

//     const [results] = await connection.execute(fetch);

//     return handleSuccessResponse(res, "customer Dc Items", results);

//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };




exports.custDcpartAll = async (req, res) => {
  try {

    const { from, to } = getFYRange(req);

    const fetch = `
      SELECT cdp.id, cdp.partno AS itemCode, cdp.partName AS itemName, cdp.uom, cdp.fgMapBal, cdp.qty AS dcQty
      FROM customer_dc_parts cdp
      JOIN customer_dc AS cdc ON cdc.id = cdp.CDC_no
      WHERE cdp.fgAdded = 0
      AND cdc.created_at BETWEEN ? AND ?
    `;

    // const [results] = await connection.execute([ from, to], fetch);
    const [results] = await connection.execute(fetch, [from, to]);

    return handleSuccessResponse(res, "customer Dc Items", results);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.store = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    const dataArray = req.body;

    await conn.beginTransaction();

    for (const data of dataArray) {
      // Check if the row exists
      const [existingRow] = await conn.execute(
        'SELECT id FROM fg_ItemList WHERE poId = ? AND poItemsId = ? AND custDcItemsId = ?',
        [data.poId, data.poItmId, data.dcItemId]
      );

      if (existingRow.length > 0) {
        // If the row exists, update it
        await conn.execute(
          'UPDATE fg_ItemList SET fgitemCode = ?, dcItemCode = ?, uom = ?, dcQty = ?, qtyPerPart = ?, qty = ? WHERE id = ?',
          [
            data.fgitemCode, data.dcItemCode, data.uom, data.dcQty, data.qtyPerPart, data.qty, existingRow[0].id
          ]
        );
      } else {
        // If the row does not exist, insert it
        if (Number(data.qtyPerPart) > 0 && Number(data.qty) > 0) {
          await conn.execute(
            'INSERT INTO fg_ItemList (poId, poItemsId, fgitemCode, custDcItemsId, dcItemCode, uom, dcQty, qtyPerPart, qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              data.poId, data.poItmId, data.fgitemCode, data.dcItemId, data.dcItemCode, data.uom, data.dcQty, data.qtyPerPart, data.qty,
            ]
          );
        }
      }

      if (Number(data.qtyPerPart) > 0 && Number(data.qty) > 0) {
        await conn.execute(
          'UPDATE customer_dc_parts SET fgAdded = 1 WHERE id = ?', [data.dcItemId]
        );
      }
    }

    await conn.commit();
    return handleSuccessResponse(res, 'Data Updated successfully');

  } catch (err) {
    if (conn) await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};

exports.store2 = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    const dataArray = req.body;

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return handleErrorResponse(res, 'Invalid input data');
    }

    await conn.beginTransaction();

    for (const data of dataArray) {

      const qtyPerPart = Number(data.qtyPerPart || 0);
      const qty = Number(data.qty || 0);

      // Skip invalid rows
      if (qtyPerPart <= 0 || qty <= 0) continue;

      // 🔍 Get existing row WITH qtyPerPart
      const [existingRow] = await conn.execute(
        `SELECT id, qtyPerPart 
         FROM fg_ItemList 
         WHERE poId = ? AND poItemsId = ? AND custDcItemsId = ?`,
        [data.poId, data.poItmId, data.dcItemId]
      );

      if (existingRow.length > 0) {
        // =========================
        // 🔁 UPDATE CASE
        // =========================
        const rowId = existingRow[0].id;
        const oldQty = Number(existingRow[0].qtyPerPart || 0);

        const diff = qtyPerPart - oldQty; // ⚡ only difference

        // Update fg_ItemList
        await conn.execute(
          `UPDATE fg_ItemList 
           SET fgitemCode = ?, dcItemCode = ?, uom = ?, dcQty = ?, qtyPerPart = ?, qty = ?
           WHERE id = ?`,
          [
            data.fgitemCode,
            data.dcItemCode,
            data.uom,
            data.dcQty,
            qtyPerPart,
            qty,
            rowId
          ]
        );

        // Update balance ONLY if diff != 0
        if (diff !== 0) {
          await conn.execute(
            `UPDATE customer_dc_parts
             SET 
               fgMapBal = fgMapBal - ?,
               fgAdded = CASE 
                           WHEN (fgMapBal - ?) <= 0 THEN 1 
                           ELSE 0 
                         END
             WHERE id = ?`,
            [diff, diff, data.dcItemId]
          );
        }

      } else {
        // =========================
        // ➕ INSERT CASE
        // =========================

        await conn.execute(
          `INSERT INTO fg_ItemList 
           (poId, poItemsId, fgitemCode, custDcItemsId, dcItemCode, uom, dcQty, qtyPerPart, qty) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            data.poId,
            data.poItmId,
            data.fgitemCode,
            data.dcItemId,
            data.dcItemCode,
            data.uom,
            data.dcQty,
            qtyPerPart,
            qty
          ]
        );

        // Reduce balance
        await conn.execute(
          `UPDATE customer_dc_parts
           SET 
             fgMapBal = fgMapBal - ?,
             fgAdded = CASE 
                         WHEN (fgMapBal - ?) <= 0 THEN 1 
                         ELSE 0 
                       END
           WHERE id = ?`,
          [qtyPerPart, qtyPerPart, data.dcItemId]
        );
      }
    }

    await conn.commit();
    return handleSuccessResponse(res, 'Data Updated successfully');

  } catch (err) {
    if (conn) await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};

exports.show = async (req, res) => {
  try {

    const { from, to } = getFYRange(req);
    
    // const fetch = `
    //   SELECT fgi.id, po.poNo, fgi.poId, fgi.poItemsId, fgi.fgitemCode, 
    //   DATE_FORMAT(fgi.created_at, '%d-%m-%Y') AS date
    //   FROM fg_itemlist fgi
    //   INNER JOIN purchase_order AS po ON po.id = fgi.poId
    //   GROUP BY fgi.poId, fgi.poItemsId
    // `;

    // const [results] = await connection.execute(fetch);

    const fetch = `
      SELECT 
        MIN(fgi.id) AS id,
        po.poNo,
        fgi.poId,
        fgi.poItemsId,
        MIN(fgi.fgitemCode) AS fgitemCode,
        DATE_FORMAT(MIN(fgi.created_at), '%d-%m-%Y') AS date
      FROM fg_itemlist fgi
      INNER JOIN purchase_order AS po ON po.id = fgi.poId
      WHERE fgi.created_at BETWEEN ? AND ?
      GROUP BY fgi.poId, fgi.poItemsId
    `;

    const [results] = await connection.execute(fetch, [from, to]);

    return handleSuccessResponse(res, "customer Dc Items", results);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.showDtl = async (req, res) => {
  try {
    const po = req.body.poId;
    const poItm = req.body.poItemsId;

    const fetch = `
      SELECT fgi.id, fgi.fgitemCode, fgi.qty, fgi.dcQty, fgi.qtyPerPart, fgi.custDcItemsId, fgi.dcItemCode, fgi.uom, items.itemName
      FROM fg_itemlist fgi
      INNER JOIN purchase_order AS po ON po.id = fgi.poId
      INNER JOIN purchas_order_item AS poItm ON poItm.id = fgi.poItemsId
      INNER JOIN customer_dc_parts AS cdcp ON cdcp.id = fgi.custDcItemsId
      INNER JOIN items ON items.itemCode = fgi.dcItemCode
      WHERE fgi.poId = ? AND fgi.poItemsId = ?
    `;

    const [results] = await connection.execute(fetch, [po, poItm]);

    return handleSuccessResponse(res, "customer Dc Items", results);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.update = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    const dataArray = req.body;

    await conn.beginTransaction();

    for (const data of dataArray) {
      await conn.execute(
        'UPDATE fg_ItemList SET dcQty = ?, qtyPerPart = ?, qty = ? WHERE id = ?',
        [data.dcQty, data.qtyPerPart, data.qty, data.id]
      );
    }

    await conn.commit();
    return handleSuccessResponse(res, 'Data updated successfully');

  } catch (err) {
    if (conn) await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};



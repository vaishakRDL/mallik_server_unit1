
const { connection, CustomError, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');
const { generateDocNo, updateDocCounter, formatDate, syncCounter } = require("../utility/docNo");
const { getIO } = require('../sockets');
const EVENTS = require('../sockets/socket.events');
const moment = require('moment');

exports.storeFY = async (req, res) => {
  try {
    let { fromDate, toDate } = req.body;

    const isFromDateValid = moment(fromDate, 'DD-MM-YYYY', true).isValid();
    const isToDateValid = moment(toDate, 'DD-MM-YYYY', true).isValid();

    if (!isFromDateValid || !isToDateValid) {
      throw new CustomError('Invalid date format. Please use DD-MM-YYYY.', 400);
    }

    // Convert to YYYY-MM-DD
    fromDate = moment(fromDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
    toDate = moment(toDate, 'DD-MM-YYYY').format('YYYY-MM-DD');

    const [existingRow] = await connection.query(
      'SELECT id FROM financial_year WHERE fromDate = ? AND toDate = ?',
      [fromDate, toDate]
    );

    if (existingRow.length) {
      throw new CustomError('Financial year already exists.', 400);
    }

    const YrFrom = new Date(fromDate).getFullYear();
    const YrTo = new Date(toDate).getFullYear();
    const ShYrFrom = YrFrom.toString().slice(-2);
    const ShYrTo = YrTo.toString().slice(-2);

    await connection.execute(
      'INSERT INTO financial_year (fromDate, toDate, yrFrom, yrTo, shYrFrom, shYrTo) VALUES (?, ?, ?, ?, ?, ?)',
      [fromDate, toDate, YrFrom, YrTo, ShYrFrom, ShYrTo]
    );

    return handleSuccessResponse(res, 'Financial year created successfully.');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.updateFY = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      throw new CustomError('ID is required!', 400);
    }

    if (req.headers.userrole?.toLowerCase() !== 'admin') {
      throw new CustomError('Access denied. Only administrators can modify financial years.', 400);
    }

    const [existingRow] = await connection.execute(
      'SELECT isActive FROM financial_year WHERE id = ?',
      [id]
    );

    if (!existingRow.length) {
      throw new CustomError('Financial year not found!', 404);
    }

    await connection.execute('UPDATE financial_year SET isActive = 0');

    await connection.execute(
      'UPDATE financial_year SET isActive = ? WHERE id = ?',
      [1, id]
    );

    // Fetch the newly active FY to broadcast
    const [activeFYRows] = await connection.execute(
      `SELECT id, DATE_FORMAT(fromDate, '%d-%m-%Y') AS fyFrom, DATE_FORMAT(toDate, '%d-%m-%Y') AS fyTo
       FROM financial_year WHERE id = ?`,
      [id]
    );

    // Emit to all connected ERP clients
    const io = getIO();
    io.of('/erp').emit(EVENTS.ACTIVE_FY_UPDATED, {
      action: 'FY_CHANGED',
      activeFY: activeFYRows[0],
      updatedBy: 'admin',
      updatedAt: new Date()
    });

    return handleSuccessResponse(res, 'Financial year status updated successfully!');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.fetchFY = async (req, res) => {
  try {
    const [rows] = await connection.execute(
      `SELECT ROW_NUMBER() OVER (ORDER BY id) AS sNo,  id, DATE_FORMAT(fromDate, '%d-%m-%Y') AS fromDate, DATE_FORMAT(toDate, '%d-%m-%Y') AS toDate, isActive 
      FROM financial_year`,
      []
    );

    return handleSuccessResponse(res, 'Financial years', rows);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.showdoc = async (req, res) => {
  try {
    const { fyfrom: fyFrom, fyto: fyTo } = req.headers;
    const [financialYrFrom, financialYrTo] = [formatDate(fyFrom), formatDate(fyTo)];

    if (!financialYrFrom || !financialYrTo) {
      throw new CustomError('Invalid financial year dates', 400);
    }

    const [prefixRows] = await connection.execute(`SELECT * FROM financial_year WHERE fromDate = ? AND toDate = ?`, [financialYrFrom, financialYrTo]);
    const [docRows] = await connection.execute(`SELECT * FROM document_number`, []);

    return res.status(200).json({
      success: true,
      message: "Document numbers fetched successfully",
      prefixRows: prefixRows,
      data: docRows
    });
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.updatedoc = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();
  try {
    const documents = req.body;

    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid request data" });
    }

    for (const doc of documents) {
      if (!doc.id) {
        throw new Error("Document ID is required.");
      }

      const updates = [];
      const values = [];
      const docNoFormat = Object.keys(doc)
        .filter(key => key.startsWith("sel") && doc[key] !== "")
        .map(key => doc[key])
        .join(",");
      const isResetForWeek = docNoFormat.split(',').includes('10');

      Object.entries(doc).forEach(([key, value]) => {
        if (key !== "id" && value !== undefined) {
          updates.push(`${key} = ?`);
          values.push(value);
        }
      });
      updates.push(`docNoFormat = ?, resetForWeek = ?`);
      values.push(docNoFormat, isResetForWeek ? 1 : 0);

      if (updates.length > 0) {
        values.push(doc.id);
        await conn.execute(
          `UPDATE document_number SET ${updates.join(", ")} WHERE id = ?`,
          values
        );
      }
    }

    await conn.commit();
    return handleSuccessResponse(res, 'Documents updated successfully');
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.docNumbersList = async (req, res) => {
  try {
    const { fyfrom: fyFrom, fyto: fyTo } = req.headers;

    const YrFrom = new Date(fyFrom).getFullYear();
    const YrTo = new Date(fyTo).getFullYear();
    const ShYrFrom = YrFrom.toString().slice(-2);
    const ShYrTo = YrTo.toString().slice(-2);

    const prefixObj = {
      1: 'Loc',
      2: YrFrom.toString(),
      3: YrTo.toString(),
      4: ShYrFrom.toString(),
      5: ShYrTo.toString(),
      6: '00001',
      7: '1',
      8: '0001',
      9: '001',
      10: '01',
      11: '/',
      12: '000001'

    };

    const [rows] = await connection.execute(`
      SELECT id, Document, Document_no, Pfx_Wise_resetno, document_change, sel1, sel2, sel3, sel4, sel5, sel6, sel7, sel8, sel9, sel10, sel11, sel2, sel3, sel4, docNoFormat 
      FROM document_number`,
      []
    );

    rows.forEach(row => {
      row.generated_no = row.docNoFormat ? row.docNoFormat.split(',').map(key => prefixObj[key]).join('') : '';
    });

    return handleSuccessResponse(res, 'Document numbers', rows);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}

// Controller function to generate document number
exports.generateDocNumber = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const { docType, customValue = '' } = req.query;

    const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType, customValue }); // Generate document number

    await conn.commit();
    return res.status(200).json({
      success: true,
      message: "Document number generated successfully",
      digtit: padStartNo,
      uniqueNo
    });
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.testDocNumber = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    const { docType, docNo, customValue = '' } = req.query;

    const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType, customValue }); // Generate document number
    // await updateDocCounter(conn, docType, { docNo, type: customValue })  // Update document counter

    await conn.commit();
    return res.status(200).json({
      success: true,
      message: "Document number generated successfully",
      padStartNo,
      uniqueNo
    });
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.testSyncDocNumber = async (req, res) => {
  try {
    const { docType, lastDocNumber, customValue = '' } = req.query;

    await syncCounter(req, { docType, lastDocNumber, customValue })

    return handleSuccessResponse(res, 'Document number synced successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}

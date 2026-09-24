const utility = require("../utility/utilityFunction");
const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require("../config/dbSql");

// req.body fields arrive already parsed (express.json()) when sent as JSON,
// but as JSON strings when sent via multipart/form-data. Handle both.
const parseJsonField = (value) => {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return [];
};

exports.search = async (req, res) => {
  try {
    const { q } = req.query;

    let fetch = `SELECT customer.id, customer.cCode as label FROM customer`;
    const values = [];

    if (q) {
      fetch += ` WHERE customer.cCode LIKE ?`;
      values.push(`%${q}%`);
    }
    fetch += ` LIMIT 20`;

    const [rows] = await connection.execute(fetch, values);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
  }
}

// Utility functions to insert related data
const customerDocuments = async (conn, customerId, files) => {
  if (!files || files.length === 0) return;
  for (const { fileType, file } of files) {
    if (!file) continue;
    const fileName = utility.storeFile(file, "customer");
    await conn.execute(
      `INSERT INTO cus_doc (cId, fileType, filePath) VALUES (?,?,?)`,
      [customerId, fileType, fileName]
    );
  }
};

const customerContactPersons = async (conn, customerId, contactPersons) => {
  if (!contactPersons || contactPersons.length === 0) return;
  for (const c of contactPersons) {
    const fileName = c.file ? utility.storeFile(c.file, "customer") : null;
    await conn.execute(
      `INSERT INTO cus_con_person (cId, code, name, department, designation, mbNo, telNo, email, fax, remark, file) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [customerId, c.code, c.name, c.department, c.designation, c.mbNo, c.telNo, c.email, c.fax, c.remark, fileName]
    );
  }
};

exports.store = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();
  try {
    const { custDetails: c, customerDocs, multiAddress, contactPersons } = req.body;

    // Check for duplicate entry
    const [custRows] = await conn.execute(`SELECT id FROM customer WHERE cCode = ?`, [c.cCode]);
    if (custRows.length > 0) {
      throw new CustomError("Duplicate entry for Customer code!", 400);
    }

    // Insert new customer
    const [insertResult] = await conn.execute(
      `INSERT INTO customer (cCode, gstNo, cName, tallyAlias, cGroup, cAddress1, cAddress2, cAddress3, cAddress4, inactiveStatus, city, pincode, state, country, partyNotes, currency, panNo, gstInUinId, bi_phoneNo, 
      bi_faxNo, email, payTerm, noTaxRemark, creditday, placeOfSupply, tcsCollected, SubcharOnTcs, CessOnTcs, singleSaleOrd, dcValue, shortClose, cgst, sgst, igst, utgst, dcInfoReq, maxLineItem) 
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.cCode, c.gstNo, c.cName, c.tallyAlias, c.cGroup, c.cAddress1, c.cAddress2, c.cAddress3, c.cAddress4, c.inactiveStatus, c.city, c.pincode, c.state, c.country, c.partyNotes, c.currency, c.panNo, c.gstInUinId, c.bi_phoneNo, c.bi_faxNo,
      c.email, c.payTerm, c.noTaxRemark, c.creditday, c.placeOfSupply, c.tcsCollected, c.SubcharOnTcs, c.CessOnTcs, c.singleSaleOrd, c.dcValue, c.shortClose, c.cgst, c.sgst, c.igst, c.utgst, c.dcInfoReq, c.maxLineItem]
    );

    if (insertResult.affectedRows === 0) {
      throw new CustomError("Error adding customer details", 400);
    }

    const customerId = insertResult.insertId;

    await conn.execute(`UPDATE customer SET cId = id WHERE id = ?`, [customerId]);

    // Insert related data
    await customerDocuments(conn, customerId, parseJsonField(customerDocs));
    await customerMultiAddress(conn, customerId, parseJsonField(multiAddress));
    await customerContactPersons(conn, customerId, parseJsonField(contactPersons));

    await conn.commit();
    return handleSuccessResponse(res, "Successfully added");
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

// Utility functions to update related data
const updateCustomerDocuments = async (conn, customerId, files) => {
  await conn.execute(`DELETE FROM cus_doc WHERE cId = ?`, [customerId]); // Remove old files
  if (!files || files.length === 0) return;

  for (const { fileType, file } of files) {
    if (!file) continue;
    const fileName = utility.storeFile(file, "customer");
    await conn.execute(
      `INSERT INTO cus_doc (cId, fileType, filePath) VALUES (?,?,?)`,
      [customerId, fileType, fileName]
    );
  }
};

// const updateCustomerMultiAddress = async (conn, customerId, multiAddress) => {
//   await conn.execute(`DELETE FROM cus_multi_add WHERE cId = ?`, [customerId]); // Remove old addresses
//   if (!multiAddress || multiAddress.length === 0) return;

//   for (const add of multiAddress) {
//     await conn.execute(
//       `INSERT INTO cus_multi_add (cId, code, custName, address,	gstNo) VALUES (?,?,?,?,?)`,
//       [customerId, add.code, add.custName, add.address, add.gstNo]
//     );
//   }
// };


const customerMultiAddress = async (conn, customerId, multiAddress) => {
  if (!multiAddress || multiAddress.length === 0) {
    await conn.execute(`DELETE FROM cus_multi_add WHERE cId = ?`, [customerId]);
    return;
  }

  const incomingIds = multiAddress.filter((add) => add.id).map((add) => add.id);
  if (incomingIds.length > 0) {
    const placeholders = incomingIds.map(() => "?").join(",");
    await conn.execute(
      `DELETE FROM cus_multi_add WHERE cId = ? AND id NOT IN (${placeholders})`,
      [customerId, ...incomingIds]
    );
  } else {
    await conn.execute(`DELETE FROM cus_multi_add WHERE cId = ?`, [customerId]);
  }

  for (const add of multiAddress) {
    if (add.id) {
      const [existing] = await conn.execute(
        `SELECT id FROM cus_multi_add WHERE id = ? AND cId = ?`,
        [add.id, customerId]
      );
      if (existing.length > 0) {
        await conn.execute(
          `UPDATE cus_multi_add SET code = ?, custName = ?, address = ?, gstNo = ? WHERE id = ? AND cId = ?`,
          [add.code, add.custName, add.address, add.gstNo, add.id, customerId]
        );
        continue;
      }
    }

    await conn.execute(
      `INSERT INTO cus_multi_add (cId, code, custName, address, gstNo) VALUES (?,?,?,?,?)`,
      [customerId, add.code, add.custName, add.address, add.gstNo]
    );
  }
};


const updateCustomerContactPersons = async (conn, customerId, contactPersons) => {
  await conn.execute(`DELETE FROM cus_con_person WHERE cId = ?`, [customerId]); // Remove old contacts
  if (!contactPersons || contactPersons.length === 0) return;

  for (const c of contactPersons) {
    const fileName = c.file ? utility.storeFile(c.file, "customer") : null;
    await conn.execute(
      `INSERT INTO cus_con_person (cId, code, name, department, designation, mbNo, telNo, email, fax, remark, file) 
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [customerId, c.code, c.name, c.department, c.designation, c.mbNo, c.telNo, c.email, c.fax, c.remark, fileName]
    );
  }
};

exports.update = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();
  try {
    const { custDetails: c, customerDocs, multiAddress, contactPersons } = req.body;
    const { id: customerId } = req.params;

    // Check if customer exists
    const [existing] = await conn.execute(`SELECT id FROM customer WHERE id = ?`, [customerId]);
    if (existing.length === 0) {
      throw new CustomError("Customer not found!", 404);
    }

    // Update customer details
    const [updateResult] = await conn.execute(
      `UPDATE customer 
        SET cCode = ?, gstNo = ?, cName = ?, tallyAlias = ?, cGroup = ?, cAddress1 = ?, cAddress2 = ?, cAddress3 = ?, cAddress4 = ?, inactiveStatus = ?, city = ?, pincode = ?, state = ?, 
        country = ?, partyNotes = ?, currency = ?, panNo = ?, gstInUinId = ?, bi_phoneNo = ?, bi_faxNo = ?, email = ?, payTerm = ?, noTaxRemark = ?, creditday = ?, placeOfSupply = ?, 
        tcsCollected = ?, SubcharOnTcs = ?, CessOnTcs = ?, singleSaleOrd = ?, dcValue = ?, shortClose = ?, cgst = ?, sgst = ?, igst = ?, utgst = ?, dcInfoReq = ?, maxLineItem = ? 
      WHERE id = ?`,
      [c.cCode, c.gstNo, c.cName, c.tallyAlias, c.cGroup, c.cAddress1, c.cAddress2, c.cAddress3, c.cAddress4, c.inactiveStatus, c.city, c.pincode, c.state, c.country, c.partyNotes,
      c.currency, c.panNo, c.gstInUinId, c.bi_phoneNo, c.bi_faxNo, c.email, c.payTerm, c.noTaxRemark, c.creditday, c.placeOfSupply, c.tcsCollected, c.SubcharOnTcs, c.CessOnTcs,
      c.singleSaleOrd, c.dcValue, c.shortClose, c.cgst, c.sgst, c.igst, c.utgst, c.dcInfoReq, c.maxLineItem, customerId]
    );

    if (updateResult.affectedRows === 0) {
      throw new CustomError("Error updating customer details", 400);
    }

    // Update related data
    await customerDocuments(conn, customerId, parseJsonField(customerDocs));
    await customerMultiAddress(conn, customerId, parseJsonField(multiAddress));
    await customerContactPersons(conn, customerId, parseJsonField(contactPersons));

    await conn.commit();
    return handleSuccessResponse(res, "Customer updated successfully");
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await connection.execute(`SELECT id FROM customer WHERE id = ?`, [id]);
    if (existing.length === 0) {
      throw new CustomError("Customer not found!", 404);
    }

    await connection.execute(`DELETE FROM customer WHERE id = ?`, [id]);

    return handleSuccessResponse(res, "Customer deleted successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}

exports.getCustomers = async (req, res) => {
  try {
    const { type = 'last', id } = req.query;

    let customerQuery = `
      SELECT 
        c.id, c.cCode, c.gstNo, c.cName, c.tallyAlias, c.cGroup, c.cAddress1, c.cAddress2, c.cAddress3, c.cAddress4, c.inactiveStatus, c.city, c.pincode, c.state, c.country, c.partyNotes, 
        c.currency, c.panNo, c.gstInUinId,  c.bi_phoneNo, c.bi_faxNo, c.email, c.payTerm, c.noTaxRemark,  c.creditday, c.placeOfSupply, c.tcsCollected, c.SubcharOnTcs, c.CessOnTcs, 
        c.singleSaleOrd, c.dcValue, c.shortClose, c.cgst, c.sgst, c.igst, c.utgst, c.gst, c.dcInfoReq, c.maxLineItem
      FROM customer c
    `;
    let params = [];

    switch (type) {
      case 'first':
        customerQuery += ` ORDER BY c.id ASC LIMIT 1`;
        break;
      case 'last':
        customerQuery += ` ORDER BY c.id DESC LIMIT 1`;
        break;
      case 'forward':
        customerQuery += ` WHERE c.id > ? ORDER BY c.id ASC LIMIT 1`;
        params.push(id);
        break;
      case 'reverse':
        customerQuery += ` WHERE c.id < ? ORDER BY c.id DESC LIMIT 1`;
        params.push(id);
        break;
      case 'fetchByID':
        customerQuery += ` WHERE c.id = ?`;
        params.push(id);
        break;
    }

    const [rows] = await connection.execute(customerQuery, params);

    const customerId = rows[0]?.id || null;
    const [customerDocs] = await connection.execute(`SELECT id, fileType, filePath as file, 1 as saved FROM cus_doc WHERE cId = ?`, [customerId]);
    const [multiAddress] = await connection.execute(`SELECT id, cId, code, custName,  category, address, gstNo, defaultAddress FROM cus_multi_add WHERE cId = ?`, [customerId]);
    const [contactPersons] = await connection.execute(`SELECT id, cId, code, name, department, designation, mbNo, telNo, email, fax, remark, file FROM cus_con_person WHERE cId = ?`, [customerId]);

    return res.status(200).json({
      success: true,
      custDetails: rows.length > 0 ? rows[0] : {},
      customerDocs,
      multiAddress,
      contactPersons
    });
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}

exports.show = async (req, res) => {
  try {
    let customerQuery = `
      SELECT 
        c.id, c.cCode, c.gstNo, c.cName, c.tallyAlias, c.cGroup,  c.cAddress1, c.cAddress2, c.cAddress3, c.cAddress4, c.inactiveStatus, c.city, c.pincode, c.state, c.country, 
        c.partyNotes, c.currency, c.panNo, c.gstInUinId,  c.bi_phoneNo, c.bi_faxNo, c.email, c.payTerm, c.noTaxRemark, c.creditday, c.placeOfSupply, c.tcsCollected, c.SubcharOnTcs, 
        c.CessOnTcs, c.singleSaleOrd, c.dcValue, c.shortClose, c.cgst, c.sgst, c.igst, c.utgst, c.gst, c.dcInfoReq, c.maxLineItem, cur.code as currencyName, cg.code as cGroupName, sp.name as placeOfSupplyName
      FROM customer c
      LEFT JOIN mst_currency cur ON c.currency = cur.id
      LEFT JOIN mst_cust_group cg ON c.cGroup  = cg.id
      LEFT JOIN mst_sup_place sp ON c.placeOfSupply = sp.id
    `;

    const [rows] = await connection.execute(customerQuery, []);
    
    return handleSuccessResponse(res, 'Customers list', rows);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}


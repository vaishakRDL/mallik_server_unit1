const utility = require("../utility/utilityFunction");
const { connection, handleErrorResponse, handleSuccessResponse } = require("../config/dbSql");

exports.store = async (req, res) => {
  try {
    const c = req.body;
    const filePath = utility.storeFile(c.file, "customer");
    const fetch = "SELECT id FROM cus_con_person WHERE code = ?";

    const [results] = await connection.execute(fetch, [c.code]);

    if (results.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Duplicate entry for Supplier name!",
      });
    }

    const store = "INSERT INTO cus_con_person (cId, code, name, department, designation, mbNo, telNo, email, fax, remark, file) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    await connection.execute(store, [
      c.cId,
      c.code,
      c.name,
      c.department,
      c.designation,
      c.mbNo,
      c.telNo,
      c.email,
      c.fax,
      c.remark,
      filePath
    ]);

    return handleSuccessResponse(res, "Successfully added");

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const sp = req.body;
    const filePath = utility.storeFile(sp.img, "customer");

    const fetch = 'SELECT id FROM cus_con_person WHERE id = ?';
    const [results] = await connection.execute(fetch, [id]);

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'Details not found!' });
    }

    const update = `UPDATE cus_con_person SET cId = ?, code = ?, name = ?, department = ?, designation = ?, mbNo = ?, telNo = ?, email = ?, fax = ?, remark = ?, file = ? WHERE id = ?`;
    await connection.execute(update, [
      sp.cId,
      sp.code,
      sp.name,
      sp.department,
      sp.designation,
      sp.mbNo,
      sp.telNo,
      sp.email,
      sp.fax,
      sp.remark,
      filePath,
      id
    ]);

    return handleSuccessResponse(res, "Successfully updated");

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.deleteById = async (req, res) => {
  try {
    const id = req.params.id;

    const fetch = 'SELECT id FROM cus_con_person WHERE id = ?';
    const [results] = await connection.execute(fetch, [id]);

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'Address not found!' });
    }

    const query = 'DELETE FROM cus_con_person WHERE id = ?';
    await connection.execute(query, [id]);

    return handleSuccessResponse(res, "Successfully deleted");

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.delete = async (req, res) => {
  try {
    const id = req.params.id;

    const fetch = 'SELECT id FROM cus_con_person WHERE cId = ?';
    const [results] = await connection.execute(fetch, [id]);

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'Address not found!' });
    }

    const query = 'DELETE FROM cus_con_person WHERE cId = ?';
    await connection.execute(query, [id]);

    return handleSuccessResponse(res, "Successfully deleted");

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.show = async (req, res) => {
  try {
    const id = req.params.id;

    const fetch = 'SELECT * FROM cus_con_person WHERE cId = ?';
    const [results] = await connection.execute(fetch, [id]);

    return handleSuccessResponse(res, "Multi address list", results);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

  

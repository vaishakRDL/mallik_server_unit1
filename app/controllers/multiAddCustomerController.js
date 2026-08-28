const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');

exports.store = async (req, res) => {
  try {
    const c = req.body;

    // 1️⃣ Check duplicate
    const fetch = `SELECT * FROM cus_multi_add WHERE cId = ?`;
    const [results] = await connection.execute(fetch, [c.cId]);

    if (results.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Duplicate entry for Supplier name!",
      });
    }

    // 2️⃣ Insert data
    const store = `
      INSERT INTO cus_multi_add 
      (cId, code, category, address, defaultAddress)
      VALUES (?, ?, ?, ?, ?)
    `;

    await connection.execute(store, [
      c.cId,
      c.cust_Code,
      c.category,
      c.address,
      c.def_ship_add,
    ]);

    return res.status(200).json({
      success: true,
      message: "Successfully added",
    });

  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "An error occurred",
    });
  }
};

exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const sp = req.body;

    // 1️⃣ Check if record exists
    const fetch = `SELECT * FROM cus_multi_add WHERE id = ?`;
    const [results] = await connection.execute(fetch, [id]);

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Details not found!",
      });
    }

    // 2️⃣ Update record
    const update = `
      UPDATE cus_multi_add 
      SET cId = ?, code = ?, category = ?, address = ?, defaultAddress = ?
      WHERE id = ?
    `;

    await connection.execute(update, [
      sp.cId,
      sp.cust_Code,
      sp.category,
      sp.address,
      sp.def_ship_add,
      id,
    ]);

    return res.status(200).json({
      success: true,
      message: "Successfully updated",
    });

  } catch (err) {
    return res.status(401).json({
      success: false,
      message: err.message || "An error occurred",
    });
  }
};

exports.deleteById = async (req, res) => {
  try {
    const id = req.params.id;

    // 1️⃣ Check if record exists
    const fetch = `SELECT * FROM cus_multi_add WHERE id = ?`;
    const [results] = await connection.execute(fetch, [id]);

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Address not found!",
      });
    }

    // 2️⃣ Delete record
    const query = `DELETE FROM cus_multi_add WHERE id = ?`;
    await connection.execute(query, [id]);

    return res.status(200).json({
      success: true,
      message: "Successfully deleted",
    });

  } catch (err) {
    return res.status(401).json({
      success: false,
      message: err.message || "An error occurred",
    });
  }
};

exports.delete = async (req, res) => {
  try {
    const id = req.params.id;

    // 1️⃣ Check if address exists for this cId
    const fetch = `SELECT * FROM cus_multi_add WHERE cId = ?`;
    const [results] = await connection.execute(fetch, [id]);

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Address not found!",
      });
    }

    // 2️⃣ Delete all rows for this cId
    const query = `DELETE FROM cus_multi_add WHERE cId = ?`;
    await connection.execute(query, [id]);

    return res.status(200).json({
      success: true,
      message: "Successfully deleted",
    });

  } catch (err) {
    return res.status(401).json({
      success: false,
      message: err.message || "An error occurred",
    });
  }
};

exports.show = async (req, res) => {
  try {
    const id = req.params.id;

    const fetch = `SELECT * FROM cus_multi_add WHERE cId = ?`;
    const [results] = await connection.execute(fetch, [id]);

    return res.status(200).json({
      success: true,
      message: "Multi address list",
      data: results, // empty array is fine
    });

  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "An error occurred",
    });
  }
};


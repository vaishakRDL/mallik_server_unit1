const { connection, handleErrorResponse, handleSuccessResponse } = require("../config/dbSql");

exports.store = async (req, res) => {
  try {
    const c = req.body;

    const fetch = "SELECT id FROM mst_transport WHERE transportName = ?";
    const [results] = await connection.execute(fetch, [c.transportName]);

    if (results.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Duplicate entry for Transport name!",
      });
    }

    const store = "INSERT INTO mst_transport (transportName, gstin, discription) VALUES (?, ?, ?)";
    await connection.execute(store, [c.transportName, c.gstin, c.discription]);

    return handleSuccessResponse(res, "Successfully added");

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const c = req.body;

    const fetch = "SELECT id FROM mst_transport WHERE id = ?";
    const [results] = await connection.execute(fetch, [id]);

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: "Transport datails not found!" });
    }

    const update = `UPDATE mst_transport SET transportName = ?, gstin = ?, discription = ? WHERE id = ?`;
    await connection.execute(update, [c.transportName, c.gstin, c.discription, id]);

    return handleSuccessResponse(res, "Successfully updated");

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.delete = async (req, res) => {
  try {
    const id = req.params.id;

    const fetch = "SELECT id FROM mst_transport WHERE id = ?";
    const [results] = await connection.execute(fetch, [id]);

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: "Transport datails not found!" });
    }

    const query = "DELETE FROM mst_transport WHERE id = ?";
    await connection.execute(query, [id]);

    return handleSuccessResponse(res, "Successfully deleted");

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.show = async (req, res) => {
  try {
    const fetch = "SELECT * FROM mst_transport";
    const [results] = await connection.execute(fetch);

    return handleSuccessResponse(res, "Transport list", results);

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

  

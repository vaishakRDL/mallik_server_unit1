const { connection, CustomError, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');



exports.store = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const { type, process, tempName, description } = req.body;

    const fetch = `
      SELECT id  FROM qlty_template  WHERE type = ? AND process = ?
    `;

    const [existing] = await conn.execute(fetch, [type, process]);

    if (existing.length > 0) {
      return handleErrorResponse(
        res, new CustomError ("For this process, template already exists!")
      );
    }

    const store = `
      INSERT INTO qlty_template (type, process, tempName, description)
      VALUES (?, ?, ?, ?)
    `;

    const [result] = await conn.execute(store, [
      type, process, tempName, description,
    ]);

    return handleSuccessResponse(res, "Data Added Successfully", result);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


exports.update = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;
    const { type, process, tempName, description } = req.body;

    await conn.beginTransaction();

    const fetch = `SELECT id FROM qlty_template WHERE id = ?`;
    const [exists] = await conn.execute(fetch, [id]);

    if (exists.length === 0) {
      await conn.rollback();
      return handleErrorResponse(res, new Error("Data not found"));
    }

    const updateTemplate = `
      UPDATE qlty_template
      SET type = ?, process = ?, tempName = ?, description = ?
      WHERE id = ?
    `;

    await conn.execute(updateTemplate, [
      type, process, tempName, description, id,
    ]);

    const updateQc = `
      UPDATE qc_field
      SET processId = ?
      WHERE tempId = ?
    `;

    await conn.execute(updateQc, [process, id]);

    await conn.commit();

    return handleSuccessResponse(res, "Data Updated", { id });
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


exports.delete = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;

    const fetch = `SELECT id FROM qlty_template WHERE id = ?`;
    const [exists] = await conn.execute(fetch, [id]);

    if (exists.length === 0) {
      return handleErrorResponse(res, new Error("Data not found"));
    }

    const del = `DELETE FROM qlty_template WHERE id = ?`;
    const [result] = await conn.execute(del, [id]);

    return handleSuccessResponse(res, "Data Deleted", result);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


exports.show = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const fetch = `
      SELECT 
        qt.*, 
        pm.name AS process,
        pm.id AS processId
      FROM qlty_template qt
      INNER JOIN mst_pm pm 
        ON qt.process = pm.id
    `;

    const [data] = await conn.execute(fetch);

    return handleSuccessResponse(res, "ShowData", data);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

//-------------------    Creatng Type OF Inspection Master for Qc Field     ------------------------------//


exports.inspecStore = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const { inspectionType, description } = req.body;

    const store = `
      INSERT INTO mst_qlty_inspections (inspectionType, description)
      VALUES (?, ?)
    `;

    const [result] = await conn.execute(store, [
      inspectionType, description,
    ]);

    return handleSuccessResponse(res, "Data Added Successfully", result);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


exports.inspecUpdate = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;
    const { inspectionType, description } = req.body;

    const fetch = `
      SELECT id 
      FROM mst_qlty_inspections 
      WHERE id = ?
    `;

    const [exists] = await conn.execute(fetch, [id]);

    if (exists.length === 0) {
      return handleErrorResponse(res, new Error("Data not found"));
    }

    const update = `
      UPDATE mst_qlty_inspections
      SET inspectionType = ?, description = ?
      WHERE id = ?
    `;

    const [result] = await conn.execute(update, [
      inspectionType, description, id,
    ]);

    return handleSuccessResponse(res, "Data Updated", result);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


exports.inspecDelete = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;

    const fetch = `
      SELECT id 
      FROM mst_qlty_inspections 
      WHERE id = ?
    `;

    const [exists] = await conn.execute(fetch, [id]);

    if (exists.length === 0) {
      return handleErrorResponse(res, new Error("Data not found"));
    }

    const del = `
      DELETE FROM mst_qlty_inspections 
      WHERE id = ?
    `;

    const [result] = await conn.execute(del, [id]);

    return handleSuccessResponse(res, "Data Deleted", result);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


exports.inspecShow = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const fetch = `
      SELECT * 
      FROM mst_qlty_inspections
    `;

    const [data] = await conn.execute(fetch);

    return handleSuccessResponse(res, "ShowData", data);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

//------------------------         Qc Fields Adding For Particulat Template      ------------------------------//


exports.qcStore = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const { tempId, processId, label, uom, inspectionType } = req.body;

    const store = `
      INSERT INTO qc_field (tempId, processId, label, uom, inspectionType)
      VALUES (?, ?, ?, ?, ?)
    `;

    const [result] = await conn.execute(store, [
      tempId, processId, label, uom, inspectionType,
    ]);

    return handleSuccessResponse(res, "Data Added Successfully", result);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.qcUpdate = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;
    const { tempId, processId, label, uom, inspectionType } = req.body;

    const fetch = `
      SELECT id 
      FROM qc_field 
      WHERE id = ?
    `;

    const [exists] = await conn.execute(fetch, [id]);

    if (exists.length === 0) {
      return handleErrorResponse(res, new Error("Data not found"));
    }

    const update = `
      UPDATE qc_field
      SET tempId = ?, processId = ?, label = ?, uom = ?, inspectionType = ?
      WHERE id = ?
    `;

    const [result] = await conn.execute(update, [
      tempId, processId, label, uom, inspectionType, id,
    ]);

    return handleSuccessResponse(res, "Data Updated", result);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.qcDelete = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;

    const fetch = `
      SELECT id 
      FROM qc_field 
      WHERE id = ?
    `;

    const [exists] = await conn.execute(fetch, [id]);

    if (exists.length === 0) {
      return handleErrorResponse(res, new Error("Data not found"));
    }

    const del = `
      DELETE FROM qc_field 
      WHERE id = ?
    `;

    const [result] = await conn.execute(del, [id]);

    return handleSuccessResponse(res, "Data Deleted", result);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


exports.qcShow = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const tempId = req.params.id;

    const fetch = `
      SELECT 
        qc_field.*, uomTab.name AS uom, uomTab.id AS uomId, inspec.inspectionType AS inspectionType, inspec.id AS inspectionId
      FROM qc_field
      INNER JOIN mst_uom AS uomTab 
        ON qc_field.uom = uomTab.id
      INNER JOIN mst_qlty_inspections AS inspec 
        ON qc_field.inspectionType = inspec.id
      WHERE qc_field.tempId = ? 
        AND qc_field.dflag = 0
    `;

    const [data] = await conn.execute(fetch, [tempId]);

    return handleSuccessResponse(res, "ShowData", data);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


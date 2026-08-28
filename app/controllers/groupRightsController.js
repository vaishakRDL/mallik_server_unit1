const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');

exports.getRights = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    const { type, code } = req.body;

    await conn.beginTransaction();

    const fetchQuery = `
      SELECT 
        gr.*, menu.name AS menuName, menu.id AS menuId, menu.code
      FROM group_rights gr
      INNER JOIN mst_menu AS menu ON gr.menuId = menu.id
      WHERE gr.groupCode = ? AND gr.type = ? AND gr.dflag = 0
    `;

    const [results] = await conn.execute(fetchQuery, [code, type]);

    const transformedData = results.map(item => ({
      id: item.id,
      menuName: item.menuName,
      type: item.type,
      code: item.code,
      menuId: item.menuId,

      addData: !!item.addData,
      updateData: !!item.updateData,
      deleteData: !!item.deleteData,
      viewData: !!item.viewData,
      print: !!item.print,
      auth: !!item.auth,
      auth1: !!item.auth1,
      opt1: !!item.opt1,
      opt2: !!item.opt2,
      opt3: !!item.opt3,
      opt4: !!item.opt4,
      opt5: !!item.opt5
    }));

    await conn.commit();

    return handleSuccessResponse(res, "MenuType Master list", transformedData);

  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.submit = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    const groups = req.body.data;

    if (!Array.isArray(groups)) {
      return res.status(400).json({
        success: false,
        message: "Invalid input. Expected an array of objects."
      });
    }

    await conn.beginTransaction();

    const fetchQuery = `SELECT id FROM group_rights WHERE id = ?`;

    const updateQuery = `
      UPDATE group_rights
      SET
        addData = ?,
        updateData = ?,
        deleteData = ?,
        viewData = ?,
        print = ?,
        auth = ?,
        auth1 = ?,
        opt1 = ?,
        opt2 = ?,
        opt3 = ?,
        opt4 = ?,
        opt5 = ?
      WHERE id = ?
    `;

    for (const g of groups) {
      /* ---- check existence ---- */
      const [[row]] = await conn.execute(fetchQuery, [g.id]);

      if (!row) {
        throw new Error(`Data not found for id ${g.id}`);
      }

      /* ---- update ---- */
      await conn.execute(updateQuery, [
        g.addData,
        g.updateData,
        g.deleteData,
        g.viewData,
        g.print,
        g.auth,
        g.auth1,
        g.opt1,
        g.opt2,
        g.opt3,
        g.opt4,
        g.opt5,
        g.id
      ]);
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

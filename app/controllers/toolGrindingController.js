const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require('../config/dbSql');



// exports.getToolGrinding = async (req, res) => {
//   try {
//     const [data] = await connection.query(`
//       SELECT 
//         t.id,
        
//         t.toolNo AS toolName,
//         t.toolUsageLife AS maxToolLife,
//         t.uom,
//         u.name as uomName,
//         tal.alertDateTime as date,
//         CASE 
//           WHEN t.grindingsupportid = 'Yes' THEN 'Grinding'
//           ELSE 'Replacement'
//         END AS alertType
//       FROM tool t
//       INNER JOIN mst_uom u ON t.uom = u.id
//       INNER JOIN tool tl ON u.id = tl.uom
//       INNER JOIN tool_alert_log tal ON tl.id = tal.toolId
//     `);

//     const response = data.map((row, index) => ({
//       slno: index + 1,
//       date: row.date || null, 
//       id: row.id,
//       toolName: row.toolName,
//       maxToolLife: row.maxToolLife,
//       uom: row.uom,
//       uomName:row.uomName,
//       alertType: row.alertType
//     }));

//     return handleSuccessResponse(res, 'Tool grinding data fetched successfully', response);
//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };

exports.getToolGrinding = async (req, res) => {
  try {
    const [data] = await connection.query(`
      SELECT 
        t.id,
        t.toolNo AS toolName,
        t.toolUsageLife AS maxToolLife,
        t.uom,
        u.name AS uomName,
        (
          SELECT DATE_FORMAT(tal.alertDateTime, '%Y-%m-%d') 
          FROM tool_alert_log tal 
          WHERE tal.toolId = t.id 
          ORDER BY tal.alertDateTime DESC 
          LIMIT 1
        ) AS date,
        CASE 
          WHEN t.grindingsupportid = 'Yes' THEN 'Grinding'
          ELSE 'Replacement'
        END AS alertType
      FROM tool t
      INNER JOIN mst_uom u ON t.uom = u.id
    `);

    const response = data.map((row, index) => ({
      slno: index + 1,
      date: row.date || null, 
      id: row.id,
      toolName: row.toolName,
      maxToolLife: row.maxToolLife,
      uom: row.uom,
      uomName: row.uomName,
      alertType: row.alertType
    }));

    return handleSuccessResponse(res, 'Tool grinding data fetched successfully', response);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};





  exports.updateToolGrinding = async (req, res) => {
    try {
      const { id } = req.params;
      const {
        toolNo,
        toolUsageLife,
        uom,
        grindingsupportid // 'Yes' or 'No'
      } = req.body;
  
      const fields = [];
      const values = [];
  
      if (toolNo !== undefined) {
        fields.push('toolNo = ?');
        values.push(toolNo);
      }
      if (toolUsageLife !== undefined) {
        fields.push('toolUsageLife = ?');
        values.push(toolUsageLife);
      }
      if (uom !== undefined) {
        fields.push('uom = ?');
        values.push(uom);
      }
      if (grindingsupportid !== undefined) {
        fields.push('grindingsupportid = ?');
        values.push(grindingsupportid);
      }
  
      if (fields.length === 0) {
        throw new CustomError('No fields provided for update', 400);
      }
  
      values.push(id);
  
      const [result] = await connection.query(`
        UPDATE tool SET ${fields.join(', ')} WHERE id = ?
      `, values);
  
      return handleSuccessResponse(res, 'Tool grinding data updated successfully');
    } catch (err) {
      return handleErrorResponse(res, err);
    }
  };

  
  exports.deleteToolGrinding = async (req, res) => {
    try {
      const { id } = req.params;
  
      const [result] = await connection.query(
        `DELETE FROM tool WHERE id = ?`, [id]
      );
  
      return handleSuccessResponse(res, 'Tool grinding data deleted successfully');
    } catch (err) {
      return handleErrorResponse(res, err);
    }
  };
  

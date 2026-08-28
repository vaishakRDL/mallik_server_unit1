const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require('../config/dbSql');


exports.getToolUsageReport = async (req, res) => {
    try {
      const [data] = await connection.query(`
        SELECT 
          t.id,
          t.toolNo,
          t.toolUsageLife AS maxToolLife,
          t.uom,
          u.name as uomName,
          t.toolUsageCount,
          t.grindingAlert,
          t.replacementCount AS toolReplacementCount,
          NULL AS noOfGrinding
        FROM tool t
        INNER JOIN mst_uom u ON t.uom = u.id   
  
      `);
      const dataWithSlNo = data.map((row, index) => ({
        slno: index + 1,
        ...row
      }));
  
      return handleSuccessResponse(res, 'Tool Grinding data fetched successfully', dataWithSlNo);
    } catch (err) {
      return handleErrorResponse(res, err);
    }
  };


 // 1. Get all tools by selected machine
exports.getToolsByMachineId = async (req, res) => {
  try {
    const { machineId } = req.params;

    const query = `
      SELECT 
        t.id AS toolId,
        t.toolNo
  
      FROM partnovstool pt
      INNER JOIN tool t ON pt.toolId = t.id
      WHERE pt.machineId = ?
    `;

    const [data] = await connection.query(query, [machineId]);

    return handleSuccessResponse(res, 'Tools for selected machine fetched', data);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

// 2. Get tool alert report based on machine, tool and date range
exports.getToolAlertReport = async (req, res) => {
  try {
    const { fromDate, toDate, machineId, toolId } = req.body; // 🔁 Read from body now

    let query = `
      SELECT 
        t.id AS toolId,
        t.toolNo,
        t.toolUsageLife AS maxToolLife,
        t.toolUsageCount,
        t.uom,
        u.name as uomName,
        m.machineName,
        t.grindingAlert,
        DATE(tal.alertDateTime) as alertdate, -- Show only date
        t.created_at,
        (t.toolUsageCount - t.toolUsageLife) AS overUsage,
        CASE 
          WHEN t.grindingAlert = 'Yes' THEN 'Grinding'
          ELSE 'Replacement'
        END AS alertType
      FROM tool t
      INNER JOIN mst_uom u ON t.uom = u.id
      INNER JOIN partnovstool pt ON t.id = pt.toolId
      INNER JOIN machines m ON pt.machineId = m.id
      LEFT JOIN tool_alert_log tal ON tal.toolId = t.id
      WHERE 1 = 1
    `;

    const params = [];

    if (fromDate && toDate) {
      query += ` AND DATE(t.created_at) BETWEEN ? AND ?`;
      params.push(fromDate, toDate);
    }

    if (machineId) {
      query += ` AND pt.machineId = ?`;
      params.push(machineId);
    }

    if (toolId) {
      query += ` AND t.id = ?`;
      params.push(toolId);
    }

    const [data] = await connection.query(query, params);

    const dataWithSlNo = data.map((row, index) => ({
      id: index + 1,
      ...row
    }));

    return handleSuccessResponse(res, 'Tool Alert Report fetched successfully', dataWithSlNo);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};




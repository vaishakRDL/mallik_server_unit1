const { connection, handleErrorResponse, handleSuccessResponse, CustomError, secondaryDB } = require('../config/dbSql');
const { toolUsageCountUpdate } = require("./toolComplaintController");

exports.getToolMonitoring = async (req, res) => {
  try {
    const [data] = await connection.query(`
      SELECT 
        t.id,
        t.toolNo,  
        t.uom,
        t.toolName,
        u.name as uomName,
        t.toolUsageCount,
        t.grindingAlert,
        t.replacementCount AS toolReplacementCount,
        t.grindingCount
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


exports.updateToolMonitoring = async (req, res) => {
  try {
    const id = req.params.id;
    const {
      toolNo,
      toolUsageLife,
      uom,
      uomName,
      toolUsageCount,
      grindingAlert,
      replacementCount,
      noOfGrinding
    } = req.body;

    // Build dynamic update fields
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
    if (toolUsageCount !== undefined) {
      fields.push('toolUsageCount = ?');
      values.push(toolUsageCount);
    }
    if (grindingAlert !== undefined) {
      fields.push('grindingAlert = ?');
      values.push(grindingAlert);
    }
    if (replacementCount !== undefined) {
      fields.push('replacementCount = ?');
      values.push(replacementCount);
    }
    if (noOfGrinding !== undefined) {
      fields.push('noOfGrinding = ?');
      values.push(noOfGrinding);
    }

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields provided to update.'
      });
    }

    values.push(id); // For WHERE clause

    const [result] = await connection.query(
      `UPDATE tool SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return handleSuccessResponse(res, 'Tool monitoring data updated successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};



exports.deleteToolMonitoring = async (req, res) => {
  try {
    const id = req.params.id;

    const [result] = await connection.query(
      `DELETE FROM tool WHERE id = ?`, [id]
    );

    return handleSuccessResponse(res, 'Tool Grinding data deleted successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

// exports.searchToolMonitoringByToolId = async (req, res) => {
//   try {
//     const { toolId } = req.query;

//     if (!toolId) {
//       throw new CustomError('toolId is required for search', 400);
//     }

//     const [data] = await connection.query(`
//       SELECT 
//         tm.id,
//         tm.toolId,
//         t.toolNo,
//         tm.usageTime,
//         tm.machineId,
//         m.machineName,
//         tm.alertStatus,
//         tm.replacementCount
//       FROM toolmonitoring tm
//       INNER JOIN tool t ON tm.toolId = t.id
//       INNER JOIN machines m ON tm.machineId = m.id
//       WHERE tm.toolId = ?
//     `, [toolId]);

//     if (data.length === 0) {
//       return handleSuccessResponse(res, 'No matching tool monitoring records found', []);
//     }

//     const response = data.map((row, index) => ({
//       slno: index + 1,
//       ...row
//     }));

//     return handleSuccessResponse(res, 'Tool monitoring records fetched successfully', response);
//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };

// exports.searchTool = async (req, res) => {
//   try {
//     const { q } = req.query;

//     let query = `
//         SELECT 
//           t.id,
//           t.toolNo,
//           t.toolUsageLife,
//           pt.machineId,
//           m.machineName,
//           t.uom,
//           u.name AS uomName,
//           t.replacementCount,
//           t.toolUsageCount,
//           t.grindingAlert
//         FROM tool t
//         INNER JOIN mst_uom u ON t.uom = u.id
//         INNER JOIN tool tl ON u.id = t.uom
//         INNER JOIN partnovstool pt ON t.id = pt.toolId
//         INNER JOIN machines m ON pt.machineId = m.id
//       `;

//     const values = [];

//     if (q) {
//       query += ` WHERE t.toolNo LIKE ?`;
//       values.push(`%${q}%`);
//     }

//     query += ` LIMIT 100`;

//     const [data] = await connection.query(query, values);

//     if (data.length === 0) {
//       return handleSuccessResponse(res, 'No matching tool monitoring records found', []);
//     }

//     const response = data.map((row, index) => ({
//       slno: index + 1,
//       ...row
//     }));

//     return handleSuccessResponse(res, 'Tool monitoring records fetched successfully', response);
//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };

// controllers/toolController.js

exports.searchToolByName = async (req, res) => {
  try {
    const { q } = req.query;

    let query = `SELECT id, toolNo FROM tool`;
    const values = [];

    if (q) {
      query += ` WHERE toolNo LIKE ?`;
      values.push(`%${q}%`);
    }

    query += ` LIMIT 50`;

    const [data] = await connection.query(query, values);

    return handleSuccessResponse(res, data.length ? 'Tools found' : 'No tools found', data);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};



// controllers/toolController.js

exports.getToolDetailsById = async (req, res) => {
  try {
    const { id } = req.params;

    const [data] = await connection.query(`
      SELECT 
        t.id,
        t.toolNo,
        t.toolUsageLife,
        t.toolName,
        t.toolUsageLife AS maxToolLife,
        t.replacementCount AS toolReplacementCount,
        m.machineName,
        t.uom,
        u.name AS uomName,
        t.replacementCount,
        t.toolUsageCount,
        t.grindingAlert
      FROM tool t
      INNER JOIN mst_uom u ON t.uom = u.id
      LEFT JOIN machines m ON m.id = t.machineId
     
      WHERE t.id = ?
      LIMIT 1
    `, [id]);

    const dataWithSlNo = data.map((row, index) => ({
      slno: index + 1,
      ...row
    }));
    if (data.length === 0) {
      return handleSuccessResponse(res, 'Tool not found', []);
    }


    return handleSuccessResponse(res, 'PartNo vs Tool List', dataWithSlNo);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.updateToolUsage = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const { jobcardNo, itemCode, qty } = req.body;

    if (!jobcardNo || !itemCode || !qty) {
      return res.status(400).json({
        success: false,
        message: "jobcardNo, itemCode and qty are required"
      });
    }

    await conn.beginTransaction();

    await toolUsageCountUpdate(conn, jobcardNo, itemCode, qty);

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: "Tool usage updated successfully"
    });

  } catch (error) {
    await conn.rollback();
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error"
    });
  } finally {
    conn.release();
  }
};


/////////////single api///////////////////////////////////////////////////

// exports.updateToolDailyKPIs = async (req, res) => {
//   try {
//     const { metric, fromDate, toDate } = req.body;

//     if (!metric || !fromDate || !toDate) {
//       return res.status(400).json({
//         success: false,
//         message: "metric, fromDate and toDate are required"
//       });
//     }

//     if (metric !== "Tool") {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid metric"
//       });
//     }

//     /* =====================================================
//        1️⃣ TOOL PLAN + COMPLETION
//     ====================================================== */
//     const toolPlanSql = `
//             SELECT 
//                 DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
//                 COUNT(*) AS tool_pln,
//                 SUM(CASE WHEN planed = 3 THEN 1 ELSE 0 END) AS tool_comp
//             FROM maintcescedue2
//             WHERE assetType = 'Tool Asset' AND Maintype = 'Preventive Maintenance'
//               AND DATE(created_at) BETWEEN ? AND ?
//             GROUP BY DATE(created_at)
//         `;

//     /* =====================================================
//        2️⃣ TOOL BREAKDOWN TIME (HOURS)
//     ====================================================== */
//     const breakdownTimeSql = `
//             SELECT
//                 DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
//                 ROUND(
//                     SUM(
//                         TIMESTAMPDIFF(
//                             MINUTE,
//                             TIMESTAMP(fromdate, fromtime),
//                             TIMESTAMP(todate, totime)
//                         )
//                     ) / 60,
//                 2) AS breakTime
//             FROM maintcescedue2
//             WHERE assetType = 'Tool Asset'
//               AND Maintype = 'BreakDown'
//               AND DATE(created_at) BETWEEN ? AND ?
//             GROUP BY DATE(created_at)
//         `;

//     /* =====================================================
//        3️⃣ TOOL BREAKDOWN UNIT PRICE
//     ====================================================== */
//     const unitPriceSql = `
//             SELECT
//                 DATE_FORMAT(m.created_at, '%Y-%m-%d') AS day,
//                 IFNULL(SUM(mt.Unitprice),0) AS unitPriceCost
//             FROM maintcescedue2 m
//             LEFT JOIN maintaintype mt ON mt.MSheduleId = m.id
//             WHERE m.assetType = 'Tool Asset'
//               AND m.Maintype = 'BreakDown'
//               AND DATE(m.created_at) BETWEEN ? AND ?
//             GROUP BY DATE(m.created_at)
//         `;

//     /* =====================================================
//        4️⃣ TOOL COST TABLE
//     ====================================================== */
//     const toolCostSql = `
//             SELECT
//                 DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
//                 IFNULL(SUM(toolCost),0) AS toolCost
//             FROM tool
//             WHERE DATE(created_at) BETWEEN ? AND ?
//             GROUP BY DATE(created_at)
//         `;

//     /* =====================================================
//        5️⃣ SALES DATA
//     ====================================================== */
//     const salesSql = `
//           SELECT
//               DATE_FORMAT(g.created_at, '%Y-%m-%d') AS day,
//               ROUND(SUM(g.amtOfGstPay), 2) AS salesAmt
//           FROM gstsalesinvo g
//           WHERE g.isCancelAuth = 0
//           AND g.created_at >= ?
//           AND g.created_at < ?
//           GROUP BY DATE(g.created_at)
//         `;

//     // Tool Monitor Plan + Completion
//     const toolMonitorSql = `
//             SELECT 
//                 DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
//                 COUNT(*) AS tool_pln,
//                 SUM(CASE WHEN planed = 3 THEN 1 ELSE 0 END) AS tool_comp
//             FROM maintcescedue2
//             WHERE assetType = 'Tool Asset'
//               AND DATE(created_at) BETWEEN ? AND ?
//             GROUP BY DATE(created_at)
//         `;

//     /* =====================================================
//        EXECUTE ALL QUERIES IN PARALLEL
//     ====================================================== */

//     const [
//       [toolPlanRows],
//       [breakRows],
//       [unitRows],
//       [toolRows],
//       [salesRows],
//       [toolMonitorRows]
//     ] = await Promise.all([
//       secondaryDB.execute(toolPlanSql, [fromDate, toDate]),
//       secondaryDB.execute(breakdownTimeSql, [fromDate, toDate]),
//       secondaryDB.execute(unitPriceSql, [fromDate, toDate]),
//       connection.execute(toolCostSql, [fromDate, toDate]),
//       connection.execute(salesSql, [fromDate, toDate]),
//       secondaryDB.execute(toolMonitorSql, [fromDate, toDate])
//     ]);

//     /* =====================================================
//        CONVERT TO MAPS
//     ====================================================== */

//     const toolPlanMap = {};
//     toolPlanRows.forEach(r => toolPlanMap[r.day] = r);

//     const breakMap = {};
//     breakRows.forEach(r => breakMap[r.day] = Number(r.breakTime) || 0);

//     const unitMap = {};
//     unitRows.forEach(r => unitMap[r.day] = Number(r.unitPriceCost) || 0);

//     const toolCostMap = {};
//     toolRows.forEach(r => toolCostMap[r.day] = Number(r.toolCost) || 0);

//     const salesMap = {};
//     salesRows.forEach(r => salesMap[r.day] = Number(r.salesAmt) || 0);

//     const toolMonitorMap = {};
//     toolMonitorRows.forEach(r => toolMonitorMap[r.day] = r);

//     /* =====================================================
//        BUILD FULL DATE RANGE
//     ====================================================== */

//     const start = new Date(fromDate);
//     const end = new Date(toDate);

//     const bulkInsert = [];
//     const responseData = [];

//     while (start <= end) {

//       const day = start.toISOString().split("T")[0];

//       const tool_pln = toolPlanMap[day]?.tool_pln || 0;
//       const tool_comp = toolPlanMap[day]?.tool_comp || 0;

//       const tool_pct = tool_pln > 0
//         ? Number(((tool_comp / tool_pln) * 100).toFixed(2))
//         : 0;

//       const unitCost = unitMap[day] || 0;
//       const toolCost = toolCostMap[day] || 0;

//       const maintCost = unitCost + toolCost;
//       const salesAmt = salesMap[day] || 0;

//       const maintPct = salesAmt > 0
//         ? Number(((maintCost / salesAmt) * 100).toFixed(2))
//         : 0;

//       const breakTime = breakMap[day] || 0;

//       const tool_monitor_pln = toolMonitorMap[day]?.tool_pln || 0;
//       const tool_monitor_comp = toolMonitorMap[day]?.tool_comp || 0;

//       const tool_monitor_pct = tool_monitor_pln > 0
//         ? Number(((tool_monitor_comp / tool_monitor_pln) * 100).toFixed(2))
//         : 0;


//       bulkInsert.push([
//         day,
//         tool_pln,
//         tool_comp,
//         tool_pct,
//         maintCost,
//         maintPct,
//         breakTime,
//         tool_monitor_pln,
//         tool_monitor_comp,
//         tool_monitor_pct
//       ]);

//       responseData.push({
//         date: day,
//         tool_pln,
//         tool_comp,
//         tool_pct,
//         maintCost,
//         maintPct,
//         breakTime,
//         tool_monitor_pln,
//         tool_monitor_comp,
//         tool_monitor_pct
//       });

//       start.setDate(start.getDate() + 1);
//     }

//     /* =====================================================
//        SINGLE BULK INSERT
//     ====================================================== */

//     if (bulkInsert.length) {
//       const insertSql = `
//                 INSERT INTO kpi_daily_summary
//                 (
//                     kpi_date,
//                     tool_pln,
//                     tool_comp,
//                     tool_pct,
//                     tool_maint_cost,
//                     tool_maint_pct,
//                     tool_break_time,
//                     tool_mon_plan,
//                     tool_mon_comp,
//                     tool_mon_pct
//                 )
//                 VALUES ?
//                 ON DUPLICATE KEY UPDATE
//                     tool_pln = VALUES(tool_pln),
//                     tool_comp = VALUES(tool_comp),
//                     tool_pct = VALUES(tool_pct),
//                     tool_maint_cost = VALUES(tool_maint_cost),
//                     tool_maint_pct = VALUES(tool_maint_pct),
//                     tool_break_time = VALUES(tool_break_time),
//                     tool_mon_plan = VALUES(tool_mon_plan),
//                     tool_mon_comp = VALUES(tool_mon_comp),
//                     tool_mon_pct = VALUES(tool_mon_pct)
//             `;

//       await connection.query(insertSql, [bulkInsert]);
//     }

//     return res.status(200).json({
//       success: true,
//       metric,
//       fromDate,
//       toDate,
//       data: responseData
//     });

//   } catch (error) {
//     console.error(error);
//     return res.status(500).json({
//       success: false,
//       message: "Server Error",
//       error: error.message
//     });
//   }
// };


// exports.updateToolMonthlyKPIs = async (req, res) => {
//   try {
//     const { metric, fromDate, toDate } = req.body;

//     if (!metric || !fromDate || !toDate) {
//       return res.status(400).json({
//         success: false,
//         message: "metric, fromDate and toDate required"
//       });
//     }

//     /* ============================================================
//        1️⃣ Aggregate Everything From Daily Table (One Query)
//     ============================================================ */

//     const monthlySql = `
//             SELECT
//                 DATE_FORMAT(kpi_date,'%Y-%m-01') AS month,

//                 SUM(IFNULL(tool_pln,0)) AS total_pln,
//                 SUM(IFNULL(tool_comp,0)) AS total_comp,

//                 SUM(IFNULL(tool_maint_cost,0)) AS totalMaintCost,
//                 SUM(IFNULL(sales_amt,0)) AS totalSales,

//                 SUM(IFNULL(tool_break_time,0)) AS totalBreakTime,

//                 SUM(IFNULL(tool_mon_plan,0)) AS tool_mon_plan,
//                 SUM(IFNULL(tool_mon_comp,0)) AS tool_mon_comp,
//                 SUM(IFNULL(tool_mon_pct,0)) AS tool_mon_pct
//             FROM kpi_daily_summary
//             WHERE kpi_date BETWEEN ? AND ?
//             GROUP BY DATE_FORMAT(kpi_date,'%Y-%m')
//             ORDER BY month
//         `;

//     const [rows] = await connection.execute(monthlySql, [
//       fromDate,
//       toDate
//     ]);

//     if (!rows.length) {
//       return res.status(200).json({
//         success: true,
//         message: "No monthly data found",
//         data: []
//       });
//     }

//     /* ============================================================
//        2️⃣ Prepare Bulk Insert
//     ============================================================ */

//     const bulkInsert = [];
//     const responseData = [];

//     for (const row of rows) {

//       const total_pln = Number(row.total_pln) || 0;
//       const total_comp = Number(row.total_comp) || 0;
//       const totalMaintCost = Number(row.totalMaintCost) || 0;
//       const totalSales = Number(row.totalSales) || 0;
//       const totalBreakTime = Number(row.totalBreakTime) || 0;
//       const tool_mon_plan = Number(row.tool_mon_plan) || 0;
//       const tool_mon_comp = Number(row.tool_mon_comp) || 0;

//       /* ===== Tool % ===== */
//       const tool_pct =
//         total_pln > 0
//           ? Number(((total_comp / total_pln) * 100).toFixed(2))
//           : 0;

//       /* ===== Maintenance % ===== */
//       const maint_pct =
//         totalSales > 0
//           ? Number(((totalMaintCost / tool_mon_plan) * 100).toFixed(2))
//           : 0;

//       /* ===== Tool Monitor (same as comp) ===== */
//       const tool_mon_pct =
//         tool_mon_plan > 0
//           ? Number(((tool_mon_comp / tool_mon_plan) * 100).toFixed(2))
//           : 0;

//       bulkInsert.push([
//         row.month,
//         total_pln,
//         total_comp,
//         tool_pct,
//         totalMaintCost,
//         maint_pct,
//         totalBreakTime,
//         tool_mon_plan,
//         tool_mon_comp,
//         tool_mon_pct
//       ]);

//       responseData.push({
//         month: row.month,
//         total_pln,
//         total_comp,
//         tool_pct,
//         totalMaintCost,
//         maint_pct,
//         totalBreakTime,
//         tool_mon_plan,
//         tool_mon_comp,
//         tool_mon_pct
//       });
//     }

//     /* ============================================================
//        3️⃣ Single Bulk Insert
//     ============================================================ */

//     const insertSql = `
//             INSERT INTO kpi_monthly_summary
//             (
//                 month,
//                 tool_pln,
//                 tool_comp,
//                 tool_pct,
//                 tool_maint_cost,
//                 tool_maint_pct,
//                 tool_break_time,
//                 tool_mon_plan,
//                 tool_mon_comp,
//                 tool_mon_pct
//             )
//             VALUES ?
//             ON DUPLICATE KEY UPDATE
//                 tool_pln = VALUES(tool_pln),
//                 tool_comp = VALUES(tool_comp),
//                 tool_pct = VALUES(tool_pct),
//                 tool_maint_cost = VALUES(tool_maint_cost),
//                 tool_maint_pct = VALUES(tool_maint_pct),
//                 tool_break_time = VALUES(tool_break_time),
//                 tool_mon_plan = VALUES(tool_mon_plan),
//                 tool_mon_comp = VALUES(tool_mon_comp),
//                 tool_mon_pct = VALUES(tool_mon_pct)
//         `;

//     await connection.query(insertSql, [bulkInsert]);

//     /* ============================================================
//        4️⃣ Response
//     ============================================================ */

//     return res.status(200).json({
//       success: true,
//       metric,
//       fromDate,
//       toDate,
//       monthsProcessed: bulkInsert.length,
//       data: responseData
//     });

//   } catch (error) {
//     console.error("Monthly KPI Error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server Error",
//       error: error.message
//     });
//   }
// };

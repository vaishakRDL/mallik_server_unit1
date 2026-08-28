const { connection, secondaryDB, handleErrorResponse, handleSuccessResponse, CustomError } = require('../config/dbSql');
const { currentDateTime } = require("../utility/utilityFunction");

// POST method to insert data
exports.storeComplaint = async (req, res) => {
  try {
    const { date, time, compType, operator, machineId, toolNo, toolName, remarks } = req.body;
    const username = req.headers.username;

    const dateTime = `${date} ${time}`;

    const sql = `
      INSERT INTO toolcomplaint (date, compType, operator, machineId, toolNo, toolName, remarks, actionBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [dateTime, compType, operator, machineId, toolNo, toolName, remarks, username];

    const [result] = await connection.query(sql, values);

    res.json({
      success: true,
      message: "Added successfully",
      insertedId: result.insertId
    });
  } catch (err) {
    return handleErrorResponse(res, err)
  }
};

exports.updateComplaint = async (req, res) => {
  try {
    const { id } = req.params;   // <-- get id from URL
    const { date, compType, operator, machineId, toolNo, toolName, remarks } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, message: "Complaint ID is required" });
    }

    const sql = `
      UPDATE toolcomplaint
      SET date = ?, 
          compType = ?, 
          operator = ?, 
          machineId = ?, 
          toolNo = ?, 
          toolName = ?, 
          remarks = ?
      WHERE id = ?
    `;

    const values = [date, compType, operator, machineId, toolNo, toolName, remarks, id];

    const [result] = await connection.query(sql, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Complaint not found" });
    }

    res.json({
      success: true,
      message: "Updated successfully"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteComplaint = async (req, res) => {
  try {
    const { id } = req.params; // complaint ID from URL params

    if (!id) {
      return res.status(400).json({ success: false, message: "Complaint ID is required" });
    }

    const sql = `DELETE FROM toolcomplaint WHERE id = ?`;
    const [result] = await connection.query(sql, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Complaint not found" });
    }

    res.json({
      success: true,
      message: "Complaint deleted successfully",
      deletedId: id
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getToolsByMachine = async (req, res) => {
  try {
    const sql = `
      SELECT 
          t.machineId,
          m.machineCode
         
      FROM tool t
      JOIN machines m ON m.id = t.machineId
      GROUP BY t.machineId, m.machineCode
    `;

    const [rows] = await connection.query(sql);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getAllToolUsage = async (req, res) => {
  try {
    const sql = `SELECT * FROM toolusage`;
    const [rows] = await connection.query(sql);

    res.json({
      success: true,
      message: "Tool usage records fetched successfully",
      data: rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getGrindingTools = async (req, res) => {
  try {
    const sql = `
      SELECT 
        ROW_NUMBER() OVER (ORDER BY g.id) AS sno,  -- 👈 Adds serial number
        g.id,
        g.toolId,
        g.toolNo,
        g.grindingCount,
        g.grindingAlert,
        g.jobcardNo,
        g.startGrind,
        g.endGrind,
        g.alertMessage,
        t.toolName,
        t.machineId,
        t.process,
        m.machineCode
      FROM tool_grinding_alerts g 
      JOIN tool t ON t.id = g.toolId
      JOIN machines m ON t.machineId = m.id
      where g.dflag = 0
    `;

    const [rows] = await connection.execute(sql);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getGrindingToolsreport = async (req, res) => {
  try {
    const sql = `
 SELECT 
  ROW_NUMBER() OVER (ORDER BY g.id) AS sno,  
  g.id,
  g.toolId,
  g.toolNo,
  g.grindingCount,
  g.grindingAlert,
  g.jobcardNo,
  g.startGrind,
  g.endGrind,
  g.replaceDate,
  g.alertMessage,

  CONCAT(
    FLOOR(TIMESTAMPDIFF(SECOND, g.startGrind, g.endGrind) / 60),
    ' min'
  ) AS grindingTime,

  t.toolName,
  t.machineId,
  t.process,
  m.machineCode
FROM tool_grinding_alerts g 
JOIN tool t ON t.id = g.toolId
JOIN machines m ON t.machineId = m.id
WHERE g.dflag = 1;`

    const [rows] = await connection.execute(sql);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getToolNoByMachineId = async (req, res) => {
  try {
    const { machineId } = req.body;

    if (!machineId) {
      return res.status(400).json({ success: false, message: "machineId is required" });
    }

    const sql = `
      SELECT id, toolNo
      FROM tool
      WHERE machineId = ?
    `;

    const [rows] = await connection.execute(sql, [machineId]);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getToolNameByToolNo = async (req, res) => {
  try {
    const { toolNo } = req.body;

    if (!toolNo) {
      return res.status(400).json({ success: false, message: "toolNo is required" });
    }

    const sql = `
      SELECT id, toolNo, toolName
      FROM tool
      WHERE id = ?
    `;

    const [rows] = await connection.execute(sql, [toolNo]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Tool not found" });
    }

    res.json({
      success: true,
      data: rows[0]   // return the first matched tool
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getAllComplaints = async (req, res) => {
  try {
    const sql = `
      SELECT 
        ROW_NUMBER() OVER (ORDER BY tc.id DESC) AS sno,
        tc.id,
        DATE_FORMAT(tc.Date, '%Y-%m-%d') AS Date,
        DATE_FORMAT(tc.Date, '%h:%i') AS Time,
        tc.machineId,
        tc.toolNo AS tcToolNo,
        tc.compType,
        tc.operator,
        tc.toolName,
        tc.remarks,
        tc.actionBy,
        m.machineCode,
        t.toolNo AS toolNo
      FROM toolcomplaint tc
      LEFT JOIN machines m ON m.id = tc.machineId
      LEFT JOIN tool t ON t.id = tc.toolNo
    `;

    const [rows] = await connection.execute(sql);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.operatorlist = async (req, res) => {
  try {
    const fetchQuery = `
            SELECT id, operatorName  FROM operator
        `;

    // Execute the query
    const [results] = await secondaryDB.execute(fetchQuery);

    if (results.length > 0) {
      return res.status(200).json({
        success: true,
        message: "operator list successfully.",
        data: results
      });
    } else {
      return res.status(404).json({
        success: false,
        message: "No operator found."
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'An error occurred'
    });
  }
};

/////////////////////Reports section////////////////
exports.getMissingReports = async (req, res) => {
  try {
    const { fromDate, toDate, machineId } = req.body;
    const sql = `
      SELECT 
        tc.id,
        tc.Date,
        tc.compType,
        tc.remarks,
        tc.actionBy,
        tc.operator,
        m.machineCode,
        t.toolNo,
        t.toolName
      FROM toolcomplaint tc
      LEFT JOIN machines m ON tc.machineId = m.id
      LEFT JOIN tool t ON tc.toolNo = t.id
      WHERE tc.Date BETWEEN ? AND ?
      AND tc.machineId = ? AND compType = "Missing"
      
    `;

    const [rows] = await connection.query(sql, [fromDate, toDate, machineId]);
    const dataWithSno = rows.map((row, index) => ({
      sno: index + 1,
      ...row,
    }));
    res.json({
      success: true,
      data: dataWithSno,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getBrokenReports = async (req, res) => {
  try {
    const { fromDate, toDate, machineId } = req.body;
    const sql = `
      SELECT 
        tc.id,
        tc.Date,
        tc.compType,
        tc.remarks,
        tc.actionBy,
        tc.operator,
        m.machineCode,
        t.toolNo,
        t.toolName
      FROM toolcomplaint tc
      LEFT JOIN machines m ON tc.machineId = m.id
      LEFT JOIN tool  t ON tc.toolNo = t.id
      WHERE tc.Date BETWEEN ? AND ?
        AND tc.machineId = ? AND compType = "Broken"
      
    `;

    const [rows] = await connection.query(sql, [fromDate, toDate, machineId]);
    const dataWithSno = rows.map((row, index) => ({
      sno: index + 1,
      ...row,
    }));

    res.json({
      success: true,
      data: dataWithSno,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getOperators = async (req, res) => {
  try {
    const sql = `SELECT DISTINCT id,operator FROM toolcomplaint`;

    const [rows] = await connection.execute(sql);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getComplaintsByFilter = async (req, res) => {
  try {
    const { fromDate, toDate, machineId, operator } = req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({ success: false, message: "fromDate and toDate are required" });
    }

    let sql = `
      SELECT 
        tc.id,
        tc.Date,
        tc.machineId,
        tc.toolNo,
        tc.compType,
        tc.operator,
        tc.toolName,
        tc.remarks,
        tc.actionBy,
        m.machineCode,
        t.toolNo AS toolNumber
      FROM toolcomplaint tc
      LEFT JOIN machines m ON m.id = tc.machineId
      LEFT JOIN tool t ON t.id = tc.toolNo
      WHERE tc.Date BETWEEN ? AND ?
    `;
    const params = [fromDate, toDate];

    if (machineId) {
      sql += " AND tc.machineId = ?";
      params.push(machineId);
    }

    if (operator) {
      sql += " AND tc.operator = ?";
      params.push(operator);
    }

    const [results] = await connection.query(sql, params);

    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.toolUsageCountUpdate = async (conn, jobcardNo, itemCode, qty) => {
  try {
    if (!jobcardNo || !itemCode || !qty) return true;

    /* 🔹 Get tool master */
    const [[toolMst]] = await conn.query(
      "SELECT id FROM tool_mst WHERE itemCode = ? LIMIT 1",
      [itemCode]
    );
    if (!toolMst) return true;

    /* 🔹 Get tool details */
    const [toolDetails] = await conn.query(
      "SELECT id, toolId, count FROM tool_details WHERE toolMstId = ?",
      [toolMst.id]
    );
    if (toolDetails.length === 0) return true;

    /* 🔹 Update tool usage counts */
    const updatePromises = [];
    const insertData = [];

    for (const detail of toolDetails) {
      const usage = detail.count * qty;

      updatePromises.push(
        conn.query(
          `UPDATE tool
           SET toolUsageCount = toolUsageCount + ?,
               grindingCount  = grindingCount + ?
           WHERE toolNo = ?`,
          [usage, usage, detail.toolId]
        )
      );

      insertData.push([detail.id, jobcardNo, itemCode, qty, usage]);
    }

    await Promise.all(updatePromises);

    /* 🔹 Insert usage history */
    await conn.query(
      `INSERT INTO toolusage
       (toolDetailId, jobcardNo, itemCode, qty, count)
       VALUES ?`,
      [insertData]
    );

    /* 🔹 Fetch tools that crossed ANY threshold */
    const [alertTools] = await conn.query(
      `SELECT id, toolNo, toolName,
              grindingCount, grindingAlert,
              toolUsageCount, replacementCount
       FROM tool
       WHERE grindingSupportId = 'YES'
         AND (
              grindingCount > grindingAlert
              OR toolUsageCount > replacementCount
         )`
    );

    /* 🔹 Alert handling */
    for (const tool of alertTools) {

      // 🔍 Check for existing active alert
      const [[existingAlert]] = await conn.query(
        `SELECT id, alertMessage
         FROM tool_grinding_alerts
         WHERE toolId = ? AND dflag = 0
         LIMIT 1`,
        [tool.id]
      );

      //  Decide alert type (Replacement has priority)
      let newAlert = null;
      if (tool.toolUsageCount > tool.replacementCount) {
        newAlert = "Replacement";
      } else if (tool.grindingCount > tool.grindingAlert) {
        newAlert = "Grinding";
      }

      if (!newAlert) continue;

      /* 🆕 No alert exists → INSERT */
      if (!existingAlert) {
        await conn.query(
          `INSERT INTO tool_grinding_alerts
           (toolId, toolNo, toolName,
            grindingCount, grindingAlert,
            jobcardNo, alertMessage)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            tool.id,
            tool.toolNo,
            tool.toolName,
            tool.grindingCount,
            tool.grindingAlert,
            jobcardNo,
            newAlert
          ]
        );

        await conn.query(
          `UPDATE tool SET alertRaised = 1 WHERE id = ?`,
          [tool.id]
        );
      }

      /* 🔄 Upgrade Grinding → Replacement */
      else if (
        existingAlert.alertMessage === "Grinding" &&
        newAlert === "Replacement"
      ) {
        await conn.query(
          `UPDATE tool_grinding_alerts
           SET alertMessage = 'Replacement'
           WHERE id = ?`,
          [existingAlert.id]
        );
      }
    }

    return true;

  } catch (error) {
    throw error;
  }
};

exports.updateToolUsageAPI = async (req, res) => {
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

    // 🔥 Call your existing logic
    await exports.toolUsageCountUpdate(
      conn,
      jobcardNo,
      itemCode,
      Number(qty)
    );

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: "Tool usage updated successfully"
    });

  } catch (error) {
    await conn.rollback();

    return res.status(500).json({
      success: false,
      message: "Failed to update tool usage",
      error: error.message
    });

  } finally {
    conn.release();
  }
};

exports.updateGrindingTime = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    const { id, type } = req.body;
    const username = req.headers.username;
    // Validation
    if (!id || !type) {
      return res.status(400).json({
        success: false,
        message: "id and type are required"
      });
    }

    if (!["start", "end", "Replacement"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be 'start' or 'end'"
      });
    }

    const dateTime = await currentDateTime();

    await conn.beginTransaction();

    if (type === "start") {
      const [result] = await conn.execute(
        `
                UPDATE tool_grinding_alerts
                SET startGrind = ?
                WHERE id = ?
                `,
        [dateTime, id]
      );

      if (result.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({
          success: false,
          message: "Record not found"
        });
      }
    }
    if (type === "Replacement") {

      // 1️⃣ Get toolId from alert table
      const [rows] = await conn.execute(
        `SELECT toolId FROM tool_grinding_alerts WHERE id = ?`,
        [id]
      );

      if (rows.length === 0) {
        await conn.rollback();
        return res.status(404).json({
          success: false,
          message: "Record not found"
        });
      }

      const toolId = rows[0].toolId;

      // 2️⃣ Update replacement date and set dflag = 1
      const [result] = await conn.execute(
        `
    UPDATE tool_grinding_alerts
    SET replaceDate = ?, dflag = 1, actionBy = ?
    WHERE id = ?
    `,
        [dateTime, username, id]
      );

      if (result.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({
          success: false,
          message: "Record not found"
        });
      }

      // 3️⃣ Get openingCount from tool table
      const [[toolRow]] = await conn.execute(
        `SELECT openingCount FROM tool WHERE id = ?`,
        [toolId]
      );

      if (!toolRow) {
        throw new Error("Tool not found");
      }

      // 4️⃣ Reset toolUsageCount, grindingCount, and alertRaised to 0
      await conn.execute(
        `
    UPDATE tool
    SET 
      toolUsageCount = ?,
      grindingCount = ?,
      alertRaised = 0
     
    WHERE id = ?
    `,
        [toolRow.openingCount, toolRow.openingCount, toolId]
      );
    }


    if (type === "end") {

      // 1️⃣ Get toolId from alert table
      const [rows] = await conn.execute(
        `
        SELECT toolId
        FROM tool_grinding_alerts
        WHERE id = ?
      `,
        [id]
      );


      if (rows.length === 0) {
        await conn.rollback();
        return res.status(404).json({
          success: false,
          message: "Record not found"
        });
      }

      const toolId = rows[0].toolId;

      // 2️⃣ Update alert table
      await conn.execute(
        `
          UPDATE tool_grinding_alerts
          SET endGrind = ?, dflag = 1,actionBy = ?
          WHERE id = ?
        `,
        [dateTime, username, id]
      );

      await conn.execute(
        `
          UPDATE tool
          SET grindingCount = 0,
              alertRaised = 0
          WHERE id = ?
        `,
        [toolId]
      );
      // 🔍 Verify update
      const [[afterUpdate]] = await conn.execute(
        `SELECT grindingCount FROM tool WHERE id = ?`,
        [toolId]
      );
    }

    await conn.commit();

    return res.status(200).json({
      success: true,
      message:
        type === "start"
          ? "startGrind updated successfully"
          : type === "end"
            ? "endGrind updated, dflag set to 1, grindingCount reset"
            : "replacement date updated successfully",
      data: {
        id,
        time: dateTime
      }
    });

  } catch (error) {
    await conn.rollback();

    return res.status(500).json({
      success: false,
      message: "Internal Server Error"
    });
  } finally {
    conn.release();
  }
};

exports.getUsageReport = async (req, res) => {
  try {
    const { fromDate, toDate } = req.body; // or use req.query if you send as query params

    let sql = `
      SELECT 
        tu.id,
        tu.toolDetailId,
        tu.jobcardNo,
        tu.itemCode,
        tu.qty,
        tu.count,
        tu.created_at,
        td.machineCode,
        td.process,
        td.toolId
      FROM toolusage tu
      JOIN tool_details td ON td.id = tu.toolDetailId
      WHERE 1=1 
    `;

    const params = [];

    // ✅ Optional date filtering
    if (fromDate && toDate) {
      sql += ` AND DATE(tu.created_at) BETWEEN ? AND ?`;
      params.push(fromDate, toDate);
    } else if (fromDate) {
      sql += ` AND DATE(tu.created_at) >= ?`;
      params.push(fromDate);
    } else if (toDate) {
      sql += ` AND DATE(tu.created_at) <= ?`;
      params.push(toDate);
    }

    const [rows] = await connection.execute(sql, params);

    res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getGrindReport = async (req, res) => {
  try {
    const { fromDate, toDate, machineId } = req.body;

    let sql = `
      SELECT 
        ROW_NUMBER() OVER (ORDER BY g.id) AS sno,  
        g.id,
        g.toolId,
        g.toolNo,
        g.grindingCount,
        g.grindingAlert,
        (g.grindingCount - g.grindingAlert) AS exceededCount,
        g.jobcardNo,
        g.startGrind,
        g.endGrind,
        g.replaceDate,
        g.alertMessage,
        g.actionBy,

        CONCAT(
          FLOOR(TIMESTAMPDIFF(SECOND, g.startGrind, g.endGrind) / 60),
          ' min'
        ) AS grindingTime,

        t.toolName,
        t.machineId,
        t.process,
        m.machineCode
      FROM tool_grinding_alerts g 
      JOIN tool t ON t.id = g.toolId
      JOIN machines m ON m.id = t.machineId
      WHERE g.dflag = 1
    `;

    const params = [];

    // ✅ Date filter (createdAt)
    if (fromDate && toDate) {
      sql += ` AND DATE(g.createdAt) BETWEEN ? AND ?`;
      params.push(fromDate, toDate);
    } else if (fromDate) {
      sql += ` AND DATE(g.createdAt) >= ?`;
      params.push(fromDate);
    } else if (toDate) {
      sql += ` AND DATE(g.createdAt) <= ?`;
      params.push(toDate);
    }

    // ✅ Machine filter
    if (machineId) {
      sql += ` AND t.machineId = ?`;
      params.push(machineId);
    }

    const [rows] = await connection.execute(sql, params);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

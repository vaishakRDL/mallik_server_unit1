const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require('../config/dbSql');
const excel = require('exceljs');
const ExcelJS = require('exceljs');
const utility = require('../utility/utilityFunction');

const updteCounter = async (toolNo) => {
  const machine = toolNo.split('/')[1]; // e.g. "LANCING"
  const numberPart = parseInt(toolNo.split('/').pop()); // get last number (0004 -> 4)

  const [rows] = await connection.query(
    `SELECT id, CAST(SUBSTRING_INDEX(count, '/', -1) AS UNSIGNED) AS maxNum
     FROM toolcount WHERE machineName = ?`,
    [machine]
  );

  if (rows.length === 0) {
    // First entry, insert
    await connection.query(
      `INSERT INTO toolcount (machineName, count) VALUES (?, ?)`,
      [machine, toolNo]
    );
  } else {
    // Only update if this number is greater than current max
    if (numberPart > rows[0].maxNum) {
      await connection.query(
        `UPDATE toolcount SET count = ? WHERE id = ?`,
        [toolNo, rows[0].id]
      );
    }
    // If numberPart <= maxNum → do nothing (prevent resetting count)
  }
};

exports.AddTool = async (req, res) => {
  try {
    const {
      machineId,
      processId,
      toolNo,
      toolName,
      process,
      uomId,
      grindingSupportId,
      grindingAlert,
      replacementCount,
      openingCount,
      toolCost
    } = req.body;

    // Validate UOM
    const [uomResult] = await connection.query(
      'SELECT name FROM mst_uom WHERE id = ?',
      [uomId]
    );
    if (uomResult.length === 0) {
      throw new CustomError('Invalid UOM ID', 400);
    }

    // Normalize opening count
    const initialCount = Number(openingCount) || 0;
    const finalToolCost = Number(toolCost) || 0;

    // Insert tool
    const insertToolQuery = `
      INSERT INTO tool (
        machineId,
        processId,
        toolNo,
        toolName,
        process,
        uom,
        grindingSupportId,
        grindingAlert,
        replacementCount,
        openingCount,
        grindingCount,
        toolUsageCount,
        toolCost
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await connection.query(insertToolQuery, [
      machineId,
      processId,
      toolNo,
      toolName,
      process,
      uomId,
      grindingSupportId ?? null,
      grindingAlert || '',
      replacementCount ?? 0,
      initialCount, // openingCount
      initialCount, // grindingCount
      initialCount,  // toolUsageCount
      finalToolCost
    ]);

    return handleSuccessResponse(res, 'Tool added successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

// READ ALL Tools (JOIN with mst_uom)
exports.getAllTools = async (req, res) => {
  try {
    const [tools] = await connection.query(`
        SELECT t.id,m.machineCode,p.code, t.toolNo,t.toolName,t.process,t.uom, u.name AS uomName , t.grindingSupportId,
               t.grindingAlert, t.replacementCount,
               t.openingCount,t.toolUsageCount ,t.toolCost,t.created_at
        FROM tool t
        LEFT JOIN mst_uom u ON t.UOM = u.id
        LEFT JOIN machines m ON m.id = t.machineId
        LEFT JOIN mst_pm p ON p.id = t.processId

      `);
    const dataWithSlNo = tools.map((row, index) => ({
      slno: index + 1,
      ...row
    }));
    return res.status(200).json({
      success: true,
      message: 'Tool List',
      data: dataWithSlNo
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// READ Single Tool by ID
exports.getToolById = async (req, res) => {
  try {
    const [tool] = await connection.query(`
      SELECT t.*, u.name AS uomName
      FROM tool t
      JOIN mst_uom u ON t.uom = u.name
      WHERE t.id = ?
    `, [req.params.id]);

    if (tool.length === 0) return res.status(404).json({ error: 'Tool not found' });
    res.json(tool[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateTool = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Tool ID (id) is required' });
    }

    const {
      toolNo,
      toolName,
      process,
      uomId,
      grindingSupportId,
      grindingAlert,
      replacementCount,
      openingCount,
      toolCost
    } = req.body;

    // 1️⃣ Fetch existing tool
    const [existingRows] = await connection.query(
      `SELECT openingCount, grindingCount, toolUsageCount FROM tool WHERE id = ?`,
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    const existing = existingRows[0];

    // 2️⃣ Decide counts
    let newOpeningCount = existing.openingCount;
    let newGrindingCount = existing.grindingCount;
    let newToolUsageCount = existing.toolUsageCount;

    if (openingCount !== undefined && Number(openingCount) !== existing.openingCount) {
      const normalized = Number(openingCount) || 0;
      newOpeningCount = normalized;
      newGrindingCount = normalized;
      newToolUsageCount = normalized;
    }

    // ✅ normalize tool cost
    const finalToolCost = Number(toolCost) || 0;

    // 3️⃣ Update query
    const updateQuery = `
      UPDATE tool 
      SET 
        toolNo = ?, 
        toolName = ?, 
        process = ?, 
        uom = ?, 
        grindingSupportId = ?, 
        grindingAlert = ?, 
        replacementCount = ?, 
        openingCount = ?,
        grindingCount = ?,
        toolUsageCount = ?,
        toolCost = ?  
      WHERE id = ?
    `;

    const values = [
      toolNo,
      toolName,
      process,
      uomId,
      grindingSupportId ?? null,
      grindingAlert || '',
      replacementCount ?? 0,
      newOpeningCount,
      newGrindingCount,
      newToolUsageCount,
      finalToolCost,
      id
    ];

    await connection.query(updateQuery, values);

    return res.status(200).json({
      success: true,
      message: 'Tool updated successfully'
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
};
// DELETE Tool
exports.deleteTool = async (req, res) => {
  try {
    const toolId = req.params.id;
    //console.log('Deleting tool with ID:', toolId);

    const [result] = await connection.query('DELETE FROM tool WHERE id = ?', [toolId]);

    if (result.affectedRows === 0) {
      //console.log('No tool found with ID:', toolId);
      return res.status(404).json({ error: 'Tool not found' });
    }

    return handleSuccessResponse(res, 'Tool deleted successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


// Only header download controller
exports.downloadToolTemplate = async (req, res) => {
  try {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Tool Template');

    // Only headers
    worksheet.addRow([
      'Machine Code',
      'Process',
      'Tool Name',
      'Tool No',
      'UOM',
      'Grinding Support',
      'Grinding Alert',
      'Replacement Count',
      'Opening Count',
      'Tool Cost'

    ]).font = { bold: true };

    worksheet.columns.forEach(col => {
      col.width = 25;
      col.alignment = { horizontal: 'center' };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=ToolTemplate.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate template' });
  }
};

exports.importTool = async (req, res) => {
  try {
    if (!req.body.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const base64Prefix = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
    const base64Data = req.body.file.replace(base64Prefix, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const workbook = new excel.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet(1);
    const tools = [];
    // Read Excel rows
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber !== 1) {
        const tool = {
          rowNo: rowNumber,

          machineCode: row.getCell(1).value?.toString().trim(),
          processCode: row.getCell(2).value?.toString().trim(),
          toolName: row.getCell(3).value?.toString().trim(),
          toolNo: row.getCell(4).value?.toString().trim(),
          uomCode: row.getCell(5).value?.toString().trim(),

          grindingSupportId:
            row.getCell(6).value?.toString().toUpperCase() === 'YES'
              ? 'YES'
              : 'NO',

          grindingAlert: row.getCell(7).value,
          replacementCount: parseInt(row.getCell(8).value) || 0,
          openingCount: parseInt(row.getCell(9).value) || 0,

          // ✅ NEW FIELD (Column 10)
          toolCost: parseFloat(row.getCell(10).value) || 0
        };

        tools.push(tool);
      }
    });

    for (const t of tools) {
      try {
        // 1️⃣ Get Machine ID
        const [machineResult] = await connection.query(
          'SELECT id FROM machines WHERE machineCode = ?',
          [t.machineCode]
        );
        if (machineResult.length === 0) {
          missing.push({ rowNo: t.rowNo, reason: `Invalid Machine Code: "${t.machineCode}"` });
          continue;
        }
        const machineId = machineResult[0].id;

        // 2️⃣ Get Process ID
        const [processResult] = await connection.query(
          'SELECT id, code FROM mst_pm WHERE code = ?',
          [t.processCode]
        );
        if (processResult.length === 0) {
          missing.push({ rowNo: t.rowNo, reason: `Invalid Process Code: "${t.processCode}"` });
          continue;
        }
        const processId = processResult[0].id;
        const processName = processResult[0].code;

        // 3️⃣ Get UOM ID
        const [uomResult] = await connection.query(
          'SELECT id, code FROM mst_uom WHERE code = ?',
          [t.uomCode]
        );
        if (uomResult.length === 0) {
          missing.push({ rowNo: t.rowNo, reason: `Invalid UOM Code: "${t.uomCode}"` });
          continue;
        }
        const uomId = uomResult[0].id;

        // 5️⃣ ALWAYS INSERT — duplicates allowed
        await connection.query(`
  INSERT INTO tool (
    machineId,
    processId,
    process,
    toolNo,
    toolName,
    uom,
    grindingSupportId,
    grindingAlert,
    replacementCount,
    openingCount,
    toolUsageCount,
    grindingCount,
    toolCost
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [
          machineId,
          processId,
          processName,
          t.toolNo,
          t.toolName,
          uomId,
          t.grindingSupportId,
          t.grindingAlert,
          t.replacementCount,
          t.openingCount,
          t.openingCount, // toolUsageCount
          t.openingCount,  // grindingCount
          t.toolCost
        ]);

      } catch (err) {
        console.error('Tool import failed:', err);

        return res.status(500).json({
          success: false,
          message: 'Error uploading file'
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Tool import complete'

    });

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.updateToolUsageCount = async (req, res) => {
  try {
    // Step 1: Update toolUsageCount only for today's completed job cards
    await connection.query(`
        UPDATE tool t
        JOIN (
          SELECT 
            tp.toolId,
            SUM(ivp.\`count\` * jc.Qty) AS total_count
          FROM item_vs_pm ivp
          INNER JOIN job_card jc ON jc.itemId = ivp.item
          INNER JOIN tool_pm tp ON tp.machineId = ivp.machineName AND tp.processId = ivp.process
          WHERE jc.isCompleted = 1 AND DATE(jc.completedDate) = CURDATE() 
          GROUP BY tp.toolId
        ) AS calculated ON t.id = calculated.toolId
        SET t.toolUsageCount = t.toolUsageCount + calculated.total_count
      `);

    // Step 2: Fetch all tools with tool_pm and partnovstool links
    const [tools] = await connection.query(`
        SELECT 
          t.id AS toolId,
          t.toolNo,
          t.toolUsageCount,
          t.toolUsageLife,
          t.grindingSupportId,
          tp.processId,
          pt.machineId
        FROM tool t
        INNER JOIN tool_pm tp ON tp.toolId = t.id
        INNER JOIN partnovstool pt ON pt.id = tp.partnovstoolId
      `);

    const alerts = [];

    // Step 3: Check and insert alerts
    for (const tool of tools) {
      if (tool.toolUsageCount >= tool.toolUsageLife) {
        const alertType = (tool.grindingSupportId || '').toLowerCase() === 'yes' ? 'Grinding' : 'Replacement';

        const [existingAlert] = await connection.query(`
            SELECT id FROM tool_alert_log
            WHERE toolId = ? AND machineId = ? AND processId = ? AND alertType = ?
          `, [tool.toolId, tool.machineId, tool.processId, alertType]);

        if (existingAlert.length === 0) {
          try {
            await connection.query(`
                INSERT INTO tool_alert_log (toolId, machineId, processId, alertType, alertDateTime)
                VALUES (?, ?, ?, ?, NOW())
              `, [tool.toolId, tool.machineId, tool.processId, alertType]);

            alerts.push({
              toolId: tool.toolId,
              alertType,
              message: `Alert triggered: ${alertType} for Tool ${tool.toolId}`,
              date: new Date().toISOString().split('T')[0]
            });
          } catch (insertErr) {
            console.error("❌ Failed to insert alert log:", insertErr);
          }
        }
      }
    }

    // Step 4: Respond
    return res.json({
      message: "Tool usage updated for today and alerts processed.",
      alerts
    });

  } catch (err) {
    console.error("Error in updateToolUsageCount:", err);
    return res.status(500).json({ message: "Internal Server Error", error: err });
  }
};



//new tools 

exports.getMachineProcessMap = async (req, res) => {
  try {
    const [rows] = await connection.query(`
      SELECT ivp.id,m.machineName, pm.code AS process,m.id AS machineId ,pm.id AS processId
      FROM item_vs_pm ivp
      INNER JOIN machines m ON m.id = ivp.machineName
      INNER JOIN mst_pm pm ON pm.id = ivp.process
      WHERE pm.code != ?
      GROUP BY  pm.code;
    `, ['Assembly']);

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching machine-process mapping:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};



function extractPrefix(machineName) {
  return machineName.split('-')[0];
}

function formatToolNumber(prefix, number) {
  return `ME/${prefix}/${String(number).padStart(4, '0')}`;
}

exports.generateToolCount = async (req, res) => {
  try {
    const { machineName } = req.body;
    const prefix = extractPrefix(machineName);

    // Get max number from toolcount table
    const [rows] = await connection.query(
      `SELECT MAX(CAST(SUBSTRING_INDEX(count, '/', -1) AS UNSIGNED)) AS maxNum
       FROM toolcount
       WHERE machineName = ?`,
      [prefix]
    );

    const lastNum = rows[0]?.maxNum || 0;
    const newNum = lastNum + 1;
    const newTool = formatToolNumber(prefix, newNum);

    return res.json({ success: true, tool: newTool });
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.downloadToolsTemplate = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('ToolTemplate');

    // Define headers only — no data
    worksheet.columns = [
      { header: 'ITEMCODE', key: 'ITEMCODE', width: 20 },
      { header: 'MACHINE', key: 'MACHINE', width: 20 },
      { header: 'PROCESS', key: 'PROCESS', width: 20 },
      { header: 'TOOLID', key: 'TOOLID', width: 20 },
      { header: 'COUNT', key: 'COUNT', width: 10 },
    ];

    // Set headers for download
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename=Tool_Template.xlsx');

    // Send the Excel file (just headers)
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Excel template error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate template' });
  }
};

//testing
exports.importToolsExcel = async (req, res) => {
  try {
    const base64File = req.body.file;
    if (!base64File) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const matches = base64File.match(/^data:.*\/.*;base64,(.*)$/);
    if (!matches || matches.length !== 2) {
      return res.status(400).json({ success: false, message: 'Invalid base64 file format' });
    }

    const buffer = Buffer.from(matches[1], 'base64');
    const fileName = `tools_${Date.now()}.xlsx`;
    const storedPath = utility.storeFilesexcel(buffer, fileName, 'Tools');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(storedPath);
    const worksheet = workbook.getWorksheet(1);

    const resultRows = [];

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const ITEMCODE = row.getCell(1).text.trim();
      const MACHINECODE = row.getCell(2).text.trim();
      const PROCESS = row.getCell(3).text.trim();
      const TOOLID = row.getCell(4).text.trim();
      const COUNT = parseInt(row.getCell(5).value) || 0;

      const rowResult = {
        id: i,
        itemCode: ITEMCODE,
        machineCode: MACHINECODE,
        process: PROCESS,
        toolId: TOOLID,
        count: COUNT,
        errorMessage: ''
      };

      const [[itemRow]] = await connection.query('SELECT id FROM items WHERE itemCode = ?', [ITEMCODE]);
      const [[machineRow]] = await connection.query('SELECT id FROM machines WHERE machineCode = ?', [MACHINECODE]);
      const [[processRow]] = await connection.query('SELECT id FROM mst_pm WHERE code = ?', [PROCESS]);
      const [[toolRow]] = await connection.query('SELECT id FROM tool WHERE toolNo = ?', [TOOLID]);

      if (!itemRow) rowResult.errorMessage = 'Unknown itemCode';
      else if (!machineRow) rowResult.errorMessage = 'Unknown machineCode';
      else if (!processRow) rowResult.errorMessage = 'Unknown process';
      else if (!toolRow) rowResult.errorMessage = 'Unknown toolId';

      resultRows.push(rowResult);
    }

    const anyErrors = resultRows.some(r => r.errorMessage);

    res.json({
      success: !anyErrors,
      message: anyErrors
        ? 'Validation completed with some errors.'
        : 'All rows validated successfully.',
      data: resultRows
    });
  } catch (error) {
    console.error('Error during Excel validation:', error);
    res.status(500).json({ success: false, message: 'Validation failed', error: error.message });
  }
};


exports.storeValidatedTools = async (req, res) => {
  const { data } = req.body;

  if (!Array.isArray(data)) {
    return res.status(400).json({ success: false, message: "Invalid input format" });
  }

  try {
    const resultRows = [];

    for (const row of data) {
      const { itemCode, machineCode, process, toolId, count } = row;

      // Insert into tool_mst if itemCode not exists
      const [[existingMst]] = await connection.query(
        'SELECT id FROM tool_mst WHERE itemCode = ?',
        [itemCode]
      );

      let toolMstId;
      if (!existingMst) {
        const [insertMst] = await connection.query(
          'INSERT INTO tool_mst (itemCode) VALUES (?)',
          [itemCode]
        );
        toolMstId = insertMst.insertId;
      } else {
        toolMstId = existingMst.id;
      }

      // Insert into tool_details
      // const [insertDetails] = await connection.query(
      //   `INSERT INTO tool_details (toolMstId, machineCode, process, toolId, count)
      //    VALUES (?, ?, ?, ?, ?)`,
      //   [toolMstId, machineCode, process, toolId, count]
      // );
      const [[existingDetail]] = await connection.query(
        `SELECT id FROM tool_details 
   WHERE toolMstId = ? AND machineCode = ? AND process = ? AND toolId = ?`,
        [toolMstId, machineCode, process, toolId]
      );

      if (existingDetail) {
        return res.status(400).json({
          success: false,
          message: `Duplicate entry found for itemCode ${itemCode}, machineCode ${machineCode}, process ${process}, toolId ${toolId}`
        });
      }

      // Insert into tool_details
      const [insertDetails] = await connection.query(
        `INSERT INTO tool_details (toolMstId, machineCode, process, toolId, count)
   VALUES (?, ?, ?, ?, ?)`,
        [toolMstId, machineCode, process, toolId, count]
      );
      resultRows.push({
        ...row,
        toolMstId: toolMstId,
        toolDetailsId: insertDetails.insertId
      });
    }

    res.json({
      success: true,
      message: 'Tool data stored successfully',
      data: resultRows
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to store tool data', error: error.message });
  }
};

exports.toolitemcode = async (req, res) => {
  try {
    const { show: q } = req.query;

    let fetch = `SELECT id, itemCode FROM tool_mst`;
    const params = [];

    if (q) {
      fetch += ` WHERE itemCode LIKE ?`;
      params.push(`%${q}%`);
    }
    fetch += ` ORDER BY itemCode LIMIT 50`;

    const [rows] = await connection.execute(fetch, params);

    return handleSuccessResponse(res, 'Items list', rows);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.tooltree = async (req, res) => {
  try {
    const { id } = req.query;

    if (!id || isNaN(id)) {
      return res.status(200).json({
        success: true,
        toolTree: [],
        data: []
      });
    }

    // Fetch tool master data
    const [toolMstResult] = await connection.execute(
      `SELECT id, itemcode FROM tool_mst WHERE id = ?`,
      [id]
    );

    if (!toolMstResult.length) {
      return res.status(404).json({ success: false, message: "No tool master found for this ID" });
    }

    const toolMst = toolMstResult[0];

    // Fetch tool details with itemcode using JOIN
    const [rows] = await connection.execute(
      `SELECT 
                td.id, td.machineCode, td.process, td.toolId, td.count,
                tm.itemcode
             FROM tool_details td
             JOIN tool_mst tm ON td.toolMstId = tm.id
             WHERE td.toolMstId = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "No tool details found for this ID" });
    }

    // Group tool details by process
    const processMap = {};
    rows.forEach(row => {
      if (!processMap[row.process]) {
        processMap[row.process] = [];
      }
      processMap[row.process].push({
        id: row.id,
        label: row.toolId,
        count: row.count
      });
    });

    // Build process group tree
    let processGroups = [];
    let groupId = 1;
    for (const [process, tools] of Object.entries(processMap)) {
      processGroups.push({
        id: groupId++,
        label: process,
        child: tools
      });
    }

    // Final toolTree structure
    const toolTree = [
      {
        id: toolMst.id,
        label: toolMst.itemcode,
        child: processGroups
      }
    ];

    // Respond with toolTree and full raw data (including itemcode per row)
    return res.status(200).json({
      success: true,
      toolTree,
      data: rows
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

//excel tool mapping
exports.toolDetailsExport = async (req, res) => {
  try {
    const { itemId } = req.query;

    let toolQuery = `
            SELECT 
                tool_mst.itemCode,
                tool_details.machineCode,
                tool_details.process,
                tool_details.toolId,
                CAST(tool_details.count AS DOUBLE) AS count
            FROM tool_details
            INNER JOIN tool_mst ON tool_mst.id = tool_details.toolMstId
        `;

    let values = [];

    if (itemId) {
      toolQuery += ` WHERE tool_mst.id = ?`;
      values = [itemId];
    }

    const [toolRows] = await connection.execute(toolQuery, values);

    // Create a new Excel workbook and sheet
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Tool Details');

    // Define columns
    worksheet.columns = [
      { header: 'Item Code', key: 'itemCode', width: 20, style: { alignment: { horizontal: 'center' } } },
      { header: 'Machine Code', key: 'machineCode', width: 20, style: { alignment: { horizontal: 'center' } } },
      { header: 'Process', key: 'process', width: 25, style: { alignment: { horizontal: 'center' } } },
      { header: 'Tool ID', key: 'toolId', width: 35, style: { alignment: { horizontal: 'center' } } },
      { header: 'Count', key: 'count', width: 10, style: { alignment: { horizontal: 'center' } } }
    ];

    // Header styling
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }; // white bold
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' } // blue header
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Add rows
    toolRows.forEach(row => {
      worksheet.addRow(row);
    });

    // Response setup for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=tool-details.xlsx');

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};



//delete api for tool mapping
exports.deleteToolMapping = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Tool ID is required' });
    }

    const [result] = await connection.query(
      'DELETE FROM tool_mst WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    return handleSuccessResponse(res, 'Tool deleted successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.updateToolMappingCount = async (req, res) => {
  try {
    const { id } = req.params;
    const { count } = req.body;

    if (!id || count === undefined) {
      return res.status(400).json({ error: 'ID and count are required' });
    }

    await connection.query(
      'UPDATE tool_details SET count = ? WHERE id = ?',
      [count, id]
    );

    return handleSuccessResponse(res, 'Tool count updated successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.getToolList = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    const { type, id } = req.query;

    if ((!type && !id) || id === "undefined") {
      return res.status(200).json({ success: false, toolTree: [], data: [] });
    }

    let fetchQuery = `SELECT id, itemCode FROM tool_mst tm `;
    let params = [];

    switch (type) {
      case "first":
        fetchQuery += `ORDER BY tm.id ASC LIMIT 1`;
        break;
      case "last":
        fetchQuery += `ORDER BY tm.id DESC LIMIT 1`;
        break;
      case "forward":
        fetchQuery += `WHERE tm.id > ? ORDER BY tm.id ASC LIMIT 1`;
        params.push(id);
        break;
      case "reverse":
        fetchQuery += `WHERE tm.id < ? ORDER BY tm.id DESC LIMIT 1`;
        params.push(id);
        break;
      case "view":
        fetchQuery += `WHERE tm.id = ?`;
        params.push(id);
        break;
    }

    const [mstRow] = await conn.execute(fetchQuery, params);
    if (!mstRow.length) {
      throw new CustomError("Tool not found", 400);
    }

    const { id: toolMstId, itemCode } = mstRow[0];

    // Fetch tool details
    const query = `
      SELECT td.id, td.machineCode, td.process, td.toolId, td.count, tm.itemCode
      FROM tool_mst tm
      INNER JOIN tool_details td ON td.toolMstId = tm.id
      WHERE tm.id = ?
    `;
    const [rows] = await conn.execute(query, [toolMstId]);

    // --- Build Tree ---
    const processMap = new Map();
    const children = [];

    rows.forEach((row) => {
      if (!processMap.has(row.process)) {
        processMap.set(row.process, {
          id: row.id, // use row.id of first detail for process node
          label: row.process,
          child: []
        });
        children.push(processMap.get(row.process));
      }

      processMap.get(row.process).child.push({
        id: row.id,
        label: row.toolId,
        count: row.count
      });
    });

    const toolTree = [
      {
        id: toolMstId,
        label: itemCode,
        child: children
      }
    ];

    return res.status(200).json({
      success: true,
      toolTree,
      data: rows
    });
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.updateMappedTool = async (req, res) => {
  const conn = await connection.getConnection();
  await conn.beginTransaction();
  try {
    const { itemId, itemCode, ToolList } = req.body;

    if (!Array.isArray(ToolList) || ToolList.length === 0) {
      throw new Error('Tool list is required and should not be empty.');
    }

    const [toolMstResult] = await conn.execute(
      `SELECT id FROM tool_mst WHERE id = ?`,
      [itemId]
    );

    if (!toolMstResult.length) {
      throw new CustomError('Tool master not found!', 404);
    }

    if (itemCode) {
      await conn.execute(
        `UPDATE tool_mst SET itemCode = ? WHERE id = ?`,
        [itemCode, itemId]
      );
    }

    for (const tool of ToolList) {
      await conn.execute(
        `UPDATE tool_details SET count = ? WHERE id = ? AND toolMstId = ?`,
        [tool.count, tool.itemId, itemId]  // <-- fixed
      );
    }

    await conn.commit();
    return handleSuccessResponse(res, 'Successfully updated tool counts');
  } catch (err) {
    await conn.rollback();
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.getToolDetails = async (req, res) => {
  const conn = await connection.getConnection();
  try {
    const [rows] = await conn.execute(`
      SELECT 
        td.id,
        td.toolMstId,
        tm.itemCode,
        td.machineCode,
        td.process,
        td.toolId,
        td.count
      FROM tool_details td
      JOIN tool_mst tm ON td.toolMstId = tm.id
      ORDER BY td.id ASC
    `);

    return handleSuccessResponse(res, rows);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};

exports.toolsList = async (req, res) => {
  try {
    const machineId = req.query.machineId;
    
    let query = `SELECT id, toolNo FROM tool`;
    const params = [];

    if (machineId) {
      query += ` WHERE machineId = ?`;
      params.push(machineId);
    }

    const [rows] = await connection.execute(query, params);

    return handleSuccessResponse(res, 'Tools list', rows);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

exports.machineList = async (req, res) => {
  try {
    const [rows] = await connection.execute(`
      SELECT m.id, m.machineCode
      FROM machines m
      WHERE EXISTS (
          SELECT 1
          FROM tool t
          WHERE t.machineId = m.id
      )`
    );

    return handleSuccessResponse(res, 'Machine list', rows);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};

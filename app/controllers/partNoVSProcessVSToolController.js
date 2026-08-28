const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require('../config/dbSql');
const excel = require('exceljs');


// exports.searchPartNoVsToolByToolId = async (req, res) => {
//   try {
//     const { toolId } = req.query;

//     if (!toolId) {
//       throw new CustomError('toolId is required for search', 400);
//     }

//     const [data] = await connection.query(`
//       SELECT 
//         p.id,
//         m.machineName,
//         m.id AS machineId,
//         p.process,
//         t.toolNo,
//         t.id AS toolId
//       FROM partnovstool p
//       INNER JOIN machines m ON p.machineId = m.id
//       INNER JOIN tool t ON p.toolId = t.id
//       WHERE t.id = ?
//     `, [toolId]);

//     if (data.length === 0) {
//       return handleSuccessResponse(res, 'No matching records found', []);
//     }

//     const response = data.map((row, index) => ({
//       slno: index + 1,
//       ...row
//     }));

//     return handleSuccessResponse(res, 'Matching records fetched successfully', response);
//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };



// Create (Add New Entry)
// exports.addPartNoVsTool = async (req, res) => {
//   try {
//     const { machineId, toolId } = req.body;

//     if (!machineId || !toolId) {
//       throw new CustomError('Missing required fields: machineId, toolId', 400);
//     }

//     // Insert the new record
//     const [result] = await connection.query(`
//       INSERT INTO partnovstool (machineId, toolId)
//       VALUES (?, ?)`, [machineId, toolId]);

//     const insertedId = result.insertId;

//     // Fetch details for response
//     const [data] = await connection.query(`
//       SELECT 
//         p.id,
//         m.machineName,
//         m.id AS machineId,
//         m.machineOperator AS process,
//         t.toolNo,
//         t.id AS toolId
//       FROM partnovstool p
//       INNER JOIN machines m ON p.machineId = m.id
//       INNER JOIN tool t ON p.toolId = t.id
//       WHERE p.id = ?
//     `, [insertedId]);

//     const responseWithSlNo = data.map((row, index) => ({
//       slno: index + 1,
//       ...row
//     }));

//     return handleSuccessResponse(res, 'PartNo vs Tool added successfully', responseWithSlNo[0]);
//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };

// exports.addPartNoVsTool = async (req, res) => {
//   try {
//     let { machineId, toolId, process, processId  } = req.body;

//     if (!machineId || !toolId || !process) {
//       throw new CustomError('Missing required fields: machineId, toolId, process', 400);
//     }

//     // Convert array to comma-separated string
//      if (Array.isArray(process)) {
//       process = process.join(', ');
//     }
//     // Prevent duplicate combination (machineId, toolId, process)
//     const [existing] = await connection.query(
//       `SELECT id FROM partnovstool WHERE machineId = ? AND toolId = ? AND process = ?`,
//       [machineId, toolId, process]
//     );

//     if (existing.length > 0) {
//       throw new CustomError('This Machine, Tool, and Process combination already exists', 400);
//     }

//     // Insert the new record
//     const [result] = await connection.query(
//       `INSERT INTO partnovstool (machineId, toolId, process)
//        VALUES (?, ?, ?)`,
//       [machineId, toolId, process]
//     );

//     const insertedId = result.insertId;

//     if (Array.isArray(processId)) {
//       for (const pid of processId) {
//         await connection.query(
//           `INSERT INTO tool_pm (partnovstoolId, toolId, processId)
//            VALUES (?, ?, ?)`,
//           [insertedId, toolId, pid]
//         );
//       }
//     } else if (processId) {
//       // Handle single processId (non-array)
//       await connection.query(
//         `INSERT INTO tool_pm (partnovstoolId, toolId, processId)
//          VALUES (?, ?, ?)`,
//         [insertedId, toolId, processId]
//       );
//     }

//     return handleSuccessResponse(res, 'PartNo vs Tool added successfully');

//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };


exports.search = async (req, res) => {
  try {
    // Get the search query from the request query parameters
    const id = req.params.id;

    // Construct the SQL query to include search functionality
    const [data] = await connection.query(`
    SELECT DISTINCT 
      tp.id,
      tp.machineId,
      m.machineName,
      tp.processId,
      pt.process,
      tp.toolId,
      t.toolNo,
      t.uom,
      u.name AS uomName
    FROM tool_pm tp
  INNER JOIN machines m ON tp.machineId = m.id
  INNER JOIN tool t ON tp.toolId = t.id
  LEFT JOIN mst_uom u ON t.uom = u.id
  LEFT JOIN item_vs_pm ip ON ip.machineName = tp.machineId AND ip.process = tp.processId
    INNER JOIN partnovstool pt ON pt.id = ip.process
  WHERE tp.toolId = ?
`, [id]);
    const dataWithSlNo = data.map((row, index) => ({
      slno: index + 1,
      ...row
    }));

    return handleSuccessResponse(res, 'PartNo vs Tool List', dataWithSlNo);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.addPartNoVsTool = async (req, res) => {
  try {
    let { machineId, toolId, process, processId } = req.body;

    if (!machineId || !toolId || !process) {
      throw new CustomError('Missing required fields: machineId, toolId, process', 400);
    }

    // Convert process to JSON string if it's an array
    if (Array.isArray(process)) {
      process = JSON.stringify(process); // ← this preserves array format
    }

    // Prevent duplicate combination
    const [existing] = await connection.query(
      `SELECT id FROM partnovstool WHERE machineId = ? AND toolId = ? AND process = ?`,
      [machineId, toolId, process]
    );

    if (existing.length > 0) {
      throw new CustomError('This Machine, Tool, and Process combination already exists', 400);
    }

    // Insert into partnovstool
    const [result] = await connection.query(
      `INSERT INTO partnovstool (machineId, toolId, process)
       VALUES (?, ?, ?)`,
      [machineId, toolId, process]
    );

    const insertedId = result.insertId;

    // Insert into tool_pm (row-wise)
    if (Array.isArray(processId)) {
      for (const pid of processId) {
        await connection.query(
          `INSERT INTO tool_pm (partnovstoolId, toolId, machineId, processId)
           VALUES (?, ?, ?, ?)`,
          [insertedId, toolId, machineId, pid]
        );
      }
    } else if (processId) {
      await connection.query(
        `INSERT INTO tool_pm (partnovstoolId, toolId, machineId, processId)
         VALUES (?, ?, ?, ?)`,
        [insertedId, toolId, machineId, processId]
      );
    }

    return handleSuccessResponse(res, 'PartNo vs Tool added successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};




// // machine proces
// exports.getMachineProcess = async (req, res) => {
//   //console.log("Received request to getMachineProcess:", req.body); 
//   try {
//     const { id } = req.body;
//     if (!id) {
//       return res.status(400).json({ message: "ID is required in payload" });
//     }
//     // Replace this with your actual DB query logic
//     const query = 'SELECT id, machineOperator FROM machines WHERE id = ?';
//     // Assuming you're using a db connection like mysql2 or similar
//     connection.query(query, [id], (err, results) => {
//       if (err) {
//         return res.status(500).json({ message: "Database error", error: err });
//       }
//       if (results.length === 0) {
//         return res.status(404).json({ message: "Machine not found" });
//       }
//       const machine = results[0];
//       // return res.json({
//       //   id: machine.id,
//       //   process: JSON.parse(machine.machineOperator) // Assuming stored as JSON string
//       // });
//     });
//     return handleSuccessResponse(res, 'PartNo vs Tool List', machine);
//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };



exports.getMachineProcess = async (req, res) => {
  try {
    const id = req.params.id;
    const [data] = await connection.query(`
      SELECT id, machineOperator, machOperatorInt FROM machines WHERE id = ?`
      , [id]);

    return handleSuccessResponse(res, 'Proces List', data);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.getMachineProcess = async (req, res) => {
  try {
    const id = req.params.id;
    const [data] = await connection.query(`
      SELECT pm.id,  pm.code As process
       FROM machines_vs_pm_uom mpm
       INNER JOIN machines mach ON  mach.machineCode = mpm.machineCode
       INNER JOIN mst_pm  pm ON  pm.id = mpm.machineOperator

      WHERE mach.id = ?`
      , [id]);

    return handleSuccessResponse(res, 'Proces List', data);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};



// Read All
exports.getAllPartNoVsTool = async (req, res) => {
  try {
    const [data] = await connection.query(`
      SELECT 
        p.id,
        m.machineName,
        m.id AS machineId,
        p.process,
        t.toolNo,
        t.id AS toolId,
        t.uom AS uomId,
        u.name AS uomName
      FROM partnovstool p
      INNER JOIN machines m ON p.machineId = m.id
      INNER JOIN tool t ON p.toolId = t.id
      LEFT JOIN mst_uom u ON t.uom = u.id
    `);

    const dataWithSlNo = data.map((row, index) => ({
      slno: index + 1,
      ...row
    }));

    return handleSuccessResponse(res, 'PartNo vs Tool List', dataWithSlNo);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};



exports.getTool = async (req, res) => {
  try {
    const [data] = await connection.query(`
      SELECT 
       id,
       toolNo
      FROM tool 
    `, []);

    return handleSuccessResponse(res, 'PartNo vs Tool List', data);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};



// Read by ID
exports.getPartNoVsToolByToolId = async (req, res) => {
  try {
    const id = req.params.id;

    const [data] = await connection.query(`
      SELECT DISTINCT 
        tp.id,
        tp.machineId,
        m.machineName,
        tp.processId,
        ip.process,
        tp.toolId,
        t.toolNo,
        t.uom,
        u.name AS uomName
      FROM tool_pm tp
      INNER JOIN machines m ON tp.machineId = m.id
      INNER JOIN tool t ON tp.toolId = t.id
      LEFT JOIN mst_uom u ON t.uom = u.id
      LEFT JOIN item_vs_pm ip ON ip.machineName = tp.machineId AND ip.process = tp.processId
      WHERE tp.toolId = ?
    `, [id]);

    const dataWithSlNo = data.map((row, index) => ({
      slno: index + 1,
      ...row
    }));

    return handleSuccessResponse(res, 'Tool info fetched successfully', dataWithSlNo);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};







// Update
exports.updatePartNoVsTool = async (req, res) => {
  try {
    const { machineId, toolId, process } = req.body;

    if (!machineId && !toolId && !process) {
      throw new CustomError('At least one field (machineId, toolId, or process) must be provided', 400);
    }

    const updates = [];
    const values = [];

    if (machineId) {
      updates.push('machineId = ?');
      values.push(machineId);
    }

    if (toolId) {
      updates.push('toolId = ?');
      values.push(toolId);
    }

    if (process) {
      updates.push('process = ?');
      values.push(JSON.stringify(process)); // Make sure to store it as JSON string
    }

    values.push(req.params.id);

    const [result] = await connection.query(
      `UPDATE partnovstool SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      throw new CustomError('Entry not found', 404);
    }

    const [data] = await connection.query(`
      SELECT 
        p.id,
        m.machineName,
        m.id AS machineId,
        p.process,
        t.toolNo,
        t.id AS toolId
      FROM partnovstool p
      INNER JOIN machines m ON p.machineId = m.id
      INNER JOIN tool t ON p.toolId = t.id
      WHERE p.id = ?
    `, [req.params.id]);

    const responseWithSlNo = data.map((row, index) => ({
      slno: index + 1,
      ...row
    }));

    return handleSuccessResponse(res, 'Updated successfully', responseWithSlNo[0]);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};





// Delete
exports.deletePartNoVsTool = async (req, res) => {
  try {
    const [result] = await connection.query('DELETE FROM partnovstool WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) throw new CustomError('Entry not found', 404);

    return handleSuccessResponse(res, 'Deleted successfully', null);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};




exports.downloadPartNoVsToolTemplate = async (req, res) => {
  try {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Machine vs Tool Template');

    // Set headers for Machine vs Tool
    worksheet.addRow([
      'Machine Name',
      'Tool No'
    ]).font = { bold: true };

    // Style the columns
    worksheet.columns.forEach(col => {
      col.width = 25;
      col.alignment = { horizontal: 'center' };
    });

    // Set response headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=MachineVsToolTemplate.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate template' });
  }
};




exports.importPartNoVsTool = async (req, res) => {
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

    const entries = [];
    const missing = [];
    const display = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber !== 1) {
        const entry = {
          rowNo: rowNumber,
          machineName: row.getCell(2).value?.toString().trim(),
          toolNo: row.getCell(3).value?.toString().trim()
        };


        entries.push(entry);
      }
    });

    for (const e of entries) {
      try {


        // Get machineId from machineName
        const [machineRow] = await connection.query('SELECT id FROM machines WHERE machineName = ?', [e.machineName]);
        if (machineRow.length === 0) {
          missing.push({ ...e, reason: `Invalid Machine Name: ${e.machineName}` });
          continue;
        }


        const machineId = machineRow[0].id;

        // Get toolId from toolNo
        const [toolRow] = await connection.query('SELECT id FROM tool WHERE toolNo = ?', [e.toolNo]);
        if (toolRow.length === 0) {
          missing.push({ e, reason: `Invalid Tool No: ${e.toolNo}` });
          continue;
        }

        const toolId = toolRow[0].id;

        // Prevent duplicate insert
        const [existing] = await connection.query(`
          SELECT id FROM partnovstool 
          WHERE  machineId = ? AND toolId = ?
        `, [machineId, toolId]);

        if (existing.length === 0) {
          await connection.query(`
            INSERT INTO partnovstool ( machineId, toolId)
            VALUES ( ?, ?)
          `, [machineId, toolId]);
        }

        display.push({ ...e, machineId, toolId });

      } catch (errRow) {
        missing.push({ ...e, reason: `Unexpected error: ${errRow.message}` });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'PartNo vs Tool import complete',
      display,
      missing
    });

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


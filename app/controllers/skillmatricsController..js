const { connection, secondaryDB, CustomError, handleErrorResponse } = require('../config/dbSql');
const utility = require('../utility/utilityFunction');
const excel = require('exceljs');
const path = require('path');
const fs = require('fs');


exports.machinelist = async (req, res) => {
    try {
        const fetchQuery = `
            SELECT id, machine_name As machineName ,machine_tag FROM machines
        `;

        // Execute the query
        const [results] = await secondaryDB.execute(fetchQuery);

        if (results.length > 0) {
            return res.status(200).json({
                success: true,
                message: "Machine list successfully.",
                data: results
            });
        } else {
            return res.status(404).json({
                success: false,
                message: "No machines found."
            });
        }
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};

exports.getId = async (req, res) => {
    try {
        const [fRows] = await connection.execute('SELECT fileId FROM skillmatrics ORDER BY id DESC', []);
        // let revNo = 1;
        let fid = 'FID1'; // Default fileId if no records exist

        if (fRows.length > 0) {
            // revNo = parseInt(fRows[0].revisionNo) + 1; // Increment revisionNo

            const lastFileId = fRows[0].fileId;
            const numericPart = (lastFileId && lastFileId.match(/\d+/)) ? parseInt(lastFileId.match(/\d+/)[0]) : 0;
            fid = 'FID' + (numericPart + 1);
        }

        return res.status(200).json({
            // revisionNo: revNo,
            fileId: fid
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.downloadtemp = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');


        // Add headers
        const headerRow = worksheet.addRow(['Machine Name', 'Revesion Number', 'Revesion Date', 'File Name', 'File Type']);


        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text


        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Template.xlsx');

        // Write the Excel file to the response
        workbook.xlsx.write(res)
            .then(() => {
                // End the response stream
                res.end();
            })
            .catch(err => {
                console.error('Error writing Excel file:', err);
                res.status(500).send('Error generating Excel file');
            });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};



exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;

        // 🔁 Get machine ID from machine code
        const [machineRows] = await connection.execute(
            `SELECT id FROM machines WHERE machineCode = ?`,
            [data.machine]
        );

        if (machineRows.length === 0) {
            return res.status(400).json({ success: false, message: "Invalid machine code" });
        }

        const machineId = machineRows[0].id;

        // Store file if provided
        const fileName = utility.storeFile(data.file, 'skillmatrics') || null;
        const fileType = data.fileType || null;
        const originalFileName = data.fileName || null;

        const updateQuery = `
            UPDATE skillmatrics 
            SET machine = ?, revisionNo = ?, revDate = ?, file = ?, fileType = ?, fileName = ?
            WHERE id = ?
        `;
        const values = [machineId, data.revisionNo, data.revDate, fileName, fileType, originalFileName, id];

        const [uRows] = await connection.execute(updateQuery, values);

        if (uRows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully updated" });
        } else {
            throw new Error("Something went wrong!");
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};





//old
// exports.delete = async (req, res) => {
//     try {
//         const id = req.params.id;

//         // Check if record exists
//         const [fRows] = await connection.execute(`SELECT * FROM skillmatrics WHERE id = ?`, [id]);

//         if (fRows.length === 0) {
//             throw new CustomError("skillmatrics not found!", 404);
//         }

//         // Permanently delete the row
//         const [DRows] = await connection.execute(
//             `DELETE FROM skillmatrics WHERE id = ?`,
//             [id]
//         );

//         if (DRows.affectedRows > 0) {
//             return res.status(200).json({ success: true, message: "Successfully Deleted" });
//         } else {
//             throw new CustomError("Something went wrong!");
//         }

//     } catch (err) {
//         return res.status(err.statusCode || 500).json({
//             success: false,
//             message: err.message || 'An error occurred'
//         });
//     }
// };
exports.delete = async (req, res) => {
  try {
    const id = req.params.id;

    // 1️⃣ Check record
    const [fRows] = await connection.execute(
      `SELECT file, fileName FROM skillmatrics WHERE id = ?`,
      [id]
    );

    if (fRows.length === 0) {
      throw new CustomError("Skillmatrics record not found!", 404);
    }

    const filePathFromDB = fRows[0].file; // e.g. skillmatrics/JHA-TPP1.pdf

    // 2️⃣ Since "public" is outside "app", go 2 levels up
    const fullPath = path.join(__dirname, "../..", "public", filePathFromDB);

    // console.log("📂 File path from DB:", filePathFromDB);
    // console.log("🧭 Resolved full path:", fullPath);
    // console.log("📂 Current __dirname:", __dirname);

    // 3️⃣ Delete record
    const [DRows] = await connection.execute(
      `DELETE FROM skillmatrics WHERE id = ?`,
      [id]
    );

    if (DRows.affectedRows === 0) {
      throw new CustomError("Something went wrong while deleting from DB!");
    }

    // 4️⃣ Delete file from disk
    if (filePathFromDB && fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    //   console.log(`🗑️ Deleted file: ${fullPath}`);
    } else {
    //   console.warn(`⚠️ File not found: ${fullPath}`);
    }

    return res.status(200).json({
      success: true,
      message: `Successfully deleted '${fRows[0].fileName}' and its associated file.`,
    });

  } catch (err) {
    console.error("Error deleting skillmatrics:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "An error occurred",
    });
  }
};

exports.store = async (req, res) => {
    try {
        const data = req.body;

        const machineCode = data.machine; // e.g., "PP-160"

        let machineId = null;

        // STEP 1 → Check in machines table
        const [machineRows] = await connection.execute(
            'SELECT id FROM machines WHERE machineCode = ?',
            [machineCode]
        );

        if (machineRows.length > 0) {
            machineId = machineRows[0].id;
        } else {
            // ❗STEP 2 → Not found → Check in item_product_family
            const [familyRows] = await connection.execute(
                'SELECT id FROM item_product_family WHERE name = ?',
                [machineCode]
            );

            if (familyRows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid machine code: '${machineCode}' not found in machines or item_product_family`
                });
            }

            // Use item_product_family id
            machineId = familyRows[0].id;
        }

        // STEP 3 → Check duplicate fileName
        const [dupRows] = await connection.execute(
            'SELECT id FROM skillmatrics WHERE fileName = ?',
            [data.fileName]
        );

        if (dupRows.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Duplicate entry: File '${data.fileName}' already exists.`
            });
        }

        // STEP 4 → Store file
        let filePath = null;
        if (data.file) {
            filePath = utility.storeFileReq(data.file, 'skillmatrics', data.fileName);
            filePath = filePath.replace(/\\/g, "/"); // normalize path
        }

        // STEP 5 → Insert
        const storeQuery = `
            INSERT INTO skillmatrics (machine, fileId, revisionNo, revDate, file, fileType, fileName)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            machineId,
            data.fileId,
            data.revisionNo,
            data.revDate,
            filePath,
            data.fileType,
            data.fileName
        ];

        const [sRows] = await connection.execute(storeQuery, values);

        if (sRows.affectedRows > 0) {
            return res.status(200).json({
                success: true,
                message: "Data added successfully"
            });
        } else {
            throw new Error("Something went wrong!");
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};

//deployed
// exports.store = async (req, res) => {
//     try {

//         const data = req.body;

//         // Validate required fields
//         if (!data.machine || !data.fileName) {
//             return res.status(400).json({
//                 success: false,
//                 message: "machine and fileName are required"
//             });
//         }

//         const machineCode = data.machine;
//         let machineId = null;

//         // STEP 1 → Check machine
//         const [machineRows] = await connection.execute(
//             "SELECT id FROM machines WHERE machineCode = ?",
//             [machineCode]
//         );

//         if (machineRows.length === 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: `Invalid machine code '${machineCode}'`
//             });
//         }

//         machineId = machineRows[0].id;

//         // STEP 2 → Check duplicate fileName
//         const [dupRows] = await connection.execute(
//             "SELECT id FROM skillmatrics WHERE fileName = ?",
//             [data.fileName]
//         );

//         if (dupRows.length > 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: `File '${data.fileName}' already exists`
//             });
//         }

//         // STEP 3 → Store file
//         let filePath = null;

//         if (data.file) {
//             try {
//                 filePath = utility.storeFileReq(data.file, "skillmatrics", data.fileName);
//                 filePath = filePath.replace(/\\/g, "/");
//             } catch (fileErr) {
//                 return res.status(500).json({
//                     success: false,
//                     message: "File upload failed"
//                 });
//             }
//         }

//         // STEP 4 → Insert
//         const query = `
//             INSERT INTO skillmatrics
//             (machine, fileId, revisionNo, revDate, file, fileType, fileName)
//             VALUES (?, ?, ?, ?, ?, ?, ?)
//         `;

//         const values = [
//             machineId,
//             data.fileId || null,
//             data.revisionNo || null,
//             data.revDate || null,
//             filePath,
//             data.fileType || null,
//             data.fileName
//         ];

//         const [result] = await connection.execute(query, values);

//         return res.status(200).json({
//             success: true,
//             message: "Data added successfully",
//             id: result.insertId
//         });

//     } catch (err) {

//         console.error("SkillMatrix Store Error:", err);

//         return res.status(500).json({
//             success: false,
//             message: "Internal Server Error"
//         });
//     }
// };

//old deployed
// exports.show = async (req, res) => {
//     try {
//         const fetchQuery = `
//             SELECT 
//                 skillmatrics.id,
//                 machines.machineName AS machine,  
//                 skillmatrics.fileId,
//                 skillmatrics.revisionNo,
//                 skillmatrics.fileType,
//                 skillmatrics.fileName,
//                 DATE_FORMAT(skillmatrics.revDate, '%d-%m-%Y') AS revDate,
//                 skillmatrics.file
//             FROM skillmatrics
//             INNER JOIN machines ON skillmatrics.machine = machines.id
//             WHERE skillmatrics.dflag = 0
//         `;

//         const [results] = await connection.execute(fetchQuery);

//         if (results.length > 0) {
//             const resultsWithSlno = results.map((item, index) => ({
//                 ...item,
//                 slno: index + 1
//             }));

//             return res.status(200).json({
//                 success: true,
//                 message: "Skillmatrics list retrieved successfully.",
//                 data: resultsWithSlno
//             });
//         } else {
//             return res.status(404).json({
//                 success: false,
//                 message: "No skillmatrics found."
//             });
//         }
//     } catch (err) {
//         return res.status(500).json({
//             success: false,
//             message: err.message || 'An error occurred'
//         });
//     }
// };
exports.show = async (req, res) => {
    try {
        const fetchQuery = `
            SELECT 
                sm.id,
                sm.machine AS machineId,
                m.machineName,
                ipf.name AS familyName,
                sm.fileId,
                sm.revisionNo,
                sm.fileType,
                sm.fileName,
                DATE_FORMAT(sm.revDate, '%d-%m-%Y') AS revDate,
                sm.file
            FROM skillmatrics sm
            LEFT JOIN machines m ON sm.machine = m.id
            LEFT JOIN item_product_family ipf ON sm.machine = ipf.id
            WHERE sm.dflag = 0
        `;

        const [results] = await connection.execute(fetchQuery);

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No skillmatrics found."
            });
        }

        // Format response
        const resultsWithSlno = results.map((item, index) => ({
            slno: index + 1,
            id: item.id,
            machine: item.machineName || item.familyName,  // ⭐ pick whichever exists
            fileId: item.fileId,
            revisionNo: item.revisionNo,
            fileType: item.fileType,
            fileName: item.fileName,
            revDate: item.revDate,
            file: item.file
        }));

        return res.status(200).json({
            success: true,
            message: "Skillmatrics list retrieved successfully.",
            data: resultsWithSlno
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};

const machineIdMap = new Map();

exports.viewFile = async (req, res) => {
    try {
        let machineId = req.body.machineId; // Assuming this is how you get the type value

        const [[machineRows]] = await secondaryDB.execute(
            'SELECT machine_tag FROM machines WHERE id = ?',
            [machineId]
        );

        if(!machineRows) {
            return handleErrorResponse(res, "Machine not found");
        }
        const machineTag = machineRows.machine_tag

        if(!machineIdMap.has(machineTag)) {
            const [[mIdRows]] = await connection.execute(
                'SELECT id FROM machines WHERE machineCode = ?',
                [machineTag]
            );
            if(!mIdRows) {
                const [[pfIdRows]] = await connection.execute(
                    'SELECT id FROM item_product_family WHERE name = ?',
                    [machineTag]
                );
                if(!pfIdRows) {
                    return handleErrorResponse(res, "Machine not found in both tables");
                }
                machineId = pfIdRows.id;
            } else {
                machineId = mIdRows.id;
            }

            machineIdMap.set(machineTag, machineId);
        } else {
            machineId = machineIdMap.get(machineTag);
        }
        // Get the local IP address
        const ipAddress = utility.getLocalIpAddress();

        // Get the port number from environment variables
        const port = process.env.APP_PORT || 8009;


        // Construct the SQL query
        const sqlQuery = `
            SELECT 
                id, 
                CONCAT('http://', ? , ':', ? , '/', file) AS file_url
            FROM 
                skillmatrics
            WHERE 
                dflag = 0 AND machine = ?`;

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, [ipAddress, port, machineId]);

        if (rows.length >= 0) {
            return res.status(200).json({
                success: true,
                message: "skillmatrics File",
                data: rows
            });
        }
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

//old
// exports.importSkillmatricsExcel = async (req, res) => {
//     try {
//         const { file } = req.body;

//         // Validate file presence and format
//         if (
//             !file ||
//             !file.startsWith('data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,')
//         ) {
//             return res.status(400).json({ success: false, message: 'Invalid base64 Excel file.' });
//         }

//         // Decode base64 Excel data
//         const base64Data = file.split(';base64,').pop();
//         const buffer = Buffer.from(base64Data, 'base64');

//         // Load Excel workbook
//         const workbook = new excel.Workbook();
//         await workbook.xlsx.load(buffer);
//         const worksheet = workbook.getWorksheet(1);

//         if (!worksheet) {
//             return res.status(400).json({ success: false, message: 'Excel sheet not found or invalid format.' });
//         }

//         const insertData = [];

//         for (let i = 2; i <= worksheet.rowCount; i++) {
//             const row = worksheet.getRow(i);

//             const machineName = row.getCell(1)?.value?.toString().trim();
//             const revisionNo = row.getCell(2)?.value;
//             const revDate = row.getCell(3)?.value;
//             const fileName = row.getCell(4)?.value?.toString().trim();
//             const fileType = row.getCell(5)?.value?.toString().trim();

//             // Skip rows with missing values
//             if (!machineName || !revisionNo || !revDate || !fileName || !fileType) continue;

//             // Get machine ID
//             const [machineRows] = await connection.execute(
//                 'SELECT id FROM machines WHERE machineCode = ?',
//                 [machineName]
//             );
//             if (machineRows.length === 0) {
//                 console.warn(`Machine not found: ${machineName}, skipping row ${i}`);
//                 continue;
//             }

//             const machineId = machineRows[0].id;

//             // Generate next fileId
//             const [fRows] = await connection.execute(
//                 'SELECT fileId FROM skillmatrics ORDER BY id DESC LIMIT 1'
//             );
//             const lastIdNum = fRows.length > 0 ? parseInt(fRows[0].fileId.replace('FID', '')) + 1 : 1;
//             const fileId = 'FID' + lastIdNum;

//             // Push data for batch insert (no file saving)
//             insertData.push([
//                 machineId,
//                 fileId,
//                 fileType,
//                 fileName,     // Store as-is from Excel
//                 revisionNo,
//                 revDate
//             ]);
//         }

//         if (insertData.length === 0) {
//             return res.status(400).json({ success: false, message: 'No valid rows found in Excel.' });
//         }

//         // Insert into DB
//         const insertQuery = `
//             INSERT INTO skillmatrics (machine, fileId, fileType, fileName, revisionNo, revDate)
//             VALUES ?
//         `;
//         await connection.query(insertQuery, [insertData]);

//         return res.status(200).json({ success: true, message: 'Skillmatrics imported successfully.' });

//     } catch (err) {
//         console.error('Import Error:', err);
//         return res.status(500).json({ success: false, message: 'Internal server error.' });
//     }
// };


//old
// exports.uploadSkillmatricsFiles = async (req, res) => {
//     try {
//         const { filesData } = req.body;

//         if (!Array.isArray(filesData) || filesData.length === 0) {
//             return res.status(400).json({ success: false, message: 'No files provided' });
//         }

//         for (const fileObj of filesData) {
//             const { file, fileName } = fileObj;

//             if (!file || !fileName) continue;

//             // Store file using your utility (it returns skillmatrics/uuid.png)
//             const storedFilePath = utility.storeFile(file, 'skillmatrics');

//             // Update skillmatrics table
//             await connection.execute(
//                 `UPDATE skillmatrics SET file = ? WHERE fileName = ?`,
//                 [storedFilePath, fileName]
//             );
//         }

//         return res.status(200).json({ success: true, message: 'Files uploaded and database updated.' });
//     } catch (error) {
//         console.error('Error while uploading:', error);
//         return res.status(500).json({ success: false, message: 'Internal Server Error' });
//     }
// };

// function storeFileReq(image, folder, fileName) {
//     if (!image) {
//         return null;
//     }

//     const folderPath = path.join('public', folder);

//     if (!fs.existsSync(folderPath)) {
//         fs.mkdirSync(folderPath, { recursive: true });
//     }

//     const base64Data = image.split(',')[1];
//     const fileBuffer = Buffer.from(base64Data, 'base64');

//     const filePath = path.join(folderPath, fileName);

//     fs.writeFileSync(filePath, fileBuffer);

//     // ✅ Return DB-friendly path (without public and with forward slashes)
//     return path.posix.join(folder, fileName);
// }

// exports.uploadSkillmatricsFiles = async (req, res) => {
//     try {
//         const { filesData } = req.body;

//         if (!Array.isArray(filesData) || filesData.length === 0) {
//             return res.status(400).json({ success: false, message: 'No files provided' });
//         }

//         for (const fileObj of filesData) {
//             const { file, fileName } = fileObj;

//             if (!file || !fileName) continue;

//             // Store with same filename
//             const storedFilePath = storeFileReq(file, 'skillmatrics', fileName);

//             if (!storedFilePath) continue;

//             // Update skillmatrics table
//             await connection.execute(
//                 `UPDATE skillmatrics SET file = ? WHERE fileName = ?`,
//                 [storedFilePath, fileName]
//             );
//         }

//         return res.status(200).json({ success: true, message: 'Files uploaded and database updated.' });
//     } catch (error) {
//         console.error('Error while uploading:', error);
//         return res.status(500).json({ success: false, message: 'Internal Server Error' });
//     }
// };

// ✅ Store file with same filename but check for duplicates


exports.importSkillmatricsExcel = async (req, res) => {
    try {
        const { file } = req.body;

        // Validate file presence and format
        if (
            !file ||
            !file.startsWith('data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,')
        ) {
            return res.status(400).json({ success: false, message: 'Invalid base64 Excel file.' });
        }

        // Decode base64 Excel data
        const base64Data = file.split(';base64,').pop();
        const buffer = Buffer.from(base64Data, 'base64');

        // Load Excel workbook
        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        if (!worksheet) {
            return res.status(400).json({ success: false, message: 'Excel sheet not found or invalid format.' });
        }

        const insertData = [];

        for (let i = 2; i <= worksheet.rowCount; i++) {
            const row = worksheet.getRow(i);

            const machineName = row.getCell(1)?.value?.toString().trim();
            const revisionNo = row.getCell(2)?.value;
            const revDate = row.getCell(3)?.value;
            const fileName = row.getCell(4)?.value?.toString().trim();
            const fileType = row.getCell(5)?.value?.toString().trim();

            // Skip rows with missing values
            if (!machineName || !revisionNo || !revDate || !fileName || !fileType) continue;

            // 🔍 Check duplicate filename
            const [dupRows] = await connection.execute(
                'SELECT id FROM skillmatrics WHERE fileName = ?',
                [fileName]
            );
            if (dupRows.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Duplicate entry: File '${fileName}' already exists.`
                });
            }

            // Get machine ID
            const [machineRows] = await connection.execute(
                'SELECT id FROM machines WHERE machineCode = ?',
                [machineName]
            );
            if (machineRows.length === 0) {
                console.warn(`Machine not found: ${machineName}, skipping row ${i}`);
                continue;
            }

            const machineId = machineRows[0].id;

            // Generate next fileId
            const [fRows] = await connection.execute(
                'SELECT fileId FROM skillmatrics ORDER BY id DESC LIMIT 1'
            );
            const lastIdNum = fRows.length > 0 ? parseInt(fRows[0].fileId.replace('FID', '')) + 1 : 1;
            const fileId = 'FID' + lastIdNum;

            // Push data for batch insert (no file saving)
            insertData.push([
                machineId,
                fileId,
                fileType,
                fileName,     // Store as-is from Excel
                revisionNo,
                revDate
            ]);
        }

        if (insertData.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid rows found in Excel.' });
        }

        // Insert into DB
        const insertQuery = `
            INSERT INTO skillmatrics (machine, fileId, fileType, fileName, revisionNo, revDate)
            VALUES ?
        `;
        await connection.query(insertQuery, [insertData]);

        return res.status(200).json({ success: true, message: 'Skillmatrics imported successfully.' });

    } catch (err) {
        console.error('Import Error:', err);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
};



function storeFileReq(image, folder, fileName) {
    if (!image) {
        return null;
    }

    const folderPath = path.join('public', folder);

    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }

    const filePath = path.join(folderPath, fileName);

    // ❌ If file already exists, throw error
    if (fs.existsSync(filePath)) {
        throw new Error(`Duplicate entry: ${fileName} already exists`);
    }

    const base64Data = image.split(',')[1];
    const fileBuffer = Buffer.from(base64Data, 'base64');

    fs.writeFileSync(filePath, fileBuffer);

    // ✅ Return DB-friendly path (without public and with forward slashes)
    return path.posix.join(folder, fileName);
}

exports.uploadSkillmatricsFiles = async (req, res) => {
    try {
        const { filesData } = req.body;

        if (!Array.isArray(filesData) || filesData.length === 0) {
            return res.status(400).json({ success: false, message: 'No files provided' });
        }

        for (const fileObj of filesData) {
            const { file, fileName } = fileObj;

            if (!file || !fileName) continue;

            try {
                // Try storing the file (throws error if duplicate)
                const storedFilePath = storeFileReq(file, 'skillmatrics', fileName);

                if (!storedFilePath) continue;

                // Update skillmatrics table
                await connection.execute(
                    `UPDATE skillmatrics SET file = ? WHERE fileName = ?`,
                    [storedFilePath, fileName]
                );
            } catch (err) {
                // Handle duplicate error
                if (err.message.startsWith("Duplicate entry")) {
                    return res.status(400).json({
                        success: false,
                        message: err.message
                    });
                } else {
                    throw err;
                }
            }
        }

        return res.status(200).json({ success: true, message: 'Files uploaded and database updated.' });
    } catch (error) {
        console.error('Error while uploading:', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

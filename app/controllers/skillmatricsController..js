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

        // 🔍 Get the existing record so we know the current file/filename
        const [existingRows] = await connection.execute(
            `SELECT file, fileName FROM skillmatrics WHERE id = ?`,
            [id]
        );

        if (existingRows.length === 0) {
            throw new CustomError("Skillmatrics record not found!", 404);
        }

        const oldFilePath = existingRows[0].file;
        const fileType = data.fileType || null;
        const newFileName = data.fileName || existingRows[0].fileName;

        let filePath = oldFilePath;

        if (data.file) {
            // ✅ New content uploaded → delete the old file, then store the new
            // content at a path based on the (possibly new) filename, overwriting
            // anything already there under that name.
            if (oldFilePath) {
                const oldFullPath = path.join(__dirname, "../..", "public", oldFilePath);
                if (fs.existsSync(oldFullPath)) {
                    fs.unlinkSync(oldFullPath);
                }
            }

            filePath = storeFileReq(data.file, 'skillmatrics', newFileName);
            filePath = filePath.replace(/\\/g, "/");
        } else if (newFileName !== existingRows[0].fileName && oldFilePath) {
            // ✅ Filename changed but no new content uploaded → rename the existing
            // file on disk so the stored path still matches the filename.
            const oldFullPath = path.join(__dirname, "../..", "public", oldFilePath);
            const newRelPath = path.posix.join('skillmatrics', newFileName);
            const newFullPath = path.join(__dirname, "../..", "public", newRelPath);
            if (fs.existsSync(oldFullPath)) {
                fs.renameSync(oldFullPath, newFullPath);
                filePath = newRelPath;
            }
        }

        const updateQuery = `
            UPDATE skillmatrics
            SET machine = ?, revisionNo = ?, revDate = ?, file = ?, fileType = ?, fileName = ?
            WHERE id = ?
        `;
        const values = [machineId, data.revisionNo, data.revDate, filePath, fileType, newFileName, id];

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
            'SELECT id, file FROM skillmatrics WHERE fileName = ?',
            [data.fileName]
        );

        // STEP 4 → Store file (same filename → same skillmatrics/<fileName> path,
        // overwriting whatever was there before)
        let filePath = dupRows.length > 0 ? dupRows[0].file : null;
        if (data.file) {
            if (dupRows.length > 0 && dupRows[0].file) {
                const oldFullPath = path.join(__dirname, "../..", "public", dupRows[0].file);
                if (fs.existsSync(oldFullPath)) {
                    fs.unlinkSync(oldFullPath);
                }
            }

            filePath = storeFileReq(data.file, 'skillmatrics', data.fileName);
            filePath = filePath.replace(/\\/g, "/"); // normalize path
        }

        if (dupRows.length > 0) {
            // Same filename already exists → update that record instead of
            // inserting a duplicate row
            const updateQuery = `
                UPDATE skillmatrics
                SET machine = ?, revisionNo = ?, revDate = ?, file = ?, fileType = ?
                WHERE fileName = ?
            `;
            const [uRows] = await connection.execute(updateQuery, [
                machineId, data.revisionNo, data.revDate, filePath, data.fileType, data.fileName
            ]);

            if (uRows.affectedRows > 0) {
                return res.status(200).json({
                    success: true,
                    message: "Existing file overwritten and data updated successfully"
                });
            } else {
                throw new Error("Something went wrong!");
            }
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
        let processedCount = 0;

        // Seed the fileId counter once, then increment it locally as we go —
        // querying "last fileId" per-row would return the same value for every
        // new row in this batch, since inserts only happen after the loop.
        const [seedRows] = await connection.execute(
            'SELECT fileId FROM skillmatrics ORDER BY id DESC LIMIT 1'
        );
        let nextIdNum = seedRows.length > 0 ? parseInt(seedRows[0].fileId.replace('FID', '')) + 1 : 1;

        for (let i = 2; i <= worksheet.rowCount; i++) {
            const row = worksheet.getRow(i);

            const machineName = row.getCell(1)?.value?.toString().trim();
            const revisionNo = row.getCell(2)?.value;
            const revDate = row.getCell(3)?.value;
            const fileName = row.getCell(4)?.value?.toString().trim();
            const fileType = row.getCell(5)?.value?.toString().trim();

            // Skip rows with missing values
            if (!machineName || !revisionNo || !revDate || !fileName || !fileType) continue;

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

            // 🔁 Same filename already present → overwrite that record instead of blocking the import
            const [dupRows] = await connection.execute(
                'SELECT id FROM skillmatrics WHERE fileName = ?',
                [fileName]
            );

            if (dupRows.length > 0) {
                await connection.execute(
                    `UPDATE skillmatrics
                     SET machine = ?, fileType = ?, revisionNo = ?, revDate = ?
                     WHERE fileName = ?`,
                    [machineId, fileType, revisionNo, revDate, fileName]
                );
                processedCount++;
                continue;
            }

            const fileId = 'FID' + nextIdNum;
            nextIdNum++;

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

        if (insertData.length > 0) {
            const insertQuery = `
                INSERT INTO skillmatrics (machine, fileId, fileType, fileName, revisionNo, revDate)
                VALUES ?
            `;
            await connection.query(insertQuery, [insertData]);
        }

        processedCount += insertData.length;

        if (processedCount === 0) {
            return res.status(400).json({ success: false, message: 'No valid rows found in Excel.' });
        }

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

    const base64Data = image.split(',')[1];
    const fileBuffer = Buffer.from(base64Data, 'base64');

    // ✅ Same filename → overwrite the existing file with the new one
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

        const updated = [];
        const notFound = [];
        const skipped = [];

        for (const fileObj of filesData) {
            const { file, fileName } = fileObj;

            if (!file || !fileName) {
                skipped.push(fileName || '(missing fileName)');
                continue;
            }

            const trimmedFileName = fileName.trim();

            // 🔍 Confirm a record with this exact fileName exists before writing anything
            const [matchRows] = await connection.execute(
                'SELECT id FROM skillmatrics WHERE fileName = ?',
                [trimmedFileName]
            );

            if (matchRows.length === 0) {
                notFound.push(trimmedFileName);
                continue;
            }

            // Overwrites the file on disk if one with this name already exists
            const storedFilePath = storeFileReq(file, 'skillmatrics', trimmedFileName);

            if (!storedFilePath) {
                skipped.push(trimmedFileName);
                continue;
            }

            // Update skillmatrics table
            const [uRows] = await connection.execute(
                `UPDATE skillmatrics SET file = ? WHERE fileName = ?`,
                [storedFilePath, trimmedFileName]
            );

            if (uRows.affectedRows > 0) {
                updated.push(trimmedFileName);
            } else {
                notFound.push(trimmedFileName);
            }
        }

        return res.status(200).json({
            success: true,
            message: `${updated.length} file(s) updated, ${notFound.length} not matched, ${skipped.length} skipped.`,
            updated,
            notFound,
            skipped
        });
    } catch (error) {
        console.error('Error while uploading:', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
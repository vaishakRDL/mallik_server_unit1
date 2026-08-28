const excel = require('exceljs');
const { collection: mCollection, query: mQuery, value: mValue } = require('../utility/master.js');
const { collection: imCollection, query: imQuery, value: imValue } = require('../utility/itemMaster.js');
const { rights } = require('../controllers/groupMstController.js');
const { connection, CustomError, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');
const { decodeBase64, storeFile } = require('../utility/utilityFunction.js');
const moment = require('moment');

const masterDetails = async (master) => {
    try {
        const masterConfig = mCollection[master] || imCollection[master];

        if (!masterConfig) {
            throw new CustomError('Invalid Master type!', 400);
        }
        const { mstLable: label, tbName: table, colName: column } = masterConfig;

        return { label, table, column };
    } catch (err) {
        throw err;
    }
}

exports.store = async (req, res) => {
    try {
        const data = req.body;
        const masterType = data.masterType;

        const { label, table, column } = await masterDetails(masterType);

        // Check for duplicate entries
        const queryCheck = `SELECT * FROM ${table} WHERE ${column} = ? AND dflag = 0`;
        const [rows] = await connection.execute(queryCheck, [data.name]);

        if (rows.length > 0) throw new CustomError(`${label} name already exists!`, 400);

        // Fetch SQL query and values for insertion
        const sqlQuery = mQuery(masterType, 'insert') || imQuery(masterType, 'insert');
        const sqlValue = mValue(masterType, data) || imValue(masterType, data);

        if (!sqlQuery || !sqlValue) {
            throw new CustomError('Invalid SQL Query or Values!', 400);
        }

        await connection.execute(sqlQuery, sqlValue);

        return handleSuccessResponse(res, `${label} added successfully`);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        const masterType = data.masterType;

        const { label, table } = await masterDetails(masterType);

        const queryCheck = `SELECT * FROM ${table} WHERE id = ? AND dflag = 0`;
        const [existingRecord] = await connection.execute(queryCheck, [id]);

        if (existingRecord.length === 0) {
            throw new CustomError(`${label} not found!`, 404);
        }
        const sqlQuery = mQuery(masterType, 'update') || imQuery(masterType, 'update');
        const sqlValue = mValue(masterType, data) || imValue(masterType, data);

        if (!sqlQuery || !sqlValue) {
            throw new CustomError('Invalid SQL Query or Values!', 400);
        }

        await connection.execute(sqlQuery, [...sqlValue, id]);

        return handleSuccessResponse(res, `${label} updated successfully`);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


exports.delete = async (req, res) => {
    try {
        const id = req.params.id;
        const masterType = req.body.masterType;

        const { label, table } = await masterDetails(masterType);

        const checkQuery = `SELECT * FROM ${table} WHERE id = ? AND dflag = 0`;
        const [existingRecord] = await connection.execute(checkQuery, [id]);

        if (existingRecord.length === 0) {
            throw new CustomError(`${label} not found!`, 404);
        }
        const deleteQuery = mQuery(masterType, 'delete') || imQuery(masterType, 'delete');
        if (!deleteQuery) {
            throw new CustomError('Invalid SQL Query!', 400);
        }

        await connection.execute(deleteQuery, [id]);

        return handleSuccessResponse(res, `${label} deleted successfully`);
    } catch (err) {
        return handleErrorResponse
    }
};

exports.show = async (req, res) => {
    try {
        const master = req.params.master;

        const { label, table } = await masterDetails(master);

        // Update rights table if master is "menu"
        if (master === "menu") {
            rights(res);
        }
        const [results] = await connection.execute(`SELECT *, ? AS masterType FROM ${table} WHERE dflag = 0`, [master]);

        const transformedResults = results.map(item => ({
            ...item,
            inactiveStatus: item.inactiveStatus === 0 || item.inactiveStatus === '' ? false : true,
        }));

        return handleSuccessResponse(res, `${label} list`, transformedResults);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.getEmailSettings = async (req, res) => {
    try {
        const [rows] = await connection.execute(`SELECT * FROM emailsettings`);

        // Format the created_at field for each row
        const formattedRows = rows.map(row => ({
            ...row,
            created_at: moment(row.created_at).format('YYYY-MM-DD HH:mm:ss')
        }));

        res.status(200).json({
            success: true,
            message: "Email settings fetched successfully",
            data: formattedRows
        });
    } catch (error) {
        console.error("Error fetching email settings:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch email settings"
        });
    }
};

exports.updateEmailSettings = async (req, res) => {
    const { id } = req.params;
    const {
        smtp_host,
        smtp_port,
        email,
        password,
        type

    } = req.body;

    try {
        const [result] = await connection.execute(
            `UPDATE emailsettings
             SET smtp_host = ?, smtp_port = ?, email = ?, password = ?, type = ?
             WHERE id = ?`,
            [smtp_host, smtp_port, email, password, type, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Email setting not found"
            });
        }

        // Fetch the updated record to return with formatted date
        const [updatedRows] = await connection.execute(
            `SELECT * FROM emailsettings WHERE id = ?`,
            [id]
        );

        const updatedData = updatedRows.map(row => ({
            ...row,
            created_at: moment(row.created_at).format('YYYY-MM-DD HH:mm:ss')
        }));

        res.status(200).json({
            success: true,
            message: "Email settings updated successfully",
            data: updatedData[0]
        });

    } catch (error) {
        console.error("Error updating email settings:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update email settings"
        });
    }
};


//Used in Master City
exports.getState = async (req, res) => {
    try {
        const id = req.params.id

        const query = `
            SELECT id, name	
            FROM mst_state   
            WHERE countryId = ? AND dflag = 0`;

        const [rows] = await connection.execute(query, [id]);

        if (rows.length >= 0) {
            rows.forEach((element, index) => {
                element.sNo = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Raasons list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}

exports.downloadTemplate = async (req, res) => {
    try {
        const { master } = req.query;

        const { label } = await masterDetails(master);

        let columns;
        if (mCollection[master]) {
            columns = [
                { header: `${label} Code`, key: 'code', width: 20 },
                { header: `${label} Name`, key: 'name', width: 30 },
                { header: 'Inactive Status', key: 'inactiveStatus', width: 20 },
                { header: 'Inactive Remarks', key: 'inactiveRemarks', width: 30 },
                { header: 'Description', key: 'description', width: 40 }
            ];
        } else {
            columns = [
                { header: `${label} Name`, key: 'name', width: 30 },
                { header: 'Description', key: 'description', width: 40 }
            ];
        }

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet(`${label} Template`);

        worksheet.columns = columns;

        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${label}_template.xlsx`);

        await workbook.xlsx.write(res);

        res.end();
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.importMasters = async (req, res) => {
    try {
        const { master, file, type, data } = req.body;

        const { label, table } = await masterDetails(master);

        // Unique column based on the master type
        const uniqueCol = mCollection[master] ? 'code' : 'name';

        // Fetch existing master records 
        const [masters] = await connection.execute(
            `SELECT ${uniqueCol} FROM ${table} WHERE dflag = 0`
        );
        const existingMasters = new Set(masters.map(master => master[uniqueCol]));

        if (type === 'import') {
            const buffer = decodeBase64(file);

            const workbook = new excel.Workbook();
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.getWorksheet(1);

            const rows = [];
            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber > 1) {
                    if (uniqueCol === 'code') {
                        const rowData = {
                            id: rowNumber - 1,
                            code: row.getCell(1).text,
                            name: row.getCell(2).text,
                            inactiveStatus: row.getCell(3).text,
                            inactiveRemarks: row.getCell(4).text,
                            description: row.getCell(5).text
                        };
                        rows.push(rowData);
                    } else {
                        const rowData = {
                            id: rowNumber - 1,
                            name: row.getCell(1).text,
                            description: row.getCell(2).text
                        };
                        rows.push(rowData);
                    }
                }
            });
            // check for duplicate entries
            const duplicates = rows.filter(row => existingMasters.has(row[uniqueCol]));
            if (duplicates.length > 0) {
                const duplicateValues = duplicates.map(row => row[uniqueCol]).join(', ');
                throw new CustomError(`${label} already exists: ${duplicateValues}`, 400);
            }

            return handleSuccessResponse(res, `File processed successfully.`, rows);

        } else if (type === 'loadToDb') {
            if (data.length > 0) {
                // check for duplicate entries
                const duplicates = data.filter(row => existingMasters.has(row[uniqueCol]));
                if (duplicates.length > 0) {
                    const duplicateValues = duplicates.map(row => row[uniqueCol]).join(', ');
                    throw new CustomError(`${label} already exists: ${duplicateValues}`, 400);
                }

                const placeholders = data.map(() =>
                    uniqueCol === 'code'
                        ? '(?, ?, ?, ?, ?)'
                        : '(?, ?)'
                ).join(', ');

                const values = data.flatMap(row => {
                    if (uniqueCol === 'code') {
                        return [row.code, row.name, row.inactiveStatus, row.inactiveRemarks, row.description];
                    } else {
                        return [row.name, row.description];
                    }
                });

                const columns = uniqueCol === 'code'
                    ? `code, name, inactiveStatus, inactiveRemarks, description`
                    : `name, description`;

                await connection.execute(
                    `INSERT INTO ${table} (${columns}) VALUES ${placeholders}`,
                    values
                );
            }
            return handleSuccessResponse(res, `Data Stored successfully.`);
        }

        throw new CustomError('Invalid type recieved!', 400);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// exports.downloadMasters = async (req, res) => {
//     try {
//         const { master } = req.query;

//         const { label, table } = await masterDetails(master);

//         let columns;
//         if (mCollection[master]) {
//             columns = [
//                 { header: 'Sl No', key: 'id', width: 10 },
//                 { header: `${label} Code`, key: 'code', width: 20 },
//                 { header: `${label} Name`, key: 'name', width: 30 },
//                 { header: 'Inactive Status', key: 'inactiveStatus', width: 20 },
//                 { header: 'Inactive Remarks', key: 'inactiveRemarks', width: 30 },
//                 { header: 'Description', key: 'description', width: 40 }
//             ];
//         } else {
//             columns = [
//                 { header: 'Sl No', key: 'id', width: 10 },
//                 { header: `${label} Name`, key: 'name', width: 30 },
//                 { header: 'Description', key: 'description', width: 40 }
//             ];
//         }

//         const [results] = await connection.execute(
//             `SELECT ROW_NUMBER() OVER (ORDER BY created_at) AS id, ${columns.map(col => col.key).slice(1).join(', ')} FROM ${table} WHERE dflag = 0`,
//             [master]
//         );

//         const workbook = new excel.Workbook();
//         const worksheet = workbook.addWorksheet(`${label} List`);

//         worksheet.columns = columns;

//         results.forEach(row => worksheet.addRow(row));

//         const headerRow = worksheet.getRow(1);
//         headerRow.font = { bold: true };
//         headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

//         // Center-align all rows
//         worksheet.eachRow((row, rowNumber) => {
//             row.eachCell((cell) => {
//                 cell.alignment = { vertical: 'middle', horizontal: 'center' };
//             });
//         });

//         res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
//         res.setHeader('Content-Disposition', `attachment; filename=${label}_list.xlsx`);

//         await workbook.xlsx.write(res);

//         res.end();
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };

exports.downloadMasters = async (req, res) => {
    try {
        const { master } = req.query;

        const { label, table } = await masterDetails(master);

        const isCollection = Boolean(mCollection[master]);

        const columns = isCollection
            ? [
                { header: 'Sl No', key: 'id', width: 10 },
                { header: `${label} Code`, key: 'code', width: 20 },
                { header: `${label} Name`, key: 'name', width: 30 },
                { header: 'Inactive Status', key: 'inactiveStatus', width: 20 },
                { header: 'Inactive Remarks', key: 'inactiveRemarks', width: 30 },
                { header: 'Description', key: 'description', width: 40 }
            ]
            : [
                { header: 'Sl No', key: 'id', width: 10 },
                { header: `${label} Name`, key: 'name', width: 30 },
                { header: 'Description', key: 'description', width: 40 }
            ];

        const selectColumns = columns.map(c => c.key).slice(1).join(', ');

        const [results] = await connection.execute(
            `SELECT ROW_NUMBER() OVER (ORDER BY created_at) AS id, ${selectColumns}
             FROM ${table}
             WHERE dflag = 0`
        );

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet(`${label} List`);

        worksheet.columns = columns;

        // ✅ Bulk insert (faster than loop)
        worksheet.addRows(results);

        // ✅ Header styling
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

        // ✅ Align all cells
        worksheet.eachRow(row => {
            row.eachCell(cell => {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
        });

        // ✅ Freeze header + first column (UX)
        worksheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

        // ✅ Unlock all cells first
        worksheet.eachRow(row => {
            row.eachCell(cell => {
                cell.protection = { locked: false };
            });
        });

        // ✅ Lock first column only
        worksheet.getColumn(1).eachCell(cell => {
            cell.protection = { locked: true };
        });

        // ✅ Protect sheet (REQUIRED for locking)
        await worksheet.protect('secure123', {
            selectLockedCells: true,
            selectUnlockedCells: true
        });

        // ✅ Proper headers
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=${label}_list.xlsx`
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.fetchCompanyInfo = async (req, res) => {
    try {
        const [rows] = await connection.execute(
            `SELECT companyName, image, address, email, telNo, mobNo, website, gstNo, cinNo, panNo
            FROM company_details`,
            []
        );

        return handleSuccessResponse(res, 'Company details', rows[0]);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.storeCompanyInfo = async (req, res) => {
    try {
        const { companyName, image, address, email, telNo, mobNo, website, gstNo, cinNo, panNo } = req.body;

        if (!companyName || !address || !email || !telNo || !mobNo || !website || !gstNo || !cinNo || !panNo) {
            throw new CustomError('All fields are required!', 400);
        }

        // Fetch existing company record
        const [companyRows] = await connection.execute(`SELECT id, image FROM company_details LIMIT 1`);
        let imagePath = null;

        if (!companyRows.length) {
            // No record exists — must have image (base64)
            if (!image) {
                throw new CustomError('Image is required for first time entry', 400);
            }

            // Only store if base64
            imagePath = image.startsWith('data:') ? await storeFile(image, 'Company') : image;

            await connection.execute(
                `INSERT INTO company_details 
                (companyName, image, address, email, telNo, mobNo, website, gstNo, cinNo, panNo) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [companyName, imagePath, address, email, telNo, mobNo, website, gstNo, cinNo, panNo]
            );

        } else {
            // Record exists — update
            const companyId = companyRows[0].id;
            const existingImage = companyRows[0].image;

            // Only update image if a new base64 string was sent
            if (image && image.startsWith('data:')) {
                imagePath = await storeFile(image, 'Company');
            } else {
                imagePath = existingImage; // keep old one
            }

            await connection.execute(
                `UPDATE company_details 
                 SET companyName = ?, image = ?, address = ?, email = ?, telNo = ?, mobNo = ?, 
                     website = ?, gstNo = ?, cinNo = ?, panNo = ?
                 WHERE id = ?`,
                [companyName, imagePath, address, email, telNo, mobNo, website, gstNo, cinNo, panNo, companyId]
            );
        }

        return handleSuccessResponse(res, 'Company details saved successfully');
    } catch (err) {
        console.error('Error saving company info:', err);
        return handleErrorResponse(res, err);
    }
};
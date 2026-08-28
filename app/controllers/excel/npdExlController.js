const excel = require('exceljs');
const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../../config/dbSql');
const { fetchItemId } = require('../../utility/utilityFunction');

//Download Template 
exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Part No', 'NPD/MKD', 'CN No', 'File Type', 'Revision No', 'Revision Date', 'File Name']);

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
                return handleErrorResponse(res, new Error('Error generating Excel file'));
            });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.import = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        if (!req.body.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
        const base64Data = req.body.file.replace(base64URL, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const npdData = [];

        // 🔹 Read Excel
        for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
            const row = worksheet.getRow(rowNumber);

            if (rowNumber !== 1) {
                const itm = {
                    rId: rowNumber,
                    itmCode: row.getCell(1).value,
                    type: row.getCell(2).value,
                    cnNo: row.getCell(3).value,
                    fileType: row.getCell(4).value,
                    revNo: row.getCell(5).value,
                    revDate: row.getCell(6).value,
                    fileName: row.getCell(7).value,
                };

                if (
                    itm.itmCode &&
                    itm.type &&
                    itm.cnNo &&
                    itm.fileType &&
                    itm.revNo &&
                    itm.revDate &&
                    itm.fileName
                ) {
                    npdData.push(itm);
                }
            }
        }

        // 🔹 Fetch itemId & fileId
        for (const itm of npdData) {
            itm.itemId = await fetchItemId(itm.itmCode);
            const idInfo = await getId(itm.rId);
            itm.fid = idInfo.fid;
        }

        if (npdData.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid data to insert' });
        }

        // 🔹 Check existing records
        const whereClause = npdData
            .map(() => '(type = ? AND itemId = ? AND fileName = ?)')
            .join(' OR ');

        const params = npdData.flatMap(itm => [
            itm.type,
            itm.itemId,
            itm.fileName
        ]);

        const [existingRows] = await conn.execute(
            `SELECT type, itemId, fileName FROM npd WHERE ${whereClause}`,
            params
        );

        const existingSet = new Set(
            existingRows.map(r => `${r.type}|${r.itemId}|${r.fileName}`)
        );

        // 🔹 Filter new data only
        const filteredData = npdData.filter(
            itm => !existingSet.has(`${itm.type}|${itm.itemId}|${itm.fileName}`)
        );

        if (filteredData.length === 0) {
            await conn.commit();
            return handleSuccessResponse(res, 'All records already exist. No new data inserted.');
        }

        // Bulk Insert
        const insertQuery = `
            INSERT INTO npd
            (type, fileId, itemId, cnNo, fileType, fileName, revisionNo, revDate)
            VALUES ?
        `;

        const values = filteredData.map(itm => [
            itm.type,
            itm.fid,
            itm.itemId,
            itm.cnNo,
            itm.fileType,
            itm.fileName,
            itm.revNo,
            itm.revDate
        ]);

        await conn.query(insertQuery, [values]);
        await conn.commit();

        return handleSuccessResponse(res, `Imported successfully.`);

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


async function getId(rowNumber) {
    try {
        // Fetch the latest fileId and revisionNo from the database
        const [fRows] = await connection.execute('SELECT fileId FROM npd ORDER BY id DESC LIMIT 1');

        // let revNo = 1;
        let fid = 'FID1'; // Default fileId if no records exist

        // If there are existing records in the database
        if (fRows.length > 0) {
            // Extract the latest revisionNo and fileId
            // const latestRevisionNo = parseInt(fRows[0].revisionNo);
            const latestFileId = fRows[0].fileId;

            // Extract the numeric part from the latest fileId
            const numericPart = parseInt(latestFileId.match(/\d+$/)[0]);

            // Increment the fileId based on the last numeric part and the current rowNumber
            fid = `FID${numericPart + rowNumber - 1}`; // Subtract 1 to start from the next available number

            // Increment the revisionNo based on the last revisionNo and the current rowNumber
            // revNo = latestRevisionNo + rowNumber - 1; // Subtract 1 to start from the next available number
        }

        // //console.log(`getId(${rowNumber}) - revisionNo: ${revNo}, fileId: ${fid}`); // Debugging

        return {
            // revNo: revNo,
            fid: fid
        };
    } catch (err) {
        console.error(err);
        throw new Error(err.message);
    }
}

exports.export = async (req, res) => {
    try {

        const { itm, type } = req.query;

        let query = `
            SELECT  npd.id, npd.fileId, npd.itemId, npd.cnNo, npd.fileType, npd.revisionNo, 
            npd.file, npd.type, npd.revDate,
            itm.itemCode AS item	
            FROM npd   
            INNER JOIN items as itm ON npd.itemId = itm.id
            WHERE npd.dflag = 0`;

        const params = [];


        if (itm && type) {
            query += ` AND npd.itemId = ? AND npd.type = ?`;
            params.push(itm, type);

        } else if (itm) {
            query += ` AND npd.itemId = ?`;
            params.push(itm);

        } else if (type) {
            query += ` AND npd.type = ?`;
            params.push(type);

        }

        const [rows] = await connection.execute(query, params);

        //Auto Index value
        rows.forEach((element, index) => {
            element.sNo = index + 1;
        });

        const customHeaders = ['Sl.No', 'Part No', 'CN No', 'File Type', 'Revision', 'Revision Date'];
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('NPD-MKD Report');

        const headerRow = worksheet.addRow(customHeaders);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };

        const columnSize = 17;
        worksheet.columns.forEach((column) => {
            column.width = columnSize;
        });

        rows.forEach(row => {
            const customValues = [
                row.sNo,
                row.item,
                row.cnNo,
                row.fileType,
                row.revisionNo,
                row.revDate

            ];
            worksheet.addRow(customValues);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Supplier_Items.xlsx');

        workbook.xlsx.write(res)
            .then(() => {
                res.status(200).end();
            })
            .catch(error => {
                console.error('Error generating Excel file:', error);
                return handleErrorResponse(res, new Error('Error generating Excel file'));
            });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

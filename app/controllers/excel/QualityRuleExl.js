const excel = require('exceljs');
const { connection, CustomError } = require('../../config/dbSql');
const { collection: masterCollection } = require('../../utility/master');
const { collection: itemCollection } = require('../../utility/itemMaster');

 
exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Inspection Type', 'Item Group', 'Display Name', 'Inspection Plan',  'Inspection Level']);

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

exports.import = async (req, res) => {
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

        for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
            const row = worksheet.getRow(rowNumber);
            if (rowNumber !== 1) { // Skip header row
                const itm = {
                    type: row.getCell(1).value,
                    itemGroupId: row.getCell(2).value,
                    displayName: row.getCell(3).value,
                    inspectionPlan: row.getCell(4).value,
                    inspectionLevel: row.getCell(5).value
                };
                // Check for null cell values
                if(itm.type && itm.itemGroupId && itm.displayName && itm.inspectionPlan && itm.inspectionLevel) {
                    npdData.push(itm);
                }
            }
        }

        for (const itm of npdData) {
            // Check if itemId already exists
            itm.itemGroupId = await fetchId('itemGroup', itm.itemGroupId);
            itm.displayName = await fetchId('displayName', itm.displayName);

        }
        
        try {
            if (npdData.length === 0) {
                return res.status(400).json({ success: false, message: 'No valid data to insert' });
            }

            // const insertQuery = `
            // INSERT INTO qc_rule  (type, itemGroupId, displayName, inspectionPlan, inspectionLevel)  
            // VALUES (?, ?, ?, ?, ?)`;
            // const values = npdData.map(itm => [itm.type, itm.itemGroupId, itm.displayName, itm.inspectionPlan, itm.inspectionLevel]);

            // await connection.query(insertQuery, [values]);
            const insertQuery = `
                INSERT INTO qc_rule (type, itemGroupId, displayName, inspectionPlan, inspectionLevel)
                VALUES ${npdData.map(() => '(?, ?, ?, ?, ?)').join(', ')}`;

            const values = npdData.flatMap(itm => [
                itm.type,
                itm.itemGroupId,
                itm.displayName,
                itm.inspectionPlan,
                itm.inspectionLevel
            ]);

            await connection.query(insertQuery, values);

            return res.status(200).json({ success: true, message: 'Successfully Imported' });

        } catch (insertError) {
            return res.status(400).json({ success: false, message: insertError.message });
        }
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
};

async function fetchId(master, value) {
    try {
        if (!value || value == 'NULL' || value == '-' || value == '' || value == '0' || value == '#N/A') {
            return null;
        }

        const masterInfo = masterCollection[master] || itemCollection[master];
        if (!masterInfo) {
            throw new Error(`Invalid master: ${master}`);
        }

        const { tbName, mstLable } = masterInfo;
        if (!tbName || !mstLable) {
            throw new Error(`Invalid master info for: ${master}`);
        }

        const [rows, fields] = await connection.execute(`SELECT id FROM ${tbName} WHERE name = ?`, [value]);

        if (rows.length > 0) {
            return rows[0].id;
        }

        throw new Error(`Invalid ${mstLable} : ${value}`);
    } catch (error) {
        console.error(`Error fetching ${master}: ${error.message}`);
        throw error;
    }
}

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

        // const { itm, type} = req.query;

        let query = `
          SELECT 
            qc_rule.*, ig.code As itemGroup, ig.id As itemGroupId,
            d.code As displayName, d.id As displayNameId
            FROM qc_rule
            INNER JOIN mst_item_group ig ON ig.id = qc_rule.itemGroupId
            INNER JOIN mst_display_name d ON d.id = qc_rule.displayName`;

       

        const [rows] = await connection.execute(query, []);

        //Auto Index value
        rows.forEach((element, index) => {
            element.sNo = index + 1;
        });

        const customHeaders = ['SL No','Inspection Type', 'Item Group', 'Display Name', 'Inspection Plan',  'Inspection Level'];
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('NPD-MKD Report');

        const headerRow = worksheet.addRow(customHeaders);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };

        const columnSize = 20;
        worksheet.columns.forEach((column) => {
            column.width = columnSize;
        });

        rows.forEach(row => {
            const customValues = [
                row.sNo,
                row.type,
                row.itemGroup,
                row.displayName,
                row.inspectionPlan,
                row.inspectionLevel
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
                res.status(500).json({ success: false, message: 'Error generating Excel file' });
            });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};

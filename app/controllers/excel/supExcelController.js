const excel = require('exceljs');
const { connection, CustomError } = require('../../config/dbSql');
const { collection } = require('../../utility/master');


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
        const sup = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                const sp = {
                    rowNo: rowNumber,
                    spCode: row.getCell(1).value,
                    gstNo: row.getCell(2).value,
                    spName: row.getCell(3).value,
                    tallyAlias: row.getCell(4).value,
                    spGroup: row.getCell(5).value,
                    spAdd1: row.getCell(6).value,
                    spAdd2: row.getCell(7).value,
                    spAdd3: row.getCell(8).value,
                    spAdd4: row.getCell(9).value,
                    inactiveStatus: row.getCell(10).value,
                    partyNotes: row.getCell(11).value,
                    city: row.getCell(12).value,
                    pincode: row.getCell(13).value,
                    state: row.getCell(14).value,
                    country: row.getCell(15).value,
                    email: row.getCell(16).text,
                    currency: row.getCell(17).text,
                    contactPerson: row.getCell(18).value,
                    phone: row.getCell(19).value,
                    attention: row.getCell(20).value,
                    spType: row.getCell(21).value,
                    paymentTerms: row.getCell(22).value,
                    panNo: row.getCell(23).value,
                    spPlace: row.getCell(24).value,
                    stateCode: row.getCell(25).value,
                    distance: row.getCell(26).value,
                    shipPinCode: row.getCell(27).value,
                    toStateCode : row.getCell(28).value,
                    actToState: row.getCell(29).value,

                };
                sup.push(sp);
            }
        });

        // Duplicate check and processing each supplier
        for (const sp of sup) {
            // Check for duplicate spCode
            const [existingRow] = await connection.query('SELECT * FROM supplier WHERE spCode = ? AND dflag = 0', [sp.spCode]);
            if (existingRow.length > 0) {
                return res.status(400).json({ success: false, message: `Duplicate found for spCode: ${sp.spCode}` });
            }

            // Assign additional values
            sp.sId = await uniqueId(sp.rowNo);
            sp.spGroup = await fetchId('supplierGroup', sp.spGroup);
            sp.currency = await fetchId('currency', sp.currency);
            sp.inactiveStatus = sp.inactiveStatus === 'Y' ? 1 : 0;
        }


        const insertQuery = `
            INSERT INTO supplier (
                sId, spCode, gstNo, spName, tallyAlias, spGroup, spAdd1, spAdd2, spAdd3, spAdd4, inactiveStatus, partyNotes, 
                city, pincode, state, country, email, currency, contactPerson, phoneNo, attention, spType, paymentTerms, panNo,
                spPlace, stateCode, distance, shippingPinCode, toStateCode, actToState, dflag
            ) VALUES ?
            ON DUPLICATE KEY UPDATE 
                gstNo = VALUES(gstNo),
                spName = VALUES(spName),
                tallyAlias = VALUES(tallyAlias),
                spGroup = VALUES(spGroup),
                spAdd1 = VALUES(spAdd1),
                spAdd2 = VALUES(spAdd2),
                spAdd3 = VALUES(spAdd3),
                spAdd4 = VALUES(spAdd4),
                inactiveStatus = VALUES(inactiveStatus),
                partyNotes = VALUES(partyNotes),
                city = VALUES(city),
                pincode = VALUES(pincode),
                state = VALUES(state),
                country = VALUES(country),
                email = VALUES(email),
                currency = VALUES(currency),
                contactPerson = VALUES(contactPerson),
                phoneNo = VALUES(phoneNo),
                attention = VALUES(attention),
                spType = VALUES(spType),
                paymentTerms = VALUES(paymentTerms),
                panNo = VALUES(panNo),
                spPlace = VALUES(spPlace),
                stateCode = VALUES(stateCode),
                distance = VALUES(distance),
                shippingPinCode = VALUES(shippingPinCode),
                toStateCode = VALUES(toStateCode),
                actToState = VALUES(actToState),
                dflag = VALUES(dflag);  
        `;

        // Prepare the values array from the supplier objects
        const values = sup.map(sp => [
            sp.sId, sp.spCode, sp.gstNo, sp.spName, sp.tallyAlias, sp.spGroup, sp.spAdd1, sp.spAdd2, sp.spAdd3, sp.spAdd4, sp.inactiveStatus, 
            sp.partyNotes, sp.city, sp.pincode, sp.state, sp.country, sp.email, sp.currency, sp.contactPerson, sp.phone, sp.attention, sp.spType,
            sp.paymentTerms, sp.panNo, sp.spPlace, sp.stateCode, sp.distance, sp.shipPinCode,  sp.toStateCode, sp.actToState, 0 // dflag value added
        ]);

        // Insert or update the supplier data
        await connection.query(insertQuery, [values]);

        return res.status(200).json({ success: true, message: 'Successfully imported' });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


async function fetchId(master, value) {
    try {
        const table = collection[master]?.tbName || null;
        const colName = collection[master]?.colName || null;
        const lable = collection[master]?.mstLable || null;
        const [rows, fields] = await connection.execute(`SELECT * FROM ${table} WHERE ${colName} = ?`, [value]);

        if (rows.length > 0) {
            return rows[0].id;
        }
        // //console.log(table, value)
        throw new Error('Invalid ' + lable + " : " + value);

    } catch (error) {
        throw error;
    }
}


async function uniqueId(rowNumber) {
    try {
        const [rows, fields] = await connection.execute(`SELECT * FROM supplier ORDER BY id DESC LIMIT 1`, []);

        if (rows.length > 0) {
            const sId = rows[0].sId || 'SUP-0';

            // Extract the numeric part and increment by 1
            const len = parseInt(sId.split('-')[1]);
            const increment = len + rowNumber - 1;
            const newStr = 'SUP-' + increment;

            return newStr;
        }
        return 'SUP-' + rowNumber;

    } catch (error) {
        console.error(`Error fetching latest supplier: ${error.message}`);
        throw error;
    }
}



exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Supplier Code', 'GST Number', 'Supplier Name', 'Tally Alias', 'Supplier Group', 
            'Supplier Add1', 'Supplier Add2','Supplier Add3','Supplier Add4','Inactive Status', 'Party Notes', 'City', 
            'Pincode', 'State', 'Country', 'Email', 'Currency',  'Contact Person', 'Phone No', 'Attention', 'Supplier Type', 'Payment Terms', 'Pan No',
            'Place of Supply',  'State Code', 'Distance', 'Shipping PinCode', 'To StateCode', 'Actual To State' 
        ]);

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



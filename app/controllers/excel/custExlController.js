const { connection, CustomError, handleSuccessResponse, handleErrorResponse } = require('../../config/dbSql');
const excel = require('exceljs');
const { collection: masterCollection } = require('../../utility/master');
const { collection: itemCollection } = require('../../utility/itemMaster');
const { decodeBase64 } = require('../../utility/utilityFunction');

exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        const headerRow = worksheet.addRow(['Customer Code', 'GST No', 'Customer Name', 'Tally Alias', 'Customer Group', 'Cust Address1', 'Cust Address2', 'Cust Address3', 'Cust Address4', 'In Active', 
            'City', 'Pincode', 'State', 'Country', 'Party Notes', 'Currency', 'Pan No', 'GSTIn / Uin Id', 'bi_phoneNo', 'BILL Fax No', 'Email', 'Pay Term', 'No Tax Remark', 'Credit day', 'Place of Supply',
            'TCS Collected', 'Surcharges on TCS', 'Cess on TCS', 'Single Sales Order', 'DC Value', 'Short close', 'CGST', 'SGST', 'IGST', 'UTGST', 'DC Info Required in', 'Max Line Items In'
        ]);

        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = Customer.xlsx');

        workbook.xlsx.write(res)
            .then(() => {
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

async function fetchId(master, value, errorMessages) {
    try {
        const masterInfo = masterCollection[master] || itemCollection[master];
        if (!masterInfo) {
            errorMessages.push(`Invalid master: ${master}`);
            return null;
        }

        const { tbName, mstLable, colName } = masterInfo;
        if (!tbName || !mstLable) {
            errorMessages.push(`Invalid master info for: ${master}`);
            return null;
        }

        const [rows] = await connection.execute(`SELECT id FROM ${tbName} WHERE ${colName} = ?`, [value]);

        if (rows.length > 0) {
            return rows[0].id;
        }

        errorMessages.push(`Invalid ${mstLable} : ${value}`);
        return null;
    } catch (error) {
        errorMessages.push(error.message);
        return null;
    }
}

function convertNull(value) {
    return (value === 'NULL' || value == '') ? null : value;
}

function convertValue(rowValue) {
    const value = rowValue.toUpperCase();
    return value == 'Y' ? 'Y' : 'N';
}

async function processRow(row, rowNumber) {
    let errorMessages = [];
    let customer = { id: rowNumber, rowNo: rowNumber, errorMessages: errorMessages };

    try {
        const cCode = convertNull(row.getCell(1).text);
        customer = {
            ...customer,
            cCode: cCode,
            gstNo: convertNull(row.getCell(2).text),
            cName: convertNull(row.getCell(3).text),
            tallyAlias: convertNull(row.getCell(4).text),
            cGroup: await fetchId('customerGroup', convertNull(row.getCell(5).text), errorMessages),
            cGroupName: row.getCell(5).text,
            cAddress1: convertNull(row.getCell(6).text),
            cAddress2: convertNull(row.getCell(7).text),
            cAddress3: convertNull(row.getCell(8).text),
            cAddress4: convertNull(row.getCell(9).text),
            inactiveStatus: convertValue(row.getCell(10).text), 
            city: convertNull(row.getCell(11).text),      
            pincode: convertNull(row.getCell(12).text),  
            state: convertNull(row.getCell(13).text),     
            country: convertNull(row.getCell(14).text),   
            partyNotes: convertNull(row.getCell(15).text),
            currency: await fetchId('currency', convertNull(row.getCell(16).text), errorMessages),
            currencyName: row.getCell(16).text,
            panNo: convertNull(row.getCell(17).text),
            gstInUinId: convertNull(row.getCell(18).text),
            bi_phoneNo: convertNull(row.getCell(19).text),
            bi_faxNo: convertNull(row.getCell(20).text),
            email: convertNull(row.getCell(21).text),
            payTerm: convertNull(row.getCell(22).text),
            noTaxRemark: convertNull(row.getCell(23).text),
            creditday: convertNull(row.getCell(24).text),
            placeOfSupply: await fetchId('placeOfSupply', convertNull(row.getCell(25).text), errorMessages),
            placeOfSupplyName: row.getCell(25).text,
            tcsCollected: convertNull(row.getCell(26).text),
            SubcharOnTcs: convertNull(row.getCell(27).text),
            CessOnTcs: convertNull(row.getCell(28).text),
            singleSaleOrd: convertNull(row.getCell(29).text),
            dcValue: convertNull(row.getCell(30).text),
            shortClose: convertNull(row.getCell(31).text),
            cgst: convertNull(row.getCell(32).text),
            sgst: convertNull(row.getCell(33).text),
            igst: convertNull(row.getCell(34).text),
            utgst: convertNull(row.getCell(35).text),
            dcInfoReq: convertNull(row.getCell(36).text),
            maxLineItem: convertNull(row.getCell(37).text),
            errorMessages: errorMessages.join(', ')
        };
        return customer;
    } catch (error) {
        errorMessages.push(error.message);
        return { ...customer, errorMessages: errorMessages.join(', ') };
    }
}
exports.import = async (req, res) => {
    try {
        const buffer = await decodeBase64(req.body.file);

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const rowsPromises = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) {
                rowsPromises.push(processRow(row, rowNumber));
            }
        });
        const customers = await Promise.all(rowsPromises);

        return handleSuccessResponse(res, 'Customers imported successfully', customers);
    } catch (err) {
        return handleErrorResponse(res, 'Internal server error');
    }
};


function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

exports.storeBulk = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const { customers } = req.body;

        if (customers.length > 0) {
            const insertQuery = `
                INSERT INTO customer (
                    cCode, gstNo, cName, tallyAlias, cGroup, cAddress1, cAddress2, cAddress3, cAddress4, inactiveStatus, city, pincode, state, country, partyNotes, currency, panNo, 
                    gstInUinId, bi_phoneNo, bi_faxNo, email, payTerm, noTaxRemark, creditday, placeOfSupply, tcsCollected, SubcharOnTcs, CessOnTcs, singleSaleOrd, dcValue, shortClose, 
                    cgst, sgst, igst, utgst, dcInfoReq, maxLineItem
                ) VALUES ?
                ON DUPLICATE KEY UPDATE
                    gstNo = VALUES(gstNo),
                    cName = VALUES(cName),
                    tallyAlias = VALUES(tallyAlias),
                    cGroup = VALUES(cGroup),
                    cAddress1 = VALUES(cAddress1),
                    cAddress2 = VALUES(cAddress2),
                    cAddress3 = VALUES(cAddress3),
                    cAddress4 = VALUES(cAddress4),
                    inactiveStatus = VALUES(inactiveStatus),
                    city = VALUES(city),
                    pincode = VALUES(pincode),
                    state = VALUES(state),
                    country = VALUES(country),
                    partyNotes = VALUES(partyNotes),
                    currency = VALUES(currency),
                    panNo = VALUES(panNo),
                    gstInUinId = VALUES(gstInUinId),
                    bi_phoneNo = VALUES(bi_phoneNo),
                    bi_faxNo = VALUES(bi_faxNo),
                    email = VALUES(email),
                    payTerm = VALUES(payTerm),
                    noTaxRemark = VALUES(noTaxRemark),
                    creditday = VALUES(creditday),
                    placeOfSupply = VALUES(placeOfSupply),
                    tcsCollected = VALUES(tcsCollected),
                    SubcharOnTcs = VALUES(SubcharOnTcs),
                    CessOnTcs = VALUES(CessOnTcs),
                    singleSaleOrd = VALUES(singleSaleOrd),
                    dcValue = VALUES(dcValue),
                    shortClose = VALUES(shortClose),
                    cgst = VALUES(cgst),
                    sgst = VALUES(sgst),
                    igst = VALUES(igst),
                    utgst = VALUES(utgst),
                    dcInfoReq = VALUES(dcInfoReq),
                    maxLineItem = VALUES(maxLineItem)
            `;

            const values = customers.map(c => [
                c.cCode, c.gstNo, c.cName, c.tallyAlias, c.cGroup, c.cAddress1, c.cAddress2, c.cAddress3, c.cAddress4, c.inactiveStatus, c.city, c.pincode, 
                c.state, c.country, c.partyNotes, c.currency, c.panNo, c.gstInUinId, c.bi_phoneNo, c.bi_faxNo, c.email, c.payTerm, c.noTaxRemark, c.creditday, c.placeOfSupply, 
                c.tcsCollected, c.SubcharOnTcs, c.CessOnTcs, c.singleSaleOrd, c.dcValue, c.shortClose, c.cgst, c.sgst, c.igst, c.utgst, c.dcInfoReq, c.maxLineItem
            ]);

            const chunkSize = 1000;
            const chunks = chunkArray(values, chunkSize);

            for (const chunk of chunks) {
                await conn.query(insertQuery, [chunk]);
            }

            const custCodes = customers.map(c => c.cCode);
            await conn.execute(`UPDATE customer SET cId = id WHERE cCode IN (${custCodes.map(() => '?').join(', ')})`, custCodes);
        }
        await conn.commit();
        return handleSuccessResponse(res, 'Customers imported successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

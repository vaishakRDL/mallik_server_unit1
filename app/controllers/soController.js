const { handleErrorResponse, connection, handleSuccessResponse, CustomError } = require("../config/dbSql");
const { sendEmail } = require("../config/emailService");
const { decodeBase64, formatDate, currentDateTime, getDocNo, getUser, updateCounter } = require("../utility/utilityFunction");
const excel = require('exceljs');

exports.template = async (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('SO Template', { properties: { tabColor: { argb: 'FFC0000' } } });

        const headerRow = worksheet.addRow(['PO #', 'Line Number', 'Item Number', 'Quantity Ordered', 'Request Date', ' Promised Delivery', 'Unit Cost', 'Extended Cost', 'Cost Rule', 'Description', 'Branch/ Plant']);

        headerRow.font = { bold: true, size: 13 };
        headerRow.alignment = { horizontal: 'center' };

        worksheet.columns.forEach((column) => {
            column.width = 22;
        });

        const buffer = await workbook.xlsx.writeBuffer();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=SO_Template.xlsx');

        res.send(buffer);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

const formatExcelDate = async (input) => {
    // Try to parse the input as a number first
    let serialNumber = parseInt(input);

    // If parsing as a number succeeds and input is not NaN, treat it as a serial number
    if (!isNaN(serialNumber)) {
        let baseDate = new Date(1899, 11, 30);

        // Adjust for Excel leap year bug if serial number is greater than 59
        if (serialNumber > 59) {
            serialNumber -= 1;
        }
        let resultDate = new Date(baseDate.getTime() + serialNumber * 24 * 60 * 60 * 1000); // Add the serial number as days to the base date
        let formattedDate = resultDate.toISOString().split('T')[0]; // Format the result date to (YYYY-MM-DD)

        return await formatDate(formattedDate);
    }

    // If the input is not a serial number, treat it as a date string
    let resultDate = new Date(input);

    if (isNaN(resultDate.getTime())) {  // Check if the parsed date is valid
        throw new Error('Invalid date format');
    }
    let formattedDate = resultDate.toISOString().split('T')[0]; // Format the result date(YYYY-MM-DD)

    return await formatDate(formattedDate);
};

const excelData = async (file) => {
    const buffer = await decodeBase64(file);
    const workbook = new excel.Workbook();

    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(1);

    const workbookName = file.name || 'SO Template';
    const worksheetName = worksheet.name;
    const poNo = worksheet.getCell(2, 1).value;

    const products = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
            const itemNo = row.getCell(3).text;
            const ordQty = row.getCell(4).text;
            const reqDate = row.getCell(5).text;
            const proDel = row.getCell(6).text;
            const unitCost = row.getCell(7).text;
            const extCost = row.getCell(8).text;
            const costRule = row.getCell(9).text;
            const desc = row.getCell(10).text;
            const branch = row.getCell(11).text;

            products.push({ id: rowNumber - 1, itemNo, orderedQty: ordQty, reqDate, proDel, unitCost, extCost, costRule, desc, branch });
        }
    });

    return { workbookName, poNo, products };
}

const fetchItemRate = async (items, fim) => {
    try {
        // Get packing rate once per FIM
        const [fimRows] = await connection.execute(`SELECT packingCharge FROM item_fim_id WHERE name = ?`, [fim]);
        const packingRate = (fimRows.length > 0 && fimRows[0].packingCharge != 0) ? fimRows[0].packingCharge : 0;

        let noOfPacking = 1;
        const promises = items.map(async (item, index) => {
            const { partNo, Qty } = item;

            const [rows] = await connection.execute(`
                SELECT items.id as itemId, items.itemName, items.delLotQty, mst_uom.name as uom, COALESCE(pcn.basicRate, 0) as basePrice
                FROM items
                LEFT JOIN mst_uom ON mst_uom.id = items.uom
                LEFT JOIN pcn ON pcn.id = (
                    SELECT pcn2.id
                    FROM pcn pcn2
                    WHERE pcn2.itemCode = items.itemCode
                    ORDER BY pcn2.id DESC
                    LIMIT 1
                )
                WHERE items.itemCode = ?
            `, [partNo]);

            if (rows.length > 0) {
                const { itemId, itemName, uom, basePrice, delLotQty } = rows[0];

                let packLot = 1;
                if (Number(Qty) > Number(delLotQty) && Number(delLotQty)) {
                    packLot = Math.max(Math.ceil(Number(Qty) / Number(delLotQty)) - 1, 1);
                    noOfPacking += packLot;
                }
                const itemPackingCharge = parseFloat(packingRate) * packLot;
                const totalRate = basePrice === 0 ? 0 : parseFloat(basePrice) * parseFloat(Qty);
                const colorStatus = basePrice == 0 ? '#f07979ea' : '#84ed84ff';

                item.id = index + 1;
                item.itemId = itemId;
                item.itemName = itemName;
                item.uom = uom;
                item.basicRate = Number(basePrice).toFixed(2);
                item.finalRate = Number(totalRate).toFixed(2);
                item.colorStatus = colorStatus;
                item.itemPackingCharge = itemPackingCharge;
            }
        });

        await Promise.all(promises);

        // Sum up packing charges from all items
        const totalPackingCharge = noOfPacking * packingRate;
        const finalRate = items.reduce((acc, item) => acc + Number(item.finalRate || 0), 0);
        const totCharge = Number(totalPackingCharge + finalRate).toFixed(2);

        const packingDetails = {
            packingRate,
            noOfPacking,
            packingCharge: totalPackingCharge,
            totCharge
        };

        return { items, finalRate: totCharge, packingDetails };
    } catch (err) {
        throw err;
    }
};


exports.compareRates = async (req, res) => {
    try {
        const { file } = req.body;
        const { workbookName, poNo, products: data } = await excelData(file);

        const dataPromises = data.map(async (item) => {
            const { itemNo, orderedQty, reqDate, proDel, unitCost, extCost, costRule, desc, branch } = item;

            const match = /-.*FIM/.test(itemNo);
            let sobRows = [], fim = '';
            if (match) {
                const [contractNo, fimStr] = itemNo.split('-');
                fim = fimStr.trim();
                [sobRows] = await connection.execute(`SELECT partNo, Qty FROM sob WHERE contractNo = ? AND fimNo = ?`, [contractNo, fim]);
            } else {
                sobRows = [{ partNo: itemNo, Qty: orderedQty }];
            }
            const { items, finalRate, packingDetails } = await fetchItemRate(sobRows, fim);
            const difference = parseFloat(unitCost) - finalRate;

            item.requestedDate = await formatExcelDate(reqDate);
            item.promisedDate = await formatExcelDate(proDel);
            item.extendedDate = null;
            item.description = desc;
            item.arrivedCost = Number(finalRate).toFixed(2);
            item.difference = Number(difference).toFixed(2);
            item.status = (difference >= -1 && difference <= 1) ? 'Verified' : 'Mismatch';
            item.colorStatus = (difference >= -1 && difference <= 1) ? '#84ed84ff' : '#f07979ea';
            item.child = items;
            item.packingDetails = packingDetails
        });

        await Promise.all(dataPromises);

        const statusCounts = data.reduce((acc, item) => {
            acc[item.status] = (acc[item.status] || 0) + 1;
            return acc;
        }, {});

        return res.status(200).json({
            success: true,
            message: 'Cost Verified successfully',
            poNo: poNo,
            verifiedCount: statusCounts.Verified ? statusCounts.Verified : 0,
            notVerifiedCount: statusCounts.notVerified ? statusCounts.notVerified : 0,
            mismatchCount: statusCounts.Mismatch ? statusCounts.Mismatch : 0,
            data: data
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const dateFormat = (dateString) => {
    const [day, month, year] = dateString.split('-');
    return `${year}-${month}-${day}`;
}

exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { pricePONO: poNo, verifiedCount, notVerifiedCount, mismatchCount, data } = req.body;

        if (!Array.isArray(data) || data.length === 0) {
            throw new CustomError('Please select Parts!', 400);
        }
        const [poRows] = await conn.execute(`SELECT id FROM price_verification WHERE poNo = ?`, [poNo]);

        if (poRows.length) {
            throw new CustomError(`PO already added!`);
        }

        const soNo = await getDocNo('So');
        const currentDate = await currentDateTime();
        const verifiedUser = await getUser(req);

        const [rows] = await conn.execute(`
            INSERT INTO price_verification (soNo, poNo, verCount, notVerCount, mismatchCount, verifiedBy, verifiedDate) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [soNo, poNo, verifiedCount, notVerifiedCount, mismatchCount, verifiedUser, currentDate]);

        if (rows.affectedRows > 0) {
            const pvMstId = rows.insertId;

            // Format data for bulk insert
            const insertValues = data.map(item => {
                const { itemNo, orderedQty, requestedDate, promisedDate, unitCost, extCost, arrivedCost, difference, child, packingDetails, costRule, description, branch, status } = item;
                const childJson = JSON.stringify(child);
                const packingJson = JSON.stringify(packingDetails);
                const rDate = dateFormat(requestedDate);
                const pDate = dateFormat(promisedDate);

                return [pvMstId, itemNo, orderedQty, rDate, pDate, unitCost, extCost, arrivedCost, difference, childJson, packingJson, costRule, description, branch, status];
            });

            const valuesPlaceholder = data.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(', ');
            const flattenedValues = insertValues.flat();

            await conn.execute(`
                INSERT INTO price_verification_details 
                (pvMstId, itemNo, orderedQty, requestedDate, promisedDate, unitCost, extCost, arrivedCost, difference, child, packingDetails, costRule, description, branch, status) 
                VALUES ${valuesPlaceholder}
            `, flattenedValues);

            await conn.commit();

            await updateCounter('So');
            const currentDate = await formatDate(await currentDateTime());

            return handleSuccessResponse(res, 'Document Saved Successfully', { id: pvMstId, date: currentDate });
        }

        throw new CustomError('Something went wrong!', 500);
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.verifiedPo = async (req, res) => {
    try {
        const { q } = req.query;

        let fetchQuery = `
            SELECT id, poNo, 
                   CASE WHEN authorized = 1 THEN 'Y' ELSE 'N' END AS authorized
            FROM price_verification
        `;
        let values = [];

        if (q) {
            fetchQuery += ` WHERE poNo LIKE ?`;
            values.push(`%${q}%`);
        }
        const [rows] = await connection.execute(fetchQuery, values);

        return handleSuccessResponse(res, 'Po lists', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


const costVerificationData = async (poId, poNo) => {
    try {
        const [rows] = await connection.execute(`
            SELECT ROW_NUMBER() OVER (ORDER BY id) AS slNo, itemNo, orderedQty, unitCost 
            FROM price_verification_details WHERE pvMstId = ?`,
            [poId]
        );

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        const borderStyle = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };

        worksheet.mergeCells(`A1:D1`);
        const companyHeader = worksheet.getCell('A1');
        companyHeader.value = 'MALLIK ENGINEERING';
        companyHeader.font = { bold: true, size: 14 };
        companyHeader.alignment = { horizontal: 'center' };
        companyHeader.border = borderStyle; // Apply border

        worksheet.mergeCells(`A2:D2`);
        const poHeader = worksheet.getCell('A2');
        poHeader.value = `Costing Sheet - PO No: ${poNo}`;
        poHeader.font = { bold: true, size: 13 };
        poHeader.alignment = { horizontal: 'center' };
        poHeader.border = borderStyle; // Apply border

        worksheet.addRow([]);

        const headerRow = worksheet.addRow(['Sl No', 'Part No', 'Qty', 'Unit Price']);
        headerRow.font = { bold: true, size: 12 };
        headerRow.alignment = { horizontal: 'center' };

        worksheet.columns = [
            { header: 'Sl No', key: 'slNo', width: 10 },
            { header: 'Part No', key: 'itemNo', width: 20 },
            { header: 'Qty', key: 'orderedQty', width: 15 },
            { header: 'Unit Price', key: 'unitCost', width: 15 }
        ];

        headerRow.eachCell(cell => {
            cell.border = borderStyle;
        });

        rows.forEach(row => {
            const dataRow = worksheet.addRow([row.slNo, row.itemNo, row.orderedQty, row.unitCost]);
            dataRow.eachCell(cell => {
                cell.border = borderStyle;
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        return buffer;
    } catch (err) {
        throw err;
    }
};

exports.authorize = async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) {
            throw new CustomError(`Invalid request: ID is required`, 400);
        }

        const [pcnRows] = await connection.execute(
            `SELECT id, poNo FROM price_verification WHERE id = ?`,
            [id]
        );

        if (!pcnRows.length) {
            throw new CustomError(`PO not found!`, 404);
        }
        const type = 'Costing';
        const { poNo } = pcnRows[0];

        await connection.execute(
            `UPDATE price_verification SET authorized = ? WHERE id = ?`,
            [1, id]
        );

        // Email Content
        const subject = `Costing For Customer PO[${poNo}] Approved Notification`;
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
            </head>
            <body>
                <p>
                    Dear Sir/Madam,<br><br>
                    Please find herewith attached Customer PO No: <strong>${poNo}</strong>,<br>
                    Kindly verify the part number and unit price.<br>
                    I request you to create part numbers that are not available in our software.<br><br>
                    <strong>Note:</strong> This is an auto-generated email.<br><br>
                    Regards,<br>
                    MANJUNATH N<br>
                    MALLIK ENGINEERING (INDIA) PVT. LTD.
                </p>
            </body>
            </html>
        `;

        // Generate Attachment
        const attachmentBuffer = await costVerificationData(id, poNo);
        const attachment = [{
            filename: `${poNo}.xlsx`,
            content: attachmentBuffer
        }];

        const recipients = process.env.COSTING_RECIPIENTS ?? '';
        const ccRecipients = process.env.COSTING_CC ?? '';

        // Send Email
        // await sendEmail(recipients, subject, ccRecipients, htmlContent, null, attachment);
        await sendEmail({
            to: recipients,
            subject,
            cc: ccRecipients,
            htmlContent,
            text: null,
            attachments: attachment,
            type
        });

        return handleSuccessResponse(res, 'PO approved successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.priceVerificationDetails = async (req, res) => {
    try {
        const { id } = req.query;

        const [pvRows] = await connection.execute(
            `SELECT id, poNo, verCount as verifiedCount, notVerCount as notVerifiedCount, mismatchCount, verifiedDate as date
             FROM price_verification WHERE id = ?`,
            [id]
        );

        const [pvDetails] = await connection.execute(
            `SELECT * FROM price_verification_details WHERE pvMstId = ?`,
            [id]
        );

        const resData = pvDetails.map(({
            id, itemNo, orderedQty, requestedDate, promisedDate, unitCost, extCost,
            arrivedCost, difference, child, packingDetails, costRule, description, branch, status
        }) => ({
            id, itemNo, orderedQty,
            reqDate: requestedDate,
            proDel: promisedDate,
            unitCost, extCost, arrivedCost, difference,
            child: JSON.parse(child),
            packingDetails: JSON.parse(packingDetails),
            costRule, description, branch, status
        }));

        return res.status(200).json({
            success: true,
            message: "Price Verification Details",
            ...pvRows[0],
            data: resData
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


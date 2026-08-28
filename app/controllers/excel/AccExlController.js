const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../../config/dbSql');
const excel = require('exceljs');
const { decodeBase64 } = require('../../utility/utilityFunction');
const { parse, format } = require('date-fns'); // Import parse and format functions


exports.gstTemplate = async (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item Code', 'Qty', 'PoNo']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.font = { size: 13 };
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = Po Generation.xlsx');

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





exports.gstImport = async (req, res) => {
    try {
        const { customerId, file } = req.body;
        const buffer = await decodeBase64(file);
        const workbook = new excel.Workbook();

        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        const items = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                items.push({
                    itemCode: row.getCell(1).value,
                    qty: row.getCell(2).value,
                    poNo: row.getCell(3).value
                });
            }
        });

        const itemCodes = items.map(item => `'${item.itemCode}'`).join(',');
        const poNos = items.map(item => `'${item.poNo}'`).join(',');

        const fetch = `
            SELECT 
                i.id, cVsI.hsnCode, i.totStk, il.name AS itemLedger,
                po.sino, po.sodigit AS soNo, po.poNo, 
                poi.PartNo AS itemCode, poi.PartName AS itemName,
                poi.UOM AS uom, poi.purchase_order_id AS poId, poi.id AS poItemId,
                poi.Qty, poi.pendQty, poi.invQty, poi.Rate AS stdRate, poi.cumQty,
                poi.Rate * poi.invQty AS amt,
                poi.SchDate AS schDate
            FROM 
                purchase_order po
            INNER JOIN 
                purchas_Order_item poi ON poi.purchase_order_id = po.id
            INNER JOIN 
                items i ON i.itemCode = poi.PartNo
            INNER JOIN 
                cust_vs_item AS cVsI ON cVsI.itemId = i.id 
            LEFT JOIN 
                item_under_ledger il ON il.id = i.underLedger
            WHERE 
                poi.pendQty > 0
                AND cVsI.customerId = ? 
                AND i.itemCode IN (${itemCodes}) 
                AND po.poNo IN (${poNos})
        `;

        const [rows] = await connection.execute(fetch, [customerId]);

        const result = [];
        const missingItemCodes = [];

        // Map rows by itemCode for faster lookup
        const rowMap = new Map(rows.map(row => [String(row.itemCode), row]));

        items.forEach(item => {
            const matchingRow = rowMap.get(String(item.itemCode));

            if (matchingRow) {
                let formattedSchDate = null;

                if (matchingRow.schDate && matchingRow.schDate.toString().trim() !== '') {
                    // //console.log(`Processing schDate for itemCode: ${matchingRow.itemCode}`);

                    try {
                        if (matchingRow.schDate instanceof Date) {
                            formattedSchDate = format(matchingRow.schDate, 'yyyy-MM-dd');
                        } else if (!isNaN(matchingRow.schDate)) {
                            const parsedDate = new Date(Date.UTC(0, 0, matchingRow.schDate - 1));
                            formattedSchDate = format(parsedDate, 'yyyy-MM-dd');
                        } else if (typeof matchingRow.schDate === 'string') {
                            const parsedDate = parse(matchingRow.schDate, 'd/M/yyyy', new Date());
                            formattedSchDate = format(parsedDate, 'yyyy-MM-dd');
                        } else {
                            throw new Error(`Unrecognized date format: ${matchingRow.schDate}`);
                        }

                        matchingRow.schDate = formattedSchDate;
                    } catch (err) {
                        missingItemCodes.push(`Invalid date format for schDate in itemCode ${matchingRow.itemCode}`);
                        return;
                    }
                }

                result.push({
                    ...matchingRow,
                    schDate: formattedSchDate,
                });
            } else {
                missingItemCodes.push(String(item.itemCode));
            }
        });

        return handleSuccessResponse(res,
            missingItemCodes.length > 0
                ? `Not linked Items: ${missingItemCodes.join(', ')}`
                : 'All items processed successfully',
            result
        );

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


//***********************************************************************  PERFOMA INVOICE   ********************************************************************************************************//

exports.perfomaTemp = async (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Item Code', 'Qty']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.font = { size: 13 };
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = PerfomaInvoice.xlsx');

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



exports.perfomaImport = async (req, res) => {
    try {
        const { customerId, file } = req.body;
        const buffer = await decodeBase64(file);
        const workbook = new excel.Workbook();

        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        const items = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                items.push({
                    itemCode: row.getCell(1).value,
                    qty: row.getCell(2).value,
                });
            }
        });

        const itemCodes = items.map(item => `'${item.itemCode}'`).join(',');

        const fetch = `
            SELECT
                i.id, i.id as itemId, i.itemCode, i.itemName, hsn.name AS hsnCode, cvi.uom, 
                cvi.rate
            FROM 
                items i
            INNER JOIN 
                cust_vs_item cvi ON i.id = cvi.itemId    
            LEFT JOIN 
                item_hsn_code hsn ON i.hsnCode = hsn.id    
            WHERE 
            cvi.customerId = ? AND i.itemCode IN (${itemCodes}) 
            `;

        const [rows] = await connection.execute(fetch, [customerId]);

        const result = [];
        const missingItemCodes = [];

        // Map rows by itemCode for faster lookup
        const rowMap = new Map(rows.map(row => [String(row.itemCode), row]));

        items.forEach(item => {
            const matchingRow = rowMap.get(String(item.itemCode));

            if (matchingRow) {
                if (matchingRow.schDate && matchingRow.schDate.toString().trim() !== '') {
                    // //console.log(`Processing schDate for itemCode: ${matchingRow.itemCode}`);
                }

                result.push({
                    ...matchingRow,
                    qty: item.qty, // Ensure qty is added properly
                    amt: item.qty * matchingRow.rate // Calculate amt as qty * rate
                });
            } else {
                missingItemCodes.push({
                    itemCode: item.itemCode,
                    qty: item.qty
                });
            }
        });

        return res.status(200).json({
            success: true,
            message: missingItemCodes.length > 0 ? `Not linked Items: ${missingItemCodes.map(i => i.itemCode).join(', ')}` : 'All items processed successfully',
            result,
            missingItems: missingItemCodes
        })
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



exports.exportInv = async (req, res) => {
    try {
        const id = req.params.id;

        const query = `
      SELECT 
        po.id,  po.invNo, DATE_FORMAT(po.date, '%d-%m-%Y') AS poDate,
        c.cName, c.cCode, c.id AS CustomerId, i.itemCode, i.itemName, 
        poi.uom, poi.hsnCode, poi.qty, poi.rate, poi.amt
      FROM 
        perfoma_invoice po
      INNER JOIN perfoma_invoice_dtl poi ON po.id = poi.performaId
      INNER JOIN customer c ON c.cId = po.custId
      INNER JOIN items i ON i.id = poi.itemId

      WHERE po.id = ?`;

        const [rows] = await connection.execute(query, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "No data found" });
        }

        rows.forEach((row, index) => {
            row.slNo = index + 1;
        });

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Po OrderList Report');

        // Define headers
        const customHeaders = [
            'Invoice No', 'Invoice Date', 'Customer Code', 'Part No', 'Part Name', 'HSN Code', 'UOM', 'Rate', 'Qty', 'Amt'
        ];

        // Add headers with bold font
        const headerRow = worksheet.addRow(customHeaders);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };

        // Column widths
        worksheet.columns = customHeaders.map(() => ({ width: 17 }));

        // Merge cells for repeating values
        const mergeColumns = [1, 2, 3, 12, 13, 14, 15, 16,]; // Columns for poNo, poDate, etc.

        let startRow = 2; // Data starts from row 2
        const rowCount = rows.length + 1; // Number of rows including header

        rows.forEach((row, index) => {
            const customValues = [
                row.invNo, row.poDate, row.cCode, row.itemCode, row.itemName, row.uom, row.hsnCode, row.qty, row.rate, row.amt
            ];

            worksheet.addRow(customValues);
        });

        // Merging repeated values for poNo, poDate, etc.
        mergeColumns.forEach((col) => {
            worksheet.mergeCells(startRow, col, rowCount, col);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Purchase_Order_Report.xlsx');

        workbook.xlsx.write(res)
            .then(() => res.status(200).end())
            .catch(error => {
                console.error('Error generating Excel file:', error);
                res.status(500).json({ success: false, message: 'Error generating Excel file' });
            });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};


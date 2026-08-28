const excel = require('exceljs');
const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../../config/dbSql');
const { decodeBase64 } = require('../../utility/utilityFunction');
const BASE_URL = `http://${process.env.APP_HOST}:${process.env.APP_PORT}`;


//Download Template for  itempm_vs_inspec
exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Type', 'Item code', 'Process', 'Quality Parameter', 'Inspection Type', 'Expected Value', 'Min Tolerance', 'Max Tolerance', 'UOM', 'Evalution Method', 'Expected Visual Inspection']);

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
    try {
        if (!req.body.file) {
            throw new CustomError('No file uploaded', 400);
        }

        const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
        const base64Data = req.body.file.replace(base64URL, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const rowsData = []; // Array to store all row data

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                rowsData.push({ rowNumber, row }); // Store row data for processing
            }
        });

        // Process rows for fetching IDs, deleting, and inserting
        const supVsPm = await Promise.all(rowsData.map(async ({ row, rowNumber }) => {
            // Fetch IDs for itmCode and pm
            const type = row.getCell(1).value;
            const itmCodeId = await fetchId('items', row.getCell(2).text);
            const pmId = await fetchId('pmMst', row.getCell(3).text);


            // If IDs are not found, throw an error
            if (type !== 'Assembly' && type !== 'Production' && type !== 'Inward') {
                throw new Error(`Type is not mentioned in row ${rowNumber}`);
            }
            if (!itmCodeId) {
                throw new Error(`Item Code not found in row ${rowNumber}`);
            }
            if (!pmId) {
                throw new Error(`Process not found in row ${rowNumber}`);
            }

            // Delete matching rows from the table
            await connection.execute(
                'DELETE FROM itempm_vs_inspec WHERE type = ? AND item = ? AND process = ?',
                [type, itmCodeId, pmId]
            );

            // Prepare data for insertion
            const sup = {
                rowNo: rowNumber,
                type: type,
                itmCode: itmCodeId,
                pm: pmId,
                qltP: row.getCell(4).value,
                inspecType: row.getCell(5).value,
                expVal: row.getCell(6).value,
                minTol: row.getCell(7).value,
                maxTol: row.getCell(8).value,
                uom: await fetchId('uomMst', row.getCell(9).text),
                evalMethod: row.getCell(10).value,
                qcFieldId: await fetchId('qc_field', row.getCell(4).text, type, row.getCell(3).text, row.getCell(10).value),
                inspectionId: await fetchId('inspections', row.getCell(10).text),
                expVisInspec: row.getCell(11).value,
            };

            // Validate the fetched data
            if (sup.qcFieldId === null) {
                throw new Error(`${sup.qltP} Quality Parameter not found in row ${rowNumber}, please ensure it's in QcField list`);
            }
            if (sup.evalMethod === null) {
                throw new Error(`Evaluation Method not found in row ${rowNumber}`);
            }
            if (sup.inspectionId === null) {
                throw new Error(`${sup.evalMethod} Evaluation Method not found in row ${rowNumber}, please ensure it's in instrument list`);
            }

            return sup;
        }));

        // Insert rows into the database
        const user = req.headers.username;

        for (const sp of supVsPm) {
            await connection.execute(
                `INSERT INTO itempm_vs_inspec (type, item, uom, process, qcFieldId, inspectionId, inspectionType, qltyParameter, expVal, minTolerance, maxTolerance, 
                expVisInspec, evalMethod, addedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [sp.type, sp.itmCode, sp.uom, sp.pm, sp.qcFieldId, sp.inspectionId, sp.inspecType, sp.qltP, sp.expVal, sp.minTol, sp.maxTol, sp.expVisInspec, sp.evalMethod, user]
            );
        }

        return handleSuccessResponse(res, 'Successfully imported');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};




async function fetchId(master, value, type, pmValue = null, inspecVal = null) {
    try {
        const collection = {
            items: {
                mstLabel: 'Item Code',
                tbName: 'items',
                colName: 'itemCode',
            },
            uomMst: {
                mstLabel: 'Uom Name',
                tbName: 'mst_uom',
                colName: 'name',
            },
            pmMst: {
                mstLabel: 'Process Name',
                tbName: 'mst_pm',
                colName: 'name',
            },
            qc_field: {
                mstLabel: 'qc_field',
                tbName: 'qc_field',
                colName: 'label',
            },
            inspections: {
                mstLabel: 'Inspection',
                tbName: 'mst_qlty_inspections',
                colName: 'inspectionType',
            }
        };

        const { tbName, colName } = collection[master];

        let fetchQuery;
        let params;

        if (master === 'qc_field') {
            // Query for `qc_field` with additional `pm.name` and `type` checks
            fetchQuery = `
                SELECT qc.id 
                FROM qc_field qc
                JOIN mst_pm pm ON qc.processId = pm.id
                JOIN mst_qlty_inspections inspec ON qc.inspectionType = inspec.id
                JOIN qlty_template qt ON qc.tempId = qt.id
                WHERE qc.${colName} = ? 
                  AND qt.type = ? 
                  AND pm.name = ?
                  AND inspec.inspectionType = ?`;
            params = [value, type, pmValue, inspecVal];
        } else {
            // Generic query for other cases
            fetchQuery = `
                SELECT id 
                FROM ${tbName} 
                WHERE ${colName} = ?`;
            params = [value];
        }

        const [results] = await connection.execute(fetchQuery, params);
        return results.length > 0 ? results[0].id : null;
    } catch (error) {
        throw error;
    }
}



//Download Template For CopyTo CopyFrom
exports.copyTemplate = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Type', 'CopyTo Item', 'CopyFrom Item']);

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



// Import Copy Function
exports.copy = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const buffer = await decodeBase64(req.body.file);
        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);  // Assuming worksheet 1 is the one you're working with
        const items = [];
        const missing = [];  // Array to collect missing entries

        // Adjusted to correctly fetch rows starting from row 2
        await Promise.all(worksheet.getRows(2, worksheet.rowCount - 1).map(async (row) => {
            const type = row.getCell(1).value;
            const copyToString = row.getCell(2).value;
            const copyFromString = row.getCell(3).value;

            // Get the IDs for copyTo and copyFrom from the 'items' table
            const cItem = await fetchId('items', copyToString);
            const eItem = await fetchId('items', copyFromString);

            if (cItem && eItem) {  // Check if both cItem and eItem are not null
                // //console.log('ItemCode: ', eItem);
                const existingItemDetails = await fetchItemDetails(conn, cItem, eItem, type);

                if (existingItemDetails) {
                    items.push(...existingItemDetails);
                } else {
                    // Add to missing array instead of sending a response immediately
                    missing.push({
                        type: type,
                        copyTo: copyToString,
                        copyFrom: copyFromString,
                        message: `Existing details not found for ItemCode: ${copyFromString}`
                    });
                }
            } else {
                // Handle case where cItem or eItem is null
                missing.push({
                    type: type,
                    copyTo: copyToString,
                    copyFrom: copyFromString,
                    message: `Item not found for ${!cItem ? copyToString : copyFromString}`
                });
            }
        }));

        // //console.log('items len', items.length);

        if (items.length > 0) {
            await insertItems(conn, items);
            await conn.commit();
            return res.status(200).json({
                success: true,
                message: 'Items duplicated successfully',
                missing
            })
        } else {
            await conn.rollback();
            throw new CustomError('No items to duplicate', 400);
        }

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

//Used in Copy Function
async function fetchItemDetails(conn, cItem, item, type) {
    try {

        await conn.query('DELETE FROM itempm_vs_inspec WHERE type = ? AND item = ?', [type, cItem]);
        const [rows] = await conn.execute(`SELECT * FROM itempm_vs_inspec WHERE type = ? AND item = ? `, [type, item]);

        if (rows.length === 0) return;

        rows.forEach(element => {
            element.item = cItem;
        })

        return rows;

    } catch (error) {
        throw error;
    }
}


// Used in Copy Function
async function insertItems(conn, items) {
    try {

        for (const sp of items) {

            // perform an insert
            await conn.query(
                `INSERT INTO itempm_vs_inspec (type, item, uom, process, qcFieldId, inspectionId, qltyParameter, 
                evalMethod)  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [sp.type, sp.item, sp.uom, sp.process, sp.qcFieldId, sp.inspectionId, sp.qltyParameter, sp.evalMethod]
            );

        }

    } catch (error) {
        throw error;
    }
}

/////////////////////////////////////////       Export Functions       /////////////////////////////////////////

function applyHeaderStyles(worksheet, type) {
    // Style for the main header (first row)
    worksheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }; // Center alignment
    worksheet.getCell('A1').font = { bold: true, size: 17 }; // Font settings
    worksheet.getRow(1).height = 30; // Set the height of the row to 30 units

    // Styles for the sub headers (second, third, and fourth rows)
    ['A2', 'A3', 'A4'].forEach(cell => {
        worksheet.getCell(cell).alignment = { horizontal: 'left' };
        worksheet.getCell(cell).font = { bold: true, size: 11 };
    });

    // Base cells to style
    let cellsToStyle = ['A5', 'E5', 'E2', 'E3', 'E4', 'I2', 'D3', 'F3', 'I3', 'D4', 'F4', 'I4', 'A6', 'B6', 'D6', 'F6', 'G6', 'H6', 'I6', 'J6', 'L6'];

    // Conditionally add K4 if type is not "assembly"
    if (type !== 'assembly') {
        cellsToStyle.push('K4');
    }

    // Apply styles to the determined cells
    cellsToStyle.forEach(cell => {
        worksheet.getCell(cell).alignment = { horizontal: 'left' };
        worksheet.getCell(cell).font = { bold: true, size: 11 };
    });

    // Merge cells for headers
    worksheet.mergeCells('A1', 'M1');

    worksheet.mergeCells('A2:B2');
    worksheet.mergeCells('C2:D2');
    worksheet.mergeCells('E2:F2');
    worksheet.mergeCells('G2:H2');
    worksheet.mergeCells('I2:J2');
    worksheet.mergeCells('K2:M2');

    worksheet.mergeCells('A3:B3');
    worksheet.mergeCells('C3:D3');
    worksheet.mergeCells('E3:F3');
    worksheet.mergeCells('G3:H3');
    worksheet.mergeCells('I3:J3');
    worksheet.mergeCells('K3:M3');

    worksheet.mergeCells('A4:B4');
    worksheet.mergeCells('C4:D4');
    worksheet.mergeCells('E4:F4');
    worksheet.mergeCells('G4:H4');

    worksheet.mergeCells('A5:B5');
    worksheet.mergeCells('C5:D5');
    worksheet.mergeCells('E5:F5');
    worksheet.mergeCells('G5:H5');

    if (type == "assembly") {
        worksheet.mergeCells('I4:J4');
        worksheet.mergeCells('K4:M4');

    } else {
        worksheet.mergeCells('I4');
        worksheet.mergeCells('K4');
        worksheet.mergeCells('L4:M4');
    }


    worksheet.mergeCells('B6:C6');
    worksheet.mergeCells('D6:E6');
    worksheet.mergeCells('J6:K6');
    worksheet.mergeCells('L6:M6');

    // Set column widths
    worksheet.getColumn(1).width = 8; // Set column A width
    worksheet.getColumn(5).width = 6; // Set column E width
    worksheet.getColumn(6).width = 14; // Set column F width
    worksheet.getColumn(7).width = 14; // Set column G width
    worksheet.getColumn(9).width = 10; // Set column I width
    worksheet.getColumn(13).width = 4.25; // Set column M width

}

// Function to apply borders to the worksheet
function applyBordersToWorksheet(worksheet) {
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
    });
}

// Production Export Function
exports.export = async (req, res) => {
    try {
        const id = req.query.id;
        // const BASE_URL = process.env.APP_HOST_URL?.trim() || "http://localhost:8000";

        // -------------------- FETCH MAIN DATA --------------------
        const sqlQuery = `
            SELECT DISTINCT
                pmi.pmInnspecType, pmi.date, pmi.customer, pmi.totQlty,
                pmi.shift, pmi.rejRewQty, pmi.remarks, pmi.addedBy,
                mach.machineCode, mst_pm.name AS operation,
                jC.jcNo, jC.Qty, itm.itemCode, itm.itemName,
                DATE_FORMAT(pmi.created_at, '%d-%m-%Y') AS formattedDate,
                pmi.status
            FROM pm_inspeclist pmi
            INNER JOIN machines mach ON mach.id = pmi.machineId
            INNER JOIN mst_pm ON mst_pm.id = pmi.processId
            INNER JOIN items itm ON itm.id = pmi.itemId 
            INNER JOIN job_card jC ON jC.id = pmi.jcId
            WHERE pmi.qTestNo = ?`;

        const [rows] = await connection.execute(sqlQuery, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: "Record not found" });
        }

        const mainData = rows[0];

        // -------------------- FETCH LOGO --------------------
        const [companyData] = await connection.execute(`SELECT image FROM company_details LIMIT 1`);
        let logoBuffer = null;

        if (companyData.length && companyData[0].image) {
            const imageUrl = `${BASE_URL}/${companyData[0].image.replace(/\\/g, "/")}`;
            const axios = require("axios");
            const resImg = await axios.get(imageUrl, { responseType: "arraybuffer" });
            logoBuffer = Buffer.from(resImg.data, "binary");
        }

        // -------------------- FETCH PARAMETERS --------------------
        const subQuery = `
            SELECT pmi.qltyParameter, pmi.expVal, pmi.maxTolerance, pmi.minTolerance,
                   pmi.visual, pmi.evalutionMethod, pmi.actualResult, mst_uom.code AS uom
            FROM pm_inspeclist pmi
            LEFT JOIN mst_uom ON mst_uom.id = pmi.uomId
            WHERE pmi.qTestNo = ?`;

        const [subRows] = await connection.execute(subQuery, [id]);

        // -------------------- EXCEL INIT --------------------
        const Excel = require("exceljs");
        const workbook = new Excel.Workbook();
        const sheet = workbook.addWorksheet("Sheet 1", {
            views: [{ showGridLines: false }] // Hides default gridlines for a cleaner look
        });

        // COMMON STYLES
        const bold = { bold: true };
        const center = { horizontal: "center", vertical: "middle" };
        const borderAllThin = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };

        // Helper function to draw an outer thick border (box) around a specific range
        const applyOuterBorder = (sheet, startRow, startCol, endRow, endCol) => {
            for (let r = startRow; r <= endRow; r++) {
                for (let c = startCol; c <= endCol; c++) {
                    const cell = sheet.getCell(r, c);
                    // Maintain existing internal borders
                    const border = cell.border ? { ...cell.border } : {
                        top: { style: 'thin' }, left: { style: 'thin' },
                        bottom: { style: 'thin' }, right: { style: 'thin' }
                    };

                    if (r === startRow) border.top = { style: 'medium' };
                    if (r === endRow) border.bottom = { style: 'medium' };
                    if (c === startCol) border.left = { style: 'medium' };
                    if (c === endCol) border.right = { style: 'medium' };

                    cell.border = border;
                }
            }
        };

        // -------------------- HEADER ROW (LOGO + TITLE) --------------------
        sheet.addRow([]);
        sheet.getRow(1).height = 70;

        if (logoBuffer) {
            const logoId = workbook.addImage({
                buffer: logoBuffer,
                extension: "png"
            });
            sheet.addImage(logoId, {
                tl: { col: 0.15, row: 0.15 },
                ext: { width: 110, height: 80 }
            });
        }

        sheet.mergeCells("B1:N1");
        sheet.getCell("B1").value = "PROCESS INSPECTION REPORT";
        sheet.getCell("B1").font = { size: 22, bold: true, color: { argb: "FF000000" } };
        sheet.getCell("B1").alignment = center;

        // -------------------- MAIN INFO ROWS --------------------
        const infoStartRow = sheet.lastRow.number + 1;

        function addInfoRow(label1, val1, label2, val2, label3, val3, label4, val4 = "") {
            const row = sheet.addRow([label1, "", val1, "", label2, "", val2, "", label3, "", val3, "", label4, val4]);
            row.font = { size: 11 };
            row.height = 20;

            // Align labels to the left and values to the center/left
            for (let i = 1; i <= 14; i++) {
                row.getCell(i).alignment = { vertical: 'middle', horizontal: 'left' };
                row.getCell(i).border = borderAllThin;
            }

            row.getCell(1).font = bold;
            row.getCell(5).font = bold;
            row.getCell(9).font = bold;
            row.getCell(13).font = bold;

            sheet.mergeCells(`A${row.number}:B${row.number}`);
            sheet.mergeCells(`C${row.number}:D${row.number}`);
            sheet.mergeCells(`E${row.number}:F${row.number}`);
            sheet.mergeCells(`G${row.number}:H${row.number}`);
            sheet.mergeCells(`I${row.number}:J${row.number}`);
            sheet.mergeCells(`K${row.number}:L${row.number}`);

            // FIX: Removed the M:N merge so that Column 13 (label) and Column 14 (value) show properly
            // sheet.mergeCells(`M${row.number}:N${row.number}`); 
        }

        addInfoRow("Customer:", mainData.customer, "Machine:", mainData.machineCode, "Date:", mainData.formattedDate, "", "");
        addInfoRow("Part Number:", mainData.itemCode, "Operation:", mainData.operation, "Shift:", mainData.shift, "", "");
        addInfoRow("Inspection Type:", mainData.pmInnspecType, "Job Card No:", mainData.jcNo, "Batch Qty:", mainData.totQlty, "User:", mainData.addedBy);

        if (mainData.status !== "approved") {
            addInfoRow("Rej/Rew Qty:", mainData.rejRewQty, "Remarks:", mainData.remarks, "", "", "", "");
        }

        // Add some breathing space
        sheet.addRow([]);

        // -------------------- TABLE HEADER --------------------
        const tableStartRow = sheet.lastRow.number + 1;
        const header = sheet.addRow([
            "Sl No", "Parameters", "", "Expected Value", "", "Max Tol", "Min Tol",
            "UOM", "Visual", "", "Evaluation Method", "", "Actual Result", ""
        ]);

        // FIX: Removed white font color and background fill to keep it standard
        header.font = { bold: true, size: 11 };
        header.alignment = center;
        header.height = 25;

        for (let i = 1; i <= 14; i++) {
            header.getCell(i).border = borderAllThin;
        }

        sheet.mergeCells(`B${header.number}:C${header.number}`);
        sheet.mergeCells(`D${header.number}:E${header.number}`);
        sheet.mergeCells(`I${header.number}:J${header.number}`);
        sheet.mergeCells(`K${header.number}:L${header.number}`);
        sheet.mergeCells(`M${header.number}:N${header.number}`);

        // -------------------- TABLE BODY (Dynamic Rows) --------------------
        subRows.forEach((s, i) => {
            const row = sheet.addRow([
                i + 1,
                s.qltyParameter, "",
                s.expVal, "",
                s.maxTolerance,
                s.minTolerance,
                s.uom,
                s.visual, "",
                s.evalutionMethod, "",
                s.actualResult, ""
            ]);

            row.alignment = center;
            row.height = 20;

            sheet.mergeCells(`B${row.number}:C${row.number}`);
            sheet.mergeCells(`D${row.number}:E${row.number}`);
            sheet.mergeCells(`I${row.number}:J${row.number}`);
            sheet.mergeCells(`K${row.number}:L${row.number}`);
            sheet.mergeCells(`M${row.number}:N${row.number}`);

            for (let c = 1; c <= 14; c++) {
                row.getCell(c).border = borderAllThin;
            }
        });

        const tableEndRow = sheet.lastRow.number;

        // -------------------- APPLY THICK BORDERS (BOXES) --------------------
        // Box around the Title Row
        applyOuterBorder(sheet, 1, 1, 1, 14);

        // Box around Information Section
        applyOuterBorder(sheet, infoStartRow, 1, infoStartRow + (mainData.status !== "approved" ? 3 : 2), 14);

        // Box around Table Data (Header + Dynamic Rows)
        if (tableEndRow >= tableStartRow) {
            applyOuterBorder(sheet, tableStartRow, 1, tableEndRow, 14);
        }

        // -------------------- COLUMN WIDTH SETUP --------------------
        sheet.columns = [
            { width: 8 },   // A: Sl No
            { width: 19 },  // B: Parameters
            { width: 19 },  // C: Parameters merged
            { width: 12 },  // D: Expected
            { width: 12 },  // E: Expected merged
            { width: 10 },  // F: Max Tol
            { width: 10 },  // G: Min Tol
            { width: 10 },  // H: UOM
            { width: 10 },  // I: Visual
            { width: 10 },  // J: Visual merged
            { width: 15 },  // K: Eval Method
            { width: 15 },  // L: Eval Method merged
            { width: 15 },  // M: Actual
            { width: 10 },  // N: Actual merged
        ];

        // -------------------- FOOTER --------------------
        // sheet.addRow([]);
        // const footerRowIndex = sheet.lastRow.number + 1; 

        // sheet.addRow(["Format No - IMS-ME-QA-F-125, REV '01'  DATED 22.05.2024"]);
        // sheet.mergeCells(`A${footerRowIndex}:N${footerRowIndex}`);

        // const footerCell = sheet.getCell(`A${footerRowIndex}`);
        // footerCell.font = { size: 10, bold: true, italic: true, color: { argb: "FF595959" } };
        // footerCell.alignment = { horizontal: "right", vertical: "middle" };

        // -------------------- FOOTER --------------------
        sheet.addRow([]);
        const footerRowIndex = sheet.lastRow.number + 1;

        sheet.addRow(["Format No - IMS-ME-QA-F-125, REV '01'  DATED 22.05.2024"]);
        sheet.mergeCells(`A${footerRowIndex}:N${footerRowIndex}`);

        const footerCell = sheet.getCell(`A${footerRowIndex}`);

        // UPDATED: Made font size bigger (14) and bold, removed italics/grey color for better visibility
        footerCell.font = {
            size: 12,
            bold: true
        };

        footerCell.alignment = {
            horizontal: "right",
            vertical: "middle"
        };

        // Add a bit of height to the footer row so the larger text fits perfectly
        sheet.getRow(footerRowIndex).height = 25;
        // -------------------- EXPORT FILE --------------------
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=Production_Inspection.xlsx");

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Export Error:", err);
        return handleErrorResponse(res, err);
    }
};

// Production Export Function
exports.assemblyExport = async (req, res) => {
    try {
        const id = req.params.id;
        const axios = require("axios");
        const excel = require("exceljs");

        // const BASE_URL = process.env.APP_HOST_URL?.trim() || "http://localhost:8000";

        // -------------------- MAIN QUERY --------------------
        const sqlQuery = `
            SELECT 
                qcMst.*, mach.machineCode, mst_pm.name as operation, 
                itm.itemCode, itm.itemName,
                DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as formattedDate
            FROM 
                assembly_qlty_inspeclist_mst qcMst
                INNER JOIN machines mach ON mach.id = qcMst.machineId
                INNER JOIN mst_pm ON mst_pm.id = qcMst.processId
                INNER JOIN items itm ON itm.id = qcMst.itemId 
            WHERE qcMst.id = ?`;

        const [rows] = await connection.execute(sqlQuery, [id]);
        if (!rows || rows.length === 0)
            return res.status(404).json({ message: "Record not found" });

        const mainData = rows[0];

        // -------------------- FETCH LOGO --------------------
        const [companyData] = await connection.execute(
            `SELECT image FROM company_details LIMIT 1`
        );

        let logoBuffer = null;
        if (companyData.length && companyData[0].image) {
            try {
                const imgURL = `${BASE_URL}/${companyData[0].image.replace(/\\/g, "/")}`;
                const imgRes = await axios.get(imgURL, { responseType: "arraybuffer" });
                logoBuffer = Buffer.from(imgRes.data, "binary");
            } catch (e) {
                console.log("Logo load failed:", e.message);
            }
        }

        // -------------------- FETCH PARAMETERS --------------------
        const subQuery = `
            SELECT 
                qcInspec.*, mst_uom.code as uom
            FROM 
                assembly_qlty_inspeclist qcInspec
            LEFT JOIN mst_uom ON mst_uom.id = qcInspec.uomId
            WHERE qcInspec.mstId = ?`;

        const [subRows] = await connection.execute(subQuery, [id]);

        // -------------------- EXCEL INIT --------------------
        const workbook = new excel.Workbook();
        const sheet = workbook.addWorksheet("Sheet 1");

        const bold = { bold: true };
        const center = { horizontal: "center", vertical: "middle" };
        const borderAll = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
        };

        // -------------------- HEADER --------------------
        sheet.addRow([]);
        sheet.getRow(1).height = 50;

        if (logoBuffer) {
            const logoId = workbook.addImage({
                buffer: logoBuffer,
                extension: "png",
            });

            sheet.addImage(logoId, {
                tl: { col: 0.1, row: 0.2 },
                ext: { width: 110, height: 55 },
            });
        }

        sheet.mergeCells("A1:M1");
        sheet.getCell("A1").value = "ASSEMBLY PROCESS INSPECTION REPORT";
        sheet.getCell("A1").font = { size: 24, bold: true };
        sheet.getCell("A1").alignment = center;

        // -------------------- MAIN HEADER INFORMATION --------------------
        function info(label1, v1, label2, v2, label3, v3, label4, v4 = "") {
            const row = sheet.addRow([
                label1, "", v1, "",
                label2, "", v2, "",
                label3, "", v3, "",
                label4, v4
            ]);

            row.getCell(1).font = bold;
            row.getCell(5).font = bold;
            row.getCell(9).font = bold;
            row.getCell(13).font = bold;

            sheet.mergeCells(`A${row.number}:B${row.number}`);
            sheet.mergeCells(`C${row.number}:D${row.number}`);
            sheet.mergeCells(`E${row.number}:F${row.number}`);
            sheet.mergeCells(`G${row.number}:H${row.number}`);
            sheet.mergeCells(`I${row.number}:J${row.number}`);
            sheet.mergeCells(`K${row.number}:M${row.number}`);
            // sheet.mergeCells(`M${row.number}:N${row.number}`);
        }

        info("Customer:", mainData.customer, "Machine:", mainData.machineCode, "Date:", mainData.formattedDate, "");
        info("ContractNo:", mainData.contractNo, "Part Number:", mainData.itemCode, "Operation:", mainData.operation,);
        info("Inspection Type:", mainData.type, "Total Qty:", mainData.totQty, "User:", mainData.addedBy);

        // space row
        // sheet.addRow([]);

        // -------------------- TABLE HEADER --------------------
        const h = sheet.addRow([
            "Sl No", "Parameters", "",
            "Expected Value", "",
            "Max Tol", "Min Tol",
            "Uom", "Visual",
            "Evaluation Method", "",
            "Actual Result"
        ]);

        h.font = bold;
        h.alignment = center;

        sheet.mergeCells(`B${h.number}:C${h.number}`);
        sheet.mergeCells(`D${h.number}:E${h.number}`);
        sheet.mergeCells(`J${h.number}:K${h.number}`);
        sheet.mergeCells(`L${h.number}:M${h.number}`);

        for (let i = 1; i <= 13; i++) h.getCell(i).border = borderAll;

        // -------------------- TABLE BODY --------------------
        let sl = 1;
        for (const r of subRows) {
            const row = sheet.addRow([
                sl++,
                r.qltyParameter, "",
                r.expVal, "",
                r.maxTolerance,
                r.minTolerance,
                r.uom,
                r.visual,
                r.evalutionMethod, "",
                r.actualResult
            ]);

            sheet.mergeCells(`B${row.number}:C${row.number}`);
            sheet.mergeCells(`D${row.number}:E${row.number}`);
            sheet.mergeCells(`J${row.number}:K${row.number}`);
            sheet.mergeCells(`L${row.number}:M${row.number}`);

            for (let c = 1; c <= 13; c++) {
                row.getCell(c).border = borderAll;
                row.getCell(c).alignment = { vertical: "middle", wrapText: true };
            }
        }

        // -------------------- FULL SHEET BORDER --------------------
        const lastRow = sheet.lastRow.number;

        for (let r = 1; r <= lastRow; r++) {
            for (let c = 1; c <= 13; c++) {
                const cell = sheet.getCell(r, c);
                cell.border = borderAll;
            }
        }

        // -------------------- FIXED COLUMN WIDTHS --------------------
        sheet.columns = [
            { width: 10 },
            { width: 25 }, { width: 5 },
            { width: 18 }, { width: 5 },
            { width: 12 }, { width: 12 },
            { width: 12 },
            { width: 15 },
            { width: 20 }, { width: 5 },
            { width: 18 }, { width: 15 }
        ];


        // -------------------- FOOTER --------------------
        const footerRowIndex = sheet.lastRow.number + 2; // leave one empty row

        // Add footer row
        sheet.addRow([]);
        const footerRow = sheet.addRow([
            "Format No - IMS-ME-QA-F-124, REV'01'  DATED 22.05.2024"
        ]);

        // Merge across full width (A to M)
        sheet.mergeCells(`A${footerRowIndex}:M${footerRowIndex}`);

        // Style footer
        const footerCell = sheet.getCell(`A${footerRowIndex}`);
        footerCell.font = {
            size: 12,
            bold: true
        };
        footerCell.alignment = {
            horizontal: "center",
            vertical: "middle"
        };


        // -------------------- EXPORT --------------------
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=Assembly_Inspection.xlsx");

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.log("Excel Export Error:", err);
        return handleErrorResponse(res, err);
    }
};

exports.itemsExport = async (req, res) => {
    try {
        const id = req.params.id;
        const axios = require("axios");
        const excel = require("exceljs");

        // const BASE_URL = process.env.APP_HOST_URL?.trim() || "http://localhost:8000";

        // -------------------- MAIN QUERY --------------------
        const sqlQuery = `
            SELECT 
                qcMst.*, mach.machineCode, mst_pm.name as operation, 
                itm.itemCode, itm.itemName,
                DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as formattedDate
            FROM 
                items_qlty_inspeclist_mst qcMst
                INNER JOIN machines mach ON mach.id = qcMst.machineId
                INNER JOIN mst_pm ON mst_pm.id = qcMst.processId
                INNER JOIN items itm ON itm.id = qcMst.itemId 
            WHERE qcMst.id = ?`;

        const [rows] = await connection.execute(sqlQuery, [id]);

        if (!rows.length)
            return res.status(404).json({ message: "Record not found" });

        const mainData = rows[0];

        // -------------------- FETCH LOGO --------------------
        const [companyData] = await connection.execute("SELECT image FROM company_details LIMIT 1");

        let logoBuffer = null;
        if (companyData.length && companyData[0].image) {
            try {
                const imgURL = `${BASE_URL}/${companyData[0].image.replace(/\\/g, "/")}`;
                const imgRes = await axios.get(imgURL, { responseType: "arraybuffer" });
                logoBuffer = Buffer.from(imgRes.data, "binary");
            } catch (e) {
                console.log("Logo fetch failed:", e.message);
            }
        }

        // -------------------- SUB DETAILS --------------------
        const subQuery = `
            SELECT 
                qcInspec.*, mst_uom.code as uom
            FROM 
                items_qlty_inspeclist qcInspec
                LEFT JOIN mst_uom ON mst_uom.id = qcInspec.uomId
            WHERE qcInspec.mstId = ?`;

        const [subRows] = await connection.execute(subQuery, [id]);

        // -------------------- EXCEL INIT --------------------
        const workbook = new excel.Workbook();
        const sheet = workbook.addWorksheet("Sheet 1");

        const bold = { bold: true };
        const center = { horizontal: "center", vertical: "middle" };
        const borderAll = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" }
        };

        // -------------------- HEADER ROW (LOGO + TITLE) --------------------
        sheet.addRow([]);
        sheet.getRow(1).height = 50;

        if (logoBuffer) {
            const logoId = workbook.addImage({
                buffer: logoBuffer,
                extension: "png"
            });

            sheet.addImage(logoId, {
                tl: { col: 0.1, row: 0.2 },
                ext: { width: 110, height: 55 }
            });
        }

        sheet.mergeCells("A1:M1");
        sheet.getCell("A1").value = "PROCESS INSPECTION REPORT";
        sheet.getCell("A1").font = { size: 24, bold: true };
        sheet.getCell("A1").alignment = center;

        // -------------------- HEADER INFO FUNCTION --------------------
        function info(label1, v1, label2, v2, label3, v3, label4 = "", v4 = "") {
            const row = sheet.addRow([
                label1, "", v1, "",
                label2, "", v2, "",
                label3, "", v3, "",
                label4, v4
            ]);

            row.getCell(1).font = bold;
            row.getCell(5).font = bold;
            row.getCell(9).font = bold;
            row.getCell(13).font = bold;

            sheet.mergeCells(`A${row.number}:B${row.number}`);
            sheet.mergeCells(`C${row.number}:D${row.number}`);
            sheet.mergeCells(`E${row.number}:F${row.number}`);
            sheet.mergeCells(`G${row.number}:H${row.number}`);
            sheet.mergeCells(`I${row.number}:J${row.number}`);
            sheet.mergeCells(`K${row.number}:M${row.number}`);
        }

        // -------------------- HEADER INFORMATION --------------------
        info("Customer:", mainData.customer, "Machine:", mainData.machineCode, "Date:", mainData.formattedDate);
        info("ContractNo:", mainData.contractNo, "Part Number:", mainData.itemCode, "Operation:", mainData.operation);
        info("Inspection Type:", mainData.type, "Total Qty:", mainData.totQty, "User:", mainData.addedBy);

        // -------------------- TABLE HEADER --------------------
        const h = sheet.addRow([
            "Sl No", "Parameters", "",
            "Expected Value", "",
            "Max Tol", "Min Tol",
            "Uom", "Visual",
            "Evaluation Method", "",
            "Actual Result"
        ]);

        h.font = bold;
        h.alignment = center;

        sheet.mergeCells(`B${h.number}:C${h.number}`);
        sheet.mergeCells(`D${h.number}:E${h.number}`);
        sheet.mergeCells(`J${h.number}:K${h.number}`);
        sheet.mergeCells(`L${h.number}:M${h.number}`);

        for (let i = 1; i <= 13; i++) h.getCell(i).border = borderAll;

        // -------------------- TABLE BODY --------------------
        let sl = 1;
        subRows.forEach(r => {
            const row = sheet.addRow([
                sl++,
                r.qltyParameter, "",
                r.expVal, "",
                r.maxTolerance,
                r.minTolerance,
                r.uom,
                r.visual,
                r.evalutionMethod, "",
                r.actualResult
            ]);

            sheet.mergeCells(`B${row.number}:C${row.number}`);
            sheet.mergeCells(`D${row.number}:E${row.number}`);
            sheet.mergeCells(`J${row.number}:K${row.number}`);
            sheet.mergeCells(`L${row.number}:M${row.number}`);

            for (let c = 1; c <= 13; c++) {
                row.getCell(c).border = borderAll;
                row.getCell(c).alignment = { vertical: "middle", wrapText: true };
            }
        });

        // -------------------- FULL SHEET BORDER --------------------
        const last = sheet.lastRow.number;
        for (let r = 1; r <= last; r++) {
            for (let c = 1; c <= 13; c++) {
                sheet.getCell(r, c).border = borderAll;
            }
        }

        // -------------------- FIXED COLUMN WIDTH --------------------
        sheet.columns = [
            { width: 10 },
            { width: 25 }, { width: 5 },
            { width: 18 }, { width: 5 },
            { width: 12 }, { width: 12 },
            { width: 12 },
            { width: 15 },
            { width: 20 }, { width: 5 },
            { width: 18 }, { width: 15 }
        ];


        // -------------------- FOOTER --------------------
        const footerRowIndex = sheet.lastRow.number + 2; // leave one empty row

        // Add footer row
        sheet.addRow([]);
        const footerRow = sheet.addRow([
            "Format No - IMS-ME-QA-F-124, REV'01'  DATED 22.05.2024"
        ]);

        // Merge across full width (A to M)
        sheet.mergeCells(`A${footerRowIndex}:M${footerRowIndex}`);

        // Style footer
        const footerCell = sheet.getCell(`A${footerRowIndex}`);
        footerCell.font = {
            size: 12,
            bold: true
        };
        footerCell.alignment = {
            horizontal: "center",
            vertical: "middle"
        };


        // -------------------- EXPORT --------------------
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=Assembly(FIM)_Inspection.xlsx");

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("ITEM FIM Export Error:", err);
        return handleErrorResponse(res, err);
    }
};

const excel = require('exceljs');
const { dateFormatUpperCase } = require('../../utility/utilityFunction');
const { assemblyPlanning } = require('../planningController');


exports.assemblyExport = async (req, res) => {
    try {
        const { kanbanDate, fim } = req.query;
        const displayKDate = await dateFormatUpperCase(kanbanDate);

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        const { finalResult: assemblyRes, contractList } = await assemblyPlanning(kanbanDate, fim);
        if (assemblyRes.length === 0) {
            return res.status(404).json({ success: false, message: "Assembly planning result is empty" });
        }

        // Sort the assemblyRes array based on the 'itemCode' key
        assemblyRes.sort((a, b) => {
            function sortAlphanumeric(a, b) {
                var aClean = a.toLowerCase().replace(/[^a-z0-9]/g, "");
                var bClean = b.toLowerCase().replace(/[^a-z0-9]/g, "");
                return aClean > bClean ? 1 : (aClean < bClean ? -1 : 0);
            }
            return sortAlphanumeric(a.itemCode, b.itemCode);
        });


        // Setting key names for headers
        const keyMappings = {
            'id': 'Sl No',
            'itemCode': 'Part No',
            'totQty': 'Total Qty',
            'cycleTime': 'Cycle Time',
            'totalCycleTime': 'Total Cycle Time',
        };

        const firstItemKeys = Object.keys(assemblyRes[0]).map(key => {
            const mappedKey = keyMappings[key] || key;
            return mappedKey;
        });

        // Deleting id key from obj
        assemblyRes.forEach(obj => {
            delete obj.id;
        });

        // Adding header rows
        worksheet.addRow(['MALLIK ENGINEERING PRIVATE LTD']);
        worksheet.addRow(['ASSEMBLY SCHEDULE']);
        worksheet.addRow(firstItemKeys);

        // Merging header cells
        const mergeEndColumn = getColumnAlphabet(firstItemKeys.length - 4);
        worksheet.mergeCells('A1:' + mergeEndColumn + '1');
        worksheet.mergeCells('A2:' + mergeEndColumn + '2');

        // Applying styles to headers
        applyHeaderStyles(worksheet);

        // Setting column widths
        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Setting cell values for 'FIM CODE' and 'KANBAN DATE'
        const { fimCell, kanbanCell, fimVal, kanbanVal, contractStartCell, contractEndCell } = setCellReferences(firstItemKeys);

        // Set values to cells
        worksheet.getCell(fimCell).value = 'FIM CODE';
        worksheet.getCell(kanbanCell).value = 'KANBAN DATE';
        worksheet.getCell(fimVal).value = fim;
        worksheet.getCell(kanbanVal).value = displayKDate;

        // Merge contract cells
        worksheet.mergeCells(contractStartCell + ':' + contractEndCell);
        worksheet.getCell(contractStartCell).value = `Total Contracts: ${firstItemKeys.length - 5}`;

        // Setting cell values for additional labels
        worksheet.getCell('B4').value = 'PO No';
        worksheet.getCell('B5').value = 'DUTY';
        worksheet.getCell('B6').value = 'STOP';
        worksheet.getCell('B7').value = 'TYPE';

        // Setting values for "Contract No"
        applyContractDetails(worksheet, contractList);

        // Applying styles to specific cells
        applyCellStyles(worksheet, ['B4', 'B5', 'B6', 'B7', fimCell, kanbanCell, fimVal, kanbanVal]);
        worksheet.getCell(contractStartCell).alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getCell(contractStartCell).font = {  bold: 'lighter', size: 14.5 };

        // Looping through cells in the third row to apply styles and adjust column widths
        applyRowStyles(worksheet, firstItemKeys);

        // Setting row height for the third row
        worksheet.getRow(3).height = 80;

        // Adding assemblyRes data to the worksheet
        addAssemblyResData(worksheet, assemblyRes);

        // Adding Borders
        applyBordersToWorksheet(worksheet);

        // Adding total hours
        addingTotalHrs(worksheet, assemblyRes, firstItemKeys);

        // Setting response headers and writing workbook to response
        setResponseHeadersAndWriteWorkbook(res, workbook);

    } catch (err) {
        //console.log(err)
        return res.status(500).json({ success: false, message: err.message, error: err });
    }
};

// Custom function to generate column alphabet for large column indices
function getColumnAlphabet(columnIndex) {
    let columnAlphabet = '';

    while (columnIndex > 0) {
        let remainder = (columnIndex - 1) % 26;
        columnAlphabet = String.fromCharCode(65 + remainder) + columnAlphabet;
        columnIndex = Math.floor((columnIndex - 1) / 26);
    }

    return columnAlphabet;
}


// Utility function to set cell references
function setCellReferences(firstItemKeys) {
    const columnIndex = firstItemKeys.length;

    const fimCell = getColumnAlphabet(columnIndex - 1) + '1';
    const kanbanCell = getColumnAlphabet(columnIndex - 1) + '2';
    const fimVal = getColumnAlphabet(columnIndex) + '1';
    const kanbanVal = getColumnAlphabet(columnIndex) + '2';

    // Define contract cell references
    const contractStartCell = getColumnAlphabet(columnIndex - 3) + '1';
    const contractEndCell = getColumnAlphabet(columnIndex - 2) + '2';

    return { fimCell, kanbanCell, fimVal, kanbanVal, contractStartCell, contractEndCell };
}



// Extracting only alphabets from the cell address
function extractColumnAlphabet(address) {
    const columnAlphabet = address.match(/[A-Z]+/)[0];
    return columnAlphabet;
}


// Function to apply contract details
function applyContractDetails(worksheet, contractList) {
    worksheet.getRow(3).eachCell({ includeEmpty: true }, cell => {
        const value = cell.value;
        const columnAlphabet = extractColumnAlphabet(cell.address);

        const keyExists = Object.keys(contractList).includes(value);

        if (keyExists) {
            const { poNo, duty, stop, type } = contractList[value];
            const cellPo = worksheet.getCell(columnAlphabet + '4');
            const cellDuty = worksheet.getCell(columnAlphabet + '5');
            const cellStop = worksheet.getCell(columnAlphabet + '6');
            const cellType = worksheet.getCell(columnAlphabet + '7');

            // Applying styles
            cellPo.value = poNo;
            cellPo.alignment = { horizontal: 'center' };
            cellPo.font = { bold: 'lighter', size: 13 };

            cellDuty.value = duty;
            cellDuty.alignment = { horizontal: 'center' };
            cellDuty.font = { bold: 'lighter', size: 13 };

            cellStop.value = stop;
            cellStop.alignment = { horizontal: 'center' };
            cellStop.font = { bold: 'lighter', size: 13 };

            cellType.value = type;
            cellType.alignment = { horizontal: 'center' };
            cellType.font = { bold: 'lighter', size: 13 };
        }
    });
}

// Function to apply header styles
function applyHeaderStyles(worksheet) {
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.getCell('A1').font = { bold: true, size: 16 };

    worksheet.getCell('A2').alignment = { horizontal: 'center' };
    worksheet.getCell('A2').font = { bold: true, size: 16 };
}

// Function to apply cell styles
function applyCellStyles(worksheet, cellRefs) {
    cellRefs.forEach(cellRef => {
        const cell = worksheet.getCell(cellRef);
        cell.alignment = { horizontal: 'center' };
        cell.font = { bold: 'lighter', size: 13 };
    });
}

// Function to apply row styles
function applyRowStyles(worksheet, firstItemKeys) {
    for (let i = 1; i < firstItemKeys.length + 1; i++) {
        const endCell = firstItemKeys.length - 3;
        const col = getColumnAlphabet(i);
        const cell = worksheet.getCell(col + '3');

        if (i >= 3 && i <= endCell) {
            cell.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 };
            cell.font = { bold: 'lighter', size: 14 };
            const column = worksheet.getColumn(i);
            column.width = 12;
        } else {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.font = { bold: 'lighter', size: 14 };
        }
    }
}

// Function to add assembly result data
function addAssemblyResData(worksheet, assemblyRes) {
    let rowIndex = 4;
    let serialNumber = 1; // Initialize the serial number

    assemblyRes.forEach(data => {
        const values = Object.values(data);
        // Prepend the serial number to the values array
        values.unshift(serialNumber);
        worksheet.addRow(values);
        rowIndex++;
        serialNumber++; // Increment the serial number for the next row
    });

    const addedRange = worksheet.getRows(8, 4 + assemblyRes.length - 1);
    addedRange.forEach(row => {
        row.eachCell({ includeEmpty: true }, cell => {
            cell.alignment = { horizontal: 'center' };
            cell.font = { size: 13 };
        });
    });
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


// Utility function to calculate total hours
function calculateTotalHours(assemblyRes) {
    let totalMinutes = 0;
    assemblyRes.forEach(data => {
        totalMinutes += data.totalCycleTime;
    });
    const totalHours = totalMinutes / 60; // Convert total minutes to hours
    return totalHours.toFixed(2);
}


function addingTotalHrs(worksheet, assemblyRes, firstItemKeys) {
    const fixedLen = 8; // Assuming fixed length
    const totalRows = assemblyRes.length + fixedLen; // Total number of rows
    const totalHours = calculateTotalHours(assemblyRes); // Calculate total hours

    // Determine the column alphabet for 'Total Hrs' and its value
    const totalHoursColumn = extractColumnAlphabet(getColumnAlphabet(firstItemKeys.length - 1));
    const totalHoursValueColumn = extractColumnAlphabet(getColumnAlphabet(firstItemKeys.length));

    // Get the cells for 'Total Hrs' label and its value
    const totalHoursCell = worksheet.getCell(totalHoursColumn + totalRows.toString());
    const totalHoursValueCell = worksheet.getCell(totalHoursValueColumn + totalRows.toString());

    // Set the values for 'Total Hrs' label and its value
    totalHoursCell.value = 'Total Hrs';
    totalHoursValueCell.value = totalHours;

    // Apply styles
    totalHoursCell.alignment = { horizontal: 'center' }; // Center alignment
    totalHoursCell.font = { bold: true, size: 13 }; // Bold text and font size

    totalHoursValueCell.alignment = { horizontal: 'center' }; // Center alignment
    totalHoursValueCell.font = { bold: true, size: 13 }; // Bold text and font size
}


// Function to set response headers and write workbook
function setResponseHeadersAndWriteWorkbook(res, workbook) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Assembly-Planning.xlsx');

    workbook.xlsx.write(res)
        .then(() => {
            res.end();
        })
        .catch(err => {
            console.error('Error writing Excel file:', err);
            res.status(500).send('Error generating Excel file');
        });
}
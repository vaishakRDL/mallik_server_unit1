const excel = require('exceljs');

// Constants for colors
const COLORS = {
    BLACK: '333232',
    WHITE: 'FFFFFF',
    SKY_BLUE: 'DFF4FA',
    HEADER_BG: 'e8eaeb',
    HEADER_FONT: '0625bf',
};

exports.applyBordersToWorksheet = (worksheet) => {
    worksheet.eachRow({ includeEmpty: true }, (row) => {
        row.eachCell({ includeEmpty: true }, (cell) => {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' },
            };
        });
    });
}

exports.headerStyle = (worksheet) => {
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Cambria', color: { argb: COLORS.HEADER_FONT }, bold: true, size: 13 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.HEADER_BG } };
    });
}

exports.setRowStyle = (row, isTotalRow, isEvenRow) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
        if (isTotalRow) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.BLACK } };
            cell.font = { color: { argb: COLORS.WHITE }, bold: true };
        } else if (isEvenRow) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.SKY_BLUE } };
        }
    });
}

exports.exportProductionReport = async (res, fileName, headers, result) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet(fileName);

        const longHeaders = new Set(['PartNo', 'PartDesc']);
        // Define columns and their alignment
        worksheet.columns = headers.map((header) => ({
            header,
            key: header,
            width: longHeaders.has(header) ? 35 : 20,
            style: { alignment: { horizontal: 'center' } },
        }));

        // Process rows and apply styles
        result.forEach((row, index) => {
            const rowIndex = index + 2; // Row index starts from 2 (header row is 1)

            const excelRow = worksheet.addRow(row);

            // Determine if it's a total row or an even row
            const isTotalRow = row.Product === 'Total' || row.Kanban === 'Total' || row.ProductFamily === 'Total';
            const isEvenRow = rowIndex % 2 !== 0;

            this.setRowStyle(excelRow, isTotalRow, isEvenRow); // Apply styles based on row type
        });

        this.headerStyle(worksheet); // Style headers
        this.applyBordersToWorksheet(worksheet); // Apply borders to all cells

        // Generate the Excel buffer and send it as a response
        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        throw err;
    }
}


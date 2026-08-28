
const excel = require('exceljs');
const { connection, CustomError } = require('../../config/dbSql');

exports.export = async (req, res) => {
    try {

        const { machineId, category, material, thickness, from, to } = req.query;

        // Construct the SQL query
        let query = `
            SELECT *, ROUND(weightScan, 2) AS weightScanRounded
            FROM scrap_report_view
            WHERE 1=1  
        `; 

        const params = [];

        // Dynamically append conditions
        if (machineId) {
            query += ` AND machineId = ?`;
            params.push(machineId);
        }
        if (category) {
            query += ` AND category = ?`;
            params.push(category);
        }
        if (material) {
            query += ` AND material = ?`;
            params.push(material);
        }
        if (thickness) {
            query += ` AND thickness = ?`;
            params.push(thickness);
        }
        if (from && to) {
            query += ` AND STR_TO_DATE(date, '%d-%m-%Y') BETWEEN STR_TO_DATE(?, '%Y-%m-%d') AND STR_TO_DATE(?, '%Y-%m-%d')`;
            params.push(from, to);
        }

        // Execute the SQL query
        const [rows, fields] = await connection.execute(query, params);

        rows.forEach((row, index) => {
            row.slNo = index + 1;
        });

        // Total consumption query using the view
        let totalConsumptionQuery = `
            SELECT ROUND(SUM(weightScan), 2) AS totalConsumption
            FROM scrap_report_view
            WHERE 1=1`;

        const totalParams = [];

        // Apply the same filters for total consumption
        if (machineId) {
            totalConsumptionQuery += ` AND machineId = ?`;
            totalParams.push(machineId);
        }
        if (category) {
            totalConsumptionQuery += ` AND category = ?`;
            totalParams.push(category);
        }
        if (material) {
            totalConsumptionQuery += ` AND material = ?`;
            totalParams.push(material);
        }
        if (thickness) {
            totalConsumptionQuery += ` AND thickness = ?`;
            totalParams.push(thickness);
        }
        if (from && to) {
            totalConsumptionQuery += ` AND STR_TO_DATE(date, '%d-%m-%Y') BETWEEN STR_TO_DATE(?, '%Y-%m-%d') AND STR_TO_DATE(?, '%Y-%m-%d')`;
            totalParams.push(from, to);
        }

        // Execute total consumption query
        const [totalResult] = await connection.execute(totalConsumptionQuery, totalParams);
        const totalConsumption = totalResult[0].totalConsumption;

        const customHeaders = ['Sl.No', 'Date', 'Time', 'Machine Name', 'Category', 'Raw Material', 'Thickness', 'Weight/Kg'];
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Scrap Report');

        const headerRow = worksheet.addRow(customHeaders);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };

        const columnSize = 17;
        worksheet.columns.forEach((column) => {
            column.width = columnSize;
        });

        rows.forEach(row => {
            const customValues = [
                row.slNo,
                row.date,
                row.time,
                row.machineName,
                row.category,
                row.material,
                row.thickness,
                row.weightScanRounded,
            ];
            worksheet.addRow(customValues);
        });


        // Add a blank row before the total consumption row
        // worksheet.addRow([]);

        // Add total consumption row with custom styling
        const totalRow = worksheet.addRow(['', '', '', '', '', '', 'Total Consumption', totalConsumption]);
        totalRow.font = { bold: true };
        totalRow.alignment = { horizontal: 'center' };


        // Apply borders to all cells in the sheet
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' },
                };
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Scrap Report.xlsx');

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


exports.exportPaint = async (req, res) => {
    try {

        const { machineId, from, to } = req.body;

        let query = `SELECT * FROM paint_sludge_view WHERE 1=1`;
        const params = [];

        if (machineId) {
            query += ` AND machineId = ?`;
            params.push(machineId);
        }

        if (from && to) {
            query += ` AND STR_TO_DATE(date, '%d-%m-%Y') BETWEEN STR_TO_DATE(?, '%Y-%m-%d') AND STR_TO_DATE(?, '%Y-%m-%d')`;
            params.push(from, to);
        }

        // Execute the SQL query to get the rows from the view
        const [rows] = await connection.execute(query, params);

        // Add serial numbers to each row
        rows.forEach((row, index) => {
            row.slNo = index + 1;
        });

        // Get the total consumption from the view
        let totalConsumptionQuery = `
            SELECT ROUND(SUM(weightScan), 2) AS totalConsumption
            FROM paint_sludge_view WHERE 1=1`;
        const totalParams = [];

        if (machineId) {
            totalConsumptionQuery += ` AND machineId = ?`;
            totalParams.push(machineId);
        }

        if (from && to) {
            totalConsumptionQuery += ` AND STR_TO_DATE(date, '%d-%m-%Y') BETWEEN STR_TO_DATE(?, '%Y-%m-%d') AND STR_TO_DATE(?, '%Y-%m-%d')`;
            totalParams.push(from, to);
        }

        const [totalResult] = await connection.execute(totalConsumptionQuery, totalParams);
        const totalConsumption = totalResult[0]?.totalConsumption || 0;

        const customHeaders = ['Sl.No', 'Date', 'Time', 'Machine Name', 'Weight/Kg'];
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Scrap Report');

        // Add headers
        const headerRow = worksheet.addRow(customHeaders);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };

        const columnSize = 17;
        worksheet.columns.forEach((column) => {
            column.width = columnSize;
        });

        // Add data rows
        rows.forEach(row => {
            const customValues = [
                row.slNo,
                row.date,
                row.time,
                row.machineName,
                row.weightScan,
            ];
            worksheet.addRow(customValues);
        });

        // Add a blank row before the total consumption row
        // worksheet.addRow([]);

        // Add total consumption row with custom styling
        const totalRow = worksheet.addRow(['', '', '', 'Total Consumption', totalConsumption]);
        totalRow.font = { bold: true };
        totalRow.alignment = { horizontal: 'center' };

        // Apply borders to all cells in the sheet
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' },
                };
            });
        });

        // Set headers and initiate Excel file download
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



exports.exportAnalysis2 = async (req, res) => {
    try {
        const { machineId, category, material, from, to } = req.query;

        // Base query
        let query = `
        SELECT
            scrpDlg.material, scrpDlg.thickness,
            CASE
                WHEN SUM(CASE WHEN scrpDlg.category = 'Button' THEN scrpDlg.weightScan ELSE 0 END) >= 0
                THEN SUM(CASE WHEN scrpDlg.category = 'Button' THEN scrpDlg.weightScan ELSE 0 END)
                ELSE NULL
            END AS totalWeightWithButton,
            CASE
                WHEN SUM(CASE WHEN scrpDlg.category != 'Button' THEN scrpDlg.weightScan ELSE 0 END) >= 0
                THEN SUM(CASE WHEN scrpDlg.category != 'Button' THEN scrpDlg.weightScan ELSE 0 END)
                ELSE NULL
            END AS totalWeightWithoutButton,
            ROUND(SUM(weightScan), 2) AS totalConsumption
        FROM scrap_data_logs scrpDlg
        WHERE scrpDlg.category != 'Paint sludge'`;

        const params = [];

        if (machineId) {
            query += ` AND scrpDlg.machineId = ?`;
            params.push(machineId);
        }
        if (material) {
            query += ` AND scrpDlg.material = ?`;
            params.push(material);
        }

        if (from && to) {
            query += ` AND DATE(scrpDlg.created_at) BETWEEN ? AND ?`;
            params.push(from, to);
        }

        // Group by material and thickness
        query += ` GROUP BY scrpDlg.material, scrpDlg.thickness`;

        // Execute the query
        const [rows] = await connection.execute(query, params);

        // Group data by material
        const groupedData = {};

        rows.forEach(row => {
            const material = row.material;

            if (!groupedData[material]) {
                groupedData[material] = {
                    totalWeight: 0,
                    totalWeightWithButton: 0,
                    totalWeightWithoutButton: 0,
                    details: []
                };
            }

            // Add values to the total sums
            groupedData[material].totalWeight += row.totalConsumption;
            groupedData[material].totalWeightWithButton += row.totalWeightWithButton || 0;
            groupedData[material].totalWeightWithoutButton += row.totalWeightWithoutButton || 0;

            // Calculate percentages with a check to prevent division by zero
            const withButtonPercentage =
                row.totalConsumption !== 0 ? ((row.totalWeightWithButton / row.totalConsumption) * 100).toFixed(2) : '0.00';

            const withoutButtonPercentage =
                row.totalConsumption !== 0 ? ((row.totalWeightWithoutButton / row.totalConsumption) * 100).toFixed(2) : '0.00';

            groupedData[material].details.push({
                thickness: row.thickness,
                totalWeight: row.totalConsumption,
                withButton: row.totalWeightWithButton.toFixed(2),
                withoutButton: row.totalWeightWithoutButton.toFixed(2),
                withButtonPercentage,
                withoutButtonPercentage,
            });
        });

        // Transform grouped data to the desired response format
        const responseData = Object.entries(groupedData).map(([material, data]) => ({
            material,
            totalWeight: data.totalWeight.toFixed(2),
            withButton: data.totalWeightWithButton.toFixed(2),
            withoutButton: data.totalWeightWithoutButton.toFixed(2),
            withButtonPercentage: data.totalWeight !== 0
                ? ((data.totalWeightWithButton / data.totalWeight) * 100).toFixed(2) : '0.00',
            withoutButtonPercentage: data.totalWeight !== 0
                ? ((data.totalWeightWithoutButton / data.totalWeight) * 100).toFixed(2) : '0.00',
            details: data.details,
        }));


        // Excel download functionality with row spans
        const customHeaders = [
            'Material', '', '', '', '', 'Total Weight', 'With Button', 'Without Button', '', '', 'SCRAP%(WITH BUTTON)', 'SCRAP%(WITHOUT BUTTON)',

        ];

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Scrap Analysis Report');

        // Add and format headers
        const headerRow = worksheet.addRow(customHeaders);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };
        headerRow.eachCell((cell, colNumber) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFDCE6F1' },
            };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' },
            };
        });

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Populate data with merged cells for each material group
        let currentRow = 2;

        responseData.forEach(row => {
            const startRow = currentRow;
            const detailsCount = row.details.length;

            // Add Material and Totals in the merged row
            worksheet.mergeCells(startRow, 1, startRow + detailsCount - 1, 1);
            worksheet.mergeCells(startRow, 6, startRow + detailsCount - 1, 6);
            worksheet.mergeCells(startRow, 7, startRow + detailsCount - 1, 7);
            worksheet.mergeCells(startRow, 8, startRow + detailsCount - 1, 8);
            worksheet.mergeCells(startRow, 11, startRow + detailsCount - 1, 11);
            worksheet.mergeCells(startRow, 12, startRow + detailsCount - 1, 12);

            worksheet.getCell(`A${startRow}`).value = row.material;
            worksheet.getCell(`F${startRow}`).value = parseFloat(row.totalWeight).toFixed(2);
            worksheet.getCell(`G${startRow}`).value = parseFloat(row.withButton).toFixed(2);
            worksheet.getCell(`H${startRow}`).value = parseFloat(row.withoutButton).toFixed(2);
            worksheet.getCell(`K${startRow}`).value = `${row.withButtonPercentage}%`;
            worksheet.getCell(`L${startRow}`).value = `${row.withoutButtonPercentage}%`;

            // Add headers for the details section
            worksheet.getCell(`B1`).value = 'Thickness';
            worksheet.getCell(`C1`).value = 'Scrap Weight';
            worksheet.getCell(`D1`).value = 'Button Scrap';
            worksheet.getCell(`E1`).value = 'Without Button Scrap';
            worksheet.getCell(`I1`).value = 'SCRAP(THICKNESS WISE) WITH BUTTON %';
            worksheet.getCell(`J1`).value = 'SCRAP(THICKNESS WISE) WITHOUT BUTTON %';

            // Style the details headers
            ['B1', 'C1', 'D1', 'E1', 'I1', 'J1'].forEach((cell) => {
                worksheet.getCell(cell).font = { bold: true };
                worksheet.getCell(cell).alignment = { horizontal: 'center', vertical: 'middle' };
                worksheet.getCell(cell).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFDCE6F1' },
                };
                worksheet.getCell(cell).border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' },
                };
            });

            // Add details data
            row.details.forEach(detail => {
                worksheet.getCell(`B${currentRow}`).value = detail.thickness;
                worksheet.getCell(`C${currentRow}`).value = parseFloat(detail.totalWeight).toFixed(2);
                worksheet.getCell(`D${currentRow}`).value = detail.withButton;
                worksheet.getCell(`E${currentRow}`).value = detail.withoutButton;
                worksheet.getCell(`I${currentRow}`).value = `${detail.withButtonPercentage}%`;
                worksheet.getCell(`J${currentRow}`).value = `${detail.withoutButtonPercentage}%`;

                // Optional: Style each row of details for consistency
                ['B', 'C', 'D', 'E', 'I', 'J'].forEach((col) => {
                    const cell = worksheet.getCell(`${col}${currentRow}`);
                    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' },
                    };
                });

                currentRow++;
            });

        });

        // Apply borders and alignments
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' },
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Scrap_Analysis_Report.xlsx');

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


exports.exportAnalysis = async (req, res) => {
    try {
        const { machineId, material, thickness, from, to } = req.query;

        // ---------------- SCRAP QUERY ----------------
        let scrapQuery = `
            SELECT 
                scrp.material,
                scrp.thickness,
                SUM(CASE WHEN scrp.category = 'Button' THEN scrp.weightScan ELSE 0 END) AS weightWithButton,
                SUM(CASE WHEN scrp.category != 'Button' THEN scrp.weightScan ELSE 0 END) AS weightWithoutButton,
                SUM(scrp.weightScan) AS totalConsumption
            FROM scrap_data_logs scrp
            WHERE scrp.category != 'Paint sludge'
        `;

        const params = [];

        if (machineId) {
            scrapQuery += ` AND scrp.machineId = ?`;
            params.push(machineId);
        }
        if (material) {
            scrapQuery += ` AND scrp.material = ?`;
            params.push(material);
        }
        if (thickness) {
            scrapQuery += ` AND scrp.thickness = ?`;
            params.push(thickness);
        }
        if (from && to) {
            scrapQuery += ` AND DATE(scrp.created_at) BETWEEN ? AND ?`;
            params.push(from, to);
        }

        scrapQuery += ` GROUP BY scrp.material, scrp.thickness`;

        const [scrapRows] = await connection.execute(scrapQuery, params);

        // ---------------- SHEET CONSUMPTION ----------------
        let sheetQuery = `
            SELECT 
                mid.issuedQty,
                items.materialThickness,
                mst_item_group.code AS groupCode
            FROM material_issue_dtl mid
            INNER JOIN items ON items.id = mid.itemId
            INNER JOIN mst_item_group ON mst_item_group.id = items.itemGroup
            WHERE 1=1
        `;

        const sheetParams = [];

        if (from && to) {
            sheetQuery += ` AND DATE(mid.created_at) BETWEEN ? AND ?`;
            sheetParams.push(from, to);
        }

        const [sheetRows] = await connection.execute(sheetQuery, sheetParams);

        // ---------------- SHEET GROUPING ----------------
        const sheetMap = {};

        sheetRows.forEach(row => {
            if (!row.groupCode?.startsWith('RAW MATERIAL-')) return;

            const mat = row.groupCode.replace('RAW MATERIAL-', '').trim();
            const thick = parseFloat(row.materialThickness);
            const qty = Number(row.issuedQty) || 0;

            if (!mat || isNaN(thick)) return;

            const key = `${mat}__${thick}`;
            sheetMap[key] = (sheetMap[key] || 0) + qty;
        });

        // ---------------- FINAL GROUPING ----------------
        const final = {};

        scrapRows.forEach(row => {
            const thick = parseFloat(row.thickness);
            if (!row.material || isNaN(thick)) return;

            const key = `${row.material}__${thick}`;
            const sheetConsumption = sheetMap[key] || 0;

            const withBtn = Number(row.weightWithButton) || 0;
            const withoutBtn = Number(row.weightWithoutButton) || 0;
            const total = Number(row.totalConsumption) || 0;

            if (!final[row.material]) {
                final[row.material] = {
                    scrapWeightTotal: 0,
                    withButtonTotal: 0,
                    withoutButtonTotal: 0,
                    sheetConsumptionTotal: 0,
                    details: []
                };
            }

            const withBtnPct = sheetConsumption ? (withBtn / sheetConsumption * 100) : 0;
            const withoutBtnPct = sheetConsumption ? (withoutBtn / sheetConsumption * 100) : 0;

            final[row.material].details.push({
                thickness: row.thickness,
                scrapWeight: total,
                withBtn,
                withoutBtn,
                sheetConsumption,
                withBtnPct,
                withoutBtnPct
            });

            final[row.material].scrapWeightTotal += total;
            final[row.material].withButtonTotal += withBtn;
            final[row.material].withoutButtonTotal += withoutBtn;
            final[row.material].sheetConsumptionTotal += sheetConsumption;
        });

        // ---------------- EXCEL ----------------
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Scrap Analysis');

        worksheet.columns = [
            { header: 'Material', width: 18 },
            { header: 'Thickness', width: 12 },
            { header: 'Scrap Weight', width: 15 },
            { header: 'Button Scrap', width: 15 },
            { header: 'Without Button Scrap', width: 18 },
            { header: 'Sheet Consumption', width: 18 },
            { header: 'Scrap % With Button', width: 22 },
            { header: 'Scrap % Without Button', width: 25 },

            // TOTAL FIELDS
            { header: 'TOTAL Scrap Weight', width: 18 },
            { header: 'TOTAL Button Scrap', width: 20 },
            { header: 'TOTAL Without Button Scrap', width: 26 },
            { header: 'TOTAL Sheet Consumption', width: 26 },
            { header: 'TOTAL Scrap % With Button', width: 30 },
            { header: 'TOTAL Scrap % Without Button', width: 34 }
        ];

        worksheet.getRow(1).font = { bold: true };

        let rowIndex = 2;

        Object.entries(final).forEach(([material, data]) => {
            const startRow = rowIndex;

            const totalWithPct = data.sheetConsumptionTotal
                ? (data.withButtonTotal / data.sheetConsumptionTotal * 100)
                : 0;

            const totalWithoutPct = data.sheetConsumptionTotal
                ? (data.withoutButtonTotal / data.sheetConsumptionTotal * 100)
                : 0;

            data.details.forEach(d => {
                worksheet.addRow([
                    material,
                    d.thickness,
                    d.scrapWeight.toFixed(2),
                    d.withBtn.toFixed(2),
                    d.withoutBtn.toFixed(2),
                    d.sheetConsumption.toFixed(2),
                    d.withBtnPct.toFixed(2) + '%',
                    d.withoutBtnPct.toFixed(2) + '%',

                    // totals only in first row
                    '',
                    '',
                    '',
                    '',
                    '',
                    ''
                ]);
                rowIndex++;
            });

            const endRow = rowIndex - 1;

            worksheet.mergeCells(`A${startRow}:A${endRow}`);
            worksheet.mergeCells(`I${startRow}:I${endRow}`);
            worksheet.mergeCells(`J${startRow}:J${endRow}`);
            worksheet.mergeCells(`K${startRow}:K${endRow}`);
            worksheet.mergeCells(`L${startRow}:L${endRow}`);
            worksheet.mergeCells(`M${startRow}:M${endRow}`);
            worksheet.mergeCells(`N${startRow}:N${endRow}`);

            worksheet.getCell(`I${startRow}`).value = data.scrapWeightTotal.toFixed(2);
            worksheet.getCell(`J${startRow}`).value = data.withButtonTotal.toFixed(2);
            worksheet.getCell(`K${startRow}`).value = data.withoutButtonTotal.toFixed(2);
            worksheet.getCell(`L${startRow}`).value = data.sheetConsumptionTotal.toFixed(2);
            worksheet.getCell(`M${startRow}`).value = totalWithPct.toFixed(2) + '%';
            worksheet.getCell(`N${startRow}`).value = totalWithoutPct.toFixed(2) + '%';

            worksheet.getRow(startRow).alignment = {
                vertical: 'middle',
                horizontal: 'center'
            };
        });

        // ---------------- DOWNLOAD ----------------
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            'attachment; filename=Scrap_Analysis_Report.xlsx'
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../../config/dbSql');
const excel = require('exceljs');


exports.template = async (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['BOM Item code', 'Item Code', 'Qty', 'JC Part']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = BOM.xlsx');

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


// exports.showAllRecords = async (req, res) => {
//     try {
//         const query = `
//             SELECT 
//                 (@rownum := @rownum + 1) AS id,
//                 bom_mst.itemCode AS bomItemCode,
//                 items.itemCode AS itemCode,
//                 bom.Qty,
//                 bom.jcPart
//             FROM bom
//             INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
//             INNER JOIN items ON items.id = bom.itemId,
//             (SELECT @rownum := 0) AS r
//         `;

//         const [rows] = await connection.execute(query);

//         return handleSuccessResponse(res, 'BOM details fetched successfully', rows);
//     } catch (error) {
//         return handleErrorResponse(res, error);
//     }
// };


exports.showAllRecords = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const cursor = parseInt(req.query.cursor) || 0;
        const direction = req.query.direction === 'prev' ? 'prev' : 'next';

        let query, params;

        if (direction === 'next') {
            query = `
                SELECT 
                    bom.id,
                    bom_mst.itemCode AS bomItemCode,
                    items.itemCode AS itemCode,
                    bom.Qty,
                    bom.jcPart
                FROM bom
                STRAIGHT_JOIN bom_mst ON bom_mst.id = bom.bomMstId
                STRAIGHT_JOIN items ON items.id = bom.itemId
                WHERE bom.id > ?
                ORDER BY bom.id ASC
                LIMIT ?
            `;
            params = [cursor, limit];
        } else {
            query = `
                SELECT 
                    bom.id,
                    bom_mst.itemCode AS bomItemCode,
                    items.itemCode AS itemCode,
                    bom.Qty,
                    bom.jcPart
                FROM bom
                STRAIGHT_JOIN bom_mst ON bom_mst.id = bom.bomMstId
                STRAIGHT_JOIN items ON items.id = bom.itemId
                WHERE bom.id < ?
                ORDER BY bom.id DESC
                LIMIT ?
            `;
            params = [cursor, limit];
        }

        const [rows] = await connection.execute(query, params);

        if (direction === 'prev') rows.reverse();

        const firstRow = rows[0];
        const lastRow = rows[rows.length - 1];

        // Only fetch count on first page — use same JOINs as main query
        let total = null;
        if (!cursor) {
            const [countRows] = await connection.execute(`
                SELECT COUNT(*) as total
                FROM bom
                STRAIGHT_JOIN bom_mst ON bom_mst.id = bom.bomMstId
                STRAIGHT_JOIN items ON items.id = bom.itemId
            `);
            total = countRows[0].total;
        }

        let hasPrevious = false;
        if (firstRow) {
            const [prevCheck] = await connection.execute(`
                SELECT bom.id 
                FROM bom
                STRAIGHT_JOIN bom_mst ON bom_mst.id = bom.bomMstId
                STRAIGHT_JOIN items ON items.id = bom.itemId
                WHERE bom.id < ? 
                LIMIT 1
            `, [firstRow.id]);
            hasPrevious = prevCheck.length > 0;
        }

        return res.json({
            success: true,
            data: rows,
            total, // null for next pages
            nextCursor: lastRow?.id || null,
            prevCursor: firstRow?.id || null,
            hasMore: rows.length === limit,
            hasPrevious
        });

    } catch (error) {
        return handleErrorResponse(res, error);
    }
};

exports.bomDetails = async (req, res) => {
    try {
        const { itemId } = req.query;

        // Set response headers for file download immediately
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=bom-details.xlsx');

        // Use stream-based WorkbookWriter instead of memory buffering
        const options = {
            stream: res,
            useStyles: true,
            useSharedStrings: true
        };
        const workbook = new excel.stream.xlsx.WorkbookWriter(options);
        const worksheet = workbook.addWorksheet('BOM Details');

        // Set column widths explicitly BEFORE adding any rows
        worksheet.columns = [
            { width: 23, style: { alignment: { horizontal: 'center' } } },
            { width: 23, style: { alignment: { horizontal: 'center' } } },
            { width: 10, style: { alignment: { horizontal: 'center' } } },
            { width: 20, style: { alignment: { horizontal: 'center' } } }
        ];

        // Add headers
        const headerRow = worksheet.addRow(['BOM Item Code', 'Item Code', 'Qty', 'JC Part']);

        // Apply styles to the header row directly before commit
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }; // White bold text
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4472C4' } // Light blue background
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        headerRow.commit(); // Ensure header row passes to the stream immediately
        let bomQuery = `
            SELECT bom_mst.itemCode as bomItemCode, items.itemCode, CAST(bom.Qty AS DOUBLE) AS Qty, bom.jcPart 
            FROM bom
            INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
            INNER JOIN items on items.id = bom.itemId
        `;
        let values = [];

        if (itemId) {
            bomQuery += ' WHERE bom_mst.id = ?';
            values.push(itemId);
        }

        // Execute natively exactly like legacy code but pipe the objects straight to the streaming formatter
        const [bomRows] = await connection.execute(bomQuery, values);

        for (const row of bomRows) {
            worksheet.addRow(Object.values(row)).commit();
        }

        // Close and flush the stream chunks
        worksheet.commit();
        await workbook.commit();

        // Note: res.end() not required as the strean handles it cleanly!
    } catch (err) {
        if (!res.headersSent) {
            return handleErrorResponse(res, err);
        } else {
            res.end(); // Emergency release 
        }
    }
};


exports.bomMainParts = async (res, itemsList) => {
    try {
        // Create a new workbook and worksheet
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('BOM Details');

        // Add column headers
        worksheet.columns = [
            { header: 'Sl No', key: 'id', width: 15, style: { alignment: { horizontal: 'center' } } },
            { header: 'Item Code', key: 'itemCode', width: 26, style: { alignment: { horizontal: 'center' } } },
            { header: 'Item Name', key: 'itemName', width: 32, style: { alignment: { horizontal: 'center' } } },
            { header: 'Uom', key: 'uom', width: 20, style: { alignment: { horizontal: 'center' } } },
            { header: 'Item Group', key: 'itemGroup', width: 30, style: { alignment: { horizontal: 'center' } } },
            { header: 'Bom Qty', key: 'Qty', width: 30, style: { alignment: { horizontal: 'center' } } }
        ];

        // Apply styles to the header row
        worksheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, size: 13 }; // Bold and white text
        });

        // Add rows to the worksheet
        itemsList.forEach(row => {
            worksheet.addRow(row);
        });

        // Set the response headers for file download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=bom-details.xlsx');

        // Write the workbook to the response
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        throw err;
    }
};

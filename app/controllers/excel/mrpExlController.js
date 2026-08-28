const { connection, CustomError, handleErrorResponse } = require("../../config/dbSql");
const excel = require("exceljs");

exports.mrpReportExport = async (res, mrpRows) => {
    try {
        // Create a new workbook and worksheet
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Material Requirement');

        // Add headers and format worksheet
        addHeaders(worksheet);
        formatWorksheet(worksheet);

        // Add MRP data rows
        addDataRows(worksheet, mrpRows);

        // Apply fill color to the entire A column
        fillColumnA(worksheet);

        // Borders
        setBorder(worksheet);

        // Convert the workbook to a buffer and send it as a downloadable file
        await sendWorkbookAsBuffer(res, workbook);
    } catch (err) {
        throw err;
    }
};

const addHeaders = (worksheet) => {
    const headers = [
        'Slno', 'Group', 'Part No', 'Part Desc', 'UOM', 'Location', 'Category', 'Qty',
        'QOH', 'Pend POQty', 'JC Qty', 'PR Qty', 'Contracts', 'Remarks', 'Product Family',
        'MATERIAL', 'KANBAN', 'Material Thickness', 'RMITEM', 'SuppName'
    ];

    const headerRow = worksheet.addRow(headers);

    const fontColor = '0625bf'; // Font color
    const fillColor = 'e8eaeb'; // Background color

    headerRow.eachCell({ includeEmpty: true }, function (cell) {
        cell.font = { name: 'Cambria', color: { argb: fontColor }, bold: true, size: 12 };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: fillColor }
        };
    });

    headerRow.height = 25;
};

const formatWorksheet = (worksheet) => {
    const widths = [10, 30, 30, 40, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 30];
    const alignments = [null, null, null, null, null, null, null, null, null, null, null, null, "left", null, null, null, null, null, null, null];

    worksheet.columns.forEach((column, index) => {
        column.width = widths[index] || 22;
        column.alignment = alignments[index] ? { horizontal: alignments[index] } : { horizontal: "center" };

        worksheet.getRow(1).eachCell((cell) => {
            cell.alignment = { horizontal: "center", vertical: "middle" };
        });
    });
};

const addDataRows = (worksheet, mrpRows) => {
    const alternatingRowColor = 'DFF4FA'; // Alternating row color

    mrpRows.forEach((row, index) => {
        const rowData = Object.values(row);
        const newRow = worksheet.addRow(rowData);

        // Apply light blue fill to the entire row for even-indexed rows
        if (index % 2 === 0) {
            newRow.eachCell({ includeEmpty: true }, (cell) => {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: alternatingRowColor }
                };
            });
        }
    });
};

const fillColumnA = (worksheet) => {
    const fillColor = 'e8eaeb'; // Background color for column A

    worksheet.getColumn(1).eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: fillColor }
        };
    });
};

const setBorder = (worksheet) => {
    worksheet.eachRow({ includeEmpty: true }, function (row) {
        row.eachCell({ includeEmpty: true }, function (cell) {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
        row.height = 18;
    });
}

const sendWorkbookAsBuffer = async (res, workbook) => {
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Disposition', 'attachment; filename="MRP Report.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    res.send(buffer);
};

// async function generateMrpReport(mrpMstId) {
//     const fetchQuery =
//         `SELECT
//             items.itemCode,
//             items.category,
//             CAST(ROUND(MAX(total_qty), 0) AS INT) AS total_qty,
//             GROUP_CONCAT(
//                 DISTINCT aggregated_cslIds ORDER BY aggregated_cslIds ASC SEPARATOR ','
//             ) AS aggregated_cslIds,
//             MAX(jcQty) AS jcQty,
//             jcNo,
//             DATE_FORMAT(op.kanbanDate, '%d %b %Y') AS kanbanDate
//         FROM
//             (
//                 SELECT
//                     itemCode,
//                     Qty AS total_qty,
//                     contractNos AS aggregated_cslIds,
//                     jc.Qty AS jcQty,
//                     jc.jcNo,
//                     jc.mrpMstId
//                 FROM
//                     job_card jc
//                 WHERE
//                     mrpMstId = ?
//                 GROUP BY
//                     itemCode
        
//                 UNION ALL
        
//                 SELECT
//                     mrp.itemCode,
//                     SUM(mrp.Qty) AS total_qty,
//                     GROUP_CONCAT(
//                         DISTINCT mrp.contractNos ORDER BY mrp.contractNos ASC SEPARATOR ','
//                     ) AS aggregated_cslIds,
//                     NULL AS jcQty,
//                     NULL AS jcNo,
//                     mrp.mrpMstId
//                 FROM
//                     mrp
//                 WHERE
//                     mrp.mrpMstId = ?
//                 GROUP BY
//                     mrp.itemCode
//             ) AS combined_results
//         INNER JOIN items ON items.itemCode = combined_results.itemCode
//         INNER JOIN mrp_mst ON mrp_mst.id = combined_results.mrpMstId
//         INNER JOIN order_plannings op ON op.id = mrp_mst.orderPlnId
//         GROUP BY
//         combined_results.itemCode;
//         `;

//     const [mrpRows] = await connection.execute(fetchQuery, [mrpMstId, mrpMstId]);

//     for (const [index, item] of mrpRows.entries()) {
//         const itemQuery = `
//                 SELECT 
//                     items.itemName, mst_item_group.code as itemGroup, mst_uom.code as uom, items.category, latestStock.totStk, item_main_loc.name as location,
//                     item_product_family.name as productFamily, items.material, items.rmItemCode as rmItem, items.materialThickness, supplier.spCode as supplier
//                 FROM items
//                     LEFT JOIN mst_item_group ON mst_item_group.id = items.itemGroup
//                     LEFT JOIN mst_uom ON mst_uom.id = items.uom
//                     LEFT JOIN item_main_loc ON item_main_loc.id = items.mainLocation
//                     LEFT JOIN item_product_family ON item_product_family.id = items.productFamily
//                     LEFT JOIN (
//                         SELECT s.itemId, s.totQty as totStk
//                         FROM store s
//                         INNER JOIN (
//                             SELECT itemId, MAX(id) AS maxId
//                             FROM store
//                             GROUP BY itemId
//                         ) x ON s.id = x.maxId
//                     ) AS latestStock ON latestStock.itemId = items.id
//                     LEFT JOIN (
//                         SELECT itemName, spName
//                         FROM supp_vs_item
//                         GROUP BY itemName
//                         ORDER BY MIN(id) -- or any other column that determines the order
//                         LIMIT 1
//                     ) AS supp_vs_item ON supp_vs_item.itemName = items.id
//                     LEFT JOIN supplier ON supplier.id = supp_vs_item.spName
//                 WHERE 
//                     items.itemCode = ?
//             `;

//         const [itemRow] = await connection.execute(itemQuery, [item.itemCode]);
//         const res = itemRow[0];

//         // Reordering the keys
//         const orderedItem = {
//             Slno: index + 1,
//             Group: res.itemGroup,
//             partNo: item.itemCode,
//             partDesc: res.itemName,
//             UOM: res.uom,
//             Location: res.location,
//             Category: item.category,
//             Qty: item.total_qty,
//             QOH: Number(res.totStk ?? 0),
//             pendPOQty: null,
//             jcQty: item.jcQty,
//             prQty: null,
//             Contracts: item.aggregated_cslIds,
//             Remarks: item.jcNo,
//             productFamily: res.productFamily,
//             MATERIAL: res.material,
//             KANBAN: item.kanbanDate,
//             materialThickness: res.materialThickness,
//             RMITEM: res.rmItem,
//             SuppName: res.supplier
//         };

//         // Replace the original item object with the ordered one
//         mrpRows[index] = orderedItem;
//     }

//     return mrpRows;
// }

async function generateMrpReport(mrpMstId) {

    /* ===============================
       1️⃣ MAIN MRP QUERY (UNCHANGED)
    =============================== */

    const fetchQuery = `
        SELECT
            items.itemCode,
            items.category,
            CAST(ROUND(MAX(total_qty), 0) AS INT) AS total_qty,
            GROUP_CONCAT(
                DISTINCT aggregated_cslIds ORDER BY aggregated_cslIds ASC SEPARATOR ','
            ) AS aggregated_cslIds,
            MAX(jcQty) AS jcQty,
            jcNo,
            DATE_FORMAT(op.kanbanDate, '%d %b %Y') AS kanbanDate
        FROM (
            SELECT
                itemCode,
                Qty AS total_qty,
                contractNos AS aggregated_cslIds,
                jc.Qty AS jcQty,
                jc.jcNo,
                jc.mrpMstId
            FROM job_card jc
            WHERE mrpMstId = ?
            GROUP BY itemCode

            UNION ALL

            SELECT
                mrp.itemCode,
                SUM(mrp.Qty) AS total_qty,
                GROUP_CONCAT(
                    DISTINCT mrp.contractNos ORDER BY mrp.contractNos ASC SEPARATOR ','
                ) AS aggregated_cslIds,
                NULL AS jcQty,
                NULL AS jcNo,
                mrp.mrpMstId
            FROM mrp
            WHERE mrp.mrpMstId = ?
            GROUP BY mrp.itemCode
        ) AS combined_results
        INNER JOIN items ON items.itemCode = combined_results.itemCode
        INNER JOIN mrp_mst ON mrp_mst.id = combined_results.mrpMstId
        INNER JOIN order_plannings op ON op.id = mrp_mst.orderPlnId
        GROUP BY combined_results.itemCode;
    `;

    const [mrpRows] = await connection.execute(fetchQuery, [mrpMstId, mrpMstId]);

    if (!mrpRows.length) return [];

    /* ===============================
       2️⃣ FETCH ALL ITEM DETAILS (ONCE)
    =============================== */

    const itemCodes = mrpRows.map(r => r.itemCode);

    const itemDetailsQuery = `
        SELECT 
            items.itemCode,
            items.itemName,
            mig.code AS itemGroup,
            mu.code AS uom,
            COALESCE(ls.totStk, 0) AS totStk,
            iml.name AS location,
            ipf.name AS productFamily,
            items.material,
            items.rmItemCode AS rmItem,
            items.materialThickness,
            sup.spCode AS supplier
        FROM items
        LEFT JOIN mst_item_group mig ON mig.id = items.itemGroup
        LEFT JOIN mst_uom mu ON mu.id = items.uom
        LEFT JOIN item_main_loc iml ON iml.id = items.mainLocation
        LEFT JOIN item_product_family ipf ON ipf.id = items.productFamily
        LEFT JOIN (
            SELECT s.itemId, s.totQty AS totStk
            FROM store s
            INNER JOIN (
                SELECT itemId, MAX(id) maxId
                FROM store
                GROUP BY itemId
            ) x ON x.maxId = s.id
        ) ls ON ls.itemId = items.id
        LEFT JOIN (
            SELECT svi.itemName, svi.spName
            FROM supp_vs_item svi
            INNER JOIN (
                SELECT itemName, MIN(id) id
                FROM supp_vs_item
                GROUP BY itemName
            ) x ON x.id = svi.id
        ) svi ON svi.itemName = items.id
        LEFT JOIN supplier sup ON sup.id = svi.spName
        WHERE items.itemCode IN (?)
    `;

    const [itemRows] = await connection.query(itemDetailsQuery, [itemCodes]);

    /* ===============================
       3️⃣ MAP ITEM DETAILS (O(1) LOOKUP)
    =============================== */

    const itemMap = new Map();
    for (const row of itemRows) {
        itemMap.set(row.itemCode, row);
    }

    /* ===============================
       4️⃣ FINAL RESULT ASSEMBLY
    =============================== */

    const result = mrpRows.map((item, index) => {
        const res = itemMap.get(item.itemCode) || {};

        return {
            Slno: index + 1,
            Group: res.itemGroup,
            partNo: item.itemCode,
            partDesc: res.itemName,
            UOM: res.uom,
            Location: res.location,
            Category: item.category,
            Qty: item.total_qty,
            QOH: Number(res.totStk ?? 0),
            pendPOQty: null,
            jcQty: item.jcQty,
            prQty: null,
            Contracts: item.aggregated_cslIds,
            Remarks: item.jcNo,
            productFamily: res.productFamily,
            MATERIAL: res.material,
            KANBAN: item.kanbanDate,
            materialThickness: res.materialThickness,
            RMITEM: res.rmItem,
            SuppName: res.supplier
        };
    });

    return result;
}

exports.mrpReport = async (req, res) => {
    try {
        const { mrpMstId } = req.query;

        const mrpRows = await generateMrpReport(mrpMstId);
        return await this.mrpReportExport(res, mrpRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.machinePlanReport = async (req, res) => {
    try {
        const { mrpMstId } = req.query;

        const [sfRows] = await connection.execute(`
            SELECT jcNo, itemCode, machine, process, Qty, cycleTime, plannedTime, DATE_FORMAT(prod_date, '%d-%m-%Y') AS prod_date, prod_shift, prod_qty
            FROM sf_schedule
            WHERE mrpMstId = ?
            ORDER BY machine
        `, [mrpMstId]);

        if (!sfRows.length) {
            return res.status(404).json({ message: "No data found for the given mrpMstId" });
        }

        const workbook = new excel.Workbook();

        // Group rows by machine
        const machineGroups = {};
        for (const row of sfRows) {
            if (!machineGroups[row.machine]) {
                machineGroups[row.machine] = [];
            }
            machineGroups[row.machine].push(row);
        }

        // Create a worksheet for each machine
        for (const [machineName, rows] of Object.entries(machineGroups)) {
            const sheetName = machineName ? machineName.substring(0, 31) : "Unknown";

            const worksheet = workbook.addWorksheet(sheetName, {
                properties: { tabColor: { argb: 'FFB7DEE8' } } // Light blue shade
            });

            worksheet.columns = [
                { header: "Sl No", key: "sNo", width: 8 },
                { header: "Date", key: "prod_date", width: 12 },
                { header: "Shift", key: "prod_shift", width: 10 },
                { header: "JC No", key: "jcNo", width: 25 },
                { header: "Item Code", key: "itemCode", width: 35 },
                { header: "Machine", key: "machine", width: 20 },
                { header: "Process", key: "process", width: 25 },
                { header: "Qty", key: "Qty", width: 10 },
                { header: "Cycle Time", key: "cycleTime", width: 18 },
                { header: "Planned Time", key: "plannedTime", width: 22 },
                { header: "Produced Qty", key: "prod_qty", width: 18 }
            ];

            // Freeze header row
            worksheet.views = [{ state: 'frozen', ySplit: 1 }];

            // Style header row
            const headerRow = worksheet.getRow(1);
            headerRow.height = 26;
            headerRow.eachCell(cell => {
                cell.font = { name: 'Cambria', bold: true, color: { argb: '0625bf' }, size: 12 };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'e8eaeb' } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });

            // Add machine rows
            rows.forEach((row, index) => {
                const rowData = {
                    sNo: index + 1,
                    prod_date: row.prod_date || '', 
                    prod_shift: row.prod_shift || '',
                    jcNo: row.jcNo,
                    itemCode: row.itemCode,
                    machine: row.machine,
                    process: row.process,
                    Qty: row.Qty,
                    cycleTime: row.cycleTime,
                    plannedTime: row.plannedTime,
                    prod_qty: row.prod_qty || ''
                };

                const newRow = worksheet.addRow(rowData);

                // Center-align all cells
                newRow.eachCell({ includeEmpty: true }, cell => {
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                });

                // Apply alternating row colors
                if (index % 2 === 0) {
                    newRow.eachCell({ includeEmpty: true }, cell => {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DFF4FA' } }; // very light blue
                    });
                }
            });

            setBorder(worksheet);
        }

        await sendWorkbookAsBuffer(res, workbook);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

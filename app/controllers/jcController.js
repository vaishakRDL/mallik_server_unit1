const { handleErrorResponse, connection, handleSuccessResponse, CustomError } = require("../config/dbSql")
const excel = require('exceljs');
const { fetchChildParts } = require("./hmiController");
const { generateDocNo } = require("../utility/docNo");
const { getUser } = require("../utility/utilityFunction");

async function jobCardDetails(fromDate, toDate, itemCode, machineId) {
    try {
        const jcValues = [];

        let fetchJc = `
            SELECT jc.id, jc.jcNo, jc.itemCode, items.id as itemId, jc.Qty, jc.Produced_QTY as producedQty, 
            jc.High_escalation, jc.status, items.npdFile, items.rmThickness,
            DATE_FORMAT(jc.created_at, '%d-%m-%Y') AS created_at,
            DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
            FROM job_card jc
            INNER JOIN mrp_mst ON mrp_mst.id = jc.mrpMstId
            INNER JOIN items ON items.id = jc.itemId
            INNER JOIN order_plannings op ON op.id = mrp_mst.orderPlnId
            INNER JOIN jobcard_planning jp ON jp.jcId = jc.id

        `;

        if (fromDate && toDate && machineId) {
            fetchJc += ` WHERE DATE(jc.created_at) >= ? AND DATE(jc.created_at) <= ? AND jp.machineId = ?`;
            jcValues.push(fromDate, toDate, machineId);
        } else if (fromDate && toDate) {
            fetchJc += ` WHERE DATE(jc.created_at) >= ? AND DATE(jc.created_at) <= ?`;
            jcValues.push(fromDate, toDate);
        } else if (itemCode) {
            fetchJc += ` WHERE jc.itemCode = ?`;
            jcValues.push(itemCode);
        } else {
            fetchJc += ` WHERE DATE(jc.created_at) = CURDATE()`;
        }

        fetchJc += ` GROUP BY jc.id, jc.jcNo, jc.itemCode, items.id, jc.Qty, jc.Produced_QTY, jc.High_escalation, jc.status, items.npdFile, items.rmThickness`;
        const [jcRows] = await connection.execute(fetchJc, jcValues);

        return jcRows;
    } catch (err) {
        throw err
    }
}

exports.jcList = async (req, res) => {
    try {
        const { fromDate, toDate, itemCode, machineId } = req.body;
        const jcRows = await jobCardDetails(fromDate, toDate, itemCode, machineId);

        return handleSuccessResponse(res, 'JC-lists', jcRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.jcNumber = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body;
        const jcValues = [];

        let fetchJc = `SELECT jc.id, jc.jcNo as label FROM job_card jc`;

        if (fromDate && toDate) {
            fetchJc += ` WHERE DATE(jc.created_at) >= ? AND DATE(jc.created_at) <= ?`;
            jcValues.push(fromDate, toDate);
        }
        const [jcRows] = await connection.execute(fetchJc, jcValues);

        return handleSuccessResponse(res, 'JC-Numbers', jcRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.jcReport = async (req, res) => {
    try {
        const { fromDate, toDate, itemCode } = req.query;
        const jcRows = await jobCardDetails(fromDate, toDate, itemCode);

        const finalResult = jcRows.map((item, index) => {
            return {
                id: index + 1,
                jcNo: item.jcNo,
                created_at: item.created_at,
                kanbanDate: item.kanbanDate,
                itemCode: item.itemCode,
                Qty: item.Qty,
                producedQty: item.producedQty,
            };
        });

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Material Requirement');

        // Add headers
        const headerRow = worksheet.addRow(["Sl No", "JobCard No", "Created Date", "Kanban Date", "Part No", "Qty", "Produced Qty"]);

        // Apply styles to the header row
        headerRow.font = { bold: true, size: 13 };
        headerRow.alignment = { horizontal: "center" };

        worksheet.columns.forEach((column, index) => {
            column.width = index === 0 ? 12 : index === 4 ? 35 : 20;
            column.alignment = { horizontal: "center" }; // Center align all columns
        });

        // Add data to the worksheet
        finalResult.forEach(row => {
            const rowData = Object.values(row);
            worksheet.addRow(rowData);
        });

        // Convert the workbook to a buffer
        const buffer = await workbook.xlsx.writeBuffer();

        // Set response headers for file download
        res.setHeader('Content-Disposition', 'attachment; filename="Job Cards.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        // Send the buffer as a downloadable file
        res.send(buffer);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.jcView = async (req, res) => {
    try {
        const { jcId } = req.body;

        const [check] = await connection.execute(`
            SELECT 
                jc.id, jc.jcNo, jc.itemId, jc.Qty AS plannedQty, items.itemCode, items.itemName, items.materialThickness,
                DATE_FORMAT(jc.created_at, '%d-%m-%Y') AS issuedDate, DATE_FORMAT(jc.created_at, '%d-%m-%Y') AS scheduledDate, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate,
                NULL AS scheduledDate, jc.grn, pfam.name AS productFamily, pfin.name AS productFinish, NULL AS finishingDetails, NULL AS materialSpec,
                op.requestedBy AS planEngineer
            FROM 
                job_card jc
                INNER JOIN mrp_mst ON mrp_mst.id = jc.mrpMstId
                INNER JOIN order_plannings op ON op.id = mrp_mst.orderPlnId
                INNER JOIN items ON items.id = jc.itemId
                LEFT JOIN item_product_family pfam ON pfam.id = items.productFamily
                LEFT JOIN item_product_finish pfin ON pfin.id = items.productFinish
            WHERE 
                jc.id = ?`,
            [jcId]);

        if (check.length === 0) throw new CustomError('Invalid JC number!', 404);

        const [details] = await connection.execute(`
            SELECT 
                ROW_NUMBER() OVER (ORDER BY jp.id) AS sNo,
                jp.process, jp.machineName, 
                jp.acptQty, jp.producedQty, 
                jp.operator, COALESCE(jp.qa, pmInsPec.addedBy) AS qa, jp.prod_eng
            FROM jobcard_planning jp
            LEFT JOIN pm_inspeclist_mst pmInsPec ON pmInsPec.jcId = jp.jcId AND pmInsPec.itemId = jp.itemId AND pmInsPec.processId = jp.processId
            WHERE jp.jcId = ?
        `, [jcId]);

        const [childParts] = await connection.execute(`
            SELECT 
                i.id, i.itemCode, i.itemName, i.materialThickness, m.Qty, m.Child_Produced_Qty as preparedQty
            FROM mrp m
            INNER JOIN items i ON i.id = m.itemId
            WHERE m.jcId = ? AND m.jcPart = 'Y'
        `, [jcId]);

        return res.status(200).json({
            success: true,
            message: 'JC-Details',
            jcDetails: check[0],
            processDetails: details,
            bomDetails: childParts
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

async function fetchMainItems(bomMstId) {
    const query = `
        SELECT bom.itemId, bom.jcPart, items.isBom FROM bom 
            INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
            INNER JOIN items ON items.id = bom.itemId
        WHERE bom_mst.itemId = ? AND bom.jcPart != 'NR'`;
    const [bom] = await connection.execute(query, [bomMstId]);
    return bom;
}

async function fetchItemsDetails(bomMstId, itemId = null) {
    const query = `
        SELECT items.id, items.itemCode, items.itemName, items.materialThickness, null as material, bom.Qty, null as preparedQty FROM bom 
            INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
            INNER JOIN items ON items.id = bom.itemId
        WHERE bom_mst.itemId = ? AND bom.jcPart != 'NR'${itemId ? ' AND bom.itemId = ?' : ''}`;
    const params = [bomMstId];
    if (itemId) params.push(itemId);
    const [bom] = await connection.execute(query, params);
    return bom;
}

// Fetch Bom Details
async function fetchBomDetails(bomMstId) {
    try {
        const itemsList = [];
        const bom = await fetchMainItems(bomMstId);

        for (const element of bom) {
            const { itemId, jcPart, isBom } = element;

            if (jcPart == 'Y') {
                const itemsDetails = await fetchItemsDetails(bomMstId, itemId);
                itemsList.push(...itemsDetails);
            }

            if (isBom == 'Y') {
                const childParts = await childItems(itemId);
                itemsList.push(...childParts);
            }
        }

        // Sort itemsList by ascending thickness
        itemsList.sort((a, b) => a.materialThickness - b.materialThickness);

        return itemsList;
    } catch (err) {
        //console.log(err)
        return handleErrorResponse(res, err);
    }
}

// Recursive function to fetch child details
async function childItems(mainItemId) {
    try {
        const itemsList = [];
        const bom = await fetchMainItems(mainItemId);

        for (const element of bom) {
            const { itemId, jcPart, isBom } = element;

            if (jcPart == 'Y') {
                const childItems = await fetchItemsDetails(mainItemId, itemId);
                itemsList.push(...childItems);
            }

            if (isBom == 'Y') {
                const childParts = await childItems(itemId); // Recursive call
                itemsList.push(...childParts);
            }
        }

        return itemsList;
    } catch (error) {
        throw error;
    }
}

exports.getJobCardNo = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'JobCard', customValue: '' });
        await conn.commit();

        return res.status(200).json({
            success: true,
            message: "JobCard number generated successfully",
            JcNo: padStartNo,
            uniqueNo
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.childPartPorcess = async (req, res) => {
    try {
        const { jcNo, itemId } = req.body;

        const [processRows] = await connection.execute(`
            SELECT 
                ROW_NUMBER() OVER(ORDER BY c.id) as id, c.orderPlnId, c.jcId, c.itemCode, c.processId, c.processName as process, c.machineName, c.Produced_QTY as producedQty, c.Shift as prod_shift, 
                c.Produced_date as prod_date, jp.operator
            FROM childpart_planning c
            LEFT JOIN jobcard_planning jp ON jp.jcId = c.jcId AND jp.machineId = c.machineId AND jp.processId = c.processId 
            WHERE 
                c.jcNo = ? AND c.itemId = ?
            `,
            [jcNo, itemId]
        );
        if (processRows.length === 0) {
            return handleSuccessResponse(res, "Child Process details", []);
        }

        const { orderPlnId, jcId } = processRows[0] || {};

        const [opRows] = await connection.execute(`
            SELECT requestedBy FROM order_plannings WHERE id = ?`,
            [orderPlnId]
        );
        const planEngineer = opRows.length > 0 ? opRows[0].requestedBy : null;

        for (const process of processRows) {
            const { itemCode, machineName, processId } = process;

            const [operatorDetails] = await connection.execute(`
                SELECT Operator_Name, DATE_FORMAT(Date_time, '%d-%m-%Y') AS date, Shift
                FROM operator_details
                WHERE Jobcard_Number = ? AND Part_Number = ? AND Machine_Name = ?
                ORDER BY id desc LIMIT 1`,
                [jcNo, itemCode, machineName]
            );

            const [qualityRows] = await connection.execute(`
                SELECT id, addedBy FROM pm_inspeclist WHERE jcId = ? AND itemId = ? AND processId = ?`,
                [jcId, itemId, processId]
            );

            let operatorName = null, date = null, shift = null, qa = null;

            if (operatorDetails.length > 0) {
                ({ Operator_Name: operatorName, date, Shift: shift } = operatorDetails[0]);
            }
            if (qualityRows.length) {
                qa = qualityRows[0].addedBy;
            }
            process.operator = operatorName ?? process.operator;
            process.qa = qa;
            process.prodEng = planEngineer;
            process.date = date;
            process.shift = shift;
        }

        return handleSuccessResponse(res, 'Child Process details', processRows)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const filterResult = (part, thickness, data) => {
    const val = (part || thickness || '').toLowerCase();

    let completed = 0, pending = 0;

    const filteredData = data.filter(item => {
        item.status === 'Completed' ? completed++ : pending++;

        if (part) return item.PartNumber?.toLowerCase().includes(val);
        if (thickness) return item.Thickness?.toLowerCase() === val;

        return true;
    });

    return { issued: data.length, completed, pending, filteredData };
};

exports.getJobCards = async (mrpMstIdStr, fromDate, toDate, type, part, thickness) => {
    try {
        const mrpMstId = mrpMstIdStr ? parseInt(mrpMstIdStr) : null;
        if ((!fromDate && !toDate) && !mrpMstId) {
            throw new CustomError(`Please select date or MRP ID!`, 400);
        }

        let jcValues = [];

        let jcQuery = `
            SELECT 
                jc.id, 
                items.materialThickness AS Thickness, 
                jc.mrpMstId AS MRPID, 
                jc.itemCode AS PartNumber, 
                items.itemName AS Description, 
                jc.jcNo AS JobCardNo, 
                DATE_FORMAT(jc.created_at, '%d-%m-%Y') AS JobCardDate,
                mm.requestedBy AS addedBy, 
                pf.name AS ProductType, 
                uom.name AS UOM, 
                jc.Qty AS Qty,
                CASE 
                    WHEN jc.status = 'Completed' THEN COALESCE(sfg.sfgVerifiedQty, 0)
                    ELSE 0
                END AS ProducedQty,
                jc.status,
                DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate,
                CASE 
                    WHEN EXISTS (
                        SELECT 1
                        FROM item_vs_pm ivp
                        JOIN mst_pm pm ON pm.id = ivp.process
                        WHERE ivp.item = jc.itemId
                        AND pm.vendorProcess = 1
                    ) THEN 'VendorProcess'
                    ELSE 'InHouse'
                END AS jcType
            FROM job_card jc
            INNER JOIN items ON items.id = jc.itemId
            LEFT JOIN mst_uom uom ON uom.id = items.uom
            LEFT JOIN item_product_family pf ON pf.id = items.productFamily
            LEFT JOIN mrp_mst mm ON mm.id = jc.mrpMstId
            LEFT JOIN order_plannings op ON op.id = mm.orderPlnId
            LEFT JOIN sfg ON sfg.jcId = jc.id
            WHERE 1 = 1
        `;

        if (mrpMstId) {
            jcQuery += ` AND jc.mrpMstId = ?`;
            jcValues.push(mrpMstId);
        }

        if (fromDate && toDate) {
            jcQuery += ` AND jc.created_at >= ? AND jc.created_at < DATE_ADD(?, INTERVAL 1 DAY)`;
            jcValues.push(fromDate, toDate);
        }

        if (type === 'pending') {
            jcQuery += ` AND jc.status = ?`;
            jcValues.push('Pending');
        }

        jcQuery += `
            ORDER BY op.orderPriority, items.materialThickness
        `;

        const [rows] = await connection.execute(jcQuery, jcValues);

        return await filterResult(part, thickness, rows);
    } catch (err) {
        throw err;
    }
}

exports.fetchSchedules = async (req, res) => {
    try {
        const { mrpMstId = null, fromDate, toDate, type, part, thickness } = req.body;

        const { filteredData } = await this.getJobCards(mrpMstId, fromDate, toDate, type, part, thickness);

        return handleSuccessResponse(res, 'Scheduled tasks', filteredData);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.jcDetails = async (req, res) => {
    try {
        const { jcNo } = req.body;

        const [[jcRow]] = await connection.execute(`
            SELECT 
                items.id AS itemId, jc.id AS jcId, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, 
                DATE_FORMAT(jc.created_at, '%d-%m-%Y') AS scheduledDate, jc.grn AS grnNo, pfam.name AS productFamily, 
                loc.name AS location, items.itemCode, items.itemName, items.material, items.materialThickness, jc.Qty, 
                pfin.name AS productFinish, op.requestedBy AS planEngineer, COALESCE(sfg.accQty, 0) AS approvedQty,
                COALESCE(SUM(CASE WHEN pi.status = 'rework' THEN pi.totQlty ELSE 0 END), 0) AS reworkQty,
                COALESCE(SUM(CASE WHEN pi.status = 'scrap' THEN pi.totQlty ELSE 0 END), 0) AS scrapQty,
                CASE WHEN jc.isCompleted = 1 THEN COALESCE(sfg.sfgVerifiedQty, 0) END AS recievedQty,
                CASE WHEN jc.isCompleted = 1 THEN jc.verifiedBy END AS verifiedBy, 
                CASE 
                    WHEN jc.scRemark IS NOT NULL AND jc.scRemark <> '' 
                        THEN CONCAT('Shortclosed for ', jc.scRemark)
                    ELSE NULL
                END AS remark
            FROM job_card jc
            INNER JOIN items ON items.id = jc.itemId
            LEFT JOIN item_main_loc loc ON loc.id = items.mainLocation
            INNER JOIN mrp_mst mm ON mm.id = jc.mrpMstId
            INNER JOIN order_plannings op ON op.id = mm.orderPlnId
            LEFT JOIN item_product_family pfam ON pfam.id = items.productFamily
            LEFT JOIN item_product_finish pfin ON pfin.id = items.productFinish
            LEFT JOIN pm_inspeclist pi ON pi.jcId = jc.id AND pi.itemId = items.id
            LEFT JOIN sfg ON sfg.jcId = jc.id
            WHERE jc.jcNo = ?
            GROUP BY jc.id
            LIMIT 1
        `, [jcNo]);

        if (!jcRow) {
            return res.status(404).json({ success: false, message: 'Job card not found' });
        }

        const { jcId, itemId } = jcRow;

        const [processRows] = await connection.execute(`
            SELECT 
                ROW_NUMBER() OVER (ORDER BY jp.id) AS id,
                jp.jcId, jp.itemId, jp.processId, 
                jp.process, jp.machineName, 
                jp.acptQty, jp.producedQty, 
                jp.operator, COALESCE(jp.qa, pmInsPec.addedBy) AS qa, jp.prod_eng
            FROM jobcard_planning jp
            LEFT JOIN pm_inspeclist_mst pmInsPec ON pmInsPec.jcId = jp.jcId AND pmInsPec.itemId = jp.itemId AND pmInsPec.processId = jp.processId
            LEFT JOIN item_vs_pm ivp ON ivp.item = jp.itemId AND ivp.machineName = jp.machineId AND ivp.process = jp.processId
            WHERE jp.jcNo = ? AND ivp.dflag = 0
            ORDER BY ivp.processPriority
        `, [jcNo]);

        for (const process of processRows) {
            const [operatorDetails] = await connection.execute(`
                SELECT Operator_Name, DATE_FORMAT(Date_time, '%d-%m-%Y') AS date, Shift
                FROM operator_details
                WHERE Jobcard_Number = ? AND Machine_Name = ?
                ORDER BY id DESC LIMIT 1
            `, [jcNo, process.machineName]);

            if (operatorDetails.length > 0) {
                const { Operator_Name, date, Shift } = operatorDetails[0];
                process.operator = Operator_Name;
                process.date = date;
                process.shift = Shift;
            } else {
                process.date = null;
                process.shift = null;
            }
        }

        const [childParts] = await connection.execute(`
            SELECT 
                i.id, i.itemCode AS SITEMCODE, i.itemName AS SITEMNAME,
                i.materialThickness AS MTHICKNESS, 
                m.Qty AS QTY, m.Child_Produced_Qty
            FROM mrp m
            INNER JOIN items i ON i.id = m.itemId
            WHERE m.jcId = ? AND m.jcPart = 'Y'
        `, [jcId]);

        return res.status(200).json({
            success: true,
            message: 'JobCard details',
            jcDetails: [jcRow],
            processDetails: processRows,
            childParts
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.exportSchedules = async (req, res) => {
    try {
        const { mrpMstId = null, fromDate, toDate, type, part, thickness } = req.query;

        const { issued, completed, pending, filteredData } = await this.getJobCards(mrpMstId, fromDate, toDate, type, part, thickness);
        const percentage = ((completed / issued) * 100).toFixed(0);

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('JobCards');

        // Define columns with headers and widths
        worksheet.columns = [
            { header: 'Sl No', key: 'sNo', width: 10 },
            { header: 'Thickness', key: 'Thickness', width: 15 },
            { header: 'Mrp Id', key: 'MRPID', width: 20 },
            { header: 'Part No', key: 'PartNumber', width: 20 },
            { header: 'Description', key: 'Description', width: 20 },
            { header: 'Job Card No', key: 'JobCardNo', width: 20 },
            { header: 'Job Card Date', key: 'JobCardDate', width: 20 },
            { header: 'Added By', key: 'addedBy', width: 20 },
            { header: 'Product Type', key: 'ProductType', width: 20 },
            { header: 'UOM', key: 'UOM', width: 20 },
            { header: 'Qty', key: 'Qty', width: 20 },
            { header: 'Produced Qty', key: 'ProducedQty', width: 20 },
            { header: 'JC Type', key: 'jcType', width: 20 },
            { header: 'Status', key: 'status', width: 20 },
        ];

        // Style header row
        const headerRow = worksheet.getRow(1);
        headerRow.eachCell((cell) => {
            cell.font = { name: 'Cambria', color: { argb: '0625bf' }, bold: true, size: 12 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'e8eaeb' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        // Add data rows and apply alternating row colors
        addDataRows(worksheet, filteredData);

        // Fill column A with color
        fillColumnA(worksheet, 1);

        // Adding summary values for JC issued, pending, closed, and percentage
        const summaryStartRow = filteredData.length + 3;
        worksheet.getCell(`M${summaryStartRow}`).value = 'JC ISSUED';
        worksheet.getCell(`M${summaryStartRow + 1}`).value = 'JC PENDING';
        worksheet.getCell(`M${summaryStartRow + 2}`).value = 'JC CLOSED';
        worksheet.getCell(`M${summaryStartRow + 3}`).value = 'PERCENTAGE';

        worksheet.getCell(`N${summaryStartRow}`).value = issued;
        worksheet.getCell(`N${summaryStartRow + 1}`).value = pending;
        worksheet.getCell(`N${summaryStartRow + 2}`).value = completed;
        worksheet.getCell(`N${summaryStartRow + 3}`).value = `${Number(percentage)}%`;

        // Center-align all cells
        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });
        });

        // Apply borders to all cells
        // setBorder(worksheet);

        // Set headers for response
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=JC_report.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// Utility functions
const addDataRows = (worksheet, data) => {
    const alternatingRowColor = 'DFF4FA'; // Light blue

    let sNo = 1;
    data.forEach((row, index) => {
        const { Thickness, ...rest } = row;
        const newObj = { sNo, Thickness: Number(Thickness) || null, ...rest };

        const newRow = worksheet.addRow(newObj);

        // Apply fill for alternating rows (index 0, 2, 4, etc.)
        if (index % 2 === 0) {
            newRow.eachCell({ includeEmpty: true }, (cell) => {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: alternatingRowColor }
                };
            });
        }
        sNo++;
    });
};

const fillColumnA = (worksheet) => {
    const fillColor = 'e8eaeb'; // Background color for column A
    worksheet.getColumn(1).eachCell((cell, rowNumber) => {
        if (rowNumber > 1) { // Skip the header row
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        }
    });
};

// const setBorder = (worksheet) => {
//     worksheet.eachRow({ includeEmpty: true }, (row) => {
//         row.eachCell({ includeEmpty: true }, (cell) => {
//             cell.border = {
//                 top: { style: 'thin' },
//                 left: { style: 'thin' },
//                 bottom: { style: 'thin' },
//                 right: { style: 'thin' }
//             };
//         });
//         row.height = 18; // Set a consistent row height
//     });
// };

exports.pendingChildParts = async (req, res) => {
    try {
        const { fromDate, toDate, type = 'Pending' } = req.body;

        const whereClause = type === 'Pending' ? ' mrp.Child_Produced_Qty > ? AND mrp.Child_Produced_Qty < mrp.Qty' : ' mrp.Child_Produced_Qty = ?';
        const query = `
            SELECT 
                items.id, items.itemCode AS SITEMCODE, items.itemName AS SITEMNAME, items.materialThickness AS MTHICKNESS, items.material, mrp.Qty as QTY, mrp.id as mrpId, 
                mrp.Child_Produced_Qty as Child_Produced_Qty, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS KanbanDate, mrp.isCompleted, mrp.jcId, jc.jcNo as JC_No
            FROM mrp 
            INNER JOIN items ON items.id = mrp.itemId
            INNER JOIN order_plannings op ON op.id = mrp.orderPlnId
            INNER JOIN job_card jc ON jc.id = mrp.jcId
            WHERE date(op.kanbanDate) >= ? AND date(op.kanbanDate) <= ? AND ${whereClause}
        `;
        const [rows] = await connection.execute(query, [fromDate, toDate, 0]);

        return handleSuccessResponse(res, 'Pending Child Parts', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.shortCloseJc = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { jcIds = [], remark = "" } = req.body;
        const closedBy = await getUser(req);

        if (jcIds.length === 0) {
            throw new CustomError("No Job Cards selected for short close!", 400);
        }
        await conn.beginTransaction();

        const placeholders = jcIds.map(() => "?").join(",");

        const sql = `
            UPDATE job_card
            SET 
                isCompleted = 1,
                shortClosed = 1,
                scRemark = ?,
                scBy = ?,
                status = 'Completed'
            WHERE id IN (${placeholders})
        `;
        await conn.execute(sql, [remark.trim(), closedBy, ...jcIds]);

        await conn.execute(`UPDATE sf_schedule SET status = 1 WHERE jcId IN (${placeholders})`, jcIds);

        await conn.commit();

        return handleSuccessResponse(res, "Job Cards short closed successfully.");
    } catch (err) {
        if (conn) await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};

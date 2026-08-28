const { connection, handleSuccessResponse, CustomError } = require("../config/dbSql");
const asyncHandler = require("../utility/asyncHandler");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const { getTemplateData } = require("./checklistTemplate.controller");

exports.createChecklistMaster = asyncHandler(async (req, res) => {
    const { checklistName, description, documentVersion, templateId, createdBy } = req.body;

    if (!checklistName || !description || !documentVersion || !templateId) {
        throw new CustomError("Checklist Name, Description, Document Version, Template are required", 400);
    }

    const [result] = await connection.execute(
        `INSERT INTO checklists (checklist_name, description, document_version, template_id, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [checklistName, description, documentVersion, templateId, createdBy]
    );

    return handleSuccessResponse(res, "Checklist created successfully");
});

exports.getAllChecklistMasters = asyncHandler(async (req, res) => {
    const [rows] = await connection.execute(`SELECT * FROM checklists`);

    return handleSuccessResponse(res, "Checklists fetched successfully", rows);
});

exports.getChecklistMasterById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const [rows] = await connection.execute(`
        SELECT c.*, t.name as template_name
        FROM checklists c
        LEFT JOIN checklist_templates t ON c.template_id = t.id
        WHERE c.id = ?
    `, [id]);

    if (rows.length === 0) {
        throw new CustomError("Checklist not found", 404);
    }

    return handleSuccessResponse(res, "Checklist fetched successfully", rows);
});

exports.updateChecklistMaster = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { checklistName, description, documentVersion, templateId, fromDate, toDate } = req.body;

    if (!id) throw new CustomError("ID is required", 400);

    const fields = [];
    const values = [];

    if (checklistName !== undefined) { fields.push("checklist_name = ?"); values.push(checklistName); }
    if (description !== undefined) { fields.push("description = ?"); values.push(description); }
    if (documentVersion !== undefined) { fields.push("document_version = ?"); values.push(documentVersion); }
    if (templateId !== undefined) { fields.push("template_id = ?"); values.push(templateId); }

    if (fields.length === 0) {
        return handleSuccessResponse(res, "No fields to update");
    }

    values.push(id);

    const [result] = await connection.execute(
        `UPDATE checklists SET ${fields.join(", ")} WHERE id = ?`,
        values
    );

    if (result.affectedRows === 0) {
        throw new CustomError("Checklist not found or no changes made", 404);
    }

    return handleSuccessResponse(res, "Checklist updated successfully");
});

exports.deleteChecklistMaster = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id) throw new CustomError("ID is required", 400);

    const [result] = await connection.execute(`DELETE FROM checklists WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
        throw new CustomError("Checklist not found", 404);
    }

    return handleSuccessResponse(res, "Checklist deleted successfully");
});

// POST /api/checklist/master/:id/assign
exports.assignToolsToChecklist = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { toolId } = req.body;

    if (!id) throw new CustomError("Checklist ID is required", 400);
    if (!toolId) throw new CustomError("toolId is required", 400);

    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        await conn.execute(`DELETE FROM checklist_tool_map WHERE checklist_id = ?`, [id]);

        await conn.query(
            `INSERT INTO checklist_tool_map (checklist_id, tool_id) VALUES (?,?)`,
            [id, toolId]
        );

        await conn.commit();
        return handleSuccessResponse(res, "Tools assigned successfully");
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
});

// GET /api/checklist/master/:id/tools
exports.getAssignedTools = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id) throw new CustomError("Checklist ID is required", 400);

    const [rows] = await connection.execute(`
        SELECT t.* 
        FROM checklist_tool_map m
        JOIN tool t ON m.tool_id = t.id
        WHERE m.checklist_id = ?
    `, [id]);

    return handleSuccessResponse(res, "Assigned tools fetched successfully", rows);
});

// GET /api/checklist/master/tool/:toolId
exports.getMappedChecklistsByTool = asyncHandler(async (req, res) => {
    const { toolId } = req.params;

    if (!toolId) throw new CustomError("Tool ID is required", 400);

    const [rows] = await connection.execute(`
        SELECT c.*, t.name as template_name
        FROM checklist_tool_map m
        JOIN checklists c ON m.checklist_id = c.id
        LEFT JOIN checklist_templates t ON c.template_id = t.id
        WHERE m.tool_id = ?
    `, [toolId]);

    return handleSuccessResponse(res, "Mapped checklists fetched successfully", rows);
});

exports.exportChecklistMaster = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id) {
        throw new CustomError("Checklist ID is required", 400);
    }

    const [checklistRows] = await connection.execute(
        `SELECT template_id, checklist_name, document_version FROM checklists WHERE id = ?`,
        [id]
    );

    if (checklistRows.length === 0) {
        throw new CustomError("Checklist not found", 404);
    }

    const templateId = checklistRows[0].template_id;
    const checklistName = checklistRows[0].checklist_name;

    const templateData = await getTemplateData(templateId);

    if (!templateData) {
        throw new CustomError("Template not found", 404);
    }

    const { template, header, body, footer } = templateData;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Checklist");

    // =====================================================
    // ⚙️ DYNAMIC COLUMNS LOGIC
    // =====================================================
    const getDynamicColumns = (frequency) => {
        const freq = (frequency || '').toLowerCase().trim();
        if (freq === 'daily') {
            return Array.from({ length: 31 }, (_, i) => (i + 1).toString());
        }
        if (freq === 'monthly') {
            return ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
        }
        if (freq === 'quarterly') {
            return ['Q1 (Apr-Jun)', 'Q2 (Jul-Sep)', 'Q3 (Oct-Dec)', 'Q4 (Jan-Mar)'];
        }
        if (freq === 'semi annually' || freq === 'semi-annually' || freq === 'semiannually') {
            return ['H1 (Apr-Sep)', 'H2 (Oct-Mar)'];
        }
        if (freq === 'annually') {
            return [new Date().getFullYear().toString()];
        }
        return ['Answer'];
    };

    const answerCols = getDynamicColumns(template.frequency);
    const totalCols = 4 + answerCols.length;

    // 📐 SET COLUMN WIDTHS
    const numAnswerCols = answerCols.length;
    const columns = [
        { width: 10 }, // #
        { width: 50 }, // Checklist Item
        { width: 30 }, // Objective 1
        { width: 30 }, // Objective 2
    ];

    // Adaptive width: narrower if many columns (e.g. daily), wider if few (e.g. monthly/quarterly)
    const answerWidth = numAnswerCols > 12 ? 8 : 15;
    answerCols.forEach(() => columns.push({ width: answerWidth }));
    sheet.columns = columns;

    const thinBorder = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" }
    };

    let rowIndex = 1;

    // =====================================================
    // 🖼️ LOGO, 🟦 TITLE, & 📋 HEADER FIELDS (COMBINED BLOCK)
    // =====================================================
    const logoPath = path.resolve(__dirname, "../../public/logo/MallikLogo.png");
    const titleField = header.find(f => f.field_type === "TITLE");
    const nonTitleHeaders = header.filter(f => f.field_type !== "TITLE");

    const numHeaderRows = Math.max(3, nonTitleHeaders.length);

    for (let r = 1; r <= numHeaderRows; r++) {
        sheet.getRow(r).height = 25;
        for (let c = 1; c <= totalCols; c++) {
            sheet.getCell(r, c).border = thinBorder;
        }
    }

    // Metadata can be 1 or 2 columns wide depending on total columns available
    const useWideMetadata = totalCols >= 10;
    const logoTitleEndCol = useWideMetadata ? totalCols - 4 : totalCols - 2;

    if (logoTitleEndCol >= 1) {
        sheet.mergeCells(1, 1, numHeaderRows, logoTitleEndCol);
    }

    if (fs.existsSync(logoPath)) {
        const logoId = workbook.addImage({
            filename: logoPath,
            extension: "png"
        });
        sheet.addImage(logoId, {
            tl: { col: 0.5, row: 0.75 },
            ext: { width: 130, height: 45 },
            editAs: 'oneCell'
        });
    }

    if (titleField) {
        const titleCell = sheet.getCell(1, 1);
        titleCell.value = (titleField.value || titleField.label || checklistName).toUpperCase();
        titleCell.font = { size: 16, bold: true };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };
    }

    const [assignedTools] = await connection.execute(
        `SELECT t.toolNo, t.toolName 
         FROM checklist_tool_map m 
         JOIN tool t ON m.tool_id = t.id 
         WHERE m.checklist_id = ?`,
        [id]
    );
    const assignedTool = assignedTools[0] || {};

    for (let r = 1; r <= numHeaderRows; r++) {
        const labelStartCol = logoTitleEndCol + 1;
        const labelEndCol = useWideMetadata ? labelStartCol + 1 : labelStartCol;
        const valueStartCol = labelEndCol + 1;
        const valueEndCol = totalCols;

        if (labelStartCol !== labelEndCol) sheet.mergeCells(r, labelStartCol, r, labelEndCol);
        if (valueStartCol !== valueEndCol) sheet.mergeCells(r, valueStartCol, r, valueEndCol);

        const labelCell = sheet.getCell(r, labelStartCol);
        const valueCell = sheet.getCell(r, valueStartCol);

        labelCell.alignment = { horizontal: "center", vertical: "middle" };
        valueCell.alignment = { horizontal: "center", vertical: "middle" };

        if (r - 1 < nonTitleHeaders.length) {
            const field = nonTitleHeaders[r - 1];
            let labelText = field.label.toUpperCase();
            const labelClean = labelText.replace(/\s/g, '').replace(':', '');

            // Force "TOOL CODE" to become "TOOL NO" as per user request
            if (labelClean === "TOOLCODE" || labelClean === "TOOLNO" || labelClean === "ID") {
                labelText = "TOOL NO";
            }

            labelCell.value = `${labelText}:`;
            labelCell.font = { bold: true };

            let displayValue = field.value;
            if ((labelClean === 'TOOLNO' || labelClean === 'ID' || labelClean === 'TOOLCODE') && assignedTool.toolNo) {
                displayValue = assignedTool.toolNo;
            } else if (labelClean === 'TOOLNAME' && assignedTool.toolName) {
                displayValue = assignedTool.toolName;
            } else if (labelClean === 'DATE') {
                displayValue = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
            }

            valueCell.value = displayValue || "___________";
        } else {
            labelCell.value = "";
            valueCell.value = "";
        }
    }

    rowIndex = numHeaderRows + 1;

    // =====================================================
    // 🟨 TABLE HEADER
    // =====================================================
    const tableHeaderRow = sheet.getRow(rowIndex);
    tableHeaderRow.height = 30;

    const headerValues = [
        "#",
        "Checklist Item",
        "Objective 1",
        "Objective 2",
        ...answerCols
    ];
    tableHeaderRow.values = headerValues;
    tableHeaderRow.font = { bold: true };

    for (let c = 1; c <= totalCols; c++) {
        const cell = sheet.getCell(rowIndex, c);
        cell.border = thinBorder;
        cell.alignment = { horizontal: "center", vertical: "middle" };
    }

    rowIndex++;

    // =====================================================
    // 🟨 BODY ITEMS
    // =====================================================
    body.forEach((item, index) => {
        const row = sheet.getRow(rowIndex);
        row.height = 25;

        const rowValues = [
            index + 1,
            item.question,
            item.objective_1,
            item.objective_2,
            ...answerCols.map(() => "")
        ];
        row.values = rowValues;

        for (let c = 1; c <= totalCols; c++) {
            const cell = sheet.getCell(rowIndex, c);
            cell.border = thinBorder;
            cell.alignment = { vertical: "middle" };
            if (c === 1) {
                cell.alignment = { horizontal: "center", vertical: "middle" };
            }
        }

        rowIndex++;
    });

    // =====================================================
    // 🟩 FOOTER (GRID BOX)
    // =====================================================
    footer.forEach(field => {
        const row = sheet.getRow(rowIndex);
        row.height = 30;

        // Merge columns 1 & 2 for the label to prevent cutoff
        sheet.mergeCells(rowIndex, 1, rowIndex, 2);
        const labelCell = sheet.getCell(rowIndex, 1);
        labelCell.value = (field.label || "").toUpperCase();
        labelCell.font = { bold: true };
        labelCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };

        // Merge column 3 to end for the signature/value area
        sheet.mergeCells(rowIndex, 3, rowIndex, totalCols);
        const valueCell = sheet.getCell(rowIndex, 3);
        valueCell.value = "__________________________________________________";
        valueCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };

        // Apply borders across the whole footer row width
        for (let c = 1; c <= totalCols; c++) {
            sheet.getCell(rowIndex, c).border = thinBorder;
        }

        rowIndex++;
    });

    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
        "Content-Disposition",
        `attachment; filename=${checklistName || template.name}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
});


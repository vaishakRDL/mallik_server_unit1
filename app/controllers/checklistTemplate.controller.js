const { connection, handleSuccessResponse, CustomError } = require("../config/dbSql");
const asyncHandler = require("../utility/asyncHandler");

exports.createTemplate = asyncHandler(async (req, res) => {
    const { name, description, frequency, entity_type = 'Tool' } = req.body;

    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        const [result] = await conn.execute(`
            INSERT INTO checklist_templates 
            (name, description, frequency, entity_type)
            VALUES (?, ?, ?, ?)
        `, [name, description, frequency, entity_type]);

        const templateId = result.insertId;

        const sections = ["HEADER", "BODY", "FOOTER"];

        const values = sections.map((sec, i) => [
            templateId,
            sec,
            i
        ]);

        await conn.query(`
            INSERT INTO checklist_template_sections
            (template_id, section, order_index)
            VALUES ?
        `, [values]);

        await conn.commit();

        return handleSuccessResponse(res, "Template created successfully", templateId);
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
});

exports.updateTemplate = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, frequency, entity_type } = req.body;

    if (!id) {
        throw new CustomError("Template ID is required", 400);
    }

    const fields = [];
    const values = [];

    if (name !== undefined) { fields.push("name = ?"); values.push(name); }
    if (description !== undefined) { fields.push("description = ?"); values.push(description); }
    if (frequency !== undefined) { fields.push("frequency = ?"); values.push(frequency); }
    if (entity_type !== undefined) { fields.push("entity_type = ?"); values.push(entity_type); }

    if (fields.length === 0) {
        return handleSuccessResponse(res, "No fields to update");
    }

    values.push(id);

    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        const [result] = await conn.execute(
            `UPDATE checklist_templates SET ${fields.join(", ")} WHERE id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            throw new CustomError("Template not found", 404);
        }

        await conn.commit();

        return handleSuccessResponse(res, "Template updated successfully");
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
});

exports.deleteTemplate = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id) {
        throw new CustomError("Template ID is required", 400);
    }

    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        // Delete checklist items
        await conn.execute(`DELETE FROM checklist_items WHERE template_id = ?`, [id]);

        // Delete template fields mapped via sections
        await conn.execute(`
            DELETE f FROM checklist_template_fields f
            INNER JOIN checklist_template_sections s ON f.section_id = s.id
            WHERE s.template_id = ?
        `, [id]);

        // Delete template sections
        await conn.execute(`DELETE FROM checklist_template_sections WHERE template_id = ?`, [id]);

        // Delete the template itself
        const [result] = await conn.execute(`DELETE FROM checklist_templates WHERE id = ?`, [id]);

        if (result.affectedRows === 0) {
            throw new CustomError("Template not found", 404);
        }

        await conn.commit();

        return handleSuccessResponse(res, "Template deleted successfully");
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
});

exports.fetchTemplate = asyncHandler(async (req, res) => {

    const [result] = await connection.execute(
        `SELECT * FROM checklist_templates`
    );

    return handleSuccessResponse(res, "Template fetched successfully", result);
});

exports.getSectionsById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id) {
        throw new CustomError("Template ID is required", 400);
    }

    const [result] = await connection.execute(
        `SELECT * FROM checklist_template_sections WHERE template_id = ?`,
        [id]
    );

    return handleSuccessResponse(res, "Template sections fetched successfully", result);
});

exports.addFields = asyncHandler(async (req, res) => {
    const { sectionId, fields } = req.body;

    if (!sectionId || !Array.isArray(fields) || fields.length === 0) {
        throw new CustomError("sectionId and a non-empty fields array are required", 400);
    }

    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        await conn.execute(
            `DELETE FROM checklist_template_fields WHERE section_id = ?`,
            [sectionId]
        );

        const values = fields.map((f, i) => [
            sectionId,
            f.label,
            f.value || null,
            f.field_type,
            f.is_required || 0,
            i
        ]);

        await conn.query(
            `INSERT INTO checklist_template_fields (section_id, label, value, field_type, is_required, order_index) VALUES ?`,
            [values]
        );

        await conn.commit();

        return handleSuccessResponse(res, "Fields saved successfully");
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
});

exports.addChecklistItems = asyncHandler(async (req, res) => {
    const { templateId, items } = req.body;

    if (!templateId || !Array.isArray(items) || items.length === 0) {
        throw new CustomError("templateId and a non-empty items array are required", 400);
    }

    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        // Remove existing items for this template to prevent duplicates
        await conn.execute(
            `DELETE FROM checklist_items WHERE template_id = ?`,
            [templateId]
        );

        const values = items.map((item, i) => [
            templateId,
            item.question,
            item.objective_1,
            item.objective_2,
            item.question_type || 'NORMAL',
            item.answer_type,
            i
        ]);

        await conn.query(
            `INSERT INTO checklist_items (template_id, question, objective_1, objective_2, question_type, answer_type, order_index) VALUES ?`,
            [values]
        );

        await conn.commit();

        return handleSuccessResponse(res, "Checklist items saved successfully");
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
});

exports.getTemplateData = async (id) => {
    if (!id) {
        throw new CustomError("Template ID is required", 400);
    }

    const conn = await connection.getConnection();

    try {
        // Template
        const [templateRows] = await conn.execute(`
            SELECT id, name, frequency, entity_type
            FROM checklist_templates
            WHERE id = ?
        `, [id]);

        if (templateRows.length === 0) {
            throw new CustomError("Template not found", 404);
        }

        // Fields (HEADER + FOOTER)
        const [fieldRows] = await conn.execute(`
            SELECT 
                s.section,
                f.id,
                f.label,
                f.value,
                f.field_type,
                f.order_index
            FROM checklist_template_sections s
            LEFT JOIN checklist_template_fields f 
                ON f.section_id = s.id
            WHERE s.template_id = ?
            ORDER BY s.order_index, f.order_index
        `, [id]);

        // Items (BODY)
        const [itemRows] = await conn.execute(`
            SELECT 
                id,
                question,
                objective_1,
                objective_2,
                answer_type,
                order_index
            FROM checklist_items
            WHERE template_id = ?
            ORDER BY order_index
        `, [id]);

        const header = [];
        const footer = [];

        fieldRows.forEach(f => {
            if (!f.id) return;

            if (f.section === "HEADER") header.push(f);
            if (f.section === "FOOTER") footer.push(f);
        });

        return {
            template: templateRows[0],
            header,
            body: itemRows,
            footer
        };

    } finally {
        conn.release();
    }
};

exports.getTemplate = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const data = await this.getTemplateData(id);
    return handleSuccessResponse(res, "Template fetched successfully", data);
});

exports.getSectionFields = asyncHandler(async (req, res) => {
    const { sectionId } = req.params;

    if (!sectionId) {
        throw new CustomError("Section ID is required", 400);
    }

    const [result] = await connection.execute(
        `SELECT id, label, value, field_type, is_required, order_index 
         FROM checklist_template_fields 
         WHERE section_id = ? 
         ORDER BY order_index`,
        [sectionId]
    );

    return handleSuccessResponse(res, "Section fields fetched successfully", result);
});

exports.getTemplateItems = asyncHandler(async (req, res) => {
    const { templateId } = req.params;

    if (!templateId) {
        throw new CustomError("Template ID is required", 400);
    }

    const [result] = await connection.execute(
        `SELECT id, question, objective_1, objective_2, question_type, answer_type, order_index 
         FROM checklist_items 
         WHERE template_id = ? 
         ORDER BY order_index`,
        [templateId]
    );

    return handleSuccessResponse(res, "Template items fetched successfully", result);
});

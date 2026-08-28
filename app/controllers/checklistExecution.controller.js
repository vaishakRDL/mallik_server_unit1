const { connection, handleSuccessResponse, CustomError } = require("../config/dbSql");
const asyncHandler = require("../utility/asyncHandler");

// POST /api/checklist/generate
exports.generateChecklist = asyncHandler(async (req, res) => {
    const { templateId, entityType, entityId, date, userId } = req.body;

    if (!templateId || !entityType || !entityId || !date || !userId) {
        throw new CustomError("templateId, entityType, entityId, date, and userId are required", 400);
    }

    try {
        const [result] = await connection.execute(
            `INSERT INTO checklists (template_id, entity_type, entity_id, checklist_date, created_by) VALUES (?, ?, ?, ?, ?)`,
            [templateId, entityType, entityId, date, userId]
        );

        return res.status(200).json({
            success: true,
            message: "Checklist generated successfully",
            checklistId: result.insertId
        })
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            throw new CustomError("Checklist already exists for this entity and date", 400);
        }
        throw err;
    }
});

// GET /api/checklist?entityType=TOOL&entityId=1&date=2026-03-21
exports.getChecklist = asyncHandler(async (req, res) => {
    const { entityType, entityId, date } = req.query;

    if (!entityType || !entityId || !date) {
        throw new CustomError("entityType, entityId, and date are required", 400);
    }

    const [rows] = await connection.execute(`
        SELECT
            c.id AS checklist_id,
            t.name,
            i.id AS item_id,
            i.question,
            i.objective_1,
            i.objective_2,
            i.answer_type,
            r.answer,
            r.remarks
        FROM checklists c
        JOIN checklist_templates t ON t.id = c.template_id
        JOIN checklist_items i ON i.template_id = t.id
        LEFT JOIN checklist_responses r ON r.item_id = i.id AND r.checklist_id = c.id
        WHERE c.entity_type = ?
          AND c.entity_id = ?
          AND c.checklist_date = ?
        ORDER BY i.order_index
    `, [entityType, entityId, date]);

    return handleSuccessResponse(res, "Checklist fetched successfully", rows);
});

// GET /api/checklist/:id
exports.getExecutionData = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id) throw new CustomError("Checklist ID is required", 400);

    // 1. Fetch Checklist Master and Template Info (Metadata)
    const [checklistRows] = await connection.execute(`
        SELECT c.id, c.template_id, t.name AS template_name, t.frequency, c.status
        FROM checklists c
        JOIN checklist_templates t ON t.id = c.template_id
        WHERE c.id = ?
    `, [id]);

    if (checklistRows.length === 0) {
        throw new CustomError("Checklist not found", 404);
    }

    const checklist = checklistRows[0];

    // 2. Fetch All Items for this template
    const [itemRows] = await connection.execute(`
        SELECT id, question, objective_1, objective_2, answer_type, order_index
        FROM checklist_items
        WHERE template_id = ?
        ORDER BY order_index
    `, [checklist.template_id]);

    // 3. Fetch All Responses for this checklist instance
    const [responseRows] = await connection.execute(`
        SELECT item_id, column_index, answer, remarks
        FROM checklist_responses
        WHERE checklist_id = ?
    `, [id]);

    // 4. Group Responses by Item ID
    const responsesByItem = {};
    responseRows.forEach(r => {
        if (!responsesByItem[r.item_id]) {
            responsesByItem[r.item_id] = [];
        }
        responsesByItem[r.item_id].push({
            column: r.column_index,
            answer: r.answer,
            remarks: r.remarks
        });
    });

    // 5. Attach Responses to the Items
    const items = itemRows.map(item => ({
        ...item,
        responses: responsesByItem[item.id] || []
    }));

    return handleSuccessResponse(res, "Execution data fetched successfully", {
        checklistDetails: checklist,
        items: items
    });
});

// POST /api/checklist/submit
exports.submitChecklist = asyncHandler(async (req, res) => {
    const { checklistId, responses } = req.body;

    if (!checklistId || !Array.isArray(responses) || responses.length === 0) {
        throw new CustomError("checklistId and a non-empty responses array are required", 400);
    }

    const conn = await connection.getConnection();

    try {
        await conn.beginTransaction();

        // Map responses to bulk query values: [checklist_id, item_id, column_index, answer, remarks]
        const values = responses.map(r => [
            checklistId,
            r.item_id,
            r.column || '1',
            r.answer,
            r.remarks || null
        ]);

        await conn.query(`
            INSERT INTO checklist_responses (checklist_id, item_id, column_index, answer, remarks)
            VALUES ?
            ON DUPLICATE KEY UPDATE
                answer  = VALUES(answer),
                remarks = VALUES(remarks)
        `, [values]);

        await conn.commit();

        return handleSuccessResponse(res, "Grid checklist submitted successfully");
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
});

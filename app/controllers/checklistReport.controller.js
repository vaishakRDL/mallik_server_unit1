const { connection, handleSuccessResponse, CustomError } = require("../config/dbSql");
const asyncHandler = require("../utility/asyncHandler");

// GET /api/checklist/report
exports.getChecklistReport = asyncHandler(async (req, res) => {
    const { fromDate, toDate, toolId, machineId } = req.query;

    let query = `
        SELECT 
            c.id,
            ROW_NUMBER() OVER (ORDER BY c.created_at DESC) AS srNo,
            t.toolNo,
            t.toolName,
            m.machineCode,
            ct.name AS checklistName,
            DATE_FORMAT(c.created_at, '%d-%m-%Y') AS checklistDate,
            c.status,
            COUNT(CASE WHEN r.answer = 'NOK' THEN 1 END) AS issueCount
        FROM checklists c
        JOIN checklist_tool_map ctm ON c.id = ctm.checklist_id
        JOIN tool t ON ctm.tool_id = t.id
        JOIN machines m ON t.machineId = m.id
        JOIN checklist_templates ct ON c.template_id = ct.id
        LEFT JOIN checklist_responses r ON r.checklist_id = c.id
        WHERE 1=1
    `;

    const params = [];

    if (fromDate && toDate) {
        query += ` AND c.created_at BETWEEN ? AND ?`;
        params.push(fromDate, toDate);
    }

    if (toolId) {
        query += ` AND t.id = ?`;
        params.push(toolId);
    }

    if (machineId) {
        query += ` AND m.id = ?`;
        params.push(machineId);
    }

    query += ` GROUP BY c.id ORDER BY c.created_at DESC`;

    const [rows] = await connection.execute(query, params);

    return handleSuccessResponse(res, "Checklist report fetched successfully", rows);
});

// GET /api/checklist/report/kpi
exports.getChecklistKPIs = asyncHandler(async (req, res) => {
    const { fromDate, toDate } = req.query;

    let query = `
        SELECT 
            COUNT(id) AS total_checklists,
            SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_checklists,
            (SELECT COUNT(*) FROM checklist_responses WHERE answer = 'NOK' AND created_at BETWEEN ? AND ?) AS total_issues
        FROM checklists
        WHERE checklist_date BETWEEN ? AND ?
    `;

    const params = [
        fromDate || '1970-01-01', toDate || '2099-12-31',
        fromDate || '1970-01-01', toDate || '2099-12-31'
    ];

    const [rows] = await connection.execute(query, params);

    return handleSuccessResponse(res, "KPIs fetched successfully", rows[0]);
});


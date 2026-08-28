const { handleSuccessResponse, connection, CustomError, secondaryDB } = require("../config/dbSql");
const asyncHandler = require("../utility/asyncHandler");
const { getUser } = require("../utility/utilityFunction");

exports.getMaintenanceSchedule = asyncHandler(async (req, res) => {
    const { status = 'Pending' } = req.query;

    const [rows] = await connection.execute(`
        SELECT 
            m.id, 
            ROW_NUMBER() OVER (ORDER BY m.id) AS sNo,
            mach.machineName AS machine, 
            t.id AS toolId,
            t.toolNo, 
            m.maintenance_type, 
            m.severity, 
            m.problem_note, 
            DATE_FORMAT(m.created_at, '%d-%m-%Y') AS scheduleDate,
            DATE_FORMAT(m.created_at, '%h:%i %p') AS scheduleTime,
            GROUP_CONCAT(DISTINCT am.machineName ORDER BY am.machineName SEPARATOR ', ') AS affectedMachines,
            u.userName AS supervisor,
            m.problem_category,
            m.problem_nature,
            m.problem_note,
            m.manpower_mode,
            m.manpower_count,
            m.schedule_type
        FROM maintenance m
        LEFT JOIN maintenance_affected_machines ms 
            ON m.id = ms.maintenance_id
        LEFT JOIN machines mach  
            ON mach.id = m.machine_id
        LEFT JOIN machines am
            ON am.id = ms.affected_machine_id
        LEFT JOIN tool t 
            ON t.id = m.tool_id
        LEFT JOIN users u 
            ON u.id = m.supervisor_id
        WHERE m.status = ?
        GROUP BY m.id
    `, [status]);

    return handleSuccessResponse(res, "Schedules fetched successfully", rows);
});

exports.getMaintenanceDetails = asyncHandler(async (req, res) => {
    const { scheduleId } = req.query;

    const consumableQuery = `
        SELECT id, type, name, part, quantity, unit, total_amount 
        FROM maintenance_parts
        WHERE maintenance_id = ?
    `;

    const imagesQuesry = `
        SELECT image_path FROM maintenance_images
        WHERE maintenance_id = ?
    `;

    const [[consumables], [images]] = await Promise.all([
        connection.execute(consumableQuery, [scheduleId]),
        connection.execute(imagesQuesry, [scheduleId])
    ]);

    return res.status(200).json({
        success: true,
        message: "Maintenance details fetched successfully",
        consumables,
        images
    });
});

exports.createMaintenanceSchedule = asyncHandler(async (req, res) => {
    const conn = await connection.getConnection();

    try {
        let {
            machine_id,
            tool_id,
            maintenance_type,
            severity,
            problem_category,
            problem_nature,
            problem_note,
            affectedMachines = [],
            operatorsId = [],
            from_datetime,
            to_datetime,
            supervisor_id,
            schedule_type = 'Runtime',
            manpower_mode = 'Man Hours',
            scheduleDetails = []
        } = req.body;

        if (typeof scheduleDetails === "string") {
            scheduleDetails = JSON.parse(scheduleDetails);
        }
        if (typeof affectedMachines === "string") {
            affectedMachines = JSON.parse(affectedMachines);
        }
        if (typeof operatorsId === "string") {
            operatorsId = JSON.parse(operatorsId);
        }

        const maintenanceTypeObj = {
            'BreakDown': 'Breakdown',
            'Preventive Maintenance': 'Preventive',
            'Conditions Based Maintenance': 'Corrective'
        }

        const uploadedImages = req.uploadedImages || {};
        const imagePaths = Object.values(uploadedImages).filter(path => path != null);
        const createdBy = await getUser(req);

        await conn.beginTransaction();

        // 1. Insert into maintenance
        const maintenanceSql = `
            INSERT INTO maintenance (
                machine_id, tool_id, maintenance_type, severity,
                problem_category, problem_nature, problem_note,
                schedule_type, from_datetime, to_datetime,
                manpower_mode, manpower_count,
                supervisor_id, status, created_by
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
        `;
        const [maintenanceResult] = await conn.execute(maintenanceSql, [
            machine_id, tool_id, maintenanceTypeObj[maintenance_type] || null, severity || null,
            problem_category || null, problem_nature || null, problem_note || null,
            schedule_type || null, from_datetime || null, to_datetime || null,
            manpower_mode || null, operatorsId.length || 0,
            supervisor_id || null, createdBy
        ]);
        const maintenanceId = maintenanceResult.insertId;

        // 2. Insert images if any
        if (imagePaths.length > 0) {
            const imageSql = `INSERT INTO maintenance_images (maintenance_id, image_path) VALUES ?`;
            const imageValues = imagePaths.map(path => [maintenanceId, path]);
            await conn.query(imageSql, [imageValues]);
        }

        // 3. Insert into maintenance_parts (formerly maintenance_details)
        if (scheduleDetails.length > 0) {
            const partSql = `
                INSERT INTO maintenance_parts (maintenance_id, type, name, part, quantity, unit, unit_price)
                VALUES ?
            `;
            const partValues = scheduleDetails.map(detail => [
                maintenanceId,
                detail.type || 'Part',
                detail.name,
                detail.part,
                detail.qty,
                detail.unit,
                detail.unitPrice
            ]);
            await conn.query(partSql, [partValues]);
        }

        // 4. Insert into maintenance_affected_machines for each affected machine
        if (affectedMachines.length > 0) {
            const affectedSql = `
                INSERT INTO maintenance_affected_machines (maintenance_id, affected_machine_id)
                VALUES ?
            `;
            const affectedValues = affectedMachines.map(m => [
                maintenanceId,
                m.machineId || m
            ]);
            await conn.query(affectedSql, [affectedValues]);
        }

        // 5. Insert into maintenance_manpower
        if (operatorsId.length > 0) {
            const manpowerSql = `
                INSERT INTO maintenance_manpower (maintenance_id, employee_id, employee_name)
                VALUES ?
            `;
            const manpowerValues = operatorsId.map(op => [
                maintenanceId,
                op.id,
                op.name || op.operatorName // Supporting 'name' or 'operatorName' from lookup
            ]);
            await conn.query(manpowerSql, [manpowerValues]);
        }

        await conn.commit();

        return handleSuccessResponse(res, "Maintenance schedule and related records created successfully", { id: maintenanceId });
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
});

exports.supervisorList = asyncHandler(async (req, res) => {
    const [roles] = await connection.execute(`
        SELECT id FROM mst_role
        WHERE name = ?
    `, ['Tool & DIE MAKING']);

    if (roles.length === 0) {
        return handleSuccessResponse(res, "No supervisors found for the given role", []);
    }

    const ids = roles.map(role => role.id);
    const placeholders = ids.map(() => "?").join(",");

    const [rows] = await connection.execute(`
        SELECT id, userName as name FROM users WHERE userRole IN (${placeholders})
    `, ids);

    return handleSuccessResponse(res, "Supervisors fetched successfully", rows);
});

exports.machineList = asyncHandler(async (req, res) => {
    const [rows] = await connection.execute(`
        SELECT id, machineName as name FROM machines
    `);

    return handleSuccessResponse(res, "Machines fetched successfully", rows);
});

exports.operatorList = asyncHandler(async (req, res) => {
    const [rows] = await secondaryDB.execute(`
        SELECT id, operatorName name FROM operator
    `);

    return handleSuccessResponse(res, "Operators fetched successfully", rows);
});

exports.processMaintenanceSchedule = asyncHandler(async (req, res) => {
    const { scheduleId, status } = req.body;

    if (!scheduleId || !status) {
        throw new CustomError("Schedule ID and status (approve/reject) are required!", 400);
    }

    const statusObj = {
        approve: 'Approved',
        reject: 'Rejected'
    }

    const targetStatus = statusObj[status];
    if (!targetStatus) {
        throw new CustomError("Invalid status! Use 'approve' or 'reject'.", 400);
    }

    await connection.execute(
        `UPDATE maintenance SET status = ? WHERE id = ?`,
        [targetStatus, scheduleId]
    );

    const message = status === 'approve'
        ? "Maintenance schedule approved successfully!"
        : "Maintenance schedule rejected successfully!";

    return handleSuccessResponse(res, message);
});

exports.getBreakdownMaintenanceRecords = asyncHandler(async (req, res) => {
    const { from_date, to_date } = req.query;

    let conditions = [`m.maintenance_type = 'Breakdown'`];
    const params = [];

    if (from_date) {
        conditions.push(`DATE(m.created_at) >= ?`);
        params.push(from_date);
    }
    if (to_date) {
        conditions.push(`DATE(m.created_at) <= ?`);
        params.push(to_date);
    }

    const whereClause = conditions.join(' AND ');

    const [rows] = await connection.execute(`
        SELECT
            m.id,
            DATE_FORMAT(m.created_at, '%d-%m-%Y') AS date,
            mach.machineCode AS mc_code,
            mach.machineName AS machine_name,
            t.toolNo AS tool_no,
            m.problem_nature AS breakdown_details,
            m.problem_note AS corrective_action,
            m.problem_category AS cause,
            DATE_FORMAT(m.from_datetime, '%d-%m-%Y %h:%i %p') AS time_of_failure,
            DATE_FORMAT(m.to_datetime, '%d-%m-%Y %h:%i %p') AS time_of_completion,
            TIMESTAMPDIFF(MINUTE, m.from_datetime, m.to_datetime) AS duration_minutes,
            GROUP_CONCAT(mp.employee_name ORDER BY mp.id SEPARATOR ', ') AS attended_by
        FROM maintenance m
        LEFT JOIN machines mach ON mach.id = m.machine_id
        LEFT JOIN tool t ON t.id = m.tool_id
        LEFT JOIN maintenance_manpower mp ON mp.maintenance_id = m.id
        WHERE ${whereClause}
        GROUP BY m.id, mach.machineCode, mach.machineName, t.toolNo,
                 m.problem_nature, m.problem_note, m.problem_category,
                 m.from_datetime, m.to_datetime
        ORDER BY m.created_at DESC
    `, params);

    return handleSuccessResponse(res, "Breakdown records fetched successfully", rows);
});

exports.getMTBFReport = asyncHandler(async (req, res) => {
    const { from_date, to_date } = req.query;

    // Optional date filter to scope breakdowns
    let breakdownFilter = `m.maintenance_type = 'Breakdown'`;
    const params = [];

    if (from_date) {
        breakdownFilter += ` AND DATE(m.from_datetime) >= ?`;
        params.push(from_date);
    }
    if (to_date) {
        breakdownFilter += ` AND DATE(m.from_datetime) <= ?`;
        params.push(to_date);
    }

    const [rows] = await connection.execute(`
        SELECT
            t.id AS tool_id,
            t.toolNo,
            t.toolName,
            DATE_FORMAT(t.created_at, '%d-%m-%Y') AS date_of_install,
            DATEDIFF(NOW(), t.created_at) AS operation_days,
            -- 24 hours/day * operation days
            (DATEDIFF(NOW(), t.created_at) * 24) AS operation_hrs,
            COUNT(m.id) AS breakdown_count,
            COALESCE(SUM(TIMESTAMPDIFF(HOUR, m.from_datetime, m.to_datetime)), 0) AS breakdown_hrs,
            CASE
                WHEN COUNT(m.id) > 0 THEN
                    ROUND(
                        (
                            (DATEDIFF(NOW(), t.created_at) * 24)
                            - COALESCE(SUM(TIMESTAMPDIFF(HOUR, m.from_datetime, m.to_datetime)), 0)
                        ) / COUNT(m.id),
                    2)
                ELSE NULL
            END AS mtbf
        FROM tool t
        LEFT JOIN maintenance m
            ON m.tool_id = t.id AND ${breakdownFilter}
        GROUP BY t.id, t.toolNo, t.toolName, t.created_at
        ORDER BY t.toolNo ASC
    `, params);

    return handleSuccessResponse(res, "MTBF report fetched successfully", rows);
});


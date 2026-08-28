const { connection, CustomError, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');

exports.getShift = async (req, res) => {
    try {
        const sql = `
            SELECT *
            FROM shfit_mst
            WHERE status = 1
              AND dflag = 0
            ORDER BY id ASC
        `;

        const [rows] = await connection.execute(sql);

        return handleSuccessResponse(res, "Shift labels list", rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const mach = req.body;
        const day = mach.days || {};

        const shiftJson = JSON.stringify(mach.shift || []);
        const shiftV2 = (mach.shift || []).join(", ");
        const daysJson = JSON.stringify(day);

        await conn.beginTransaction();

        /* -------------------- INSERT INTO machines -------------------- */
        const machineSql = `
            INSERT INTO machines (
                machineName, machineCode, machineOperator, machOperatorInt,
                efficiency, utilization, capOrTarget, utilizationUnit,
                days, mon, tue, wed, thu, fri, sat,
                time, shift, shift2, machHrRate
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await conn.execute(machineSql, [
            mach.machName,
            mach.machCode,
            JSON.stringify(mach.machOperator || []),
            JSON.stringify(mach.machOperatorInt || []),
            mach.efficiency,
            mach.utilization,
            mach.capOrTarget,
            mach.utilizationUnit,
            daysJson,
            day.Monday,
            day.Tuesday,
            day.Wednesday,
            day.Thursday,
            day.Friday,
            day.Saturday,
            mach.time,
            shiftJson,
            shiftV2,
            mach.machHrRate
        ]);

        /* ---------------- INSERT INTO machines_vs_pm_uom ---------------- */
        const operators = mach.machOperatorInt || [];

        if (operators.length) {
            const values = operators.map(op => [
                mach.machName,
                mach.machCode,
                op,
                mach.efficiency,
                mach.utilization,
                mach.capOrTarget,
                mach.utilizationUnit,
                daysJson,
                day.Monday,
                day.Tuesday,
                day.Wednesday,
                day.Thursday,
                day.Friday,
                day.Saturday,
                mach.time,
                shiftJson,
                mach.machHrRate
            ]);

            const placeholders = values.map(() =>
                `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).join(",");

            const pmSql = `
                INSERT INTO machines_vs_pm_uom (
                    machineName, machineCode, machineOperator,
                    efficiency, utilization, capOrTarget, utilizationUnit,
                    days, mon, tue, wed, thu, fri, sat,
                    time, shift, machHrRate
                ) VALUES ${placeholders}
            `;

            await conn.execute(pmSql, values.flat());
        }

        await conn.commit();

        return handleSuccessResponse(res, "Machine added successfully");
    } catch (err) {
        await conn.rollback();

        if (err.code === "ER_DUP_ENTRY") {
            throw new CustomError("Machine code already exists!");
        }

        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.update = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { id } = req.params;
        const mach = req.body;

        if (!id) {
            throw new CustomError("Machine ID is required", 400);
        }

        const day = mach.days || {};
        const daysJson = JSON.stringify(day);
        const shiftJson = JSON.stringify(mach.shift || []);
        const shiftV2 = (mach.shift || []).join(", ");

        await conn.beginTransaction();

        const [[existing]] = await conn.execute(
            `SELECT machineCode FROM machines WHERE id = ? AND dflag = 0`,
            [id]
        );

        if (!existing) {
            throw new CustomError("Machine not found", 404);
        }

        const oldMachineCode = existing.machineCode;

        await conn.execute(
            `DELETE FROM machines_vs_pm_uom WHERE machineCode = ?`,
            [oldMachineCode]
        );

        const updateSql = `
            UPDATE machines SET
                machineName = ?, machineCode = ?, machineOperator = ?, machOperatorInt = ?,
                efficiency = ?, utilization = ?, capOrTarget = ?, utilizationUnit = ?,
                days = ?, mon = ?, tue = ?, wed = ?, thu = ?, fri = ?, sat = ?,
                time = ?, shift = ?, shift2 = ?, machHrRate = ?
            WHERE id = ?
        `;

        await conn.execute(updateSql, [
            mach.machName,
            mach.machCode,
            JSON.stringify(mach.machOperator || []),
            JSON.stringify(mach.machOperatorInt || []),
            mach.efficiency,
            mach.utilization,
            mach.capOrTarget,
            mach.utilizationUnit,
            daysJson,
            day.Monday,
            day.Tuesday,
            day.Wednesday,
            day.Thursday,
            day.Friday,
            day.Saturday,
            mach.time,
            shiftJson,
            shiftV2,
            mach.machHrRate,
            id
        ]);

        /* ---------- Re-insert PM mappings ---------- */
        const operators = mach.machOperatorInt || [];

        if (operators.length) {
            const values = operators.map(op => [
                mach.machName,
                mach.machCode,
                op,
                mach.efficiency,
                mach.utilization,
                mach.capOrTarget,
                mach.utilizationUnit,
                daysJson,
                day.Monday,
                day.Tuesday,
                day.Wednesday,
                day.Thursday,
                day.Friday,
                day.Saturday,
                mach.time,
                shiftJson,
                mach.machHrRate
            ]);

            const placeholders = values.map(() =>
                `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).join(",");

            const pmSql = `
                INSERT INTO machines_vs_pm_uom (
                    machineName, machineCode, machineOperator,
                    efficiency, utilization, capOrTarget, utilizationUnit,
                    days, mon, tue, wed, thu, fri, sat,
                    time, shift, machHrRate
                ) VALUES ${placeholders}
            `;

            await conn.execute(pmSql, values.flat());
        }
        await conn.commit();

        return handleSuccessResponse(res, "Successfully updated");
    } catch (err) {
        await conn.rollback();

        if (err.code === "ER_DUP_ENTRY") {
            err =  new CustomError("Machine code already exists!", 400);
        }

        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.delete = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { id } = req.params;

        if (!id) {
            throw new CustomError("Machine ID is required", 400);
        }

        await conn.beginTransaction();

        const [[machine]] = await conn.execute(
            `SELECT id as machineId, machineCode FROM machines WHERE id = ?`,
            [id]
        );

        if (!machine) {
            throw new CustomError("Machine not found", 404);
        }

        const { machineId, machineCode } = machine;

        await conn.execute(
            `DELETE FROM machines WHERE id = ?`,
            [id]
        );

        await conn.execute(
            `DELETE FROM machines_vs_pm_uom WHERE machineCode = ?`,
            [machineCode]
        );

        await conn.execute(
            `DELETE FROM item_vs_pm WHERE machineName = ?`,
            [machineId]
        );

        await conn.commit();

        return handleSuccessResponse(res, "Successfully deleted");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.show = async (req, res) => {
    try {
        const sql = `
            SELECT
                m.*,
                uom.name AS utilizationUnit,
                uom.id   AS uomId
            FROM machines m
            LEFT JOIN mst_uom uom ON m.utilizationUnit = uom.id
            WHERE m.dflag = 0
            ORDER BY m.id DESC
        `;

        const [rows] = await connection.execute(sql);

        const machinesList = rows.map(row => ({
            ...row,
            days: JSON.parse(row.days),
            machineOperator: JSON.parse(row.machineOperator),
            machOperatorInt: JSON.parse(row.machOperatorInt),
            shift: JSON.parse(row.shift)
        }));

        return handleSuccessResponse(res, "Machines list", machinesList);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.getUom = async (req, res) => {
    try {
        const { machOperatorInt } = req.body;

        if (!Array.isArray(machOperatorInt) || machOperatorInt.length === 0) {
            throw new CustomError(
                "Invalid machOperatorInt format. It should be a non-empty array.",
                400
            );
        }

        const placeholders = machOperatorInt.map(() => "?").join(",");

        const sql = `
            SELECT
                uom.id,
                MAX(uom.name) AS name,
                MAX(pm.name)  AS process,
                MAX(pm.id)    AS pmId
            FROM mst_uom uom
            INNER JOIN pm_vs_uom pmu ON uom.id = pmu.uom
            INNER JOIN mst_pm pm     ON pmu.process = pm.id
            WHERE pmu.dflag = 0
              AND pmu.process IN (${placeholders})
            GROUP BY uom.id
        `;

        const [rows] = await connection.execute(sql, machOperatorInt);

        return handleSuccessResponse(
            res,
            "Process vs UOM list",
            rows
        );
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.machineList = async (req, res) => {
    try {
        const sql = `
            SELECT id, machineName
            FROM machines
            WHERE dflag = 0
            ORDER BY machineName
        `;

        const [rows] = await connection.execute(sql);

        return handleSuccessResponse(
            res,
            "Machine list",
            rows
        );
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

const { handleErrorResponse, CustomError, handleSuccessResponse, connection } = require('../config/dbSql');

exports.store = async (req, res) => {
    try {
        const { shiftLabel, startTime, endTime, status } = req.body;

        if (!shiftLabel || !startTime || !endTime) {
            throw new CustomError("Required fields missing");
        }

        await connection.execute(`
            INSERT INTO shfit_mst (shiftLabel, startTime, endTime, status)
            VALUES (?, ?, ?, ?)
        `, [shiftLabel, startTime, endTime, status]);

        return handleSuccessResponse(res, "Data added successfully");
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new CustomError("Shift label already exists!");
        }

        return handleErrorResponse(res, err);
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { shiftLabel, startTime, endTime, status } = req.body;

        const [result] = await connection.execute(`
            UPDATE shfit_mst
            SET shiftLabel = ?, startTime = ?, endTime = ?, status = ?
            WHERE id = ? AND dflag = 0
        `, [shiftLabel, startTime, endTime, status, id]);

        if (result.affectedRows === 0) {
            throw new CustomError("Shift not found");
        }

        return handleSuccessResponse(res, "Successfully updated");
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new CustomError("Shift label already exists!");
        }

        return handleErrorResponse(res, err);
    }
};

exports.delete = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await connection.execute(`
            UPDATE shfit_mst
            SET dflag = 1
            WHERE id = ? AND dflag = 0
        `, [id]);

        if (result.affectedRows === 0) {
            throw new CustomError("Shift not found");
        }
        
        return handleSuccessResponse(res, "Successfully deleted");
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.show = async (req, res) => {
    try {
        const [rows] = await connection.execute(`
            SELECT *
            FROM shfit_mst
            WHERE dflag = 0
            ORDER BY id DESC
        `);

        return handleSuccessResponse(res, "Shift labels list", rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

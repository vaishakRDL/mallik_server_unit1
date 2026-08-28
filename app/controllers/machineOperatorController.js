const { connection, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');

exports.store = async (req, res) => {
    try {
        const machOp = req.body;

        const [exists] = await pool.query(
            'SELECT id FROM machine_operators WHERE name = ? AND dflag = 0',
            [machOp.name]
        );

        if (exists.length > 0) {
            throw new Error('Machine operator with this name already exists');
        }

        await pool.query(
            'INSERT INTO machine_operators (name, description) VALUES (?, ?)',
            [machOp.name, machOp.description]
        );

        return handleSuccessResponse(res, 'Machine operator added successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const machOp = req.body;

        const [row] = await pool.query(
            'SELECT id FROM machine_operators WHERE id = ? AND dflag = 0',
            [id]
        );

        if (row.length === 0) {
            throw new Error("Data not found");
        }

        await pool.query(
            'UPDATE machine_operators SET name = ?, description = ? WHERE id = ?',
            [machOp.name, machOp.description, id]
        );

        return handleSuccessResponse(res, 'Machine operator updated successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.delete = async (req, res) => {
    try {
        const id = req.params.id;

        const [row] = await connection.query(
            'SELECT id FROM machine_operators WHERE id = ? AND dflag = 0',
            [id]
        );

        if (row.length === 0) {
            return res.status(404).json({ success: false, message: "Data not found" });
        }

        await connection.query(
            'UPDATE machine_operators SET dflag = 1 WHERE id = ?',
            [id]
        );

        return handleSuccessResponse(res, 'Successfully deleted');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.show = async (req, res) => {
    try {
        const [rows] = await connection.query(
            'SELECT * FROM machine_operators WHERE dflag = 0 ORDER BY id DESC'
        );

        return handleSuccessResponse(res, 'Machine Operators list', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');





exports.showRemarks = async (req, res) => {
    try {
        const [rows] = await connection.execute(
            `SELECT * FROM dashboardremarks `
        );

        const dataWithSNo = rows.map((row, index) => ({
            sNo: index + 1,
            ...row
        }));

        return res.status(200).json({
            success: true,
            data: dataWithSNo
        });
    } catch (error) {
        console.error('Error fetching remarks:', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};




exports.addRemark = async (req, res) => {
    try {
        const { remarks } = req.body;

        if (!remarks || remarks.trim() === '') {
            return res.status(400).json({ success: false, message: 'Remarks are required' });
        }

        // Insert remark into the table
        const [result] = await connection.execute(
            `INSERT INTO dashboardremarks (remarks) VALUES (?)`,
            [remarks]
        );

        return res.status(201).json({
            success: true,
            message: 'Remark added successfully',
            data: {
                id: result.insertId,
                remarks
            }
        });
    } catch (error) {
        console.error('Error adding remark:', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};


exports.updateRemark = async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks } = req.body;

        if (!remarks || remarks.trim() === '') {
            return res.status(400).json({ success: false, message: 'Remarks are required' });
        }

        const [result] = await connection.execute(
            `UPDATE dashboardremarks SET remarks = ? WHERE id = ?`,
            [remarks, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Remark not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Remark updated successfully',
            data: {
                id,
                remarks
            }
        });
    } catch (error) {
        console.error('Error updating remark:', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};


exports.deleteRemark = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await connection.execute(
            `DELETE FROM dashboardremarks WHERE id = ?`,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Remark not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Remark deleted successfully',
            data: { id }
        });
    } catch (error) {
        console.error('Error deleting remark:', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};


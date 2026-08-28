const { connection, CustomError } = require('../config/dbSql');


exports.store = async (req, res) => {
    try {
        const day = req.body;

        const [rows, fields] = await connection.execute(`SELECT occasion FROM holiday_mst WHERE occasion = ?`,[day.occasion]);

        if (rows.length > 0) {
            return res.status(400).json({ success: false, message: "duplicate entry can't be exists!" });
        }

        const storeQuery = 'INSERT INTO holiday_mst (date, occasion, description) VALUES (?, ?, ?)';
        const values = [day.date, day.occasion, day.description];

        const [sRows] = await connection.execute(storeQuery, values);

        if (sRows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "data addded successfully" });
        } else {
            throw new CustomError("Something went wrong!");
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
};




exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const day = req.body;

        const updateQuery = `UPDATE holiday_mst SET date = ?, occasion = ?, description = ?  WHERE id = ?`;
        const values = [day.date, day.occasion, day.description, id];

        const [uRows] = await connection.execute(updateQuery, values);

        if (uRows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully updated" });
        } else {
            throw new CustomError("Something went wrong!");
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};


exports.delete = async (req, res) => {
    try {

        const id = req.params.id;

        const [rows] = await connection.execute(`DELETE FROM holiday_mst WHERE id = ?`, [id]);

        if (rows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "data deleted successfully" });
        } else {
            throw new CustomError("Something went wrong!");
        }


    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}


exports.show = async(req, res) => {
    try {
        const [rows] = await connection.execute(`SELECT holiday_mst.*, DATE_FORMAT(date, '%d-%m-%Y') AS date FROM holiday_mst `);

        return res.status(200).json({
            success: true,
            message: "Hoidays list",
            data: rows
        })
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}

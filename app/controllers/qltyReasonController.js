const { connection, CustomError } = require('../config/dbSql');

exports.getId = async (req, res) => {
    try {
        const [fRows] = await connection.execute('SELECT MAX(reasonId) AS maxReasonId FROM rejRewRsn_mst', []);
        let nextReasonId = 1;

        if (fRows.length > 0 && fRows[0].maxReasonId !== null) {
            nextReasonId = parseInt(fRows[0].maxReasonId) + 1; // Ensure it's treated as an integer
        }

        return res.status(200).json({
            autoId: nextReasonId
        });
    } catch (err) {
        throw err;
    }
}





exports.store = async (req, res) => {
    try {
        const rsn = req.body;

        // const [rows, fields] = await connection.execute(`SELECT * FROM rsn_mst WHERE name = ?`, [rsn.name]);

        // if (rows.length > 0) {
        //     return res.status(400).json({ success: false, message: "rsnName is already exists!" });
        // }


        const storeQuery = 'INSERT INTO rejRewRsn_mst (reasonId, reason, description) VALUES (?, ?, ?)';
        const values = [rsn.reasonId, rsn.reason, rsn.description];

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
        const rsn = req.body;

        const [fRows] = await connection.execute(`SELECT * FROM rejRewRsn_mst WHERE id = ?`, [id]);

        if (fRows.length == 0) {
            throw new CustomError("data not found!", 404);
        }

        const updateQuery = `UPDATE rejRewRsn_mst SET reasonId = ?, reason = ?, description = ? WHERE id = ?`;
        const values = [rsn.reasonId, rsn.reason, rsn.description, id];

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

        const [fRows] = await connection.execute(`SELECT * FROM rejRewRsn_mst WHERE id = ?`, [id]);

        if (fRows.length == 0) {
            throw new CustomError("rsn not found!", 404);
        }

        const [DRows] = await connection.execute(`DELETE from rejRewRsn_mst WHERE id = ?`, [id]);

        return res.status(200).json({ success: true, message: "Successfully deleted" });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}



exports.show = async (req, res) => {
    try {
        const query = `
            SELECT id, reasonId, reason, description	
            FROM rejRewRsn_mst   
            WHERE dflag = 0`;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Raasons list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}




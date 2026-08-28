const { connection, CustomError } = require('../config/dbSql');


exports.store = async (req, res) => {
    try {
        const npd = req.body;

        const [rows, fields] = await connection.execute(`SELECT * FROM npdFileType_mst WHERE fileType = ?`, [npd.fileType]);

        if (rows.length > 0) {
            return res.status(400).json({ success: false, message: "fileType is already exists!" });
        }


        const storeQuery = 'INSERT INTO npdFileType_mst (fileType, description) VALUES (?, ?)';
        const values = [npd.fileType, npd.description];

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
        const npd = req.body;

        // const [fRows] = await connection.execute(`SELECT * FROM npds WHERE id = ?`, [id]);

        // if (fRows.length == 0) {
        //     throw new CustomError("npd not found!", 404);
        // }


        const updateQuery = `UPDATE npdFileType_mst SET fileType = ?, description = ? WHERE id = ?`;
        const values = [npd.fileType, npd.description, id];

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

        const [fRows] = await connection.execute(`SELECT * FROM npdFileType_mst WHERE id = ?`, [id]);

        if (fRows.length == 0) {
            throw new CustomError("data not found!", 404);
        }

        const [DRows] = await connection.execute(`DELETE from npdFileType_mst WHERE id = ?`, [id]);

        return res.status(200).json({ success: true, message: "Successfully deleted" });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}



exports.show = async (req, res) => {
    try {
        const query = `
            SELECT  id, fileType, description
            FROM npdFileType_mst   
            WHERE dflag = 0`;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "npds list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}













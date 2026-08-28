const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { storeFile } = require('../utility/utilityFunction');

exports.store = async (req, res) => {
    try {
        const data = req.body;
        const filePath = storeFile(data.file, 'supplier');

        const store = `
            INSERT INTO sup_con_person 
            (sId, code, department, mobNo, email, remarks, contactPerson, designation, telNo, fax, file)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await connection.execute(store, [
            data.sId,
            data.code,
            data.department,
            data.mobNo,
            data.email,
            data.remarks,
            data.contactPerson,
            data.designation,
            data.telNo,
            data.fax,
            filePath
        ]);

        return handleSuccessResponse(res, "Successfully added");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;

        const fetch = 'SELECT id FROM sup_con_person WHERE id = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Contact person not found!'
            });
        }

        const updateQuery = `
            UPDATE sup_con_person 
            SET code = ?, department = ?, mobNo = ?
            WHERE id = ?
        `;

        await connection.execute(updateQuery, [
            data.code,
            data.department,
            data.mobNo,
            id
        ]);

        return handleSuccessResponse(res, "Successfully updated");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.deleteById = async (req, res) => {
    try {
        const id = req.params.id;

        const fetch = 'SELECT id FROM sup_con_person WHERE id = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Contact person not found!'
            });
        }

        const query = 'DELETE FROM sup_con_person WHERE id = ?';
        await connection.execute(query, [id]);

        return handleSuccessResponse(res, "Successfully deleted");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.delete = async (req, res) => {
    try {
        const id = req.params.id;

        const fetch = 'SELECT id FROM sup_con_person WHERE sId = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Contact person not found!'
            });
        }

        const query = 'DELETE FROM sup_con_person WHERE sId = ?';
        await connection.execute(query, [id]);

        return handleSuccessResponse(res, "Successfully deleted");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.show = async (req, res) => {
    try {
        const id = req.params.id;

        const fetch = 'SELECT * FROM sup_con_person WHERE sId = ?';
        const [results] = await connection.execute(fetch, [id]);

        return handleSuccessResponse(res, "Contact persons list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

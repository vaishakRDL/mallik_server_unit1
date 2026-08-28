const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');

exports.store = async (req, res) => {
    try {
        const data = req.body;
        const store = 'INSERT INTO sup_multi_add (sId, code, category, address, defaultAddress) VALUES (?, ?, ?, ?, ?)';
        
        await connection.execute(store, [
            data.sId, 
            data.code, 
            data.category, 
            data.address, 
            data.defaultAddress
        ]);

        return handleSuccessResponse(res, "Successfully added");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const sp = req.body;

        const fetch = 'SELECT id FROM sup_multi_add WHERE id = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Details not found!' });
        }

        const update = `UPDATE sup_multi_add SET sId = ?, code = ?, category = ?, address = ?, defaultAddress = ? WHERE id = ?`;
        await connection.execute(update, [
            sp.sId, 
            sp.code, 
            sp.category, 
            sp.address, 
            sp.defaultAddress, 
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

        const fetch = 'SELECT id FROM sup_multi_add WHERE id = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Address not found!' });
        }

        const query = 'DELETE FROM sup_multi_add WHERE id = ?';
        await connection.execute(query, [id]);

        return handleSuccessResponse(res, "Successfully deleted");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.delete = async (req, res) => {
    try {
        const id = req.params.id;

        const fetch = 'SELECT id FROM sup_multi_add WHERE sId = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Address not found!' });
        }

        const query = 'DELETE FROM sup_multi_add WHERE sId = ?';
        await connection.execute(query, [id]);

        return handleSuccessResponse(res, "Successfully deleted");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.show = async (req, res) => {
    try {
        const id = req.params.id;
        const fetch = 'SELECT * FROM sup_multi_add WHERE sId = ?';
        
        const [results] = await connection.execute(fetch, [id]);

        return handleSuccessResponse(res, "Multi address list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

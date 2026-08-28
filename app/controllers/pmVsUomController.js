const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');

exports.store = async (req, res) => {
    try {
        const pmVuom = req.body;

        const fetch = 'SELECT id FROM pm_vs_uom WHERE process = ? AND uom = ?';
        const [results] = await connection.execute(fetch, [pmVuom.process, pmVuom.uom]);

        if (results.length > 0) {
            return res.status(400).json({ success: false, message: "Duplicate Entry!" });
        }

        const store = 'INSERT INTO pm_vs_uom (process, uom, description) VALUES (?, ?, ?)';
        await connection.execute(store, [pmVuom.process, pmVuom.uom, pmVuom.description]);

        return handleSuccessResponse(res, "data addded successfully");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const pmVuom = req.body;

        const fetch = 'SELECT id FROM pm_vs_uom WHERE id = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Data not found' });
        }

        const update = 'UPDATE pm_vs_uom SET process = ?, uom = ?, description = ? WHERE id = ?';
        await connection.execute(update, [pmVuom.process, pmVuom.uom, pmVuom.description, id]);

        return handleSuccessResponse(res, "Successfully updated");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.delete = async (req, res) => {
    try {
        const id = req.params.id;

        const fetch = 'SELECT id FROM pm_vs_uom WHERE id = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: ',Data  found' });
        }

        const update = 'UPDATE pm_vs_uom SET dflag = 1 WHERE id = ?';
        await connection.execute(update, [id]);

        return handleSuccessResponse(res, "Successfully deleted");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.show = async (req, res) => {
    try {
        const fetch = `
            SELECT pm_vs_uom.*, pm.name AS process, pm.id AS pmId, uomTab.name AS uom, uomTab.id AS uomId
            FROM pm_vs_uom
            INNER JOIN mst_pm AS pm ON pm_vs_uom.process = pm.id
            INNER JOIN mst_uom AS uomTab ON pm_vs_uom.uom = uomTab.id
            WHERE pm_vs_uom.dflag = 0
        `;

        const [results] = await connection.execute(fetch);

        return handleSuccessResponse(res, "Process VS Uom list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

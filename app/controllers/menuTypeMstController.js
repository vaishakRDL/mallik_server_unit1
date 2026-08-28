const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');

exports.store = async (req, res) => {
    try {
        const group = req.body;

        const fetch = 'SELECT id FROM menu_type_mst WHERE type = ? AND menuId = ?';
        const [results] = await connection.execute(fetch, [group.type, group.menuId]);

        if (results.length > 0) {
            return res.status(400).json({ success: false, message: "Duplicate entry can't be added!" });
        }

        const store = `INSERT INTO menu_type_mst (type, menuId, addData, updateData, deleteData, viewData, print, auth, auth1, opt1, opt2, opt3, opt4, opt5) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        await connection.execute(store, [
            group.type, group.menuId, group.add, group.update, group.delete, group.view,
            group.print, group.auth, group.auth1, group.opt1, group.opt2, group.opt3, group.opt4,
            group.opt5
        ]);

        return handleSuccessResponse(res, "data addded successfully");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const group = req.body;

        const fetch = 'SELECT id FROM menu_type_mst WHERE id = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Data not found' });
        }

        const update = `UPDATE menu_type_mst SET type = ?, menuId = ?, addData = ?, updateData = ?, deleteData = ?, viewData = ?,
             print = ?, auth = ?, auth1 = ?, opt1 = ?, opt2 = ?, opt3 = ?, opt4 = ?, opt5 = ? WHERE id = ?`;

        await connection.execute(update, [
            group.type, group.menuId, group.add, group.update, group.delete, group.view,
            group.print, group.auth, group.auth1, group.opt1, group.opt2, group.opt3, group.opt4,
            group.opt5, id
        ]);

        return handleSuccessResponse(res, "Successfully updated");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.delete = async (req, res) => {
    try {
        const id = req.params.id;

        const fetch = 'SELECT id FROM menu_type_mst WHERE id = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Data not found' });
        }

        const update = 'UPDATE menu_type_mst SET dflag = 1 WHERE id = ?';
        await connection.execute(update, [id]);

        return handleSuccessResponse(res, "Successfully deleted");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.show2 = async (req, res) => {
    try {
        const fetch = `
            SELECT menu_type_mst.*, menu.name AS menuName, menu.id AS menuId
            FROM menu_type_mst
            INNER JOIN mst_menu as menu ON menu_type_mst.menuId = menu.id
            WHERE menu_type_mst.dflag = 0
        `;

        const [results] = await connection.execute(fetch);
        return handleSuccessResponse(res, "Group Master list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.show = async (req, res) => {
    try {
        const fetch = `
            SELECT menu_type_mst.*, menu.name AS menuName, menu.id AS menuId, menu.code
            FROM menu_type_mst
            INNER JOIN mst_menu as menu ON menu_type_mst.menuId = menu.id
            WHERE menu_type_mst.dflag = 0
        `;

        const [results] = await connection.execute(fetch);

        const transformedData = results.map(item => ({
            id: item.id,
            menuName: item.menuName,
            type: item.type,
            code: item.code,
            menuId: item.menuId,
            addData: !!item.addData,
            updateData: !!item.updateData,
            deleteData: !!item.deleteData,
            viewData: !!item.viewData,
            print: !!item.print,
            auth: !!item.auth,
            auth1: !!item.auth1,
            opt1: !!item.opt1,
            opt2: !!item.opt2,
            opt3: !!item.opt3,
            opt4: !!item.opt4,
            opt5: !!item.opt5,
        }));

        return handleSuccessResponse(res, "Group Master list", transformedData);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

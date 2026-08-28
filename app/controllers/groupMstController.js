const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');

exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const group = req.body;

        const fetch = 'SELECT id FROM group_mst WHERE code = ?';
        const [existing] = await conn.execute(fetch, [group.code]);

        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: "Duplicate entry can't be added!" });
        }

        await conn.beginTransaction();

        const store = `INSERT INTO group_mst (groupName, code, description) VALUES (?, ?, ?)`;
        await conn.execute(store, [group.groupName, group.code, group.description]);

        const fetchMenuData = 'SELECT id, type FROM mst_menu';
        const [menuData] = await conn.execute(fetchMenuData);

        if (menuData.length > 0) {
            const groupRightsData = menuData.map(menu => [group.code, menu.type, menu.id]);

            const insertQuery = 'INSERT INTO group_rights (groupCode, type, menuId) VALUES ?';
            await conn.query(insertQuery, [groupRightsData]);

            await conn.commit();

            // Note: The original code had redundant success responses and referenced a 'groupMstData' variable 
            // that wasn't defined in the block. Standardizing to a single success response.
            return handleSuccessResponse(res, "data addded successfully");
        } else {
            await conn.commit();
            return res.status(200).json({
                success: true,
                message: "Group added, but no menu data found for rights."
            });
        }

    } catch (err) {
        if (conn) await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const group = req.body;

        const fetch = 'SELECT id FROM group_mst WHERE id = ?';
        const [results] = await connection.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Data not found' });
        }

        const update = `UPDATE group_mst SET groupName = ?, description = ? WHERE id = ?`;
        await connection.execute(update, [group.groupName, group.description, id]);

        return handleSuccessResponse(res, "Successfully updated");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.delete = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const id = req.params.id;

        const fetch = 'SELECT code FROM group_mst WHERE id = ?';
        const [results] = await conn.execute(fetch, [id]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Data not found' });
        }

        await conn.beginTransaction();

        const update = 'UPDATE group_mst SET dflag = 1 WHERE id = ?';
        await conn.execute(update, [id]);

        const deleteRight = 'DELETE FROM group_rights WHERE groupCode = ?';
        await conn.execute(deleteRight, [results[0].code]);

        await conn.commit();
        return handleSuccessResponse(res, "Successfully deleted");

    } catch (err) {
        if (conn) await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};

const handleRightsSync = async (conn) => {
    const fetchGroupMstData = 'SELECT id, code, groupName, description FROM group_mst WHERE dflag = 0';
    const [groupMstData] = await conn.execute(fetchGroupMstData);

    if (groupMstData.length > 0) {
        const fetchMenuData = 'SELECT id, type FROM mst_menu WHERE rights = 0';
        const [menuData] = await conn.execute(fetchMenuData);

        if (menuData.length > 0) {
            const groupRightsData = [];
            groupMstData.forEach(group => {
                menuData.forEach(menu => {
                    groupRightsData.push([group.code, menu.type, menu.id]);
                });
            });

            const insertQuery = 'INSERT INTO group_rights (groupCode, type, menuId) VALUES ?';
            await conn.query(insertQuery, [groupRightsData]);

            const updateMenuQuery = 'UPDATE mst_menu SET rights = 1 WHERE rights = 0';
            await conn.execute(updateMenuQuery);
        }
    }
    return groupMstData;
};

exports.rights = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        await conn.beginTransaction();
        await handleRightsSync(conn);
        await conn.commit();
        return handleSuccessResponse(res, "Rights synced successfully");
    } catch (err) {
        if (conn) await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};

exports.show = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        await conn.beginTransaction();
        const groupMstData = await handleRightsSync(conn);
        await conn.commit();

        return res.status(200).json({
            success: true,
            message: "Group List",
            groupMstData: groupMstData
        });

    } catch (err) {
        if (conn) await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (conn) conn.release();
    }
};

exports.userAssign = async (req, res) => {
    try {
        const id = req.params.id;
        const group = req.body;

        const updateUser = `UPDATE users SET groupId = ? WHERE id = ?`;
        await connection.execute(updateUser, [id, group.userId]);

        return handleSuccessResponse(res, "User Assigned Successfully");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.userShow = async (req, res) => {
    try {
        const id = req.params.id;

        const fetch = ` 
            SELECT u.*, 
                d.name as designation, d.id as designationId, dp.name as department, dp.id as departmentId, 
                r.name as userRole, r.id as userRoleId 
            FROM users u    
                INNER JOIN mst_designation d ON u.designation = d.id
                INNER JOIN mst_department dp ON u.department = dp.id
                INNER JOIN mst_role r ON u.userRole = r.id
            WHERE groupId = ?`;

        const [results] = await connection.execute(fetch, [id]);

        results.forEach((element, index) => {
            element.sNo = index + 1;
        });

        return handleSuccessResponse(res, "User list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.dltUser = async (req, res) => {
    try {
        const id = req.params.id;

        const updateUser = `UPDATE users SET groupId = null WHERE id = ?`;
        await connection.execute(updateUser, [id]);

        return handleSuccessResponse(res, "User Removed Successfully");

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



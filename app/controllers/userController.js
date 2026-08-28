const { connection, CustomError, handleErrorResponse } = require('../config/dbSql');
const utility = require('../utility/utilityFunction');
const bcrypt = require('bcrypt');


exports.store = async (req, res) => {
    const conn = await connection.getConnection();  // Obtain a connection from the pool
    await conn.beginTransaction();
    try {
        const user = req.body;

        const [rows, fields] = await conn.execute(`SELECT * FROM users WHERE userName = ?`, [user.userName]);

        const [totRows, fields2] = await connection.execute(`SELECT id FROM users`, []);
        if (totRows.length > 70) {
            return res.status(400).json({ success: false, message: "UserLimit is exceeded" });
        }
        if (rows.length > 0) {
            return res.status(400).json({ success: false, message: "UserName is already exists!" });
        }

        const fileName = utility.storeFile(user.image, 'user');
        const hashedPassword = await bcrypt.hash(user.password, 10);

        const storeQuery = 'INSERT INTO users (userName, email, password, designation, mobile, department, userRole, image, dob, inActive, remarks) VALUES (?, ?, ?, ?,?, ?, ?, ?, ?, ?, ?)';
        const values = [user.userName, user.email, hashedPassword, user.designationId, user.mobile, user.departmentId, user.roleId, fileName, user.dob, user.inActive, user.remarks];

        await conn.execute(storeQuery, values);

        await conn.commit();
        return res.status(200).json({ success: true, message: "User addded successfully" });
    } catch (err) {
        await conn.rollback();  // Rollback transaction on error
        return handleErrorResponse(res, err);
    } finally {
        conn.release();  // Release the connection back to the pool
    }
};

exports.update = async (req, res) => {
    const conn = await connection.getConnection();  // Obtain a connection from the pool
    await conn.beginTransaction();
    try {
        const id = req.params.id;
        const user = req.body;

        const [fRows] = await conn.execute(`SELECT * FROM users WHERE id = ?`, [id]);

        if (fRows.length === 0) {
            throw new CustomError("User not found!", 404);
        }

        let fileName = null; // Initialize fileName to null

        if (user.image) {
            // Check if the image already starts with 'user/'
            if (user.image.startsWith('user/')) {
                fileName = user.image; // Use the existing file path
            } else {
                fileName = utility.storeFile(user.image, 'user'); // Process and store the new image
            }
        }


        // Initialize update query and values array
        let updateQuery = `UPDATE users SET userName = ?, email = ?, designation = ?, mobile = ?, department = ?, userRole = ?, dob = ?, inActive = ?, remarks = ?`;
        const values = [user.userName, user.email, user.designationId, user.mobile, user.departmentId, user.roleId, user.dob, user.inActive, user.remarks];

        // Check if password is provided, hash it and add it to the query
        if (user.password) {
            const hashedPassword = await bcrypt.hash(user.password, 10);
            updateQuery += `, password = ?`;
            values.push(hashedPassword);
        }

        // Include image update in the query if fileName exists
        if (fileName) {
            updateQuery += `, image = ?`;
            values.push(fileName);
        }

        // Finalize the query with the WHERE clause
        updateQuery += ` WHERE id = ?`;
        values.push(id);

        // Execute the update query
        const [uRows] = await conn.execute(updateQuery, values);

        await conn.commit();
        if (uRows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully updated" });
        } else {
            throw new CustomError("Something went wrong!");
        }

    } catch (err) {
        await conn.rollback();  // Rollback transaction on error
        return handleErrorResponse(res, err);
    } finally {
        conn.release();  // Release the connection back to the pool
    }
};

exports.delete = async (req, res) => {
    const conn = await connection.getConnection();  // Obtain a connection from the pool
    await conn.beginTransaction();
    try {
        const id = req.params.id;

        const [fRows] = await conn.execute(`SELECT * FROM users WHERE id = ?`, [id]);

        if (fRows.length == 0) {
            throw new CustomError("User not found!", 404);
        }
        const [DRows] = await conn.execute(`DELETE from users WHERE id = ?`, [id]);
        await conn.commit();
        
        return res.status(200).json({ success: true, message: "Successfully deleted" });
    } catch (err) {
        await conn.rollback();  // Rollback transaction on error
        return handleErrorResponse(res, err);
    } finally {
        conn.release();  // Release the connection back to the pool
    }
}

exports.show = async (req, res) => {
    try {
        const query = `
            SELECT u.*, 
                d.name as designation, d.id as designationId, dp.name as department, dp.id as departmentId, 
                r.name as userRole, r.id as userRoleId 
            FROM users u    
                INNER JOIN mst_designation d ON u.designation = d.id
                INNER JOIN mst_department dp ON u.department = dp.id
                INNER JOIN mst_role r ON u.userRole = r.id
            `;
        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Users list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}

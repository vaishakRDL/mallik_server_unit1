const jwt = require('jsonwebtoken');
require('dotenv').config();
const bcrypt = require('bcrypt');
const { connection } = require('../config/dbSql');
const { getCurrentFinancialYear } = require('../utility/docNo');

// const getCurrentFinancialYear = () => {
//     const today = new Date();
//     const year = today.getFullYear();
//     const month = today.getMonth() + 1;
//     const fyStartYear = month >= 4 ? year : year - 1;
//     const fyEndYear = fyStartYear + 1;

//     return {
//         fyFrom: `01-04-${fyStartYear}`,
//         fyTo: `31-03-${fyEndYear}`
//     };
// };

exports.login = async (req, res) => {
    try {
        const { userName, password } = req.body;
        const { fyFrom, fyTo } = await getCurrentFinancialYear();

        const fetchQuery = `
            SELECT users.*, 
                mstRol.name as userRole, mstDes.name as designation, mstDep.name as department
            FROM users 
            INNER JOIN mst_role mstRol ON mstRol.id = users.userRole
            INNER JOIN mst_designation mstDes ON mstDes.id = users.designation
            INNER JOIN mst_department mstDep ON mstDep.id = users.department
            WHERE users.userName = ?
        `;
        const [rows] = await connection.query(fetchQuery, [userName]);

        if (rows.length > 0) {
            const bcryptResult = await bcrypt.compare(password, rows[0].password);

            if (bcryptResult) {
                const roleQuery = `
                    SELECT group_rights.*, mst_menu.code AS menu
                    FROM group_rights
                    INNER JOIN group_mst ON group_mst.code = group_rights.groupCode
                    INNER JOIN users ON users.groupId = group_mst.id
                    INNER JOIN mst_menu ON mst_menu.id = group_rights.menuId
                    WHERE users.userName = ?
                `;

                const [rolRows] = await connection.query(roleQuery, [userName]);

                if (rolRows.length === 0) {
                    return res.status(400).json({ success: false, message: "User not has been assigned to groupList!" });
                } else {
                    const userDetails = {
                        id: rows[0].id,
                        userName: rows[0].userName,
                        email: rows[0].email,
                        designation: rows[0].designation,
                        mobile: rows[0].mobile,
                        department: rows[0].department,
                        userRole: rows[0].userRole,
                        image: rows[0].image,
                        rights: rows[0].rights,
                        grp: '',
                        groupRights: rolRows // Include all role rows in the userDetails object
                    };

                    const accessToken = jwt.sign({ username: userName }, process.env.APP_SECRET_KEY, { expiresIn: process.env.SECRET_KEY_EXP });
                    const refreshToken = jwt.sign({ username: userName }, process.env.APP_REFRESH_KEY, { expiresIn: process.env.REFRESH_KEY_EXP });

                    return res.status(200).json({
                        success: true,
                        userDetails: userDetails,
                        fyFrom, fyTo,
                        accessToken: accessToken,
                        refreshToken: refreshToken
                    });
                }
            } else {
                return res.status(400).json({ success: false, message: "Invalid password!" });
            }
        } else {
            return res.status(400).json({ success: false, message: "User Name is not valid!" });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error!', error: error.message });
    }
};

exports.refreshToken = (req, res) => {
    const refreshToken = req.body.refreshToken;
    if (!refreshToken) return res.status(400).json({ message: "Please send refresh token!" });

    // Validate the refresh token (verify signature, expiration, etc.)
    jwt.verify(refreshToken, process.env.APP_REFRESH_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ success: false, message: 'Invalid refresh token' });

        const accessToken = jwt.sign({ username: decoded.username }, 'secret-key', { expiresIn: '1h' });

        return res.status(200).json({
            success: true,
            userEmail: decoded.username,
            accessToken: accessToken
        });
    });
};


exports.changePassword = async (req, res) => {
    try {
        const { userName, oldPassword, newPassword } = req.body;

        // Ensure required fields are provided
        if (!userName || !oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "All fields are required!" });
        }

        // Fetch user details based on the userName
        const fetchQuery = `SELECT * FROM users WHERE userName = ?`;
        const [rows] = await connection.execute(fetchQuery, [userName]);

        // Check if user exists
        if (rows.length > 0) {
            const user = rows[0];

            // Compare provided oldPassword with stored hashed password
            const isMatch = await bcrypt.compare(oldPassword, user.password);

            if (isMatch) {
                // Hash the new password
                const hashedPassword = await bcrypt.hash(newPassword, 10);

                // Update the user's password in the database
                const updateQuery = `UPDATE users SET password = ? WHERE id = ?`;
                await connection.execute(updateQuery, [hashedPassword, user.id]);

                return res.status(200).json({
                    success: true,
                    message: "Password updated successfully!"
                });
            } else {
                return res.status(400).json({ success: false, message: "Invalid old password!" });
            }
        } else {
            return res.status(400).json({ success: false, message: "Invalid username!" });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: "Internal server error!", error: error.message });
    }
};


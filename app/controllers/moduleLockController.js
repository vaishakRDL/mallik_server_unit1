const { connection, handleSuccessResponse, handleErrorResponse, CustomError } = require("../config/dbSql");
const { lockModules, unlockModules } = require("../utility/moduleLockCache");
const { getIO, logActiveConnections } = require("../sockets");
const EVENTS = require("../sockets/socket.events");

exports.healthCheck = async (req, res) => {
    try {
        return handleSuccessResponse(res, 'Server is running...');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.moduleLock = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { moduleNames = [], reason = '' } = req.body;
        const userName = req.headers?.username || 'system';

        if (!moduleNames.length) throw new CustomError("At least one module name is required");

        const placeholders = moduleNames.map(() => '(?, 1, ?, NOW(), ?)').join(',');
        const values = [];
        moduleNames.forEach(name => values.push(name, userName, reason));

        const lockQuery = `
            INSERT INTO module_locks (moduleName, isLocked, lockedBy, lockedAt, reason)
            VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE 
                isLocked = VALUES(isLocked),
                lockedBy = VALUES(lockedBy),
                lockedAt = VALUES(lockedAt),
                reason = VALUES(reason)
        `;

        await conn.execute(lockQuery, values);
        await conn.commit();

        // UPDATE GLOBAL CACHE
        lockModules(moduleNames, userName, reason);

        // socket emit
        const io = getIO();
        io.of("/erp").emit(EVENTS.MODULE_LOCK_UPDATED, {
            action: "LOCK",
            moduleNames,
            lockedBy: userName,
            reason,
            lockedAt: new Date()
        });

        return handleSuccessResponse(res, "Selected modules locked successfully");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

// exports.moduleUnlock = async (req, res) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();

//     try {
//         const { moduleNames = [] } = req.body;

//         if (!moduleNames.length) throw new CustomError("At least one module name is required");

//         const placeholders = moduleNames.map(() => '?').join(',');
//         const updateSql = `
//             UPDATE module_locks
//             SET isLocked = 0, lockedBy = NULL, lockedAt = NULL, reason = NULL
//             WHERE moduleName IN (${placeholders})
//         `;

//         await conn.execute(updateSql, moduleNames);
//         await conn.commit();

//         // REMOVE FROM GLOBAL CACHE
//         unlockModules(moduleNames);

//         return handleSuccessResponse(res, "Selected modules unlocked successfully");
//     } catch (err) {
//         await conn.rollback();
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// };

exports.moduleUnlock = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { moduleNames = [] } = req.body;
        const userName = req.headers?.username || 'system';

        if (!moduleNames.length) {
            throw new CustomError("At least one module name is required");
        }

        const placeholders = moduleNames.map(() => '?').join(',');

        const updateSql = `
            UPDATE module_locks
            SET 
                isLocked = 0,
                lockedBy = NULL,
                lockedAt = NULL,
                reason = NULL
            WHERE moduleName IN (${placeholders})
        `;

        await conn.execute(updateSql, moduleNames);
        await conn.commit();

        // UPDATE GLOBAL CACHE
        unlockModules(moduleNames);

        // SOCKET EMIT (SYMMETRIC WITH LOCK)
        const io = getIO();
        io.of("/erp").emit(EVENTS.MODULE_LOCK_UPDATED, {
            action: "UNLOCK",
            moduleNames,
            unlockedBy: userName,
            unlockedAt: new Date()
        });

        return handleSuccessResponse(res, "Selected modules unlocked successfully");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.modulesList = async (req, res) => {
    try {
        const [rows] = await connection.execute(`
            SELECT 
                ROW_NUMBER() OVER (ORDER BY id) AS sNo,
                id, 
                moduleName, 
                isLocked, 
                lockedBy,
                DATE_FORMAT(lockedAt, '%d-%m-%Y %H:%i:%s') AS lockedAt,
                reason
            FROM module_locks
            ORDER BY isLocked DESC
        `);

        return handleSuccessResponse(res, 'Modules', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.activeConnections = async (req, res) => {
    try {
        const activeConnections = logActiveConnections();

        return handleSuccessResponse(res, 'Active ERP socket connections', activeConnections);
    } catch (err) {
        return handleErrorResponse(res, err);
    }   
}

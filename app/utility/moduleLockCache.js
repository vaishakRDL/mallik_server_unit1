const { connection } = require("../config/dbSql");

// Global Map cache
const moduleLockCache = new Map();

// Set lock for modules
function lockModules(modules = [], userName, reason) {
    modules.forEach(name => {
        moduleLockCache.set(name, {
            isLocked: true,
            lockedBy: userName,
            reason,
            lockedAt: new Date()
        });
    });
}

// Unlock modules
function unlockModules(modules = []) {
    modules.forEach(name => {
        moduleLockCache.delete(name);
    });
}

// Check lock status
function isModuleLocked(name) {
    return moduleLockCache.get(name)?.isLocked === true;
}

// Middleware
function moduleLockCheck(moduleName) {
    return (req, res, next) => {
        if (isModuleLocked(moduleName)) {
            return res.status(403).json({
                message: `${moduleName} module is temporarily locked`
            });
        }
        next();
    };
}

async function loadModuleLocksFromDB() {
    const conn = await connection.getConnection();
    try {
        const [rows] = await conn.execute(
            "SELECT moduleName, isLocked, lockedBy, reason, lockedAt FROM module_locks WHERE isLocked = 1"
        );

        rows.forEach(row => {
            moduleLockCache.set(row.moduleName, {
                isLocked: true,
                lockedBy: row.lockedBy,
                reason: row.reason,
                lockedAt: row.lockedAt
            });
        });

    } finally {
        conn.release();
    }
}

function getLockedModules() {
    const lockedModules = Array.from(moduleLockCache.keys());
    return lockedModules;
}

module.exports = {
    moduleLockCache,
    lockModules,
    unlockModules,
    isModuleLocked,
    moduleLockCheck,
    loadModuleLocksFromDB,
    getLockedModules
};


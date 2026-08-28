const { connection, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');
const { getUser } = require('../utility/utilityFunction');

const MASTER_CONFIG = require('../config/masterConfig');

const BATCH_SIZE = 500;

/**
 * Optimized Dynamic Bulk Update API
 */
exports.bulkUpdateMaster = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { type, data } = req.body;
        const username = await getUser(req);

        if (!data || !Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ success: false, message: "No data provided" });
        }

        const config = MASTER_CONFIG[type];
        if (!config) {
            return res.status(400).json({ success: false, message: `Unsupported master type: ${type}` });
        }

        await conn.beginTransaction();

        // Resolve Foreign Key names to IDs if strings are provided
        await resolveForeignKeys(conn, config, data);

        const updatedCount = await executeBulkUpdate(conn, config, data, username);

        if (config.postUpdate) {
            await config.postUpdate(conn);
        }

        await conn.commit();
        return handleSuccessResponse(res, `${type} bulk update completed`, { updatedCount });
    } catch (err) {
        await conn.rollback();
        console.error("Bulk update error:", err);
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

/**
 * Resolves string names to internal IDs for FK fields
 */
async function resolveForeignKeys(conn, config, data) {
    const { fkMappings } = config;
    if (!fkMappings) return;

    // Identify which FK fields are present in the data and contain strings (names)
    const fkFields = Object.keys(fkMappings).filter(field => 
        data.some(row => row.hasOwnProperty(field) && typeof row[field] === 'string' && isNaN(row[field]))
    );

    for (const field of fkFields) {
        const { table } = fkMappings[field];
        
        // Collect unique names to resolve
        const uniqueNames = [...new Set(data
            .map(row => (row[field] || "").toString().trim())
            .filter(name => name !== "" && isNaN(name))
        )];

        if (uniqueNames.length === 0) continue;

        // Fetch all matching IDs in one query
        const [rows] = await conn.query(
            `SELECT id, name FROM ${table} WHERE name IN (?)`,
            [uniqueNames]
        );

        // Create a lookup map (normalized names for case-insensitive matching)
        const nameToIdMap = new Map(rows.map(r => [r.name.toUpperCase().trim(), r.id]));

        // Replace names with IDs in the original data array
        data.forEach(row => {
            if (row.hasOwnProperty(field) && typeof row[field] === 'string' && isNaN(row[field])) {
                const name = row[field].toUpperCase().trim();
                row[field] = nameToIdMap.get(name) || null;
            }
        });
    }
}

/**
 * High-performance bulk update using UPDATE with JSON lookup
 */
async function executeBulkUpdate(conn, config, data, username) {
    const { tableName, primaryKey, fields, booleanFields } = config;
    
    const chunks = chunkArray(data, BATCH_SIZE);
    let totalAffected = 0;

    for (const chunk of chunks) {
        const ids = chunk.map(row => row[primaryKey]).filter(id => id);
        if (ids.length === 0) continue;

        // Construct a virtual table using UNION ALL
        // We use placeholders for all values to prevent SQL injection
        const queryParams = [];
        const selectSegments = chunk.map(row => {
            const segmentParams = [row[primaryKey]];
            const segmentPlaceholders = ['? AS id'];
            
            if (config.trackUpdates !== false) {
                segmentParams.push(username);
                segmentPlaceholders.push('? AS updatedBy');
            }
            
            fields.forEach(field => {
                const idField = `${field}_id`;
                let val = row.hasOwnProperty(idField) && row[idField] !== null ? row[idField] : row[field];
                
                // Handle Boolean conversions
                if (booleanFields && booleanFields.includes(field)) {
                    if (val === 'Y') val = 1;
                    else if (val === 'N') val = 0;
                }
                
                // Normalize empty strings
                if (val === '') val = null;
                
                segmentParams.push(val);
                segmentPlaceholders.push(`? AS \`${field}\``);
            });
            
            queryParams.push(...segmentParams);
            return `SELECT ${segmentPlaceholders.join(', ')}`;
        }).join(' UNION ALL ');

        let setClausesStr = fields.map(field => {
            return `i.\`${field}\` = COALESCE(tmp.\`${field}\`, i.\`${field}\`)`;
        }).join(', ');

        if (config.trackUpdates !== false) {
            setClausesStr += `,
                i.updatedBy = tmp.updatedBy,
                i.updated_at = NOW()`;
        }

        const sql = `
            UPDATE ${tableName} i
            JOIN (${selectSegments}) AS tmp ON i.\`${primaryKey}\` = tmp.id
            SET ${setClausesStr}
        `;

        const [result] = await conn.query(sql, queryParams);
        totalAffected += result.affectedRows;
    }

    return totalAffected;
}

function chunkArray(arr, size) {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}

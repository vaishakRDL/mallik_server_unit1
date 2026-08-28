const excel = require('exceljs');
const { connection, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');
const MASTER_CONFIG = require('../config/masterConfig');

/**
 * Loads and parses Excel data for bulk update preview
 * Maps Excel columns to database fields and performs basic validation
 */
exports.loadExcel = async (req, res) => {
    try {
        const { type } = req.body;
        const file = req.file;

        if (!file) throw new Error("File is required");

        const config = MASTER_CONFIG[type];
        if (!config) throw new Error(`Unsupported master type: ${type}`);

        // 1. Load Excel from Buffer
        const workbook = new excel.Workbook();
        await workbook.xlsx.load(file.buffer);
        const worksheet = workbook.getWorksheet(1);

        if (!worksheet) throw new Error("Worksheet not found in Excel file");

        // 2. Identify Headers and Map to Fields
        const fieldMapping = {};
        const headerRow = worksheet.getRow(1);

        headerRow.eachCell((cell, colNumber) => {
            const headerText = cell.text.trim();
            if (!headerText) return;

            // Normalize header text for comparison
            const normalizedHeader = headerText.toLowerCase().replace(/[^a-z0-9]/g, '');

            // 1. Direct match against config fields
            let matchedField = config.fields.find(f => f.toLowerCase() === normalizedHeader);
            
            // 2. Match against primary key
            if (!matchedField && config.primaryKey && config.primaryKey.toLowerCase() === normalizedHeader) {
                matchedField = config.primaryKey;
            }

            // 3. Match against aliases
            if (!matchedField && config.excelAliases && config.excelAliases[normalizedHeader]) {
                matchedField = config.excelAliases[normalizedHeader];
            }
            
            if (matchedField) {
                fieldMapping[colNumber] = matchedField;
            }
        });

        // 3. Extract Data Rows
        const data = [];
        const errors = [];

        for (let i = 2; i <= worksheet.rowCount; i++) {
            const row = worksheet.getRow(i);
            const rowData = { rowNo: i - 1, status: 'VALID', errors: [] };
            let hasData = false;

            Object.keys(fieldMapping).forEach(colNumber => {
                const field = fieldMapping[colNumber];
                const cell = row.getCell(Number(colNumber));

                let value = cell.text;
                if (cell.type === excel.ValueType.Formula) value = cell.result;

                if (value !== undefined && value !== "") {
                    rowData[field] = value.toString().trim();
                    hasData = true;
                }
            });

            if (hasData) {
                // Basic Validation
                if (config.validateRow) {
                    config.validateRow(rowData);
                } else {
                    if (!rowData.itemCode && !rowData.id) {
                        rowData.status = 'ERROR';
                        rowData.errors.push("itemCode or ID is required");
                    }
                }

                data.push(rowData);
            }
        }

        // 4. Resolve IDs and Validate Foreign Keys
        if (data.length > 0) {
            await resolveAndValidateData(connection, config, data);
        }

        return handleSuccessResponse(res, "Excel data parsed successfully", {
            rowCount: data.length,
            mappedFields: Object.values(fieldMapping),
            data: data
        });

    } catch (err) {
        console.error("Excel Bulk Load Error:", err);
        return handleErrorResponse(res, err);
    }
};

/**
 * Resolves item IDs from itemCode and validates all Foreign Key names
 */
async function resolveAndValidateData(conn, config, data) {
    const { fkMappings, primaryKey } = config;

    // 1. Resolve Primary Key (ID) if missing
    if (config.resolveId) {
        await config.resolveId(conn, data);
    } else {
        const itemCodes = [...new Set(data
            .filter(row => row.itemCode && !row[primaryKey])
            .map(row => row.itemCode)
        )];

        if (itemCodes.length > 0) {
            const itemRows = [];
            const CHUNK_SIZE = 5000;
            for (let i = 0; i < itemCodes.length; i += CHUNK_SIZE) {
                const chunk = itemCodes.slice(i, i + CHUNK_SIZE);
                const [rows] = await conn.query(
                    `SELECT id, itemCode FROM items WHERE itemCode IN (?)`,
                    [chunk]
                );
                itemRows.push(...rows);
            }

            const codeToIdMap = new Map(itemRows.map(r => [r.itemCode.toUpperCase(), r.id]));
            
            data.forEach(row => {
                if (row.itemCode && !row[primaryKey]) {
                    const id = codeToIdMap.get(row.itemCode.toUpperCase());
                    if (id) {
                        row[primaryKey] = id;
                    } else {
                        row.status = 'ERROR';
                        row.errors.push(`Item Code "${row.itemCode}" not found in database`);
                    }
                }
            });
        }
    }

    // 2. Resolve and Validate Foreign Keys (itemGroup, uom, location, etc.)
    if (fkMappings) {
        const presentFKFields = Object.keys(fkMappings).filter(field =>
            data.some(row => row.hasOwnProperty(field))
        );

        for (const field of presentFKFields) {
            const { table } = fkMappings[field];
            
            // Unique values to resolve (treating everything as a potential name)
            const namesToResolve = [...new Set(data
                .filter(row => row[field] && typeof row[field] === 'string')
                .map(row => row[field].toString().trim())
            )];

            if (namesToResolve.length === 0) continue;

            // Fetch IDs for these names in chunks to avoid max_allowed_packet error
            const refRows = [];
            const CHUNK_SIZE = 5000;
            for (let i = 0; i < namesToResolve.length; i += CHUNK_SIZE) {
                const chunk = namesToResolve.slice(i, i + CHUNK_SIZE);
                const [rows] = await conn.query(
                    `SELECT id, name FROM ${table} WHERE name IN (?)`,
                    [chunk]
                );
                refRows.push(...rows);
            }

            const nameToIdMap = new Map(refRows.map(r => [r.name.toString().toUpperCase().trim(), r.id]));

            // Validate and attach IDs
            data.forEach(row => {
                if (row[field] && typeof row[field] === 'string') {
                    const originalValue = row[field].toString().trim();
                    const name = originalValue.toUpperCase();
                    const id = nameToIdMap.get(name);
                    
                    if (id) {
                        row[`${field}_id`] = id;
                    } else {
                        if (isNaN(originalValue)) {
                            row.status = 'ERROR';
                            row.errors.push(`${field} "${originalValue}" not found in master`);
                        }
                    }
                }
            });
        }
    }
}

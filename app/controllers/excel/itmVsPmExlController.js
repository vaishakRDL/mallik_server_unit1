const excel = require('exceljs');
const { connection, CustomError, handleErrorResponse } = require('../../config/dbSql');
const { decodeBase64 } = require('../../utility/utilityFunction');



async function fetchItemId(itemCode, rowNumber = null) {
    try {
        if (!itemCode) return null;

        const [rows, fields] = await connection.execute(`SELECT id FROM items WHERE itemCode = ?`, [itemCode]);

        if (rows.length > 0) {
            return rows[0].id;
        }


        if (rowNumber !== null) {
            throw new Error(`Invalid Item Code ${itemCode}, rowNumber: ${rowNumber}`);
        } else {
            // console.error(`Invalid Item Code ${itemCode}`);
            return null;
        }

        // throw new Error(`Invalid Item Code ${itemCode}, rowNumber: ${rowNumber}`);
    } catch (error) {
        throw error;
    }
}


async function fetchPmId(pmName, rowNumber = null) {
    try {
        if (!pmName) return null;

        const [rows, fields] = await connection.execute(`SELECT id FROM mst_pm WHERE name  = ?`, [pmName]);

        if (rows.length > 0) {
            return rows[0].id;
        }

        if (rowNumber !== null) {
            throw new Error(`Invalid Process Name ${pmName}, rowNumber: ${rowNumber}`);
        } else {
            // console.error(`Invalid Process Name ${pmName}`);
            return null;
        }
    } catch (error) {
        throw error;
    }
}



async function fetchMachId(mach, rowNumber = null) {
    try {
        if (!mach) return null;

        const [rows, fields] = await connection.execute(`SELECT id FROM machines WHERE machineName = ?`, [mach]);

        if (rows.length > 0) {
            return rows[0].id;
        }


        if (rowNumber !== null) {
            throw new Error(`Invalid Machine Code ${mach}, rowNumber: ${rowNumber}`);
        } else {
            console.error(`Invalid Machine Code ${mach}`);
            return null;
        }

    } catch (error) {
        throw error;
    }
}



async function fetchPrMapId(pmId, prMap, rowNumber = null) {
    try {
        if (!pmId || !prMap) return null;

        // Remove all spaces
        const normalizedRange = prMap.replace(/\s+/g, '');

        console.log(pmId, normalizedRange);

        const [rows] = await connection.execute(
            `SELECT id 
             FROM pm_price_map 
             WHERE processId = ? 
               AND \`range\` = ?`,
            [pmId, normalizedRange]
        );

        if (rows.length > 0) {
            return rows[0].id;
        }

        if (rowNumber !== null) {
            throw new Error(`Invalid Price Map Group ${prMap}, rowNumber: ${rowNumber}`);
        }

        return null;

    } catch (error) {
        throw error;
    }
}




//Download Template only for Item_VS_ Process 
exports.template = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Part No', 'Process', 'Machine', 'Cycle Time', 'UOM Count', 'Process Priority', 'Price Range']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text


        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Template.xlsx');

        // Write the Excel file to the response
        workbook.xlsx.write(res)
            .then(() => {
                // End the response stream
                res.end();
            })
            .catch(err => {
                console.error('Error writing Excel file:', err);
                res.status(500).send('Error generating Excel file');
            });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};


exports.import = async (req, res) => {
    try {
        if (!req.body.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
        const base64Data = req.body.file.replace(base64URL, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);

        const items = [];
        const missing = []; // Array to collect missing entries
        const display = []; // Array to collect valid entries

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                const item = {
                    rowNo: rowNumber,
                    itmCode: row.getCell(1).value,
                    pm: row.getCell(2).value,
                    machine: row.getCell(3).value,
                    cycleTym: row.getCell(4).value,
                    uomCount: row.getCell(5).value,
                    pmPriority: row.getCell(6).value,
                    prMap: row.getCell(7).value,

                };

                items.push(item);
            }
        });

        // Fetch IDs for itemspliers and items
        for (const i of items) {
            i.prMap = i.prMap === '' || i.prMap === null ? null : i.prMap;

            i.itemId = await fetchItemId(i.itmCode);
            i.pmId = await fetchPmId(i.pm);
            i.machineId = await fetchMachId(i.machine);
            // i.prMapId = await fetchPrMapId(i.pmId, i.prMap);
            i.prMapId = i.prMap ? await fetchPrMapId(i.pmId, i.prMap) : null;



            // console.log('prMapId',i.prMapId)
            // Check if IDs are valid
            // if (!i.itemId || !i.pmId || !i.machineId || !i.prMapId) {
            if ( !i.itemId || !i.pmId || !i.machineId || (i.prMap && !i.prMapId)) {
                // If either ID is missing, add to the missing array
                let missingInfo = '';

                if (!i.itemId) {
                    missingInfo = 'Item Code';
                } else if (!i.pmId) {
                    missingInfo = 'PM Code';
                } else if (!i.machineId) {
                    missingInfo = 'Machine Code';
                } else if (!i.prMapId) {
                    missingInfo = 'Price Range';
                }

                missing.push({
                    itemCode: i.itmCode,
                    pm: i.pm,
                    machine: i.machine,
                    cycleTym: i.cycleTym,
                    uomCount: i.uomCount,
                    pmPriority: i.pmPriority,
                    prMap: i.prMap,
                    missingInfo
                });

                continue; // Skip to the next item
            }

            // If IDs are valid, add to display array
            display.push({
                itemCode: i.itmCode,
                pm: i.pm,
                machine: i.machine,
                cycleTym: i.cycleTym,
                uomCount: i.uomCount,
                pmPriority: i.pmPriority,
                prMap: i.prMap

            });

            // Process each item
            const [existingRow] = await connection.query('SELECT * FROM item_vs_pm WHERE item = ? AND machineName = ? AND process = ?', [i.itemId, i.machineId, i.pmId]);

            if (existingRow.length > 0) {
                // If the row exists, update it
                await connection.query('UPDATE item_vs_pm SET count = ?, cycleTime = ?, processPriority = ?, priceRange = ?,  dflag = ? WHERE item = ? AND machineName = ? AND process = ?', [i.uomCount, i.cycleTym, i.pmPriority, i.prMapId, 0, i.itemId, i.machineId, i.pmId]);
            } else {
                // If the row does not exist, insert it
                await connection.query('INSERT INTO item_vs_pm (item, machineName, process, count, cycleTime, processPriority, priceRange) VALUES (?, ?, ?, ?, ?, ?, ?)', [i.itemId, i.machineId, i.pmId, i.uomCount, i.cycleTym, i.pmPriority, i.prMapId]);
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Successfully imported',
            display,  // Display only valid entries
            missing   // Include missing array in response
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};




//Download Template For CopyTo CopyFrom
exports.copyTemplate = (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Copy To Item', 'Copy From Item']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text


        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Template.xlsx');

        // Write the Excel file to the response
        workbook.xlsx.write(res)
            .then(() => {
                // End the response stream
                res.end();
            })
            .catch(err => {
                console.error('Error writing Excel file:', err);
                res.status(500).send('Error generating Excel file');
            });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};



// Import Copy Function
exports.copy = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const buffer = await decodeBase64(req.body.file);
        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);  // Assuming worksheet 1 is the one you're working with
        const items = [];
        const missing = [];  // Array to collect missing entries

        // Adjusted to correctly fetch rows starting from row 2
        await Promise.all(worksheet.getRows(2, worksheet.rowCount - 1).map(async (row) => {
            const copyToString = row.getCell(1).value;
            const copyFromString = row.getCell(2).value;

            // Get the IDs for copyTo and copyFrom from the 'items' table
            const cItem = await fetchItemId(copyToString);
            const eItem = await fetchItemId(copyFromString);

            if (cItem && eItem) {  // Check if both cItem and eItem are not null
                // //console.log('ItemCode: ', eItem);
                const existingItemDetails = await fetchItemDetails(conn, cItem, eItem);

                if (existingItemDetails) {
                    items.push(...existingItemDetails);
                } else {
                    // Add to missing array instead of sending a response immediately
                    missing.push({
                        copyTo: copyToString,
                        copyFrom: copyFromString,
                        message: `Existing details not found for ItemCode: ${copyFromString}`
                    });
                }
            } else {
                // Handle case where cItem or eItem is null
                missing.push({
                    copyTo: copyToString,
                    copyFrom: copyFromString,
                    message: `Item not found for ${!cItem ? copyToString : copyFromString}`
                });
            }
        }));

        if (items.length > 0) {
            await insertItems(conn, items);
            await conn.commit();
            return res.status(200).json({ success: true, message: 'Items duplicated successfully', missing });
        } else {
            await conn.rollback();
            return res.status(400).json({ success: false, message: 'No items to duplicate', missing });
        }
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


//Used in Copy Function
async function fetchItemDetails(conn, cItem, item) {
    try {

        await conn.query('DELETE FROM item_vs_pm WHERE item = ?', [cItem]);
        const [rows] = await conn.execute(`SELECT * FROM item_vs_pm WHERE item = ? AND dflag = 0 `, [item]);

        if (rows.length === 0) return;

        rows.forEach(element => {
            element.item = cItem;
        })

        return rows;

    } catch (error) {
        throw error;
    }
}


// Used in Copy Function
async function insertItems(conn, items) {
    try {
        if (items.length === 0) return;

        for (const sp of items) {
            const [updateResult] = await conn.query(
                'UPDATE item_vs_pm SET count = ?, cycleTime = ?, processPriority = ? WHERE item = ? AND machineName = ? AND process = ?',
                [sp.count, sp.cycleTime, sp.processPriority, sp.item, sp.machineName, sp.process]
            );

            // Check if the update affected any rows
            if (updateResult.affectedRows === 0) {
                // No rows were updated, so perform an insert
                await conn.query(
                    `INSERT INTO item_vs_pm (item, machineName, process, count, cycleTime, processPriority) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [sp.item, sp.machineName, sp.process, sp.count, sp.cycleTime, sp.processPriority]
                );
            }
        }

    } catch (error) {
        throw error;
    }
}


//Download Template For Machine DeSelect
exports.deSelectTemp = (req, res) => {

    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Part No', 'Process', 'Machine Code']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text


        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Template.xlsx');

        // Write the Excel file to the response
        workbook.xlsx.write(res)
            .then(() => {
                // End the response stream
                res.end();
            })
            .catch(err => {
                console.error('Error writing Excel file:', err);
                res.status(500).send('Error generating Excel file');
            });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};




// Machine DeSelect
exports.deSelect = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const buffer = await decodeBase64(req.body.file);
        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);

        // Process rows one by one to avoid deadlocks
        const rows = worksheet.getRows(2, worksheet.rowCount);
        for (const row of rows) {
            const item = row.getCell(1).value;
            const process = row.getCell(2).value;
            const machine = row.getCell(3).value;

            const itmId = await fetchItemId(item);
            const pmId = await fetchPmId(process);
            const machId = await fetchMachId(machine);

            await updateItemVsPm(itmId, pmId, machId);
        }

        await conn.commit();
        return res.status(200).json({ success: true, message: 'Machine Data Deselected successfully' });

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

//Used in  deSelect fucntion
async function updateItemVsPm(itmId, pmId, machId) {
    try {

        const updateQuery = 'UPDATE item_vs_pm SET dflag = 1 WHERE item = ? AND  process = ? AND machineName = ?';
        const values = [itmId, pmId, machId];

        const [uRows] = await connection.execute(updateQuery, values);

    } catch (err) {
        throw err;
    }
}




exports.export = async (req, res) => {
    try {

        const id = req.params.id;

        const query = `
            SELECT item_vs_pm.id, mach.machineName AS machineName, mach.machineCode, pm.name AS process,
                itm.itemCode, itm.itemName, item_vs_pm.count, item_vs_pm.cycleTime, item_vs_pm.processPriority
            FROM item_vs_pm
                INNER JOIN items as itm ON item_vs_pm.item = itm.id
                INNER JOIN machines as mach ON item_vs_pm.machineName = mach.id
                INNER JOIN mst_pm as pm ON item_vs_pm.process = pm.id

            WHERE item_vs_pm.dflag = 0 AND item_vs_pm.machineName = ?`;

        const [rows] = await connection.execute(query, [id]);


        rows.forEach((row, index) => {
            row.slNo = index + 1;
        });

        const customHeaders = ['Sl.No', 'Part No', 'Process', 'Machine', 'Cycle Time', 'UOM Count', 'Process Priority'];
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Item Vs Process Report');

        const headerRow = worksheet.addRow(customHeaders);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };

        const columnSize = 17;
        worksheet.columns.forEach((column) => {
            column.width = columnSize;
        });

        rows.forEach(row => {
            const customValues = [
                row.slNo,
                row.itemCode,
                row.process,
                row.machineCode,
                row.cycleTime,
                row.count,
                row.processPriority,
            ];
            worksheet.addRow(customValues);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Supplier_Items.xlsx');

        workbook.xlsx.write(res)
            .then(() => {
                res.status(200).end();
            })
            .catch(error => {
                console.error('Error generating Excel file:', error);
                res.status(500).json({ success: false, message: 'Error generating Excel file' });
            });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};


exports.dbImport = async (req, res) => {
    try {
        const buffer = await decodeBase64(req.body.file);

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);

        const [items] = await connection.execute(`SELECT id as itemId, itemCode FROM items WHERE dflag = ?`, [0]);
        const [process] = await connection.execute(`SELECT id as pmId, code FROM mst_pm WHERE dflag = ?`, [0]);
        const [machines] = await connection.execute(`SELECT id as machineId, machineCode FROM machines WHERE dflag = ?`, [0]);

        const itemMap = new Map(items.map(i => [i.itemCode, i.itemId]));
        const processMap = new Map(process.map(p => [p.code, p.pmId]));
        const machineMap = new Map(machines.map(m => [m.machineCode, m.machineId]));

        const iErr = [];
        const pErr = [];
        const mErr = [];
        const sup = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                const itemId = itemMap.get(row.getCell(1).text);
                const processId = processMap.get(row.getCell(2).text);
                const machineId = machineMap.get(row.getCell(3).text);

                const sp = {
                    rowNo: rowNumber,
                    itmCode: itemId || null,
                    pm: processId || null,
                    machine: machineId || null,
                    cycleTym: row.getCell(4).value,
                    uomCount: row.getCell(5).value,
                    pmPriority: row.getCell(6).value,
                };
                sup.push(sp);
                // if (!itemId && !iErr.includes(row.getCell(1).text)) {
                //     iErr.push(row.getCell(1).text);
                // } else if (!processId && !pErr.includes(row.getCell(2).text)) {
                //     pErr.push(row.getCell(2).text);
                // } else if (!machineId && !mErr.includes(row.getCell(3).text)) {
                //     mErr.push(row.getCell(3).text);
                // }
            }
        });

        const insertQuery = `INSERT INTO item_vs_pm (item, machineName, process, count, cycleTime, processPriority) VALUES ?`;
        const values = sup.map(sp => [sp.itmCode, sp.machine, sp.pm, sp.uomCount, sp.cycleTym, sp.pmPriority]);

        const chunkSize = 5000; // Adjust based on your DB's packet size limit
        for (let i = 0; i < values.length; i += chunkSize) {
            const chunk = values.slice(i, i + chunkSize);
            await connection.query(insertQuery, [chunk]);
        }

        res.send("success")
    } catch (err) {
        //console.log(err)
        return handleErrorResponse(res, err);
    }
}

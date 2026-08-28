const { relativeTimeThreshold } = require("moment");
const { connection, handleErrorResponse, CustomError, handleSuccessResponse } = require("../config/dbSql");
const { storeFile, decodeBase64 } = require("../utility/utilityFunction");
const excel = require('exceljs');
const { formatFinancialYears } = require("../utility/docNo");


exports.sfgRefNo = async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        let intVal = 0;

        const [sfgRows] = await connection.execute(
            `SELECT sfgRefNo FROM del_schedule ORDER BY id DESC LIMIT 1`, []
        );

        if (sfgRows.length === 0) {
            intVal = 1;
        } else {
            const sfgRefNo = sfgRows[0].sfgRefNo;
            const splitVal = sfgRefNo.split('/00')[1];
            intVal = parseInt(splitVal) + 1;
        }
        // Construct the unique SFG number
        const uniqueSfg = `SFG${currentYear}/00${intVal}`;

        return res.status(200).json({ success: true, sfgRefNo: uniqueSfg });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


exports.store = async (req, res) => {
    const conn = await connection.getConnection();  // Obtain a connection from the pool
    await conn.beginTransaction();  // Begin transaction
    let insertId;

    try {
        const { sfgRefNo, dispatchDate, dispatchTime, vehicleNo, weight, itemsList } = req.body;
        const createdBy = req.headers.username ?? 'Admin';

        if (itemsList.length === 0 || !itemsList[0].supplierId) {
            throw new CustomError('Please select Items or Supplier', 400);
        }

        const supplierId = itemsList[0].supplierId;

        const [sfgRows] = await conn.execute(
            `INSERT INTO del_schedule (sfgRefNo, supplierId, dispatchDate, dispatchTime, weight, vehicleNo, createdBy, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
            [sfgRefNo, supplierId, dispatchDate, dispatchTime, weight, vehicleNo, createdBy, 'Pending']
        );

        if (sfgRows.affectedRows > 0) {
            insertId = sfgRows.insertId;
            await storeDelItems(conn, insertId, itemsList);

            await conn.commit();   // Commit transaction
            return res.status(200).json({ success: true, message: 'Vendor process successfully created.' });
        }
        throw new CustomError('Something wemt wrong!', 400);

    } catch (err) {
        if (insertId) {
            await conn.execute(`DELETE FROM del_schedule WHERE id = ?`, [insertId]);
        }
        await conn.rollback();  // Rollback transaction on error
        return handleErrorResponse(res, err);
    } finally {
        conn.release();  // Release the connection back to the pool
    }
}


async function storeDelItems(conn, delId, itemsList) {
    try {
        const insertPromises = itemsList.map(async (item) => {

            // Insert into del_schedule_details table
            await conn.execute('INSERT INTO del_schedule_details (delScheduleId, sfgId, sfgQty) VALUES (?, ?, ?)',
                [delId, item.id, item.plannedQty]);

            // Update mrp table with the new issuePenQty
            await conn.execute(`UPDATE sfg_verification SET remarks = ? WHERE id = ?`, ['Completed', item.id]);
        });

        // Await all the promises
        await Promise.all(insertPromises);
    } catch (err) {
        throw err;
    }
}



exports.show = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body;

        let fetchQuery;
        let values = [];

        fetchQuery = `SELECT dsd.id, ds.sfgRefNo, mrpMst.mrpNo, mrp.itemCode, mrp.vendorProcess, 
            DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, op.poNo,
            DATE_FORMAT(ds.dispatchDate, '%d-%m-%Y') AS dispatchDate,
            dsd.sfgQty, dsd.dispatchQty, dsd.recievedQty, dsd.pendingQty, dsd.status, dsd.remarks,
            ds.createdBy, ds.vehicleNo, ds.dispatchTime
            FROM del_schedule ds
            INNER JOIN del_schedule_details dsd ON dsd.delScheduleId = ds.id
            INNER JOIN sfg_verification sv ON sv.id = dsd.sfgId
            LEFT JOIN mrp ON mrp.id = sv.mrpId
            LEFT JOIN mrp_mst mrpMst ON mrpMst.id = mrp.mrpMstId
            LEFT JOIN order_plannings op ON op.id = mrpMst.orderPlnId
        `;

        if (fromDate && toDate) {
            fetchQuery += ' WHERE DATE(ds.dispatchDate) >= ? AND DATE(ds.dispatchDate) <= ?';
            values.push(fromDate, toDate);
        }

        const [rows] = await connection.execute(fetchQuery, values);

        return res.status(200).json({
            success: true,
            message: 'Vendor process list',
            data: rows
        });
    } catch (err) {
        handleErrorResponse(res, err);
    }
}


// const getNextProcess = async (itemId, previousProcess) => {
//     const query = `
//             SELECT m.machineCode as machine, pm.code as process, ivp.processPriority as priority, pm.vendorProcess as vp
//             FROM item_vs_pm ivp
//             INNER JOIN mst_pm pm ON pm.id = ivp.process
//             INNER JOIN machines m ON m.id = ivp.machineName
//             WHERE item = ? AND ivp.dflag = ? 
//             ORDER BY ivp.processPriority
//         `;
//     const [rows] = await connection.execute(query, [itemId, 0]);

//     const fetchProcess = (processList, previousProcess) => {
//         if (processList.length === 0) return null;

//         let isProcessFound = false;
//         let lastVP = false;

//         for (const row of processList) {
//             if (!previousProcess) {
//                 if (isProcessFound) return [row.process, row.machine];
//                 if (row.vp === 1) isProcessFound = true;
//             } else {
//                 if (isProcessFound && lastVP) return [row.process, row.machine];
//                 if (row.process === previousProcess) isProcessFound = true;
//                 if (isProcessFound && row.vp === 1) lastVP = true;
//             }
//         }

//         return [null, null];
//     };

//     return fetchProcess(rows, previousProcess);
// };

const updateNextProcess = async (mrpId, itemId, previousProcess) => {
    const [processRows] = await connection.execute(`SELECT id, code FROM mst_pm WHERE code = ?`, [previousProcess]);

    if (processRows.length > 0) {
        const processId = processRows[0].id;

        const [rows] = await connection.execute(`
            SELECT 
                ip.process, ip.processPriority, m.machineCode AS machine, pm.code AS process
            FROM item_vs_pm ip
            JOIN item_vs_pm ipp ON ip.item = ipp.item AND ipp.process = ?
            JOIN machines m ON m.id = ip.machineName
            JOIN mst_pm pm ON pm.id = ip.process
            WHERE ip.item = ? AND ip.processPriority > ipp.processPriority
            ORDER BY ip.processPriority
            LIMIT 1`,
            [processId, itemId]
        );

        if (rows.length > 0) {
            const { machine, process } = rows[0];

            await connection.execute(`
                UPDATE mrp SET nextProcess = ?, machine = ? WHERE id = ?`,
                [process, machine, mrpId]
            );

            return true;
        }
    }
    return false;
};


// exports.updateQty = async (req, res) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();
//     try {
//         const { delScheduleId, dcNo, dcFile, invoiceNo, invoiceFile, itemsList } = req.body;

//         const dcFilePath = await storeFile(dcFile, 'dispatch');
//         const invoiceFilePath = await storeFile(invoiceFile, 'dispatch');

//         for (const item of itemsList) {
//             const { id, recievedQty: Qty, recievedWeight: weight } = item;

//             const [fetch] = await conn.execute(`SELECT mrpId, sfgVerificationId, Qty as sfgQty, recievedQty FROM jobwork_issue_details WHERE id = ? FOR UPDATE`, [id]);
//             if (fetch.length === 0) throw new CustomError('Delivery details not found!', 404);

//             const { mrpId, sfgVerificationId, sfgQty, recievedQty } = fetch[0];

//             const updatedRecQty = recievedQty + Qty;
//             const pendingQty = sfgQty - updatedRecQty;
//             const completionCheck = pendingQty === 0 ? true : false;

//             if (updatedRecQty > sfgQty) {
//                 throw new CustomError('Received Qty should not be greater than SFG Qty!', 400);
//             }

//             const updateQuery = `UPDATE jobwork_issue_details SET recievedQty = ?, pendingQty = ?, status = CASE WHEN ? THEN 'Completed' ELSE status END WHERE id = ?`;
//             await conn.execute(updateQuery, [updatedRecQty, pendingQty, completionCheck, id]);

//             // Insert into del_schedule_history
//             await conn.execute(`INSERT INTO del_schedule_history (jobWorkId, jobWrkIssueId, recievedQty, dcNo, dcFIle, invoiceNo, invoiceFIle) VALUES (?, ?, ?, ?, ?, ?, ?)`,
//                 [delScheduleId, id, Qty, dcNo, dcFilePath, invoiceNo, invoiceFilePath]
//             );

//             await updateProcessAndStatus(conn, delScheduleId, mrpId, sfgVerificationId);
//         }
//         await conn.commit();   // Commit transaction

//         return handleSuccessResponse(res, 'Update successful');
//     } catch (err) {
//         await conn.rollback();  // Rollback transaction on error
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();  // Release the connection back to the pool
//     }
// };

exports.updateQty = async (req, res) => {
    const conn = await connection.getConnection();
    const MAX_RETRIES = 3;

    try {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await conn.beginTransaction();

                const { delScheduleId, dcNo, dcFile, invoiceNo, invoiceFile, itemsList } = req.body;

                const dcFilePath = await storeFile(dcFile, 'dispatch');
                const invoiceFilePath = await storeFile(invoiceFile, 'dispatch');

                // ✅ VERY IMPORTANT: sort to maintain lock order
                const sortedItems = [...itemsList].sort((a, b) => a.id - b.id);

                for (const item of sortedItems) {
                    const { id, recievedQty: Qty, recievedWeight: weight } = item;

                    // ✅ keep FOR UPDATE (needed here) but safe due to sorting
                    const [fetch] = await conn.execute(
                        `SELECT mrpId, sfgVerificationId, Qty as sfgQty, recievedQty 
                         FROM jobwork_issue_details 
                         WHERE id = ? 
                         FOR UPDATE`,
                        [id]
                    );

                    if (fetch.length === 0) throw new CustomError('Delivery details not found!', 404);

                    const { mrpId, sfgVerificationId, sfgQty, recievedQty } = fetch[0];

                    const updatedRecQty = recievedQty + Qty;
                    const pendingQty = sfgQty - updatedRecQty;
                    const completionCheck = pendingQty === 0;

                    if (updatedRecQty > sfgQty) {
                        throw new CustomError('Received Qty should not be greater than SFG Qty!', 400);
                    }

                    await conn.execute(
                        `UPDATE jobwork_issue_details 
                         SET recievedQty = ?, pendingQty = ?, 
                             status = CASE WHEN ? THEN 'Completed' ELSE status END 
                         WHERE id = ?`,
                        [updatedRecQty, pendingQty, completionCheck, id]
                    );

                    await conn.execute(
                        `INSERT INTO del_schedule_history 
                         (jobWorkId, jobWrkIssueId, recievedQty, dcNo, dcFIle, invoiceNo, invoiceFIle) 
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [delScheduleId, id, Qty, dcNo, dcFilePath, invoiceNo, invoiceFilePath]
                    );

                    await updateProcessAndStatus(conn, delScheduleId, mrpId, sfgVerificationId);
                }

                await conn.commit();
                return handleSuccessResponse(res, 'Update successful');

            } catch (err) {
                await conn.rollback();

                if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
                    continue;
                }

                return handleErrorResponse(res, err);
            }
        }
    } finally {
        conn.release();
    }
}

const updateProcessAndStatus = async (conn, jobWorkId, mrpId, sfgVerificationId) => {
    const [mrp] = await conn.execute(`SELECT mrpMstId, jcId, itemId, itemCode, nextProcess, Qty, jwQty FROM mrp WHERE id = ?`, [mrpId]);
    if (mrp.length === 0) throw new CustomError(`Mrp details not found!`, 404);

    const { mrpMstId, itemId, jcId, itemCode, nextProcess: previousProcess, Qty, jwQty } = mrp[0];

    if (await updateNextProcess(mrpId, itemId, previousProcess)) {
        return true;
    } else {
        // If no further process, all processes are completed
        let mrpQuery = `UPDATE mrp SET nextProcess = ?, machine = ?`;
        const mrpValues = [null, null];

        if (Qty === jwQty) {
            mrpQuery += `, isCompleted = ?, remarks = ?`;
            mrpValues.push('Yes', 'Completed');

            await handleSFGstock(conn, mrpMstId, mrpId, jcId, jobWorkId, itemId, itemCode, jwQty)
            await conn.execute(`UPDATE sfg_verification SET isCompleted = ?, remarks = ? WHERE id = ?`, [1, 'Completed', sfgVerificationId]);
        }
        mrpQuery += ` WHERE id = ?`;
        mrpValues.push(mrpId);

        await conn.execute(mrpQuery, mrpValues);
    }

    return true;
}

const handleSFGstock = async (conn, mrpMstId, mrpId, jcId, jobWorkId, itemId, itemCode, Qty) => {
    const [rows] = await conn.execute(`SELECT totQty FROM sfg_stock WHERE itemId = ? ORDER BY id DESC limit 1`, [itemId]);
    const [sfgRows] = await conn.execute(`SELECT inwardQty FROM sfg_stock WHERE mrpId = ? AND itemId = ? ORDER BY id DESC limit 1`, [mrpId, itemId]);

    const [rowLen, sfgLen] = [rows.length, sfgRows.length];
    const totQty = rowLen > 0 ? Number(rows[0].totQty) + Number(Qty) : Qty;
    const inwardQty = sfgLen > 0 ? Number(sfgRows[0].inwardQty) + Number(Qty) : Qty;

    if (sfgRows.length > 0) {
        await conn.execute(`UPDATE sfg_stock SET inwardQty = ?, totQty = ? WHERE mrpId = ? AND itemId = ?`, [inwardQty, totQty, mrpId, itemId]);
    } else {
        await conn.execute(`INSERT INTO sfg_stock (mrpMstId, mrpId,	itemId,	itemCode, inwardType, inwardId, inwardQty, totQty) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
            [mrpMstId, mrpId, itemId, itemCode, 'Job Work', jobWorkId, inwardQty, totQty]
        );
    }

    return true;
}

exports.delscheduleHistory = async (req, res) => {
    try {
        const { delscheduleId } = req.query;

        const [rows] = await connection.execute(`SELECT dsh.*, jid.Qty as sfgQty, items.itemCode, DATE_FORMAT(dsh.created_at, '%d-%m-%Y') AS recievedDate, grn.grnNo
            FROM del_schedule_history dsh 
            INNER JOIN jobwork_issue_details jid ON jid.id = dsh.jobWrkIssueId
            LEFT JOIN mrp ON mrp.id = jid.mrpId
            INNER JOIN items ON items.id = jid.itemId
            LEFT JOIN GRN grn ON grn.id = mrp.grnId
            WHERE dsh.jobWorkId = ?`,
            [delscheduleId]
        );

        return handleSuccessResponse(res, 'Delivery Schedule history', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


exports.vendorDeliverySchedule = async (req, res) => {
    try {

        const fetchQuery = `SELECT jobWrk.*, DATE_FORMAT(jobWrk.dispatchDate, '%d-%m-%Y') AS dispatchDate, DATE_FORMAT(jobWrk.created_at, '%d-%m-%Y') AS created_at, supplier.spCode as supCode 
            FROM jobwork_issue jobWrk
            INNER JOIN supplier ON supplier.id = jobWrk.supplierId`
            ;

        const [rows] = await connection.execute(fetchQuery, []);

        return handleSuccessResponse(res, 'Vendor Delivery-Schedule', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


exports.deliveryScheduleItems = async (req, res) => {
    try {
        const { delscheduleId } = req.query;

        const fetchQuery = `SELECT jobWrk.id, items.itemCode, jobWrk.Qty as sfgQty, jobWrk.Qty as dispatchQty, jobWrk.status, jobWrk.*, jc.jcNo 
            FROM jobwork_issue_details jobWrk
            LEFT JOIN mrp ON mrp.id = jobWrk.mrpId
            INNER JOIN items ON items.id = jobWrk.itemId
            LEFT JOIN job_card jc ON jc.id = mrp.jcId
            WHERE jobWrk.jobWorkId = ?
        `;

        const [rows] = await connection.execute(fetchQuery, [delscheduleId]);

        return handleSuccessResponse(res, 'Delivery-Schedule Items', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


exports.search = async (req, res) => {
    try {
        const { q } = req.query;

        let fetch = `
            SELECT ji.id, ji.dcNo as label, ji.dcNo FROM jobwork_issue ji 
            WHERE ji.isClosed = 0
        `;
        const values = [];

        if (q) {
            fetch += ` AND (ji.dcNo LIKE ?)`;
            values.push(`%${q}%`);
        }
        fetch += ` LIMIT 20`;

        const [rows] = await connection.execute(fetch, values);

        return handleSuccessResponse(res, 'DC No', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


exports.jobWorkIsuue = async (req, res) => {
    try {
        const { delscheduleId, type } = req.query;
        const { fyFrom, fyTo } = formatFinancialYears(req);

        let delQuery = `SELECT * FROM jobwork_issue WHERE DATE(created_at) BETWEEN ? AND ?`;
        let params = [fyFrom, fyTo];

        switch (type) {
            case 'first':
                delQuery += ` ORDER BY jobwork_issue.id ASC LIMIT 1`;
                break;
            case 'last':
                delQuery += ` ORDER BY jobwork_issue.id DESC LIMIT 1`;
                break;
            case 'forward':
                delQuery += ` AND jobwork_issue.id > ? ORDER BY jobwork_issue.id ASC LIMIT 1`;
                params.push(delscheduleId);
                break;
            case 'reverse':
                delQuery += ` AND jobwork_issue.id < ? ORDER BY jobwork_issue.id DESC LIMIT 1`;
                params.push(delscheduleId);
                break;
            case 'view':
                delQuery += ` AND jobwork_issue.id = ?`;
                params.push(delscheduleId);
                break;
            // If no specific type is provided, return all items
        }

        const [delSchedule] = await connection.execute(delQuery, params);
        let rows = [], supplier = [];

        if (delSchedule.length) {

            const { id: delId, supplierId } = delSchedule[0];

            [supplier] = await connection.execute(`
                SELECT  
                    supplier.id, supplier.spCode, supplier.spName, supplier.spPlace,
                    CONCAT(supplier.spAdd1, ' ', supplier.spAdd2, ' ', supplier.spAdd3, ' ', supplier.spAdd4) AS spAddress,
                    supplier.sId, cur.name as currency, cur.id as currencyId, supplier.panNo, supplier.gstNo
                FROM supplier
                    LEFT JOIN mst_currency as cur ON supplier.currency = cur.id
                WHERE supplier.dflag = '0' AND supplier.id = ?`,
                [supplierId]
            );

            if (!supplier.length) {
                throw new CustomError('Supplier details not found!', 404);
            }

            const fetchQuery = `
                SELECT 
                    items.id, jobWrk.id as delScheduleId, items.itemCode, items.itemName, uom.name as uom, items.totStk as qoh, hsn.name as hsn, jobWrk.Qty as jwQty, loc.name as location, 
                    loc.name as location, COALESCE(jobWrk.grnNo, grn.grnNo) AS grnNo, COALESCE(supVsItem.suppDesc, items.itemName) AS suppDesc, jobWrk.rate, jobWrk.amount, jobwork_issue.vehicleNo, jc.jcNo
                FROM jobwork_issue_details jobWrk
                    INNER JOIN items ON items.id = jobWrk.itemId
                    LEFT JOIN mst_uom AS uom ON uom.id = items.uom
                    LEFT JOIN item_hsn_code AS hsn ON hsn.id = items.hsnCode
                    LEFT JOIN item_main_loc AS loc ON loc.id = items.mainLocation
                    LEFT JOIN GRN AS grn ON grn.id = jobWrk.grnId
                    INNER JOIN jobwork_issue ON jobwork_issue.id = jobWrk.jobWorkId
                    LEFT JOIN sfg ON sfg.id = jobWrk.sfgId
                    LEFT JOIN job_card jc ON jc.id = sfg.jcId
                    LEFT JOIN supp_vs_item AS supVsItem ON supVsItem.spName = jobwork_issue.supplierId AND supVsItem.itemName = jobWrk.itemId
                WHERE jobwork_issue.supplierId = ? AND jobwork_issue.id = ?
            `;

            [rows] = await connection.execute(fetchQuery, [supplierId, delId]);
        }

        return res.status(200).json({
            success: true,
            message: 'Job-Work details',
            jobWork: delSchedule[0],
            supplier: supplier[0],
            itemsList: rows
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}



exports.template = async (req, res) => {
    try {
        const { delscheduleId } = req.query;

        const fetchQuery = `SELECT ROW_NUMBER() OVER (ORDER BY jc.jcNo) AS SlNo, dsd.id, jc.jcNo, items.itemCode, dsd.sfgQty  FROM del_schedule_details dsd
                INNER JOIN del_schedule ON del_schedule.id = dsd.delScheduleId
                INNER JOIN sfg_verification sv ON sv.id = dsd.sfgId
                INNER JOIN mrp ON mrp.id = sv.mrpId
                INNER JOIN items ON items.id = mrp.itemId
                LEFT JOIN job_card jc ON jc.id = mrp.jcId
                WHERE dsd.delscheduleId = ?
            `;

        const [delScheduleRows] = await connection.execute(fetchQuery, [delscheduleId]);

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Sl no', 'Delivery Shcedule Id', 'Job Card', 'Part No', 'Sfg Qty', 'Return Qty', 'Weight']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        delScheduleRows.forEach((row, index) => {
            const rowData = Object.values(row);
            const addedRow = worksheet.addRow(rowData);

            // center allign
            addedRow.eachCell((cell, colNumber) => {
                cell.alignment = { horizontal: 'center' };
            });
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = SFG-template.xlsx');

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
        const reqData = req.body;

        const buffer = await decodeBase64(reqData.file);

        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.getWorksheet(1);
        const items = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber !== 1) { // Skip header row
                items.push({
                    id: row.getCell(2).value,
                    itemCode: row.getCell(4).value,
                    recievedQty: row.getCell(6).value,
                    recievedWeight: row.getCell(7).value,
                });
            }
        });

        //console.log(items)
        await insertDelItems(reqData, items);

        return handleSuccessResponse(res, 'Update successful');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


// async function insertDelItems(body, itemsList) {
//     const conn = await connection.getConnection();  // Obtain a connection from the pool
//     await conn.beginTransaction();  // Begin transaction

//     try {
//         const { delScheduleId, dcNo, dcFile, invoiceNo, invoiceFile } = body;

//         const dcFilePath = await storeFile(dcFile, 'dispatch');
//         const invoiceFilePath = await storeFile(invoiceFile, 'dispatch');

//         for (const item of itemsList) {
//             const { id, recievedQty: Qty, recievedWeight: weight } = item;

//             const [fetch] = await conn.execute(`SELECT sfgQty, recievedQty FROM del_schedule_details WHERE id = ? FOR UPDATE`, [id]);
//             if (fetch.length === 0) throw new CustomError('Delivery details not found!', 404);

//             const { sfgQty, recievedQty } = fetch[0];

//             const updatedRecQty = recievedQty + Qty;
//             const pendingQty = sfgQty - updatedRecQty;
//             const completionCheck = pendingQty === 0 ? true : false;

//             if (updatedRecQty > sfgQty) {
//                 throw new CustomError('Received Qty should not be greater than SFG Qty!', 400);
//             }

//             const updateQuery = `UPDATE del_schedule_details SET recievedQty = ?, pendingQty = ?, status = CASE WHEN ? THEN 'Completed' ELSE status END WHERE id = ?`;
//             await conn.execute(updateQuery, [updatedRecQty, pendingQty, completionCheck, id]);

//             // Insert into del_schedule_history
//             await conn.execute(`INSERT INTO del_schedule_history (delScheduleId, dsdId, recievedQty, recievedWeight, dcNo, dcFIle, invoiceNo, invoiceFIle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
//                 [delScheduleId, id, Qty, weight, dcNo, dcFilePath, invoiceNo, invoiceFilePath]
//             );
//         }
//         await conn.commit();   // Commit transaction

//         return true;
//     } catch (err) {
//         await conn.rollback();  // Rollback transaction on error
//         throw err;
//     } finally {
//         conn.release();  // Release the connection back to the pool
//     }
// }

async function insertDelItems(body, itemsList) {
    const conn = await connection.getConnection();
    const MAX_RETRIES = 3;

    try {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await conn.beginTransaction();

                const { delScheduleId, dcNo, dcFile, invoiceNo, invoiceFile } = body;

                const dcFilePath = await storeFile(dcFile, 'dispatch');
                const invoiceFilePath = await storeFile(invoiceFile, 'dispatch');

                // ✅ CRITICAL: maintain lock order
                const sortedItems = [...itemsList].sort((a, b) => a.id - b.id);

                for (const item of sortedItems) {
                    const { id, recievedQty: Qty, recievedWeight: weight } = item;

                    // ✅ keep FOR UPDATE (correct usage)
                    const [fetch] = await conn.execute(
                        `SELECT sfgQty, recievedQty 
                         FROM del_schedule_details 
                         WHERE id = ? 
                         FOR UPDATE`,
                        [id]
                    );

                    if (fetch.length === 0) {
                        throw new CustomError('Delivery details not found!', 404);
                    }

                    const { sfgQty, recievedQty } = fetch[0];

                    const updatedRecQty = recievedQty + Qty;
                    const pendingQty = sfgQty - updatedRecQty;
                    const completionCheck = pendingQty === 0;

                    if (updatedRecQty > sfgQty) {
                        throw new CustomError('Received Qty should not be greater than SFG Qty!', 400);
                    }

                    await conn.execute(
                        `UPDATE del_schedule_details 
                         SET recievedQty = ?, 
                             pendingQty = ?, 
                             status = CASE WHEN ? THEN 'Completed' ELSE status END 
                         WHERE id = ?`,
                        [updatedRecQty, pendingQty, completionCheck, id]
                    );

                    await conn.execute(
                        `INSERT INTO del_schedule_history 
                         (delScheduleId, dsdId, recievedQty, recievedWeight, dcNo, dcFIle, invoiceNo, invoiceFIle) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [delScheduleId, id, Qty, weight, dcNo, dcFilePath, invoiceNo, invoiceFilePath]
                    );
                }

                await conn.commit();
                return true;

            } catch (err) {
                await conn.rollback();

                // ✅ retry on deadlock
                if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
                    continue;
                }

                throw err;
            }
        }
    } finally {
        conn.release();
    }
}
const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require("../config/dbSql");

exports.fetchMrp = async (req, res) => {
    try {
        const fetchQ = `
            SELECT 
                mstMrp.id, mstMrp.poNo, mstMrp.mrpNo, null as srnNo, mstMrp.requestedBy, op.orderNo, op.kanbanDate, cust.cName as customerName, supPlc.name as location, 
                DATE_FORMAT(mstMrp.created_at, '%d-%m-%Y') AS created_at, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, mstMrp.status
            FROM mrp_mst as mstMrp
            LEFT JOIN order_plannings as op ON op.id = mstMrp.orderPlnId
            LEFT JOIN customer as cust ON cust.id = mstMrp.customerId
            LEFT JOIN mst_sup_place as supPlc ON supPlc.id = cust.placeOfSupply
            WHERE op.orderPriority != ?
        `;
        const [rows] = await connection.execute(fetchQ, [0]);

        if (rows.length >= 0) {
            return res.status(200).json({ success: true, message: 'MRP lists', data: rows });
        }
        throw new CustomError('Something went wrong!', 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
}

exports.fetchJc = async (req, res) => {
    try {
        const mrpMstId = req.params.id;
        const page = Math.max(0, parseInt(req.query.page) || 0);
        const limit = Math.max(1, parseInt(req.query.limit) || 100);

        const [[{ totalRows }]] = await connection.execute(`
            SELECT COUNT(*) AS totalRows 
            FROM sfg
            WHERE sfg.mrpMstId = ?
        `, [mrpMstId]);

        const offset = page * limit;
        const [rows] = await connection.execute(`
            SELECT 
                sfg.id, jc.jcNo, items.itemCode, items.category, items.material as rawMaterialName, 
                items.allocStk AS totStk, uom.code as uom, sfg.Qty as reqQty, sfg.allocQty, 
                sfg.allocPenQty, sfg.remarks,
                CASE 
                    WHEN sfg.allocStatus = 0 THEN 'UnAllocate'
                    ELSE 'Allocate'
                END AS allocStatus
            FROM sfg
            INNER JOIN items ON items.id = sfg.itemId 
            LEFT JOIN mst_uom AS uom ON uom.id = items.uom
            LEFT JOIN job_card jc ON jc.id = sfg.jcId
            WHERE sfg.mrpMstId = ?
            ORDER BY jc.id ASC
            LIMIT ? OFFSET ?
        `, [mrpMstId, limit, offset]);

        return res.status(200).json({
            success: true,
            message: 'JC lists',
            data: rows,
            currentPage: page,
            totRows: totalRows,
            totalPages: Math.ceil(totalRows / limit)
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.updateMode = async (req, res) => {
    try {
        const { id, mode } = req.body;

        if (!id || !mode) throw new CustomError('Request body can not be empty!', 400);

        const [rows] = await connection.execute(`UPDATE allocation_mode SET mode = ? WHERE id = ?`, [mode, id]);

        if (rows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: 'Mode updated successfully' });
        }
        throw new CustomError('Something went wrong!', 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
}

exports.fetchMode = async (req, res) => {
    try {
        let rows;
        [rows] = await connection.execute(`SELECT * FROM allocation_mode`, []);

        if (rows.length === 0) {
            const [insrtRows] = await connection.execute(`INSERT INTO allocation_mode (mode) VALUES ('Manual')`, []);

            if (insrtRows.affectedRows > 0) {
                [rows] = await connection.execute(`SELECT * FROM allocation_mode`, []);
            }
        }

        return res.status(200).json({ success: true, message: 'Allocation mode', data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
}

exports.allocate = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const sfgId = req.params.id;
        const { allocStatus, allocQty, remarks, allocDate } = req.body;

        if (!sfgId || !allocStatus) {
            throw new CustomError('Missing required fields (sfgId, allocStatus)', 400);
        }

        // Fetch item & SFG details
        const [rows] = await conn.execute(`
            SELECT s.id AS sfgId, s.allocStatus, s.allocQty AS currentAllocQty, s.allocPenQty, s.Qty AS totalQty,
                i.id AS itemId, i.minStockLvl, i.allocStk
            FROM sfg s
            INNER JOIN items i ON i.id = s.itemId
            WHERE s.id = ?
        `, [sfgId]);

        if (rows.length === 0) {
            throw new CustomError('SFG or related item not found!', 404);
        }

        const data = rows[0];

        // Prevent double allocation
        if (allocStatus === 'Allocate' && data.allocStatus === 1) {
            throw new CustomError('This SFG item is already allocated!', 400);
        }

        if (allocStatus === 'Allocate') {
            // Validate allocQty
            if (!allocQty || isNaN(allocQty) || Number(allocQty) <= 0) {
                throw new CustomError('Invalid allocation quantity!', 400);
            }

            // Perform allocation logic
            const allocResult = await performManualAllocation(conn, sfgId, {
                id: data.itemId,
                minStockLvl: data.minStockLvl,
                allocStk: data.allocStk
            }, allocQty);

            // Calculate new pending quantity based on total requirement
            const newPenQty = Math.max(data.totalQty - allocResult.allocQty, 0);

            // Update SFG table
            let query = `UPDATE sfg SET allocQty = ?, allocPenQty = ?`;
            const values = [allocResult.allocQty, newPenQty];

            if (allocResult.allocPenQty === 0) {
                query += `, allocStatus = 1`;
            }

            query += `, remarks = ?, allocDate = ? WHERE id = ?`;
            values.push(remarks ?? null, allocDate ?? null, sfgId);

            const [sfgUpdate] = await conn.execute(query, values);

            if (sfgUpdate.affectedRows === 0) {
                throw new CustomError('Failed to update SFG allocation!', 400);
            }

            await conn.commit();
            return res.status(200).json({ success: true, message: 'Allocated successfully' });

        } else if (allocStatus === 'UnAllocate') {
            // Revert allocation from items table
            await manualUnallocate(conn, sfgId, data.itemId);

            // Reset SFG allocation info
            const [sfgUpdate] = await conn.execute(
                `UPDATE sfg 
                 SET allocQty = 0, allocPenQty = Qty, allocStatus = 0, remarks = NULL, allocDate = NULL 
                 WHERE id = ?`,
                [sfgId]
            );

            if (sfgUpdate.affectedRows === 0) {
                throw new CustomError('Failed to unallocate SFG!', 400);
            }

            await conn.commit();
            return res.status(200).json({ success: true, message: 'Unallocated successfully' });
        }

        throw new CustomError('Invalid allocStatus provided!', 400);

    } catch (err) {
        await conn.rollback();
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};

async function performManualAllocation(conn, sfgId, item, allocQty) {
    const requestedQty = parseInt(allocQty, 10);

    if (!requestedQty || isNaN(requestedQty) || requestedQty <= 0) {
        throw new CustomError('Invalid allocation quantity!', 400);
    }

    const minStockLvl = parseInt(item.minStockLvl, 10);
    const allocStk = parseInt(item.allocStk, 10);
    const availableQty = Math.max(0, allocStk - minStockLvl);
    const pendingQty = availableQty - requestedQty;

    if (pendingQty < 0) {
        const safeAllocQty = availableQty;
        const newStock = allocStk - safeAllocQty;

        await conn.execute(
            `UPDATE items SET allocStk = ? WHERE id = ?`,
            [Math.max(minStockLvl, newStock), item.id]
        );

        // Handle shortage
        await shortageItems({ sfgId, itemId: item.id }, requestedQty, Math.abs(pendingQty));

        return { allocQty: safeAllocQty, allocPenQty: Math.abs(pendingQty) };
    } else {
        const newStock = allocStk - requestedQty;

        await conn.execute(
            `UPDATE items SET allocStk = ? WHERE id = ?`,
            [newStock, item.id]
        );

        return { allocQty: requestedQty, allocPenQty: 0 };
    }
}

async function manualUnallocate(conn, sfgId, itemId) {
    const [sfg] = await conn.execute(`SELECT allocQty FROM sfg WHERE id = ?`, [sfgId]);
    if (sfg.length === 0) throw new CustomError('SFG not found', 404);

    const allocQty = parseInt(sfg[0].allocQty, 10) || 0;

    await conn.execute(`UPDATE items SET allocStk = allocStk + ? WHERE id = ?`, [allocQty, itemId]);
}


async function shortageItems(mrpData, allocQty, finalStk) {
    try {
        const [fetchRows] = await connection.execute(`SELECT reqQty, allocQty, stockInHand, indent FROM boi_indent WHERE itemId = ?`, [mrpData.itemId]);

        if (fetchRows.length > 0) {
            // If a row with the itemId exists, update the values by adding to the previous values
            const prevRow = fetchRows[0];
            const updatedReqQty = prevRow.reqQty + mrpData.Qty;
            const updatedAllocQty = prevRow.allocQty + allocQty;
            const updatedStockInHand = prevRow.stockInHand + finalStk;
            const updatedIndent = Math.abs(updatedStockInHand);

            const updateQuery = `UPDATE boi_indent SET reqQty = ?, allocQty = ?, stockInHand = ?, indent = ? WHERE itemId = ?`;
            const updateValues = [updatedReqQty, updatedAllocQty, updatedStockInHand, updatedIndent, mrpData.itemId];

            await connection.execute(updateQuery, updateValues);
        } else {
            // If no row with the itemId exists, insert a new row
            const insertQuery = `INSERT INTO boi_indent (itemId, reqQty, allocQty, stockInHand, indent) VALUES (?, ?, ?, ?, ?)`;
            const values = [mrpData.itemId, mrpData.Qty, allocQty, finalStk, Math.abs(finalStk)];

            await connection.execute(insertQuery, values);
        }

        return true;
    } catch (error) {
        throw error;
    }
}

// Automatic allocation functions
exports.automaticAlloc = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const mrpMstId = req.params.id;
        const [mstMrp] = await conn.execute(`SELECT allocStatus FROM mrp_mst WHERE id = ?`, [mrpMstId]);

        if (mstMrp.length === 0) throw new CustomError('MRP not found!', 404);
        if (mstMrp[0].allocStatus === 1) throw new CustomError('Already allocated!', 400);

        await this.automation(conn, mrpMstId);
        await conn.commit();

        return handleSuccessResponse(res, 'Allocation successfull');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

exports.automation = async function (conn, mrpMstId) {
    try {
        //console.log('Allocation started...');

        const [sfgRows] = await conn.execute(`
            SELECT s.id as sfgId, null as mrpId, s.itemId, s.itemCode, (s.Qty - s.allocQty) as Qty, s.allocStatus, 
                   i.allocStk, i.totStk, i.minStockLvl, i.category, 'sfg' as type
            FROM sfg s
            INNER JOIN items i ON i.id = s.itemId 
            WHERE s.mrpMstId = ?`,
            [mrpMstId]
        );

        const [mrpRows] = await conn.execute(`
            SELECT m.id as mrpId, null as sfgId, m.itemId, m.itemCode, (m.Qty - m.allocQty) as Qty, m.allocStatus, 
                   i.allocStk, i.totStk, i.minStockLvl, i.category, 'mrp' as type
            FROM mrp m
            INNER JOIN items i ON i.id = m.itemId 
            WHERE m.mrpMstId = ? AND i.category IN ('BUY', 'BUY PRODUCTION')`,
            [mrpMstId]
        );

        for (const item of [...sfgRows, ...mrpRows]) {
            await calculation(conn, mrpMstId, item);
        }

        const [unallocatedSfg] = await conn.execute(`SELECT id FROM sfg WHERE mrpMstId = ? AND allocStatus = 0`, [mrpMstId]);
        if (unallocatedSfg.length === 0) {
            await conn.execute(`UPDATE mrp_mst SET allocStatus = ? WHERE id = ?`, [1, mrpMstId]);
        }

        //console.log('Allocation successful.');
        return true;
    } catch (error) {
        throw error;
    }
};

async function calculation(conn, mrpMstId, item) {
    const {
        type, sfgId, mrpId, itemId, Qty, allocStatus,
        allocStk, minStockLvl, category
    } = item;

    const id = type === 'sfg' ? sfgId : mrpId;
    if (allocStatus === 1 || parseInt(Qty) <= 0) return;

    const availableQty = Math.max(0, parseInt(allocStk) - parseInt(minStockLvl));
    const requiredQty = parseInt(Qty);
    const pendingQty = availableQty - requiredQty;

    if (pendingQty < 0) {
        await handleStock(conn, type, id, itemId, availableQty, Math.abs(pendingQty));
        await handleShortage(conn, mrpMstId, itemId, category, requiredQty, availableQty, Math.abs(pendingQty));
    } else {
        await handleStock(conn, type, id, itemId, requiredQty, 0);
    }
}

async function handleShortage(conn, mrpMstId, itemId, category, reqQty, allocQty, indent) {
    if (category === 'BUY' || category === 'BUY PRODUCTION') {
        const [boiRows] = await conn.execute(`SELECT id FROM boi_indent WHERE mrpMstId = ? AND itemId = ?`, [mrpMstId, itemId]);
        if (boiRows.length) return;

        const insertQuery = `
            INSERT INTO boi_indent (mrpMstId, itemId, reqQty, allocQty, indent) 
            VALUES (?, ?, ?, ?, ?) 
            ON DUPLICATE KEY UPDATE 
                reqQty = reqQty + VALUES(reqQty),
                allocQty = allocQty + VALUES(allocQty),
                indent = indent + VALUES(indent)
        `;
        await conn.execute(insertQuery, [mrpMstId, itemId, reqQty, allocQty, indent]);
    }
}

async function handleStock(conn, type, id, itemId, allocQty, allocPenQty) {
    if (allocQty <= 0) return;

    // Ensure stock won't go negative
    const [[item]] = await conn.execute(`SELECT allocStk FROM items WHERE id = ?`, [itemId]);
    const currentStock = parseInt(item.allocStk);
    const newStock = Math.max(0, currentStock - allocQty);

    await conn.execute(`UPDATE items SET allocStk = ? WHERE id = ?`, [newStock, itemId]);

    const tableName = type === 'sfg' ? 'sfg' : 'mrp';
    let query = `UPDATE ${tableName} SET allocQty = allocQty + ?, allocPenQty = ?`;
    const params = [allocQty, allocPenQty];

    if (allocPenQty === 0) {
        query += `, allocStatus = ?`;
        params.push(1);
    }

    query += ` WHERE id = ?`;
    params.push(id);

    await conn.execute(query, params);
}

exports.storeSfg = async (conn, mrpMstId) => {
    try {
        const [result] = await conn.execute(
            `SELECT mm.orderPlnId, jc.mrpMstId, jc.id as jcId, null AS mrpId, jc.itemId, jc.itemCode, Qty 
             FROM job_card jc 
             INNER JOIN mrp_mst mm ON mm.id = jc.mrpMstId 
             WHERE jc.mrpMstId = ?`,
            [mrpMstId]
        );

        if (result.length === 0) return;

        const placeholders = result.map(() => '(?,?,?,?,?,?,?)').join(',');
        const flattenedData = result.flatMap(item => [
            item.orderPlnId, item.mrpMstId, item.jcId, item.mrpId, item.itemId, item.itemCode, item.Qty
        ]);

        await conn.execute(
            `INSERT INTO sfg (orderPlnId, mrpMstId, jcId, mrpId, itemId, itemCode, Qty) 
             VALUES ${placeholders}`,
            flattenedData
        );
        await this.automation(conn, mrpMstId)

        return true;
    } catch (err) {
        throw err;
    }
};
const { getFYRange } = require("../../cache/fyRange.cache");
const { handleErrorResponse, handleSuccessResponse, connection, CustomError } = require("../config/dbSql");
const { formatFinancialYears, generateDocNo, updateDocCounter } = require("../utility/docNo");
const { getUser } = require("../utility/utilityFunction");

exports.jwrNo = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'JobworkReceipt' });

        return handleSuccessResponse(res, 'JWR Number', { sequentialNumber: padStartNo, jwrNo: uniqueNo });
    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.searchJwrNo = async (req, res) => {
    try {
        const { q = "" } = req.query;

        if (!q.trim()) {
            return handleSuccessResponse(res, "JwrNo", []);
        }

        const [rows] = await connection.execute(`
            SELECT id, jwrNo
            FROM jobwork_reciept
            WHERE jwrNo LIKE ?
            ORDER BY jwrNo ASC
            LIMIT 20`,
            [`${q}%`]
        );

        // If no prefix match found, fallback to full LIKE (optional)
        if (rows.length === 0) {
            const [fallbackRows] = await connection.execute(`
                SELECT id, jwrNo
                FROM jobwork_reciept
                WHERE jwrNo LIKE ?
                ORDER BY jwrNo ASC
                LIMIT 20
            `, [`%${q}%`]);

            return handleSuccessResponse(res, "JwrNo", fallbackRows);
        }

        return handleSuccessResponse(res, "JwrNo", rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { sequentialNumber = null, jwrNo, supplierId, invoiceNo, invoiceDate, dcNo, dcDate, totQty, itemsList = [] } = req.body;

        const createdBy = await getUser(req);

        const [rows] = await conn.execute(
            `INSERT INTO jobwork_reciept 
                (docNo, jwrNo, supplierId, invoiceNo, invoiceDate, dcNo, dcDate, totQty, createdBy) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sequentialNumber, jwrNo || null, supplierId, invoiceNo, invoiceDate, dcNo, dcDate, totQty, createdBy]
        );

        if (rows.affectedRows === 0) {
            throw new CustomError(`Insertion failed!`, 400);
        }
        const insertId = rows.insertId;

        if (itemsList.length > 0) {
            // Insert jobwork receipt detail rows
            const jwrQuery = `INSERT INTO jobwork_reciept_details (jwrId, jwiId, jcNo, itemId, jwiQty, cumQty, pendQty, jwrQty) VALUES ?`;
            const values = itemsList.map(v => [insertId, v.id, v.jcNo || null, v.itemId, Number(v.jwiQty) || 0, Number(v.cumQty) || 0, Number(v.pendQty) || 0, Number(v.jwrQty) || 0]);
            await conn.query(jwrQuery, [values]);

            const ids = itemsList.map(obj => obj.id);

            // Update cumulative and received quantities
            const updateCumQty = itemsList
                .map(obj => `WHEN ${obj.id} THEN cumQty + ${Number(obj.jwrQty) || 0}`)
                .join(' ');

            const updateRecQty = itemsList
                .map(obj => `WHEN ${obj.id} THEN recievedQty + ${Number(obj.jwrQty) || 0}`)
                .join(' ');

            const step1Query = `
                UPDATE jobwork_issue_details
                SET 
                    cumQty      = CASE id ${updateCumQty} ELSE cumQty END,
                    recievedQty = CASE id ${updateRecQty} ELSE recievedQty END
                WHERE id IN (${ids.join(',')})
            `;
            await conn.query(step1Query);

            // Recalculate derived fields using updated values
            const step2Query = `
                UPDATE jobwork_issue_details
                SET 
                    pendingQty = GREATEST(Qty - cumQty, 0),
                    isClosed   = CASE WHEN recievedQty >= Qty THEN 1 ELSE 0 END
                WHERE id IN (${ids.join(',')})
            `;
            await conn.query(step2Query);

            // Update SFG status for fully matched items (receipt = issue qty)
            const matchingItems = itemsList.filter(item => Number(item.jwiQty) === Number(item.jwrQty));
            if (matchingItems.length > 0) {
                const itemIds = matchingItems.map(item => item.id);
                const placeholders = itemIds.map(() => '?').join(',');
                await updateSfgStatus(conn, itemIds, placeholders);
            }
        }

        // Update document counter
        await updateDocCounter(conn, 'JobworkReceipt');

        await conn.commit();
        return handleSuccessResponse(res, 'Jobwork receipt stored successfully.');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

const updateSfgStatus = async (conn, itemIds, placeholders) => {
    try {
        const [rows] = await conn.execute(
            `SELECT sfgVerificationId FROM jobwork_issue_details WHERE id IN (${placeholders})`,
            itemIds
        );
        //console.log(rows);
        const sfgVerificationIds = rows.map(row => row.sfgVerificationId);

        if (sfgVerificationIds.length === 0) return;

        const sfgPlaceholders = sfgVerificationIds.map(() => '?').join(',');
        await conn.execute(
            `UPDATE sfg_verification SET isCompleted = ? WHERE id IN (${sfgPlaceholders})`,
            [1, ...sfgVerificationIds]
        );

        return;
    } catch (err) {
        throw new Error(`Error updating SFG status: ${err.message}`);
    }
};

exports.show = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { jwrId, type } = req.query;
        const { from, to } = getFYRange(req);

        let jrQuery = `
            SELECT jr.id, jr.docNo as sequentialNumber, jr.jwrNo, jr.invoiceNo, DATE_FORMAT(jr.created_at, '%d-%m-%Y') AS jwrDate, DATE_FORMAT(jr.invoiceDate, '%m-%d-%Y') AS invoiceDate, jr.supplierId, jr.dcNo, 
            DATE_FORMAT(jr.dcDate, '%m-%d-%Y') AS dcDate, jr.totQty
            FROM jobwork_reciept jr 
            WHERE jr.created_at BETWEEN ? AND ?
        `;
        let params = [from, to];

        switch (type) {
            case 'first':
                jrQuery += ` ORDER BY jr.id ASC LIMIT 1`;
                break;
            case 'last':
                jrQuery += ` ORDER BY jr.id DESC LIMIT 1`;
                break;
            case 'forward':
                jrQuery += ` AND jr.id > ? ORDER BY jr.id ASC LIMIT 1`;
                params.push(jwrId);
                break;
            case 'reverse':
                jrQuery += ` AND jr.id < ? ORDER BY jr.id DESC LIMIT 1`;
                params.push(jwrId);
                break;
            case 'view':
                jrQuery += ` AND jr.id = ?`;
                params.push(jwrId);
                break;
        }

        const [jwrRows] = await conn.execute(jrQuery, params);

        if (!jwrRows.length) {
            return res.status(200).json({
                success: true,
                message: 'No JobWork-Receipt found',
                jobWork: [],
                supplier: [],
                itemsList: []
            });
        }

        const { id, supplierId } = jwrRows[0];

        // Supplier
        const [supplier] = await conn.execute(`
            SELECT  
                s.id, s.spCode, s.spName, s.spPlace,
                CONCAT_WS(' ', s.spAdd1, s.spAdd2, s.spAdd3, s.spAdd4) AS spAddress
            FROM supplier s
                LEFT JOIN mst_currency cur ON s.currency = cur.id
            WHERE s.dflag = '0' AND s.id = ?`,
            [supplierId]
        );

        // Items
        const [items] = await conn.execute(`
            SELECT 
                jrd.id, jrd.jwiId, jrd.itemId, i.itemCode, i.itemName, uom.name as uom, ji.dcNo, jid.Qty, jid.cumQty, jid.pendingQty as pendQty, jrd.jwrQty, jrd.jcNo, null as remarks
            FROM jobwork_reciept_details jrd
                INNER JOIN items i ON i.id = jrd.itemId
                LEFT JOIN mst_uom uom ON uom.id = i.uom
                INNER JOIN jobwork_issue_details jid ON jid.id = jrd.jwiId
                INNER JOIN jobwork_issue ji ON ji.id = jid.jobWorkId
            WHERE jrd.jwrId = ?`,
            [id]
        );

        return res.status(200).json({
            success: true,
            message: 'JobWork-Receipt details',
            jobWork: jwrRows[0],
            supplier: supplier[0] || null,
            itemsList: items
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.update = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { id, supplierId, invoiceNo, invoiceDate, dcNo, dcDate, totQty, itemsList = [] } = req.body;

        const [oldDetails] = await conn.execute(`
            SELECT jwiId, jwrQty 
            FROM jobwork_reciept_details
            WHERE jwrId = ?
        `, [id]);

        if (oldDetails.length > 0) {
            const reverseCum = oldDetails
                .map(obj => `WHEN ${obj.jwiId} THEN cumQty - ${Number(obj.jwrQty)}`)
                .join(' ');

            const reverseRec = oldDetails
                .map(obj => `WHEN ${obj.jwiId} THEN recievedQty - ${Number(obj.jwrQty)}`)
                .join(' ');

            const reverseIds = oldDetails.map(obj => obj.jwiId);

            await conn.query(`
                UPDATE jobwork_issue_details
                SET
                    cumQty      = CASE id ${reverseCum} ELSE cumQty END,
                    recievedQty = CASE id ${reverseRec} ELSE recievedQty END
                WHERE id IN (${reverseIds.join(',')})
            `);

            // recalc pending & isClosed after reversing
            await conn.query(`
                UPDATE jobwork_issue_details
                SET 
                    pendingQty = GREATEST(Qty - cumQty, 0),
                    isClosed   = CASE WHEN recievedQty >= Qty THEN 1 ELSE 0 END
                WHERE id IN (${reverseIds.join(',')})
            `);
        }

        await conn.execute(`
            UPDATE jobwork_reciept 
            SET supplierId = ?, invoiceNo = ?, invoiceDate = ?, 
                dcNo = ?, dcDate = ?, totQty = ?
            WHERE id = ?
        `, [supplierId, invoiceNo, invoiceDate, dcNo, dcDate, totQty, id]);

        await conn.execute(`DELETE FROM jobwork_reciept_details WHERE jwrId = ?`, [id]);

        if (itemsList.length > 0) {
            const insertDetailsQuery = `
                INSERT INTO jobwork_reciept_details 
                    (jwrId, jwiId, jcNo, itemId, jwiQty, cumQty, pendQty, jwrQty)
                VALUES ?
            `;

            const values = itemsList.map(v => [
                id, v.jwiId, v.jcNo, v.itemId, Number(v.jwiQty) || 0, Number(v.cumQty) || 0, Number(v.pendQty) || 0, Number(v.jwrQty) || 0
            ]);

            await conn.query(insertDetailsQuery, [values]);
        }

        if (itemsList.length > 0) {

            const ids = itemsList.map(obj => obj.id);

            const updateCumQty = itemsList
                .map(obj => `WHEN ${obj.id} THEN cumQty + ${Number(obj.jwrQty) || 0}`)
                .join(' ');

            const updateRecQty = itemsList
                .map(obj => `WHEN ${obj.id} THEN recievedQty + ${Number(obj.jwrQty) || 0}`)
                .join(' ');

            await conn.query(`
                UPDATE jobwork_issue_details
                SET 
                    cumQty      = CASE id ${updateCumQty} ELSE cumQty END,
                    recievedQty = CASE id ${updateRecQty} ELSE recievedQty END
                WHERE id IN (${ids.join(',')})
            `);

            await conn.query(`
                UPDATE jobwork_issue_details
                SET 
                    pendingQty = GREATEST(Qty - cumQty, 0),
                    isClosed   = CASE WHEN recievedQty >= Qty THEN 1 ELSE 0 END
                WHERE id IN (${ids.join(',')})
            `);

            const matchingItems = itemsList.filter(
                item => Number(item.jwiQty) === Number(item.jwrQty)
            );

            if (matchingItems.length > 0) {
                const itemIds = matchingItems.map(item => item.id);
                const placeholders = itemIds.map(() => '?').join(',');
                await updateSfgStatus(conn, itemIds, placeholders);
            }
        }

        await conn.commit();
        return handleSuccessResponse(res, "Jobwork receipt updated successfully.");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.delete = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { jwrId } = req.query;

        if (!jwrId) {
            throw new CustomError("Missing jwrId", 400);
        }

        const [oldDetails] = await conn.execute(`
            SELECT jwiId, jwrQty 
            FROM jobwork_reciept_details
            WHERE jwrId = ?
        `, [jwrId]);

        if (oldDetails.length > 0) {
            const reverseCum = oldDetails
                .map(obj => `WHEN ${obj.jwiId} THEN cumQty - ${Number(obj.jwrQty)}`)
                .join(' ');

            const reverseRec = oldDetails
                .map(obj => `WHEN ${obj.jwiId} THEN recievedQty - ${Number(obj.jwrQty)}`)
                .join(' ');

            const ids = oldDetails.map(obj => obj.jwiId);

            await conn.query(`
                UPDATE jobwork_issue_details
                SET
                    cumQty      = CASE id ${reverseCum} ELSE cumQty END,
                    recievedQty = CASE id ${reverseRec} ELSE recievedQty END
                WHERE id IN (${ids.join(',')})
            `);

            // recalc pending and isClosed
            await conn.query(`
                UPDATE jobwork_issue_details
                SET
                    pendingQty = GREATEST(Qty - cumQty, 0),
                    isClosed   = CASE WHEN recievedQty >= Qty THEN 1 ELSE 0 END
                WHERE id IN (${ids.join(',')})
            `);
        }

        await conn.execute(`DELETE FROM jobwork_reciept_details WHERE jwrId = ?`, [jwrId]);
        await conn.execute(`DELETE FROM jobwork_reciept WHERE id = ?`, [jwrId]);

        await conn.commit();
        return handleSuccessResponse(res, "Jobwork receipt deleted successfully.");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


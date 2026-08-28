const { connection, handleErrorResponse, CustomError, handleSuccessResponse } = require("../config/dbSql");
const { generateDocNo, updateDocCounter } = require("../utility/docNo");
const { getUser, currentDateTime } = require("../utility/utilityFunction");
const { toolUsageCountUpdate } = require("./toolComplaintController");

exports.sfgVerification = async (req, res) => {
    try {
        const fetchQuery = `SELECT mMrp.id, mMrp.orderNo, mMrp.poNo, mMrp.mrpNo, mMrp.status,
            DATE_FORMAT(mMrp.created_at, '%d-%m-%Y  %H:%i:%s') AS productionDate, mMrp.sfgAutoStatus, 
            DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
            FROM mrp_mst mMrp
            INNER JOIN order_plannings as op ON op.id = mMrp.orderPlnId
            WHERE 
                EXISTS (
                    SELECT 1 
                    FROM sfg s 
                    WHERE s.mrpMstId = mMrp.id AND s.sfgDisplay = 1
                )
        `;

        const [material] = await connection.execute(fetchQuery, []);

        return handleSuccessResponse(res, 'Material-Issue lists', material)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.sfgAllocatedParts = async (req, res) => {
    try {
        const { type, location = [] } = req.body;

        let materials = [];

        const placeholders = location.map(() => '?').join(', ');
        const locationFilter = location.length > 0 ? `AND items.mainLocation IN (${placeholders})` : '';

        //  sfg.sfgVerifiedQty, 
        const sfgQuery = `
            SELECT 
                DISTINCT sfg.id, jc.id as jcId, jc.jcNo, mm.id as mrpMstId, mm.mrpNo, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, mm.sfgNo, sfg.itemId, 
                sfg.itemCode, items.itemName, sfg.Qty, sfg.sfgVerifiedQty, pf.name AS productFinish, sfg.nextProcess, 
                sfg.machine as machineName, sfg.accQty AS producedQty, sfg.remarks, sfg.pendQty,
                CASE 
                    WHEN EXISTS (
                        SELECT 1 
                        FROM item_vs_pm ip 
                        INNER JOIN mst_pm pm ON pm.id = ip.process 
                        WHERE ip.item = sfg.itemId 
                        AND pm.vendorProcess = 1
                    ) THEN 'Job Work' 
                    ELSE 'Not Applicable'
                END AS vendorProcess,
                pmInsPec.addedBy AS qa
            FROM sfg
            INNER JOIN mrp_mst mm ON mm.id = sfg.mrpMstId
            LEFT JOIN order_plannings op ON op.id = mm.orderPlnId
            INNER JOIN job_card jc ON jc.id = sfg.jcId
            INNER JOIN items ON items.id = sfg.itemId
            LEFT JOIN item_product_finish pf ON pf.id = items.productFinish
            INNER JOIN (
                SELECT jcId, itemId, MIN(addedBy) AS addedBy
                FROM pm_inspeclist_mst
                GROUP BY jcId, itemId
            ) pmInsPec ON pmInsPec.jcId = sfg.jcId AND pmInsPec.itemId = sfg.itemId
            WHERE 
                sfg.sfgDisplay = ?
                AND items.category NOT IN ('BUY', 'BUY PRODUCTION', 'ASSEMBLY')
                AND sfg.accQty > ?
                ${locationFilter}
        `;

        const queryParams = [1, 0, ...location];
        [materials] = await connection.execute(sfgQuery, queryParams);

        // Filter based on vendor process type
        const filteredMaterials = materials.filter(item =>
            type === 'VP' ? (item.vendorProcess === 'Job Work' && item.remarks === 'Pending') : item.remarks === 'Completed'
        );

        // Add serialNo
        const finalMaterials = filteredMaterials.map((item, index) => ({
            sNo: index + 1,
            ...item
        }));

        return res.status(200).json({
            success: true,
            message: "Material-Issue lists",
            data: finalMaterials
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


const handleVPstock = async (conn, sfgId, jcId, itemId, itemCode, Qty, verifiedBy) => {
    await conn.execute(`INSERT INTO sfg_verification (sfgId, jcId, itemId, itemCode, Qty, verifiedBy) VALUES (?, ?, ?, ?, ?, ?)`,
        [sfgId, jcId, itemId, itemCode, Qty, verifiedBy]
    );
    return true;
}

const moveToFG = async (conn, sfgId, sfgNo = null, sfgVerifiedQty, addedBy) => {
    try {
        if (Number(sfgVerifiedQty) <= 0) {
            throw new CustomError('Please enter SFG verified Qty', 400);
        }

        // Fetch SFG details
        const [sfgRows] = await conn.execute(`
            SELECT sfg.mrpMstId, sfg.jcId, sfg.itemId, sfg.itemCode, sfg.remarks, jc.grn, jc.jcNo
            FROM sfg 
            INNER JOIN job_card jc ON jc.id = sfg.jcId
            WHERE sfg.id = ?`
            , [sfgId]);

        if (sfgRows.length === 0) {
            throw new CustomError('SFG not found!', 404);
        }
        const { mrpMstId, jcId, itemId, itemCode, grn, jcNo } = sfgRows[0];

        await conn.execute(`
            INSERT INTO fg_stock (mrpMstId, sfgId, grn, jcId, itemId, itemCode, Qty, issueQoh) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [mrpMstId, sfgId, sfgNo, jcId, itemId, itemCode, sfgVerifiedQty, sfgVerifiedQty]
        );

        // transaction log
        await conn.query(
            `INSERT INTO store (itemId, itemCode, docType, docNo,  grnNo, inwardQty, addedBy) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [itemId, itemCode, 'Production', sfgNo, sfgNo, sfgVerifiedQty, addedBy]
        );

        // Update tool counts
        await toolUsageCountUpdate(conn, jcNo, itemCode, sfgVerifiedQty)

        // await conn.execute(`
        //     UPDATE sfg SET remarks = ?, sfgDisplay = ? WHERE id = ?`,
        //     ['Completed', 0, sfgId]
        // );

        await conn.execute(`
            UPDATE sfg 
            SET 
                remarks = ?, 
                sfgVerifiedQty = sfgVerifiedQty + ?, 
                sfgDisplay = CASE 
                    WHEN (sfgVerifiedQty + ?) > Qty THEN 0 
                    ELSE sfgDisplay 
                END
            WHERE id = ?`,
            ['Completed', sfgVerifiedQty, sfgVerifiedQty, sfgId]
        );
        
        await conn.execute(
            `UPDATE items SET totStk = totStk + ? WHERE id = ?`,
            [sfgVerifiedQty, itemId]
        );

        await conn.execute(`
            UPDATE job_card
            SET 
                verifiedBy = ?,
                verifiedQty = verifiedQty + ?, 
                isCompleted = CASE WHEN verifiedQty + ? >= Qty THEN 1 ELSE 0 END,
                status = CASE WHEN verifiedQty + ? >= Qty THEN 'Completed' ELSE 'Pending' END,
                completedDate = CASE WHEN verifiedQty + ? >= Qty THEN NOW() ELSE completedDate END,
                supervisorCls = ?
            WHERE id = ?`,
            [addedBy, sfgVerifiedQty, sfgVerifiedQty, sfgVerifiedQty, sfgVerifiedQty, 1, jcId]
        );
    } catch (err) {
        throw err;
    }
};


const logSfgTransaction = async (conn, docNo, sfgNo, verifiedBy, verifiedDate, sfgItems) => {
    const [sfgMstRow] = await conn.execute(`
        INSERT INTO sfg_mst(docNo, sfgNo, verifiedBy, verifiedDate) VALUES (?, ?, ?, ?)
        `, [docNo, sfgNo, verifiedBy, verifiedDate]
    );

    if (!sfgMstRow.affectedRows) {
        throw new CustomError(`Failed to create SFG record`, 400);
    }
    const sfgMstId = sfgMstRow.insertId;

    const bulkData = sfgItems.map(item => [
        sfgMstId,
        item.mrpMstId,
        item.kanbanDate,
        item.sfgId,
        item.jcId,
        item.itemId,
        item.itemCode,
        item.prodQty
    ]);

    await conn.query(
        `INSERT INTO sfg_items (sfgMstId, mrpMstId, kanbanDate, sfgId, jcId, itemId, itemCode, sfgQty) VALUES ?`,
        [bulkData]
    );

    await updateDocCounter(conn, 'Sfg');

    return true;
}

exports.storeSfg = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { docNo, sfgNo, sfgLists } = req.body;
        const verifiedBy = await getUser(req);
        const verifiedDate = await currentDateTime();
        const sfgItems = [];

        if (!sfgLists.length) {
            throw new CustomError(`Please select Items`, 400);
        }

        for (const sfg of sfgLists) {
            const { mrpMstId, kanbanDate, jcId, id: sfgId, itemId, itemCode, sfgVerifiedQty: prodQty, remarks } = sfg;

            if (!prodQty || Number(prodQty) <= 0) {
                throw new CustomError(`Please enter Sfg verified Qty`, 400);
            }

            if (remarks !== 'Completed') {
                throw new CustomError(`Production not completed for SFG ID: ${sfgId}`, 400);
            }

            await moveToFG(conn, sfgId, sfgNo, prodQty, verifiedBy);
            sfgItems.push({ mrpMstId, kanbanDate, jcId, itemId, itemCode, sfgId, prodQty });
        }
        await logSfgTransaction(conn, docNo, sfgNo, verifiedBy, verifiedDate, sfgItems);
        
        await conn.commit();

        return handleSuccessResponse(res, 'Successfully updated');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

exports.createJobWork = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { sfgItems } = req.body;
        const verifiedBy = await getUser(req);

        if (!sfgItems.length) {
            throw new CustomError(`Please select Items`, 400);
        }

        for (const sfg of sfgItems) {
            const { id: sfgId, jcId, itemId, itemCode, Qty, sfgVerifiedQty, remarks } = sfg;

            if (!sfgId || !jcId || !itemId || !itemCode || !Qty || !remarks) {
                throw new CustomError(`Missing required fields`, 400);
            }

            if (!sfgVerifiedQty || Number(sfgVerifiedQty) <= 0) {
                throw new CustomError(`Please enter Sfg verified Qty`, 400);
            }

            // if (remarks !== 'Completed') {  //The condition was disabled by Puneeth, which is currently preventing the creation of job work. The system is showing the remarks as 'Pending'."
            //     throw new CustomError(`Production not completed for SFG ID: ${sfgId}`, 400);
            // }

            const jobWorkPendQty = Math.max(0, (Number(Qty) - Number(sfgVerifiedQty)));

            await conn.execute(
                `UPDATE sfg SET jwQty = jwQty + ?, jwPenQty = ?, sfgVerifiedQty = sfgVerifiedQty + ?, sfgDisplay = ? WHERE id = ?`,
                [sfgVerifiedQty, jobWorkPendQty, sfgVerifiedQty, 0, sfgId]
            );

            await handleVPstock(conn, sfgId, jcId, itemId, itemCode, sfgVerifiedQty, verifiedBy);
        }

        await conn.commit();

        return handleSuccessResponse(res, 'Job work created successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}


exports.fetchCompletedSfg = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body;

        const fetchQuery = `SELECT sfg.id, mMrp.orderNo, mMrp.mrpNo, mMrp.poNo, sfg.itemCode, sfg.Qty as plannedQty,
            sfg.jwQty as producedQty, items.totStk, sv.verifiedBy as sfgVerifiedBy, sfg.remarks,
            DATE_FORMAT(sfg.created_at, '%d-%m-%Y') AS producedDate,
            DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate,
            DATE_FORMAT(sv.created_at, '%d-%m-%Y') AS sfgVerifiedDate
            FROM sfg_verification sv
            LEFT JOIN sfg ON sfg.id = sv.sfgId
            LEFT JOIN mrp_mst mMrp ON mMrp.id = sfg.mrpMstId
            LEFT JOIN order_plannings op ON op.id = sfg.orderPlnId
            INNER JOIN items ON items.id = sfg.itemId
            WHERE date(sv.created_at) >= ? AND date(sv.created_at) <= ?`;

        const [rows] = await connection.execute(fetchQuery, [fromDate, toDate]);

        return res.status(200).json({
            success: true,
            message: 'Sfg list',
            data: rows
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


exports.vendorProcess = async (req, res) => {
    try {
        const { supplierId } = req.query;

        let fetchQuery = `SELECT sv.id, sv.id as sfgVerificationId, sv.sfgId, items.itemCode, items.itemName, uom.name as uom, items.totStk as qoh, hsn.name as hsn, sv.Qty as jwQty, supItem.suppDesc,
            supItem.jwdcRate as rate, loc.name as location, null as lot, (sv.Qty * supItem.jwdcRate) as amount, sv.remarks, jc.grn as grnNo, jc.jcNo,
            mMrp.orderNo, mMrp.mrpNo, mMrp.poNo, items.id as itemId, sfg.allocQty as plannedQty, sv.Qty as JWQty, sfg.jwPenQty as pendingJWQty,
            sfg.Qty as producedQty, items.totStk, sfg.sfgVerifiedBy, (items.netWeight * sv.Qty) as dispatchWeight,
            DATE_FORMAT(sv.created_at, '%d-%m-%Y') AS producedDate,
            DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate,
            DATE_FORMAT(sfg.sfgVerifiedDate, '%d-%m-%Y') AS sfgVerifiedDate,
            COALESCE(supplier.spCode, '') AS vendorCode, supplier.id as supplierId, sfg.nextProcess, sfg.machine
            FROM sfg_verification sv
            INNER JOIN sfg ON sfg.id = sv.sfgId
            INNER JOIN mrp_mst mMrp ON mMrp.id = sfg.mrpMstId
            INNER JOIN order_plannings op ON op.id = sfg.orderPlnId
            INNER JOIN items ON items.id = sfg.itemId
            LEFT JOIN mst_uom AS uom ON uom.id = items.uom
            LEFT JOIN item_hsn_code AS hsn ON hsn.id = items.hsnCode
            LEFT JOIN item_main_loc AS loc ON loc.id = items.mainLocation
            LEFT JOIN job_card jc ON jc.id = sv.jcId
            LEFT JOIN supp_vs_item as supItem ON supItem.itemName = sfg.itemId
            LEFT JOIN supplier ON supplier.id = supItem.spName
            WHERE sv.isCompleted = ?
        `;
        let values = [0];

        // Add supplierId filter if it exists
        if (supplierId) {
            fetchQuery += ` AND supplier.id = ?`;
            values.push(supplierId)
        } else {
            fetchQuery += ` GROUP BY sv.id`;
        }

        const [rows] = await connection.execute(fetchQuery, values);

        return res.status(200).json({
            success: true,
            message: 'Vendor-Process lists',
            data: rows
        });
    } catch (error) {
        return handleErrorResponse(res, error);
    }
};


exports.sfgAutoSatatus = async (req, res) => {
    try {
        const { mrpMstId } = req.body;

        await connection.execute(`UPDATE mrp_mst SET sfgAutoStatus = '1' WHERE mrp_mst.id = ?`, [mrpMstId]);

        return handleSuccessResponse(res, 'Update successful');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.sfgParts = async (req, res) => {
    try {
        const { mrpMstId, location } = req.body;

        // Fetch job cards associated with mrpMstId
        const [jcPart] = await connection.execute(`SELECT * FROM job_card WHERE mrpMstId = ?`, [mrpMstId]);

        let materials = [];

        if (jcPart.length > 0) {
            // Construct a single SQL query to fetch materials using JOINs
            const jcIds = jcPart.map(jc => jc.id).join(', ');
            const locationIds = location.map(loc => `'${loc}'`).join(', ');

            let jcQuery = `SELECT mrp.id, mrp_mst.mrpNo, jc.jcNo, items.itemCode, mrp.allocQty, mrp.Child_Produced_Qty as producedQty, (mrp.Qty - mrp.Child_Produced_Qty) AS pendingQty, mrp.jwPenQty,
                    mrp.remarks, pf.name AS productFinish, IFNULL(grn.grnNo, '') AS grnNo, 'Completed' as qualityCheck, mrp.sfgVerifiedQty, mrp.nextProcess, mrp.machine as machineName,
                    CASE 
                        WHEN pf.name IS NULL THEN 'Not Applicable'
                        WHEN pf.name LIKE '%PAINT%' THEN 'Not Applicable'
                        ELSE 'Job Work'
                    END AS vendorProcess
                    FROM mrp
                    INNER JOIN mrp_mst ON mrp_mst.id = mrp.mrpMstId
                    INNER JOIN items ON items.id = mrp.itemId
                    LEFT JOIN item_product_finish pf ON pf.id = items.productFinish
                    LEFT JOIN GRN AS grn ON grn.id = mrp.grnId
                    INNER JOIN job_card AS jc ON jc.id = mrp.jcId
                    WHERE mrp.jcId IN (${jcIds}) AND items.category != 'BUY'`;

            if (location.length > 0) {
                jcQuery += ` AND items.mainLocation IN (${locationIds})`;
            }

            const [jcItems] = await connection.execute(jcQuery);

            // Store fetched materials
            if (jcItems.length > 0) {
                materials = jcItems.map(items => ({ ...items, selected: false }));
            }
        }

        res.send(materials)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const updateVPdetails = async (req, conn, jcId, itemId, process, Qty) => {
    const [processRows] = await conn.execute(`SELECT code, vendorProcess FROM mst_pm WHERE id = ?`, [process]);

    if (processRows.length === 0) {
        throw new CustomError(`Process not found for Item: ${itemCode}`, 400);
    }
    const { code: processName, vendorProcess } = processRows[0];

    if (vendorProcess) {
        const user = await getUser(req);

        await conn.execute(`
            UPDATE jobcard_planning SET producedQty = ?, operator = ?, qa = ? WHERE jcId = ? AND itemId = ? AND process = ?`
            , [Qty, user, user, jcId, itemId, processName]);
    }

    return true;
}

exports.updateNextProcess = async (req, conn, jcId, itemId, machineId, process, Qty) => {
    try {
        if (!jcId || !itemId || !process || !Qty) {
            throw new CustomError('Missing required fields', 400);
        }
        const [sfgRows] = await conn.execute(`SELECT id as sfgId, mrpMstId, itemCode, Qty FROM sfg WHERE jcId = ? AND itemId = ?`, [jcId, itemId]);

        if (sfgRows.length === 0) {
            return true;
        }
        // Update Vendor Process details
        await updateVPdetails(req, conn, jcId, itemId, process, Qty);

        const [rows] = await conn.execute(`
            SELECT 
                ip.process, ip.processPriority, m.machineCode AS machine, pm.code AS processName, pm.vendorProcess
            FROM item_vs_pm ip
            JOIN item_vs_pm ipp ON ip.item = ipp.item AND ipp.process = ? AND ipp.machineName = ? AND ipp.dflag = ?
            JOIN machines m ON m.id = ip.machineName
            JOIN mst_pm pm ON pm.id = ip.process
            WHERE 
                ip.item = ?  
                AND ip.processPriority > ipp.processPriority 
                AND LOWER(pm.code) != ?
                AND ip.dflag = ?
            ORDER BY ip.processPriority
            LIMIT 1`,
            [process, machineId, 0, itemId, 'assembly', 0]
        );

        if (rows.length > 0) {
            const { machine, processName, vendorProcess } = rows[0];

            let updateQuery = `UPDATE sfg SET nextProcess = ?, machine = ?, sfgDisplay = ? WHERE jcId = ? AND itemId = ?`;
            const sfgDisplay = Number(vendorProcess) === 1 ? 1 : 0;

            await conn.execute(updateQuery, [processName, machine, sfgDisplay, jcId, itemId]);
        } else {
            // Move to SFG after completion of JobWork
            await conn.execute(`
                UPDATE sfg SET remarks = ?, sfgDisplay = ?, nextProcess = ?, machine = ? WHERE jcId = ? AND itemId = ?`,
                ['Completed', 1, null, null, jcId, itemId]
            );

            // Close Job Card
            // await conn.execute(`
            //     UPDATE job_card SET status = ?, isCompleted = ?, verifiedQty = ? WHERE id = ?`,
            //     ['Completed', 1, Qty, jcId]
            // );
        }

        return true;
    } catch (err) {
        throw err
    }
}

exports.nextProcess = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { jcId, itemId, process } = req.body;

        await this.updateNextProcess(conn, jcId, itemId, process);
        await conn.commit();

        return handleSuccessResponse(res, "Success")
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

exports.getSfgNo = async (req, res) => {
    try {
        const { q } = req.query;

        let fetchQuery = `SELECT id, sfgNo FROM sfg_mst`;
        let values = [];

        if (q) {
            fetchQuery += ` WHERE sfgNo LIKE ?`;
            values.push(`%${q}%`);
        }

        const [rows] = await connection.execute(fetchQuery, values);

        return handleSuccessResponse(res, 'SFG No list', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.viewSFG = async (req, res) => {
    try {
        const { type, id } = req.query;

        let sfgQuery = `
            SELECT sm.id, sm.docNo, sm.sfgNo, DATE_FORMAT(sm.verifiedDate, '%d-%m-%Y') AS sfgDate, sm.verifiedBy
            FROM sfg_mst sm
        `;
        let params = [];

        switch (type) {
            case 'first':
                sfgQuery += ` ORDER BY sm.id ASC LIMIT 1`;
                break;
            case 'last':
                sfgQuery += ` ORDER BY sm.id DESC LIMIT 1`;
                break;
            case 'forward':
                sfgQuery += ` WHERE sm.id > ? ORDER BY sm.id ASC LIMIT 1`;
                params = [id];
                break;
            case 'reverse':
                sfgQuery += ` WHERE sm.id < ? ORDER BY sm.id DESC LIMIT 1`;
                params = [id];
                break;
            case 'view':
                sfgQuery += ` WHERE sm.id = ?`;
                params = [id];
                break;
        }
        const [rows] = await connection.execute(sfgQuery, params);

        const [sfgItems] = await connection.execute(`
            SELECT s.id, ROW_NUMBER() OVER (ORDER BY s.id) AS sNo, jc.jcNo, m.mrpNo, s.kanbanDate, s.itemCode, i.itemName, sfg.Qty as Qty, s.sfgQty as sfgVerifiedQty, pf.name AS productFinish
            FROM sfg_items s
            INNER JOIN items i ON i.id = s.itemId
            LEFT JOIN job_card jc ON jc.id = s.jcId
            LEFT JOIN mrp_mst m ON m.id = s.mrpMstId
            LEFT JOIN sfg ON sfg.id = s.sfgId
            LEFT JOIN item_product_finish pf ON pf.id = i.productFinish
            WHERE s.sfgMstId = ?
        `, [rows[0]?.id || 0]);

        return res.status(200).json({
            success: true,
            sfgDetails: rows[0],
            sfgItems
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

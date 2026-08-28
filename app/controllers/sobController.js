const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { formatDate } = require('../utility/utilityFunction');
const { npdPlan } = require('./npdPlanController');


exports.store = async (req, res) => {
    try {
        const data = req.body;

        const values = [data.contractNo, data.fimNo, data.msd, data.sheetName];
        const [rows, fields] = await connection.execute('INSERT INTO sob (contractNo, fimNo, msd, sheetName) VALUES (?, ?, ?, ?)', values);

        if (rows.affectedRows > 0) {
            //console.log(fields)
            return res.status(200).json({ success: true, message: "Successfully added" });
        } else {
            return res.status(400).json({ success: false, message: "Execution failed!" });
        }

    } catch (err) {
        return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
}



exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;

        const values = [data.contractNo, data.fimNo, data.msd, data.sheetName, id];
        const [rows, fields] = await connection.execute(
            'UPDATE sob SET contractNo = ?, fimNo = ?, msd = ?, sheetName = ? WHERE id = ?',
            values
        );

        if (rows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully updated" });
        } else {
            return res.status(404).json({ success: false, message: "SOB not found!" });
        }

    } catch (err) {
        return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
};



exports.delete = async (req, res) => {
    try {
        const id = req.params.id;

        const [rows, fields] = await connection.execute('DELETE from sob WHERE id = ?', [id]);

        if (rows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully deleted" });
        } else {
            return res.status(404).json({ success: false, message: "SOB not found!" });
        }

    } catch (err) {
        return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
};



exports.show = async (req, res) => {
    try {
        const cslMstId = req.params.id;

        const [rows] = await connection.execute(`
            SELECT s.id, s.contractNo, s.partNo, s.fimNo, s.Qty, cm.product
            FROM sob s
            INNER JOIN csl_mst cm ON cm.id = s.cslMstId
            WHERE s.cslMstId = ?`,
            [cslMstId]
        );

        return handleSuccessResponse(res, 'SOB lists', rows);
    } catch (err) {
        return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
};


// exports.consolidateSob = async (req, res) => {
//     try {
//         const sobMstId = req.body.id;

//         const [sRows] = await connection.execute('SELECT id FROM sob_mst WHERE id = ?', [sobMstId]);

//         if (!sRows.length) throw new CustomError('Sob not found!', 404);

//         const [sobRows] = await connection.execute(`
//             SELECT s.id, s.contractNo, s.partNo, s.fimNo, s.Qty, cm.product
//             FROM sob s
//             INNER JOIN csl_mst cm ON cm.id = s.cslMstId
//             WHERE s.sobMstId = ?`, 
//             [sobMstId]
//         );

//         const [cslList] = await connection.execute(`
//             SELECT id FROM missing_csl 
//             WHERE sobMstId = ? and dflag = ?
//             LIMIT 1`, 
//             [sobMstId, '0']
//         );

//         return res.status(200).json({ 
//             success: true, 
//             message: "SOB lists", 
//             data: sobRows, 
//             missingCsl: cslList.length > 0 ? 1 : 0 
//         });
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };

exports.consolidateSob = async (req, res) => {
    try {
        const sobMstId = req.body.id;

        const [sRows] = await connection.execute(
            'SELECT id FROM sob_mst WHERE id = ?',
            [sobMstId]
        );

        if (!sRows.length) {
            throw new CustomError('Sob not found!', 404);
        }

        // Main SOB data
        const [sobRows] = await connection.execute(
            `
            SELECT s.id, s.contractNo, s.partNo, s.fimNo, s.Qty, cm.product
            FROM sob s
            INNER JOIN csl_mst cm ON cm.id = s.cslMstId
            WHERE s.sobMstId = ?
            `,
            [sobMstId]
        );

        // Check unmapped product (lightweight)
        const [[unmapped]] = await connection.execute(
            `
            SELECT 1 AS hasUnmappedProduct
            FROM sob s
            INNER JOIN csl_mst cm ON cm.id = s.cslMstId
            WHERE s.sobMstId = ?
              AND cm.product IS NULL
            LIMIT 1
            `,
            [sobMstId]
        );

        // Missing CSL
        const [cslList] = await connection.execute(
            `
            SELECT id
            FROM missing_csl
            WHERE sobMstId = ?
              AND dflag = ?
            LIMIT 1
            `,
            [sobMstId, '0']
        );

        return res.status(200).json({
            success: true,
            message: "SOB lists",
            data: sobRows,
            missingCsl: cslList.length > 0 ? 1 : 0,
            hasUnmappedProduct: unmapped ? true : false
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// exports.missingCsl = async (req, res) => {
//     try {
//         const { sobMstId, q } = req.query;

//         // Update dflag = 1 for items present in items table
//         await connection.execute(`
//             UPDATE missing_csl
//             SET dflag = '1'
//             WHERE EXISTS (
//                 SELECT 1
//                 FROM items
//                 WHERE items.itemCode = missing_csl.itemCode
//             )
//         `);

//         let fetchQuery;
//         let values = [];

//         fetchQuery = `
//             SELECT ms.id, cm.contractNo, ms.itemCode, ms.description, ms.Qty, ms.fim 
//             FROM missing_csl ms
//             INNER JOIN csl_mst cm ON cm.id = ms.cslMstId
//             WHERE sobMstId = ? AND dflag = ?`;
//         values.push(sobMstId, '0');

//         if (q) {
//             fetchQuery += `  AND (ms.fim IS NULL OR ms.fim LIKE ?)`;
//             values.push(`%${q}`);
//         }

//         const [rows] = await connection.execute(fetchQuery, values);

//         return res.status(200).json({ success: true, message: "Missing CSL lists", data: rows });

//     } catch (err) {
//         return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
//     }
// };

exports.missingCsl = async (req, res) => {
    const conn = await connection.getConnection(); // for transaction safety

    try {
        const { sobMstId, q } = req.query;

        if (!sobMstId) {
            return res.status(400).json({
                success: false,
                message: "sobMstId is required"
            });
        }

        // ✅ Step 1: Optimized UPDATE (only necessary rows)
        await conn.execute(`
            UPDATE missing_csl ms
            JOIN items i ON i.itemCode = ms.itemCode
            SET ms.dflag = '1'
            WHERE ms.dflag != '1'
        `);

        // ✅ Step 2: Optimized SELECT
        let query = `
            SELECT 
                ms.id,
                cm.contractNo,
                ms.itemCode,
                ms.description,
                ms.Qty,
                ms.fim
            FROM missing_csl ms
            JOIN csl_mst cm ON cm.id = ms.cslMstId
            WHERE ms.sobMstId = ?
              AND ms.dflag = '0'
        `;

        const values = [sobMstId];

        if (q) {
            query += `
                AND (
                    ms.fim IS NULL 
                    OR ms.fim LIKE CONCAT(?, '%')
                )
            `;
            values.push(q);
        }

        const [rows] = await conn.execute(query, values);

        return handleSuccessResponse(res, "Missing CSL lists", rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.deleteMissingCsl = async (req, res) => {
    try {
        const itemId = req.body.itemId;
        const itemsList = req.body.itemsList;
        const remarks = req.body.remark;

        if (!itemId && !itemsList) {
            throw new CustomError('Select Items to delete!', 400);
        } else if (itemId && (!itemsList || itemsList.length === 0)) {
            itemsList.push(itemId) // Assign a new array containing `itemId`
        }

        //console.log(itemsList);
        for (const item of itemsList) {
            const [fRows] = await connection.execute('SELECT * FROM missing_csl WHERE id = ?', [item]);

            if (fRows.length === 0) throw new CustomError('Item not found!', 404);
            const data = fRows[0];
            await connection.execute(`UPDATE missing_csl SET dflag = ?, remarks = ? WHERE id = ?`, ['1', remarks, item]);
            await connection.execute(`DELETE FROM sob WHERE sobMstId = ? and cslMstId = ? and partNo = ?`, [data.sobMstId, data.cslMstId, data.itemCode]);
        }

        return res.status(200).json({ success: true, message: "Successfully deleted" });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
};



exports.moveItems = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const data = req.body.data;

        if (data.length === 0) throw new CustomError('Please select items!', 500);

        const items = [];
        for (const item of data) {
            // const [rows] = await connection.execute(`SELECT * FROM missing_csl WHERE id = ?`, [item]);
            const [rows] = await conn.execute(`
                SELECT ms.*, cm.contractNo
                FROM missing_csl ms 
                INNER JOIN csl_mst cm ON cm.id = ms.cslMstId
                WHERE ms.id = ?
            `, [item]);

            if (rows.length === 0) throw new CustomError('Item Id not found!', 404);
            items.push(...rows);
        }

        const insertQuery = `INSERT INTO r_and_d (sobMstId, cslMstId, itemCode, description, Qty, fim) VALUES ?`;
        const values = items.map(item => [item.sobMstId, item.cslMstId, item.itemCode, item.description, item.Qty, item.fim ?? null]);

        await conn.query(insertQuery, [values]);

        const placeholders = data.map(() => '?').join(',');
        await conn.execute(`DELETE FROM missing_csl WHERE id IN (${placeholders})`, data);

        // //console.log(items)
        await npdPlan(conn, req, items);
        await conn.commit();

        return handleSuccessResponse(res, 'Successfully moved to R&D');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.deletedItems = async (req, res) => {
    try {
        const [dRows] = await connection.execute(`SELECT * FROM missing_csl WHERE dflag = '1' AND DATE(created_at) = CURDATE()`, []);

        if (dRows.length >= 0) {
            return res.status(200).json({ success: true, message: "Deleted Items", data: dRows });
        }
        throw new CustomError('Something went wrong!', 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
};


exports.resAndDev = async (req, res) => {
    try {
        const [rows] = await connection.execute(`SELECT * FROM r_and_d WHERE DATE(created_at) = CURDATE()`, []);

        if (rows.length >= 0) {
            return res.status(200).json({ success: true, message: "R & D Items list", data: rows });
        }
        throw new CustomError('Something went wrong!', 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
};


exports.resAndDevAll = async (req, res) => {
    try {
        const [rows] = await connection.execute(`SELECT * FROM r_and_d`, []);

        if (rows.length >= 0) {
            return res.status(200).json({ success: true, message: "R & D Items list", data: rows });
        }
        throw new CustomError('Something went wrong!', 400);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
};


exports.fetchSob = async (req, res) => {
    try {
        const { fromDate, toDate } = req.body;

        let query = `
            SELECT ROW_NUMBER() OVER (ORDER BY sm.created_at ASC) AS sId, sm.id, sm.sobNo, DATE_FORMAT(sm.created_at, '%d-%m-%Y') AS created_at, sm.processed, sm.mapStatus
            FROM sob_mst sm
            LEFT JOIN order_plannings op ON op.sobMstId = sm.id
        `;
        let queryParams = [];

        if (fromDate && toDate) {
            query += ` WHERE DATE(sm.created_at) BETWEEN ? AND ?`;
            queryParams.push(fromDate, toDate);
        } else {
            query += ` WHERE DATE(sm.created_at) = CURDATE()`;
        }

        const [rows] = await connection.execute(query, queryParams);

        return res.status(200).json({ success: true, message: "SOB lists", data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
};



exports.showFim = async (req, res) => {
    try {
        const { sobMstId } = req.query;
        const [rows] = await connection.execute(`SELECT DISTINCT fim FROM missing_csl WHERE sobMstId = ? AND dflag = '0' AND fim IS NOT null`, [sobMstId]);

        // rows.forEach((row, index) => {
        //     row.id = index + 1;
        // });

        const fimArray = [];
        const suffixArray = [];

        rows.forEach(row => {
            const index = row.fim.indexOf("FIM");
            if (index !== -1) {
                const suffix = row.fim.substring(index);
                if (!suffixArray.includes(suffix)) {
                    suffixArray.push(suffix);
                    fimArray.push({ id: row.id, fim: suffix });
                }
            }
        });

        return res.status(200).json({
            success: true,
            message: 'FIM lists',
            data: fimArray
        })

    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
}


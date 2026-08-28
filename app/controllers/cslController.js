const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { formatDate } = require('../utility/utilityFunction');


exports.store = async (req, res) => {
    try {
        const data = req.body;

        const values = [data.contractNo, data.partNo, data.Qty, data.boxNo];
        const [rows, fields] = await connection.execute('INSERT INTO csl (contractNo, partNo, Qty, boxNo, description) VALUES (?, ?, ?, ?. ?)', values);

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

        const values = [data.contractNo, data.partNo, data.Qty, data.boxNo, data.description, id];
        const [rows, fields] = await connection.execute(
            'UPDATE csl SET contractNo = ?, partNo = ?, Qty = ?, boxNo = ?, description = ? WHERE id = ?',
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

        const [rows, fields] = await connection.execute('DELETE from csl_mst WHERE id = ?', [id]);

        if (rows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully deleted" });
        } else {
            return res.status(404).json({ success: false, message: "CSL not found!" });
        }

    } catch (err) {
        return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
};



// exports.show = async (req, res) => {
//     try {
//         const { fromDate, toDate, cslMstId } = req.body;

//         let rows;
//         if(cslMstId) {
//             [rows] = await connection.execute(`SELECT csl_mst.*, DATE_FORMAT(date, '%d-%m-%Y') AS date FROM csl_mst WHERE id = ?`, [cslMstId]);

//         } else if (fromDate != "" && toDate != "") {
//             [rows] = await connection.execute(`SELECT csl_mst.*, DATE_FORMAT(date, '%d-%m-%Y') AS date FROM csl_mst WHERE DATE(date) >= ? and DATE(date) <= ?`,
//                 [fromDate, toDate]);

//         } else {
//             [rows] = await connection.execute(`SELECT csl_mst.*, DATE_FORMAT(date, '%d-%m-%Y') AS date FROM csl_mst WHERE DATE(date) = CURDATE() and sobStatus = 0`, []);
//         }

//         let index = 1;
//         if (rows.length >= 0) {
//             for (const element of rows) {
//                 let missingCsl = 0;
//                 let importSob = 0;

//                 const [cslList] = await connection.execute('SELECT id FROM missing_csl WHERE cslMstId = ? and dflag = ?', [element.id, '0']);
//                 const [sobList] = await connection.execute('SELECT id FROM `sob` WHERE cslMstId = ?', [element.id]);

//                 if (cslList.length > 0) {
//                     missingCsl = 1;
//                 }
//                 if (sobList.length > 0) {
//                     importSob = 1;
//                 }
//                 element.sNo = index++;
//                 // element.date = await formatDate(element.date);
//                 element.missingCsl = missingCsl;
//                 element.importSob = importSob;
//             };

//             return res.status(200).json({ success: true, message: "CSL lists", data: rows });
//         } else {
//             return res.status(404).json({ success: false, message: "CSL not found!" });
//         }

//     } catch (err) {
//         return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
//     }
// };

exports.show = async (req, res) => {
    try {
        const { fromDate, toDate, cslMstId } = req.body;
        let query = `SELECT id, DATE_FORMAT(date, '%d-%m-%Y') AS date, contractNo, status FROM csl_mst`;
        let queryParams = [];

        if (cslMstId) {
            query += ` WHERE id = ?`;
            queryParams.push(cslMstId);
        } else if (fromDate && toDate) {
            query += ` WHERE DATE(date) BETWEEN ? AND ?`;
            queryParams.push(fromDate, toDate);
        } else {
            query += ` WHERE DATE(date) = CURDATE() AND sobStatus = 0`;
        }

        const [rows] = await connection.execute(query, queryParams);
        if (!rows.length) {
            return handleSuccessResponse(res, "CSL lists", []);
        }

        // Extract cslIds and contractNos
        const cslIds = rows.map(row => row.id);
        const contracts = Array.from(new Set(rows.map(row => row.contractNo)));

        if (cslIds.length > 0) {
            const placeholders = cslIds.map(() => '?').join(',');

            // Fetch missing CSL & SOB status
            const [missingCslList, importSobList] = await Promise.all([
                connection.execute(`SELECT cslMstId FROM missing_csl WHERE cslMstId IN (${placeholders}) AND dflag = '0' GROUP BY cslMstId`, cslIds),
                connection.execute(`SELECT cslMstId FROM sob WHERE cslMstId IN (${placeholders}) GROUP BY cslMstId`, cslIds)
            ]);

            // Fetch SOB IDs linked to the contract numbers
            const [sobRows] = await connection.execute(`
                SELECT DISTINCT sob_mst.id AS sobMstId, temp.contract 
                FROM sob_mst
                JOIN (
                    ${contracts.map(() => `SELECT ? AS contract`).join(' UNION ALL ')}
                ) AS temp
                ON FIND_IN_SET(temp.contract, sob_mst.contractNos);
            `, contracts);

            if (!sobRows.length) {
                rows.forEach((csl, index) => {
                    csl.sNo = index + 1;
                    csl.missingCsl = 0;
                    csl.importSob = 0;
                    csl.kanbanDate = null;
                });
            } else {
                // Fetch Kanban Dates for related SOBs
                const sobMstIds = sobRows.map(row => row.sobMstId);
                const sobPlaceholders = sobMstIds.map(() => '?').join(',');

                const [opRows] = await connection.execute(`
                    SELECT sobMstId, DATE_FORMAT(kanbanDate, '%d-%m-%Y') AS kanbanDate FROM order_plannings WHERE sobMstId IN (${sobPlaceholders})
                `, sobMstIds);

                // Create lookup maps
                const missingCslSet = new Set(missingCslList[0].map(row => row.cslMstId));
                const importSobSet = new Set(importSobList[0].map(row => row.cslMstId));
                const sobMap = new Map(sobRows.map(row => [row.contract, row.sobMstId]));
                const orderPlnMap = new Map(opRows.map(row => [row.sobMstId, row.kanbanDate]));

                // Update CSL rows with new fields
                rows.forEach((csl, index) => {
                    csl.sNo = index + 1;
                    csl.missingCsl = missingCslSet.has(csl.id) ? 1 : 0;
                    csl.importSob = importSobSet.has(csl.id) ? 1 : 0;
                    csl.kanbandate = orderPlnMap.get(sobMap.get(csl.contractNo)) || null;
                });
            }
        }

        return handleSuccessResponse(res, "CSL lists", rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


exports.fetch = async (req, res) => {
    try {
        const cslId = req.params.id;

        const [rows] = await connection.execute(`
            SELECT id, contractNo, partNo, Qty, description, boxNo FROM csl WHERE cslMstId = ?`, 
            [cslId]
        );

        return handleSuccessResponse(res, "CSL lists", rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


// Missing Csl
exports.missingCsl = async (req, res) => {
    try {
        const cslMstId = req.params.id;
        const [rows, fields] = await connection.execute(`SELECT ms.*, csl_mst.contractNo
            from missing_csl ms 
            INNER JOIN csl_mst ON csl_mst.id = ms.cslMstId
            WHERE ms.cslMstId = ? and ms.dflag = ?`,
            [cslMstId, '0']);

        if (rows.length >= 0) {
            return res.status(200).json({ success: true, message: "CSL lists", data: rows });
        }
        throw new CustomError("Something went wrong!", 404);

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
};


exports.search = async (req, res) => {
    try {
        const { q } = req.query;

        let fetch = `SELECT id, contractNo as label FROM csl_mst `;

        const values = [];

        if (q) {
            fetch += ` WHERE contractNo LIKE ?`;
            values.push(`%${q}%`);
        }

        fetch += ` LIMIT 30`;

        const [rows] = await connection.execute(fetch, values);

        return handleSuccessResponse(res, 'Contracts', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}


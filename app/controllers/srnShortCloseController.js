const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require("../config/dbSql")

exports.srnLists = async (req, res) => {
    try {
        const { fromDate, toDate, type } = req.body;

        let query = `
            SELECT s.id, sm.requestedBy, sm.srnNo, DATE_FORMAT(sm.created_at, '%d-%m-%Y') AS srnDate, s.itemCode, i.itemName, uom.name as uom, s.Qty as srnQty, 0 as pbQty, 
            s.Qty as pendQty, s.shortClose, s.shortCloseBy as shortClosedBy, DATE_FORMAT(s.shortCloseDate, '%d-%m-%Y') AS shortClosedDate, s.shortCloseQty as Qty
            FROM srn s
            INNER JOIN srn_mst sm ON sm.id = s.srnMstId
            INNER JOIN items i ON i.id = s.itemId
            LEFT JOIN mst_uom uom ON uom.id = i.uom
            WHERE sm.authorized = ? AND DATE(sm.created_at) BETWEEN ? AND ?
        `;
        let values = [1, fromDate, toDate];

        if (type === '0') {
            query += ` AND s.shortClose = ?`;
            values.push(0);
        }
        const [rows] = await connection.execute(query, values)

        const result = rows.map(row => {
            return {
                ...row,
                selected: row.shortClose === 1 ? true : false
            };
        });

        return handleSuccessResponse(res, 'Srn items', result);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

// exports.shortClose = async (req, res) => {
//     try {
//         const { items, shortClosedBy, shortClosedDate } = req.body;

//         if (!Array.isArray(items) || items.length === 0) {
//             return handleErrorResponse(res, 'Please select items to short close', 400);
//         }

//         const placeholders = items.map(() => '?').join(', ');

//         await connection.execute(
//             `
//             UPDATE srn 
//             SET shortClose = ?, shortCloseBy = ?, shortCloseDate = ? 
//             WHERE id IN (${placeholders})
//             `,
//             [1, shortClosedBy, shortClosedDate, ...items]
//         );

//         return handleSuccessResponse(res, 'Srn items short closed successfully');
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };

exports.shortClose = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { items, revertItems, shortClosedBy, shortClosedDate } = req.body;

        if (!items.length && !revertItems.length) {
            throw new CustomError('Please select items to short close', 400);
        }

        // ShortClose Items
        if(items.length > 0) {
            const ids = [];
            const cases = items.map(({ id, Qty }) => {
                ids.push(id);
                return `WHEN ${id} THEN ${Qty}`;
            }).join(' ');

            const query = `
                UPDATE srn
                SET 
                    shortClose = 1,
                    shortCloseBy = ?,
                    shortCloseDate = ?,
                    shortCloseQty = CASE id ${cases} END
                WHERE id IN (${ids.map(() => '?').join(', ')})
            `;

            await conn.execute(query, [shortClosedBy, shortClosedDate, ...ids]);
        }

        // Revert ShortClosed Items
        if(revertItems && revertItems.length) {
            const revertIds = [];
            const revertCases = revertItems.map(id => {
                revertIds.push(id);
                return `WHEN ${id} THEN 0`;
            }).join(' ');

            const revertQuery = `
                UPDATE srn
                SET 
                    shortClose = 0,
                    shortCloseBy = NULL,
                    shortCloseDate = NULL,
                    shortCloseQty = CASE id ${revertCases} END
                WHERE id IN (${revertIds.map(() => '?').join(', ')})
            `;  
            await conn.execute(revertQuery, [...revertIds]);
        }

        await conn.commit();

        return handleSuccessResponse(res, 'Srn items short closed successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

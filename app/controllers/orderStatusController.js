const { handleErrorResponse, connection, handleSuccessResponse } = require("../config/dbSql");
const { fetchChildParts } = require("./hmiController");

exports.orderStatusReport = async (req, res) => {
    try {
        const [rows] = await connection.execute(`
            SELECT ROW_NUMBER() OVER(ORDER BY jc.id) as id, jc.status, o.poNo, o.orderNo, jc.jcNo, o.orderPriority, i.itemCode, c.cCode as customerName, jc.qty, jc.Produced_QTY as completedQty,
            DATE_FORMAT(o.kanbanDate, '%d-%m-%Y') AS delDate,
            CASE 
                WHEN jc.qty = 0 THEN 0 
                ELSE ROUND((jc.Produced_QTY / jc.qty) * 100, 2) 
            END as completion
            FROM job_card jc
            INNER JOIN items i ON jc.itemId = i.id
            INNER JOIN mrp_mst m ON jc.mrpMstId = m.id
            INNER JOIN order_plannings o ON m.orderPlnId = o.id
            INNER JOIN customer c ON m.customerId = c.id
            `, []
        );

        return handleSuccessResponse(res, 'OrderStatus report', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


exports.jcDetails = async (req, res) => {
    try {
        const { jcNo } = req.query;

        const [jcRows] = await connection.execute(`
            SELECT 
                i.id, jc.id as jcId, jc.status, o.poNo, o.orderNo, jc.jcNo, o.orderPriority, i.itemCode, i.itemName, c.cCode as customerName, jc.qty, 
                jc.Produced_QTY as completedQty,DATE_FORMAT(o.kanbanDate, '%d-%m-%Y') AS delDate,
                CASE 
                    WHEN jc.qty = 0 THEN 0 
                    ELSE ROUND((jc.Produced_QTY / jc.qty) * 100, 2) 
                END as completion
            FROM job_card jc
            INNER JOIN items i ON jc.itemId = i.id
            INNER JOIN mrp_mst m ON jc.mrpMstId = m.id
            INNER JOIN order_plannings o ON m.orderPlnId = o.id
            INNER JOIN customer c ON m.customerId = c.id
            WHERE jc.jcNo = ?
        `, [jcNo]);


        let processRows = [];

        if (jcRows.length > 0) {
            const { id: itemId, jcId } = jcRows[0];

            [processRows] = await connection.execute(`
                SELECT 
                    ip.id, jp.jcId, jp.itemId, pm.code AS process, jp.Qty, jp.producedQty, machines.machineName, jp.producedQty,
                    null as acceptedQty, null as rejectedQty, null as reworkQty, null as startDate, null as endDate, null as lastProdDate
                FROM 
                    item_vs_pm ip
                INNER JOIN mst_pm pm ON pm.id = ip.process
                INNER JOIN machines ON machines.id = ip.machineName
                LEFT JOIN jobcard_planning jp ON jp.itemId = ip.item AND jp.machineId = ip.machineName
                LEFT JOIN pm_inspeclist_mst pmInsPec ON pmInsPec.jcId = jp.jcId AND pmInsPec.itemId = jp.itemId AND pmInsPec.processId = ip.process
                WHERE ip.item = ? AND jp.jcNo = ? AND ip.dflag = ? AND pm.vendorProcess = ?
                GROUP BY jp.jcId, jp.itemId, ip.process
                ORDER BY ip.processPriority`,
                [itemId, jcNo, 0, 0]
            );
        }

        return res.status(200).json({
            success: true,
            message: 'JobCard details',
            jcDetails: jcRows,
            processDetails: processRows
        })
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

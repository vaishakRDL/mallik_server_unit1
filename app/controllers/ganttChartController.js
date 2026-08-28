const { connection, handleErrorResponse } = require("../config/dbSql")
const moment = require('moment');

exports.index = async (req, res) => {
    try {
        const { fromDate, toDate, machineId } = req.body;

        // Build dynamic SQL query based on machineId
        const machineCondition = machineId ? `jp.machineId = ? AND` : '';
        const queryParams = machineId ? [machineId, fromDate, toDate] : [fromDate, toDate];
        const hideChild = machineId ? false : true;

        // Fetch data with cycle time calculation
        const [rows] = await connection.execute(`
            SELECT 
                jp.id AS jobCardId,
                jp.jcId,
                jp.jcNo,
                jp.itemId,
                jp.machineName,
                jp.process,
                jp.machineId,
                jp.Qty,
                ROUND(SUM(ivp.cycleTime) * jp.Qty, 2) AS cycleTime 
            FROM 
                jobcard_planning jp 
            INNER JOIN 
                item_vs_pm ivp 
            ON 
                ivp.item = jp.itemId 
            WHERE 
                ${machineCondition} 
                jp.created_at >= ? 
                AND jp.created_at <= ?
            GROUP BY 
                jp.machineId, jp.itemId, jp.jcNo
        `, queryParams);

        // Group data by machines
        const machineGroups = {};
        rows.forEach(row => {
            if (!machineGroups[row.machineId]) {
                machineGroups[row.machineId] = {
                    parent: {
                        start: null,
                        end: null,
                        name: row.machineName,
                        machineName: row.machineName,
                        jcName: null,
                        id: `m${row.machineId}`,
                        progress: 100,
                        type: "project",
                        quantity: "",
                        cycleTime: "",
                        hideChildren: hideChild,
                    },
                    children: []
                };
            }

            // Calculate start and end times
            const startTime = moment(machineGroups[row.machineId].parent.end || moment()); // Start after the last job's end or current time
            const endTime = startTime.clone().add(row.cycleTime, 'minutes');

            // Add child task (job card)
            machineGroups[row.machineId].children.push({
                start: startTime.format('YYYY-MM-DD HH:mm:ss'),
                end: endTime.format('YYYY-MM-DD HH:mm:ss'),
                name: row.jcNo,
                machineName: row.machineName,
                jcName: row.jcNo,
                id: `jc${row.jobCardId}`,
                project: `m${row.machineId}`,
                progress: 100, // Set progress as per your logic
                type: "task",
                quantity: row.Qty,
                cycleTime: row.cycleTime,
            });

            // Update parent's end time
            machineGroups[row.machineId].parent.end = endTime.format('YYYY-MM-DD HH:mm:ss');
            if (!machineGroups[row.machineId].parent.start) {
                machineGroups[row.machineId].parent.start = startTime.format('YYYY-MM-DD HH:mm:ss');
            }
        });

        // Combine parent and child data for response
        const ganttData = [];
        Object.values(machineGroups).forEach(group => {
            ganttData.push(group.parent);
            ganttData.push(...group.children);
        });

        return res.status(200).json({ success: true, data: ganttData });
    } catch (err) {
        console.error(err);
        return res.status(err.statusCode || 500).json({ success: false, message: 'Internal server error!', error: err.message });
    }
};


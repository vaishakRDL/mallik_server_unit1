const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require("../config/dbSql");
const excel = require('exceljs');
const { getOderPriority } = require("./orderPlanningController");
const { getOrderNo, getUser, currentDateTimeInd } = require("../utility/utilityFunction");
const { updateDocCounter } = require("../utility/docNo");
const ExcelJS = require("exceljs");
const QuickChart = require("quickchart-js");
const path = require("path");
const { ErrorReply } = require("redis");

exports.machinePlanning = async (req, res) => {
    try {
        const mrpMstId = req.body.mrpMstId;

        await this.planning(mrpMstId);
        return res.status(200).json({ success: true, message: "Successfull" })
    } catch (err) {
        //console.log(err)
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
}

exports.store1 = async (req, res) => {
    try {
        const data = req.body;

        // Define query and values for checking if the record exists
        const checkQuery = `SELECT * FROM updated_assembly_new 
                            WHERE KanbanDate = ? AND ContractNo = ? AND FIMCode = ? AND PartNo = ? 
                              AND NoOfSt = ? AND Duty = ? AND FIMPfx = ? AND CTime = ?`;
        const checkValues = [data.KanbanDate, data.ContractNo, data.FIMCode, data.PartNo, data.Stop, data.Duty, data.Type, data.cycleTime];

        // Execute the check query
        const [checkRows] = await connection.execute(checkQuery, checkValues);

        if (checkRows.length > 0) {
            // If a record exists, update the `Qty`
            const updateQuery = `UPDATE updated_assembly_new 
                                 SET Qty = Qty + ? 
                                 WHERE KanbanDate = ? AND ContractNo = ? AND FIMCode = ? AND PartNo = ? 
                                   AND NoOfSt = ? AND Duty = ? AND FIMPfx = ? AND CTime = ?`;
            const updateValues = [data.Qty, ...checkValues];
            await connection.execute(updateQuery, updateValues);

            return res.status(200).json({ success: true, message: "Quantity updated successfully" });
        } else {
            // If no record exists, insert a new record
            const insertQuery = `INSERT INTO updated_assembly_new 
                                 (KanbanDate, ContractNo, FIMCode, PartNo, Qty, NoOfSt, Duty, FIMPfx, CTime) 
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const insertValues = [data.KanbanDate, data.ContractNo, data.FIMCode, data.PartNo, data.Qty, data.Stop, data.Duty, data.Type, data.cycleTime];
            await connection.execute(insertQuery, insertValues);

            return res.status(200).json({ success: true, message: "Successfully added" });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
};

exports.store = async (req, res) => {
    try {
        const data = req.body;

        // Define query and values for checking if the record exists
        const checkQuery = `SELECT * FROM updated_assembly_new 
                            WHERE KanbanDate = ? AND ContractNo = ? AND FIMCode = ? AND PartNo = ? 
                              AND NoOfSt = ? AND Duty = ? AND FIMPfx = ? AND CTime = ?`;
        const checkValues = [data.KanbanDate, data.ContractNo, data.FIMCode, data.PartNo, data.Stop, data.Duty, data.Type, data.cycleTime];

        // Execute the check query
        const [checkRows] = await connection.execute(checkQuery, checkValues);

        if (checkRows.length > 0) {
            // If a record exists, update the `Qty` with the new value
            const updateQuery = `UPDATE updated_assembly_new 
                                 SET Qty = ? 
                                 WHERE KanbanDate = ? AND ContractNo = ? AND FIMCode = ? AND PartNo = ? 
                                   AND NoOfSt = ? AND Duty = ? AND FIMPfx = ? AND CTime = ?`;
            const updateValues = [data.Qty, ...checkValues];
            await connection.execute(updateQuery, updateValues);

            return res.status(200).json({ success: true, message: "Quantity updated successfully" });
        } else {
            // If no record exists, insert a new record
            const insertQuery = `INSERT INTO updated_assembly_new 
                                 (KanbanDate, ContractNo, FIMCode, PartNo, Qty, NoOfSt, Duty, FIMPfx, CTime) 
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const insertValues = [data.KanbanDate, data.ContractNo, data.FIMCode, data.PartNo, data.Qty, data.Stop, data.Duty, data.Type, data.cycleTime];
            await connection.execute(insertQuery, insertValues);

            return res.status(200).json({ success: true, message: "Successfully added" });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
};


exports.planning = async function (mrpMstId) {
    try {
        //console.log("Planning started...");

        const [jcRows] = await connection.execute(`SELECT id as jcId, null as id, jcNo, itemId, Qty FROM job_card WHERE mrpMstId = ?`, [mrpMstId]);

        for (const jc of jcRows) {
            // const [mrpRows] = await connection.execute(`SELECT id, jcId, itemId, Qty FROM mrp where jcId = ?`, [jc.jcId]);

            // if (mrpRows.length > 0) {
            //     await updateAllocTime(mrpRows, mrpMstId);
            // } else {
            await updateAllocTime([jc], mrpMstId);
            // }
        }

        //console.log("Planning completed!");
        return true;
    } catch (error) {
        throw error;
    }
}

async function updateAllocTime(mrpData, mrpMstId) {
    try {
        const machineArray = [];

        for (const mrp of mrpData) {
            const { id: mrpId, jcId, itemId, Qty } = mrp;
            // //console.log(mrp)
            const [rows] = await connection.execute(`
                SELECT machineName AS machineId, items.cycleTime, items.cycleTime * ? AS totCycleTime
                FROM item_vs_pm AS items  
                INNER JOIN mst_pm pm ON pm.id = items.process
                WHERE items.item = ? AND pm.vendorProcess = ? AND items.dflag = ?
            `, [Qty, itemId, 0, 0]);

            for (const machine of rows) {
                const totalCycleTime = machine.totCycleTime;
                const [machineRow] = await connection.execute(`SELECT id, lastAllocTime FROM machines WHERE id = ?`, [machine.machineId]);

                if (machineRow.length > 0) {
                    const lastAllocTime = new Date(machineRow[0].lastAllocTime);
                    let curTime = new Date();
                    let scheduleTime = new Date(); // Initialize scheduleTime with the current date time

                    if (lastAllocTime <= scheduleTime) {
                        // Add totalCycleTime minutes to scheduleTime
                        scheduleTime.setMinutes(scheduleTime.getMinutes() + totalCycleTime);
                        // Check if scheduleTime falls on a Sunday (day number 0 in JavaScript's Date object)
                        if (scheduleTime.getDay() === 0) { // 0 is Sunday
                            // Increment scheduleTime by an additional 24 hours to skip to Monday
                            scheduleTime.setDate(scheduleTime.getDate() + 1);
                        }
                    } else {
                        // Set scheduleTime to lastAllocTime and add totalCycleTime minutes
                        scheduleTime = new Date(lastAllocTime.getTime() + totalCycleTime * 60000);
                        curTime = new Date(lastAllocTime);
                        // Check if scheduleTime falls on a Sunday (day number 0 in JavaScript's Date object)
                        if (scheduleTime.getDay() === 0) { // 0 is Sunday
                            // Increment scheduleTime by an additional 24 hours to skip to Monday
                            scheduleTime.setDate(scheduleTime.getDate() + 1);
                        }
                    }

                    await connection.execute(`UPDATE machines SET lastAllocTime = ? WHERE id = ?`, [scheduleTime, machine.machineId]);

                    const machineObj = { mrpMstId, mrpId, jcId, itemId, machineId: machine.machineId, Qty, cycleTime: machine.cycleTime, totCycleTime: totalCycleTime, curTime, scheduledDate: scheduleTime };
                    machineArray.push(machineObj);
                }
            }
        }

        if (machineArray.length > 0) {
            const insertQuery = `INSERT INTO machine_schedule (mrpMstId, mrpId, jcId, itemId, machineId, Qty, cycleTime, totCycleTime, startTime, scheduledDate) VALUES ${machineArray.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(',')}`;
            const values = machineArray.flatMap(item => [item.mrpMstId, item.mrpId, item.jcId, item.itemId, item.machineId, item.Qty, item.cycleTime, item.totCycleTime, item.curTime, item.scheduledDate]);

            await connection.execute(insertQuery, values);
        }

    } catch (error) {
        throw error;
    }
}

async function insertMachinePlanning(mrpMstId, data) {
    for (const item of data) {
        const { jcId, Qty, itemId, cycleTimes } = item;
        for (const machineId in cycleTimes) {
            const cycleTime = cycleTimes[machineId];
            // Insert into machine_planning table
            await connection.execute(`
                INSERT INTO machine_planning (jcId, machineId, Qty, cycleTime)
                VALUES (?, ?, ?, ?)
            `, [jcId, machineId, Qty, cycleTime]);
        }
    }
}

exports.show = async (req, res) => {
    try {
        const { fromDate, toDate, machineId } = req.body;

        let fetchQuery = `
            SELECT 
                ROW_NUMBER() OVER (ORDER BY jp.created_at) AS id, items.materialThickness AS thickness, mm.mrpNo, items.itemCode, items.itemName, 
                jp.jcNo,  op.orderNo as kanbanDate, items.category, ROUND(SUM(ivp.cycleTime), 2) AS cycleTime, uom.name AS uom, jp.Qty,  ROUND(jp.Qty * SUM(ivp.cycleTime), 2) AS workPlanned 
            FROM jobcard_planning jp
            INNER JOIN items ON items.id = jp.itemId
            LEFT JOIN mst_uom AS uom ON uom.id = items.uom
            INNER JOIN mrp_mst mm ON mm.id = jp.mrpMstId
            INNER JOIN order_plannings op ON op.id = mm.orderPlnId
            INNER JOIN item_vs_pm ivp ON ivp.item = items.id
            WHERE ivp.dflag = ?
        `;
        const params = [0];

        if (fromDate && toDate) {
            fetchQuery += ` AND jp.created_at >= ? AND jp.created_at <= ?`;
            params.push(fromDate, toDate);
        }
        if (machineId) {
            fetchQuery += ` AND jp.machineId = ?`;
            params.push(machineId);
        }
        fetchQuery += ` 
            GROUP BY mm.mrpNo, jp.jcNo
            ORDER BY op.orderPriority, items.materialThickness
        `;

        const [rows] = await connection.execute(fetchQuery, params);

        return handleSuccessResponse(res, 'Planning lists', rows)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.showFim = async (req, res) => {
    try {
        const [rows] = await connection.execute(
            `SELECT id, name FROM item_fim_id WHERE dflag = '0'`
        );

        // Extract FIM suffixes
        const suffixSet = new Set();
        const fimArray = [];

        rows.forEach(row => {
            const index = row.name.indexOf("FIM");
            if (index !== -1) {
                const suffix = row.name.substring(index);
                if (!suffixSet.has(suffix)) {
                    suffixSet.add(suffix);
                    fimArray.push({ id: row.id, name: suffix });
                }
            }
        });

        // Fetch distinct names from item_product_family excluding FIM suffixes
        const fimList = Array.from(suffixSet);
        const placeHolders = fimList.map(() => "?").join(',');

        const [pfRows] = await connection.execute(
            `SELECT DISTINCT name FROM item_product_family WHERE name NOT IN (${placeHolders})`,
            fimList
        );

        // Transform pfRows and append to fimArray
        const lastItemId = Number(fimArray[fimArray.length - 1].id) + 1;
        pfRows.forEach((row, index) => {
            fimArray.push({ id: lastItemId + index, name: row.name });
        });

        return handleSuccessResponse(res, 'FIM lists', fimArray);
    } catch (err) {
        console.error(err);
        return handleErrorResponse(res, err)
    }
};

async function contractDetails(contractNos, fim) {
    if (!contractNos?.length) return {};

    // --- Step 1: Prepare all labels (contractNo-fim)
    const labels = contractNos.map(contract => `${contract}-${fim}`);

    // --- Step 2: Bulk fetch from csl_mst
    const contractPlaceholders = contractNos.map(() => '?').join(', ');
    const [cslRows] = await connection.execute(
        `SELECT contractNo, duty, stop, type 
         FROM csl_mst 
         WHERE contractNo IN (${contractPlaceholders})`,
        contractNos
    );

    // --- Step 3: Bulk fetch purchase order info
    const partPlaceholders = labels.map(() => '?').join(', ');
    const [poRows] = await connection.execute(
        `SELECT poItem.PartNo, po.poNo 
         FROM purchas_Order_item poItem
         LEFT JOIN purchase_order po ON po.id = poItem.purchase_order_id
         WHERE poItem.PartNo IN (${partPlaceholders})`,
        labels
    );

    // --- Step 4: Build lookup map for poNos
    const poMap = Object.create(null);
    for (const { PartNo, poNo } of poRows) {
        poMap[PartNo] = poNo;
    }

    // --- Step 5: Construct finalResult
    const finalResult = Object.create(null);
    for (const { contractNo, duty, stop, type } of cslRows) {
        const label = `${contractNo}-${fim}`;
        finalResult[contractNo] = {
            poNo: poMap[label] || null,
            duty,
            stop,
            type
        };
    }

    return finalResult;
}

// exports.assemblyPlanning = async function (kanbanDate, fim) {
//     try {
//         const fetchQuery = `
//             SELECT 
//                 sob.id,
//                 sob.contractNo,
//                 sob.partNo AS itemCode,
//                 MIN(sob.Qty) AS Qty,
//                 COALESCE(SUM(DISTINCT iVp.cycleTime), 0) AS cycleTime,
//                 GROUP_CONCAT(DISTINCT jc.grn ORDER BY jc.grn SEPARATOR ', ') AS grn
//             FROM sob
//             INNER JOIN items ON items.itemCode = sob.partNo
//             INNER JOIN order_plannings op ON op.sobMstId = sob.sobMstId
//             LEFT JOIN orderlist ol ON ol.sobId = sob.id
//             LEFT JOIN item_vs_pm iVp ON iVp.item = items.id
//             LEFT JOIN job_card jc ON jc.orderListId = ol.id
//             WHERE 
//                 op.kanbanDate = ?
//                 AND sob.fimNo LIKE ?
//             GROUP BY 
//                 sob.id, sob.contractNo, sob.partNo;
//         `;

//         const [rows] = await connection.execute(fetchQuery, [kanbanDate, `%${fim}`]);
//         if (!rows.length) return { finalResult: [], contractList: {} };

//         const contractNos = [...new Set(rows.map(r => r.contractNo))];
//         const contractList = await contractDetails(contractNos, fim);

//         const itemMap = new Map();
//         for (const row of rows) {
//             const { contractNo, itemCode, Qty, cycleTime: processedCycleTime, grn } = row;
//             const qty = parseInt(Qty) || 0;
//             const cycleTime = parseInt(processedCycleTime) || 0;

//             if (!itemMap.has(itemCode)) {
//                 const base = { id: itemMap.size + 1, itemCode, grn: grn || '', totQty: 0, cycleTime: 0, totalCycleTime: 0 };
//                 for (const c of contractNos) base[c] = 0;
//                 itemMap.set(itemCode, base);
//             }

//             const item = itemMap.get(itemCode);
//             item[contractNo] += qty;
//             item.totQty += qty;
//             item.cycleTime = cycleTime;
//             item.totalCycleTime = cycleTime * item.totQty;
//         }

//         const finalResult = Array.from(itemMap.values()).map(item => ({
//             id: item.id,
//             itemCode: item.itemCode,
//             grn: item.grn,
//             ...contractNos.reduce((acc, c) => ((acc[c] = item[c]), acc), {}),
//             totQty: item.totQty,
//             cycleTime: item.cycleTime,
//             totalCycleTime: item.totalCycleTime
//         }));

//         return { finalResult, contractList };
//     } catch (error) {
//         throw error;
//     }
// };

exports.assemblyPlanning = async function (kanbanDate, fim) {
    try {
        const fetchQuery = `
            SELECT 
                sob.id,
                sob.contractNo,
                sob.partNo AS itemCode,
                MIN(sob.Qty) AS Qty,
                COALESCE(SUM(DISTINCT iVp.cycleTime), 0) AS cycleTime,
                GROUP_CONCAT(
                    DISTINCT COALESCE(srn.issueNo, srn.grn)
                    ORDER BY srn.id
                ) AS grn
            FROM sob
            INNER JOIN items ON items.itemCode = sob.partNo
            INNER JOIN order_plannings op ON op.sobMstId = sob.sobMstId
            LEFT JOIN srn ON srn.sobId = sob.id
            LEFT JOIN item_vs_pm iVp ON iVp.item = items.id
            WHERE 
                op.kanbanDate = ?
                AND sob.fimNo LIKE ?
            GROUP BY 
                sob.id, sob.contractNo, sob.partNo;
        `;

        const [rows] = await connection.execute(fetchQuery, [kanbanDate, `%${fim}`]);
        if (!rows.length) return { finalResult: [], contractList: {} };

        const contractNos = [...new Set(rows.map(r => r.contractNo))];
        const contractList = await contractDetails(contractNos, fim);

        const itemMap = new Map();
        for (const row of rows) {
            const { contractNo, itemCode, Qty, cycleTime: processedCycleTime, grn } = row;
            const qty = parseInt(Qty) || 0;
            const cycleTime = parseInt(processedCycleTime) || 0;

            if (!itemMap.has(itemCode)) {
                const base = { id: itemMap.size + 1, itemCode, grn: grn || '', totQty: 0, cycleTime: 0, totalCycleTime: 0 };
                for (const c of contractNos) base[c] = 0;
                itemMap.set(itemCode, base);
            }

            const item = itemMap.get(itemCode);
            item[contractNo] += qty;
            item.totQty += qty;
            item.cycleTime = cycleTime;
            item.totalCycleTime = cycleTime * item.totQty;
        }

        const finalResult = Array.from(itemMap.values()).map(item => ({
            id: item.id,
            itemCode: item.itemCode,
            grn: item.grn,
            ...contractNos.reduce((acc, c) => ((acc[c] = item[c]), acc), {}),
            totQty: item.totQty,
            cycleTime: item.cycleTime,
            totalCycleTime: item.totalCycleTime
        }));

        return { finalResult, contractList };
    } catch (error) {
        throw error;
    }
};

exports.assemblyShow = async (req, res) => {
    try {
        const { kanbanDate, fim } = req.body;
        if (!kanbanDate) return res.status(400).json({ success: false, message: "Missing kanbanDate" });

        const { finalResult, contractList } = await this.assemblyPlanning(kanbanDate, fim);
        if (!finalResult.length || !Object.keys(contractList).length) {
            return res.status(200).json({ success: true, message: 'No data found', data: [] });
        }

        const contractNos = Object.keys(contractList);
        const partNos = finalResult.map(r => r.itemCode);
        const totalContractCount = contractNos.length;
        const updatedMap = Object.create(null);

        // ✅ optimized selective query
        if (contractNos.length && partNos.length) {
            const contractPH = contractNos.map(() => '?').join(', ');
            const partPH = partNos.map(() => '?').join(', ');
            const query = `
                SELECT PartNo, ContractNo, Qty
                FROM updated_assembly_new
                WHERE Qty != 0
                  AND ContractNo IN (${contractPH})
                  AND PartNo IN (${partPH})
            `;
            const [updatedData] = await connection.query(query, [...contractNos, ...partNos]);
            for (const { PartNo, ContractNo, Qty } of updatedData) {
                if (!updatedMap[PartNo]) updatedMap[PartNo] = {};
                updatedMap[PartNo][ContractNo] = Qty;
            }
        }

        const contractKeys = Object.keys(contractList);
        const firstRowKeys = Object.keys(finalResult[0]);
        const items = ['duty', 'stop', 'type', 'poNo'];

        // ✅ Pre-allocate resArray
        const resArray = new Array(items.length);
        for (let i = 0; i < items.length; i++) {
            const name = items[i];
            const obj = {
                id: `${i}_0`,
                sNo: '',
                itemCode: name[0].toUpperCase() + name.slice(1, 4),
                grn: '',
            };

            for (const key of firstRowKeys) {
                if (!['id', 'itemCode', 'grn', 'totQty', 'cycleTime', 'totalCycleTime'].includes(key)) {
                    obj[key] = contractList[key]?.[name] || "";
                }
            }

            if (updatedMap[obj.itemCode]) obj.updated = { ...updatedMap[obj.itemCode] };
            obj.totQty = obj.cycleTime = obj.totalCycleTime = "";
            resArray[i] = obj;
        }

        // ✅ Adjust finalResult in place
        for (const row of finalResult) {
            row.sNo = row.id;
            for (const k of contractKeys) if (row[k] === 0) row[k] = "";
            if (updatedMap[row.itemCode]) row.updated = { ...updatedMap[row.itemCode] };
        }

        return res.status(200).json({
            success: true,
            message: 'Assembly Planning lists',
            totalContractCount,
            data: [...resArray, ...finalResult],
        });
    } catch (error) {
        console.error("assemblyShow error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: 'Internal server error!',
            error: error.message
        });
    }
};

exports.assemblyfilter = async (req, res) => {
    try {
        const { kanbanDate, fim, PartNo, ContractNo } = req.body;

        if (!kanbanDate) {
            return res.status(400).json({ success: false, message: "Missing kanbanDate" });
        }

        // Step 1: Get base planning data
        const { finalResult, contractList } = await this.assemblyPlanning(kanbanDate, fim);

        if (!finalResult?.length || !Object.keys(contractList).length) {
            return res.status(200).json({
                success: true,
                message: "No data found",
                data: [],
                totalContractCount: 0
            });
        }

        // Step 2: Build needed contract & part sets
        const contractNos = Object.keys(contractList);
        const partNos = finalResult.map(r => r.itemCode);

        // Step 3: Fetch only relevant updated assembly rows
        const updatedMap = Object.create(null);
        let filterConditions = [];
        const queryParams = [];

        if (ContractNo) {
            filterConditions.push("ContractNo = ?");
            queryParams.push(ContractNo);
        } else if (contractNos.length) {
            filterConditions.push(`ContractNo IN (${contractNos.map(() => "?").join(",")})`);
            queryParams.push(...contractNos);
        }

        if (PartNo) {
            filterConditions.push("PartNo = ?");
            queryParams.push(PartNo);
        } else if (partNos.length) {
            filterConditions.push(`PartNo IN (${partNos.map(() => "?").join(",")})`);
            queryParams.push(...partNos);
        }

        const whereClause = filterConditions.length ? `WHERE Qty != 0 AND ${filterConditions.join(" AND ")}` : "WHERE Qty != 0";

        const [updatedData] = await connection.query(
            `SELECT PartNo, ContractNo, Qty FROM updated_assembly_new ${whereClause}`,
            queryParams
        );

        for (const { PartNo, ContractNo, Qty } of updatedData) {
            if (!updatedMap[PartNo]) updatedMap[PartNo] = {};
            updatedMap[PartNo][ContractNo] = Qty;
        }

        // Step 4: Compute totalContractCount smartly
        let totalContractCount = 0;
        if (PartNo && ContractNo) {
            totalContractCount = contractNos.includes(ContractNo) ? 1 : 0;
        } else if (PartNo) {
            totalContractCount = contractNos.filter(contract =>
                finalResult.some(row => row.itemCode === PartNo && row.hasOwnProperty(contract))
            ).length;
        } else if (ContractNo) {
            totalContractCount = contractNos.includes(ContractNo) ? 1 : 0;
        } else {
            totalContractCount = contractNos.length;
        }

        // Step 5: Filter main result set (optimized logic)
        const filteredFinalResult = [];
        for (const row of finalResult) {
            const { itemCode } = row;

            if (PartNo && itemCode !== PartNo) continue;
            if (ContractNo && !row.hasOwnProperty(ContractNo)) continue;

            const copy = { ...row, sNo: row.id };

            if (ContractNo && PartNo) {
                const qty = copy[ContractNo] || "";
                filteredFinalResult.push({
                    id: copy.id,
                    itemCode: PartNo,
                    [ContractNo]: qty,
                    totQty: qty,
                    cycleTime: copy.cycleTime || "",
                    totalCycleTime: qty ? qty * copy.cycleTime : "",
                    sNo: 1,
                    updated: updatedMap[PartNo] ? { [ContractNo]: updatedMap[PartNo][ContractNo] } : undefined
                });
                continue;
            }

            if (PartNo) {
                for (const key of contractNos) {
                    if (copy[key] === 0) copy[key] = "";
                }
                filteredFinalResult.push({
                    ...copy,
                    totQty: copy.totQty || "",
                    cycleTime: copy.cycleTime || "",
                    totalCycleTime: copy.totalCycleTime || "",
                    sNo: 1,
                    updated: updatedMap[itemCode] ? { ...updatedMap[itemCode] } : undefined
                });
                continue;
            }

            if (ContractNo) {
                const qty = copy[ContractNo] || "";
                filteredFinalResult.push({
                    id: copy.id,
                    itemCode: copy.itemCode,
                    [ContractNo]: qty,
                    totQty: qty,
                    cycleTime: copy.cycleTime || "",
                    totalCycleTime: qty ? qty * copy.cycleTime : "",
                    sNo: copy.id,
                    updated: updatedMap[itemCode] ? { [ContractNo]: updatedMap[itemCode][ContractNo] } : undefined
                });
                continue;
            }

            // default: no filters
            filteredFinalResult.push(copy);
        }

        // Step 6: Prepare static info rows (duty, stop, type)
        const resArray = [];
        const infoItems = ["duty", "stop", "type"];
        const keys = Object.keys(finalResult[0] || {});

        for (let i = 0; i < infoItems.length; i++) {
            const item = infoItems[i];
            const obj = { id: `${i}_0`, sNo: "", itemCode: item[0].toUpperCase() + item.slice(1), grn: "" };

            for (const key of keys) {
                if (!["id", "itemCode", "grn", "totQty", "cycleTime", "totalCycleTime"].includes(key)) {
                    if (ContractNo && key === ContractNo) {
                        obj[key] = contractList[key]?.[item] || "";
                        break;
                    } else if (!ContractNo) {
                        obj[key] = contractList[key]?.[item] || "";
                    }
                }
            }

            const partNo = obj.itemCode;
            if (updatedMap[partNo]) obj.updated = { ...updatedMap[partNo] };

            resArray.push({ ...obj, totQty: "", cycleTime: "", totalCycleTime: "" });
        }

        // Step 7: Send optimized response
        return res.status(200).json({
            success: true,
            message: "Assembly Planning lists",
            totalContractCount,
            data: [...resArray, ...filteredFinalResult],
        });

    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: "Internal server error!",
            error: error.message,
        });
    }
};

exports.getDropdownOptions = async (req, res) => {
    try {
        const { kanbanDate, fim } = req.body;

        if (!kanbanDate) {
            return res.status(400).json({ success: false, message: "Missing kanbanDate" });
        }

        // Fetch assembly planning data
        const { finalResult, contractList } = await this.assemblyPlanning(kanbanDate, fim);

        if (!finalResult || finalResult.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No data found',
                partNos: [],
                contractNos: []
            });
        }

        // Extract unique part numbers (item codes)
        const partNos = [...new Set(finalResult.map(row => row.itemCode))];

        // Extract unique contract numbers from the contractList keys
        const contractNosArray = Object.keys(contractList);

        // Return the response
        return res.status(200).json({
            success: true,
            partNos,
            contractNos: contractNosArray,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: 'Internal server error!',
            error: error.message
        });
    }
};

exports.jobCardPlanning = async (conn, mrpMstId) => {
    try {
        const [jcRows] = await conn.execute(`
            SELECT jc.id, jc.jcNo, jc.Qty, jc.itemId, ip.machineName as machineId, pm.id as processId, machines.machineName, pm.code as process 
            FROM job_card jc
            LEFT JOIN item_vs_pm ip ON ip.item = jc.itemId
            INNER JOIN machines ON machines.id = ip.machineName
            INNER JOIN mst_pm pm ON pm.id = ip.process
            WHERE jc.mrpMstId = ? AND ip.dflag = ?
            ORDER BY jc.jcNo, ip.processPriority`, [mrpMstId, 0]
        );

        if (jcRows.length > 0) {
            const insertQuery = `INSERT INTO jobcard_planning (mrpMstId, jcId, jcNo, itemId, machineId, machineName, processId, process, Qty) VALUES ${jcRows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(',')}`;
            const values = jcRows.flatMap(item => [mrpMstId, item.id, item.jcNo, item.itemId, item.machineId, item.machineName, item.processId, item.process, item.Qty]);

            await conn.execute(insertQuery, values);
        }

        return true;
    } catch (err) {
        throw err;
    }
}

exports.childPartPlanning = async (conn, mrpMstId) => {
    try {
        const [rows] = await conn.execute(`
            SELECT 
                mrp.mrpMstId, mrp.orderPlnId, mrp.id, mrp.jcId, jc.jcNo, mrp.itemId, mrp.itemCode, mrp.Qty, machines.id AS machineId, 
                machines.machineName, pm.id as processId, pm.code as processName, ip.count, (ip.count * mrp.Qty) as totCount
            FROM mrp 
            LEFT JOIN job_card jc ON jc.id = mrp.jcId 
            LEFT JOIN item_vs_pm ip ON ip.item = mrp.itemId 
            INNER JOIN machines ON machines.id = ip.machineName 
            INNER JOIN mst_pm pm ON pm.id = ip.process
            WHERE mrp.mrpMstId = ? AND ip.dflag = ? AND pm.vendorProcess = ? AND mrp.jcPart = ?
            ORDER BY mrp.itemId, ip.processPriority`,
            [mrpMstId, 0, 0, 'Y']
        );

        if (rows.length > 0) {
            const insertQuery = `INSERT INTO childpart_planning (mrpMstId, orderPlnId, mrpId, jcId, jcNo, itemId, itemCode, Qty, machineId, machineName, processId, processName, count, totCount) 
                VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(',')}`;
            const values = rows.flatMap(r => [r.mrpMstId, r.orderPlnId, r.id, r.jcId, r.jcNo, r.itemId, r.itemCode, r.Qty, r.machineId, r.machineName, r.processId, r.processName, r.count, r.totCount]);

            await conn.execute(insertQuery, values);
        }

        return true;
    } catch (err) {
        throw err;
    }
}

exports.childPlanning = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { mrpMstId } = req.body;

        await this.childPartPlanning(conn, mrpMstId);
        await conn.commit();

        return handleSuccessResponse(res, "Success");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

const assemblyCellPlanning = async (conn, shipmentDate, fim) => {
    try {
        const fetchQuery = `
            SELECT 
                ap.id,
                ap.itemId,
                ap.itemCode, 
                items.itemname AS description, 
                po.poNo, 
                ap.Qty, 
                ap.Produced_Qty AS producedQty, 
                ivp.cycleTime AS cTime, 
                ROUND(ap.Qty * ivp.cycleTime, 2) AS totCTime
            FROM assembly_planning ap
            INNER JOIN items ON items.id = ap.itemId
            LEFT JOIN item_vs_pm ivp 
                ON ivp.item = ap.itemId 
                AND ivp.process = (SELECT id FROM mst_pm WHERE LOWER(name) = 'assembly' LIMIT 1)
            LEFT JOIN purchas_order_item poi ON poi.PartNo = ap.itemCode
            LEFT JOIN purchase_order po ON po.id = poi.purchase_order_id
            WHERE DATE(ap.shipmentDate) = ? AND ap.fim = ?
            GROUP BY ap.itemId, ap.itemCode, items.itemname
        `;
        const [rows] = await conn.execute(fetchQuery, [shipmentDate, fim]);

        const naturalSort = (a, b) =>
            a.itemCode.localeCompare(b.itemCode, undefined, { numeric: true, sensitivity: 'base' });

        return rows
            .sort(naturalSort)
            .map((row, index) => ({ sNo: index + 1, ...row }));
    } catch (err) {
        throw err;
    }
};

const assmblyCellExport = async (res, assemblyData) => {
    try {
        const { assemblyRows, shipmentDate, fim } = assemblyData;

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Assembly Plan');

        worksheet.addRow(['MALLIK ENGINEERING PRIVATE LTD', '', '', '', '', '', '', 'FIM CODE', fim]);
        worksheet.addRow(['ASSEMBLY SCHEDULE', '', '', '', '', '', '', 'SHIPMENT DATE', shipmentDate]);
        worksheet.addRow([]); // Empty row for spacing
        worksheet.addRow(['S.No', 'Item Code', 'Description', 'Reference No', 'Po No', 'Quantity', 'Produced Qty', 'Cycle Time', 'Total Cycle Time']);

        // Add assembly data rows
        assemblyRows.forEach((row) => {
            worksheet.addRow([row.sNo, row.itemCode, row.description, row.refNo, row.poNo, row.Qty, row.producedQty, row.cTime, row.totCTime]);
        });
        worksheet.mergeCells('A1:G1'); // Merge first row
        worksheet.mergeCells('A2:G2'); // Merge second row

        function applyCellStyles(worksheet, data) {
            data.cells.forEach((cellRef, index) => {
                const cell = worksheet.getCell(cellRef);
                cell.alignment = { horizontal: 'center' };
                cell.font = { bold: true, size: data.size[index] };
            });
        }
        // Apply styles to metadata cells
        applyCellStyles(worksheet, { cells: ['A1', 'A2', 'H1', 'H2', 'I1', 'I2'], size: [13, 13, 12, 12, 12, 12] });

        // Style the header row (row 4)
        const headerRow = worksheet.getRow(4);
        headerRow.eachCell((cell) => {
            cell.alignment = { horizontal: 'center' };
            cell.font = { bold: true, size: 13 };
        });

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 4) {
                row.alignment = { horizontal: 'center' };
            }
        });

        worksheet.columns = [
            { key: 'sNo', width: 10 },
            { key: 'itemCode', width: 28 },
            { key: 'description', width: 28 },
            { key: 'refNo', width: 28 },
            { key: 'poNo', width: 28 },
            { key: 'Qty', width: 15 },
            { key: 'producedQty', width: 15 },
            { key: 'cTime', width: 25 },
            { key: 'totCTime', width: 20 },
        ];

        worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Assembly-Planning.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        throw err;
    }
};

exports.assemblyCell = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        await conn.beginTransaction();

        const { type, shipmentDate, fim } = req.query;
        const assemblyRows = await assemblyCellPlanning(conn, shipmentDate, fim);

        await conn.commit();

        if (type === 'view') {
            return handleSuccessResponse(res, "Fim Assembly Plan", assemblyRows);
        } else if (type === 'download') {
            return await assmblyCellExport(res, { assemblyRows, shipmentDate, fim });
        }

        throw new CustomError("Invalid type", 400);
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.storeRejectedParts = async (conn, reObj, rejUser = null) => {
    const { jcNo, itemId, rejQty } = reObj || {};

    const qty = Number(rejQty);

    if (!jcNo || !itemId || !Number.isFinite(qty) || qty <= 0) {
        return true;
    }

    try {
        const [jcRows] = await conn.execute(`
            SELECT jc.jcNo, op.kanbanDate, op.sobMstId, op.saleId
            FROM job_card jc
            JOIN mrp_mst m ON m.id = jc.mrpMstId
            JOIN order_plannings op ON op.id = m.orderPlnId
            WHERE jc.jcNo = ?
        `, [jcNo]);

        if (!jcRows.length) return true;

        const jc = jcRows[0];

        const [itemRows] = await conn.execute(`
            SELECT id AS itemId, itemCode
            FROM items
            WHERE id = ?
        `, [itemId]);

        if (!itemRows.length) return true;

        const item = itemRows[0];

        await conn.execute(`
            INSERT INTO rejected_parts
            (sobMstId, saleId, kanbanDate, jcNo, itemId, itemCode, rejQty, reqUser)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                rejQty = VALUES(rejQty),
                reqUser = VALUES(reqUser)
        `, [
            jc.sobMstId,
            jc.saleId,
            jc.kanbanDate,
            jc.jcNo,
            item.itemId,
            item.itemCode,
            qty,
            rejUser
        ]);

        return true;
    } catch (err) {
        throw err;
    }
};

exports.handleRejectedParts = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const rejObj = req.body;

        await this.storeRejectedParts(conn, rejObj);

        await conn.commit();
        return handleSuccessResponse(res, "Rejected parts stored successfully");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

const convertToMysqlDate = (dmy) => {
    if (!dmy) return null;
    const [day, month, year] = dmy.split("-");
    return `${year}-${month}-${day}`;
};

exports.fetchRejectedDoc = async (req, res) => {
    try {
        const view = req.query.view || "doc";
        const kanbanDate = req.query.kanbanDate || null;
        const status = req.query.status === "Approved" ? 1 : 0;

        if (view === "doc") {
            const [rows] = await connection.query(
                `
                SELECT 
                    ROW_NUMBER() OVER (ORDER BY kanbanDate DESC) AS sNo,
                    MIN(id) AS id,
                    DATE_FORMAT(created_at, '%d-%m-%Y') AS rejDate,
                    DATE_FORMAT(kanbanDate, '%d-%m-%Y') AS kanbanDate,
                    reqUser
                FROM rejected_parts
                WHERE status = ?
                GROUP BY kanbanDate
                ORDER BY kanbanDate DESC
                `,
                [status]
            );
            return handleSuccessResponse(res, "Rejected Documents", rows);
        }

        if (!kanbanDate) {
            throw new CustomError("kanbanDate is required", 400);
        }

        const mysqlDate = convertToMysqlDate(kanbanDate);

        const [rows] = await connection.query(
            `
            SELECT 
                ROW_NUMBER() OVER (ORDER BY id DESC) AS sNo,
                id, jcNo, itemCode, rejQty, reqUser,
                DATE_FORMAT(kanbanDate, '%d-%m-%Y') AS kanbanDate
            FROM rejected_parts
            WHERE status = ?
              AND DATE(kanbanDate) = ?
            ORDER BY id DESC
            `,
            [status, mysqlDate]
        );

        return handleSuccessResponse(res, "Rejected Parts List", rows);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.approveRejectedParts = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { kanbanDate } = req.body;

        if (!kanbanDate) throw new CustomError("Kanban date required!", 400);

        const reqUser = await getUser(req);
        const mysqlDate = convertToMysqlDate(kanbanDate);

        const [rejRows] = await conn.execute(
            `
            SELECT 
                sobMstId, 
                saleId, 
                kanbanDate AS orderKBDate, 
                itemId, 
                itemCode, 
                rejQty 
            FROM rejected_parts
            WHERE DATE(kanbanDate) = DATE(?) 
              AND status = 0
            `,
            [mysqlDate]
        );

        if (rejRows.length === 0) {
            throw new CustomError("No rejected parts found for this date", 404);
        }

        const orderPriority = await getOderPriority();
        const orderNo = await getOrderNo(req);

        const { sobMstId, saleId, orderKBDate } = rejRows[0];

        const [opResult] = await conn.execute(`
            INSERT INTO order_plannings 
            (sobMstId, saleId, orderNo, requestedBy, kanbanDate, orderPriority, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [sobMstId, saleId, orderNo, reqUser, orderKBDate, orderPriority, 'Rej MRP']
        );

        const orderPlnId = opResult.insertId;

        const values = [];
        const placeholders = [];

        for (const row of rejRows) {
            placeholders.push("(?, ?, ?, ?, ?, ?)");
            values.push(row.sobMstId, row.saleId, orderPlnId, orderNo, row.itemCode, row.rejQty);
        }

        await conn.execute(`
            INSERT INTO orderlist 
            (sobMstId, saleId, orderPlnId, orderNo, itemCode, Qty)
            VALUES ${placeholders.join(",")}`,
            values
        );

        const curDate = await currentDateTimeInd();

        await conn.execute(`
            UPDATE rejected_parts 
            SET status = 1, approvedDate = ?, approvedBy = ? 
            WHERE DATE(kanbanDate) = DATE(?) 
              AND status = 0`,
            [curDate, reqUser, mysqlDate]
        );
        await updateDocCounter(connection, 'OrderPlan');

        await conn.commit();

        return handleSuccessResponse(res, "Rejected parts approved successfully")
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.declineRejectedParts = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { kanbanDates = [] } = req.body;

        if (!Array.isArray(kanbanDates) || kanbanDates.length === 0) {
            throw new CustomError("Select documents", 400);
        }

        const reqUser = await getUser(req);
        const convertedKanbans = kanbanDates.map(d => convertToMysqlDate(d));
        const placeholders = convertedKanbans.map(() => "?").join(",");

        await conn.execute(`
            UPDATE rejected_parts 
            SET 
                status = 2, 
                approvedDate = NOW(),
                approvedBy = ?
            WHERE status = 0
              AND DATE(kanbanDate) IN (${placeholders})
            `,
            [reqUser, ...convertedKanbans]
        );

        await conn.commit();

        return handleSuccessResponse(res, "Declined successfully");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.machineLoad = async (req, res) => {
    try {
        const { mrpMstId } = req.query;

        const [rows] = await connection.execute(`
            SELECT machine, SUM(plannedTime) as workPlanned FROM sf_schedule 
            WHERE mrpMstId = ?
            GROUP BY machine`,
            [mrpMstId]
        );

        return handleSuccessResponse(res, "Machine load", rows)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const mrpProducts = async (mrpMstIds) => {
    const placeholders = mrpMstIds.map(() => "?").join(",");

    const [rows] = await connection.execute(
        `
        SELECT s.contractNo, c.product AS Product, s.fimNo AS Fim
        FROM mrp_mst m
        INNER JOIN sob s ON s.sobMstId = m.sobMstId
        INNER JOIN csl_mst c ON s.cslMstId = c.id
        WHERE m.id IN (${placeholders})
        GROUP BY s.contractNo, c.product, s.fimNo
        `,
        mrpMstIds
    );

    const fimMap = Object.create(null);

    for (const { Product, Fim } of rows) {
        if (!Fim) continue;

        const idx = Fim.indexOf("FIM");
        const fimKey = idx >= 0 ? Fim.slice(idx) : Fim;

        const prodMap = fimMap[fimKey] || (fimMap[fimKey] = Object.create(null));
        prodMap[Product] = (prodMap[Product] || 0) + 1;
        prodMap.totQty = (prodMap.totQty || 0) + 1;
    }

    return fimMap;
};

exports.machineLoadExcel = async (req, res) => {
    try {
        let { mrpMstIds } = req.query;

        if (!mrpMstIds) {
            return res.status(400).json({ success: false, message: "mrpMstIds is required" });
        }

        mrpMstIds = (Array.isArray(mrpMstIds) ? mrpMstIds : mrpMstIds.split(","))
            .map(Number)
            .filter(Number.isInteger);

        if (!mrpMstIds.length) {
            return res.status(400).json({ success: false, message: "Invalid mrpMstIds" });
        }

        const placeholders = mrpMstIds.map(() => "?").join(",");

        const [rows] = await connection.execute(
            `
            SELECT machine, SUM(plannedTime) AS workPlanned
            FROM sf_schedule
            WHERE mrpMstId IN (${placeholders})
            GROUP BY machine
            ORDER BY machine
            `,
            mrpMstIds
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: "No data found" });
        }

        /* ===================== CONSTANTS ===================== */
        const S1_HRS = 48;
        const S2_HRS = 96;
        const S3_HRS = 144;
        const PER_SHIFT_HRS = 72;

        const labels = [];
        const values = [];

        for (const r of rows) {
            labels.push(r.machine);
            values.push(Number(((r.workPlanned || 0) / 60).toFixed(2)));
        }

        const s1Line = Array(labels.length).fill(S1_HRS);
        const s2Line = Array(labels.length).fill(S2_HRS);
        const s3Line = Array(labels.length).fill(S3_HRS);

        /* ===================== CHART ===================== */
        const chart = new QuickChart();
        chart.setVersion("3");
        chart.setWidth(900);
        chart.setHeight(450);

        chart.setConfig({
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: "Req Hrs",
                        data: values,
                        backgroundColor: "#2f5597",
                        borderColor: "#1f3c88",
                        borderWidth: 1,
                        borderRadius: 6,
                        barThickness: 18,
                        maxBarThickness: 22
                    },
                    {
                        label: "S1 Hrs",
                        type: "line",
                        data: s1Line,
                        borderColor: "#36a71fff",
                        borderWidth: 3,
                        borderDash: [6, 4],
                        pointRadius: 0
                    },
                    {
                        label: "S2 Hrs",
                        type: "line",
                        data: s2Line,
                        borderColor: "#e98827ff",
                        borderWidth: 3,
                        borderDash: [6, 4],
                        pointRadius: 0
                    },
                    {
                        label: "S3 Hrs",
                        type: "line",
                        data: s3Line,
                        borderColor: "#ba2e22ff",
                        borderWidth: 3,
                        borderDash: [6, 4],
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: false,
                layout: { padding: 14 },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        display: ctx => ctx.dataset.type !== "line",
                        anchor: "end",
                        align: "end",
                        formatter: v => `${v}`,
                        color: "#000000",
                        font: { size: 11, weight: "bold" }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Machine",
                            color: "#000000",
                            font: { size: 13, weight: "bold" }
                        },
                        ticks: {
                            color: "#000000",
                            font: { size: 11 }
                        },
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: "Required Hrs V/S Available Hrs",
                            color: "#000000",
                            font: { size: 13, weight: "bold" }
                        },
                        ticks: {
                            color: "#000000",
                            font: { size: 11 }
                        },
                        grid: {
                            display: true,
                            color: "rgba(0,0,0,0.25)",
                            lineWidth: 1
                        }
                    }
                }
            },
            plugins: [
                "chartjs-plugin-datalabels",
                {
                    id: "chartAreaBorder",
                    afterDraw(chart) {
                        const { ctx, chartArea } = chart;
                        if (!ctx || !chartArea) return;

                        ctx.save();
                        ctx.lineWidth = 2.5;
                        ctx.strokeStyle = "#000000";
                        ctx.strokeRect(
                            chartArea.left,
                            chartArea.top,
                            chartArea.right - chartArea.left,
                            chartArea.bottom - chartArea.top
                        );
                        ctx.restore();
                    }
                }
            ]
        });

        const chartImage = await chart.toBinary();

        /* ===================== EXCEL ===================== */
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Machine Load");

        sheet.getRow(1).height = 30;
        sheet.getRow(2).height = 30;

        const logoId = workbook.addImage({
            filename: path.join(
                process.cwd(),
                "public/Company/029d098d-ca39-415f-ae25-df85939a9d76.png"
            ),
            extension: "png"
        });

        sheet.addImage(logoId, {
            tl: { col: 0.3, row: 0.4 },
            ext: { width: 120, height: 60 }
        });

        sheet.mergeCells("A1:V2");
        const titleCell = sheet.getCell("C1");
        titleCell.value = "PRODUCTION / CAPACITY PLANNER / BOTTLENECK ANALYSIS";
        titleCell.font = { bold: true, size: 16 };
        titleCell.alignment = { vertical: "middle", horizontal: "center" };

        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 22; c++) {
                sheet.getCell(r, c).border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" }
                };
            }
        }

        sheet.columns = [
            { key: "machine", width: 25 },
            { key: "s1", width: 18 },
            { key: "s2", width: 18 },
            { key: "s3", width: 18 },
            { key: "shiftHr", width: 18 },
            { key: "req", width: 18 }
        ];

        sheet.addRow([
            "Machine",
            "Available Hrs       (for 1st shift)",
            "Available Hrs       (for 2nd shift)",
            "Available Hrs       (for 3rd shift)",
            "Available Hrs       (for 1st shift)-12hrs",
            "Required M/C Hrs"
        ]);

        const headerRow = sheet.getRow(3);
        headerRow.height = 40;
        headerRow.eachCell(cell => {
            cell.font = { bold: true };
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "4472C4" }
            };
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.border = borderStyle();
        });

        for (const r of rows) {
            sheet.addRow({
                machine: r.machine,
                s1: S1_HRS,
                s2: S2_HRS,
                s3: S3_HRS,
                shiftHr: PER_SHIFT_HRS,
                req: Number(((r.workPlanned || 0) / 60).toFixed(2))
            });
        }

        sheet.eachRow((row, rowNo) => {
            if (rowNo <= 3) return;
            row.eachCell(cell => {
                cell.alignment = { vertical: "middle", horizontal: "center" };
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" }
                };
            });
        });

        const imageId = workbook.addImage({
            buffer: chartImage,
            extension: "png"
        });

        sheet.addImage(imageId, {
            tl: { col: 7, row: 2 },
            ext: { width: 900, height: 450 }
        });

        await productMachineWiseReport(mrpMstIds, sheet);
        await productSummaryReport(mrpMstIds, sheet);

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            "attachment; filename=machine_load_report.xlsx"
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Machine Load Excel Error:", err);
        return handleErrorResponse(res, err);
    }
};

function borderStyle() {
    return {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" }
    };
}

const productMachineWiseReport = async (mrpMstIds, sheet) => {
    const placeholders = mrpMstIds.map(() => "?").join(",");

    const [rows] = await connection.execute(`
        SELECT
            COALESCE(NULLIF(s.poRef, ''), DATE_FORMAT(op.kanbanDate, '%d-%m-%Y')) AS fimKey,
            ss.machine,
            SUM(ss.plannedTime) AS workPlanned
        FROM sf_schedule ss
        INNER JOIN mrp_mst m ON m.id = ss.mrpMstId
        INNER JOIN order_plannings op ON op.id = m.orderPlnId
        LEFT JOIN sales s ON s.id = m.saleId
        WHERE ss.mrpMstId IN (${placeholders})
        GROUP BY fimKey, ss.machine
    `, mrpMstIds);

    /* ===================== BUILD DATA ===================== */

    const data = {};
    const total = {};
    const machines = new Set();

    for (const { fimKey, machine, workPlanned } of rows) {
        if (!data[fimKey]) data[fimKey] = {};
        data[fimKey][machine] = Number(workPlanned || 0);

        total[machine] = (total[machine] || 0) + Number(workPlanned || 0);
        machines.add(machine);
    }

    const machineList = [...machines];

    /* ===================== START POSITION ===================== */

    const startRow = sheet.rowCount + 4;

    /* ===================== TITLE ===================== */

    sheet.mergeCells(`A${startRow}:C${startRow}`);
    const titleCell = sheet.getCell(`A${startRow}`);
    titleCell.value = "Product vs Machine Load Summary";
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { vertical: "middle", horizontal: "left" };
    sheet.getRow(startRow).height = 28;

    sheet.getRow(startRow).eachCell(cell => {
        cell.border = borderStyle();
    });

    /* ===================== HEADER ===================== */

    const headerRowIndex = startRow + 1;
    sheet.addRow(["FIM CONTRACTS", ...machineList, "TOTAL"]);

    const headerRow = sheet.getRow(headerRowIndex);
    headerRow.height = 40;

    headerRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "4472C4" }
        };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.border = borderStyle();
    });

    /* ===================== DATA ROWS ===================== */

    for (const fimKey of Object.keys(data)) {
        let rowTotal = 0;

        const rowData = [
            fimKey,
            ...machineList.map(m => {
                const val = data[fimKey][m] || 0;
                rowTotal += val;
                return val;
            }),
            rowTotal
        ];

        const row = sheet.addRow(rowData);
        row.eachCell((cell, col) => {
            cell.alignment = {
                horizontal: col === 1 ? "left" : "center",
                vertical: "middle"
            };
            cell.border = borderStyle();
        });
    }

    /* ===================== TOTAL ROW ===================== */

    const grandTotal = machineList.reduce(
        (s, m) => s + (total[m] || 0),
        0
    );

    const totalRow = sheet.addRow([
        "TOTAL",
        ...machineList.map(m => total[m] || 0),
        grandTotal
    ]);

    totalRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "D9E1F2" }
        };
        cell.border = borderStyle();
    });

    /* ===================== COLUMN WIDTH ===================== */

    sheet.columns.forEach((col, i) => {
        col.width = Math.max(col.width || 10, i === 0 ? 25 : 14);
    });
};

const productSummaryReport = async (mrpMstIds, sheet) => {
    const fimProductMap = await mrpProducts(mrpMstIds);

    const products = [
        ...new Set(
            Object.values(fimProductMap)
                .flatMap(o => Object.keys(o))
                .filter(k => k !== "totQty")
        )
    ].sort();

    const startRow = sheet.rowCount + 4;

    /* ===================== TITLE ===================== */

    sheet.mergeCells(`A${startRow}:C${startRow}`);
    const titleCell = sheet.getCell(`A${startRow}`);
    titleCell.value = "FIM vs Product Summary";
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { vertical: "middle", horizontal: "middle" };
    sheet.getRow(startRow).height = 28;

    sheet.getRow(startRow).eachCell(cell => {
        cell.border = borderStyle();
    });

    /* ===================== HEADER ===================== */

    const headerRowIndex = startRow + 1;
    sheet.addRow(["FIM", ...products, "TOTAL"]);

    const headerRow = sheet.getRow(headerRowIndex);
    headerRow.height = 40;

    headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "4472C4" }
        };
        cell.border = borderStyle();
    });

    /* ===================== DATA ROWS ===================== */

    const productTotals = {};
    let grandTotalQty = 0;

    Object.entries(fimProductMap).forEach(([fim, obj]) => {
        const rowData = [
            fim,
            ...products.map(p => {
                const val = obj[p] || 0;
                productTotals[p] = (productTotals[p] || 0) + val;
                return val;
            }),
            obj.totQty || 0
        ];

        grandTotalQty += obj.totQty || 0;

        const row = sheet.addRow(rowData);
        row.eachCell((cell, col) => {
            cell.alignment = {
                vertical: "middle",
                horizontal: col === 1 ? "left" : "center"
            };
            cell.border = borderStyle();
        });
    });

    /* ===================== TOTAL ROW ===================== */

    const totalRow = sheet.addRow([
        "TOTAL",
        ...products.map(p => productTotals[p] || 0),
        grandTotalQty
    ]);

    totalRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "D9E1F2" }
        };
        cell.border = borderStyle();
    });

    /* ===================== COLUMN WIDTH ===================== */

    sheet.columns.forEach((col, i) => {
        col.width = Math.max(col.width || 10, i === 0 ? 25 : 14);
    });
};

exports.kanbanProducts = async (req, res) => {
    try {
        const { mrpMstIds } = req.body;

        const data = await mrpProducts(mrpMstIds);

        return handleSuccessResponse(res, 'Products', data);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

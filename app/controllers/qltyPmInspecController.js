const { connection, CustomError, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');
const utility = require('../utility/utilityFunction');
const { generateDocNo, formatFinancialYears, updateDocCounter } = require('../utility/docNo');
const { storeRejectedParts } = require('./planningController');


//Get Items stored in item_vs_pm table
exports.search = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;

        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT DISTINCT

              machines.id, machines.machineName AS label
            FROM 
               machines
                INNER JOIN item_vs_pm ON item_vs_pm.machineName = machines.id
                INNER JOIN itempm_vs_inspec ON itempm_vs_inspec.item = item_vs_pm.item
            `;

        const values = [];

        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` WHERE (machines.machineName LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
        }

        // Add ORDER BY clause to sort the results with item codes containing special characters last
        // fetch += ` LIMIT 20`;
        // fetch += ` ORDER BY CASE WHEN items.itemCode LIKE '%[^a-zA-Z0-9]%' THEN 1 ELSE 0 END, items.itemCode LIMIT 20`;  // including white space
        // fetch += ` ORDER BY CASE WHEN items.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, items.itemCode LIMIT 100`;

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "Machines", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}




exports.getMachine = async (req, res) => {
    try {

        // const id = req.params.id;

        const query = `
            SELECT DISTINCT
              machines.id, machines.machineName 
            FROM 
              machines
              
            INNER JOIN item_vs_pm ON item_vs_pm.machineName = machines.id

            `;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            return res.status(200).json({
                success: true,
                message: "Machine list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}


//Download the xlsx/tif  based on the items
exports.download = async (req, res) => {

    const id = req.params.id;
    const [rows] = await connection.execute(`SELECT npdFile FROM items WHERE id = ?`, [id]);

    if (rows.length > 0) {
        const fileLoc = rows[0].npdFile;
        const filePath = "public/" + fileLoc;
        utility.exportFile(res, filePath);
    }

};

exports.showData = async (req, res) => {
    try {
        const qlty = req.body;

        // Ensure dates are in the correct format and include time
        const fromDate = qlty.from;
        const toDate = qlty.to;
        const jc = qlty.jcNo;
        const machine = qlty.machineName;
        const shift = qlty.shift;
        const status = qlty.status;

        let thick = null;
        if (qlty.thickness && qlty.thickness.trim() !== "") {
            const match = qlty.thickness.match(/\d+(\.\d+)?/);
            if (match) {
                thick = parseFloat(match[0]);
            }
        }

        if (!machine) {
            return res.status(400).json({ success: false, message: "Machine can't be empty!" });
        }

        // Base query
        // let query = `
        //     SELECT DISTINCT
        //         itm.itemCode, itm.npdFile, jc.id AS jCId, jc.jcNo, jc.Qty, jc.itemId,
        //         DATE_FORMAT(jc.created_at, '%d-%m-%Y') AS date, 
        //         DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, 
        //         ivi.inspectionType AS qltInspecType, ivi.reject, 
        //         jc.completed, jc.rework, jc.scrap,
        //         jc.qltyStatus AS statusDisplay
        //     FROM job_card jc
        //         LEFT JOIN itempm_vs_inspec AS ivi ON ivi.item = jc.itemId
        //         LEFT JOIN items AS itm ON jc.itemId = itm.id
        //         INNER JOIN item_vs_pm AS itmPm ON itmPm.item = jc.itemId
        //         INNER JOIN machines AS mach ON mach.id = itmPm.machineName 
        //         LEFT JOIN mrp_mst ON mrp_mst.id = jc.mrpMstId
        //         LEFT JOIN order_plannings op ON op.id = mrp_mst.orderPlnId
        //         LEFT JOIN 
        //             sf_schedule as sf  ON sf.machine = mach.machineName   
        //             AND jC.id = sf.jcId 
        //             AND itm.itemCode = sf.itemCode 
        //     WHERE jc.qltyComplete = 0 AND  itmPm.dflag = 0 AND mach.machineCode = ?`;

        // Collect conditions
        
        let query = `
            SELECT DISTINCT
                itm.itemCode, itm.npdFile, jc.id AS jCId, jc.jcNo, jc.Qty, jc.itemId,
                DATE_FORMAT(jc.created_at, '%d-%m-%Y') AS date, 
                DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, 
                ivi.inspectionType AS qltInspecType, ivi.reject, 
                jc.completed, jc.rework, jc.scrap,
                jc.qltyStatus AS statusDisplay
            FROM job_card jc
                LEFT JOIN itempm_vs_inspec AS ivi ON ivi.item = jc.itemId AND ivi.type = 'Production'
                LEFT JOIN items AS itm ON jc.itemId = itm.id
                INNER JOIN item_vs_pm AS itmPm ON itmPm.item = jc.itemId
                INNER JOIN machines AS mach ON mach.id = itmPm.machineName 
                LEFT JOIN mrp_mst ON mrp_mst.id = jc.mrpMstId
                LEFT JOIN order_plannings op ON op.id = mrp_mst.orderPlnId
                LEFT JOIN 
                    sf_schedule as sf ON sf.machine = mach.machineName   
                    AND jC.id = sf.jcId 
                    AND itm.itemCode = sf.itemCode 
            WHERE jc.qltyComplete = 0 AND itmPm.dflag = 0 AND mach.machineCode = ?`;

        const queryParams = [machine];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(jc.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (jc) {
            conditions.push('jc.jcNo = ?');
            queryParams.push(jc);
        }

        if (shift) {
            conditions.push('sf.prod_shift = ?');
            queryParams.push(shift);
        }

        if (thick !== null) {
            conditions.push('itm.rmThickness = ?');
            queryParams.push(thick);
        }

        if (status === "Pending") {
            conditions.push('jc.qltyStatus = ?');
            queryParams.push('R');

        }

        if (status === "InProcess") {
            conditions.push('jc.qltyStatus = ?');
            queryParams.push('Y');

        }

        if (status === "Completed") {
            conditions.push('jc.qltyStatus = ?');
            queryParams.push('G');

        }

        if (conditions.length) {
            query += ' AND ' + conditions.join(' AND ');
        }

        query += ` ORDER BY op.kanbanDate ASC`;    
       
        const [rows] = await connection.execute(query, queryParams);

        // Add serial numbers
        rows.forEach((element, index) => {
            element.sNo = index + 1;
            element.id = index + 1;
        });

        // Return response
        return res.status(200).json({
            success: true,
            message: "Job cards list",
            data: rows
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}



exports.getKanaban = async (req, res) => {
    try {

        const [rows] = await connection.execute(
            `SELECT id, kanbanDate
              FROM order_plannings  
              WHERE status != "Completed"`,
            []
        );

        const responseObject = {
            success: true,
            data: rows
        };

        // Send the responseObject as a response
        res.json(responseObject);

        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        throw err
    }
}



exports.forceComplete = async (req, res) => {
    try {
        const date = req.body.kanabanDate;

        const [DRows] = await connection.execute(
            `UPDATE job_card jc
                LEFT JOIN mrp_mst mrp ON mrp.id = jc.mrpMstId
                LEFT JOIN order_plannings op ON op.id = mrp.orderPlnId
                SET jc.qltyComplete = 1
                WHERE op.kanbanDate = ?`,
            [date]
        );

        return res.status(200).json({
            success: true,
            message: "Data ForceCompleted Successfully",
        });

    } catch (error) {
        console.error(error); // Log the error for debugging
        return res.status(500).json({ success: false, message: 'An error occurred' });
    }
};


exports.childPart = async (req, res) => {
    const { jcId, itemId: bomMstId, jcQty, jcNo } = req.body;

    const itemsList = [];
    const bom = await fetchMainItems(bomMstId);

    for (const element of bom) {
        const { itemId, jcPart, isBom, Qty } = element;

        if (jcPart == 'Y') {

            let itemsDetails = [];

            itemsDetails = await fetchItemsProgrammer(bomMstId, itemId, jcQty, jcNo);
            itemsList.push(...itemsDetails);
        }

        if (isBom == 'Y') {

            const childParts = await childItems(itemId, Number(jcQty) * Number(Qty), jcNo);
            itemsList.push(...childParts);
        }
    }

    itemsList.forEach((element, index) => {
        element.sNo = index + 1;
    });

    return res.status(200).json({
        success: true,
        message: "Child Items list",
        data: itemsList
    });

}


async function fetchItemsProgrammer(bomMstId, itemId = null, jcQty, jcNo) {
    const query = `
            SELECT items.id, items.id AS itemId, items.itemCode, items.itemName, items.npdFile,
              ivi.inspectionType AS qltInspecType, ivi.reject,
              items.qcApprove AS completed, items.qcScrap AS scrap, items.qcReWork AS rework, 
              (CAST(bom.Qty AS SIGNED) * ?) as Qty, ? as jcNo
            FROM bom 
            INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
            INNER JOIN items ON items.id = bom.itemId
            LEFT JOIN itempm_vs_inspec AS ivi ON ivi.item = items.id
            WHERE bom_mst.itemId = ? 
            AND bom.jcPart != 'NR' 
            ${itemId ? ' AND bom.itemId = ?' : ''}
            GROUP BY items.itemCode
        `;

    const params = [jcQty, jcNo, bomMstId];
    if (itemId) params.push(itemId);

    const [bom] = await connection.execute(query, params);
    return bom;
}


// Recursive function to fetch child details
async function childItems(mainItemId, jcQty, jcNo) {
    try {
        const itemsList = [];
        const bom = await fetchMainItems(mainItemId);

        for (const element of bom) {
            const { itemId, jcPart, isBom, Qty } = element;

            if (jcPart == 'Y') {
                let childItems = [];

                childItems = await fetchItemsProgrammer(mainItemId, itemId, jcQty, jcNo);
                itemsList.push(...childItems);
            }

            if (isBom == 'Y') {
                const childParts = await childItems(itemId, jcQty * Qty, jcNo); // Recursive call
                itemsList.push(...childParts);
            }
        }

        return itemsList;
    } catch (error) {
        throw error;
    }
}

async function fetchMainItems(bomMstId) {
    const query = `
            SELECT bom.itemId, bom.jcPart, bom.Qty, items.isBom FROM bom 
                INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
                INNER JOIN items ON items.id = bom.itemId
            WHERE bom_mst.itemId = ? AND bom.jcPart != 'NR'`;
    const [bom] = await connection.execute(query, [bomMstId]);
    return bom;
}




exports.showType = async (req, res) => {
    try {
        const jc = req.body.jcNo;
        const itm = req.body.item;
        const type = req.body.type;
        const machine = req.body.machineId;
        const isChild = req.body.isChild;

        let sqlQuery;
        const cust = "OTIS";

        // Check if jc or itm is undefined
        if (jc === undefined || itm === undefined) {
            return res.status(404).json({ success: false, message: 'jcNo or item is missing' });
        }

        // Construct the first SQL query based on isChild
        if (isChild == 1) {
            sqlQuery = `
                SELECT DISTINCT
                    jC.jcNo, jC.id AS jCId, jC.Qty AS jcQty, DATE_FORMAT(jC.created_at, '%d-%m-%Y') as date,
                    itm.itemCode,  shfit_mst.shiftLabel AS shift2, itmPm.count, ppm.range,
                    chPlan.machineName,  chPlan.machineId as machId, chPlan.Produced_QTY AS Qty, 
                    mst_pm.id as operationId, mst_pm.name as operation, inspec.status, inspec.addedBy
                FROM 
                    item_vs_pm itmPm    
                INNER JOIN 
                    mrp ON mrp.itemId = itmPm.item    
                INNER JOIN 
                    job_card AS jC ON jC.id = mrp.jcId
                INNER JOIN 
                    mst_pm ON mst_pm.id = itmPm.process
                INNER JOIN 
                    items as itm ON itm.id = itmPm.item 
                LEFT JOIN 
                    pm_inspeclist as inspec ON inspec.jcId = jC.id    

                    AND itmPm.item = inspec.itemId 
                    AND itmPm.process = inspec.processId AND inspec.pmInnspecType = ?
                LEFT JOIN 
                    childpart_planning as chPlan ON chPlan.machineId = itmPm.machineName   

                    AND jC.id = chPlan.jcId 
                    AND itmPm.item = chPlan.itemId 

                LEFT JOIN 
                    shfit_mst ON shfit_mst.id = chPlan.Shift   
                LEFT JOIN 
                    pm_price_map ppm ON ppm.id = itmPm.priceRange        
                WHERE 
                    itmPm.dflag = 0 AND  itmPm.item = ? AND jC.jcNo = ?`;
        } else {
            sqlQuery = `
                SELECT DISTINCT
                    jcPlan.machineName, jcPlan.machineId as machId, shfit_mst.shiftLabel AS shift2, itmPm.count, ppm.range,                
                    jC.jcNo, jC.id AS jCId, jC.Qty AS jcQty, jC.itemCode, DATE_FORMAT(jC.created_at, '%d-%m-%Y') as date,
                    mst_pm.id as operationId, mst_pm.name as operation, inspec.status, inspec.addedBy,
                    jcPlan.producedQty  AS Qty

                FROM 
                    item_vs_pm itmPm    
                INNER JOIN 
                    job_card AS jC ON jC.itemId = itmPm.item
                INNER JOIN 
                    mst_pm ON mst_pm.id = itmPm.process
                LEFT JOIN 
                    pm_inspeclist as inspec ON inspec.jcId = jC.id 
                    
                    AND itmPm.item = inspec.itemId 
                    AND itmPm.process = inspec.processId AND inspec.pmInnspecType = ?
                LEFT JOIN 
                    jobcard_planning as jcPlan ON jcPlan.machineId = itmPm.machineName   

                    AND jC.id = jcPlan.jcId 
                    AND itmPm.item = jcPlan.itemId 
                       
                LEFT JOIN 
                    sf_schedule as sf ON sf.machine = jcPlan.machineName     
                    AND jC.id = sf.jcId 
                    AND jC.itemCode = sf.itemCode

                LEFT JOIN 
                    shfit_mst ON shfit_mst.id = sf.prod_shift   
                LEFT JOIN 
                    pm_price_map ppm ON ppm.id = itmPm.priceRange                    
                WHERE 
                    itmPm.dflag = 0 AND  itmPm.item = ? AND jC.jcNo = ?`;
        }

        // Execute the first SQL query
        const [rows] = await connection.execute(sqlQuery, [type, itm, jc]);


        // //console.log(rows)

        if (rows.length === 0) {
            return res.status(200).json({ success: true, message: 'No data in main rows', data: [] });
        }

        // Extract operationIds from rows
        const operationIds = rows.map(row => row.operationId);

        const checkQuery = `
            SELECT pmi.machineId, pmi.actualResult, jC.jcNo, pmi.itemId, mach.machineName,
            pmi.processId AS operationId

            FROM pm_inspeclist pmi
            INNER JOIN job_card AS jC ON jC.id = pmi.jcId  
            INNER JOIN machines as mach ON mach.id = pmi.machineId  
            WHERE jC.jcNo = ? AND pmi.itemId = ? AND mach.machineName = ? AND pmi.pmInnspecType = ?`

        // Execute the checkQuery to get actualResult data
        const [checkResults] = await connection.execute(checkQuery, [jc, itm, machine, type]);


        // //console.log(checkResults);
        const checkMap = {};
        checkResults.forEach(result => {
            if (!checkMap[result.operationId]) {
                checkMap[result.operationId] = [];
            }
            checkMap[result.operationId].push(result.actualResult);
        });

        // Execute the second SQL query
        const sqlQuery2 = `
            SELECT 
                ivi.id, ivi.qltyParameter, ivi.expVisInspec, ivi.evalMethod, ivi.inspectionId, 
                ivi.maxTolerance, ivi.minTolerance, ivi.expVal, ivi.addedBy, ivi.item AS itemId, 
                ivi.inspectionType AS inspecCategory, ivi.process AS operationId,
                mst_uom.id AS uomId, mst_uom.code AS uom
            FROM 
                itempm_vs_inspec ivi
            INNER JOIN 
                mst_pm ON mst_pm.id = ivi.process
            INNER JOIN 
                mst_uom ON mst_uom.id = ivi.uom    
            WHERE 
                ivi.dflag = 0 AND ivi.item = ? 
                AND ivi.process IN (${operationIds.map(() => '?').join(', ')})`;

        const params = [itm, ...operationIds];
        const [subRows] = await connection.execute(sqlQuery2, params);

        // Create a map for the inspection rows
        const inspectionMap = {};

        // If subRows exist, process and map them
        if (subRows.length > 0) {
            subRows.forEach((row, index) => {
                row.sNo = index + 1;

                if (!inspectionMap[row.operationId]) {
                    inspectionMap[row.operationId] = [];
                }

                // Attach actualResult to the row (if found) or null
                row.actualResult = checkMap[row.operationId] ? checkMap[row.operationId].shift() : null;
                inspectionMap[row.operationId].push(row);
            });
        }

        // Enhance the rows with additional properties and associate with inspection data
        rows.forEach((row, index) => {
            row.type = type;
            row.id = index + 1;
            row.sNo = index + 1;
            row.customer = cust;
            row.inspections = inspectionMap[row.operationId] || []; // If no subRows, inspections will be an empty array
        });

        // Split rows into two arrays: one matching the machine, one not
        const firstArray = [];
        const lastArray = [];

        rows.forEach(item => {
            if (item.machineName === machine) {
                firstArray.push(item);
            } else {
                lastArray.push(item);
            }
        });

        const responseObject = {
            success: true,
            data: [...firstArray, ...lastArray]
        };

        // Return the response with rows, regardless of subRows being empty
        res.status(200).json(responseObject);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};
//    ****************************      PROCESS INSPECTION TYPE   *******************************         //



exports.uniqueId = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {

        const { padStartNo, uniqueNo } = await generateDocNo(
            conn,
            req,
            { docType: 'ProductionQC' }
        );

        await conn.commit();
        return res.status(200).json({
            qTestNo: uniqueNo,
            snNo: padStartNo
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.submit = async (req, res) => {
    const start = await connection.getConnection();
    try {
        await start.beginTransaction();

        const {
            qlty: qltyArray, reworkRates, status, qTestNo, serialNo, reason, remarks, type, machId, date, shift2, jCId, jcNo, itemId, operationId, 
            Qty, rejRewQty, customer, count
        } = req.body;

        const safeCount = count === undefined || count === null || count === '' ? 0 : Number(count);


        const user = req.headers.username;

        if (!Array.isArray(qltyArray)) {
            throw new CustomError("Invalid request format. Expected an array for qlty.", 404);
        }

        /* ---------- CHECK ALREADY APPROVED ---------- */
        const checkApprovedQuery = `
            SELECT status FROM pm_inspecList
            WHERE jcId = ? AND itemId = ? AND machineId = ?
              AND processId = ? AND pmInnspecType = ?
              AND status = 'approved'
        `;

        const [approvedRows] = await start.execute(
            checkApprovedQuery,
            [jCId, itemId, machId, type, operationId]
        );

        if (approvedRows.length > 0) {
            throw new CustomError("The Report has already approved.", 400);
        }

        /* ---------- INSERT pm_inspecList ---------- */
        const storeQuery = `
            INSERT INTO pm_inspecList
            (
                qTestNo, snNo, jcId, itemId, pmInnspecType, date, customer,
                machineId, processId, shift, totQlty, rejRewQty, count,
                qltyParameter, expVal, maxTolerance, minTolerance, uomId,
                visual, evalutionMethod, actualResult,
                status, reason, remarks, addedBy
            )
            VALUES ?
        `;

        /* ---------- INSERT rework_rate_costs ---------- */
        const reworkRateInsertQuery = `
            INSERT INTO rework_rate_costs
            (
                qTestNo, snNo, jcId, itemId, pmInnspecType, date, machineId, processId,
                totQty, rework_rate_mst_id, totCost, addedBy
            )
            VALUES ?
        `;

        const updateQueries = {
            approved: `UPDATE job_card SET completed = completed + 1 WHERE id = ?`,
            scrap: `UPDATE job_card SET scrap = scrap + 1 WHERE id = ?`,
            rework: `UPDATE job_card SET rework = rework + 1 WHERE id = ?`,
            "rework & approved": `UPDATE job_card SET completed = completed + 1 WHERE id = ?`,
            "rework & scrap": `UPDATE job_card SET scrap = scrap + 1 WHERE id = ?`
        };

        const insertValues = [];
        const reworkRateValues = [];
        const updatedCombinations = new Set();
        let isReworkApproved = false;   // FLAG

        /* ---------- QLTY LOOP ---------- */
        for (const item of qltyArray) {
            const {
                qltyParameter,
                uomId,
                expVisInspec,
                evalMethod,
                actualResult,
                expVal,
                maxTolerance,
                minTolerance
            } = item;

            const rsltVal = parseFloat(actualResult);
            const expValFloat = parseFloat(expVal);
            const upperBound = expValFloat + parseFloat(maxTolerance);
            const lowerBound = expValFloat - parseFloat(minTolerance);

            const checkReworkQuery = `
                SELECT status FROM pm_inspecList
                WHERE jcId = ? AND itemId = ?
                  AND machineId = ? AND processId = ?
                  AND status = 'rework'
            `;

            const [existingRows] = await start.execute(
                checkReworkQuery,
                [jCId, itemId, machId, operationId]
            );

            let newStatus = status;

            if (existingRows.length > 0 && status === "approved") {
                newStatus = "rework & approved";
                isReworkApproved = true;     //  SET FLAG
            }

            if (existingRows.length > 0 && status === "scrap") {
                newStatus = "rework & scrap";
            }

            if (
                newStatus === "approved" &&
                (rsltVal < lowerBound || rsltVal > upperBound)
            ) {
                throw new CustomError(
                    `Actual Result for ${qltyParameter} is not within tolerance.`,
                    404
                );
            }

            insertValues.push([
                qTestNo, serialNo, jCId, itemId, type, date, customer, machId, operationId, shift2, Qty, rejRewQty, safeCount, qltyParameter, expVal, 
                maxTolerance, minTolerance, uomId, expVisInspec, evalMethod, actualResult, newStatus, reason, remarks, user
            ]);

            const combinationKey = `${jCId}-${itemId}-${operationId}`;
            if (!updatedCombinations.has(combinationKey)) {
                updatedCombinations.add(combinationKey);

                if (updateQueries[newStatus]) {
                    const [uRows] = await start.execute(
                        updateQueries[newStatus],
                        [jCId]
                    );
                    if (uRows.affectedRows <= 0) {
                        throw new CustomError("Failed to update job card.", 500);
                    }
                }
            }
        }

        /* ---------- BULK INSERT pm_inspecList ---------- */
        if (insertValues.length > 0) {
            await start.query(storeQuery, [insertValues]);
        }

        /* ---------- BULK INSERT rework_rate_costs ---------- */
        if (
            isReworkApproved &&
            Array.isArray(reworkRates) &&
            reworkRates.length > 0
        ) {
            for (const rw of reworkRates) {
                reworkRateValues.push([
                    qTestNo, serialNo, jCId, itemId, type, date, machId, operationId, Qty, rw.id, rw.rate, user
                ]);
            }

            await start.query(reworkRateInsertQuery, [reworkRateValues]);
        }

        /* ---------- MST UPDATE ---------- */
        if (status === "approved") {
            const checkQuery = `
                SELECT id FROM pm_inspeclist_mst
                WHERE jcId = ? AND itemId = ? AND processId = ?
            `;

            const [getRows] = await start.execute(
                checkQuery,
                [jCId, itemId, operationId]
            );

            if (getRows.length > 0) {
                await start.execute(
                    `UPDATE pm_inspeclist_mst
                     SET addedBy = ?, totQty = ?
                     WHERE jcId = ? AND itemId = ? AND processId = ?`,
                    [user, Qty, jCId, itemId, operationId]
                );
            } else {
                await start.execute(
                    `INSERT INTO pm_inspeclist_mst
                     (jcId, itemId, processId, addedBy, totQty)
                     VALUES (?, ?, ?, ?, ?)`,
                    [jCId, itemId, operationId, user, Qty]
                );
            }
        }

        await storeRejectedParts(
            start,
            { jcNo, itemId, rejQty: Number(rejRewQty) },
            user
        );

        await updateDocCounter(start, 'ProductionQC');

        await start.commit();
        return res.status(200).json({
            success: true,
            message: "Data added successfully"
        });

    } catch (err) {
        await start.rollback();
        return res.status(500).json({
            success: false,
            message: err.message,
            error: err
        });
    } finally {
        start.release();
    }
};

exports.report = async (req, res) => {
    try {
        const { jcNo, type, fromDate, toDate } = req.body;

        let sqlQuery = `
            SELECT DISTINCT
                jc.jcNo,
                pmI.snNo,
                pmI.qTestNo,
                pmI.jcId,
                pmI.itemId,
                pmI.status,
                pmI.addedBy,
                items.itemCode,
                mach.machineCode,
                DATE_FORMAT(pmI.created_at, '%d-%m-%Y') AS date
            FROM job_card jc
            INNER JOIN pm_inspeclist pmI 
                ON pmI.jcId = jc.id
            INNER JOIN items 
                ON items.id = pmI.itemId
            LEFT JOIN machines mach 
                ON mach.id = pmI.machineId
            WHERE pmI.pmInnspecType = ?
        `;

        const params = [type];

        /* ---------- DATE FILTER ---------- */
        if (fromDate && toDate) {
            sqlQuery += `
                AND pmI.created_at >= ?
                AND pmI.created_at < DATE_ADD(?, INTERVAL 1 DAY)
            `;
            params.push(fromDate, toDate);
        }

        /* ---------- JC FILTER ---------- */
        if (jcNo) {
            sqlQuery += ` AND jc.jcNo = ?`;
            params.push(jcNo);
        }

        /* ---------- DEFAULT TODAY ---------- */
        if (!fromDate && !toDate && !jcNo) {
            sqlQuery += `
                AND pmI.created_at >= CURDATE()
                AND pmI.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
            `;
        }

        const [rows] = await connection.execute(sqlQuery, params);

        rows.forEach((row, index) => {
            row.id = index + 100;
        });

        res.json({
            success: true,
            data: rows
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'An error occurred',
            error: err.message
        });
    }
};



exports.reportView = async (req, res) => {
    try {
        const { id, jcId, itemId } = req.body;

        // Construct the SQL query
        const sqlQuery = `
            SELECT 
                pmi.*,
                mach.machineCode, mst_pm.code as operation, mst_uom.code as uom,
                jC.jcNo, jC.Qty,  itm.itemCode, itm.itemName,
                DATE_FORMAT(pmi.created_at, '%d-%m-%Y') as date
            FROM 
                pm_inspeclist pmi
                INNER JOIN machines as mach ON mach.id = pmi.machineId
                INNER JOIN mst_pm ON mst_pm.id = pmi.processId
                INNER JOIN mst_uom ON mst_uom.id = pmi.uomId
                INNER JOIN items AS itm ON itm.id = pmi.itemId 
                INNER JOIN job_card AS jC ON jC.id = pmi.jcId
            WHERE 
                pmi.qTestNo = ? AND  pmi.jcId = ? AND  pmi.itemId = ?`;

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, [id, jcId, itemId]);

        // Add serial numbers to rows
        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        // Construct the response object with the modified rows
        const responseObject = {
            success: true,
            data: rows
        };

        // Send the responseObject as a response
        res.json(responseObject);

    } catch (err) {
        // Handle errors by sending a 500 response
        res.status(500).json({ success: false, message: 'An error occurred', error: err.message });
    }
}




// exports.rejected = async (req, res) => {
//     try {
//         const { from, to } = req.query;

//         // Determine the date filter condition
//         let dateCondition = "";
//         if (from && to) {
//             dateCondition = `AND DATE(pmI.created_at) BETWEEN ? AND ?`;
//         } else {
//             dateCondition = `AND DATE(pmI.created_at) = CURDATE()`;
//         }

//         // Construct the primary SQL query with date filtering
//         const sqlQuery = `
//             SELECT DISTINCT
//                 jc.jcNo, pmI.snNo, pmI.jcId, pmI.itemId, pmI.remarks, pmI.addedBy,
//                 items.itemCode, mach.machineCode, pmI.totQlty AS Qty, pmI.rejRewQty,
//                 DATE_FORMAT(pmI.created_at, '%d-%m-%Y') as date
//             FROM 
//                 job_card jc
//             INNER JOIN 
//                 pm_inspeclist AS pmI ON pmI.jcId = jc.id
//             LEFT JOIN 
//                 machines AS mach ON mach.id = pmI.machineId
//             INNER JOIN 
//                 items ON pmI.itemId = items.id    
//             WHERE 
//                 pmI.status = "scrap"
//                 ${dateCondition}
//             GROUP BY pmI.jcId, pmI.itemId;
//         `;

//         // Construct the QC SQL query
//         const qcQuery = `
//             SELECT DISTINCT
//                 op.Operator_Name, op.Kanbandate, op.Shift, 
//                 op.Part_Number, op.Machine_Name, op.Jobcard_Number
//             FROM 
//                 operator_details op;
//         `;

//         // Execute the SQL queries
//         const [rows] = await connection.execute(sqlQuery, from && to ? [from, to] : []);

//         const [qcRows] = await connection.execute(qcQuery);

//         // Map QC data by itemCode and machineCode for quick lookup
//         const qcDataMap = {};
//         qcRows.forEach((qcRow) => {
//             const key = `${qcRow.Jobcard_Number}-${qcRow.Part_Number}-${qcRow.Machine_Name}`;
//             qcDataMap[key] = {
//                 operatorName: qcRow.Operator_Name,
//                 kanbanDate: qcRow.Kanbandate,
//                 shift: qcRow.Shift,
//             };
//         });

//         // Merge QC data directly into the primary rows
//         rows.forEach((row, index) => {
//             const key = `${row.jcNo}-${row.itemCode}-${row.machineCode}`;
//             const qcData = qcDataMap[key] || {};
//             row.Operator_Name = qcData.operatorName || null;
//             row.Kanbandate = qcData.kanbanDate || null;
//             row.Shift = qcData.shift || null;
//             row.sNo = index + 1; // Add serial number
//             row.id = index + 1; // Add ID
//         });

//         // Construct the response object
//         const responseObject = {
//             success: true,
//             data: rows,
//         };

//         // Send the response
//         return res.status(200).json(responseObject);
//     } catch (err) {
//         console.error("Error in rejected function:", err);
//         return res.status(500).json({ success: false, message: err.message });
//     }
// };


exports.rejected = async (req, res) => {
    try {
        const { from, to } = req.query;

        const useDateRange = from && to;

        const dateCondition = useDateRange
            ? `AND DATE(pmI.created_at) BETWEEN ? AND ?`
            : `AND DATE(pmI.created_at) = CURDATE()`;

        const queryParams = useDateRange ? [from, to] : [];

        // Single optimized query — SQL join replaces the in-memory merge
        const sqlQuery = `
            SELECT
                jc.jcNo,
                pmI.id As insepcId,
                pmI.qTestNo,
                pmI.snNo,
                pmI.jcId,
                pmI.itemId,
                pmI.remarks,
                pmI.addedBy,
                items.itemCode,
                mach.machineCode,
                pmI.totQlty        AS Qty,
                pmI.rejRewQty,
                DATE_FORMAT(pmI.created_at, '%d-%m-%Y') AS date,
                op.Operator_Name,
                op.Kanbandate,
                op.Shift
            FROM
                pm_inspeclist AS pmI
            INNER JOIN job_card    AS jc    ON jc.id    = pmI.jcId
            INNER JOIN items               ON items.id  = pmI.itemId
            LEFT  JOIN machines   AS mach  ON mach.id  = pmI.machineId
            LEFT  JOIN operator_details AS op
                ON  op.Jobcard_Number = jc.jcNo
                AND op.Part_Number    = items.itemCode
                AND op.Machine_Name   = mach.machineCode
            WHERE
                pmI.status = 'scrap'
                ${dateCondition}
            GROUP BY
                pmI.jcId,
                pmI.itemId,
                jc.jcNo,
                pmI.snNo,
                pmI.remarks,
                pmI.addedBy,
                items.itemCode,
                mach.machineCode,
                pmI.totQlty,
                pmI.rejRewQty,
                pmI.created_at,
                op.Operator_Name,
                op.Kanbandate,
                op.Shift
        `;

        const [rows] = await connection.execute(sqlQuery, queryParams);

        // Attach serial numbers in one pass
        rows.forEach((row, i) => {
            row.sNo = i + 1;
            row.id  = i + 1;
        });

        return res.status(200).json({ success: true, data: rows });

    } catch (err) {
        console.error("Error in rejected:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.reportByJc = async (req, res) => {
    try {
        const qlt = req.body;

        // Construct the SQL query
        const sqlQuery = `
            SELECT 
                pmi.*,
                mach.machineCode, mst_pm.code as operation, mst_uom.code as uom,
                jC.jcNo, jC.Qty,  itm.itemCode, itm.itemName,
                DATE_FORMAT(pmi.created_at, '%d-%m-%Y') as date
            FROM 
                pm_inspeclist pmi
                INNER JOIN machines as mach ON mach.id = pmi.machineId
                INNER JOIN mst_pm ON mst_pm.id = pmi.processId
                INNER JOIN mst_uom ON mst_uom.id = pmi.uomId
                INNER JOIN items AS itm ON itm.id = pmi.itemId 
                INNER JOIN job_card AS jC ON jC.id = pmi.jcId
            WHERE 
                pmi.jcId = ? AND pmi.itemId = ? AND pmi.processId = ?`;

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, [qlt.jcId, qlt.itemId, qlt.processId]);

        // Add serial numbers to rows
        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        // Construct the response object with the modified rows
        const responseObject = {
            success: true,
            data: rows
        };

        // Send the responseObject as a response
        res.json(responseObject);

    } catch (err) {
        // Handle errors by sending a 500 response
        res.status(500).json({ success: false, message: 'An error occurred', error: err.message });
    }
}


//Scrap Counts
exports.scrapCount = async (req, res) => {
    try {

        // Construct the SQL query
        const sqlQuery = `
           SELECT COUNT(DISTINCT snNo) AS scrapCount
            FROM 
              pm_inspeclist
            WHERE status = 'scrap'
        `;

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, []);


        // Construct the response object with the modified rows
        const responseObject = {
            success: true,
            data: rows
        };

        // Send the responseObject as a response
        res.json(responseObject);

        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        throw err
    }
}


// exports.fpy = async (req, res) => {
//     try {
//         const { from, to } = req.body;

//         const sql = `
//             WITH RECURSIVE dates AS (
//             SELECT DATE(?) AS dt
//             UNION ALL
//             SELECT DATE_ADD(dt, INTERVAL 1 DAY)
//             FROM dates
//             WHERE dt < DATE(?)
//             )

//             SELECT  
//             DATE_FORMAT(d.dt, '%d-%m-%Y') AS date,

//             /* ------------ PRODUCED COUNT ------------ */
//             IFNULL(cp.prodCount, 0) + IFNULL(sf.prodCount, 0) AS producedCount,

//             /* ------------ INSPECTION COUNTS ------------ */
//             IFNULL(ins.approvedCount, 0) AS inspectionCount,
//             IFNULL(ins.reworkCount, 0) AS reworkCount,
//             IFNULL(ins.scrapCount, 0) AS rejectionCount


//             FROM dates d

//             /* -------- CHILD PART PLANNING (FIXED) -------- */
//             LEFT JOIN (
//             SELECT 
//                 Produced_date,
//                 COUNT(*) AS prodCount
//             FROM (
//                 SELECT Produced_date, itemId
//                 FROM childpart_planning
//                 WHERE Produced_date BETWEEN ? AND ?
//                 GROUP BY Produced_date, itemId
//             ) t
//             GROUP BY Produced_date
//             ) cp ON cp.Produced_date = d.dt

//             /* -------- SF SCHEDULE (FIXED) -------- */
//             LEFT JOIN (
//             SELECT 
//                 prod_date,
//                 COUNT(*) AS prodCount
//             FROM (
//                 SELECT prod_date, itemCode
//                 FROM sf_schedule
//                 WHERE prod_date BETWEEN ? AND ?
//                 GROUP BY prod_date, itemCode
//             ) t
//             GROUP BY prod_date
//             ) sf ON sf.prod_date = d.dt

//             /* -------- PM INSPECTION (UNCHANGED) -------- */
//             LEFT JOIN (
//             SELECT 
//                 DATE(created_at) AS dt,

//                 COUNT(DISTINCT CASE 
//                 WHEN status = 'approved' THEN itemId 
//                 END) AS approvedCount,

//                 COUNT(DISTINCT CASE 
//                 WHEN status = 'rework' THEN itemId 
//                 END) AS reworkCount,

//                 COUNT(DISTINCT CASE 
//                 WHEN status = 'scrap' THEN itemId 
//                 END) AS scrapCount

//             FROM pm_inspeclist
//             WHERE DATE(created_at) BETWEEN ? AND ?
//                 AND pmInnspecType = 'FPI'
//             GROUP BY DATE(created_at)
//             ) ins ON ins.dt = d.dt

//             ORDER BY d.dt
//         `;


//         const params = [
//             from, to,
//             from, to,
//             from, to,
//             from, to
//         ];

//         const [rows] = await connection.execute(sql, params);

//         let total = {
//             producedCount: 0,
//             inspectionCount: 0,
//             reworkCount: 0,
//             rejectionCount: 0,
//             defectCount: 0

//         };

//         const result = rows.map((r, i) => {
//             const defectCount = r.reworkCount + r.rejectionCount;

//             total.producedCount += r.producedCount;
//             total.inspectionCount += r.inspectionCount;
//             total.reworkCount += r.reworkCount;
//             total.rejectionCount += r.rejectionCount;
//             total.defectCount += defectCount;

//             const fpy =
//                 r.producedCount === 0
//                     ? 0
//                     : (100 * r.inspectionCount) / r.producedCount;

//             const today = new Date();
//             const rowDate = new Date(r.date.split('-').reverse().join('-'));

//             let yieldPercent = 0;

//             if (rowDate < today) {
//                 yieldPercent =
//                     r.inspectionCount > 0
//                         ? Number(
//                             (((r.inspectionCount - defectCount) / r.inspectionCount) * 100).toFixed(2)
//                         )
//                         : 0;
//             }

//             return {
//                 snNo: i + 1,
//                 date: r.date,
//                 producedCount: r.producedCount,
//                 inspectionCount: r.inspectionCount,
//                 reworkCount: r.reworkCount,
//                 rejectionCount: r.rejectionCount,
//                 defectCount: defectCount,
//                 fpyPercent: Math.round(fpy),
//                 yield: yieldPercent,
//                 target: 100
//             };
//         });

//         /* ---------------- TOTAL ROW ---------------- */
//         result.push({
//             snNo: "Total",
//             date: "",
//             producedCount: total.producedCount,
//             inspectionCount: total.inspectionCount,
//             reworkCount: total.reworkCount,
//             rejectionCount: total.rejectionCount,
//             defectCount: total.defectCount,
//             fpyPercent: total.producedCount === 0 ? 0 : Math.round((100 * total.inspectionCount) / total.producedCount),
//             yield: total.inspectionCount === 0 ? 0 : Number(
//                 (((total.inspectionCount - total.defectCount) / total.inspectionCount) * 100).toFixed(2)),
//             target: 100
//         });

//         return handleSuccessResponse(res, "FPY Data", result);
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };


exports.fpy = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { from, to } = req.body;

        await conn.beginTransaction();

        const sql = `
            WITH RECURSIVE dates AS (
                SELECT DATE(?) AS dt
                UNION ALL
                SELECT DATE_ADD(dt, INTERVAL 1 DAY)
                FROM dates
                WHERE dt < DATE(?)
            )

            SELECT  
                DATE_FORMAT(d.dt, '%d-%m-%Y') AS date,

                /* ------------ PRODUCED COUNT ------------ */
                IFNULL(cp.prodCount, 0) + IFNULL(sf.prodCount, 0) AS producedCount,

                /* ------------ INSPECTION COUNTS ------------ */
                IFNULL(ins.approvedCount, 0) AS inspectionCount,
                IFNULL(ins.reworkCount, 0) AS reworkCount,
                IFNULL(ins.scrapCount, 0) AS rejectionCount

            FROM dates d

            /* -------- CHILD PART PLANNING -------- */
            LEFT JOIN (
                SELECT 
                    Produced_date,
                    COUNT(DISTINCT CONCAT(itemId, '-', jcId)) AS prodCount
                FROM childpart_planning
                WHERE Produced_date BETWEEN ? AND ?
                GROUP BY Produced_date
            ) cp ON cp.Produced_date = d.dt

            /* -------- SF SCHEDULE -------- */
            LEFT JOIN (
                SELECT 
                    prod_date,
                    COUNT(DISTINCT CONCAT(itemCode, '-', jcId)) AS prodCount
                FROM sf_schedule
                WHERE prod_date BETWEEN ? AND ?
                GROUP BY prod_date
            ) sf ON sf.prod_date = d.dt

            /* -------- PM INSPECTION -------- */
            LEFT JOIN (
                SELECT 
                    DATE(created_at) AS dt,

                    COUNT(DISTINCT CASE 
                        WHEN status = 'approved'
                        THEN CONCAT(itemId, '-', jcId)
                    END) AS approvedCount,

                    COUNT(DISTINCT CASE 
                        WHEN status = 'rework'
                        THEN CONCAT(itemId, '-', jcId)
                    END) AS reworkCount,

                    COUNT(DISTINCT CASE 
                        WHEN status = 'scrap'
                        THEN CONCAT(itemId, '-', jcId)
                    END) AS scrapCount

                FROM pm_inspeclist
                WHERE DATE(created_at) BETWEEN ? AND ?
                  AND pmInnspecType = 'FPI'
                GROUP BY DATE(created_at)
            ) ins ON ins.dt = d.dt

            ORDER BY d.dt
        `;

        const params = [
            from, to,
            from, to,
            from, to,
            from, to
        ];

        const [rows] = await conn.execute(sql, params);

        let total = {
            producedCount: 0,
            inspectionCount: 0,
            reworkCount: 0,
            rejectionCount: 0,
            defectCount: 0
        };

        const result = rows.map((r, i) => {
            const defectCount = r.reworkCount + r.rejectionCount;

            total.producedCount += r.producedCount;
            total.inspectionCount += r.inspectionCount;
            total.reworkCount += r.reworkCount;
            total.rejectionCount += r.rejectionCount;
            total.defectCount += defectCount;

            // const fpy =
            //     r.producedCount === 0
            //         ? 0
            //         : (100 * r.inspectionCount) / r.producedCount;

            const effectiveInspection = Math.min(
                r.inspectionCount,
                r.producedCount
            );

           const fpy =  r.producedCount === 0 ? 0 : Number(((100 * effectiveInspection) / r.producedCount).toFixed(2));


            const today = new Date();
            const rowDate = new Date(r.date.split('-').reverse().join('-'));

            let yieldPercent = 0;
            if (rowDate < today) {
                yieldPercent =
                    r.inspectionCount > 0
                        ? Number(
                            (((r.inspectionCount - defectCount) / r.inspectionCount) * 100).toFixed(2)
                        )
                        : 0;
            }

            return {
                snNo: i + 1,
                date: r.date,
                producedCount: r.producedCount,
                inspectionCount: r.inspectionCount,
                reworkCount: r.reworkCount,
                rejectionCount: r.rejectionCount,
                defectCount,
                fpyPercent: fpy,
                yield: yieldPercent,
                target: 100
            };
        });

        /* ---------------- TOTAL ROW ---------------- */
        result.push({
            snNo: "Total",
            date: "",
            producedCount: total.producedCount,
            inspectionCount: total.inspectionCount,
            reworkCount: total.reworkCount,
            rejectionCount: total.rejectionCount,
            defectCount: total.defectCount,
            fpyPercent:
                total.producedCount === 0
                    ? 0
                    : Math.round((100 * total.inspectionCount) / total.producedCount),
            yield:
                total.inspectionCount === 0
                    ? 0
                    : Number(
                        (((total.inspectionCount - total.defectCount) / total.inspectionCount) * 100).toFixed(2)
                    ),
            target: 100
        });

        await conn.commit();

        return handleSuccessResponse(res, "FPY Data", result);

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


// exports.fpyDetail = async (req, res) => {
//     const conn = await connection.getConnection();

//     try {
//         const { date, category } = req.body;
        
//         // Convert DD-MM-YYYY → YYYY-MM-DD
//         let formattedDate = null;

//         if (date) {
//             const [dd, mm, yyyy] = date.split("-");
//             formattedDate = `${yyyy}-${mm}-${dd}`;
//         }
//         let rows = [];

//         await conn.beginTransaction();

//         /* ---------------- PRODUCTION ---------------- */
//         if (category === "production") {

//             const prodSql = `
//                 SELECT 
//                     DATE_FORMAT(prod_date, '%d-%m-%Y') AS date,
//                     itemCode,
//                     jcId,
//                     machine,
//                     process
//                 FROM sf_schedule
//                 WHERE prod_date = ?
//                 GROUP BY itemCode, jcId

//                 UNION ALL

//                 SELECT 
//                     DATE_FORMAT(Produced_date, '%d-%m-%Y') AS date,
//                     itemCode,
//                     jcId,
//                     machineName AS machine,
//                     processName AS process
//                 FROM childpart_planning
//                 WHERE Produced_date = ?
//                 GROUP BY itemCode, jcId
//             `;

//             const [result] = await conn.execute(prodSql, [formattedDate, formattedDate]);
//             rows = result;
//         }

//         /* ---------------- INSPECTION / DEFECT / SCRAP / REWORK ---------------- */
//         else if (
//             ["inspected", "defect", "scrap", "rework"].includes(category)
//         ) {

//             let statusCondition = "";

//             if (category === "inspected") {
//                 statusCondition = `qc.status = 'approved'`;
//             } else if (category === "scrap") {
//                 statusCondition = `qc.status = 'scrap'`;
//             } else if (category === "rework") {
//                 statusCondition = `qc.status = 'rework'`;
//             } else if (category === "defect") {
//                 statusCondition = `qc.status IN ('scrap', 'rework')`;
//             }

//             const inspectSql = `
//                 SELECT 
//                     DATE_FORMAT(qc.created_at, '%d-%m-%Y') AS date,
//                     qc.itemId,
//                     i.itemCode,
//                     qc.jcId
//                 FROM pm_inspeclist qc
//                 INNER JOIN items i ON i.id = qc.itemId
//                 WHERE ${statusCondition}
//                   AND qc.pmInnspecType = 'FPI'
//                   AND DATE(qc.created_at) = ?
//                 GROUP BY qc.itemId, qc.jcId
//             `;

//             const [result] = await conn.execute(inspectSql, [formattedDate]);
//             rows = result;
//         }

//         /* ---------------- INVALID CATEGORY ---------------- */
//         else {
//             await conn.rollback();
//             return res.status(400).json({
//                 success: false,
//                 message: "Invalid category"
//             });
//         }

//         await conn.commit();

//         /* ---------------- FINAL RESPONSE ---------------- */
//         const result = rows.map((row, index) => ({
//             slNo: index + 1,
//             ...row
//         }));

//         return handleSuccessResponse(res, 'FPY Detail List', result);

//     } catch (err) {
//         await conn.rollback();
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// };


exports.fpyDetail = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { date, category } = req.body;

        if (!date || !category) {
            return res.status(400).json({
                success: false,
                message: "Date and category are required"
            });
        }

        // Convert DD-MM-YYYY → YYYY-MM-DD
        const [dd, mm, yyyy] = date.split("-");
        const formattedDate = `${yyyy}-${mm}-${dd}`;

        let sql = "";
        let params = [];

        /* ---------------- CATEGORY HANDLERS ---------------- */
        const inspectionStatusMap = {
            inspected: "qc.status = 'approved'",
            scrap: "qc.status = 'scrap'",
            rework: "qc.status = 'rework'",
            defect: "qc.status IN ('scrap','rework')"
        };

        /* ---------------- PRODUCTION ---------------- */
        if (category === "production") {
            // sql = `
            //     SELECT 
            //         DATE_FORMAT(prod_date, '%d-%m-%Y') AS date,
            //         itemCode,
            //         jcId,
            //         machine,
            //         process
            //     FROM sf_schedule
            //     WHERE prod_date = ?
            //     GROUP BY itemCode, jcId

            //     UNION ALL

            //     SELECT 
            //         DATE_FORMAT(Produced_date, '%d-%m-%Y') AS date,
            //         itemCode,
            //         jcId,
            //         machineName AS machine,
            //         processName AS process
            //     FROM childpart_planning
            //     WHERE Produced_date = ?
            //     GROUP BY itemCode, jcId
            // `;
            // params = [formattedDate, formattedDate];


             sql = `
                SELECT 
                    DATE_FORMAT(pr.prod_date, '%d-%m-%Y') AS date,
                    DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, 
                    pr.itemCode,
                    pr.jcId,
                    pr.machine,
                    pr.process,
                    pr.jcNo,
                    pr.prod_qty As prodQty
                FROM sf_schedule pr
                INNER JOIN job_card jc ON jc.id = pr.jcId
                LEFT JOIN mrp_mst ON mrp_mst.id = jc.mrpMstId
                LEFT JOIN order_plannings op ON op.id = mrp_mst.orderPlnId
                WHERE pr.prod_date = ?
                GROUP BY pr.itemCode, pr.jcId

                UNION ALL

                SELECT 
                    DATE_FORMAT(pr.Produced_date, '%d-%m-%Y') AS date,
                    DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, 
                    pr.itemCode,
                    pr.jcId,
                    pr.machineName AS machine,
                    pr.processName AS process,
                    pr.jcNo,
                    pr.Produced_QTY As prodQty
                FROM childpart_planning pr
                LEFT JOIN order_plannings op ON op.id = pr.orderPlnId
                WHERE pr.Produced_date = ?
                GROUP BY pr.itemCode, pr.jcId
            `;
            params = [formattedDate, formattedDate];
        }

        /* ---------------- INSPECTION / DEFECT / SCRAP / REWORK ---------------- */
        else if (inspectionStatusMap[category]) {
            sql = `
                SELECT 
                    DATE_FORMAT(qc.created_at, '%d-%m-%Y') AS date,
                    DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, 
                    qc.itemId,
                    i.itemCode,
                    qc.jcId,
                    p.name As process,
                    m.machineName As machine,
                    jc.jcNo,
                    jc.Produced_QTY As prodQty
                FROM pm_inspeclist qc
                INNER JOIN items i ON i.id = qc.itemId
                INNER JOIN mst_pm p ON p.id = qc.processId
                INNER JOIN machines m ON m.id = qc.machineId
                INNER JOIN job_card jc ON jc.id = qc.jcId
                LEFT JOIN mrp_mst ON mrp_mst.id = jc.mrpMstId
                LEFT JOIN order_plannings op ON op.id = mrp_mst.orderPlnId

                WHERE ${inspectionStatusMap[category]}
                  AND qc.pmInnspecType = 'FPI'
                  AND qc.created_at >= ?
                  AND qc.created_at < DATE_ADD(?, INTERVAL 1 DAY)
                GROUP BY qc.itemId, qc.jcId
            `;
            params = [formattedDate, formattedDate];
        }

        /* ---------------- INVALID CATEGORY ---------------- */
        else {
            return res.status(400).json({
                success: false,
                message: "Invalid category"
            });
        }

        const [rows] = await conn.execute(sql, params);

        /* ---------------- FINAL RESPONSE ---------------- */
        const result = rows.map((row, index) => ({
            slNo: index + 1,
            ...row
        }));

        return handleSuccessResponse(res, "FPY Detail List", result);

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


//IN SINGLE OBJECT ALL DATA SHOWN // 
exports.fpyDetail2 = async (req, res) => {
    try {
        const { date } = req.body;

        /* ---------- PRODUCTION ---------- */
        const prodSql = `
            SELECT itemCode FROM sf_schedule
            WHERE prod_date = ?
            GROUP BY itemCode

            UNION

            SELECT itemCode FROM childpart_planning
            WHERE Produced_date = ?
            GROUP BY itemCode
        `;
        const [producedRows] = await connection.execute(prodSql, [date, date]);

        /* ---------- INSPECTION ---------- */
        const inspectionSql = `
            SELECT i.itemCode
            FROM pm_inspeclist qc
            INNER JOIN items i ON i.id = qc.itemId
            WHERE qc.status = 'approved'
              AND qc.pmInnspecType = 'FPI'
              AND DATE(qc.created_at) = ?
            GROUP BY i.itemCode
        `;
        const [inspectionRows] = await connection.execute(inspectionSql, [date]);

        /* ---------- REWORK ---------- */
        const reworkSql = `
            SELECT i.itemCode
            FROM pm_inspeclist qc
            INNER JOIN items i ON i.id = qc.itemId
            WHERE qc.status = 'rework'
              AND qc.pmInnspecType = 'FPI'
              AND DATE(qc.created_at) = ?
            GROUP BY i.itemCode
        `;
        const [reworkRows] = await connection.execute(reworkSql, [date]);

        /* ---------- REJECTION ---------- */
        const rejectionSql = `
            SELECT i.itemCode
            FROM pm_inspeclist qc
            INNER JOIN items i ON i.id = qc.itemId
            WHERE qc.status = 'scrap'
              AND qc.pmInnspecType = 'FPI'
              AND DATE(qc.created_at) = ?
            GROUP BY i.itemCode
        `;
        const [rejectionRows] = await connection.execute(rejectionSql, [date]);

        /* ---------- BUILD ARRAYS ---------- */
        const produced = producedRows.map(r => r.itemCode);
        const inspection = inspectionRows.map(r => r.itemCode);
        const rework = reworkRows.map(r => r.itemCode);
        const rejection = rejectionRows.map(r => r.itemCode);

        // defect = rework + rejection (unique)
        const defect = [...new Set([...rework, ...rejection])];

        /* ---------- BUILD ARRAY OF OBJECTS ---------- */
        const maxLen = Math.max(
            produced.length,
            inspection.length,
            rework.length,
            rejection.length,
            defect.length
        );

        const result = Array.from({ length: maxLen }, (_, i) => ({
            slNo: i + 1,
            produced: produced[i] || null,
            inspection: inspection[i] || null,
            rework: rework[i] || null,
            rejection: rejection[i] || null,
            defect: defect[i] || null
        }));

        
        return handleSuccessResponse(res, "FPY Detail List", result);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


// exports.fetchPPM = async (req, res) => {
//     const conn = await connection.getConnection();

//     try {
//         const { fromDate, toDate } = req.body;
//         const endDateTime = `${toDate} 23:59:59`;

//         const dateKey = d => d.slice(0, 10);

//         // ================= DATE RANGE GENERATOR =================
//         function getDateRange(start, end) {
//             const dates = [];
//             let current = new Date(start);
//             const last = new Date(end);

//             while (current <= last) {
//                 dates.push(current.toISOString().slice(0, 10));
//                 current.setDate(current.getDate() + 1);
//             }
//             return dates;
//         }

//         /* =====================================================
//            1. PRODUCTION QTY
//         ===================================================== */
//         // const [prodRows] = await conn.execute(`
//         //     SELECT 
//         //         DATE_FORMAT(prod_date, '%Y-%m-%d') AS day,
//         //         SUM(prod_qty) AS prodQty
//         //     FROM sf_schedule
//         //     WHERE prod_date BETWEEN ? AND ?
//         //     GROUP BY prod_date
//         // `, [fromDate, toDate]);

//         // const prodMap = {};
//         // prodRows.forEach(r => prodMap[dateKey(r.day)] = Number(r.prodQty || 0));


//         // ---------- QUERY 1 : sf_schedule ----------
//         const [prodRows1] = await conn.execute(`
//             SELECT 
//                 DATE_FORMAT(prod_date, '%Y-%m-%d') AS day,
//                 SUM(prod_qty) AS prodQty
//             FROM sf_schedule
//             WHERE prod_date BETWEEN ? AND ?
//             GROUP BY prod_date
//         `, [fromDate, toDate]);

//         // ---------- QUERY 2 : childpart_planning ----------
//         const [prodRows2] = await conn.execute(`
//             SELECT 
//                 DATE_FORMAT(Produced_date, '%Y-%m-%d') AS day,
//                 SUM(Produced_QTY) AS prodQty
//             FROM childpart_planning
//             WHERE Produced_date BETWEEN ? AND ?
//             GROUP BY Produced_date
//         `, [fromDate, toDate]);

//         // ---------- MERGE BOTH ----------
//         const prodMap = {};

//         // first query
//         prodRows1.forEach(r => {
//             const day = dateKey(r.day);
//             prodMap[day] = (prodMap[day] || 0) + Number(r.prodQty || 0);
//         });

//         // second query
//         prodRows2.forEach(r => {
//             const day = dateKey(r.day);
//             prodMap[day] = (prodMap[day] || 0) + Number(r.prodQty || 0);
//         });

//         /* =====================================================
//            2. INPROCESS REJECTION
//         ===================================================== */
//         // const [inprocRejRows] = await conn.execute(`
//         //     SELECT 
//         //         DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
//         //         SUM(CASE WHEN status = 'scrap' THEN rejRewQty ELSE 0 END) AS qty
//         //     FROM pm_inspeclist
//         //     WHERE created_at BETWEEN ? AND ?
//         //     GROUP BY DATE(created_at)
//         // `, [fromDate, endDateTime]);

//         // const inprocRejMap = {};
//         // inprocRejRows.forEach(r => inprocRejMap[dateKey(r.day)] = Number(r.qty || 0));
//         const [inprocRejRows] = await conn.execute(`
//             SELECT
//                 DATE_FORMAT(day, '%Y-%m-%d') AS day,
//                 SUM(qty) AS qty
//             FROM (
//                 SELECT
//                     DATE(created_at) AS day,
//                     jcId,
//                     itemId,
//                     MAX(rejRewQty) AS qty
//                 FROM pm_inspeclist
//                 WHERE status = 'scrap'
//                 AND created_at BETWEEN ? AND ?
//                 GROUP BY DATE(created_at), jcId, itemId
//             ) x
//             GROUP BY day
//             ORDER BY day
//         `, [fromDate, endDateTime]);

//         const inprocRejMap = {};
//         inprocRejRows.forEach(r => {
//             inprocRejMap[r.day] = Number(r.qty || 0);
//         });

//         /* =====================================================
//            3. FINAL REJECTION
//         ===================================================== */
//         const [finalRejRows] = await conn.execute(`
//             SELECT 
//                 DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
//                 SUM(CASE WHEN status = 'scrap' THEN rejRewQty ELSE 0 END) AS qty
//             FROM assembly_qlty_inspeclist_mst
//             WHERE created_at BETWEEN ? AND ?
//             GROUP BY DATE(created_at)
//         `, [fromDate, endDateTime]);

//         const finalRejMap = {};
//         finalRejRows.forEach(r => finalRejMap[dateKey(r.day)] = Number(r.qty || 0));

//         /* =====================================================
//            4. INPROCESS REWORK
//         ===================================================== */
//         // const [inprocRewRows] = await conn.execute(`
//         //     SELECT 
//         //         DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
//         //         SUM(CASE WHEN status = 'rework' THEN rejRewQty ELSE 0 END) AS qty
//         //     FROM pm_inspeclist
//         //     WHERE created_at BETWEEN ? AND ?
//         //     GROUP BY DATE(created_at)
//         // `, [fromDate, endDateTime]);

//         // const inprocRewMap = {};
//         // inprocRewRows.forEach(r => inprocRewMap[dateKey(r.day)] = Number(r.qty || 0));

//         const [inprocRewRows] = await conn.execute(`
//             SELECT
//                 DATE_FORMAT(day, '%Y-%m-%d') AS day,
//                 SUM(qty) AS qty
//             FROM (
//                 SELECT
//                     DATE(created_at) AS day,
//                     jcId,
//                     itemId,
//                     MAX(rejRewQty) AS qty
//                 FROM pm_inspeclist
//                 WHERE status = 'rework'
//                 AND created_at BETWEEN ? AND ?
//                 GROUP BY DATE(created_at), jcId, itemId
//             ) x
//             GROUP BY day
//             ORDER BY day
//         `, [fromDate, endDateTime]);

//         const inprocRewMap = {};
//         inprocRewRows.forEach(r => {
//             inprocRewMap[r.day] = Number(r.qty || 0);
//         });


//         /* =====================================================
//            5. FINAL REWORK
//         ===================================================== */
//         const [finalRewRows] = await conn.execute(`
//             SELECT 
//                 DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
//                 SUM(CASE WHEN status = 'rework' THEN rejRewQty ELSE 0 END) AS qty
//             FROM assembly_qlty_inspeclist_mst
//             WHERE created_at BETWEEN ? AND ?
//             GROUP BY DATE(created_at)
//         `, [fromDate, endDateTime]);

//         const finalRewMap = {};
//         finalRewRows.forEach(r => finalRewMap[dateKey(r.day)] = Number(r.qty || 0));

//         /* =====================================================
//            6. MERGE + DAILY + CUMULATIVE
//         ===================================================== */
//         let cummProd = 0;
//         let cummInRej = 0;
//         let cummFinRej = 0;
//         let cummInRew = 0;
//         let cummFinRew = 0;

//         let totalInprocessRej = 0;
//         let totalFinalRej = 0;
//         let totalReworkOnly = 0;

//         //  FULL DATE RANGE (FIX)
//         const days = getDateRange(fromDate, toDate);

//         const result = days.map(day => {
//             const prodQty = prodMap[day] || 0;
//             const inRej = inprocRejMap[day] || 0;
//             const finRej = finalRejMap[day] || 0;
//             const inRew = inprocRewMap[day] || 0;
//             const finRew = finalRewMap[day] || 0;

//             const totalRejection = inRej + finRej;
//             const totalRework = inRew + finRew;
//             const grandTotal = totalRejection + totalRework;

//             cummProd += prodQty;
//             cummInRej += inRej;
//             cummFinRej += finRej;
//             cummInRew += inRew;
//             cummFinRew += finRew;

//             totalInprocessRej += inRej;
//             totalFinalRej += finRej;
//             totalReworkOnly += totalRework;

//             const cummTotalRejection = cummInRej + cummFinRej;
//             const cummTotalRework = cummInRew + cummFinRew;
//             const cummGrandTotal = cummTotalRejection + cummTotalRework;

//             return {
//                 date: day,

//                 productionQty: prodQty,

//                 inprocessRej: inRej,
//                 finalRej: finRej,
//                 totalRejection,

//                 inprocessRework: inRew,
//                 finalRework: finRew,
//                 totalRework,

//                 grandTotal,

//                 // inprocessPPM: prodQty ? Math.round((inRej / prodQty) * 1_000_000) : 0,
//                 // finalPPM: prodQty ? Math.round((finRej / prodQty) * 1_000_000) : 0,
//                 // reworkPPM: prodQty ? Math.round((totalRework / prodQty) * 1_000_000) : 0,
//                 // totalPPM: prodQty ? Math.round((grandTotal / prodQty) * 1_000_000) : 0,


//                 inprocessPPM: cummProd ? Math.round((cummInRej / cummProd) * 1_000_000) : 0,
//                 finalPPM: cummProd ? Math.round((cummFinRej / cummProd) * 1_000_000) : 0,
//                 reworkPPM: cummProd ? Math.round((cummTotalRework / cummProd) * 1_000_000) : 0,
//                 totalPPM: cummProd ? +((cummGrandTotal / cummProd) * 100).toFixed(3) : 0,

//                 cummProduction: cummProd,

//                 cummInprocessRej: cummInRej,
//                 cummFinalRej: cummFinRej,
//                 cummTotalRejection,

//                 cummInprocessRework: cummInRew,
//                 cummFinalRework: cummFinRew,
//                 cummTotalRework,

//                 cummGrandTotal,
//                 cummTotalPPM: cummProd
//                     ? Math.round((cummGrandTotal / cummProd) * 1_000_000)
//                     : 0
//             };
//         });

//         /* =====================================================
//            7. TOTAL ROW
//         ===================================================== */
//         result.push({
//             date: "TOTAL",

//             productionQty: '',

//             inprocessRej: totalInprocessRej,
//             finalRej: totalFinalRej,
//             totalRejection: '',

//             inprocessRework: '',
//             finalRework: '',
//             totalRework: totalReworkOnly,

//             grandTotal: '',

//             inprocessPPM: '',
//             finalPPM: '',
//             reworkPPM: '',
//             totalPPM: null,

//             cummProduction: '',
//             cummInprocessRej: '',
//             cummFinalRej: '',
//             cummTotalRejection: '',
//             cummInprocessRework: '',
//             cummFinalRework: '',
//             cummTotalRework: '',
//             cummGrandTotal: '',
//             cummTotalPPM: ''
//         });

//         res.json({ success: true, data: result });

//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ success: false, message: err.message });
//     } finally {
//         conn.release();
//     }
// };


exports.fetchPPM = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { fromDate, toDate } = req.body;
        const endDateTime = `${toDate} 23:59:59`;

        const dateKey = d => d.slice(0, 10);

        // ================= DATE RANGE GENERATOR =================
        function getDateRange(start, end) {
            const dates = [];
            let current = new Date(start);
            const last = new Date(end);

            while (current <= last) {
                dates.push(current.toISOString().slice(0, 10));
                current.setDate(current.getDate() + 1);
            }
            return dates;
        }

        /* =====================================================
           1. PRODUCTION QTY
        ===================================================== */
      
        // ---------- QUERY 1 : sf_schedule ----------
        const [prodRows1] = await conn.execute(`
            SELECT 
                DATE_FORMAT(prod_date, '%Y-%m-%d') AS day,
                SUM(prod_qty) AS prodQty
            FROM sf_schedule
            WHERE prod_date BETWEEN ? AND ?
            GROUP BY prod_date
        `, [fromDate, toDate]);

        // ---------- QUERY 2 : childpart_planning ----------
        const [prodRows2] = await conn.execute(`
            SELECT 
                DATE_FORMAT(Produced_date, '%Y-%m-%d') AS day,
                SUM(Produced_QTY) AS prodQty
            FROM childpart_planning
            WHERE Produced_date BETWEEN ? AND ?
            GROUP BY Produced_date
        `, [fromDate, toDate]);

        // ---------- MERGE BOTH ----------
        const prodMap = {};

        // first query
        prodRows1.forEach(r => {
            const day = dateKey(r.day);
            prodMap[day] = (prodMap[day] || 0) + Number(r.prodQty || 0);
        });

        // second query
        prodRows2.forEach(r => {
            const day = dateKey(r.day);
            prodMap[day] = (prodMap[day] || 0) + Number(r.prodQty || 0);
        });

        /* =====================================================
           2. INPROCESS REJECTION
        ===================================================== */
        const [inprocRejRows] = await conn.execute(`
            SELECT
                DATE_FORMAT(day, '%Y-%m-%d') AS day,
                SUM(qty) AS qty
            FROM (
                SELECT
                    DATE(created_at) AS day,
                    jcId,
                    itemId,
                    MAX(rejRewQty) AS qty
                FROM pm_inspeclist
                WHERE status = 'scrap'
                AND created_at BETWEEN ? AND ?
                GROUP BY DATE(created_at), jcId, itemId
            ) x
            GROUP BY day
            ORDER BY day
        `, [fromDate, endDateTime]);

        const inprocRejMap = {};
        inprocRejRows.forEach(r => {
            inprocRejMap[r.day] = Number(r.qty || 0);
        });

        /* =====================================================
           3. FINAL REJECTION
        ===================================================== */
        const [finalRejRows] = await conn.execute(`
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
                SUM(CASE WHEN status = 'scrap' THEN rejRewQty ELSE 0 END) AS qty
            FROM assembly_qlty_inspeclist_mst
            WHERE created_at BETWEEN ? AND ?
            GROUP BY DATE(created_at)
        `, [fromDate, endDateTime]);

        const finalRejMap = {};
        finalRejRows.forEach(r => finalRejMap[dateKey(r.day)] = Number(r.qty || 0));

        /* =====================================================
           4. INPROCESS REWORK
        ===================================================== */

        const [inprocRewRows] = await conn.execute(`
            SELECT
                DATE_FORMAT(day, '%Y-%m-%d') AS day,
                SUM(qty) AS qty
            FROM (
                SELECT
                    DATE(created_at) AS day,
                    jcId,
                    itemId,
                    MAX(rejRewQty) AS qty
                FROM pm_inspeclist
                WHERE status = 'rework'
                AND created_at BETWEEN ? AND ?
                GROUP BY DATE(created_at), jcId, itemId
            ) x
            GROUP BY day
            ORDER BY day
        `, [fromDate, endDateTime]);

        const inprocRewMap = {};
        inprocRewRows.forEach(r => {
            inprocRewMap[r.day] = Number(r.qty || 0);
        });


        /* =====================================================
           5. FINAL REWORK
        ===================================================== */
        const [finalRewRows] = await conn.execute(`
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
                SUM(CASE WHEN status = 'rework' THEN rejRewQty ELSE 0 END) AS qty
            FROM assembly_qlty_inspeclist_mst
            WHERE created_at BETWEEN ? AND ?
            GROUP BY DATE(created_at)
        `, [fromDate, endDateTime]);

        const finalRewMap = {};
        finalRewRows.forEach(r => finalRewMap[dateKey(r.day)] = Number(r.qty || 0));

        /* =====================================================
           6. MERGE + DAILY + CUMULATIVE
        ===================================================== */
        let cummProd = 0;
        let cummInRej = 0;
        let cummFinRej = 0;
        let cummInRew = 0;
        let cummFinRew = 0;

        let totalInprocessRej = 0;
        let totalFinalRej = 0;
        let totalReworkOnly = 0;

        //  FULL DATE RANGE (FIX)
        const days = getDateRange(fromDate, toDate);

        const result = days.map(day => {
            const prodQty = prodMap[day] || 0;
            const inRej = inprocRejMap[day] || 0;
            const finRej = finalRejMap[day] || 0;
            const inRew = inprocRewMap[day] || 0;
            const finRew = finalRewMap[day] || 0;

            const totalRejection = inRej + finRej;
            const totalRework = inRew + finRew;
            const grandTotal = totalRejection + totalRework;

            cummProd += prodQty;
            cummInRej += inRej;
            cummFinRej += finRej;
            cummInRew += inRew;
            cummFinRew += finRew;

            totalInprocessRej += inRej;
            totalFinalRej += finRej;
            totalReworkOnly += totalRework;

            const cummTotalRejection = cummInRej + cummFinRej;
            const cummTotalRework = cummInRew + cummFinRew;
            const cummGrandTotal = cummTotalRejection + cummTotalRework;

            return {
                date: day,

                productionQty: prodQty,

                inprocessRej: inRej, //DshB
                finalRej: finRej,
                totalRejection,

                inprocessRework: inRew, //DshB
                finalRework: finRew,
                totalRework,

                grandTotal,

                inprocessPPM: cummProd ? Math.round((cummInRej / cummProd) * 1_000_000) : 0, //DshB
                finalPPM: cummProd ? Math.round((cummFinRej / cummProd) * 1_000_000) : 0,
                reworkPPM: cummProd ? Math.round((cummTotalRework / cummProd) * 1_000_000) : 0, //DshB
                totalPPM: cummProd ? +((cummGrandTotal / cummProd) * 100).toFixed(3) : 0,

                cummProduction: cummProd,

                cummInprocessRej: cummInRej,
                cummFinalRej: cummFinRej,
                cummTotalRejection,

                cummInprocessRework: cummInRew,
                cummFinalRework: cummFinRew,
                cummTotalRework,

                cummGrandTotal,
                cummTotalPPM: cummProd
                    ? Math.round((cummGrandTotal / cummProd) * 1_000_000)
                    : 0
            };
        });


        /* =====================================================
           7. TOTAL ROW
        ===================================================== */
        result.push({
            date: "TOTAL",

            productionQty: '',

            inprocessRej: totalInprocessRej,
            finalRej: totalFinalRej,
            totalRejection: '',

            inprocessRework: '',
            finalRework: '',
            totalRework: totalReworkOnly,

            grandTotal: '',

            inprocessPPM: '',
            finalPPM: '',
            reworkPPM: '',
            totalPPM: null,

            cummProduction: '',
            cummInprocessRej: '',
            cummFinalRej: '',
            cummTotalRejection: '',
            cummInprocessRework: '',
            cummFinalRework: '',
            cummTotalRework: '',
            cummGrandTotal: '',
            cummTotalPPM: ''
        });

        res.json({ success: true, data: result });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};



// exports.finalPPMRej = async (req, res) => {
//     try {
//         const { from, to } = req.body;

//         const sql = `
//             SELECT
//                 DATE_FORMAT(created_at, '%Y-%m') AS month,
//                 SUM(totQlty) AS totalProducedQty,
//                 SUM(CASE WHEN status = 'scrap' THEN rejRewQty ELSE 0 END) AS productionRejectedQty,
//                 ROUND(
//                     (SUM(CASE WHEN status = 'scrap' THEN rejRewQty ELSE 0 END)
//                     / NULLIF(SUM(totQlty), 0)) * 1000000
//                 , 0) AS productionPPM
//             FROM pm_inspeclist
//             WHERE DATE(created_at) BETWEEN ? AND ?
//             GROUP BY DATE_FORMAT(created_at, '%Y-%m')
//             ORDER BY month;
//         `;

//         const [rows] = await connection.execute(sql, [from, to]);

//         return handleSuccessResponse(res, 'Month-wise Production Reject PPM', rows);

//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };






// exports.finalPPMRew = async (req, res) => {
//     try {
//         const { from, to } = req.body;

//         const sql = `
//             SELECT
//                 DATE_FORMAT(created_at, '%Y-%m') AS month,
//                 SUM(totQlty) AS totalProducedQty,
//                 SUM(CASE WHEN status = 'rework' THEN rejRewQty ELSE 0 END) AS productionRejectedQty,
//                 ROUND(
//                     (SUM(CASE WHEN status = 'rework' THEN rejRewQty ELSE 0 END)
//                     / NULLIF(SUM(totQlty), 0)) * 1000000
//                 , 0) AS productionPPM
//             FROM pm_inspeclist
//             WHERE DATE(created_at) BETWEEN ? AND ?
//             GROUP BY DATE_FORMAT(created_at, '%Y-%m')
//             ORDER BY month;
//         `;

//         const [rows] = await connection.execute(sql, [from, to]);

//         return handleSuccessResponse(res, 'Month-wise Production Rework PPM', rows);

//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };

// exports.fpiYield = async (req, res) => {
//     try {
//         const { from, to } = req.body;

//         const sql = `
//       SELECT
//         DATE_FORMAT(sf.prod_date, '%d-%m-%Y') AS day,

//         COUNT(DISTINCT sf.jcId) AS producedCount,
//         SUM(IFNULL(pm.inspectionCount, 0)) AS inspectionCount,
//         SUM(IFNULL(pm.acceptedCount, 0)) AS accepted,

//         ROUND(
//           (SUM(IFNULL(pm.inspectionCount, 0)) /
//           NULLIF(COUNT(DISTINCT sf.jcId), 0)) * 100,
//           2
//         ) AS fpiPercentage,

//         ROUND(
//           (SUM(IFNULL(pm.acceptedCount, 0)) /
//           NULLIF(SUM(IFNULL(pm.inspectionCount, 0)), 0)) * 100,
//           2
//         ) AS yieldPercentage

//       FROM sf_schedule sf

//       LEFT JOIN (
//         SELECT
//           jcId,
//           COUNT(*) AS inspectionCount,
//           SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS acceptedCount
//         FROM pm_inspeclist
//         WHERE pmInnspecType = 'FPI'
//         GROUP BY jcId
//       ) pm ON pm.jcId = sf.jcId

//       WHERE sf.prod_date >= ?
//         AND sf.prod_date < DATE_ADD(?, INTERVAL 1 DAY)

//       GROUP BY DATE(sf.prod_date)
//       ORDER BY sf.prod_date;
//     `;

//         const [rows] = await connection.execute(sql, [from, to]);

//         return handleSuccessResponse(
//             res,
//             'Day-wise FPI & Yield',
//             rows
//         );

//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };


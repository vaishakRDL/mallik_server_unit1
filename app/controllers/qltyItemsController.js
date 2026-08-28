const { handleErrorResponse, handleSuccessResponse, connection, CustomError} = require('../config/dbSql');
const { generateDocNo, formatFinancialYears, updateDocCounter } = require('../utility/docNo');


    // LEFT JOIN 
    //             items_qlty_inspeclist_mst AS inspec 
    //             inspec.fim = ap.fim AND inspec.totQty = ap.Qty, AND inspec.itemId = items.id  AND inspec.date =  DATE_FORMAT(ap.created_at, '%d-%m-%Y') AS date

exports.showData = async (req, res) => {
    try {
        const qlty = req.body;

        let query = `
            SELECT 
                ap.itemCode, ap.Qty, ap.fim, ap.refNo, ap.itemId, ap.qcStatus, items.npdFile, 
                ap.id apId,   DATE_FORMAT(ap.created_at, '%d-%m-%Y') AS date, po.poNo,
                DATE_FORMAT(ap.shipmentDate, '%d-%m-%Y') AS shipmentDate
            FROM assembly_planning ap
            INNER JOIN items 
                ON ap.itemId = items.id
            LEFT JOIN purchas_order_item poi 
                ON items.itemCode = poi.PartNo 
                AND poi.pendQty > 0  
            LEFT JOIN purchase_order po 
                ON poi.purchase_order_id = po.id
            WHERE 
                DATE(ap.shipmentDate) = ?
        `;

        const queryParams = [qlty.date];

        // Add optional condition for `fim` if provided
        if (qlty.fim) {
            query += ` AND ap.fim = ?`;
            queryParams.push(qlty.fim);
        }

        query += ` GROUP BY ap.id ORDER BY poi.id ASC`;

        const [rows] = await connection.execute(query, queryParams);

        // Secondary query to fetch inspectionType
        const inspecQuery = `
            SELECT DISTINCT
                ivi.item, ivi.inspectionType
            FROM itempm_vs_inspec ivi
            WHERE  ivi.type = 'Assembly'
        `;
        const [inspectionData] = await connection.execute(inspecQuery);

        // Map inspectionType to the rows based on itemId and ivi.item
        rows.forEach((element, index) => {
            element.id = index + 1;
            element.sNo = index + 1;

            const match = inspectionData.find((inspection) => inspection.item === element.itemId);
            element.inspectionType = match ? match.inspectionType : null;
        });

        return res.status(200).json({
            success: true,
            message: "Items list",
            data: rows,
        });
    } catch (err) {
        console.error("Error fetching data:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "An error occurred while fetching data.",
        });
    }
};

exports.getTotQty = async ({ date, fim, item }) => {
  const query = `
    SELECT COALESCE(SUM(ap.Qty), 0) AS totalQty
    FROM assembly_planning ap
    WHERE DATE(ap.shipmentDate) = ? 
      AND ap.fim = ? 
      AND ap.itemId = ?
  `;

  const [rows] = await connection.execute(query, [date, fim, item]);
  return rows[0]?.totalQty || 0;
};

// Utility to convert DD-MM-YYYY → YYYY-MM-DD
function formatDateToMySQL(dateStr) {
  if (!dateStr) return null;
  const [day, month, year] = dateStr.split("-");
  return `${year}-${month}-${day}`;
}


exports.showType = async (req, res) => {
    try {
        const { item, type, qty, apId, fim, shipmentDate } = req.body;

        let sqlQuery;
        const cust = "OTIS";

        // Main query to fetch item details
        sqlQuery = `
            SELECT DISTINCT
                itmPm.item, itm.itemCode, machines.machineCode, machines.id AS machineId, 
                mst_pm.id AS operationId, mst_pm.name AS operation, inspec.status, inspec.addedBy
            FROM 
                itempm_vs_inspec itmPm   
            INNER JOIN 
                items AS itm ON itm.id = itmPm.item  
            INNER JOIN 
                mst_pm ON mst_pm.id = itmPm.process
            INNER JOIN 
                machines_vs_pm_uom ON machines_vs_pm_uom.machineOperator = itmPm.process      
            INNER JOIN 
                machines ON machines.machineCode = machines_vs_pm_uom.machineCode  
            LEFT JOIN 
                items_qlty_inspeclist_mst AS inspec 
                ON inspec.type = ? AND inspec.apId = ?
            WHERE 
                itmPm.dflag = 0 AND mst_pm.name = 'Assembly' AND  itmPm.item = ?`;

        // Execute the query using parameterized inputs
        const [rows] = await connection.execute(sqlQuery, [ type, apId, item]);

        if (rows.length === 0) {
            return res.status(200).json({ success: true, message: 'No data found', data: [] });
        }

        // Extract operationIds from rows
        const operationIds = rows.map(row => row.operationId);

        // If no operationIds are found, skip the next query
        if (operationIds.length === 0) {
            return res.status(200).json({ success: true, message: 'No operations found', data: [] });
        }

        const checkQuery = `
            SELECT 
              qcinspec.actualResult, qcMst.processId AS operationId
            FROM  
              items_qlty_inspeclist qcinspec
            INNER JOIN 
              items_qlty_inspeclist_mst AS qcMst ON qcMst.id = qcinspec.mstId  
            WHERE qcMst.type = ? AND qcMst.apId = ? 
            AND qcMst.processId IN (${operationIds.map(() => '?').join(', ')})`;

        // Execute the checkQuery to get actualResult data
        const [checkResults] = await connection.execute(checkQuery, [ type, apId, ...operationIds]);

        // console.log(checkResults)

        // //console.log(checkResults);
        const checkMap = {};
        checkResults.forEach(result => {
            if (!checkMap[result.operationId]) {
                checkMap[result.operationId] = [];
            }
            checkMap[result.operationId].push(result.actualResult);
        });


        // Second query to fetch inspection data
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
                ivi.type = 'Assembly' AND ivi.dflag = 0 AND ivi.item = ? 
            AND ivi.process IN (${operationIds.map(() => '?').join(', ')})`;

        const params = [item, ...operationIds];
        const [subRows] = await connection.execute(sqlQuery2, params);

        // Map inspections by operationId
        const inspectionMap = {};
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

        // Enhance rows and attach inspections
        rows.forEach((row, index) => {
            
            row.type = type;
            row.id = index + 1;
            row.sNo = index + 1;
            row.customer = cust;
            row.totalQty = qty;
            row.inspections = inspectionMap[row.operationId] || []; // Attach inspections or empty array
        });

        // Split rows into two arrays (example logic for splitting)
        const firstArray = rows.filter(row => row.machineCode === "MATCHING_MACHINE_CODE"); // Replace with your logic
        const lastArray = rows.filter(row => row.machineCode !== "MATCHING_MACHINE_CODE");

        // Construct response object
        const responseObject = {
            success: true,
            data: [...firstArray, ...lastArray]
        };

        // Send response
        res.status(200).json(responseObject);
    } catch (err) {
        console.error("Error in showType:", err);
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
            { docType: 'AssemblyFIMQC' }
        );

        await conn.commit();
        return res.status(200).json({
            qcTestNo: uniqueNo,
            snNo: padStartNo
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

const validateTolerance = (item) => {
    const actual = item.actualResult;

    // Skip validation if actual is not a number (e.g., "OK")
    if (isNaN(Number(actual))) return;

    const actualNum = Number(actual);
    const expected = Number(item.expVal);
    const maxTolerance = Number(item.maxTolerance);
    const minTolerance = Number(item.minTolerance);

    if ([expected, maxTolerance, minTolerance].some(val => isNaN(val))) {
        throw new CustomError(`Expected value or tolerance settings are invalid for ${item.qltyParameter}.`);
    }

    const upperBound = parseFloat((expected + maxTolerance).toFixed(2));
    const lowerBound = parseFloat((expected - minTolerance).toFixed(2));

    if (actualNum < lowerBound || actualNum > upperBound) {
        throw new CustomError(
            `Actual Result for ${item.qltyParameter} is not within allowed tolerance range (${lowerBound} - ${upperBound}).`
        );
    }
};

    
//   **************************************************          QUALITY REPORT                  *****************************************************  //



exports.submit = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const data = req.body;
        const user = req.headers.username;
        const variableData = data.qlty;

        // Check if the record already exists
        const [existingRecord] = await conn.execute(
            `SELECT id, status FROM items_qlty_inspeclist_mst 
             WHERE apId = ?`, [data.apId]
        );

        let mstId;

        if (existingRecord.length > 0) {
            const existingStatus = existingRecord[0].status;

            if (existingStatus === "rework" && data.status === "approved") {
                mstId = existingRecord[0].id;

                await conn.execute( 
                    `UPDATE items_qlty_inspeclist_mst
                        SET qcTestNo = ?, shipmentDate = ?, date = ?,  customer = ?, status = ?, reason = ?, remarks = ?, addedBy = ?
                        WHERE id = ?`,
                    [data.qcTestNo, data.shipmentDate, data.date,  data.customer, data.status, data.reason, data.remarks, user, mstId]
                );

                await conn.execute(`DELETE FROM assembly_qlty_inspeclist WHERE mstId = ?`, [mstId]);
            } else if (existingStatus !== "reworks") {
                await conn.rollback();
                return res.status(400).json({
                    success: false,
                    message: "Report already submitted. Update is not allowed.",
                });
            }
        } else {
            const [result] = await conn.execute(
                `INSERT INTO items_qlty_inspeclist_mst 
                 (qcTestNo, apId, type, date,  shipmentDate, customer, itemId, poNo, fim,  processId, machineId, totQty, rejRewQty, status, reason, remarks, addedBy)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.qcTestNo, data.apId, data.type, data.date, data.shipmentDate,  data.customer,
                    data.itemId,  data.poNo,  data.fim, data.operationId, data.machId, data.qty, data.rejRewQty ?? null,
                    data.status, data.reason, data.remarks, user
                ]
            );

            mstId = result.insertId;
        }

        // Prepare insert query
        const insertVariableDataQuery = `
            INSERT INTO items_qlty_inspeclist 
            (qltyParameter, expVal, maxTolerance, minTolerance, uomId, visual, evalutionMethod, actualResult, mstId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        // Insert all variable data
        for (const item of variableData) {
            if (data.status === 'approved') {
                validateTolerance(item); // This may throw and go to outer catch
            }

            await conn.execute(insertVariableDataQuery, [
                item.qltyParameter, item.expVal, item.maxTolerance, item.minTolerance,
                item.uomId, item.expVisInspec, item.evalMethod, item.actualResult, mstId
            ]);
        }

        await updateDocCounter(conn, 'AssemblyFIMQC');
        await conn.commit();
        return res.status(200).json({
            success: true,
            message: existingRecord.length > 0 ? "Data Updated Successfully" : "Data Added Successfully",
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};



exports.report = async (req, res) => {
    try {


        const { type, from, to } = req.body;


        // Construct the SQL query
        let sqlQuery = `
            SELECT 
                qcMst.id, qcMst.qcTestNo, qcMst.type, qcMst.status, qcMst.addedBy,
                mst_pm.code AS process, items.itemCode, mach.machineCode, ap.refNo,
                DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as date,
                qcMst.shipmentDate
            FROM 
                items_qlty_inspeclist_mst qcMst
            INNER JOIN 
                items ON qcMst.itemId = items.id  
            INNER JOIN 
                mst_pm ON mst_pm.id = qcMst.processId
            INNER JOIN 
                machines AS mach ON mach.id = qcMst.machineId
            INNER JOIN 
                assembly_planning AS ap ON ap.id = qcMst.apId    
            WHERE 
                qcMst.type = ?`;

        // Add conditions for 'from' and 'to' if they are provided
        const params = [type];

        // if (from && to && contractNo) {
        //     sqlQuery += ` AND DATE(qcMst.created_at) BETWEEN ? AND ? AND qcMst.contractNo = ?`;
        //     params.push(from, to, contractNo);

        // } else 
        
        if (from && to) {
            sqlQuery += ` AND DATE(qcMst.created_at) BETWEEN ? AND ?`;
            params.push(from, to);

        } else {
            sqlQuery += ` AND DATE(qcMst.created_at) = CURDATE()`;
        }

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, params);

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
        res.status(500).json({ success: false, message: 'An error occurred', error: err.message });
    }
};




exports.reportView = async (req, res) => {
    try {
        const { id } = req.params;

        // Construct the SQL query
        const sqlQuery = `
            SELECT 
                qcInspec.*,
                mach.machineCode, mst_pm.code as process, mst_uom.code as uom,
                itm.itemCode, itm.itemName, 
                qcMst.customer, qcMst.qcTestNo, qcMst.addedBy,
                qcMst.totQty, DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') as date
            FROM 
                items_qlty_inspeclist qcInspec
                INNER JOIN items_qlty_inspeclist_mst AS qcMst ON qcMst.id = qcInspec.mstId

                INNER JOIN items AS itm ON itm.id = qcMst.itemId 
                INNER JOIN mst_pm ON mst_pm.id = qcMst.processId
                INNER JOIN machines AS mach ON mach.id = qcMst.machineId
                INNER JOIN mst_uom ON mst_uom.id = qcInspec.uomId
            WHERE 
               qcMst.id = ?;`;

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery,[id]);

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



exports.rejected = async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;

        //  Base SQL Query (no semicolon here so we can append conditions)
        let sqlQuery = `
            SELECT 
                qcMst.id,
                qcMst.itemId,
                qcMst.addedBy,
                qcMst.totQty AS Qty,
                qcMst.rejRewQty,
                qcMst.remarks,
                items.itemCode,
                mach.machineCode,
                DATE_FORMAT(qcMst.created_at, '%d-%m-%Y') AS date,
                DATE_FORMAT(qcMst.shipmentDate, '%d-%m-%Y') AS shipmentDate
            FROM 
                items_qlty_inspeclist_mst AS qcMst
            INNER JOIN 
                machines AS mach ON mach.id = qcMst.machineId
            INNER JOIN 
                items ON qcMst.itemId = items.id
            WHERE 
                qcMst.status = 'scrap'
        `;

        const params = [];

        //  Add date filter if both dates are provided
        if (fromDate && toDate) {
            sqlQuery += ` AND DATE(qcMst.created_at) BETWEEN ? AND ?`;
            params.push(fromDate, toDate);
        }

        //  Execute query
        const [rows] = await connection.execute(sqlQuery, params);

        //  Add serial number
        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return res.status(200).json({
            success: true,
            message: "Rejected Scrap Items List",
            data: rows
        });

    } catch (err) {
        console.error("Error in rejected():", err);
        return res.status(500).json({
            success: false,
            message: err.message || "An error occurred while fetching rejected data"
        });
    }
};


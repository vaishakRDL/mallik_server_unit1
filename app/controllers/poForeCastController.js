const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { generateDocNo, formatFinancialYears, updateDocCounter } = require('../utility/docNo');

exports.uniqueId = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        await conn.beginTransaction();

        const { padStartNo, uniqueNo } = await generateDocNo(conn, req, { docType: 'ForecastEntry' });

        await conn.commit();
        return res.status(200).json({
            id: uniqueNo,
            digit: padStartNo
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.getSupp = async (req, res) => {
    try {
        const fetch = `
            SELECT DISTINCT
                sup.id,
                sup.spCode,
                sup.spName,
                sup.sId,
                CONCAT(
                    sup.spAdd1, ' ',
                    sup.spAdd2, ' ',
                    sup.spAdd3, ' ',
                    sup.spAdd4
                ) AS spAddress,
                cur.name AS currency,
                cur.id AS currencyId,
                supCon.department
            FROM supplier AS sup
                INNER JOIN supp_vs_item AS svi 
                    ON svi.spName = sup.id
                INNER JOIN mst_currency AS cur 
                    ON sup.currency = cur.id
                LEFT JOIN sup_con_person AS supCon 
                    ON sup.sId = supCon.sId
            WHERE sup.dflag = 0
            ORDER BY sup.spName
        `;

        const [results] = await connection.query(fetch);
        return handleSuccessResponse(res, "Supplier list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.searchSup = async (req, res) => {
    try {
        const { q } = req.query;

        let fetch = `
            SELECT DISTINCT
                sup.id,
                sup.spName AS label,
                sup.spCode,
                CONCAT(
                    sup.spAdd1, ' ',
                    sup.spAdd2, ' ',
                    sup.spAdd3, ' ',
                    sup.spAdd4
                ) AS spAddress,
                sup.country,
                sup.state,
                sup.sId,
                cur.name AS currency,
                cur.id AS currencyId
            FROM supplier AS sup
                INNER JOIN supp_vs_item AS svi 
                    ON sup.id = svi.spName
                INNER JOIN mst_currency AS cur 
                    ON sup.currency = cur.id
            WHERE svi.IsFcItem = 'Y'
              AND sup.dflag = 0
        `;

        const params = [];

        if (q) {
            fetch += ` AND sup.spName LIKE ?`;
            params.push(`${q}%`);
        }

        fetch += `
            ORDER BY sup.spName
            LIMIT 50
        `;

        const [results] = await connection.query(fetch, params);
        return handleSuccessResponse(res, "SupplierList", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

const calculateCons = async (itemId, day) => {
    const query = `
        SELECT 
            jwDtl.id, jwDtl.Qty AS sfgQty 
        FROM 
            jobwork_issue_details jwDtl WHERE itemId = ?
    `;

    const [rows] = await connection.execute(query, [itemId]);

    let dcQty = 50;
    let consumptionQty = 10;

    if (rows && rows.length > 0) {
        dcQty = parseInt(rows[0].sfgQty) || 0;
        consumptionQty = dcQty / day;
    }

    return consumptionQty;
};

exports.getItems = async (req, res) => {
    try {
        const { id } = req.params;   // supplier id
        const { day } = req.body;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Supplier id is required"
            });
        }

        const fetch = `
            SELECT 
                i.id, i.id AS itemId, i.itemCode, i.itemName, i.minStockLvl, i.stdRate, i.maxLvl, i.totStk,
                uomTab.name AS uom, uomTab.id AS uomId, ledj.name AS itemsLedger, ledj.id AS itemsLedgerId,
                loc.name AS location, loc.id AS locationId, itemsGrp.name AS itemGroup, itemsGrp.id AS itemGroupId,
                poFcDtl.lastPurQty, poFcDtl.lastGrnQty
            FROM items i
                INNER JOIN supp_vs_item AS supItm 
                    ON i.id = supItm.itemName
                INNER JOIN mst_uom AS uomTab 
                    ON i.uom = uomTab.id
                INNER JOIN item_under_ledger AS ledj 
                    ON i.underLedger = ledj.id
                INNER JOIN item_main_loc AS loc 
                    ON i.mainLocation = loc.id
                INNER JOIN mst_item_group AS itemsGrp 
                    ON i.itemGroup = itemsGrp.id
                LEFT JOIN po_forecast_dtl AS poFcDtl 
                    ON poFcDtl.itemId = i.id
            WHERE i.dflag = 0
              AND supItm.IsFcItem = 'Y' AND supItm.spName = ?
        `;

        const [rows] = await connection.query(fetch, [id]);

        const data = await Promise.all(
            rows.map(async (row, index) => ({
                ...row,
                sNo: index + 1,
                consumptionQty: await calculateCons(row.itemId, day)
            }))
        );

        return handleSuccessResponse(res, "Items List", data);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const fcArray = req.body;

        await conn.beginTransaction();

        const uniqueDigitMap = new Map();

        const insertDtlQuery = `
            INSERT INTO po_forecast_dtl (
                uniqueDigit, uniqueId, date, supId, itemId, itemCode, itemName, uom, uomId, maxLvl, consumptionQty, qoh, fcQty,
                lastPurQty, lastGrnQty, fcRemarks
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const insertMainQuery = `
            INSERT INTO po_forecast (
                uniqueDigit, uniqueId, supId, fromConsumptionDate, toConsumptionDate, consumptionInDays,
                planDateFrom, planDateTo, requiredPercentage, specialInstruction
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const po of fcArray) {
            await conn.query(insertDtlQuery, [
                po.uniqueDigit, po.uniqueId, po.date, po.supId, po.itemId, po.itemCode, po.itemName, po.uom, po.uomId, po.maxLvl,
                po.consumptionQty, po.qoh, po.fcQty, po.lastPurQty, po.lastGrnQty, po.fcRemarks
            ]);

            if (!uniqueDigitMap.has(po.uniqueDigit)) {
                uniqueDigitMap.set(po.uniqueDigit, true);

                await conn.query(insertMainQuery, [
                    po.uniqueDigit, po.uniqueId, po.supId, po.fromConsumptionDate, po.toConsumptionDate, po.consumptionInDays, po.planDateFrom, po.planDateTo,
                    po.requiredPercentage, po.specialInstruction
                ]);
            }
        }

        await updateDocCounter(conn, 'ForecastEntry');
        await conn.commit();

        return handleSuccessResponse(res, "Data Added Successfully");

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.update = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const fcArray = req.body;

        await conn.beginTransaction();

        const processedDigits = new Set();

        const updateDetailQuery = `
            UPDATE po_forecast_dtl SET 
                date = ?, 
                supId = ?, 
                maxLvl = ?, 
                consumptionQty = ?, 
                qoh = ?, 
                fcQty = ?, 
                lastPurQty = ?, 
                lastGrnQty = ?, 
                fcRemarks = ?
            WHERE uniqueDigit = ? AND itemId = ?
        `;

        const updateMainQuery = `
            UPDATE po_forecast SET 
                date = ?, 
                supId = ?, 
                department = ?, 
                fromConsumptionDate = ?, 
                toConsumptionDate = ?, 
                consumptionInDays = ?, 
                planDateFrom = ?, 
                planDateTo = ?, 
                requiredPercentage = ?, 
                specialInstruction = ?
            WHERE uniqueDigit = ?
        `;

        for (const po of fcArray) {
            await conn.query(updateDetailQuery, [
                po.date,
                po.supId,
                po.maxLvl,
                po.consumptionQty,
                po.qoh,
                po.fcQty,
                po.lastPurQty,
                po.lastGrnQty,
                po.fcRemarks,
                po.uniqueDigit,
                po.itemId
            ]);

            if (!processedDigits.has(po.uniqueDigit)) {
                processedDigits.add(po.uniqueDigit);

                await conn.query(updateMainQuery, [
                    po.date,
                    po.supId,
                    po.department,
                    po.fromConsumptionDate,
                    po.toConsumptionDate,
                    po.consumptionInDays,
                    po.planDateFrom,
                    po.planDateTo,
                    po.requiredPercentage,
                    po.specialInstruction,
                    po.uniqueDigit
                ]);
            }
        }

        await conn.commit();
        return handleSuccessResponse(res, "Data Updated Successfully");

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.delete = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { id } = req.params;

        await conn.beginTransaction();

        const deleteDtlQuery = `
            DELETE FROM po_forecast_dtl 
            WHERE uniqueDigit = ?
        `;
        await conn.query(deleteDtlQuery, [id]);

        const deleteMainQuery = `
            DELETE FROM po_forecast 
            WHERE uniqueDigit = ?
        `;
        await conn.query(deleteMainQuery, [id]);

        await conn.commit();
        return handleSuccessResponse(res, "Successfully deleted");

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.showData = async (req, res) => {
    try {
        const fetch = `
            SELECT 
                pf.*, 
                sup.spCode, 
                sup.spName AS suppName, 
                sup.id AS supId,
                DATE_FORMAT(pf.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(pf.created_at, '%d-%m-%Y %H:%i:%s') AS created_at
            FROM po_forecast pf
                INNER JOIN supplier AS sup ON pf.supId = sup.id
            WHERE pf.dflag = 0
            ORDER BY pf.id DESC
        `;

        const [results] = await connection.query(fetch);

        results.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return handleSuccessResponse(res, "ForeCast Entry List", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.viewDtl = async (req, res) => {
    try {
        const { digit } = req.body;

        if (!digit) {
            return res.status(400).json({
                success: false,
                message: "uniqueDigit is required"
            });
        }

        const fetch = `
            SELECT 
                po_forecast.*, 
                fcDtl.*, 
                sup.spCode, 
                sup.spName AS suppName, 
                sup.id AS supId,
                CONCAT(
                    sup.spAdd1, ' ',
                    sup.spAdd2, ' ',
                    sup.spAdd3, ' ',
                    sup.spAdd4
                ) AS spAddress,
                DATE_FORMAT(po_forecast.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(po_forecast.created_at, '%d-%m-%Y %H:%i:%s') AS created_at
            FROM po_forecast
                INNER JOIN supplier AS sup 
                    ON po_forecast.supId = sup.id
                INNER JOIN po_forecast_dtl AS fcDtl 
                    ON po_forecast.uniqueDigit = fcDtl.uniqueDigit
            WHERE po_forecast.uniqueDigit = ?
              AND po_forecast.dflag = 0
        `;

        const [results] = await connection.query(fetch, [digit]);
        return handleSuccessResponse(res, "Forecast Entry list", results);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.getPoItems = async (req, res) => {
    try {
        const { type, id } = req.query;
        const { fyFrom, fyTo } = formatFinancialYears(req);

        if ((type === 'forward' || type === 'reverse') && (!id || id === '')) {
            return handleSuccessResponse(res, "Success", []);
        }

        let mainIdQuery = '';
        let queryParams = [];

        switch (type) {
            case 'first':
                mainIdQuery = `
                    SELECT MIN(po.id) AS mainId
                    FROM po_forecast AS po
                    WHERE po.dflag = 0
                `;
                break;

            case 'last':
                mainIdQuery = `
                    SELECT MAX(po.id) AS mainId
                    FROM po_forecast AS po
                    WHERE po.dflag = 0
                `;
                break;

            case 'forward':
                mainIdQuery = `
                    SELECT MIN(po.id) AS mainId
                    FROM po_forecast AS po
                    WHERE po.dflag = 0 AND po.id > ?
                `;
                queryParams = [id];
                break;

            case 'reverse':
                mainIdQuery = `
                    SELECT MAX(po.id) AS mainId
                    FROM po_forecast AS po
                    WHERE po.dflag = 0 AND po.id < ?
                `;
                queryParams = [id];
                break;
        }
        mainIdQuery += ` AND date(po.created_at) BETWEEN ? AND ?`;
        queryParams.push(fyFrom, fyTo);

        const [mainIdRows] = await connection.execute(mainIdQuery, queryParams);
        const mainId = mainIdRows[0]?.mainId;

        if (!mainId) {
            return handleSuccessResponse(res, "No record found", []);
        }

        const itemsQuery = `
            SELECT po_forecast.*, fcDtl.*, po_forecast.id AS mainId, 
                sup.spCode, sup.spName AS suppName, sup.id AS supId,
                CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,
                DATE_FORMAT(po_forecast.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(po_forecast.created_at, '%d-%m-%Y %H:%i:%s') AS created_at
            FROM po_forecast
                INNER JOIN supplier as sup ON po_forecast.supId = sup.id
                INNER JOIN po_forecast_dtl as fcDtl ON po_forecast.uniqueDigit = fcDtl.uniqueDigit
            WHERE po_forecast.dflag = 0 AND po_forecast.id = ?
            GROUP BY fcDtl.itemId
            ORDER BY fcDtl.id ASC
        `;

        const [rows] = await connection.execute(itemsQuery, [mainId]);
        return handleSuccessResponse(res, "Success", rows);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.report = async (req, res) => {
    try {
        const repo = req.body;
        const fromDate = repo.from;
        const toDate = repo.to;
        const supplier = repo.supplier;

        let query = `   
            SELECT
                fc.id, fc.uniqueId, fcDtl.uom, fcDtl.fcQty, sup.spCode, sup.spName AS suppName, 
                i.itemCode, i.itemName, i.id AS itemId, itmGrp.name AS itemGroup, loc.name AS location
            FROM po_forecast fc
                INNER JOIN supplier as sup ON fc.supId = sup.id
                INNER JOIN po_forecast_dtl as fcDtl ON fc.uniqueDigit = fcDtl.uniqueDigit
                INNER JOIN items as i ON i.id = fcDtl.itemId
                INNER JOIN mst_item_group as itmGrp ON i.itemGroup = itmGrp.id
                LEFT JOIN item_main_loc AS loc ON i.mainLocation = loc.id            
        `;

        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(fc.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(supplier) && supplier.length > 0) {
            conditions.push(`sup.id IN (${supplier.map(() => '?').join(', ')})`);
            queryParams.push(...supplier);
        }

        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        const [result] = await connection.execute(query, queryParams);
        return handleSuccessResponse(res, "FC Items list", result);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.poFcReport = async (req, res) => {
    try {
        const repo = req.body;
        const fromDate = repo.from;
        const toDate = repo.to;
        const sup = repo.supplier;
        const category = repo.category;

        let query;

        if (category == 0) {
            query = `   
            SELECT 
                po.id, DATE_FORMAT(po.date, '%d-%m-%Y') AS poDate, po.poNo, sup.spName, sup.spCode, sup.id AS supplierId, 
                po.poQty, i.itemCode, i.itemName, uom.code As uom, loc.name As location, ig.code As itemGroup
            FROM 
                po_generate po
            INNER JOIN 
                supplier as sup ON po.spName = sup.id
            INNER JOIN 
                items as i ON i.id = po.itemName    
            INNER JOIN 
                mst_item_group as ig ON ig.id = i.itemGroup 
            INNER JOIN 
                mst_uom as uom ON uom.id = i.uom     
            INNER JOIN 
                item_main_loc as loc ON loc.id = i.mainLocation         
            WHERE 
                po.dflag = 0
            `;
        } else {
            query = `   
            SELECT 
                po.id, po.fcQty, po.uniqueId As poNo, sup.spName, sup.spCode, sup.id AS supplierId, 
                i.itemCode, i.itemName, uom.code As uom, loc.name As location, ig.code As itemGroup
            FROM 
                po_forecast_dtl po
            INNER JOIN 
                supplier as sup ON po.supId = sup.id
            INNER JOIN 
                items as i ON i.id = po.itemId    
            INNER JOIN 
                mst_item_group as ig ON ig.id = i.itemGroup 
            INNER JOIN 
                mst_uom as uom ON uom.id = i.uom     
            INNER JOIN 
                item_main_loc as loc ON loc.id = i.mainLocation         
            WHERE 
                po.dflag = 0
            `;
        }

        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(po.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(sup) && sup.length > 0) {
            conditions.push(`sup.id IN (${sup.map(() => '?').join(', ')})`);
            queryParams.push(...sup);
        }

        if (conditions.length) {
            query += ' AND ' + conditions.join(' AND ');
        }

        const [rows] = await connection.execute(query, queryParams);

        rows.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return handleSuccessResponse(res, "Po Vs Fc Summary", rows);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


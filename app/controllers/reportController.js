const { handleErrorResponse, connection, handleSuccessResponse, CustomError } = require('../config/dbSql');
const moment = require("moment-timezone");

exports.planReport = async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;

        // Fetching CSL master records within the date range where the product is not null
        const [cslMstRows] = await connection.execute(`
            SELECT id, contractNo, product 
            FROM csl_mst
            WHERE date(created_at) >= ? AND date(created_at) <= ? AND product IS NOT NULL
        `, [fromDate, toDate]);

        // Extract unique products
        const products = Array.from(new Set(cslMstRows.map(item => item.product)));
        products.unshift('Kanban');

        // Object to store kanban dates and corresponding product counts
        const kanbanDates = {};

        // Creating an array of promises to execute all queries concurrently
        const kanbanDatePromises = cslMstRows.map(async (item) => {
            const [rows] = await connection.execute(`
                SELECT sb.id, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
                FROM sob_mst sb
                INNER JOIN order_plannings op ON op.sobMstId = sb.id
                WHERE FIND_IN_SET(?, sb.contractNos) > 0
                LIMIT 1
            `, [item.contractNo]);

            if (rows.length) {
                const { kanbanDate } = rows[0];

                if (!kanbanDates[kanbanDate]) {
                    // Initialize kanbanDate with all products set to zero
                    kanbanDates[kanbanDate] = {};
                    products.slice(1).forEach(product => {
                        kanbanDates[kanbanDate][product] = 0;
                    });
                }
                if (!kanbanDates[kanbanDate][item.product]) {
                    kanbanDates[kanbanDate][item.product] = 0;
                }
                kanbanDates[kanbanDate][item.product]++;
            }
        });

        // Wait for all queries to finish
        await Promise.all(kanbanDatePromises);

        // Transform kanbanDates object into an array of objects
        const formattedResponse = Object.keys(kanbanDates).map((kanbanDate, index) => ({
            id: index + 1,
            Kanban: kanbanDate,
            ...kanbanDates[kanbanDate]
        }));

        return res.status(200).json({
            success: true,
            message: 'Plan reports',
            products: products,
            data: formattedResponse
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

function getWeekNumber(date) {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDays = (date - startOfYear) / (24 * 60 * 60 * 1000);
    return Math.ceil((pastDays + startOfYear.getDay() + 1) / 7);
}

function getWeekNumbersBetween(startDate, endDate) {
    let weeks = new Set();
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        weeks.add(getWeekNumber(new Date(currentDate)));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return [...weeks];
}

function getMonthNumbersBetween(startDate, endDate) {
    let months = new Set();
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        months.add(currentDate.getMonth() + 1); // Months are 0-indexed, so add 1
        currentDate.setMonth(currentDate.getMonth() + 1);
    }

    return [...months];
}

function getPeriodsBetween(type, startDate, endDate) {
    if (type.toLowerCase() === "week") {
        return getWeekNumbersBetween(startDate, endDate);
    } else if (type.toLowerCase() === "month") {
        return getMonthNumbersBetween(startDate, endDate);
    } else {
        throw new Error("Invalid type. Use 'week' or 'month'.");
    }
}

const getItemsBySuppliers = async (items, suppliers) => {
    if (!suppliers.length) return items;

    const [supplierRows] = await connection.execute(`
        SELECT s.itemName as itemId 
        FROM supp_vs_item s
        WHERE s.spName IN (${suppliers.map(() => '?').join(',')})
    `, suppliers);

    return [...new Set([...items, ...supplierRows.map(sp => sp.itemId)])];
}

const getHeaderKeys = (isWeek, dataObj) => {
    if (!dataObj) return [];

    const today = new Date();
    const formattedDate = today.toLocaleDateString('en-GB').split('/').join('-'); // "dd-mm-yyyy"
    const dateSuffix = formattedDate.slice(0, 10); // to match "28-05-25" if using two-digit year

    const months = new Set([
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ]);

    const periodHeaders = Object.keys(dataObj)
        .filter(key => key.startsWith("Week") || months.has(key))
        .reduce((acc, period) => {
            acc[period] = isWeek ? `Week ${period.replace("Week", "")}` : period;
            return acc;
        }, {});

    const headerMapping = {
        itemGroup: "Item Group",
        itemCode: "Item Code",
        itemName: "Item Name",
        location: "Location",
        stdRate: "Standard Rate",
        productFamily: "Product Family",
        ...periodHeaders,
        totStk: `Stk On Hnad ${dateSuffix}`,
        avgQty: "Average Quantity",
        highestQty: "Highest Quantity",
        totalQty: "Total Quantity"
    };

    return headerMapping;
}

// exports.consumptionTrend = async (req, res) => {
//     try {
//         const {
//             fromDate,
//             toDate,
//             type,
//             items = [],
//             itemGroups = [],
//             locations = [],
//             suppliers = []
//         } = req.body;

//         const isWeek = type.toLowerCase() === "week";

//         // 1. Convert user selected dates (Asia/Kolkata) → UTC
//         const startUTC = moment.tz(fromDate + " 00:00:00", "Asia/Kolkata")
//             .utc()
//             .format("YYYY-MM-DD HH:mm:ss");

//         const endUTC = moment.tz(toDate + " 23:59:59", "Asia/Kolkata")
//             .utc()
//             .format("YYYY-MM-DD HH:mm:ss");

//         // 2. Week/Month Grouping using Asia/Kolkata timezone
//         const timeGrouping = isWeek
//             ? `WEEK(CONVERT_TZ(s.created_at, '+00:00', '+05:30'), 1) AS weekNumber`
//             : `
//                 DATE_FORMAT(CONVERT_TZ(s.created_at, '+00:00', '+05:30'), '%M') AS monthName,
//                 MONTH(CONVERT_TZ(s.created_at, '+00:00', '+05:30')) AS monthNumber
//             `;

//         let query = `
//             SELECT 
//                 i.itemCode,
//                 i.itemName,
//                 ig.name AS itemGroup,
//                 loc.name AS location,
//                 latest.totQty AS totStk,
//                 pf.name AS productFamily,
//                 SUM(s.outwardQty) AS totalQty,
//                 YEAR(CONVERT_TZ(s.created_at, '+00:00', '+05:30')) AS year,
//                 ${timeGrouping}
//             FROM store s

//             INNER JOIN items i ON i.id = s.itemId

//             LEFT JOIN (
//                 SELECT st.itemId, st.totQty
//                 FROM store st
//                 INNER JOIN (
//                     SELECT itemId, MAX(created_at) AS max_date
//                     FROM store
//                     GROUP BY itemId
//                 ) latest_st 
//                 ON st.itemId = latest_st.itemId 
//                 AND st.created_at = latest_st.max_date
//             ) latest ON latest.itemId = i.id

//             LEFT JOIN mst_item_group ig ON ig.id = i.itemGroup
//             LEFT JOIN item_main_loc loc ON loc.id = i.mainLocation
//             LEFT JOIN item_product_family pf ON pf.id = i.productFamily

//             WHERE s.docType = ?
//             AND s.created_at BETWEEN ? AND ?
//         `;

//         let values = ["Material Issue", startUTC, endUTC];

//         // 3. Filter using supplier → item mapping
//         const itemsIds = await getItemsBySuppliers(items, suppliers);

//         if (itemsIds.length === 0 && (items.length || suppliers.length)) {
//             return handleSuccessResponse(
//                 res,
//                 `${isWeek ? "Week-wise" : "Month-wise"} Consumption Report`,
//                 []
//             );
//         }

//         if (itemsIds.length) {
//             query += ` AND i.id IN (${itemsIds.map(() => "?").join(",")})`;
//             values.push(...itemsIds);
//         }

//         if (itemGroups.length) {
//             query += ` AND i.itemGroup IN (${itemGroups.map(() => "?").join(",")})`;
//             values.push(...itemGroups);
//         }

//         if (locations.length) {
//             query += ` AND i.mainLocation IN (${locations.map(() => "?").join(",")})`;
//             values.push(...locations);
//         }

//         query += `
//             GROUP BY i.itemCode, year, ${isWeek ? "weekNumber" : "monthNumber"}
//             ORDER BY year, ${isWeek ? "weekNumber" : "monthNumber"}
//         `;

//         const [rows] = await connection.execute(query, values);

//         // 4. Generate dynamic week/month period keys
//         const periods = getPeriodsBetween(type, new Date(fromDate), new Date(toDate));

//         const periodObj = Object.fromEntries(
//             periods.map(period => [
//                 isWeek
//                     ? `Week${period}`
//                     : new Intl.DateTimeFormat("en-US", { month: "long" }).format(
//                         new Date(2024, period - 1)
//                     ),
//                 0
//             ])
//         );

//         const result = new Map();

//         rows.forEach((row, index) => {
//             const key = row.itemCode;

//             if (!result.has(key)) {
//                 result.set(key, {
//                     id: index + 1,
//                     itemGroup: row.itemGroup,
//                     itemCode: row.itemCode,
//                     itemName: row.itemName,
//                     location: row.location,
//                     stdRate: row.stdRate,
//                     productFamily: row.productFamily,
//                     ...periodObj,
//                     totStk: row.totStk,
//                     avgQty: 0,
//                     highestQty: 0,
//                     totalQty: 0,
//                     nonZeroPeriods: 0
//                 });
//             }

//             const item = result.get(key);
//             const periodKey = isWeek ? `Week${row.weekNumber}` : row.monthName;

//             const qty = Number(row.totalQty);

//             item[periodKey] += qty;
//             item.highestQty = Math.max(item.highestQty, qty);
//             item.totalQty += qty;

//             if (qty > 0) item.nonZeroPeriods += 1;
//         });

//         // 5. Calculate average usage per active period
//         result.forEach(item => {
//             item.avgQty = item.nonZeroPeriods
//                 ? Math.round(item.totalQty / item.nonZeroPeriods)
//                 : 0;

//             delete item.nonZeroPeriods;
//         });

//         const consumptionTrend = Array.from(result.values());
//         const headers = getHeaderKeys(isWeek, consumptionTrend[0]);

//         return res.status(200).json({
//             success: true,
//             message: `${isWeek ? "Week-wise" : "Month-wise"} Consumption Report`,
//             headers,
//             data: consumptionTrend
//         });
//     } catch (err) {
//         return handleErrorResponse(res, err);
//     }
// };

exports.consumptionTrend = async (req, res) => {
    try {
        const {
            fromDate,
            toDate,
            type,
            items = [],
            itemGroups = [],
            locations = [],
            suppliers = []
        } = req.body;

        const isWeek = type.toLowerCase() === "week";

        // ✅ Convert IST → UTC
        const startUTC = moment.tz(fromDate + " 00:00:00", "Asia/Kolkata")
            .utc()
            .format("YYYY-MM-DD HH:mm:ss");

        const endUTC = moment.tz(toDate + " 23:59:59", "Asia/Kolkata")
            .utc()
            .format("YYYY-MM-DD HH:mm:ss");

        // ✅ Time grouping (use alias later)
        const timeGrouping = isWeek
            ? `WEEK(local_created_at, 1) AS weekNumber`
            : `
                DATE_FORMAT(local_created_at, '%M') AS monthName,
                MONTH(local_created_at) AS monthNumber
            `;

        let query = `
            SELECT 
                i.itemCode,
                i.itemName,
                ig.name AS itemGroup,
                loc.name AS location,
                i.stdRate AS stdRate,
                latest.totQty AS totStk,
                pf.name AS productFamily,
                SUM(s.outwardQty) AS totalQty,
                YEAR(local_created_at) AS year,
                ${timeGrouping}
            FROM (
                SELECT 
                    s.*,
                    CONVERT_TZ(s.created_at, '+00:00', '+05:30') AS local_created_at
                FROM store s
                WHERE s.docType = ?
                AND s.created_at BETWEEN ? AND ?
            ) s

            INNER JOIN items i ON i.id = s.itemId

            -- ✅ Optimized latest stock (uses MAX(id))
            LEFT JOIN (
                SELECT st.itemId, st.totQty
                FROM store st
                INNER JOIN (
                    SELECT itemId, MAX(id) AS max_id
                    FROM store
                    GROUP BY itemId
                ) latest_st 
                ON st.itemId = latest_st.itemId 
                AND st.id = latest_st.max_id
            ) latest ON latest.itemId = i.id

            LEFT JOIN mst_item_group ig ON ig.id = i.itemGroup
            LEFT JOIN item_main_loc loc ON loc.id = i.mainLocation
            LEFT JOIN item_product_family pf ON pf.id = i.productFamily

            WHERE 1 = 1
        `;

        let values = ["Material Issue", startUTC, endUTC];

        // ✅ Supplier → Item mapping
        const itemsIds = await getItemsBySuppliers(items, suppliers);

        if (itemsIds.length === 0 && (items.length || suppliers.length)) {
            return handleSuccessResponse(
                res,
                `${isWeek ? "Week-wise" : "Month-wise"} Consumption Report`,
                []
            );
        }

        if (itemsIds.length) {
            query += ` AND i.id IN (${itemsIds.map(() => "?").join(",")})`;
            values.push(...itemsIds);
        }

        if (itemGroups.length) {
            query += ` AND i.itemGroup IN (${itemGroups.map(() => "?").join(",")})`;
            values.push(...itemGroups);
        }

        if (locations.length) {
            query += ` AND i.mainLocation IN (${locations.map(() => "?").join(",")})`;
            values.push(...locations);
        }

        // ✅ Strict GROUP BY
        query += `
            GROUP BY 
                i.id,
                i.itemCode,
                i.itemName,
                ig.name,
                loc.name,
                pf.name,
                i.stdRate,
                year,
                ${isWeek ? "weekNumber" : "monthNumber"}
            ORDER BY year, ${isWeek ? "weekNumber" : "monthNumber"}
        `;

        const [rows] = await connection.execute(query, values);

        // ✅ Generate periods
        const periods = getPeriodsBetween(type, new Date(fromDate), new Date(toDate));

        const periodObj = Object.fromEntries(
            periods.map(period => [
                isWeek
                    ? `Week${period}`
                    : new Intl.DateTimeFormat("en-US", { month: "long" }).format(
                        new Date(2024, period - 1)
                    ),
                0
            ])
        );

        const result = new Map();

        rows.forEach((row, index) => {
            const key = row.itemCode;

            if (!result.has(key)) {
                result.set(key, {
                    id: index + 1,
                    itemGroup: row.itemGroup,
                    itemCode: row.itemCode,
                    itemName: row.itemName,
                    location: row.location,
                    stdRate: row.stdRate,
                    productFamily: row.productFamily,
                    ...periodObj,
                    totStk: row.totStk,
                    avgQty: 0,
                    highestQty: 0,
                    totalQty: 0,
                    nonZeroPeriods: 0
                });
            }

            const item = result.get(key);
            const periodKey = isWeek ? `Week${row.weekNumber}` : row.monthName;

            const qty = Number(row.totalQty);

            item[periodKey] += qty;
            item.highestQty = Math.max(item.highestQty, qty);
            item.totalQty += qty;

            if (qty > 0) item.nonZeroPeriods += 1;
        });

        // ✅ Average calculation
        result.forEach(item => {
            item.avgQty = item.nonZeroPeriods
                ? Math.round(item.totalQty / item.nonZeroPeriods)
                : 0;

            delete item.nonZeroPeriods;
        });

        const consumptionTrend = Array.from(result.values());
        const headers = getHeaderKeys(isWeek, consumptionTrend[0]);

        return res.status(200).json({
            success: true,
            message: `${isWeek ? "Week-wise" : "Month-wise"} Consumption Report`,
            headers,
            data: consumptionTrend
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

const itemConsumtions = async (items, consumptionDay, docType = 'Material Issue') => {
    let consQuery = `
        SELECT 
            s.itemCode, 
            SUM(s.outwardQty) AS totalCons, 
            sp.spCode AS supplier
        FROM store s
        LEFT JOIN po_bill_dtl po 
            ON po.itemName = s.itemId 
            AND po.id = (
                SELECT po2.id FROM po_bill_dtl po2 
                WHERE po2.itemName = s.itemId 
                ORDER BY po2.created_at DESC 
                LIMIT 1
            )
        LEFT JOIN supplier sp ON sp.id = po.spName
        WHERE s.docType = ? 
            AND s.itemId IN (${items.map(() => '?').join(',')})
            AND s.created_at BETWEEN DATE_SUB(CURDATE(), INTERVAL ? DAY) AND CURDATE()
        GROUP BY s.itemCode
    `;

    const [rows] = await connection.execute(consQuery, [docType, ...items, consumptionDay]);

    const itemSet = new Map();
    rows.forEach(item => {
        itemSet.set(item.itemCode, { totalCons: item.totalCons, supplier: item.supplier });
    });

    return itemSet;
};

exports.minMaxReport = async (req, res) => {
    try {
        const { fromDate, toDate, type, filter, items = [], itemGroups = [], locations = [], suppliers = [], consumptionDays, limit = 50 } = req.body;

        // Validate type and filter
        const validTypes = ['shortage', 'excess'];
        const validFilters = ['min', 'max', 'both'];
        if (!validTypes.includes(type) || !validFilters.includes(filter)) {
            throw new CustomError('Invalid type or filter', 400);
        }

        // Define WHERE clause based on type & filter
        let whereConditions = [];
        const values = [];

        if (type === 'shortage') {
            if (filter === 'min') whereConditions.push(`i.totStk < i.minStockLvl`);
            else if (filter === 'max') whereConditions.push(`i.totStk < i.maxLvl`);
            else if (filter === 'both') whereConditions.push(`i.totStk < i.minStockLvl AND i.totStk < i.maxLvl`);
        } else if (type === 'excess') {
            if (filter === 'min') whereConditions.push(`i.totStk > i.minStockLvl`);
            else if (filter === 'max') whereConditions.push(`i.totStk > i.maxLvl`);
            else if (filter === 'both') whereConditions.push(`i.totStk > i.minStockLvl AND i.totStk > i.maxLvl`);
        }

        // Fetch item IDs from suppliers
        const itemIds = await getItemsBySuppliers(items, suppliers);
        if (itemIds.length === 0 && (items.length || suppliers.length)) {
            return handleSuccessResponse(res, `Min Max Report`, []);
        }

        if (itemIds.length) {
            whereConditions.push(`i.id IN (${itemIds.map(() => '?').join(',')})`);
            values.push(...itemIds);
        }
        if (itemGroups.length) {
            whereConditions.push(`i.itemGroup IN (${itemGroups.map(() => '?').join(',')})`);
            values.push(...itemGroups);
        }
        if (locations.length) {
            whereConditions.push(`i.mainLocation IN (${locations.map(() => '?').join(',')})`);
            values.push(...locations);
        }

        let whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

        let query = `
            SELECT 
                i.id, ig.name AS itemGroup, pf.name AS productFamily, loc.name AS location, i.itemCode, i.itemName,   
                uom.name as uom, i.stdRate, i.minStockLvl AS minStock, i.maxLvl AS maxStock, i.totStk
            FROM items i
            LEFT JOIN mst_item_group ig ON ig.id = i.itemGroup
            LEFT JOIN item_main_loc loc ON loc.id = i.mainLocation
            LEFT JOIN item_product_family pf ON pf.id = i.productFamily
            LEFT JOIN mst_uom as uom ON uom.id = i.uom
            ${whereClause}
            LIMIT ?
        `;

        values.push(parseInt(limit));

        const [rows] = await connection.execute(query, values);

        if (rows.length === 0) {
            return handleSuccessResponse(res, `Min Max Report`, []);
        }

        const consumption = await itemConsumtions(rows.map(r => r.id), consumptionDays);

        const result = rows.map(item => {
            const { itemCode, stdRate, minStock, maxStock, totStk } = item;
            const data = { ...item };
            const consumptionData = consumption.get(itemCode) || {};

            data.supplier = consumptionData.supplier || null;
            data.consumption = consumptionData.totalCons || null;

            if (type === 'shortage') {
                if ((filter === 'min' || filter === 'both') && totStk < minStock) {
                    data.minQty = minStock - totStk;
                    data.minRate = Math.round(data.minQty * stdRate);
                }
                if ((filter === 'max' || filter === 'both') && totStk < maxStock) {
                    data.maxQty = maxStock - totStk;
                    data.maxRate = Math.round(data.maxQty * stdRate);
                }
            } else if (type === 'excess') {
                if ((filter === 'min' || filter === 'both') && totStk > minStock) {
                    data.minQty = totStk - minStock;
                    data.minRate = Math.round(data.minQty * stdRate);
                }
                if ((filter === 'max' || filter === 'both') && totStk > maxStock) {
                    data.maxQty = totStk - maxStock;
                    data.maxRate = Math.round(data.maxQty * stdRate);
                }
            }

            return data;
        });

        return res.status(200).json({
            success: true,
            message: 'Items MinMax report',
            data: result
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.getMaterialIssueReport = async (req, res) => {
    const { fromDate, toDate } = req.body;

    if (!fromDate || !toDate) {
        return res.status(400).json({ error: 'fromDate and toDate are required' });
    }

    const query = `
        SELECT 
            min.issueNo AS MINNO,
            min.created_at AS MINDATE,
            iml.name AS LOCNAME,
            i.itemCode AS SITEMCODE,
            i.itemName AS SITEMNAME,
            uom.code AS UOMCODE,
            mid.srnId AS SRNID,
            sm.srnNo AS SRNNO,
            mid.issuedQty AS MINQTY
        FROM material_issue_note min
        JOIN material_issue_dtl mid ON min.id = mid.issueId
        JOIN items i ON mid.itemId = i.id
        LEFT JOIN item_main_loc iml ON i.mainLocation = iml.id
        LEFT JOIN mst_uom uom ON i.uom = uom.id
        LEFT JOIN srn s ON mid.srnId = s.id
        LEFT JOIN srn_mst sm ON s.srnMstId = sm.id
        WHERE DATE(min.created_at) BETWEEN ? AND ?
    `;

    try {
        const [results] = await connection.query(query, [fromDate, toDate]);

        const formattedResults = results.map((row, index) => {
            const date = new Date(row.MINDATE);
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            const yyyy = date.getFullYear();
            const formattedDate = `${mm}-${dd}-${yyyy}`;

            return {
                SNO: index + 1,
                ...row,
                MINDATE: formattedDate
            };
        });

        res.json({ data: formattedResults });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

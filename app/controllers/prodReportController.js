const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require("../config/dbSql");
const { exportProductionReport } = require("./excel/prodReportExlController");

// Helper function to format date to ISO format
const toISODate = (ddmmyyyy) => {
    const [dd, mm, yyyy] = ddmmyyyy.split('-');
    return `${yyyy}-${mm}-${dd}`;
};

// Helper function to sort dates
const sortDates = (dates) => {
    return dates.sort((a, b) => new Date(toISODate(a)) - new Date(toISODate(b)));
};

const flattenData = (data) => {
    const rows = [];
    data.forEach(item => {
        item.products.forEach(product => {
            product.contracts.forEach(contract => {
                contract.fims.forEach(fim => {
                    fim.parts.forEach(part => {
                        rows.push({
                            Kanban: item.kanban,
                            Product: product.product,
                            ContractNo: contract.contractNo,
                            Duty: contract.duty,
                            FIM: fim.fim,
                            PartNo: part.partNo,
                            PartDesc: part.partDesc,
                            Quantity: part.Qty
                        });
                    });
                });
            });
        });
    });
    return rows;
};

const flattenFimData = (data) => {
    const result = data.flatMap(obj =>
        obj.parts.map(part => ({
            ProductFamily: part.PartNo ? obj.ProductFamily : 'Total',
            ...part
        }))
    );
    return result;
};

const contractReport = async (fromDate, toDate) => {
    try {
        const [sobRows] = await connection.execute(
            `SELECT sob.contractNos, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
            FROM order_plannings op
            INNER JOIN sob_mst sob ON sob.id = op.sobMstId
            WHERE DATE(op.kanbanDate) BETWEEN ? AND ?`,
            [fromDate, toDate]
        );

        if (sobRows.length === 0) return { result: [] };

        // Create a Map for contract numbers and their corresponding kanban dates
        const hashMap = sobRows.reduce((map, item) => {
            item.contractNos.split(',').forEach(contractNo => {
                map.set(contractNo, item.kanbanDate);
            });
            return map;
        }, new Map());

        // Fetch CSL rows matching contract numbers
        const contracts = Array.from(hashMap.keys());

        const placeholders = contracts.map(() => '?').join(',');
        const [cslRows] = await connection.execute(
            `SELECT contractNo, product FROM csl_mst
            WHERE contractNo IN (${placeholders})`,
            contracts
        );

        // Collect all unique products
        const allProducts = new Set(cslRows.map(row => row.product));

        // Aggregate data: Initialize kanban dates with product counts set to 0
        const kanbanDates = cslRows.reduce((result, { contractNo, product }) => {
            const kanban = hashMap.get(contractNo);
            if (kanban) {
                if (!result[kanban]) {
                    result[kanban] = {};
                    allProducts.forEach(prod => {
                        result[kanban][prod] = 0; // Initialize each product to 0
                    });
                }
                result[kanban][product] += 1;
            }
            return result;
        }, {});

        // Format the response and add a summary of product counts
        const formattedResponse = Object.keys(kanbanDates).map((kanbanDate, index) => ({
            id: index + 1,
            Kanban: kanbanDate,
            ...kanbanDates[kanbanDate],
        }));

        // Add a final summary row showing the total counts of all products
        const totalProductCounts = {};
        allProducts.forEach(prod => {
            totalProductCounts[prod] = 0;
            formattedResponse.forEach(entry => {
                totalProductCounts[prod] += entry[prod] || 0;
            });
        });

        formattedResponse.push({
            id: formattedResponse.length + 1,
            Kanban: 'Total',
            ...totalProductCounts
        });

        const headers = Array.from(allProducts);
        headers.unshift('Kanban');

        return { headers, result: formattedResponse };
    } catch (err) {
        throw err;
    }
};

const fimReport = async (fromDate, toDate) => {
    try {
        // Fetch sobRows with required kanbanDates
        const [sobRows] = await connection.execute(
            `SELECT sob.contractNos, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
             FROM order_plannings op
             INNER JOIN sob_mst sob ON sob.id = op.sobMstId
             WHERE DATE(op.kanbanDate) BETWEEN ? AND ?`,
            [fromDate, toDate]
        );

        // Extract unique kanbanDates and sort them
        const kanbanDates = sortDates([...new Set(sobRows.map(row => row.kanbanDate))]);
        if (!kanbanDates.length) return { headers: [], result: [] };

        // Create a hash map for contractNos -> kanbanDate
        const hashMap = Object.fromEntries(
            sobRows.flatMap(item => item.contractNos.split(',').map(contractNo => [contractNo, item.kanbanDate]))
        );

        const contracts = Object.keys(hashMap);
        if (!contracts.length) return { headers: [], result: [] };

        const placeholders = contracts.map(() => '?').join(',');
        const [cslRows] = await connection.execute(
            `SELECT s.contractNo, c.product AS Product, s.fimNo AS Fim
             FROM sob s
             INNER JOIN csl_mst c ON s.cslMstId = c.id
             WHERE s.contractNo IN (${placeholders})
             GROUP BY c.product, s.contractNo, s.fimNo`,
            contracts
        );

        const fimObject = {};
        for (const { contractNo, Product, Fim, count = 1 } of cslRows) {
            const kanban = hashMap[contractNo];
            if (!kanban) continue;

            fimObject[Product] ??= {};
            fimObject[Product][Fim] ??= Object.fromEntries(kanbanDates.map(date => [date, 0]));
            fimObject[Product][Fim][kanban] += count;
        }

        const fimArray = [];
        for (const [product, fims] of Object.entries(fimObject)) {
            const productTotal = Object.fromEntries(kanbanDates.map(date => [date, 0]));
            for (const [fim, fimData] of Object.entries(fims)) {
                for (const [date, count] of Object.entries(fimData)) {
                    productTotal[date] += count;
                }
                fimArray.push({ Product: product, Fim: fim, ...fimData });
            }
            fimArray.push({ Product: 'Total', Fim: '', ...productTotal });
        }

        const headers = ['Product', 'Fim', ...kanbanDates];
        return { headers, result: fimArray };
    } catch (err) {
        throw err;
    }
};

const mkdReport = async (fromDate, toDate) => {
    try {
        // Fetch sobRows with required kanbanDates
        const [sobRows] = await connection.execute(
            `SELECT sob.contractNos, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
             FROM order_plannings op
             INNER JOIN sob_mst sob ON sob.id = op.sobMstId
             WHERE DATE(op.kanbanDate) BETWEEN ? AND ?`,
            [fromDate, toDate]
        );

        // Create a hash map for contractNos -> kanbanDate
        const kanbanDates = Object.fromEntries(
            sobRows.flatMap(item => item.contractNos.split(',').map(contractNo => [contractNo, item.kanbanDate]))
        );

        const contracts = Object.keys(kanbanDates);
        if (!contracts.length) return [];

        const placeholders = contracts.map(() => '?').join(',');
        // const [cslRows] = await connection.execute(
        //     `SELECT cm.product, cm.contractNo, cm.duty, sob.fimNo AS fim, sob.partNo, items.itemName, sob.Qty
        //      FROM csl_mst cm
        //      INNER JOIN sob ON sob.cslMstId = cm.id
        //      LEFT JOIN items ON items.itemCode = sob.partNo
        //      WHERE cm.contractNo IN (${placeholders}) AND sob.partNo LIKE "%-%" AND LENGTH(SUBSTRING_INDEX(sob.partNo, '-', -1)) = 8`,
        //     contracts
        // );
        const [cslRows] = await connection.execute(
            `SELECT cm.product, cm.contractNo, cm.duty, sob.fimNo AS fim, sob.partNo, items.itemName, sob.Qty
            FROM csl_mst cm
            INNER JOIN sob ON sob.cslMstId = cm.id
            LEFT JOIN items ON items.itemCode = sob.partNo
            WHERE cm.contractNo IN (${placeholders})
            AND sob.partNo LIKE "%-%"
            AND (
                    LENGTH(SUBSTRING_INDEX(sob.partNo, '-', -1)) = 8
                    OR SUBSTRING_INDEX(sob.partNo, '-', -1) REGEXP '^[A-Z]{2}[A-Za-z0-9]{4}$'
            )`,
            contracts
        );

        const transformed = Object.values(
            cslRows.reduce((acc, item) => {
                const kanbanDate = kanbanDates[item.contractNo];
                if (!kanbanDate) return acc; // Skip if kanbanDate is not found

                if (!acc[kanbanDate]) {
                    acc[kanbanDate] = { kanban: kanbanDate, products: [], totalQty: 0 };
                }

                acc[kanbanDate].totalQty += Number(item.Qty); // Accumulate total Qty for the kanban date

                // Accumulate products, contracts, and fims
                const productGroup = acc[kanbanDate].products.find(
                    (p) => p.product === item.product
                );
                if (!productGroup) {
                    acc[kanbanDate].products.push({
                        product: item.product,
                        contracts: []
                    });
                }

                const currentProduct = acc[kanbanDate].products.find(
                    (p) => p.product === item.product
                );

                const contractGroup = currentProduct.contracts.find(
                    (c) => c.contractNo === item.contractNo && c.duty === item.duty
                );

                if (!contractGroup) {
                    currentProduct.contracts.push({
                        contractNo: item.contractNo,
                        duty: item.duty,
                        fims: []
                    });
                }

                const currentContract = currentProduct.contracts.find(
                    (c) => c.contractNo === item.contractNo && c.duty === item.duty
                );

                const fimGroup = currentContract.fims.find((f) => f.fim === item.fim);

                if (!fimGroup) {
                    currentContract.fims.push({ fim: item.fim, parts: [] });
                }

                const currentFim = currentContract.fims.find((f) => f.fim === item.fim);

                if (currentFim) {
                    currentFim.parts.push({
                        partNo: item.partNo,
                        partDesc: item.itemName,
                        Qty: item.Qty
                    });
                }

                return acc;
            }, {})
        );

        // Sort the transformed array by kanban date
        const sortedTransformed = transformed.sort((a, b) => {
            const dateA = new Date(a.kanban.split('-').reverse().join('-')); // Convert 'DD-MM-YYYY' to 'YYYY-MM-DD'
            const dateB = new Date(b.kanban.split('-').reverse().join('-'));
            return dateA - dateB;
        });

        const result = [];

        sortedTransformed.forEach(obj => {
            result.push(obj);
            result.push({
                kanban: 'Total',
                products: [{ contracts: [{ contractNo: '', duty: '', fims: [{ fim: '', parts: [{ partNo: '', partDesc: '', Qty: obj.totalQty }] }] }] }]
            });
        });

        const headers = ['Kanban', 'Product', 'ContractNo', 'Duty', 'FIM', 'PartNo', 'PartDesc', 'Quantity'];

        return { headers, result };
    } catch (err) {
        throw err;
    }
};

// const fimPartReport = async (fromDate, toDate) => {
//     try {
//         const [sobRows] = await connection.execute(
//             `SELECT 
//                 op.id AS opId, 
//                 DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, 
//                 m.id AS mrpMstId
//              FROM order_plannings op
//              LEFT JOIN mrp_mst m ON m.orderPlnId = op.id
//              WHERE DATE(op.kanbanDate) BETWEEN ? AND ?
//                AND op.sobMstId IS NOT NULL`,
//             [fromDate, toDate]
//         );

//         if (!sobRows.length) return { headers: [], result: [] };

//         /* ---------------- Single pass over sobRows ---------------- */
//         const kanbanDateSet = new Set();
//         const orderPlanMap = new Map(); // opId -> kanbanDate
//         const mrpMstIdSet = new Set();
//         const orderPlanIds = [];

//         for (const { opId, kanbanDate, mrpMstId } of sobRows) {
//             kanbanDateSet.add(kanbanDate);

//             if (mrpMstId) mrpMstIdSet.add(mrpMstId);

//             if (!orderPlanMap.has(opId)) {
//                 orderPlanMap.set(opId, kanbanDate);
//                 orderPlanIds.push(opId);
//             }
//         }

//         const kanbanDates = sortDates([...kanbanDateSet]);
//         if (!kanbanDates.length || !orderPlanIds.length) {
//             return { headers: [], result: [] };
//         }

//         /* ---------------- Fetch MRP rows ---------------- */
//         const placeholders = orderPlanIds.map(() => '?').join(',');
//         const [mrpRows] = await connection.execute(
//             `SELECT 
//                 mrp.orderPlnId,
//                 pf.name AS productFamily,
//                 mrp.itemCode AS partNo,
//                 mrp.Qty,
//                 items.itemName,
//                 items.material,
//                 items.materialThickness AS thickness
//              FROM mrp
//              INNER JOIN items ON items.id = mrp.itemId
//              LEFT JOIN item_product_family pf ON pf.id = items.productFamily
//              WHERE mrp.orderPlnId IN (${placeholders})`,
//             orderPlanIds
//         );

//         const mrpMstIds = [...mrpMstIdSet];

//         let jcRows = [];
//         if (mrpMstIds.length) {
//             const mrpPlaceholders = mrpMstIds.map(() => '?').join(',');

//             [jcRows] = await connection.execute(
//                 `SELECT 
//                     m.orderPlnId,
//                     pf.name AS productFamily,
//                     jc.itemCode AS partNo,
//                     jc.Qty,
//                     items.itemName,
//                     items.material,
//                     items.materialThickness AS thickness
//                 FROM job_card jc
//                 INNER JOIN mrp_mst m ON m.id = jc.mrpMstId
//                 INNER JOIN items ON items.id = jc.itemId
//                 LEFT JOIN item_product_family pf ON pf.id = items.productFamily
//                 WHERE jc.mrpMstId IN (${mrpPlaceholders})`,
//                 mrpMstIds
//             );
//         }
//         // Step 1: Build lookup set from MRP
//         const mrpKeySet = new Set(
//             mrpRows.map(row => `${row.orderPlnId}_${row.partNo}`)
//         );

//         // Step 2: Remove duplicates from JC
//         const filteredJcRows = jcRows.filter(row => {
//             const key = `${row.orderPlnId}_${row.partNo}`;
//             return !mrpKeySet.has(key);
//         });

//         /* ---------------- Build FIM object ---------------- */
//         const fimObject = Object.create(null);
//         const allRows = [mrpRows, filteredJcRows];

//         for (const rows of allRows) {
//             for (const row of rows) {
//                 const kanban = orderPlanMap.get(row.orderPlnId);
//                 if (!kanban) continue;

//                 const {
//                     productFamily,
//                     partNo,
//                     itemName,
//                     material,
//                     thickness,
//                     Qty
//                 } = row;

//                 if (!fimObject[productFamily]) {
//                     fimObject[productFamily] = Object.create(null);
//                 }

//                 if (!fimObject[productFamily][partNo]) {
//                     const baseRow = {
//                         ProductFamily: productFamily,
//                         PartNo: partNo,
//                         PartDesc: itemName,
//                         Material: material,
//                         Thickness: thickness
//                     };

//                     for (const date of kanbanDates) baseRow[date] = 0;
//                     fimObject[productFamily][partNo] = baseRow;
//                 }

//                 const qty = Qty ? Number(Qty) : 0;
//                 fimObject[productFamily][partNo][kanban] += qty;
//             }
//         }

//         /* ---------------- Build final result ---------------- */
//         const result = [];

//         for (const [productFamily, parts] of Object.entries(fimObject)) {
//             const partArray = [];
//             const columnTotals = Object.fromEntries(kanbanDates.map(d => [d, 0]));
//             let totalQty = 0;

//             for (const part of Object.values(parts)) {
//                 let rowTotal = 0;

//                 for (const date of kanbanDates) {
//                     rowTotal += part[date];
//                     columnTotals[date] += part[date];
//                 }

//                 part.TotalQty = rowTotal;
//                 totalQty += rowTotal;
//                 partArray.push(part);
//             }

//             partArray.push({
//                 ProductFamily: productFamily,
//                 PartNo: '',
//                 PartDesc: '',
//                 Material: '',
//                 Thickness: '',
//                 ...columnTotals,
//                 TotalQty: totalQty
//             });

//             result.push({ ProductFamily: productFamily, parts: partArray });
//         }

//         const headers = [
//             'ProductFamily',
//             'PartNo',
//             'PartDesc',
//             'Material',
//             'Thickness',
//             ...kanbanDates,
//             'TotalQty'
//         ];

//         return { headers, result };
//     } catch (err) {
//         throw err;
//     }
// };

const fimPartReport = async (fromDate, toDate) => {
    try {
        /* ---------------- Fetch SOB Rows ---------------- */
        const [sobRows] = await connection.execute(
            `SELECT 
                op.id AS opId, 
                DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate, 
                m.id AS mrpMstId
             FROM order_plannings op
             LEFT JOIN mrp_mst m ON m.orderPlnId = op.id
             WHERE DATE(op.kanbanDate) BETWEEN ? AND ?
               AND op.sobMstId IS NOT NULL`,
            [fromDate, toDate]
        );

        if (!sobRows.length) return { headers: [], result: [] };

        /* ---------------- Single Pass Preprocessing ---------------- */
        const kanbanDateSet = new Set();
        const orderPlanMap = new Map();
        const mrpMstIdSet = new Set();
        const orderPlanIds = [];

        for (const row of sobRows) {
            const { opId, kanbanDate, mrpMstId } = row;

            kanbanDateSet.add(kanbanDate);
            if (mrpMstId) mrpMstIdSet.add(mrpMstId);

            if (!orderPlanMap.has(opId)) {
                orderPlanMap.set(opId, kanbanDate);
                orderPlanIds.push(opId);
            }
        }

        if (!orderPlanIds.length) return { headers: [], result: [] };

        const kanbanDates = sortDates([...kanbanDateSet]);

        /* ---------------- Fetch MRP ---------------- */
        const placeholders = orderPlanIds.map(() => '?').join(',');
        const [mrpRows] = await connection.execute(
            `SELECT 
                mrp.orderPlnId,
                pf.name AS productFamily,
                mrp.itemCode AS partNo,
                mrp.Qty,
                items.itemName,
                items.material,
                items.materialThickness AS thickness
             FROM mrp
             INNER JOIN items ON items.id = mrp.itemId
             LEFT JOIN item_product_family pf ON pf.id = items.productFamily
             WHERE mrp.orderPlnId IN (${placeholders})`,
            orderPlanIds
        );

        /* ---------------- Fetch JC ---------------- */
        let jcRows = [];
        const mrpMstIds = [...mrpMstIdSet];

        if (mrpMstIds.length) {
            const jcPlaceholders = mrpMstIds.map(() => '?').join(',');

            [jcRows] = await connection.execute(
                `SELECT 
                    m.orderPlnId,
                    pf.name AS productFamily,
                    jc.itemCode AS partNo,
                    jc.Qty,
                    items.itemName,
                    items.material,
                    items.materialThickness AS thickness
                FROM job_card jc
                INNER JOIN mrp_mst m ON m.id = jc.mrpMstId
                INNER JOIN items ON items.id = jc.itemId
                LEFT JOIN item_product_family pf ON pf.id = items.productFamily
                WHERE jc.mrpMstId IN (${jcPlaceholders})`,
                mrpMstIds
            );
        }

        /* ---------------- Remove Duplicates (Optimized) ---------------- */
        const mrpKeySet = new Set();
        for (const row of mrpRows) {
            mrpKeySet.add(row.orderPlnId + '|' + row.partNo);
        }

        const combinedRows = [...mrpRows];

        for (const row of jcRows) {
            const key = row.orderPlnId + '|' + row.partNo;
            if (!mrpKeySet.has(key)) {
                combinedRows.push(row);
            }
        }

        /* ---------------- Build FIM Object (Single Loop) ---------------- */
        const fimObject = Object.create(null);

        for (const row of combinedRows) {
            const kanban = orderPlanMap.get(row.orderPlnId);
            if (!kanban) continue;

            const {
                productFamily,
                partNo,
                itemName,
                material,
                thickness,
                Qty
            } = row;

            if (!fimObject[productFamily]) {
                fimObject[productFamily] = Object.create(null);
            }

            if (!fimObject[productFamily][partNo]) {
                const baseRow = {
                    ProductFamily: productFamily,
                    PartNo: partNo,
                    PartDesc: itemName,
                    Material: material,
                    Thickness: thickness,
                    TotalQty: 0
                };

                for (const date of kanbanDates) baseRow[date] = 0;
                fimObject[productFamily][partNo] = baseRow;
            }

            const qty = Qty ? Number(Qty) : 0;

            fimObject[productFamily][partNo][kanban] += qty;
            fimObject[productFamily][partNo].TotalQty += qty;
        }

        /* ---------------- Final Aggregation ---------------- */
        const result = [];

        for (const [productFamily, parts] of Object.entries(fimObject)) {
            const partArray = [];
            const columnTotals = Object.fromEntries(
                kanbanDates.map(d => [d, 0])
            );

            let totalQty = 0;

            for (const part of Object.values(parts)) {
                for (const date of kanbanDates) {
                    columnTotals[date] += part[date];
                }

                totalQty += part.TotalQty;
                partArray.push(part);
            }

            partArray.push({
                ProductFamily: productFamily,
                PartNo: '',
                PartDesc: '',
                Material: '',
                Thickness: '',
                ...columnTotals,
                TotalQty: totalQty
            });

            result.push({ ProductFamily: productFamily, parts: partArray });
        }

        const headers = [
            'ProductFamily',
            'PartNo',
            'PartDesc',
            'Material',
            'Thickness',
            ...kanbanDates,
            'TotalQty'
        ];

        return { headers, result };

    } catch (err) {
        throw err;
    }
};

const fimKitReport = async (fromDate, toDate) => {
    try {
        // Fetch orderInput with required kanbanDates
        const [orderInput] = await connection.execute(
            `SELECT op.id as opId, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS kanbanDate
             FROM order_plannings op
             WHERE DATE(op.kanbanDate) BETWEEN ? AND ? AND saleId IS NOT NULL`,
            [fromDate, toDate]
        );

        // Extract unique kanbanDates and sort them
        const kanbanDates = sortDates([...new Set(orderInput.map(row => row.kanbanDate))]);
        if (!kanbanDates.length) return { headers: [], result: [] };

        // Create a hash map for SaleId -> kanbanDate
        const hashMap = Object.fromEntries(orderInput.map(item => [item.opId, item.kanbanDate]))

        const orderPlanIds = Object.keys(hashMap);

        const placeholders = orderPlanIds.map(() => '?').join(',');
        const [mrpRows] = await connection.execute(
            `SELECT mrp.orderPlnId, pf.name AS productFamily, fim.name as fimCode, items.itemCode as partNo, mrp.Qty
             FROM mrp
             INNER JOIN items ON items.id = mrp.itemId
             LEFT JOIN item_product_family pf ON pf.id = items.productFamily
             LEFT JOIN item_fim_id fim ON fim.id = items.fimId
             WHERE mrp.orderPlnId IN (${placeholders})`,
            orderPlanIds
        );

        const fimObject = {};
        for (const { orderPlnId, productFamily, partNo, fimCode, Qty } of mrpRows) {
            const kanban = hashMap[orderPlnId];
            if (!kanban) continue;

            fimObject[productFamily] ??= {};
            fimObject[productFamily][partNo] ??= { FimCode: fimCode, PartNo: partNo, ...Object.fromEntries(kanbanDates.map(date => [date, 0])) };
            fimObject[productFamily][partNo][kanban] += Number(Qty);
        }

        // Calculate totals for each productFamily
        const result = Object.entries(fimObject).map(([productFamily, parts]) => {
            const partArray = Object.values(parts).map(part => ({
                ...part, // Copy all part properties
                TotalQty: Object.entries(part) // Calculate total quantity
                    .filter(([key, value]) => key.match(/^\d{2}-\d{2}-\d{4}$/) && typeof value === "number") // Only date keys with numeric values
                    .reduce((sum, [, value]) => sum + value, 0)
            }));

            // Calculate the column-wise totals (sum of each date across parts)
            const columnTotals = kanbanDates.reduce((totals, date) => {
                totals[date] = partArray.reduce((sum, part) => sum + (part[date] || 0), 0);
                return totals;
            }, {});

            // Insert the summary row at the end of the parts array
            partArray.push({
                FimCode: '',
                PartNo: '',
                ...columnTotals,
                TotalQty: partArray.reduce((sum, part) => sum + part.TotalQty, 0)
            });

            return {
                ProductFamily: productFamily,
                parts: partArray
            };
        });

        const headers = ['ProductFamily', 'FimCode', 'PartNo', ...kanbanDates, 'TotalQty'];
        return { headers, result };
    } catch (err) {
        throw err;
    }
};


exports.viewProductionReport = async (req, res) => {
    try {
        const { type, fromDate, toDate } = req.query;

        if (!fromDate || !toDate) {
            throw new Error("Both fromDate and toDate are required.");
        }

        let headerColumns = [], data = [];
        if (type === 'Contract') {
            const { result } = await contractReport(fromDate, toDate);
            data = result;
        } else if (type === 'Fim') {
            const { result } = await fimReport(fromDate, toDate);
            data = result;
        } else if (type === 'Mkd') {
            const { result } = await mkdReport(fromDate, toDate);
            data = result;
        } else if (type === 'FimPart') {
            const { headers, result } = await fimPartReport(fromDate, toDate);
            headerColumns = headers;
            data = result;
        } else if (type === 'FimKit') {
            const { headers, result } = await fimKitReport(fromDate, toDate);
            headerColumns = headers;
            data = result;
        } else {
            throw new CustomError(`Invalid report type provided!`, 500);
        }

        return res.status(200).json({
            success: true,
            message: `${type} report generated successfully`,
            headers: headerColumns,
            data
        })
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.exportProductionReport = async (req, res) => {
    try {
        const { type, fromDate, toDate } = req.query;

        if (!fromDate || !toDate) {
            throw new Error("Both fromDate and toDate are required.");
        }

        if (type === 'Contract') {
            const { headers, result } = await contractReport(fromDate, toDate);
            return await exportProductionReport(res, 'Contract report', headers, result);
        } else if (type === 'Fim') {
            const { headers, result } = await fimReport(fromDate, toDate);
            return await exportProductionReport(res, 'Fim report', headers, result);
        } else if (type === 'Mkd') {
            const { headers, result } = await mkdReport(fromDate, toDate);
            const data = flattenData(result);
            return await exportProductionReport(res, 'Mkd report', headers, data);
        } else if (type === 'FimPart') {
            const { headers, result } = await fimPartReport(fromDate, toDate);
            const data = flattenFimData(result);
            return await exportProductionReport(res, 'FimPart report', headers, data);
        } else if (type === 'FimKit') {
            const { headers, result } = await fimKitReport(fromDate, toDate);
            const data = flattenFimData(result);
            return await exportProductionReport(res, 'FimKit report', headers, data);
        } else {
            throw new CustomError(`Invalid report type provided!`, 500);
        }
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const { connection, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');
const excel = require("exceljs");
const moment = require("moment"); // make sure moment is installed
const XLSX = require('xlsx');
const path = require('path');

exports.saleInvoice = async (req, res) => {
    try {
        const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

        // Ensure dates are in the correct format and include time
        const fromDate = repo.from;
        const toDate = repo.to;
        const custId = repo.customer; // Expecting an array like [1, 2, 3]
        const item = repo.item; // Expecting an array like [1, 2, 3]
        const isCancel = repo.isCancel;

        // Sub query
        let query = `   
            SELECT  
                gst.*, gsi.*, gst.id AS mainId, gsi.id as listId,gsi.invAmt,
                DATE_FORMAT(gst.date, '%d-%m-%Y') AS date, 
                DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate,
                itm.itemCode, gsi.partName As itemName, itm.id AS itemId, 
                CONCAT(po.poNo, '/', DATE_FORMAT(po.poDate, '%d-%m-%Y')) AS poWithDate,
                DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
                c.cCode, c.cName, c.gstNo, ihs.description AS tariff, gst.totalInWords
            FROM 
                gstsalesinvoitem gsi
            INNER JOIN 
                gstsalesinvo as gst ON gst.id = gsi.gstsalesinvo_id
            INNER JOIN 
                customer as c ON gst.custName = c.cId
            INNER JOIN 
                items as itm ON gsi.partno = itm.itemCode
            INNER JOIN 
                purchase_order as po ON po.id = gsi.poId    
            LEFT JOIN 
                item_hsn_code as ihs ON gsi.hsnCode = ihs.name
        `;

        // Collect conditions
        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(gsi.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(custId) && custId.length > 0) {
            conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
            queryParams.push(...custId);
        }

        // Add item filter condition
        if (Array.isArray(item) && item.length > 0) {
            conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
            queryParams.push(...item);
        }

        if (isCancel) {
            conditions.push('gst.isCancelAuth = ?');
            queryParams.push(isCancel);
        }


        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        // Execute the query
        const [rows] = await connection.execute(query, queryParams);

        // Group rows by mainId
        const groupedData = {};
        let totalValue = 0, amtOfGstPay = 0;


        rows.forEach(row => {
            // Initialize main group by mainId
            if (!groupedData[row.mainId]) {
                groupedData[row.mainId] = {
                    mainId: row.mainId,
                    invNo: row.invNo,
                    invDate: row.date,
                    cCode: row.cCode,
                    cName: row.cName,
                    invIssueDate: row.invoIssuDate,
                    vechileNO: row.vechileNO,
                    gstNo: row.gstNo,
                    invDtl: [] // Initialize invDtl array
                };
            }

            // Push stock details into invDtl
            const invDetails = {
                id: row.listId,
                itemCode: row.itemCode,
                itemName: row.itemName,
                itemId: row.itemId,
                hsnCode: row.hsnCode,
                uom: row.uom,
                invQty: row.invQty,
                invRate: row.invRate,
                invAmt: row.invAmt,
                modeOfDispatch: row.modelOfDis,
                // vechileNO: row.vechileNO,
                poNo2: row.poNo,
                poNo: row.poWithDate,
                poDate: row.poDate,
                subtotal: row.subtotal,
                taxableValueforGST: row.taxableValueforGST,
                lessDisc: row.lessDisc,
                lessOther: row.lessOther,
                subTotAfterDisc: row.subTotAfterDisc,
                transportCharges: row.transportCharges,
                CGST: row.CGST,
                CGSTPer: row.CGSTPer,
                SGST: row.SGST,
                SGSTPer: row.SGSTPer,
                IGST: row.IGST,
                IGSTPer: row.IGSTPer,
                UTGST: row.UTGST,
                UTGSTPer: row.UTGSTPer,
                totGst: row.totGst,
                tcs: row.tcs,
                totalValue: row.invValue,
                amtOfGstPay: row.amtOfGstPay,
                dcNO: null,
                dcDate: null,
                cessOnTcs: row.cessOnTcs,
                cessOnTcsPer: row.cessOnTcsPer,
                subChargeOnTcs: row.subChargeOnTcs,
                subChargeOnTcsPer: row.subChargeOnTcsPer,
                insurance: row.Insurance,
                ammortisationCost: row.AmmortisationCost,
                tcsPer: row.tcsPer,
                tcsPercessOnTcsPer: row.cessOnTcsPer,
                tariff: row.tariff,
                totalInWords: row.totalInWords
            };

            groupedData[row.mainId].invDtl.push(invDetails);
            totalValue += Number(row.invValue);
            amtOfGstPay += Number(row.amtOfGstPay);
        });
        const row = {
            "mainId": 'ID001',
            "invNo": "Grand Total",
            "invDtl": [
                {
                    totalValue: totalValue.toFixed(2),
                    amtOfGstPay: amtOfGstPay.toFixed(2)

                }
            ]
        };

        // Convert groupedData object to an array
        const result = Object.values(groupedData);
        result.push(row);

        return res.status(200).json({
            success: true,
            message: "Sale Invoice list",
            data: result
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};





exports.saleInvoiceExport = async (req, res) => {
    try {
//         const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

//         const fromDate  = repo.from;
//         const toDate    = repo.to;
//         // const custId    = repo.customer;
//         // const item      = repo.item;

//         // In your backend, parse arrays from query like this
// const custId = repo.customer ? Array.isArray(repo.customer) ? repo.customer : [repo.customer]  : [];

// const item = repo.item  ? Array.isArray(repo.item) ? repo.item : [repo.item]  : [];


const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

const fromDate = repo.from;
const toDate   = repo.to;
const isCancel = repo.isCancel;

// ✅ Fix — handle string, array, or missing values from query params
const custId = repo.customer
    ? Array.isArray(repo.customer) ? repo.customer : [repo.customer]
    : [];

const item = repo.item
    ? Array.isArray(repo.item) ? repo.item : [repo.item]
    : [];

        // ── Base query (same as saleInvoice) ──────────────────────────────────
        let query = `
            SELECT
                gst.*, gsi.*, gst.id AS mainId, gsi.id AS listId, gsi.invAmt,
                DATE_FORMAT(gst.date, '%d-%m-%Y')         AS date,
                DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate,
                itm.itemCode, gsi.partName AS itemName, itm.id AS itemId,
                CONCAT(po.poNo, '/', DATE_FORMAT(po.poDate, '%d-%m-%Y')) AS poWithDate,
                DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
                c.cCode, c.cName, c.gstNo,
                ihs.description AS tariff,
                gst.totalInWords
            FROM gstsalesinvoitem gsi
            INNER JOIN gstsalesinvo      AS gst ON gst.id        = gsi.gstsalesinvo_id
            INNER JOIN customer          AS c   ON gst.custName  = c.cId
            INNER JOIN items             AS itm ON gsi.partno    = itm.itemCode
            INNER JOIN purchase_order    AS po  ON po.id         = gsi.poId
            LEFT  JOIN item_hsn_code     AS ihs ON gsi.hsnCode   = ihs.name
        
        `;

        const queryParams = [];
        const conditions  = [];

        if (fromDate && toDate) {
            conditions.push('DATE(gsi.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }
        // if (Array.isArray(custId) && custId.length > 0) {
        //     conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
        //     queryParams.push(...custId);
        // }
        // if (Array.isArray(item) && item.length > 0) {
        //     conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
        //     queryParams.push(...item);
        // }

        if (custId.length > 0) {
    conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
    queryParams.push(...custId);
}

if (item.length > 0) {
    conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
    queryParams.push(...item);
}
        if (isCancel) {
            conditions.push('gst.isCancelAuth = ?');
            queryParams.push(isCancel);
        }
        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        // ✅ ORDER BY must come AFTER WHERE
        query += ' ORDER BY gst.date ASC';

        const [rows] = await connection.execute(query, queryParams);

        // ── Column headers (exact order from the report) ──────────────────────
        const headers = [
            'INV No',
            'INV Date',
            'Cust Code',
            'Cust Name',
            'GST No',
            'Vehicle No',
            'Cust PONO Date',
            'Item Code',
            'Item Name',
            'HSN Code',
            'Tarrif Name',
            'UOM Code',
            'INV Qty',
            'INV Rate',
            'Net Amt',
            'CGST Per',
            'CGST Amt',
            'SGST Per',
            'SGST Amt',
            'IGST Per',
            'IGST Amt',
            'TCS Per',
            'TCS Amt',
            'Gross Value',
        ];

        // ── Build flat rows ───────────────────────────────────────────────────
        let grandTotal = 0;

        const dataRows = rows.map(row => {
            grandTotal += Number(row.invValue) || 0;
            return {
                'INV No'         : row.invNo         ?? '',
                'INV Date'       : row.date           ?? '',
                'Cust Code'      : row.cCode          ?? '',
                'Cust Name'      : row.cName          ?? '',
                'GST No'         : row.gstNo          ?? '',
                'Vehicle No'     : row.vechileNO      ?? '',
                'Cust PONO Date' : row.poWithDate     ?? '',
                'Item Code'      : row.itemCode       ?? '',
                'Item Name'      : row.itemName       ?? '',
                'HSN Code'       : row.hsnCode        ?? '',
                'Tarrif Name'    : row.tariff         ?? '',
                'UOM Code'       : row.uom            ?? '',
                'INV Qty'        : row.invQty         ?? '',
                'INV Rate'       : row.invRate        ?? '',
                'Net Amt'        : row.invAmt         ?? '',
                'CGST Per'       : row.CGSTPer        ?? '',
                'CGST Amt'       : row.CGST           ?? '',
                'SGST Per'       : row.SGSTPer        ?? '',
                'SGST Amt'       : row.SGST           ?? '',
                'IGST Per'       : row.IGSTPer        ?? '',
                'IGST Amt'       : row.IGST           ?? '',
                'TCS Per'        : row.tcsPer         ?? '',
                'TCS Amt'        : row.tcs            ?? '',
                'Gross Value'    : row.invValue       ?? '',
            };
        });

        // ── Grand-total row ───────────────────────────────────────────────────
        const totalRow = {
            'INV No'         : 'Grand Total',
            'INV Date'       : '', 'Cust Code'  : '', 'Cust Name'      : '',
            'GST No'         : '', 'Vehicle No' : '', 'Cust PONO Date' : '',
            'Item Code'      : '', 'Item Name'  : '', 'HSN Code'       : '',
            'Tarrif Name'    : '', 'UOM Code'   : '', 'INV Qty'        : '',
            'INV Rate'       : '', 'Net Amt'    : '', 'CGST Per'       : '',
            'CGST Amt'       : '', 'SGST Per'   : '', 'SGST Amt'       : '',
            'IGST Per'       : '', 'IGST Amt'   : '', 'TCS Per'        : '',
            'TCS Amt'        : '',
            'Gross Value'    : grandTotal.toFixed(2),
        };

        dataRows.push(totalRow);

        // ── Build worksheet ───────────────────────────────────────────────────
        const worksheet = XLSX.utils.json_to_sheet(dataRows, { header: headers });

        // ── Column widths ─────────────────────────────────────────────────────
        worksheet['!cols'] = [
            { wch: 14 }, // INV No
            { wch: 12 }, // INV Date
            { wch: 12 }, // Cust Code
            { wch: 32 }, // Cust Name
            { wch: 18 }, // GST No
            { wch: 14 }, // Vehicle No
            { wch: 22 }, // Cust PONO Date
            { wch: 14 }, // Item Code
            { wch: 30 }, // Item Name
            { wch: 12 }, // HSN Code
            { wch: 20 }, // Tarrif Name
            { wch: 10 }, // UOM Code
            { wch: 10 }, // INV Qty
            { wch: 10 }, // INV Rate
            { wch: 12 }, // Net Amt
            { wch: 10 }, // CGST Per
            { wch: 12 }, // CGST Amt
            { wch: 10 }, // SGST Per
            { wch: 12 }, // SGST Amt
            { wch: 10 }, // IGST Per
            { wch: 12 }, // IGST Amt
            { wch: 10 }, // TCS Per
            { wch: 12 }, // TCS Amt
            { wch: 14 }, // Gross Value
        ];

        // ── Workbook & buffer ─────────────────────────────────────────────────
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sale Invoice');

        const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

        const fileName = `SaleInvoice_${Date.now()}.xlsx`;

        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        return res.status(200).send(buffer);

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred',
        });
    }
};

exports.saleRegister = async (req, res) => {
    try {
        const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

        const fromDate = repo.from;
        const toDate = repo.to;
        const custId = repo.customer; // Expecting array like [1, 2, 3]
        const isCancel = repo.isCancel; 

        let query = `
            SELECT  
                gst.id, gst.invNo, gst.vechileNO, gst.totalQty, gst.trType, gst.taxableValueforGST, gst.lessDisc, gst.lessOther, gst.packingForw, 
                gst.transportCharges, gst.subtotal, gst.custMeterialValue, gst.amtOfGstPay, gst.CGSTPer, gst.CGST, gst.SGSTPer, gst.SGST, gst.IGSTPer, gst.IGST,
                gst.UTGSTPer, gst.UTGST, gst.tcsPer, gst.tcs, gst.roundOff, gst.IGST, gst.invValue, DATE_FORMAT(gst.date, '%d-%m-%Y') AS date,  DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate, 
                DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate, c.cCode, c.cName, c.gstNo, gsti.hsnCode, gsti.itemLedger AS commudity, gsti.uom, gsti.poNo
            FROM 
                gstsalesinvo AS gst
            INNER JOIN 
                customer AS c ON gst.custName = c.cId
            LEFT JOIN 
                gstsalesinvoitem AS gsti ON gst.id = gsti.gstsalesinvo_id 
            LEFT JOIN 
                items AS i ON gsti.partNo = i.itemCode     
            LEFT JOIN  
                item_hsn_code AS hsn ON hsn.name = gsti.hsnCode
            LEFT JOIN 
                purchase_order AS po ON po.id = gsti.poId 
        `;

        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(gst.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(custId) && custId.length > 0) {
            conditions.push(`c.cId IN (${custId.map(() => '?').join(', ')})`);
            queryParams.push(...custId);
        }

        if (isCancel) {
            conditions.push('gst.isCancelAuth = ?');
            queryParams.push(isCancel);
        }

        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' GROUP BY gst.id';

        const [result] = await connection.execute(query, queryParams);

        result.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return res.status(200).json({
            success: true,
            message: "Sale Register list",
            data: result
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};




exports.soCustpo = async (req, res) => {
    try {
        const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

        const fromDate = repo.from;
        const toDate = repo.to;
        const custId = repo.customer;
        const item = repo.item;
        const type = repo.type; // <-- Get the type from payload

        let query = `   
            SELECT 
                po.sino, po.sodigit, po.poNo, poItm.id AS poItemId, poItm.Qty, poItm.Rate, poItm.Amt, poItm.pendQty, poItm.shortclsQty, poItm.Uom, 
                DATE_FORMAT(poItm.SchDate, '%d-%m-%Y') AS SchDate,  DATE_FORMAT(po.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
                itm.itemCode, poItm.PartName As itemName, itm.stdRate, itm.id AS itemId,
                c.cCode, c.cName, c.gstNo, c.id AS customerId,
                gst.invNo, DATE_FORMAT(gst.date, '%d-%m-%Y') AS invDate, gsi.invQty
            FROM 
                purchase_order po
            INNER JOIN 
                purchas_order_item as poItm ON po.id = poItm.purchase_order_id
            INNER JOIN 
                customer as c ON po.customer = c.cId
            INNER JOIN 
                items as itm ON poItm.partno = itm.itemCode
            LEFT JOIN
                gstsalesinvoitem as gsi ON poItm.id = gsi.poItemId    
            LEFT JOIN
                gstsalesinvo as gst ON gsi.gstsalesinvo_id = gst.id    
        `;

        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(po.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(custId) && custId.length > 0) {
            conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
            queryParams.push(...custId);
        }

        if (Array.isArray(item) && item.length > 0) {
            conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
            queryParams.push(...item);
        }

        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        const [rows] = await connection.execute(query, queryParams);

        // If type is "Pending", filter out rows where pendQty <= 0
        let filteredRows = rows;
        // if (type === "Pending") {
        //     filteredRows = rows.filter(r => (r.pendQty || 0) > 0);
        // }

        if (type === "Pending") {
            filteredRows = rows.filter(r => 
                (Number(r.pendQty || 0) - Number(r.shortclsQty || 0)) > 0
            );
        }

        const groupedData = {};

        filteredRows.forEach(row => {
            if (!groupedData[row.customerId]) {
                groupedData[row.customerId] = {
                    customerId: row.customerId,
                    cName: row.cName,
                    cCode: row.cCode,
                    gst: row.gstNo,
                    po: []
                };
            }

            let customerGroup = groupedData[row.customerId];

            let soGroup = customerGroup.po.find(po => po.sino === row.sino);
            if (!soGroup) {
                soGroup = {
                    sino: row.sino,
                    soNo: row.sodigit,
                    soDate: row.date,
                    poNo: row.poNo,
                    poDate: row.poDate,
                    items: []
                };
                customerGroup.po.push(soGroup);
            }

            let existingItem = soGroup.items.find(item => item.poItemId === row.poItemId);

            if (!existingItem) {
                soGroup.items.push({
                    id: soGroup.items.length + 1,
                    sNo: soGroup.items.length + 1,
                    poItemId: row.poItemId,
                    itemId: row.itemId,
                    itemCode: row.itemCode,
                    itemName: row.itemName,
                    uom: row.Uom,
                    schDate: row.SchDate,
                    soQty: row.Qty,
                    rate: row.Rate,
                    amt: row.Amt,
                    pendingQty: row.pendQty,
                    shortQty: row.shortclsQty,
                    invList: row.invNo ? [{
                        invQty: row.invQty,
                        invNo: row.invNo,
                        invDate: row.invDate
                    }] : []
                });
            } else {
                if (row.invNo && !existingItem.invList.some(inv => inv.invNo === row.invNo)) {
                    existingItem.invList.push({
                        invQty: row.invQty,
                        invNo: row.invNo,
                        invDate: row.invDate
                    });
                }
            }
        });

        Object.values(groupedData).forEach(customer => {
            customer.po.forEach(po => {
                po.items.forEach(item => {
                    item.invoicedQty = item.invList.reduce((sum, inv) => sum + (inv.invQty || 0), 0);
                });
            });
        });

        const result = Object.values(groupedData);

        return res.status(200).json({
            success: true,
            message: "Sale Register list",
            data: result
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};



exports.custPo = async (req, res) => {
    try {
        const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

        const fromDate = repo.from;
        const toDate = repo.to;
        const custId = repo.customer;

        let query = `   
            SELECT 
                po.sodigit, DATE_FORMAT(po.date, '%d-%m-%Y') AS date, c.cCode, c.cName,  po.poNo, DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
                po.pay_term, po.narration, po.shortCls,  po.addedBy,  po.changedBy, DATE_FORMAT(po.created_at, '%d-%m-%Y') AS addedOn, 
                po.totalQty, po.grandTotal, DATE_FORMAT(po.updated_at, '%d-%m-%Y') AS changedOn
            FROM 
                purchase_order po
            INNER JOIN 
                customer as c ON po.customer = c.cId
        `;

        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(po.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(custId) && custId.length > 0) {
            conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
            queryParams.push(...custId);
        }

        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        const [rows] = await connection.execute(query, queryParams);

        return handleSuccessResponse(res, 'Customer Po list', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



exports.invCustDc = async (req, res) => {
    try {
        const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

        // Dates from the payload
        const fromDate = repo.from;
        const toDate = repo.to;
        const custId = repo.customer; // Expecting an array like [1, 2, 3]

        // Base query
        let query = `   
            SELECT  
                gst.invNo, gst.modelOfDis AS modeOfDispath,
                gsi.id, gsi.invQty AS dcQty, gsi.invRate, gsi.invAmt,
                DATE_FORMAT(gst.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate,
                itm.itemCode, itm.itemName, itm.id AS itemId,
                cdc.cust_Dc_no, DATE_FORMAT(cdc.customerDcDate, '%d-%m-%Y') AS custDcDate,
                c.cCode, c.cName, c.gstNo   
            FROM 
                gstsalesinvoitem gsi
            INNER JOIN 
                gstsalesinvo as gst ON gst.id = gsi.gstsalesinvo_id
            INNER JOIN 
                customer as c ON gst.custName = c.cId
            INNER JOIN 
               items as itm ON REPLACE(gsi.partno, '-DC', '') = itm.itemCode
            LEFT JOIN 
                customer_dc_parts as cdcp ON cdcp.id = gsi.cdcItmId 
            LEFT JOIN 
                customer_dc as cdc ON cdc.id = cdcp.CDC_no`;

        // Collect conditions and query parameters
        const queryParams = [];
        const conditions = [];

        // Add date range condition
        if (fromDate && toDate) {
            conditions.push('DATE(gst.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        // Add customer ID condition
        if (Array.isArray(custId) && custId.length > 0) {
            conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
            queryParams.push(...custId);
        }

        // Add conditions to the query
        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        // Ensure that `gsi.cdcItmId IS NOT NULL` is properly added
        if (conditions.length) {
            query += ' AND gsi.cdcItmId IS NOT NULL';
        }
        else {
            query += ' WHERE gsi.cdcItmId IS NOT NULL';
        }

        // Execute the query
        const [result] = await connection.execute(query, queryParams);

        return res.status(200).json({
            success: true,
            message: "Invoice CustomerDc list",
            data: result
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};




// Export to Excel function
exports.exportInvCustDcToExcel = async (req, res) => {
    try {
        // Call saleRegister to get the data
        const saleInvoiceData = await getInvCustDcData(req); // Fetch the data

        // Validate if data exists and is in the correct format
        if (!saleInvoiceData || !Array.isArray(saleInvoiceData) || saleInvoiceData.length === 0) {
            return res.status(404).json({ success: false, message: "No data available for export." });
        }

        // //console.log(saleInvoiceData);

        // Create a new Excel workbook and worksheet
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sale Invoice');

        // Add header row
        worksheet.columns = [
            { header: 'Invoice No', key: 'invNo', width: 15 },
            { header: 'Invoice Date', key: 'date', width: 15 },
            { header: 'Customer DC No', key: 'cust_Dc_no', width: 15 },
            { header: 'Cust DC Date', key: 'custDcDate', width: 15 },
            { header: 'Customer Name', key: 'cName', width: 20 },
            { header: 'Delivery Mode', key: 'modeOfDispath', width: 20 },
            { header: 'Item Code', key: 'itemCode', width: 15 },
            { header: 'Item Name', key: 'itemName', width: 15 },
            { header: 'DC Qty', key: 'dcQty', width: 20 },
            { header: 'DC Rate', key: 'invRate', width: 15 },
            { header: 'DC Amt', key: 'invAmt', width: 15 },

        ];

        // Style the header row to make it bold
        worksheet.getRow(1).eachCell(cell => {
            cell.font = { bold: true };
        });

        // Add data rows
        saleInvoiceData.forEach(invoice => {
            worksheet.addRow({
                invNo: invoice.invNo,
                date: invoice.date,
                cust_Dc_no: invoice.cust_Dc_no,
                custDcDate: invoice.custDcDate,
                cName: invoice.cName,
                modeOfDispath: invoice.modeOfDispath,
                itemCode: invoice.itemCode,
                itemName: invoice.itemName,
                dcQty: invoice.dcQty,
                invRate: invoice.invRate,
                invAmt: invoice.invAmt,

            });
        });


        // Write workbook to a buffer
        const buffer = await workbook.xlsx.writeBuffer();

        // Send the buffer as a downloadable file
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=SaleInvoice.xlsx');
        res.send(buffer);

    } catch (err) {
        console.error('Error exporting sale register to Excel:', err);
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};

// Helper function to get sale register data
async function getInvCustDcData(req) {
    return new Promise((resolve, reject) => {
        exports.invCustDc(req, {
            status: (code) => ({
                json: (response) => {
                    if (code === 200) {
                        resolve(response.data);
                    } else {
                        reject(new Error(response.message || 'Failed to fetch sale register data.'));
                    }
                },
            }),
        });
    });
}



exports.cancelSaleInvoice = async (req, res) => {
    try {
        const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

        // Ensure dates are in the correct format and include time
        const fromDate = repo.from;
        const toDate = repo.to;
        const custId = repo.customer; // Expecting an array like [1, 2, 3]
        const item = repo.item; // Expecting an array like [1, 2, 3]

        // Sub query
        let query = `   
            SELECT  
                gst.*, gsi.*, gst.id AS mainId, gsi.id as listId,gsi.invAmt,
                DATE_FORMAT(gst.date, '%d-%m-%Y') AS date, 
                DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate,
                itm.itemCode, gsi.partName As itemName, itm.id AS itemId, 
                CONCAT(po.poNo, '/', DATE_FORMAT(po.poDate, '%d-%m-%Y')) AS poWithDate,
                DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
                c.cCode, c.cName, c.gstNo, ihs.description AS tariff, gst.totalInWords
            FROM 
                gstsalesinvoitem gsi
            INNER JOIN 
                gstsalesinvo as gst ON gst.id = gsi.gstsalesinvo_id
            INNER JOIN 
                customer as c ON gst.custName = c.cId
            INNER JOIN 
                items as itm ON gsi.partno = itm.itemCode
            INNER JOIN 
                purchase_order as po ON po.id = gsi.poId    
            LEFT JOIN 
                item_hsn_code as ihs ON gsi.hsnCode = ihs.name
        `;

        // Collect conditions
        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(gsi.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(custId) && custId.length > 0) {
            conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
            queryParams.push(...custId);
        }

        // Add item filter condition
        if (Array.isArray(item) && item.length > 0) {
            conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
            queryParams.push(...item);
        }

        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        // Always apply cancel auth filter
        query += ` AND gst.isCancelAuth = 1`;

        // Execute the query
        const [rows] = await connection.execute(query, queryParams);

        // Group rows by mainId
        const groupedData = {};
        let totalValue = 0, amtOfGstPay = 0;


        rows.forEach(row => {
            // Initialize main group by mainId
            if (!groupedData[row.mainId]) {
                groupedData[row.mainId] = {
                    mainId: row.mainId,
                    invNo: row.invNo,
                    invDate: row.date,
                    cCode: row.cCode,
                    cName: row.cName,
                    invIssueDate: row.invoIssuDate,
                    gstNo: row.gstNo,
                    invDtl: [] // Initialize invDtl array
                };
            }

            // Push stock details into invDtl
            const invDetails = {
                id: row.listId,
                itemCode: row.itemCode,
                itemName: row.itemName,
                itemId: row.itemId,
                hsnCode: row.hsnCode,
                uom: row.uom,
                invQty: row.invQty,
                invRate: row.invRate,
                invAmt: row.invAmt,
                modeOfDispatch: row.modelOfDis,
                vechileNO: row.vechileNO,
                poNo2: row.poNo,
                poNo: row.poWithDate,
                poDate: row.poDate,
                subtotal: row.subtotal,
                taxableValueforGST: row.taxableValueforGST,
                lessDisc: row.lessDisc,
                lessOther: row.lessOther,
                subTotAfterDisc: row.subTotAfterDisc,
                transportCharges: row.transportCharges,
                CGST: row.CGST,
                CGSTPer: row.CGSTPer,
                SGST: row.SGST,
                SGSTPer: row.SGSTPer,
                IGST: row.IGST,
                IGSTPer: row.IGSTPer,
                UTGST: row.UTGST,
                UTGSTPer: row.UTGSTPer,
                totGst: row.totGst,
                tcs: row.tcs,
                totalValue: row.invValue,
                amtOfGstPay: row.amtOfGstPay,
                dcNO: null,
                dcDate: null,
                cessOnTcs: row.cessOnTcs,
                cessOnTcsPer: row.cessOnTcsPer,
                subChargeOnTcs: row.subChargeOnTcs,
                subChargeOnTcsPer: row.subChargeOnTcsPer,
                insurance: row.Insurance,
                ammortisationCost: row.AmmortisationCost,
                tcsPer: row.tcsPer,
                tcsPercessOnTcsPer: row.cessOnTcsPer,
                tariff: row.tariff,
                totalInWords: row.totalInWords
            };

            groupedData[row.mainId].invDtl.push(invDetails);
            totalValue += Number(row.invValue);
            // amtOfGstPay += Number(row.amtOfGstPay);
        });
        const row = {
            "mainId": 'ID001',
            "invNo": "Grand Total",
            "totalValue" :totalValue.toFixed(2),
            "invDtl": [
                {
                    totalValue: totalValue.toFixed(2)
                }
            ]
        };

        // Convert groupedData object to an array
        const result = Object.values(groupedData);
        result.push(row);

        return res.status(200).json({
            success: true,
            message: "Sale Invoice list",
            data: result
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};





exports.cancelInvSummary = async (req, res) => {
    try {
        const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

        // Ensure dates are in the correct format and include time
        const fromDate = repo.from;
        const toDate = repo.to;
        const custId = repo.customer; // Expecting an array like [1, 2, 3]

        // Sub query
        let query = `   
            SELECT  
                gst.id, gst.invNo, gst.vechileNO, gst.invNo,  gst.totalQty, gst.taxableValueforGST, gst.lessDisc, gst.lessOther, gst.subTotAfterDisc, gst.packingForw,
                gst.subTotAfterDisc, gst.packingForw, gst.transportCharges, gst.subtotal,  gst.Insurance, gst.custMeterialValue, gst.AmmortisationCost, gst.amtOfGstPay, 
                gst.CGSTPer, gst.CGST, gst.SGSTPer, gst.SGST,  gst.CGSTPer, gst.CGST, gst.SGSTPer, gst.SGST,  gst.IGSTPer, gst.IGST, gst.UTGSTPer, gst.UTGST,
                gst.tcsPer, gst.tcs, gst.roundOff, gst.invValue,  gst.totalValue,
                gsi.hsnCode,  gsi.itemLedger, gsi.uom, DATE_FORMAT(gst.date, '%d-%m-%Y') AS date, 
                DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate,
                CONCAT(po.poNo, '/', DATE_FORMAT(po.poDate, '%d-%m-%Y')) AS poWithDate,  po.poNo,
                DATE_FORMAT(po.poDate, '%d-%m-%Y') AS poDate,
                c.cCode, c.cName, c.gstNo, ihs.description AS tariff, gst.totalInWords
            FROM 
                gstsalesinvo gst
            INNER JOIN 
                gstsalesinvoitem as gsi ON gst.id = gsi.gstsalesinvo_id
            INNER JOIN 
                customer as c ON gst.custName = c.cId
            INNER JOIN 
                purchase_order as po ON po.id = gsi.poId    
            LEFT JOIN 
                item_hsn_code as ihs ON gsi.hsnCode = ihs.name
        `;

        // Collect conditions
        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(gsi.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(custId) && custId.length > 0) {
            conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
            queryParams.push(...custId);
        }



        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        // Always apply cancel auth filter
        query += ` AND gst.isCancelAuth = 1 GROUP BY  gst.id`;

        // Execute the query
        const [rows] = await connection.execute(query, queryParams);


        return res.status(200).json({
            success: true,
            message: "Cncel Sale Invoice Summary",
            data: rows
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};



exports.creditNote = async (req, res) => {
    try {
        const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

        const fromDate = repo.from;
        const toDate = repo.to;
        const custId = repo.customer;
        const item = repo.item;

        let query = `   
            SELECT  
                credit.id AS mainId, credit.returnNo, credit.invNo, 
                DATE_FORMAT(credit.date, '%d-%m-%Y') AS creditNoteDate, 

                creditDtl.id as listId, creditDtl.retd, creditDtl.value, 
                creditDtl.cgstRate, creditDtl.cgstAmt, 
                creditDtl.sgstRate, creditDtl.sgstAmt,  
                creditDtl.igstRate, creditDtl.igstAmt,

                DATE_FORMAT(gst.date, '%d-%m-%Y') AS invDate, 
                DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate,

                itm.itemCode, gsi.partName As itemName, 
                itm.id AS itemId, gsi.hsnCode, gsi.uom, 
                gsi.invQty, gsi.invRate, gsi.invAmt,

                CONCAT(po.poNo, '/', DATE_FORMAT(po.poDate, '%d-%m-%Y')) AS poWithDate,

                c.cCode, c.cName, c.gstNo, 
                ihs.description AS tariff, gst.totalInWords
            FROM 
                credit_note_dtl creditDtl
            INNER JOIN credit_note_mst credit ON credit.id = creditDtl.creditNote_mstId
            INNER JOIN gstsalesinvo gst ON gst.id = credit.gstMstId
            INNER JOIN gstsalesinvoitem gsi ON gsi.id = creditDtl.gstItemsDtlId
            INNER JOIN customer c ON gst.custName = c.cId
            INNER JOIN items itm ON creditDtl.itemId = itm.id
            INNER JOIN purchase_order po ON po.id = gsi.poId    
            LEFT JOIN item_hsn_code ihs ON gsi.hsnCode = ihs.name
        `;

        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(creditDtl.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(custId) && custId.length > 0) {
            conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
            queryParams.push(...custId);
        }

        if (Array.isArray(item) && item.length > 0) {
            conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
            queryParams.push(...item);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        } else {
            query += ' WHERE 1=1';
        }

        const [rows] = await connection.execute(query, queryParams);

        const groupedData = {};
        let totalValue = 0;

        rows.forEach(row => {
            if (!groupedData[row.mainId]) {
                groupedData[row.mainId] = {
                    mainId: row.mainId,
                    returnNo: row.returnNo,
                    creditNoteDate: row.creditNoteDate,
                    invNo: row.invNo,
                    invDate: row.invDate,
                    cCode: row.cCode,
                    cName: row.cName,
                    invIssueDate: row.invoIssuDate,
                    gstNo: row.gstNo,
                    invDtl: []
                };
            }

            groupedData[row.mainId].invDtl.push({
                id: row.listId,
                itemCode: row.itemCode,
                itemName: row.itemName,
                itemId: row.itemId,
                hsnCode: row.hsnCode,
                uom: row.uom,
                invQty: row.invQty,
                invRate: row.invRate,
                invAmt: row.invAmt,
                retd: row.retd,
                value: row.value,
                poNo: row.poWithDate,
                CGST: row.cgstAmt,
                CGSTPer: row.cgstRate,
                SGST: row.sgstAmt,
                SGSTPer: row.sgstRate,
                IGST: row.igstAmt,
                IGSTPer: row.igstRate
            });

            totalValue += Number(row.value || 0);
        });

        const result = Object.values(groupedData);

        return res.status(200).json({
            success: true,
            message: "Credit Note list",
            data: result
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};


// exports.custDc = async (req, res) => {
//     try {
//         const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

//         const fromDate = repo.from;
//         const toDate = repo.to;
//         const custId = repo.customer;
//         const item = repo.items;

//         let query = `   
//             SELECT 
//                 dc.*, dcDtl.*, DATE_FORMAT(dc.customerDcDate, '%d-%m-%Y') AS customerDcDate,
//                 DATE_FORMAT(dc.date, '%d-%m-%Y') AS cdcDate, ndc.nrdcNo, 
//                 DATE_FORMAT(ndc.date, '%d-%m-%Y') AS ndcDate,  DATE_FORMAT(gst.date, '%d-%m-%Y') AS invDate,
//                 itm.itemCode, itm.itemName, itm.stdRate, itm.id AS itemId, 
//                 c.cCode, c.cName, c.gstNo, c.id AS customerId, gst.invNo, gst.dcNO,
//                 CASE 
//                     WHEN ndci.id IS NOT NULL THEN ndci.nrdcQty 
//                     ELSE gsi.invQty 
//                 END AS invQty
//             FROM 
//                 customer_dc dc
//             INNER JOIN 
//                 customer_dc_parts as dcDtl ON dc.id = dcDtl.CDC_no
//             INNER JOIN 
//                 customer as c ON dc.cust = c.cId
//             INNER JOIN 
//                 items as itm ON dcDtl.partno = itm.itemCode
//             LEFT JOIN
//                 gstsalesinvoitem as gsi ON gsi.cdcItmId = dcDtl.id
//             LEFT JOIN
//                 gstsalesinvo as gst ON gsi.gstsalesinvo_id = gst.id
//             LEFT JOIN
//                 nonreturnabledcitem as ndci ON ndci.cdcNo = dc.cdcNo AND dcDtl.partno = ndci.itemCode
//             LEFT JOIN
//                 nonreturnabledc as ndc ON ndc.id = ndci.nonDcid 
//         `;

//         const queryParams = [];
//         const conditions = [];

//         if (fromDate && toDate) {
//             conditions.push('DATE(dc.created_at) BETWEEN ? AND ?');
//             queryParams.push(fromDate, toDate);
//         }

//         if (Array.isArray(custId) && custId.length > 0) {
//             conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
//             queryParams.push(...custId);
//         }

//         if (Array.isArray(item) && item.length > 0) {
//             conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
//             queryParams.push(...item);
//         }

//         if (conditions.length) {
//             query += ' WHERE ' + conditions.join(' AND ');
//         }

//         const toDateObj = new Date(toDate);

//         const [rows] = await connection.execute(query, queryParams);

//         const groupedData = {};

//         rows.forEach(row => {
//             if (!groupedData[row.customerId]) {
//                 groupedData[row.customerId] = {
//                     customerId: row.customerId,
//                     cName: row.cName,
//                     cCode: row.cCode,
//                     gst: row.gstNo,
//                     po: []
//                 };
//             }

//             const customerGroup = groupedData[row.customerId];

//             let dcGroup = customerGroup.po.find(po => po.cdcNo === row.cdcNo);
//             if (!dcGroup) {
//                 let diffDays = null;
//                 if (row.customerDcDate) {
//                     const [dd, mm, yyyy] = row.customerDcDate.split('-');
//                     const custDcDateObj = new Date(`${yyyy}-${mm}-${dd}`);
//                     const diffTime = toDateObj - custDcDateObj;
//                     diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
//                 }

//                 dcGroup = {
//                     custDcNo: row.cust_Dc_no || '', // fallback if null
//                     custDcDate: row.customerDcDate,
//                     cdcNo: row.cdcNo,
//                     cdcDate: row.cdcDate,
//                     dcNO: row.dcNO,
//                     daysDiff: diffDays,
//                     items: []
//                 };
//                 customerGroup.po.push(dcGroup);
//             }

//             const type = repo.type; // Ensure this is defined before the loop
//             if (type === "Summary") {
//                 const existingItem = dcGroup.items.find(itm => itm.itemCode === row.itemCode);
//                 if (existingItem) {
//                     // existingItem.cdcQty += Number(row.qty) || 0;
//                     existingItem.invoicedQty += Number(row.accQty) || 0;
//                     existingItem.pendingQty += Number(row.pendQty) || 0;
//                     existingItem.shortQty += Number(row.shortclsQty) || 0;
//                     existingItem.invQty += Number(row.invQty) || 0;
//                     existingItem.cumQty += Number(row.cumQty) || 0;
//                     // existingItem.value += Number(row.amt) || 0;
//                     const effectiveRate = Number(row.rate) || Number(row.stdRate) || 0;
//                     existingItem.value += (Number(row.invQty) || 0) * effectiveRate;
//                 } else {
//                     const effectiveRate = Number(row.rate) || Number(row.stdRate) || 0;

//                     dcGroup.items.push({
//                         id: dcGroup.items.length + 1,
//                         sNo: dcGroup.items.length + 1,
//                         itemGroup: row.itemGroup || '',
//                         itemId: row.itemId,
//                         itemCode: row.itemCode,
//                         itemName: row.itemName,
//                         uom: row.uom,
//                         hsnCode: row.hsnCode,
//                         unitRate: Number(row.rate) || Number(row.stdRate) || 0,
//                         // value: Number(row.amt) || 0,
//                         value: (Number(row.invQty) || 0) * effectiveRate,
//                         cdcQty: Number(row.qty) || 0,
//                         invoicedQty: Number(row.accQty) || 0,
//                         pendingQty: Number(row.pendQty) || 0,
//                         shortQty: Number(row.shortclsQty) || 0,
//                         invQty: Number(row.invQty) || 0,
//                         cumQty: Number(row.cumQty) || 0,
//                         nrdc_No: row.nrdcNo,
//                         nrdcDate: row.ndcDate,
//                         po_ref: row.po_ref,
//                         invNo: row.invNo,
//                         invDate: row.invDate
//                     });
//                 }
//             }
//             else {
//                 const effectiveRate = Number(row.rate) || Number(row.stdRate) || 0;

//                 // Default behavior: Push all items as-is
//                 dcGroup.items.push({
//                     id: dcGroup.items.length + 1,
//                     sNo: dcGroup.items.length + 1,
//                     itemGroup: row.itemGroup || '',
//                     itemId: row.itemId,
//                     itemCode: row.itemCode,
//                     itemName: row.itemName,
//                     uom: row.uom,
//                     hsnCode: row.hsnCode,
//                     unitRate: row.rate || row.stdRate || 0,
//                     // value: row.amt || 0,
//                     value: (Number(row.invQty) || 0) * effectiveRate,
//                     cdcQty: row.qty || 0,
//                     invoicedQty: row.accQty || 0,
//                     pendingQty: row.pendQty || 0,
//                     shortQty: row.shortclsQty || 0,
//                     invQty: row.invQty || 0,
//                     cumQty: row.cumQty || 0,
//                     nrdc_No: row.nrdcNo,
//                     nrdcDate: row.ndcDate,
//                     po_ref: row.po_ref,
//                     invNo: row.invNo,
//                     invDate: row.invDate
//                 });
//             }
//         });

//         const result = Object.values(groupedData);

//         return res.status(200).json({
//             success: true,
//             message: "Customer DC list",
//             data: result
//         });

//     } catch (err) {
//         return res.status(err.statusCode || 500).json({
//             success: false,
//             message: err.message || 'An error occurred'
//         });
//     }
// };


exports.custDc = async (req, res) => {
    try {
        const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

        const fromDate = repo.from;
        const toDate = repo.to;
        const custId = repo.customer;
        const item = repo.items;

        //  Handle boolean/string
        const isPending = repo.isPending === true || repo.isPending === "true";

        let query = `   
            SELECT 
                dc.*, dcDtl.*, DATE_FORMAT(dc.customerDcDate, '%d-%m-%Y') AS customerDcDate,
                DATE_FORMAT(dc.date, '%d-%m-%Y') AS cdcDate, ndc.nrdcNo, 
                DATE_FORMAT(ndc.date, '%d-%m-%Y') AS ndcDate,  
                DATE_FORMAT(gst.date, '%d-%m-%Y') AS invDate,
                itm.itemCode, itm.itemName, itm.stdRate, itm.id AS itemId, 
                c.cCode, c.cName, c.gstNo, c.id AS customerId, 
                gst.invNo, gst.dcNO,
                CASE 
                    WHEN ndci.id IS NOT NULL THEN ndci.nrdcQty 
                    ELSE gsi.invQty 
                END AS invQty
            FROM 
                customer_dc dc
            INNER JOIN 
                customer_dc_parts as dcDtl ON dc.id = dcDtl.CDC_no
            INNER JOIN 
                customer as c ON dc.cust = c.cId
            INNER JOIN 
                items as itm ON dcDtl.partno = itm.itemCode
            LEFT JOIN
                gstsalesinvoitem as gsi ON gsi.cdcItmId = dcDtl.id
            LEFT JOIN
                gstsalesinvo as gst ON gsi.gstsalesinvo_id = gst.id
            LEFT JOIN
                nonreturnabledcitem as ndci 
                ON ndci.cdcNo = dc.cdcNo AND dcDtl.partno = ndci.itemCode
            LEFT JOIN
                nonreturnabledc as ndc ON ndc.id = ndci.nonDcid 
        `;

        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(dc.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (Array.isArray(custId) && custId.length > 0) {
            conditions.push(`c.id IN (${custId.map(() => '?').join(', ')})`);
            queryParams.push(...custId);
        }

        if (Array.isArray(item) && item.length > 0) {
            conditions.push(`itm.id IN (${item.map(() => '?').join(', ')})`);
            queryParams.push(...item);
        }

        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        const toDateObj = new Date(toDate);

        const [rows] = await connection.execute(query, queryParams);

        const groupedData = {};

        rows.forEach(row => {

            // ✅ Pending filter logic
            const pendingQty = Number(row.pendQty) || 0;
            const shortQty = Number(row.shortclsQty) || 0;

            if (isPending) {
                if (!(pendingQty > 0 && shortQty === 0)) {
                    return; // skip non-pending rows
                }
            }

            // ---------------- GROUPING ----------------

            if (!groupedData[row.customerId]) {
                groupedData[row.customerId] = {
                    customerId: row.customerId,
                    cName: row.cName,
                    cCode: row.cCode,
                    gst: row.gstNo,
                    po: []
                };
            }

            const customerGroup = groupedData[row.customerId];

            let dcGroup = customerGroup.po.find(po => po.cdcNo === row.cdcNo);

            if (!dcGroup) {
                let diffDays = null;

                if (row.customerDcDate) {
                    const [dd, mm, yyyy] = row.customerDcDate.split('-');
                    const custDcDateObj = new Date(`${yyyy}-${mm}-${dd}`);
                    const diffTime = toDateObj - custDcDateObj;
                    diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }

                dcGroup = {
                    custDcNo: row.cust_Dc_no || '',
                    custDcDate: row.customerDcDate,
                    cdcNo: row.cdcNo,
                    cdcDate: row.cdcDate,
                    dcNO: row.dcNO,
                    daysDiff: diffDays,
                    items: []
                };

                customerGroup.po.push(dcGroup);
            }

            const type = repo.type;

            if (type === "Summary") {
                const existingItem = dcGroup.items.find(itm => itm.itemCode === row.itemCode);

                if (existingItem) {
                    existingItem.invoicedQty += Number(row.accQty) || 0;
                    existingItem.pendingQty += Number(row.pendQty) || 0;
                    existingItem.shortQty += Number(row.shortclsQty) || 0;
                    existingItem.invQty += Number(row.invQty) || 0;
                    existingItem.cumQty += Number(row.cumQty) || 0;

                    const effectiveRate = Number(row.rate) || Number(row.stdRate) || 0;
                    existingItem.value += (Number(row.invQty) || 0) * effectiveRate;

                } else {
                    const effectiveRate = Number(row.rate) || Number(row.stdRate) || 0;

                    dcGroup.items.push({
                        id: dcGroup.items.length + 1,
                        sNo: dcGroup.items.length + 1,
                        itemGroup: row.itemGroup || '',
                        itemId: row.itemId,
                        itemCode: row.itemCode,
                        itemName: row.itemName,
                        uom: row.uom,
                        hsnCode: row.hsnCode,
                        unitRate: Number(row.rate) || Number(row.stdRate) || 0,
                        value: (Number(row.invQty) || 0) * effectiveRate,
                        cdcQty: Number(row.qty) || 0,
                        invoicedQty: Number(row.accQty) || 0,
                        pendingQty: Number(row.pendQty) || 0,
                        shortQty: Number(row.shortclsQty) || 0,
                        invQty: Number(row.invQty) || 0,
                        cumQty: Number(row.cumQty) || 0,
                        nrdc_No: row.nrdcNo,
                        nrdcDate: row.ndcDate,
                        po_ref: row.po_ref,
                        invNo: row.invNo,
                        invDate: row.invDate
                    });
                }

            } else {
                const effectiveRate = Number(row.rate) || Number(row.stdRate) || 0;

                dcGroup.items.push({
                    id: dcGroup.items.length + 1,
                    sNo: dcGroup.items.length + 1,
                    itemGroup: row.itemGroup || '',
                    itemId: row.itemId,
                    itemCode: row.itemCode,
                    itemName: row.itemName,
                    uom: row.uom,
                    hsnCode: row.hsnCode,
                    unitRate: row.rate || row.stdRate || 0,
                    value: (Number(row.invQty) || 0) * effectiveRate,
                    cdcQty: row.qty || 0,
                    invoicedQty: row.accQty || 0,
                    pendingQty: row.pendQty || 0,
                    shortQty: row.shortclsQty || 0,
                    invQty: row.invQty || 0,
                    cumQty: row.cumQty || 0,
                    nrdc_No: row.nrdcNo,
                    nrdcDate: row.ndcDate,
                    po_ref: row.po_ref,
                    invNo: row.invNo,
                    invDate: row.invDate
                });
            }
        });

        const result = Object.values(groupedData);

        return res.status(200).json({
            success: true,
            message: "Customer DC list",
            data: result
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};

exports.nrdcCust = async (req, res) => {
    try {
        const { from, to, customer} = req.body;

        // Base query
        let query = `
            SELECT  
                DATE_FORMAT(nrdc.date, '%d-%m-%Y') AS nrdcDate, nrdc.nrdcNo, c.cName, c.gstNo, ndc.hsnCode, nrdc.cgstPer, nrdc.cgst, nrdc.sgstPer, nrdc.sgst, 
                nrdc.igstPer, nrdc.igst, nrdc.total,  nrdc.totalValue, nrdc.totalQty,  nrdc.Remarks
            FROM 
                nonreturnabledc AS nrdc
    
            JOIN
                customer AS c ON nrdc.custo = c.id
            JOIN
                nonreturnabledcitem AS ndc ON ndc.nonDcid = nrdc.id    
    
            WHERE 1 = 1
        `;

        // Collect conditions and query parameters
        const queryParams = [];

        // Add date range condition
        if (from && to) {
            query += ' AND DATE(nrdc.created_at) BETWEEN ? AND ?';
            queryParams.push(from, to);
        }

        // Add customer filter condition
        if (Array.isArray(customer) && customer.length > 0) {
            query += ` AND c.id IN (${customer.map(() => '?').join(', ')})`;
            queryParams.push(...customer);
        }


        // GROUP BY must be last
        query += ` GROUP BY nrdc.id`;


        // Execute the query
        const [result] = await connection.execute(query, queryParams);

        return handleSuccessResponse(res, 'Nrdc CustomerWise Report', result);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}



exports.exportCustDcToExcel = async (req, res) => {
    try {
        // Call custDc to get the data
        const custDcData = await getCustDcData(req);

        // Validate if data exists and is in the correct format
        if (!custDcData || !Array.isArray(custDcData) || custDcData.length === 0) {
            return res.status(404).json({ success: false, message: "No data available for export." });
        }

        // Create a new Excel workbook and worksheet
        const excel = require('exceljs');
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Customer DC');

        // Add header row
        worksheet.columns = [
            { header: 'Customer Name', key: 'cName', width: 20 },
            { header: 'Customer Code', key: 'cCode', width: 15 },
            { header: 'GST No', key: 'gst', width: 20 },
            { header: 'CDC No', key: 'cdcNo', width: 15 },
            { header: 'Customer DC No', key: 'custDcNo', width: 20 },
            { header: 'DC Date', key: 'dcDate', width: 15 },
            { header: 'Item Code', key: 'itemCode', width: 15 },
            { header: 'Item Name', key: 'itemName', width: 20 },
            { header: 'UOM', key: 'uom', width: 10 },
            { header: 'Unit Rate', key: 'unitRate', width: 15 },
            { header: 'Value', key: 'value', width: 15 },
            { header: 'CDC Qty', key: 'cdcQty', width: 15 },
            { header: 'Invoiced Qty', key: 'invoicedQty', width: 15 },
            { header: 'Pending Qty', key: 'pendingQty', width: 15 },
            { header: 'Invoice Qty', key: 'invQty', width: 15 },
            { header: 'NRDC No', key: 'nrdc_No', width: 15 },
            { header: 'NRDC Date', key: 'nrdcDate', width: 15 },
            { header: 'PO Reference', key: 'po_ref', width: 15 },
            { header: 'Invoice No', key: 'invNo', width: 15 },
            { header: 'DC NO', key: 'dcNO', width: 15 },
        ];

        // Style the header row to make it bold
        worksheet.getRow(1).eachCell(cell => {
            cell.font = { bold: true };
        });

        // Add data rows
        custDcData.forEach(customer => {
            customer.po.forEach(dc => {
                dc.items.forEach(item => {
                    worksheet.addRow({
                        cName: customer.cName,
                        cCode: customer.cCode,
                        gst: customer.gst,
                        cdcNo: dc.cdcNo,
                        custDcNo: dc.custDcNo,
                        dcDate: dc.dcDate,
                        itemCode: item.itemCode,
                        itemName: item.itemName,
                        uom: item.uom,
                        unitRate: item.unitRate,
                        value: item.value,
                        cdcQty: item.cdcQty,
                        invoicedQty: item.invoicedQty,
                        pendingQty: item.pendingQty,
                        invQty: item.invQty,
                        nrdc_No: item.nrdc_No,
                        nrdcDate: item.nrdcDate,
                        po_ref: item.po_ref,
                        invNo: item.invNo,
                        dcNO: item.dcNO,
                    });
                });
            });
        });

        // Write workbook to a buffer
        const buffer = await workbook.xlsx.writeBuffer();

        // Send the buffer as a downloadable file
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=CustomerDC.xlsx');
        res.send(buffer);

    } catch (err) {
        console.error('Error exporting Customer DC to Excel:', err);
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};

// Helper function to get custDc data
async function getCustDcData(req) {
    return new Promise((resolve, reject) => {
        exports.custDc(req, {
            status: (code) => ({
                json: (response) => {
                    if (code === 200) {
                        resolve(response.data);
                    } else {
                        reject(new Error(response.message || 'Failed to fetch Customer DC data.'));
                    }
                },
            }),
        });
    });
}






exports.fgStockRepo = async (req, res) => {
    try {
        const repo = req.body && Object.keys(req.body).length ? req.body : req.query;

        const fromDate = repo.from;
        const toDate = repo.to;
        const type = repo.type;

        let query = `
            SELECT  
                fg.id, fg.itemCode, fg.poNo, fg.inwardQty, fg.outwardQty, fg.totQty, fg.shipmentDate,
                i.itemName, dn.createdBy AS delUser, dn.delNoteNo,  qc.addedBy AS qcUser,  g.invNo,
                DATE_FORMAT(fg.created_at, '%d-%m-%Y') AS date, DATE_FORMAT(fg.kanbanDate, '%d-%m-%Y') AS kanbanDate

            FROM 
                fg_stocks AS fg
            LEFT JOIN 
                items AS i ON i.itemCode = fg.itemCode
            LEFT JOIN 
                gstsalesinvoitem AS gsi ON gsi.id = fg.outwardId
            LEFT JOIN 
                gstsalesinvo AS g ON g.id = gsi.gstsalesinvo_id    
            LEFT JOIN 
                items_qlty_inspeclist_mst AS qc ON qc.id = fg.inwardId           
            LEFT JOIN 
                del_note_mst AS dn ON dn.id = gsi.delMstId    
            LEFT JOIN 
                purchase_order AS po ON po.id = gsi.poId        

        `;

        const queryParams = [];
        const conditions = [];

        // Move this to conditions array

        if(type == 1){
         conditions.push('fg.completed = 1');
        }
        // queryParams.push(type);

        if (fromDate && toDate) {
            conditions.push('DATE(fg.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }

        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' GROUP BY fg.id';
        query += ' ORDER BY fg.created_at ASC';

        const [result] = await connection.execute(query, queryParams);

        result.forEach((row, index) => {
            row.sNo = index + 1;
        });

        return res.status(200).json({
            success: true,
            message: "FG Stock list",
            data: result
        });

    } catch (err) {
        console.error("Error in fgStockRepo:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'An error occurred'
        });
    }
};





exports.fgStockSum = async (req, res) => {
    try {
    
       const { fromDate, toDate, itemId } = req.body;

        

        //  Main query: group by itemCode (and i.id)
        let query = `
            SELECT 
                i.id,
                i.itemCode,
                i.itemName,
                SUM(fg.inwardQty) AS totalInwardQty,
                SUM(fg.outwardQty) AS totalOutwardQty,
                (
                    SELECT f2.totQty 
                    FROM fg_stocks AS f2 
                    WHERE f2.itemCode = fg.itemCode 
                    ORDER BY f2.id DESC 
                    LIMIT 1
                ) AS totalStock
            FROM fg_stocks AS fg
            INNER JOIN items AS i ON i.itemCode = fg.itemCode
        `;

        const queryParams = [];
        const conditions = [];

        if (fromDate && toDate) {
            conditions.push('DATE(fg.created_at) BETWEEN ? AND ?');
            queryParams.push(fromDate, toDate);
        }
        
        if (itemId) {
            conditions.push('i.id = ?');
            queryParams.push(itemId);
        }

        if (conditions.length) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += `
            GROUP BY i.id, i.itemCode, i.itemName
            ORDER BY i.itemName
        `;

        const [result] = await connection.execute(query, queryParams);

        result.forEach((row, index) => {
            row.sNo = index + 1;
        });

       return handleSuccessResponse(res, "SFG Stock List", result);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



exports.itemLedjer = async (req, res) => {
  try {
    const query = `SELECT * FROM customer_item_under_ledger`;

    const [rows] = await connection.execute(query);
 
    return handleSuccessResponse(res, "Item Ledger List", rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};




// exports.dailyStock = async (req, res) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();
//     try {
//         const { from: fromDate, to: toDate, itemLedger } = req.body;

//         let query = `
//             SELECT 
//                 g.id,
//                 g.invNo,
//                 g.amtOfGstPay,
//                 g.taxableValueforGST,
//                 g.CGSTPer, g.CGST, g.SGSTPer, g.SGST, g.IGSTPer, g.IGST,
//                 DATE_FORMAT(g.date, '%d-%m-%Y') AS date, 
//                 g.totalQty AS outwardQty
//             FROM gstsalesinvo g 
//             INNER JOIN gstsalesinvoitem gi ON gi.gstsalesinvo_id = g.id
//             WHERE gi.cdcItmId IS NULL
//         `;

//         const queryParams = [];

//         if (fromDate && toDate) {
//             query += ' AND DATE(g.date) BETWEEN ? AND ?';
//             queryParams.push(fromDate, toDate);
//         }

//         if (itemLedger) {
//             query += ' AND gi.itemLedger = ?';
//             queryParams.push(itemLedger);
//         }

//         query += `
//             GROUP BY g.id, DATE(g.date)
//             ORDER BY DATE(g.date), g.id
//         `;

//         const [rows] = await conn.execute(query, queryParams);

//         // Generate all dates in range
//         const allDates = [];
//         if (fromDate && toDate) {
//             let start = moment(fromDate);
//             let end = moment(toDate);
//             while (start <= end) {
//                 allDates.push(start.format("DD-MM-YYYY"));
//                 start = start.add(1, "days");
//             }
//         }

//         const result = [];
//         let prevClsQty = 0;

//         // Precompute total outwardQty per date
//         const dateTotals = {};
//         rows.forEach(r => {
//             if (!r.date || r.date === '0000-00-00') return;
//             dateTotals[r.date] = (dateTotals[r.date] || 0) + parseFloat(r.outwardQty || 0);
//         });

//         // Convert rows to dictionary by date
//         const rowsByDate = {};
//         rows.forEach(r => {
//             if (!r.date || r.date === '0000-00-00') return;
//             if (!rowsByDate[r.date]) rowsByDate[r.date] = [];
//             rowsByDate[r.date].push(r);
//         });

      

//         // Loop through all dates to fill missing dates
//         allDates.forEach(dateStr => {
//             const dayRows = rowsByDate[dateStr] || [];

//             if (dayRows.length === 0) {
//                 // 🔹 Push empty day record
//                 result.push({
//                     gstInvId: 0,
//                     invNo: '',
//                     amtOfGstPay: 0,
//                     taxableValueforGST: 0,
//                     CGSTPer: 0, CGST: 0,
//                     SGSTPer: 0, SGST: 0,
//                     IGSTPer: 0, IGST: 0,
//                     date: dateStr,
//                     outwardQty: "0.00",
//                     openQty: prevClsQty.toFixed(2),
//                     fgManufactured: "0.00",
//                     clsQty: prevClsQty.toFixed(2),
//                 });
//             } else {
//                 dayRows.forEach((row, i) => {
//                     const outward = parseFloat(row.outwardQty || 0);
//                     if (i === 0) {
//                         const fgManufacturedForDate = dateTotals[dateStr] || 0;
//                         row.fgManufactured = fgManufacturedForDate;
//                         row.openQty = prevClsQty;
//                         row.clsQty = fgManufacturedForDate - outward;
//                         prevClsQty = row.clsQty;
//                     } else {
//                         row.fgManufactured = null;
//                         row.openQty = prevClsQty;
//                         row.clsQty = prevClsQty - outward;
//                         prevClsQty = row.clsQty;
//                     }

//                     // Format numbers
//                     row.outwardQty = outward.toFixed(2);
//                     row.openQty = parseFloat(row.openQty || 0).toFixed(2);
//                     row.clsQty = parseFloat(row.clsQty || 0).toFixed(2);
//                     if (row.fgManufactured !== null) {
//                         row.fgManufactured = parseFloat(row.fgManufactured).toFixed(2);
//                     }

//                     result.push(row);
//                 });
//             }
//         });

//         // 🔹 Now assign sequential sNo and id after building the whole list
//         result.forEach((r, index) => {
//             r.id = index + 1;
//             r.sNo = index + 1;
//         });

//         // Calculate totals for the summary row
//         const totals = {
//             amtOfGstPay: 0,
//             taxableValueforGST: 0,
//             CGST: 0,
//             SGST: 0,
//             IGST: 0,
//             outwardQty: 0,
//             fgManufactured: 0,
//             clsQty: 0
//         };

//         result.forEach(r => {
//             totals.amtOfGstPay += parseFloat(r.amtOfGstPay || 0);
//             totals.taxableValueforGST += parseFloat(r.taxableValueforGST || 0);
//             totals.CGST += parseFloat(r.CGST || 0);
//             totals.SGST += parseFloat(r.SGST || 0);
//             totals.IGST += parseFloat(r.IGST || 0);
//             totals.outwardQty += parseFloat(r.outwardQty || 0);
//             totals.fgManufactured += parseFloat(r.fgManufactured || 0);
//             totals.clsQty += parseFloat(r.clsQty || 0);
//         });

//         // Format to 2 decimals
//         Object.keys(totals).forEach(k => {
//             totals[k] = totals[k].toFixed(2);
//         });

//         // Push totals as the last object
//         result.push({
//             id: result.length + 1,
//             sNo: 'Total',
//             invNo: '',
//             date: '',
//             amtOfGstPay: totals.amtOfGstPay,
//             taxableValueforGST: totals.taxableValueforGST,
//             CGST: totals.CGST,
//             SGST: totals.SGST,
//             IGST: totals.IGST,
//             outwardQty: totals.outwardQty,
//             fgManufactured: totals.fgManufactured,
//             clsQty: totals.clsQty,
//         });


//         // HSN Details
//         let hsnDetails = null;
//         if (itemLedger) {
//             const hsnQuery = `
//                 SELECT 
//                     il.name AS ledgerName,
//                     cust_vs_item.hsnCode,
//                     CONCAT(il.name, ' - ', cust_vs_item.hsnCode) AS hsnDesc
//                 FROM cust_vs_item
//                 INNER JOIN item_under_ledger AS il ON il.id = cust_vs_item.underLedger
//                 WHERE il.name = ?
//                 LIMIT 1
//             `;
//             const [hsnRows] = await conn.execute(hsnQuery, [itemLedger]);
//             hsnDetails = hsnRows.length > 0 ? hsnRows[0] : null;
//         }
//         await conn.commit();

//            return res.status(200).json({
//             success: true,
//             message: "Daily Stock Summary",
//             data: result, hsnDetails
//         });

//     } catch (err) {
//         await conn.rollback();
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// };


exports.dailyStock = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { from: fromDate, to: toDate, itemLedger } = req.body;

        let query = `
            SELECT 
                g.id,
                g.invNo,
                g.amtOfGstPay,
                g.taxableValueforGST,
                g.CGSTPer, 
                g.CGST, 
                g.SGSTPer, 
                g.SGST, 
                g.IGSTPer, 
                g.IGST,
                DATE_FORMAT(g.date, '%d-%m-%Y') AS date, 
                g.totalQty AS outwardQty
            FROM gstsalesinvo g 
            INNER JOIN gstsalesinvoitem gi 
                ON gi.gstsalesinvo_id = g.id
            WHERE gi.cdcItmId IS NULL
        `;

        const queryParams = [];

        if (fromDate && toDate) {
            query += ' AND DATE(g.date) BETWEEN ? AND ?';
            queryParams.push(fromDate, toDate);
        }

        if (itemLedger) {
            query += ' AND gi.itemLedger = ?';
            queryParams.push(itemLedger);
        }

        query += `
            GROUP BY g.id, DATE(g.date)
            ORDER BY DATE(g.date), g.id
        `;

        const [rows] = await conn.execute(query, queryParams);

        // Generate all dates in range
        const allDates = [];

        if (fromDate && toDate) {
            let start = moment(fromDate);
            let end = moment(toDate);

            while (start <= end) {
                allDates.push(start.format("DD-MM-YYYY"));
                start = start.add(1, "days");
            }
        }

        const result = [];
        let prevClsQty = 0;

        // Precompute total outwardQty per date
        const dateTotals = {};

        rows.forEach(r => {
            if (!r.date || r.date === '0000-00-00') return;

            dateTotals[r.date] =
                (dateTotals[r.date] || 0) +
                parseFloat(r.outwardQty || 0);
        });

        // Convert rows to dictionary by date
        const rowsByDate = {};

        rows.forEach(r => {
            if (!r.date || r.date === '0000-00-00') return;

            if (!rowsByDate[r.date]) {
                rowsByDate[r.date] = [];
            }

            rowsByDate[r.date].push(r);
        });

        // Loop through all dates to fill missing dates
        allDates.forEach(dateStr => {

            const dayRows = rowsByDate[dateStr] || [];

            // Empty dates
            if (dayRows.length === 0) {

                result.push({
                    gstInvId: 0,
                    invNo: '',

                    amtOfGstPay: 0,
                    taxableValueforGST: 0,

                    CGSTPer: 0,
                    CGST: 0,

                    SGSTPer: 0,
                    SGST: 0,

                    IGSTPer: 0,
                    IGST: 0,

                    date: dateStr,

                    outwardQty: "0.00",
                    openQty: prevClsQty.toFixed(2),
                    fgManufactured: "0.00",
                    clsQty: prevClsQty.toFixed(2),

                    // Dummy Keys
                    goodsLost: null,
                    goodsStolen: null,
                    goodsDestroyed: null,
                    writtenOff: null,
                    gift: null,
                    freeSamples: null,
                    wastage: null,
                    scrap: null 
                });

            } else {

                dayRows.forEach((row, i) => {

                    const outward = parseFloat(row.outwardQty || 0);

                    if (i === 0) {

                        const fgManufacturedForDate =
                            dateTotals[dateStr] || 0;

                        row.fgManufactured = fgManufacturedForDate;

                        row.openQty = prevClsQty;

                        row.clsQty =
                            fgManufacturedForDate - outward;

                        prevClsQty = row.clsQty;

                    } else {

                        row.fgManufactured = null;

                        row.openQty = prevClsQty;

                        row.clsQty =
                            prevClsQty - outward;

                        prevClsQty = row.clsQty;
                    }

                    // Format numbers
                    row.outwardQty = outward.toFixed(2);

                    row.openQty =
                        parseFloat(row.openQty || 0).toFixed(2);

                    row.clsQty =
                        parseFloat(row.clsQty || 0).toFixed(2);

                    if (row.fgManufactured !== null) {
                        row.fgManufactured =
                            parseFloat(row.fgManufactured).toFixed(2);
                    }

                    // Dummy Keys
                    row.goodsLost = null;
                    row.goodsStolen = null;
                    row.goodsDestroyed = null;
                    writtenOff = null;
                    gift = null;
                    freeSamples = null;
                    wastage = null;
                    scrap = null;

                    result.push(row);
                });
            }
        });

        // Assign sequential sNo and id
        result.forEach((r, index) => {
            r.id = index + 1;
            r.sNo = index + 1;
        });

        // Totals
        const totals = {
            amtOfGstPay: 0,
            taxableValueforGST: 0,
            CGST: 0,
            SGST: 0,
            IGST: 0,
            outwardQty: 0,
            fgManufactured: 0,
            clsQty: 0
        };

        result.forEach(r => {

            totals.amtOfGstPay +=
                parseFloat(r.amtOfGstPay || 0);

            totals.taxableValueforGST +=
                parseFloat(r.taxableValueforGST || 0);

            totals.CGST +=
                parseFloat(r.CGST || 0);

            totals.SGST +=
                parseFloat(r.SGST || 0);

            totals.IGST +=
                parseFloat(r.IGST || 0);

            totals.outwardQty +=
                parseFloat(r.outwardQty || 0);

            totals.fgManufactured +=
                parseFloat(r.fgManufactured || 0);

            totals.clsQty +=
                parseFloat(r.clsQty || 0);
        });

        // Format totals
        Object.keys(totals).forEach(k => {
            totals[k] = totals[k].toFixed(2);
        });

        // Total Row
        result.push({
            id: result.length + 1,
            sNo: 'Total',

            invNo: '',
            date: '',

            amtOfGstPay: totals.amtOfGstPay,
            taxableValueforGST: totals.taxableValueforGST,

            CGST: totals.CGST,
            SGST: totals.SGST,
            IGST: totals.IGST,

            outwardQty: totals.outwardQty,
            fgManufactured: totals.fgManufactured,
            clsQty: totals.clsQty,

            // Dummy Keys
            goodsLost: null,
            goodsStolen: null,
            goodsDestroyed: null,
            writtenOff: null,
            gift: null,
            freeSamples: null,
            wastage: null,
            scrap: null 
        });

        // HSN Details
        let hsnDetails = null;

        if (itemLedger) {

            const hsnQuery = `
                SELECT 
                    il.name AS ledgerName,
                    cust_vs_item.hsnCode,
                    CONCAT(il.name, ' - ', cust_vs_item.hsnCode) AS hsnDesc
                FROM cust_vs_item
                INNER JOIN item_under_ledger AS il 
                    ON il.id = cust_vs_item.underLedger
                WHERE il.name = ?
                LIMIT 1
            `;

            const [hsnRows] = await conn.execute(hsnQuery, [itemLedger]);

            hsnDetails =
                hsnRows.length > 0
                    ? hsnRows[0]
                    : null;
        }

        await conn.commit();

        return res.status(200).json({
            success: true,
            message: "Daily Stock Summary",
            data: result,
            hsnDetails
        });

    } catch (err) {

        await conn.rollback();

        return handleErrorResponse(res, err);

    } finally {

        conn.release();
    }
};

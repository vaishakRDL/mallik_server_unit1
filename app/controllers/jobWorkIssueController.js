const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require("../config/dbSql");
const { company } = require("../utility/utilityFunction");
const excel = require('exceljs');
const { setRowStyle, headerStyle, applyBordersToWorksheet } = require("./excel/prodReportExlController");
const { generateDocNo, updateDocCounter, docNoReset } = require("../utility/docNo");

exports.getDcNo = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { padStartNo: sequentialNumber, uniqueNo: dcNo } = await generateDocNo(conn, req, { docType: 'JobWorkIssue' });

        await conn.commit();
        return handleSuccessResponse(res, 'Generated DC number', { sequentialNumber, dcNo });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.itemsList = async (req, res) => {
    try {
        const { supplierId } = req.query;

        const fetchQuery = `
            SELECT items.id, dsd.id as delScheduleId, items.itemCode, items.itemName, uom.name as uomName, items.totStk, hsn.name as hsnCode, dsd.sfgQty as Qty, loc.name as mainLocation, 
            loc.name as location, grn.grnNo, supVsItem.suppDesc, supVsItem.rate, dsd.sfgQty * supVsItem.rate AS amt, ds.vehicleNo
            FROM del_schedule_details dsd
            INNER JOIN mrp ON mrp.id = dsd.mrpId
            INNER JOIN items ON items.id = mrp.itemId
            LEFT JOIN mst_uom AS uom ON uom.id = items.uom
            LEFT JOIN item_hsn_code AS hsn ON hsn.id = items.hsnCode
            LEFT JOIN item_main_loc AS loc ON loc.id = items.mainLocation
            LEFT JOIN GRN AS grn ON grn.id = mrp.grnId
            INNER JOIN del_schedule ds ON ds.id = dsd.delScheduleId
            LEFT JOIN supp_vs_item AS supVsItem ON supVsItem.spName = ds.supplierId AND supVsItem.itemName = mrp.itemId
            WHERE ds.supplierId = ?
        `;

        const [rows] = await connection.execute(fetchQuery, [supplierId]);

        return handleSuccessResponse(res, 'Items-list', rows);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const checkItemStock = async (conn, items) => {
    const itemIds = items.map(item => item.itemId);
    const [rows] = await conn.execute(
        `SELECT id, totStk FROM items WHERE id IN (${itemIds.map(() => '?').join(',')})`,
        itemIds
    );

    if (rows.length === 0) {
        throw new CustomError('Items not found!', 404);
    }

    const stockMap = new Map(rows.map(row => [row.id, row.totStk]));
    const invalidItems = items.filter(item => Number(item.jwQty) > Number(stockMap.get(item.itemId)));

    if (invalidItems.length > 0) {
        throw new CustomError(
            `Insufficient stock for items: ${invalidItems.map(item => item.itemCode).join(', ')}`,
            400
        );
    }

    return true;
};

const jobWorkItems = async (conn, user, dcType, dcNo, items) => {
    try {
        if (dcType === 'Quarantine') {
            const placeholders = items.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
            const values = items.flatMap(row => [dcNo, 'JobWork', row.poBillId, row.poBillDtlId, row.itemId, row.itemCode, row.jwQty]);

            const storePlaceholders = items.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
            const storeValues = items.flatMap(row => [dcNo, 'JobWork', row.itemId, row.itemCode, row.jwQty, user]);

            await conn.execute(`INSERT INTO quarantine_stock (docNo, docType, poBillId, poBillDtlId, itemId, itemCode, outQty) VALUES ${placeholders}`, values);
            await conn.execute(`INSERT INTO store (docNo, docType, itemId, itemCode, rejOutQty, addedBy) VALUES ${storePlaceholders}`, storeValues);
        } else if (dcType === 'General' || dcType === 'nonReturnable') {
            const itemList = items.filter(item => !item.sfgVerificationId);
            const type = dcType === 'General' ? 'JobWork' : 'NonReturnable';
            const placeholders = itemList.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
            const values = itemList.flatMap(row => [dcNo, type, row.itemId, row.itemCode, row.jwQty, user]);

            if (itemList.length > 0) {
                await checkItemStock(conn, itemList);
                await conn.execute(`INSERT INTO store (docNo, docType, itemId, itemCode, outwardQty, addedBy) VALUES ${placeholders}`, values);
            }
        }

        return true;
    } catch (err) {
        throw err;
    }
}

exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { jobWork, itemsList } = req.body;
        const { username } = req.headers;

        const columnNames = [
            'sequentialNumber', 'dcNo', 'dcType', 'supplierId', 'dispatchWeight', 'challanNo', 'challanDate', 'modeOfTransport', 'vehicleNo', 'consigneeName', 'address', 'panNo',
            'gstNo', 'typeOfGoods', 'docType', 'subSupplyType', 'subSupplyDesc', 'transactionType', 'modeOfType', 'docketNo', 'transportDate',
            'transportMst', 'transportGSTIN', 'distanceKMS', 'shippingPinCode', 'toStateCode', 'actualToState', 'stockAffect', 'ewayBillReq',
            'totalQty', 'totalGrossAmt', 'cgstPercent', 'cgst', 'sgstPercent', 'sgst', 'igstPercent', 'igst', 'totalValue', 'remarks', 'createdBy'
        ];

        const dispatchWeight = itemsList.reduce((acc, item) => acc + (parseFloat(item.dispatchWeight) || 0), 0);
        const invalidItems = [...itemsList].filter(item => !item.hsn || item.hsn.trim() === "").map(item => item.itemCode);
        if (invalidItems.length > 0) {
            throw new CustomError(`Missing HSN for Items: ${invalidItems.join(', ')}`, 400);
        }

        const colSet = new Set(['challanNo', 'challanDate']);

        const values = columnNames.map(columnName => {
            if (columnName === 'createdBy') {
                return username || null;
            }
            if (columnName === 'dispatchWeight') {
                return dispatchWeight || null;
            }
            if (jobWork.hasOwnProperty(columnName)) {
                const val = jobWork[columnName];
                return (val === "" && !colSet.has(columnName)) ? null : val;
            }
            return null;
        });

        const placeholders = Array(values.length).fill('?').join(', ');
        const placeholderString = `(${placeholders})`;

        const store = `
            INSERT INTO jobwork_issue (
                ${columnNames.join(', ')}
            ) VALUES ${placeholderString}
        `;

        const [rows] = await conn.execute(store, values);

        if (rows.affectedRows > 0) {
            const jobWorkId = rows.insertId;

            await Promise.all(itemsList.map(async (item) => {
                const { sfgVerificationId = null, sfgId = null, itemId, jwQty, rate, amount, grnNo = null } = item;
                await conn.execute(`INSERT INTO jobwork_issue_details (jobWorkId, sfgId, sfgVerificationId, itemId, Qty, rate, amount, grnNo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [jobWorkId, sfgId, sfgVerificationId, itemId, jwQty, rate, amount, grnNo]);
            }));

            await jobWorkItems(conn, username, jobWork.dcType, jobWork.dcNo, itemsList)   // Update transaction
            await storeRemarks(conn, 'JobWork', jobWork.remarks);   // log remarks

            const sfgIds = itemsList.map(item => item.sfgVerificationId).filter(id => id !== null && id !== undefined);
            const sfgPlaceholders = sfgIds.map(() => '?').join(',');

            if (sfgIds.length > 0) {
                await conn.execute(`UPDATE sfg_verification SET isCompleted = ?, remarks = ? WHERE id IN (${sfgPlaceholders})`, [1, 'Completed', ...sfgIds]);

                // Update supervisorCls in job_card
                const [jcRows] = await conn.query(`SELECT jcId FROM sfg_verification WHERE id IN (${sfgPlaceholders})`, sfgIds);
                const jcIds = jcRows.map(obj => obj.jcId);

                if (jcIds.length > 0) {
                    await conn.execute(`UPDATE job_card SET supervisorCls = ? WHERE id IN (${jcIds.map(() => '?').join(',')})`, [3, ...jcIds]);
                }
            }

            await updateDocCounter(conn, 'JobWorkIssue', { docNo: jobWork.dcNo }); // Update document counter
            await conn.commit();   // Commit transaction

            return handleSuccessResponse(res, 'Job Work created successfully');
        }
        throw new CustomError('Job Work insertion failed!', 400);
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
}

exports.show = async (req, res) => {
    try {
        const [rows] = await connection.execute(`SELECT jobIssue.*,  DATE_FORMAT(jobIssue.created_at, '%d-%m-%Y') AS created_at, supplier.spCode as suppCode 
            FROM jobwork_issue jobIssue
            INNER JOIN supplier ON supplier.id = jobIssue.supplierId
            `, []
        );

        return handleSuccessResponse(res, 'Job-Work lists', rows);
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}

exports.jobWorkItems = async (req, res) => {
    try {
        const { jobWorkId } = req.query;

        const companyData = await company();

        const [jobWork] = await connection.execute(`
            SELECT jobwork_issue.*, sup.spName as supplierName, sup.panNo, sup.gstNo, sup.pincode, sup.state, sup.spPlace,
            CONCAT(sup.spAdd1, ' ', sup.spAdd2, ' ', sup.spAdd3, ' ', sup.spAdd4) AS spAddress,
            DATE_FORMAT(jobwork_issue.created_at, '%d-%m-%Y') AS created_at
            FROM jobwork_issue 
            INNER JOIN supplier sup ON sup.id = jobwork_issue.supplierId
            WHERE jobwork_issue.id = ?`,
            [jobWorkId]
        );

        if (jobWork.length === 0) throw new CustomError('Job work details not found!', 404);

        const [items] = await connection.execute(
            `
            SELECT 
                ROW_NUMBER() OVER (ORDER BY jid.id) AS sNo, jid.id, jc.jcNo, it.itemCode, COALESCE(spItm.suppDesc, it.itemName) AS itemName, uom.name AS uomName, hsn.name AS hsnName,
                jid.Qty, jid.rate, jid.amount, jid.grnNo
            FROM jobwork_issue_details jid
            JOIN items it ON it.id = jid.itemId
            LEFT JOIN sfg ON sfg.id = jid.sfgId
            LEFT JOIN job_card jc ON jc.id = sfg.jcId
            LEFT JOIN mst_uom uom ON uom.id = it.uom
            LEFT JOIN item_hsn_code hsn ON hsn.id = it.hsnCode
            LEFT JOIN supp_vs_item spItm ON spItm.spName = ? AND spItm.itemName = it.id
            WHERE jid.jobWorkId = ?
            `,
            [jobWork[0].supplierId, jobWorkId]
        );

        if (companyData) {
            Object.assign(jobWork[0], companyData);
        }

        return res.status(200).json({
            success: true,
            message: 'Job-Work lists',
            jobWork: jobWork[0],
            itemsList: items
        })
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}

exports.delSchedule = async (req, res) => {
    try {
        fetchQuery = `SELECT 
            jobWork.id, dsd.id as delsecheduleId, DATE_FORMAT(jobWork.created_at, '%d-%m-%Y') AS created_at, ds.createdBy, ds.sfgRefNo, ds.vehicleNo, ds.dispatchTime,
            dsd.sfgQty, dsd.dispatchQty, dsd.recievedQty, dsd.pendingQty, dsd.status, jobIssue.dcNo, supplier.spCode as supCode
            FROM jobwork_issue_details jobWork
            INNER JOIN del_schedule_details dsd ON dsd.id = jobWork.delScheduleId
            INNER JOIN del_schedule ds ON ds.id = dsd.delScheduleId
            INNER JOIN jobwork_issue jobIssue ON jobIssue.id = jobWork.jobWorkId
            INNER JOIN supplier ON supplier.id = jobIssue.supplierId
        `;

        const [rows] = await connection.execute(fetchQuery, []);

        return handleSuccessResponse(res, 'Del Schedule', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.loadPendingJobWork = async (req, res) => {
    try {
        const { supplierId } = req.query;
        let jwQuery = `
            SELECT 
                jid.id, jc.jcNo, sup.spCode, sup.spName, ji.dcNo, DATE_FORMAT(ji.created_at, '%d-%m-%Y') AS created_at, jid.itemId, items.itemCode, 
                items.itemName, itemGroup.name as itemGroup, uom.name as uom, jid.Qty, jid.recievedQty, (jid.Qty - IFNULL(jrdAgg.cumQty, 0)) AS pendingQty, IFNULL(jrdAgg.cumQty, 0) AS cumQty
            FROM jobwork_issue ji
                INNER JOIN supplier sup ON sup.id = ji.supplierId
                INNER JOIN jobwork_issue_details jid ON jid.jobWorkId = ji.id
                LEFT JOIN sfg ON sfg.id = jid.sfgId
                LEFT JOIN job_card jc ON jc.id = sfg.jcId
                INNER JOIN items ON items.id = jid.itemId
                LEFT JOIN mst_item_group itemGroup ON itemGroup.id = items.itemGroup
                LEFT JOIN mst_uom uom ON uom.id = items.uom
                LEFT JOIN (
                    SELECT jwiId, SUM(jwrQty) AS cumQty
                    FROM jobwork_reciept_details
                    GROUP BY jwiId
                ) jrdAgg ON jrdAgg.jwiId = jid.id
            WHERE supplierId = ? AND (jid.Qty - IFNULL(jrdAgg.cumQty, 0)) > 0 AND ji.dcType != ?
        `
        const [rows] = await connection.execute(jwQuery, [supplierId, 'nonReturnable']);

        return handleSuccessResponse(res, 'Pending JobWork Issue', rows)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.updateJobWork = async (req, res) => {
    try {
        const { jobWork } = req.body;

        const columnNames = [
            'dispatchDate', 'dispatchTime', 'challanNo', 'challanDate', 'modeOfTransport', 'vehicleNo', 'consigneeName', 'address', 'panNo',
            'gstNo', 'typeOfGoods', 'docType', 'subSupplyType', 'subSupplyDesc', 'transactionType', 'modeOfType', 'docketNo', 'transportDate',
            'transportMst', 'transportGSTIN', 'distanceKMS', 'shippingPinCode', 'toStateCode', 'actualToState', 'stockAffect', 'ewayBillReq',
            'totalQty', 'totalGrossAmt', 'cgstPercent', 'cgst', 'sgstPercent', 'sgst', 'igstPercent', 'igst', 'totalValue', 'remarks'
        ];

        const values = [];
        const setClause = columnNames
            .filter(columnName => jobWork.hasOwnProperty(columnName)) // Only include properties that exist in jobWork
            .map(columnName => {
                values.push(jobWork[columnName]); // Push the corresponding value to the values array
                return `${columnName} = ?`; // Create the SQL SET clause
            })
            .join(', ');

        const updateQuery = `
            UPDATE jobwork_issue 
            SET ${setClause}
            WHERE id = ?
        `;
        values.push(jobWork.id);

        await connection.execute(updateQuery, values);

        return handleSuccessResponse(res, 'Updated successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

// exports.jsonDoc = async (req, res) => {
//     try {
//         const { jobWorkId } = req.query;

//         const fromGstin = "29AAICM4744Q1ZM";
//         const fromTrdName = "MALLIK ENGINEERING (INDIA) PVT. LTD.";
//         const fromAddr1 = "Plot No. 126, Road No 3, KIADB Industrial Estate,";
//         const fromAddr2 = "II Phase, Jigani Industrial Area, Jigani,Anekal Taluk,Bengaluru - 560105.";
//         const fromPlace = "Bangalore";
//         const fromPincode = 560105;
//         const fromStateCode = 29;
//         const actualFromStateCode = 29;
//         const vechileType = "R";


//         const [jobWork] = await connection.execute(`
//             SELECT  '${fromGstin}' as userGstin, 
//                     sup.spType as supplyType, 
//                     ji.subSupplyType, 
//                     IFNULL(ji.subSupplyDesc, '') AS subSupplyDesc, 
//                     ji.docType, 
//                     ji.dcNo as docNo,
//                     DATE_FORMAT(ji.created_at, '%d/%m/%Y') AS docDate, 
//                     ji.transactionType as transType,
//                     '${fromGstin}' as fromGstin, 
//                     '${fromTrdName}' as fromTrdName, 
//                     '${fromAddr1}' as fromAddr1, 
//                     '${fromAddr2}' as fromAddr2,
//                     '${fromPlace}' as fromPlace, 
//                     ${fromPincode} as fromPincode, 
//                     ${fromStateCode} as fromStateCode,
//                     ${actualFromStateCode} as actualFromStateCode,
//                     sup.gstNo as toGstin, 
//                     sup.spName as toTrdName, 
//                     sup.spAdd1 as toAddr1, 
//                     sup.spAdd2 as toAddr2,
//                     sup.city as toPlace, 
//                     sup.pincode as toPincode, 
//                     ji.toStateCode, 
//                     ji.actualToState As actualToStateCode,
//                     CAST(ji.totalValue AS DECIMAL(10,2)) AS totalValue,
//                     CAST(ji.cgst AS DECIMAL(10,2)) AS cgstValue,
//                     CAST(ji.sgst AS DECIMAL(10,2)) AS sgstValue,
//                     CAST(ji.igst AS DECIMAL(10,2)) AS igstValue,
//                     CAST(ji.totalValue AS DECIMAL(10,2)) AS totInvValue,
//                     0 as cessValue, 0 as TotNonAdvolVal, 0 as OthValue, 
//                     ji.modeOfType as transMode, 
//                     ji.distanceKMS as transDistance,
//                     '' as transporterName, 
//                     '' as transporterId, 
//                     '' as transDocNo, 
//                     '' as transDocDate,
//                     ji.vehicleNo, 
//                     '${vechileType}'  as vehicleType
//             FROM jobwork_issue ji
//             INNER JOIN supplier sup ON sup.id = ji.supplierId
//             WHERE ji.id = ?
//         `, [jobWorkId]);

//         if (jobWork.length === 0) throw new Error('Job work details not found!');

//         const header = jobWork[0];

//         const [items] = await connection.execute(`
//             SELECT  items.itemName as productName, items.itemName as productDesc, uom.name as qtyUnit,
//                     CAST(hsn.name AS UNSIGNED) as hsnCode,
//                     CAST(jid.Qty AS DECIMAL(10,2)) as quantity,
//                     CAST(jid.amount AS DECIMAL(10,2)) as taxableAmount,
//                     0 as cessRate, 0 as cessNonAdvol
//             FROM jobwork_issue_details jid
//             INNER JOIN items ON items.id = jid.itemId
//             LEFT JOIN mst_uom AS uom ON uom.id = items.uom
//             LEFT JOIN item_hsn_code AS hsn ON hsn.id = items.hsnCode
//             WHERE jobWorkId = ?
//         `, [jobWorkId]);

//         items.forEach((row, index) => {
//             row.itemNo = index + 1;
//         });

//         if (items.length > 0) {
//             header.mainHsnCode = items[0].hsnCode;
//         }

//         //  Determine tax structure: IGST or SGST/CGST
//         const isIntraState = header.fromStateCode === header.toStateCode;

//         const itemsWithTax = items.map(item => ({
//             ...item,
//             sgstRate: isIntraState ? parseFloat(header.sgstValue) : 0,
//             cgstRate: isIntraState ? parseFloat(header.cgstValue) : 0,
//             igstRate: isIntraState ? 0 : parseFloat(header.igstValue)
//         }));

//         // Fix taxable total mismatch issue
//         const totalTaxable = items.reduce((sum, item) => sum + parseFloat(item.taxableAmount || 0), 0);
//         header.totalValue = totalTaxable.toFixed(2);
//         header.totInvValue = totalTaxable.toFixed(2);



//         header.itemList = itemsWithTax;

//         return res.status(200).json({
//             version: "1.0.0219",
//             billLists: [header]
//         });

//     } catch (err) {
//         console.error("Error in jsonDoc:", err);
//         return res.status(500).json({
//             success: false,
//             message: err.message || "Server Error"
//         });
//     }
// };


function validateGSTPayload(payload) {
    const errors = [];
    const bill = payload.billLists?.[0];

    if (!bill) {
        errors.push("billLists missing");
        return errors;
    }

    const requiredFields = [
        "userGstin", "supplyType", "subSupplyType",
        "docType", "docNo", "docDate",
        "fromGstin", "toGstin",
        "fromPincode", "toPincode",
        "fromStateCode", "totalValue", "totInvValue"
    ];

    requiredFields.forEach(field => {
        if (bill[field] === undefined || bill[field] === null || bill[field] === "") {
            errors.push(`${field} is missing`);
        }
    });

    const gstRegex = /^[0-9]{2}[A-Z0-9]{13}$/;

    if (bill.fromGstin && !gstRegex.test(bill.fromGstin)) {
        errors.push("Invalid fromGstin");
    }
    if (bill.toGstin && !gstRegex.test(bill.toGstin)) {
        errors.push("Invalid toGstin");
    }

    if (!bill.itemList || bill.itemList.length === 0) {
        errors.push("itemList empty");
    }

    return errors;
}


// ================= AUTO FIX =================
function autoFixGSTPayload(payload) {
    const bill = payload.billLists[0];

    const fixString = (val) => val || "";
    const fixNumber = (val) => (val === null || isNaN(val)) ? 0 : Number(val);

    // Header fixes
    bill.toStateCode = fixNumber(bill.toStateCode);
    bill.actualToStateCode = fixNumber(bill.actualToStateCode);
    bill.transDistance = fixNumber(bill.transDistance);

    bill.totalValue = fixNumber(bill.totalValue);
    bill.totInvValue = fixNumber(bill.totInvValue);

    bill.transporterName = fixString(bill.transporterName);
    bill.transporterId = fixString(bill.transporterId);
    bill.transDocNo = fixString(bill.transDocNo);
    bill.transDocDate = fixString(bill.transDocDate);

    bill.toPlace = fixString(bill.toPlace) || "NA";

    // Item fixes
    const fixedItems = bill.itemList.map((item, index) => ({
        itemNo: index + 1,
        productName: fixString(item.productName),
        productDesc: fixString(item.productDesc),
        hsnCode: fixNumber(item.hsnCode),
        quantity: fixNumber(item.quantity),
        qtyUnit: fixString(item.qtyUnit) || "NOS",
        taxableAmount: fixNumber(item.taxableAmount),
        sgstRate: fixNumber(item.sgstRate),
        cgstRate: fixNumber(item.cgstRate),
        igstRate: fixNumber(item.igstRate),
        cessRate: fixNumber(item.cessRate),
        cessNonAdvol: fixNumber(item.cessNonAdvol)
    }));

    //  Force mainHsnCode BEFORE itemList
    delete bill.mainHsnCode;
    delete bill.itemList;

    bill.mainHsnCode = fixedItems.length > 0 ? fixedItems[0].hsnCode : 0;
    bill.itemList = fixedItems;

    // Recalculate totalValue & totInvValue from actual item sum
    const itemSum = parseFloat(
        fixedItems
            .reduce((acc, item) => acc + item.taxableAmount, 0)
            .toFixed(2)
    );
    bill.totalValue = itemSum;
    bill.totInvValue = Math.round(itemSum);

    return payload;
}


exports.jsonDoc = async (req, res) => {
    try {
        const { jobWorkId } = req.query;

        // ================= COMPANY DATA =================
        const companyData = await company();

        if (!companyData) {
            throw new Error("Company details not found");
        }

        let address = companyData.companyAdd || "";

        // Remove new lines & extra spaces
        address = address
            .replace(/[\r\n]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const parts = address.split(",");

        const fromAddr1 = parts.slice(0, 2).join(",").trim();

        const fromAddr2 = parts.slice(2).join(",").trim();

        // ================= COMPANY VALUES =================
        const fromGstin = companyData.cmpGstNo;

        const fromTrdName = companyData.companyName;

        const fromPlace = companyData.city || "Bangalore";

        const fromPincode =
            parseInt(companyData.pincode) || 560105;

        const fromStateCode =
            parseInt(companyData.stateCode) || 29;

        const actualFromStateCode =
            parseInt(companyData.stateCode) || 29;

        const vechileType = "R";

        // ================= HEADER QUERY =================
        const [jobWork] = await connection.execute(
            `
      SELECT
          sup.spType as supplyType,
          ji.subSupplyType,
          IFNULL(ji.subSupplyDesc, '') AS subSupplyDesc,
          ji.docType,
          ji.dcNo as docNo,

          DATE_FORMAT(ji.created_at, '%d/%m/%Y') AS docDate,

          ji.transactionType as transType,

          sup.gstNo as toGstin,
          sup.spName as toTrdName,
          sup.spAdd1 as toAddr1,
          sup.spAdd2 as toAddr2,

          sup.city as toPlace,
          sup.pincode as toPincode,

          ji.toStateCode,
          ji.actualToState AS actualToStateCode,

          CAST(ji.totalValue AS DECIMAL(10,2)) AS totalValue,

          CAST(ji.cgst AS DECIMAL(10,2)) AS cgstValue,
          CAST(ji.sgst AS DECIMAL(10,2)) AS sgstValue,
          CAST(ji.igst AS DECIMAL(10,2)) AS igstValue,

          CAST(ji.cgstPercent AS DECIMAL(10,2)) AS cgstRate,
          CAST(ji.sgstPercent AS DECIMAL(10,2)) AS sgstRate,
          CAST(ji.igstPercent AS DECIMAL(10,2)) AS igstRate,

          CAST(ji.totalValue AS DECIMAL(10,2)) AS totInvValue,

          0 as cessValue,
          0 as TotNonAdvolVal,
          0 as OthValue,

          ji.modeOfType as transMode,

          ji.distanceKMS as transDistance,

          '' as transporterName,
          '' as transporterId,
          '' as transDocNo,
          '' as transDocDate,

          ji.vehicleNo

      FROM jobwork_issue ji
      INNER JOIN supplier sup
          ON sup.id = ji.supplierId

      WHERE ji.id = ?
    `,
            [jobWorkId]
        );

        if (jobWork.length === 0) {
            throw new Error("Job work details not found!");
        }

        const raw = jobWork[0];

        // ================= HEADER FORMAT =================
        const header = {
            userGstin: fromGstin,

            supplyType: raw.supplyType,

            subSupplyType:
                parseInt(raw.subSupplyType) || 0,

            //   subSupplyDesc:
            //     raw.subSupplyDesc || "",

            subSupplyDesc: parseInt(raw.subSupplyType) <= 8 ? "" : (raw.subSupplyDesc || ""),


            docType: raw.docType,

            docNo: raw.docNo,

            docDate: raw.docDate,

            transType:
                parseInt(raw.transType) || 1,

            fromGstin: fromGstin,

            fromTrdName: fromTrdName,

            fromAddr1: fromAddr1,

            fromAddr2: fromAddr2,

            fromPlace: fromPlace,

            fromPincode: fromPincode,

            fromStateCode: fromStateCode,

            actualFromStateCode:
                actualFromStateCode,

            toGstin: raw.toGstin,

            toTrdName: raw.toTrdName,

            toAddr1: raw.toAddr1,

            toAddr2: raw.toAddr2,

            toPlace: raw.toPlace || "NA",

            toPincode:
                parseInt(raw.toPincode) || 0,

            toStateCode:
                parseInt(raw.toStateCode) ||
                fromStateCode,

            actualToStateCode:
                parseInt(raw.actualToStateCode) ||
                fromStateCode,

            totalValue:
                parseFloat(raw.totalValue) || 0,

            cgstValue:
                parseFloat(raw.cgstValue) || 0,

            sgstValue:
                parseFloat(raw.sgstValue) || 0,

            igstValue:
                parseFloat(raw.igstValue) || 0,


            cgstRate: parseFloat(raw.cgstRate) || 0,
            sgstRate: parseFloat(raw.sgstRate) || 0,
            igstRate: parseFloat(raw.igstRate) || 0,

            totInvValue:
                parseFloat(raw.totInvValue) || 0,

            cessValue: 0,

            TotNonAdvolVal: 0,

            OthValue: 0,

            transMode: raw.transMode,

            transDistance:
                parseInt(raw.transDistance) || 0,

            transporterName:
                raw.transporterName || "",

            transporterId:
                raw.transporterId || "",

            transDocNo:
                raw.transDocNo || "",

            transDocDate:
                raw.transDocDate || "",

            vehicleNo:
                raw.vehicleNo || "",

            vehicleType: vechileType
        };

        // ================= ITEMS QUERY =================
        const [items] = await connection.execute(
            `
      SELECT
          items.itemName as productName,

          items.itemName as productDesc,

          uom.name as qtyUnit,

          CAST(hsn.name AS UNSIGNED) as hsnCode,

          CAST(jid.Qty AS DECIMAL(10,2)) as quantity,

          CAST(jid.amount AS DECIMAL(10,2)) as taxableAmount,

          0 as cessRate,

          0 as cessNonAdvol

      FROM jobwork_issue_details jid

      INNER JOIN items
          ON items.id = jid.itemId

      LEFT JOIN mst_uom uom
          ON uom.id = items.uom

      LEFT JOIN item_hsn_code hsn
          ON hsn.id = items.hsnCode

      WHERE jid.jobWorkId = ?
    `,
            [jobWorkId]
        );

        // ================= TAX STRUCTURE =================
        const isIntraState =
            header.fromStateCode ===
            header.toStateCode;

        const itemList = items.map((item, index) => ({
            itemNo: index + 1,

            productName: item.productName,

            productDesc: item.productDesc,

            hsnCode:
                parseInt(item.hsnCode) || 0,

            quantity:
                parseFloat(item.quantity) || 0,

            qtyUnit: item.qtyUnit,

            taxableAmount:
                parseFloat(item.taxableAmount) || 0,

            //   sgstRate: isIntraState
            //     ? header.sgstValue
            //     : 0,

            //   cgstRate: isIntraState
            //     ? header.cgstValue
            //     : 0,

            //   igstRate: isIntraState
            //     ? 0
            //     : header.igstValue,

            sgstRate: isIntraState ? header.sgstRate : 0,
            cgstRate: isIntraState ? header.cgstRate : 0,
            igstRate: isIntraState ? 0 : header.igstRate,

            cessRate: 0,

            cessNonAdvol: 0
        }));

        // ================= MAIN HSN =================
        header.mainHsnCode =
            itemList.length > 0
                ? itemList[0].hsnCode
                : 0;

        // ================= ITEM LIST =================
        header.itemList = itemList;

        // ================= FINAL PAYLOAD =================
        const finalPayload = {
            version: "1.0.0219",
            billLists: [header]
        };

        // ================= AUTO FIX =================
        const fixedPayload =
            autoFixGSTPayload(finalPayload);

        // ================= VALIDATION =================
        const errors =
            validateGSTPayload(fixedPayload);

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: "GST Validation Failed",
                errors,
                payload: fixedPayload
            });
        }

        // ================= SUCCESS =================
        return res.status(200).json(
            fixedPayload
        );

    } catch (err) {
        console.error("Error in jsonDoc:", err);

        return res.status(500).json({
            success: false,
            message:
                err.message || "Server Error"
        });
    }
};

exports.deleteJobWorkOld = async (req, res) => {
    try {
        const { delScheduleId } = req.query;

        await connection.execute(`DELETE FROM jobwork_issue WHERE id = ?`, [delScheduleId]);
        await docNoReset(connection, req, { docType: 'JobWorkIssue', table: 'jobwork_issue', col: 'sequentialNumber' });
        return handleSuccessResponse(res, 'Deleted successfully');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.deleteJobWork = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { delScheduleId } = req.query;

        const [jwRows] = await conn.execute(`
            SELECT id, dcType FROM jobwork_issue WHERE id = ?`,
            [delScheduleId]
        );

        if (!jwRows.length) {
            throw new CustomError('Job Work not found!', 404);
        }
        const { dcType } = jwRows[0];

        const [jwItems] = await conn.execute(`
            SELECT sfgVerificationId, itemId, i.itemCode, Qty
            FROM jobwork_issue_details jid
            INNER JOIN items i ON i.id = jid.jobWorkId
            WHERE jid.jobWorkId = ?`,
            [delScheduleId]
        );

        if (dcType === 'Quarantine') {
            const placeholders = jwItems.map(() => '(?, ?, ?, ?)').join(',');
            const values = jwItems.flatMap(row => ['JobWorkClose', row.itemId, row.itemCode, row.Qty]);

            await conn.execute(`INSERT INTO quarantine_stock (docType, itemId, itemCode, inQty) VALUES ${placeholders}`, values);
        } else {
            const sfg = [], items = [];

            for (let i = 0; i < jwItems.length; i++) {
                const obj = jwItems[i];
                if (obj.sfgVerificationId !== null && obj.sfgVerificationId !== undefined) {
                    sfg.push(obj);
                } else {
                    items.push(obj);
                }
            }

            if (sfg.length) {
                const ids = sfg.map(row => row.sfgVerificationId);

                const placeholders = ids.map(() => '?').join(',');
                const query = `
                    UPDATE sfg_verification
                    SET isCompleted = 0,
                        remarks = 'Pending'
                    WHERE id IN (${placeholders})
                `;

                await conn.execute(query, ids);
            }
            if (items.length) {
                const ids = items.map(row => row.itemId);
                const qtyCases = items
                    .map(row => `WHEN ${row.itemId} THEN ${row.Qty}`)
                    .join(' ');

                const query = `
                    UPDATE items
                    SET totStk = totStk + CASE id ${qtyCases} END
                    WHERE id IN (${ids.join(',')})
                `;

                await conn.execute(query);
            }
        }
        await conn.execute(`
            DELETE FROM jobwork_issue WHERE id = ?`,
            [delScheduleId]
        );

        await conn.commit();

        return handleSuccessResponse(res, 'Deleted successfully');
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

const storeRemarks = async (conn, type, remark) => {
    try {
        if (remark) {
            const [remarks] = await conn.execute(`SELECT id FROM remarks WHERE type = ? AND remark = ?`, [type, remark]);

            if (remarks.length === 0) {
                await conn.execute(`
                    INSERT INTO remarks (type, remark) VALUES (?, ?)`,
                    [type, remark]
                );
            }
        }
        return true;
    } catch (err) {
        throw err;
    }
}

exports.serachRemarks = async (req, res) => {
    try {
        const { type, q } = req.query;

        let fetchQuery = `SELECT id, remark as label FROM remarks`;
        let params = [];
        // if (q) {
        //     fetchQuery += ` WHERE remark LIKE ?`
        //     params.push(`%${q}%`)
        // }

        const [rows] = await connection.execute(fetchQuery, params)

        return handleSuccessResponse(res, 'Remarks list', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.pendingJobWork = async (req, res) => {
    try {
        const { supplierId, itemId } = req.query;

        const [rows] = await connection.execute(`
            SELECT ji.dcNo as jwiNo, DATE_FORMAT(ji.created_at, '%d-%m-%Y') AS jwiDate, s.spCode, jid.Qty as issuedQty, jid.pendingQty, jid.rate 
            FROM jobwork_issue_details jid
            INNER JOIN jobwork_issue ji ON ji.id = jid.jobWorkId
            LEFT JOIN supplier s ON s.id = ji.supplierId
            WHERE jid.itemId = ? AND jid.pendingQty > ?`,
            [itemId, 0]
        );

        return handleSuccessResponse(res, 'Pending JobWorks', rows)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const jobWorkIsuueReport = async (req, reportType) => {
    try {
        const { fromDate, toDate, type, status, items = [], suppliers = [] } = req.body;

        const isDetailed = type === 'Detailed';
        const values = [toDate, fromDate, toDate];

        // ---------------- WHERE CLAUSE ----------------
        let whereClause = `WHERE DATE(ji.created_at) BETWEEN ? AND ?`;

        if (status === 'Pending') {
            // Filter will apply after aggregation (use jrdAgg instead of jrd)
            whereClause += ` 
                AND ji.dcType NOT IN ('Quarantine', 'nonReturnable')
                AND (jid.Qty - IFNULL(jrdAgg.cumQty, 0)) > 0
            `;
        }

        // Helper function for dynamic IN clauses
        const addInClause = (field, arr) => {
            if (arr.length > 0) {
                const placeholders = arr.map(() => '?').join(',');
                whereClause += ` AND ${field} IN (${placeholders})`;
                values.push(...arr);
            }
        };
        addInClause('jid.itemId', items);
        addInClause('ji.supplierId', suppliers);

        // ---------------- QUERY BUILD ----------------
        // For summary report, use aggregated receipts
        const receiptJoin = isDetailed
            ? `
                LEFT JOIN jobwork_reciept_details jrd ON jrd.jwiId = jid.id
                LEFT JOIN jobwork_reciept jr ON jr.id = jrd.jwrId
              `
            : `
                LEFT JOIN (
                    SELECT jwiId, SUM(jwrQty) AS cumQty
                    FROM jobwork_reciept_details
                    GROUP BY jwiId
                ) jrdAgg ON jrdAgg.jwiId = jid.id
              `;

        const query = `
            SELECT 
                s.spCode AS supplier, 
                ji.gstNo, 
                ji.dcType,
                ji.dcNo AS jwiNo, 
                DATE_FORMAT(ji.created_at, '%d-%m-%Y') AS jwiDate, 
                i.itemCode, 
                i.itemName, 
                uom.name AS uom, 
                jid.Qty AS jwiQty,
                IFNULL(${isDetailed ? 'jrd.jwrQty' : 'jrdAgg.cumQty'}, 0) AS jwrCumQty, 
                (jid.Qty - IFNULL(${isDetailed ? 'jrd.jwrQty' : 'jrdAgg.cumQty'}, 0)) AS pendingQty, 
                jid.rate, 
                jid.amount, 
                ji.cgstPercent, 
                ji.cgst, 
                ji.sgstPercent, 
                ji.sgst, 
                ji.remarks, 
                hsn.name AS hsn, 
                ${isDetailed ? `
                    jr.invoiceNo, 
                    DATE_FORMAT(jr.invoiceDate, '%d-%m-%Y') AS invoiceDate, 
                    jr.dcNo, 
                    DATE_FORMAT(jr.dcDate, '%d-%m-%Y') AS dcDate, 
                ` : ``}
                DATEDIFF(?, ji.created_at) AS dateDiff
            FROM jobwork_issue_details jid
            INNER JOIN jobwork_issue ji ON ji.id = jid.jobWorkId
            INNER JOIN supplier s ON s.id = ji.supplierId
            INNER JOIN items i ON i.id = jid.itemId
            LEFT JOIN mst_uom uom ON uom.id = i.uom
            LEFT JOIN item_hsn_code hsn ON hsn.id = i.hsnCode
            ${receiptJoin}
            ${whereClause}
        `;

        // ---------------- EXECUTION ----------------
        const [rows] = await connection.execute(query, values);

        // ---------------- OUTPUT HANDLING ----------------
        if (reportType === 'view') return rows;

        if (reportType === 'download') {
            const baseHeaders = {
                supplier: 'Supplier',
                gstNo: 'GST No',
                jwiNo: 'JWI No',
                jwiDate: 'JWI Date',
                itemCode: 'Item Code',
                itemName: 'Item Name',
                uom: 'UOM',
                jwiQty: 'JWI Qty',
                jwrCumQty: 'JWR Qty',
                pendingQty: 'Pending Qty',
                dateDiff: 'Date Diff',
                rate: 'Rate',
                amount: 'Amount',
                cgstPercent: 'CGST %',
                cgst: 'CGST',
                sgstPercent: 'SGST %',
                sgst: 'SGST',
                remarks: 'Remarks',
                hsn: 'HSN'
            };

            const detailedHeaders = isDetailed
                ? { invoiceNo: 'Invoice No', invoiceDate: 'Invoice Date', dcNo: 'DC No', dcDate: 'DC Date' }
                : {};

            return {
                headers: { ...baseHeaders, ...detailedHeaders },
                rows
            };
        }

        throw new CustomError('Invalid report type', 400);
    } catch (err) {
        throw err;
    }
};

exports.viewReport = async (req, res) => {
    try {
        const rows = await jobWorkIsuueReport(req, 'view');
        return handleSuccessResponse(res, 'JobWorkIssue report', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.downloadReport = async (req, res) => {
    try {
        const { headers, rows } = await jobWorkIsuueReport(req, 'download');

        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('JobWorkIssue');
        worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

        worksheet.columns = Object.keys(headers).map((header) => ({
            header: headers[header],
            key: header,
            width: 20,
            style: { alignment: { horizontal: 'center' } },
        }));

        rows.forEach((row, index) => {
            const excelRow = worksheet.addRow(row);

            const isEvenRow = index % 2 !== 0;
            setRowStyle(excelRow, null, isEvenRow); // Apply styles based on row type
        });

        headerStyle(worksheet); // Style headers
        applyBordersToWorksheet(worksheet); // Apply borders to all cells

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Disposition', `attachment; filename=JobWorkIssue.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.loadQuarantineStock = async (req, res) => {
    try {
        const { supplierId } = req.query;

        let query = `
            WITH LastQuarantineStock AS (
                SELECT 
                    qs.id, qs.poBillId, qs.poBillDtlId, qs.itemId, qs.totQty, qs.created_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY qs.itemId 
                        ORDER BY qs.created_at DESC
                    ) AS row_num
                FROM quarantine_stock qs
            )
            SELECT 
                qs.id, po.poNo AS grnNo, qs.poBillId, qs.poBillDtlId, items.itemCode, items.itemName, uom.name AS uom, items.totStk AS qoh, hsn.name AS hsn, qs.totQty AS jwQty, 
                supItem.suppDesc, supItem.rate, loc.name AS location, NULL AS lot, (qs.totQty * supItem.rate) AS amount, NULL AS remarks, items.id AS itemId, 
                (qs.totQty * items.netWeight) AS dispatchWeight, COALESCE(supplier.spCode, '') AS vendorCode, supplier.id AS supplierId
            FROM LastQuarantineStock qs
            INNER JOIN items ON items.id = qs.itemId
            LEFT JOIN mst_uom uom ON uom.id = items.uom
            LEFT JOIN item_hsn_code hsn ON hsn.id = items.hsnCode
            LEFT JOIN item_main_loc loc ON loc.id = items.mainLocation
            LEFT JOIN supp_vs_item supItem ON supItem.itemName = items.id
            LEFT JOIN supplier ON supplier.id = supItem.spName
            LEFT JOIN po_bill po ON po.id = qs.poBillId
            WHERE qs.row_num = 1
            AND qs.totQty > 0
            AND supplier.id = ?;
        `

        const [rows] = await connection.execute(query, [supplierId]);

        return handleSuccessResponse(res, 'Qurantine stocks', rows)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.searchItem = async (req, res) => {
    try {
        const { supplierId, itemCode } = req.query;

        let query = `
            SELECT
                i.id, i.id AS itemId, i.itemCode, i.itemName, 
                uom.name AS uom, i.totStk AS qoh, 
                hsn.name AS hsn, 
                COALESCE(supItem.suppDesc, i.itemName) AS suppDesc, 
                COALESCE(supItem.rate, '') as rate, 
                loc.name AS location, 
                NULL AS lot, 
                CASE WHEN supplier.id IS NOT NULL THEN supplier.spCode ELSE '' END AS vendorCode,
                CASE WHEN supplier.id IS NOT NULL THEN supplier.id ELSE '' END AS supplierId
            FROM items i
            LEFT JOIN mst_uom uom ON uom.id = i.uom
            LEFT JOIN item_hsn_code hsn ON hsn.id = i.hsnCode
            LEFT JOIN item_main_loc loc ON loc.id = i.mainLocation
            LEFT JOIN supp_vs_item supItem ON supItem.itemName = i.id
            LEFT JOIN supplier ON supplier.id = supItem.spName
        `;

        let whereClauses = [];
        let values = [];

        // Filter by item code if provided
        if (itemCode) {
            whereClauses.push(`i.itemCode LIKE ?`);
            values.push(`%${itemCode}%`);
        }

        // Handle supplier filter carefully to avoid exclusion of items
        if (supplierId) {
            whereClauses.push(`(supItem.spName = ? OR supItem.spName IS NULL)`);
            values.push(supplierId);
        }

        if (whereClauses.length > 0) {
            query += ` WHERE ` + whereClauses.join(' AND ');
        }

        query += `
            GROUP BY i.itemCode
            LIMIT 10
        `;

        const [rows] = await connection.execute(query, values);

        return handleSuccessResponse(res, 'Items list', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.getItemDetails = async (req, res) => {
    try {
        const { supplierId, itemId } = req.query;

        let query = `
            SELECT
                i.id, i.id AS itemId, i.itemCode, i.itemName,
                uom.name AS uom, i.totStk AS qoh, 
                hsn.name AS hsn, 
                COALESCE(supItem.suppDesc, i.itemName) AS suppDesc, 
                COALESCE(supItem.jwdcRate, i.stdRate) as rate, 
                loc.name AS location, 
                NULL AS lot, 
                COALESCE(s.spCode, NULL) AS vendorCode,
                COALESCE(s.id, NULL) AS supplierId, null as sfgId, null as sfgVerificationId
            FROM items i
            LEFT JOIN mst_uom uom ON uom.id = i.uom
            LEFT JOIN item_hsn_code hsn ON hsn.id = i.hsnCode
            LEFT JOIN item_main_loc loc ON loc.id = i.mainLocation
            LEFT JOIN supp_vs_item supItem ON supItem.itemName = i.id AND supItem.spName = ?
            LEFT JOIN supplier s ON s.id = supItem.spName
            WHERE i.id = ?  
        `;

        const [itemRows] = await connection.execute(query, [supplierId, itemId]);

        if (itemRows.length === 0) throw new CustomError('Item not found!', 404);

        return handleSuccessResponse(res, 'Items list', itemRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.itcJobWorkReport = async (req, res) => {
    try {
        const { fromDate, toDate, suppliers = [] } = req.body;

        let values = [];
        let whereClause = 'WHERE 1=1';

        if (fromDate && toDate) {
            whereClause += ` AND DATE(ji.created_at) BETWEEN ? AND ?`;
            values.push(fromDate, toDate);
        }

        if (suppliers.length) {
            const placeholders = suppliers.map(() => '?').join(',');
            whereClause += ` AND ji.supplierId IN (${placeholders})`;
            values.push(...suppliers);
        }

        const [rows] = await connection.execute(`
            SELECT 
                jid.id, s.spCode AS supplier, ji.gstNo, ji.dcNo AS jwiNo,  DATE_FORMAT(ji.created_at, '%d-%m-%Y') AS jwiDate, s.toStateCode AS stateCode, i.itemCode, i.itemName, uom.name AS uom, hsn.name AS hsn, hsn.description AS hsnDesc, 
                jid.Qty AS jwiQty, jid.rate, (jid.Qty * jid.rate) AS taxableVal, ji.igstPercent, ji.igst, ji.cgstPercent, ji.cgst, ji.sgstPercent, ji.sgst,hsn.description AS hsnDescription, ji.remarks as natureOfJW
            FROM jobwork_issue_details jid
            INNER JOIN jobwork_issue ji ON ji.id = jid.jobWorkId
            INNER JOIN supplier s ON s.id = ji.supplierId
            INNER JOIN items i ON i.id = jid.itemId
            LEFT JOIN mst_uom uom ON uom.id = i.uom
            LEFT JOIN item_hsn_code hsn ON hsn.id = i.hsnCode
            ${whereClause}
        `, values);

        return handleSuccessResponse(res, 'JobWorkIssue ITC report', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.getJobworkReceiptsReport = async (req, res) => {
    try {
        const { fromDate, toDate, supplierIds = [] } = req.body;

        let whereClause = 'WHERE 1=1';
        let params = [];

        if (supplierIds.length > 0) {
            const placeholders = supplierIds.map(() => '?').join(',');
            whereClause += ` AND jwr.supplierId IN (${placeholders})`;
            params.push(...supplierIds);
        }

        if (fromDate && toDate) {
            whereClause += ` AND DATE(jwr.created_at) BETWEEN ? AND ?`;
            params.push(fromDate, toDate);
        }

        const query = `
            SELECT 
                jwr.id, 
                s.spCode, 
                s.gstNo, 
                s.spName, 
                s.stateCode,
                i.itemCode,
                i.itemName,
                jwi.dcNo AS jwChallanNumber,
                DATE_FORMAT(jwi.created_at, '%d-%m-%Y') AS jwChallanDate,
                jwr.dcNo,
                DATE_FORMAT(jwr.dcDate, '%d-%m-%Y') AS dcDate,
                jwrd.jwrQty,
                i.stdRate,
                jwi.remarks as modeOfTransport,
                jwi.cgstPercent,
                jwi.cgst,
                jwi.sgstPercent,
                jwi.sgst,
                jwi.igstPercent,
                jwi.igst,
                hsn.name AS hsnName,
                hsn.description AS hsnDescription,
                uom.code AS uom,
                jwid.Qty,
                jwid.rate,
                ROUND(jwid.Qty * jwid.rate, 2) AS taxableValue
            FROM jobwork_reciept jwr
            LEFT JOIN supplier s ON jwr.supplierId = s.id
            LEFT JOIN jobwork_reciept_details jwrd ON jwr.id = jwrd.jwrId
            LEFT JOIN items i ON jwrd.itemId = i.id
            LEFT JOIN mst_uom uom ON uom.id = i.uom
            LEFT JOIN jobwork_issue_details jwid ON jwrd.jwiId = jwid.id
            LEFT JOIN jobwork_issue jwi ON jwid.jobWorkId = jwi.id
            LEFT JOIN item_hsn_code hsn ON i.hsnCode = hsn.id
            ${whereClause}
        `;

        const [rows] = await connection.query(query, params);

        const resultWithSerialNo = rows.map((row, index) => ({
            sNo: index + 1,
            ...row,
        }));

        return res.status(200).json({ data: resultWithSerialNo });
    } catch (error) {
        console.error('Error fetching jobwork receipts report:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

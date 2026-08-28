const { connection, handleErrorResponse, handleSuccessResponse } = require('../config/dbSql');
const { company } = require("../utility/utilityFunction");

// Generate AutoIncrement Digits
exports.uniqueId = async (req, res) => {
    try {
        const fetch = 'SELECT returnNo FROM credit_note_mst ORDER BY id DESC LIMIT 1';
        const [results] = await connection.execute(fetch);

        const currentYear = new Date().getFullYear().toString().slice(-2);
        let newStr;
        let lastFiveDigits;

        if (!results || results.length === 0) {
            lastFiveDigits = '00001';
            newStr = `${currentYear}/RN${lastFiveDigits}`;
        } else {
            const no = results[0].returnNo || `${currentYear}/RN00000`;
            const parts = no.split('/') || [];
            const rnPart = parts[1] || 'RN00000';
            const numericPart = rnPart.replace('RN', '') || '00000';

            const len = parseInt(numericPart, 10);
            const increment = isNaN(len) ? 1 : len + 1;
            lastFiveDigits = increment.toString().padStart(5, '0');
            newStr = `${currentYear}/RN${lastFiveDigits}`;
        }

        return res.status(200).json({ id: newStr, digit: lastFiveDigits });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// Search Api for Customer from gstsalesinvo
exports.invCustomer = async (req, res) => {
    try {
        const { q } = req.query;
        let fetch = `
            SELECT DISTINCT
             c.id, c.cCode, c.cName, c.cId
            FROM customer c
            INNER JOIN gstsalesinvo gst ON gst.custName = c.cId
            WHERE 1=1
        `;
        const values = [];

        if (q) {
            fetch += ` AND (c.cCode LIKE ?)`;
            values.push(`${q}%`);
        }

        fetch += ` LIMIT 10`;

        const [rows] = await connection.execute(fetch, values);
        return handleSuccessResponse(res, "Items", rows);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// Search Api for InvNo & its details from gstsalesinvo
exports.gstInvoices = async (req, res) => {
    try {
        const id = req.params.id;
        const { q } = req.query;

        let fetch = `
            SELECT 
             gst.id, gst.invNo, gst.billAdd, gst.totalValue, gst.stateCode, gst.gstNo,
             DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate, c.cCode
            FROM gstsalesinvo gst 
            INNER JOIN customer c ON gst.custName = c.cId
            WHERE gst.custName = ? AND gst.dflag = 0
        `;
        const values = [id];

        if (q) {
            fetch += ` AND (gst.invNo LIKE ?)`;
            values.push(`%${q}%`);
        }

        fetch += ` LIMIT 10`;

        const [rows] = await connection.execute(fetch, values);
        return handleSuccessResponse(res, "Invoices", rows);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// Search Api for Items from gstsalesinvoitem
exports.invItems = async (req, res) => {
    try {
        const id = req.params.id;
        const { q } = req.query;

        let fetch = `
            SELECT 
                gsi.id, gsi.partNo, gsi.partName, gsi.uom, gsi.hsnCode, items.id AS itemId,
                gsi.invRate, gsi.invQty, gsi.invQty AS retd, gsi.invQty * gsi.invRate AS value,
                gst.invNo, DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate,
                gst.CGSTPer AS cgstRate, 0 AS cgstAmt, gst.SGSTPer AS sgstRate, 0 AS sgstAmt, gst.IGSTPer AS igstRate, 0 AS igstAmt
            FROM gstsalesinvoitem gsi
            INNER JOIN items ON items.itemCode = gsi.partNo
            INNER JOIN gstsalesinvo gst ON gst.id = gsi.gstsalesinvo_id
            WHERE gsi.gstsalesinvo_id = ? AND gsi.partNo NOT LIKE '%-DC'
        `;
        const values = [id];

        if (q) {
            fetch += ` AND (items.itemCode LIKE ?)`;
            values.push(`${q}%`);
        }

        const [rows] = await connection.execute(fetch, values);
        return handleSuccessResponse(res, "Invoices", rows);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.store = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        await conn.beginTransaction();

        const data = req.body;
        const user = req.headers.username;
        const commonData = data.mainData;
        const variableData = data.items;

        // Insert common data into credit_note_mst table
        const insertCustomerDCQuery = `
            INSERT INTO credit_note_mst (digit, returnNo, gstMstId, cName, invNo, date, addedBy) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await conn.execute(insertCustomerDCQuery, [
            commonData.digit,
            commonData.returnNo,
            commonData.gstMstId,
            commonData.cName,
            commonData.invNo,
            commonData.date,
            user
        ]);

        const lastInsertId = result.insertId;

        // Insert variable data into credit_note_dtl table
        const insertCustomerDCPartsQuery = `
            INSERT INTO credit_note_dtl (gstItemsDtlId, itemId, invNo, invoIssuDate, invRate, invQty, retd, value, 
            cgstRate, cgstAmt, sgstRate, sgstAmt, igstRate, igstAmt, remarks, creditNote_mstId) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const item of variableData) {
            await conn.execute(insertCustomerDCPartsQuery, [
                item.id,
                item.itemId,
                item.invNo,
                item.invoIssuDate,
                item.invRate,
                item.invQty,
                item.retd,
                item.value,
                item.cgstRate,
                item.cgstAmt,
                item.sgstRate,
                item.sgstAmt,
                item.igstRate,
                item.igstAmt,
                item.remarks,
                lastInsertId
            ]);
        }

        await conn.commit();
        return handleSuccessResponse(res, "Data Added Successfully");

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.showById = async (req, res) => {
    try {
        const invoiceId = req.params.id;
        const companyData = await company();

        const mainQuery = `
            SELECT cd.*, gst.invNo, gst.billAdd, gst.totalValue, gst.stateCode, gst.gstNo,
                DATE_FORMAT(cd.date, '%d-%m-%Y') AS date,
                DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate
            FROM credit_note_mst cd
            INNER JOIN gstsalesinvo gst ON gst.id = cd.gstMstId
            WHERE cd.id = ?
        `;

        const [invoiceResults] = await connection.execute(mainQuery, [invoiceId]);
        const invoiceData = invoiceResults[0];

        if (!invoiceData) {
            return res.status(404).json({ success: false, message: "Invoice not found" });
        }

        if (companyData) {
            Object.assign(invoiceData, companyData);
        }

        const detailedQuery = `
            SELECT cdi.*, gsi.partNo, gsi.partName, gsi.uom, gsi.hsnCode
            FROM credit_note_dtl cdi 
            INNER JOIN gstsalesinvoitem gsi ON gsi.id = cdi.gstItemsDtlId  
            WHERE cdi.creditNote_mstId = ?
        `;

        const [itemsData] = await connection.execute(detailedQuery, [invoiceData.id]);

        return res.status(200).json({
            success: true,
            mainData: invoiceData,
            items: itemsData,
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// Showdata APIs for credit_note_mst & credit_note_dtl
exports.getItems = async (req, res) => {
    try {
        const { type, id } = req.query;

        let po = `
            SELECT cd.*, gst.invNo, gst.billAdd, gst.totalValue, gst.stateCode, gst.gstNo,
                DATE_FORMAT(gst.invoIssuDate, '%d-%m-%Y') AS invoIssuDate,
                DATE_FORMAT(cd.date, '%d-%m-%Y') AS date
            FROM credit_note_mst cd
            INNER JOIN gstsalesinvo gst ON gst.id = cd.gstMstId
        `;
        let params = [];

        switch (type) {
            case 'first':
                po += ` ORDER BY cd.id ASC LIMIT 1`;
                break;
            case 'last':
                po += ` ORDER BY cd.id DESC LIMIT 1`;
                break;
            case 'forward':
                po += ` WHERE cd.id > ? ORDER BY cd.id ASC LIMIT 1`;
                params = [id];
                break;
            case 'reverse':
                po += ` WHERE cd.id < ? ORDER BY cd.id DESC LIMIT 1`;
                params = [id];
                break;
        }

        const [rows] = await connection.execute(po, params);

        if (rows.length === 0) {
            return res.status(200).json({
                success: true,
                mainData: {},
                items: [],
            });
        }

        const matchingId = rows[0].id;
        let poItems = `
            SELECT cdi.*, gsi.partNo, gsi.partName, gsi.uom, gsi.hsnCode
            FROM credit_note_dtl cdi 
            INNER JOIN gstsalesinvoitem gsi ON gsi.id = cdi.gstItemsDtlId  
            WHERE cdi.creditNote_mstId = ?
        `;

        const [rows2] = await connection.execute(poItems, [matchingId]);

        return res.status(200).json({
            success: true,
            message: "Credit Notes fetched successfully",
            mainData: rows[0],
            items: rows2,
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


const utility = require("../utility/utilityFunction");
const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require('../config/dbSql');

exports.searchCity = async (req, res) => {
    try {
        const { q = "" } = req.query;

        const sql = `
            SELECT 
                c.id, c.name, c.stateId, c.countryId, s.name  AS state,
                s.code  AS stateCode, co.name AS country
            FROM mst_city c
            INNER JOIN mst_state s   ON c.stateId = s.id
            INNER JOIN mst_country co ON c.countryId = co.id
            WHERE c.dflag = 0
              AND c.name LIKE CONCAT(?, '%')
            ORDER BY c.name
            LIMIT 10
        `;

        const [rows] = await connection.execute(sql, [q]);

        return handleSuccessResponse(res, 'City list', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.generateId = async (req, res) => {
    try {
        const config = ["supplier", "SUP", "sId"];
        const id = await utility.uniqueId(config);

        res.status(200).json({ success: true, id });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Error generating ID",
            error: err.message
        });
    }
};

exports.docUpload = async (req, res) => {
    try {
        const { sId, fileType, file } = req.body;
        if (!sId || !file) {
            return res.status(400).json({ success: false, message: "Invalid payload" });
        }

        const fileName = utility.storeFile(file, "supplier");

        await connection.execute(
            `INSERT INTO sup_doc (sId, fileType, filePath) VALUES (?, ?, ?)`,
            [sId, fileType, fileName]
        );

        return handleSuccessResponse(res, 'Successfully added');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.docDelete = async (req, res) => {
    try {
        const { id: sId } = req.params;
        if (!sId) {
            return res.status(400).json({ success: false, message: "Supplier ID required" });
        }

        await connection.execute(
            `DELETE FROM sup_doc WHERE sId = ?`,
            [sId]
        );

        return handleSuccessResponse(res, 'Successfully deleted');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.docDeleteById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ success: false, message: "Document ID required" });
        }

        await connection.execute(
            `DELETE FROM sup_doc WHERE id = ?`,
            [id]
        );

        return handleSuccessResponse(res, 'Successfully deleted');
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.docShow = async (req, res) => {
    try {
        const { id: sId } = req.params;
        if (!sId) {
            return res.status(400).json({ success: false, message: "Supplier ID required" });
        }

        const [rows] = await connection.execute(
            `SELECT id, fileType, filePath FROM sup_doc WHERE sId = ?`,
            [sId]
        );

        return handleSuccessResponse(res, 'docs list', rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.docDownload = async (req, res) => {
    try {
        const { id } = req.params;

        const [[doc]] = await pool.execute(
            `SELECT filePath, fileType FROM sup_doc WHERE id = ?`,
            [id]
        );

        if (!doc) {
            return res.status(404).json({ success: false, message: "File not found" });
        }

        const filePath = `public/${doc.filePath}`;
        utility.exportFile(res, filePath, doc.fileType);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.store = async (req, res) => {
    try {
        const sp = req.body;

        const [existingRows] = await connection.execute(`
            SELECT id FROM supplier WHERE spName = ? OR spCode = ?`
            , [sp.spName, sp.spCode]
        );

        if (existingRows.length) {
            throw new CustomError(`Duplicate SupplierCode or SupplierName found!`);
        }

        const payload = {
            sId: sp.sId,
            spCode: sp.spCode,
            gstNo: sp.gstNo,
            spName: sp.spName,
            tallyAlias: sp.tallyAlias,
            spGroup: sp.spGroup || null,
            spAdd1: sp.spAdd1,
            spAdd2: sp.spAdd2,
            spAdd3: sp.spAdd3,
            spAdd4: sp.spAdd4,
            inactiveStatus: sp.inactiveStatus,
            partyNotes: sp.partyNotes,
            city: sp.city,
            pincode: sp.pincode,
            state: sp.state,
            country: sp.country,
            email: sp.email,
            currency: sp.currency || null,
            contactPerson: sp.contactPerson,
            phoneNo: sp.phoneNo,
            attention: sp.attention,
            spType: sp.spType || null,
            paymentTerms: sp.paymentTerms,
            panNo: sp.panNo,
            spPlace: sp.spPlace || null,
            distance: sp.distance,
            shippingPinCode: sp.shippingPinCode,
            actToState: sp.actToState,
            toStateCode: sp.toStateCode,
            stateCode: sp.stateCode
        };

        const sql = `
            INSERT INTO supplier (
                sId, spCode, gstNo, spName, tallyAlias, spGroup,
                spAdd1, spAdd2, spAdd3, spAdd4,
                inactiveStatus, partyNotes, city, pincode, state, country,
                email, currency, contactPerson, phoneNo, attention, spType,
                paymentTerms, panNo, spPlace, distance, shippingPinCode,
                actToState, toStateCode, stateCode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await connection.execute(sql, Object.values(payload));

        return handleSuccessResponse(res, "Successfully added");
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const sp = req.body;

        if (!id) {
            throw new CustomError("Supplier ID is required");
        }

        const payload = [
            sp.gstNo, sp.spName, sp.tallyAlias, sp.spGroup || null, sp.spAdd1, sp.spAdd2, sp.spAdd3, sp.spAdd4, sp.inactiveStatus, sp.partyNotes, sp.city, sp.pincode,
            sp.state, sp.country, sp.email, sp.currency || null, sp.contactPerson, sp.phoneNo, sp.attention, sp.spType || null, sp.paymentTerms, sp.panNo, sp.spPlace || null,
            sp.distance, sp.shippingPinCode, sp.actToState, sp.toStateCode, sp.stateCode, id
        ];

        const sql = `
            UPDATE supplier
            SET
                gstNo = ?, spName = ?, tallyAlias = ?, spGroup = ?,
                spAdd1 = ?, spAdd2 = ?, spAdd3 = ?, spAdd4 = ?,
                inactiveStatus = ?, partyNotes = ?, city = ?, pincode = ?,
                state = ?, country = ?, email = ?, currency = ?,
                contactPerson = ?, phoneNo = ?, attention = ?, spType = ?,
                paymentTerms = ?, panNo = ?, spPlace = ?, distance = ?,
                shippingPinCode = ?, actToState = ?, toStateCode = ?, stateCode = ?
            WHERE id = ?
        `;

        const [result] = await connection.execute(sql, payload);

        if (result.affectedRows === 0) {
            throw new CustomError("Supplier details not found");
        }

        return handleSuccessResponse(res, "Successfully updated");
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.delete = async (req, res) => {
    try {
        const { id } = req.params;

        const [[mapped]] = await connection.execute(
            `SELECT 1 FROM supp_vs_item WHERE spId = ? LIMIT 1`,
            [id]
        );

        if (mapped) {
            throw new CustomError("Cannot delete supplier mapped in SuppVsItem!");
        }

        const [result] = await connection.execute(
            `DELETE FROM supplier WHERE id = ?`,
            [id]
        );

        if (result.affectedRows === 0) {
            throw new CustomError("Supplier not found");
        }

        return handleSuccessResponse(res, "Successfully deleted");
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.show = async (req, res) => {
    try {
        const sql = `
            SELECT
                sp.*,
                cr.name   AS currencyName,
                sup.name  AS supplyPlaceName,
                spGrp.name AS supplyGroupName
            FROM supplier sp
            LEFT JOIN mst_currency cr   ON sp.currency = cr.id
            LEFT JOIN mst_sup_place sup ON sp.spPlace = sup.id
            LEFT JOIN mst_sup_group spGrp ON sp.spGroup = spGrp.id
            WHERE sp.dflag = 0
            ORDER BY sp.id DESC
        `;
        const [rows] = await connection.execute(sql);

        return handleSuccessResponse(res, "Suppliers list", rows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.showById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            throw new CustomError("Supplier ID is required");
        }

        const sql = `
            SELECT
                sp.*,
                cr.name   AS currencyName,
                sup.name  AS supplyPlaceName,
                spGrp.name AS supplyGroupName
            FROM supplier sp
            LEFT JOIN mst_currency cr   ON sp.currency = cr.id
            LEFT JOIN mst_sup_place sup ON sp.spPlace = sup.id
            LEFT JOIN mst_sup_group spGrp ON sp.spGroup = spGrp.id
            WHERE sp.dflag = 0
              AND sp.id = ?
            LIMIT 1
        `;

        const [supplier] = await connection.execute(sql, [id]);

        if (!supplier.length) {
            throw new CustomError("Supplier not found!");
        }

        return handleSuccessResponse(res, "Supplier details", supplier)
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.display = async (req, res) => {
    try {
        const { type, id } = req.query;

        let sql = `
            SELECT
                sp.*,
                cr.name   AS currencyName,
                sup.name  AS supplyPlaceName,
                spGrp.name AS supplyGroupName
            FROM supplier sp
            LEFT JOIN mst_currency cr   ON sp.currency = cr.id
            LEFT JOIN mst_sup_place sup ON sp.spPlace = sup.id
            LEFT JOIN mst_sup_group spGrp ON sp.spGroup = spGrp.id
            WHERE sp.dflag = 0
        `;

        const params = [];

        switch (type) {
            case "first":
                sql += " ORDER BY sp.id ASC LIMIT 1";
                break;

            case "last":
                sql += " ORDER BY sp.id DESC LIMIT 1";
                break;

            case "forward":
                sql += " AND sp.id > ? ORDER BY sp.id ASC LIMIT 1";
                params.push(id);
                break;

            case "reverse":
                sql += " AND sp.id < ? ORDER BY sp.id DESC LIMIT 1";
                params.push(id);
                break;

            default:
                return res.status(400).json({
                    success: false,
                    message: "Invalid display type"
                });
        }

        const [row] = await connection.execute(sql, params);

        if (!row) {
            throw new CustomError("No supplier found");
        }

        return res.status(200).json({
            success: true,
            data: row
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

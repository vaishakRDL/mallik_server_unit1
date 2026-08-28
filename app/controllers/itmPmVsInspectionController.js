const { connection, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');


// Get Process List from item_vs_pm table where items are assigned to process
exports.getPm = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { item, type } = req.body;

        const fetchData = `
         SELECT 
            ivp.id, pm.name AS process, pm.id AS processId, ivp.item AS itemId, ivp.isQlty
            FROM item_vs_pm ivp
            INNER JOIN mst_pm pm ON ivp.process = pm.id
            INNER JOIN qlty_template qt ON ivp.process = qt.process
            INNER JOIN items itm 
                ON ivp.item = itm.id
            WHERE 
                itm.itemCode = ? AND qt.type = ? AND ivp.dflag = 0
            GROUP BY pm.id
            ORDER BY MIN(ivp.processPriority)
            `;

        const [data] = await conn.execute(fetchData, [item, type]);

        return handleSuccessResponse(res, "Items", data);
    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};



exports.getQcList = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { type, itemId, processId } = req.body;

        const fetchId = `
        SELECT 
            itmPmInspec.*, itmPmInspec.qltyParameter AS label, itmPmInspec.evalMethod AS inspectionType, 
            itmPmInspec.inspectionType AS qltInspecType, uomTab.name AS uom, uomTab.id AS uomId
        FROM itempm_vs_inspec AS itmPmInspec
        INNER JOIN mst_uom AS uomTab 
            ON itmPmInspec.uom = uomTab.id
        INNER JOIN mst_qlty_inspections AS inspec 
            ON itmPmInspec.inspectionId = inspec.id
        WHERE 
            itmPmInspec.type = ? AND itmPmInspec.item = ? AND itmPmInspec.process = ?
        `;

        const [mappedData] = await conn.execute(fetchId, [type, itemId, processId]);

        let data;

        // If no mapped QC found, fetch from template
        if (mappedData.length === 0) {
            const fetchId2 = `
                SELECT 
                qc_field.*, qc_field.id AS qcFieldId, uomTab.name AS uom, uomTab.id AS uomId, inspec.inspectionType AS inspectionType, inspec.id AS inspectionId
                FROM qc_field
                INNER JOIN mst_uom AS uomTab 
                ON qc_field.uom = uomTab.id
                INNER JOIN qlty_template AS qt 
                ON qc_field.tempId = qt.id
                INNER JOIN mst_qlty_inspections AS inspec 
                ON qc_field.inspectionType = inspec.id
                WHERE 
                qc_field.processId = ? AND qt.type = ? AND qc_field.dflag = 0
            `;

            const [templateData] = await conn.execute(fetchId2, [processId, type,]);

            data = templateData;
        } else {
            data = mappedData;
        }

        return handleSuccessResponse(res, "Items", data);
    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


exports.store = async (req, res) => {
    try {
        const inspecArray = req.body;

        const user = req.headers.username;

        const insertQuery = `INSERT INTO itempm_vs_inspec 
            (type, item, uom, process, qcFieldId, inspectionId, inspectionType, qltyParameter, expVal, minTolerance, 
            maxTolerance, expVisInspec, evalMethod, addedBy) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const updateQuery = `UPDATE itempm_vs_inspec SET 
            uom = ?, inspectionId = ?, inspectionType = ?, qltyParameter = ?, expVal = ?, minTolerance = ?, 
            maxTolerance = ?, expVisInspec = ?, evalMethod = ? 
            WHERE type = ? AND item = ? AND process = ? AND qcFieldId = ?`;

        // const updateStatusQuery = 'UPDATE item_vs_pm SET isQlty = 1 WHERE id = ?';

        let errors = [];

        // Using a for loop to ensure async/await works correctly
        for (const qlty of inspecArray) {
            try {
                const [existingRows] = await connection.query(
                    'SELECT * FROM itempm_vs_inspec WHERE  type = ? AND item = ? AND process = ? AND qcFieldId = ?',
                    [qlty.type, qlty.itemId, qlty.processId, qlty.qcFieldId]
                );

                if (existingRows.length > 0) {
                    // If the row exists, update it
                    await connection.query(updateQuery, [
                        qlty.uomId, qlty.inspectionId, qlty.qltInspecType, qlty.label, qlty.expVal, qlty.minTolerance,
                        qlty.maxTolerance, qlty.expVisInspec, qlty.inspectionType, qlty.type, qlty.itemId, qlty.processId, qlty.qcFieldId
                    ]);
                } else {

                    // If the row does not exist, insert it
                    await connection.query(insertQuery, [
                        qlty.type, qlty.itemId, qlty.uomId, qlty.processId, qlty.qcFieldId, qlty.inspectionId, qlty.qltInspecType,
                        qlty.label, qlty.expVal, qlty.minTolerance, qlty.maxTolerance, qlty.expVisInspec, qlty.inspectionType, user
                    ]);
                }

                // Update isQlty Status as 1
                // await connection.query(updateStatusQuery, [qlty.statusId]);
            } catch (error) {
                // console.error('Error processing item:', error);
                errors.push(`Error processing item with ID ${qlty.itemId}: ${error.message}`);
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: 'Errors occurred', errors });
        } else {
            return res.status(200).json({ success: true, message: "Data added/updated successfully" });
        }
    } catch (err) {
        // console.error('Unexpected error:', err);
        return res.status(500).json({ success: false, message: 'An unexpected error occurred', error: err.message });
    }
};





exports.addInspec = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const {
      tempId, processId, qltyParam, uomId, inspectionId, expVal, maxTolerance, minTolerance, expVisInspec, evalMethod,
    } = req.body;

    const store = `
      INSERT INTO qc_field 
        (tempId, processId, label, uom, inspectionType, expVal, maxTolerance, minTolerance, expVisInspec, evalMethod)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await conn.execute(store, [
      tempId, processId, qltyParam, uomId, inspectionId, expVal, maxTolerance, minTolerance, expVisInspec, evalMethod,
    ]);

    return handleSuccessResponse(res, "Data Added", result);
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    conn.release();
  }
};


exports.spcAdd = async (req, res) => {
    try {
        const inspecArray = req.body;
        const user = req.headers.username;

        // Prepare the insert query
        const insertQuery = `
            INSERT INTO qc_spc 
            (type, item, uom, process, qcFieldId, inspectionId, inspectionType, expVal, minTolerance, 
            maxTolerance, expVisInspec, addedBy)  VALUES ?`;

        // Prepare values for bulk insertion
        const values = inspecArray.map(qlty => [
            qlty.type, qlty.itemId, qlty.uomId, qlty.processId, qlty.qcFieldId, qlty.inspectionId, qlty.qltInspecType,
            qlty.expVal, qlty.minTolerance, qlty.maxTolerance, qlty.expVisInspec, user
        ]);

        // Perform bulk insertion
        await connection.query(insertQuery, [values]);

        return res.status(200).json({ success: true, message: "Data added successfully" });
    } catch (error) {
        // Log the error and return a proper response
        console.error('Unexpected error:', error);
        return res.status(500).json({
            success: false,
            message: 'An unexpected error occurred',
            error: error.message
        });
    }
};

exports.qcRuleAdd = async (req, res) => {
    try {
        const qlty = req.body;
        const user = req.headers.username;

        const [existingRows] = await connection.query(
            'SELECT id FROM qc_rule WHERE  type = ? AND itemGroupId = ? ',
            [qlty.type, qlty.itemGroupId]
        );

        if (existingRows.length > 0) {
            return res.status(400).json({
                success: false,
                message: `QC rule already added for  itemGroup`
            });
        }


        // Prepare the insert query
        const insertQuery = `
            INSERT INTO qc_rule 
            (type, itemGroupId, displayName, inspectionPlan, inspectionLevel, addedBy)  
            VALUES (?, ?, ?, ?, ?, ?)`;

        const values = [
            qlty.type, qlty.itemGroupId, qlty.displayName,
            qlty.inspectionPlan, qlty.inspectionLevel, user
        ];

        await connection.query(insertQuery, values);

        return res.status(200).json({ success: true, message: "Data added successfully" });
    } catch (error) {
        console.error('Unexpected error:', error);
        return res.status(500).json({
            success: false,
            message: 'An unexpected error occurred',
            error: error.message
        });
    }
};



exports.qcRuleUpdate = async (req, res) => {
    try {

        const { type, displayName, inspectionPlan, inspectionLevel } = req.body;
        const user = req.headers.username;
        const id = req.params.id;


        if (!id) {
            return res.status(400).json({ success: false, message: "ID is required for updating the record." });
        }

        // Prepare the update query
        const updateQuery = `
            UPDATE qc_rule 
            SET type = ?, displayName = ?,
                inspectionPlan = ?, inspectionLevel = ?, updatedBy = ?
            WHERE id = ?`;

        const values = [
            type, displayName,
            inspectionPlan, inspectionLevel, user, id
        ];

        const [result] = await connection.query(updateQuery, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "No record found with the provided ID." });
        }

        return res.status(200).json({ success: true, message: "Data updated successfully." });
    } catch (error) {
        console.error('Unexpected error:', error);
        return res.status(500).json({
            success: false,
            message: 'An unexpected error occurred',
            error: error.message
        });
    }
};


exports.qcRule = async (req, res) => {
    try {

        const [rows] = await connection.execute(`
            SELECT 
            qc_rule.*,mil.name AS inspectionLevel, mil.id AS inspectionLevelId, ig.code As itemGroup, ig.id As itemGroupId,
            d.code As displayName, d.id As displayNameId
            FROM qc_rule
            INNER JOIN mst_item_group ig ON ig.id = qc_rule.itemGroupId
            INNER JOIN mst_display_name d ON d.id = qc_rule.displayName
            LEFT JOIN mst_inspection_level mil ON qc_rule.inspectionLevel = mil.id  
            `, []
        );

        return handleSuccessResponse(res, 'Qc Rules', rows);
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}


exports.getQcRule = async (req, res) => {
    try {

        const type = req.query.type

        const [rows] = await connection.execute(`
            SELECT 
                qc_rule.id, qc_rule.type,
                ig.code AS itemGroup, 
                d.code AS displayName, 
                CONCAT(ig.code, '-', d.code) AS qcRule
            FROM qc_rule
            INNER JOIN mst_item_group ig ON ig.id = qc_rule.itemGroupId
            INNER JOIN mst_display_name d ON d.id = qc_rule.displayName
            WHERE qc_rule.type =  ?
            `, [type]
        );

        return handleSuccessResponse(res, 'Qc Rules', rows);
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}



exports.qcRuleDlt = async (req, res) => {
    try {


        const id = req.params.id;
        const [rows] = await connection.execute(`
            DELETE from  qc_rule WHERE id = ? `, [id]
        );

        return handleSuccessResponse(res, 'Deleted Sucessfully');
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}




exports.ruleMapAdd = async (req, res) => {
    try {
        // Trim keys to remove extra spaces
        // const qlty = Object.fromEntries(
        //     Object.entries(req.body).map(([key, value]) => [key.trim(), value])
        // );

        const qlty = req.body;
        const user = req.headers.username;

        // Prepare the insert query
        const insertQuery = `
            INSERT INTO map_qc_rule 
            (qcRuleId, lotFrom, lotTo, batchQtyName, batchQty, addedBy) 
            VALUES (?, ?, ?, ?, ?, ?)`;

        const values = [
            qlty.qcRuleId, qlty.lotFrom, qlty.lotTo, qlty.batchQtyName,
            qlty.batchQty, user
        ];

        await connection.query(insertQuery, values);

        return res.status(200).json({ success: true, message: "Data added successfully" });
    } catch (error) {
        console.error('Unexpected error:', error);
        return res.status(500).json({
            success: false,
            message: 'An unexpected error occurred',
            error: error.message
        });
    }
};



exports.ruleMapUpdate = async (req, res) => {
    try {

        const { qcRuleId, lotFrom, lotTo, batchQtyName, batchQty } = req.body;
        const user = req.headers.username;
        const id = req.params.id;


        if (!id) {
            return res.status(400).json({ success: false, message: "ID is required for updating the record." });
        }

        // Prepare the update query
        const updateQuery = `
            UPDATE map_qc_rule 
            SET qcRuleId = ?, lotFrom = ?, lotTo = ?, batchQtyName = ?,
                batchQty = ?, updatedBy = ?
            WHERE id = ?`;

        const values = [
            qcRuleId, lotFrom, lotTo, batchQtyName, batchQty, user, id
        ];

        const [result] = await connection.query(updateQuery, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "No record found with the provided ID." });
        }

        return res.status(200).json({ success: true, message: "Data updated successfully." });
    } catch (error) {
        console.error('Unexpected error:', error);
        return res.status(500).json({
            success: false,
            message: 'An unexpected error occurred',
            error: error.message
        });
    }
};


exports.qcRuleMap = async (req, res) => {
    try {

        const [rows] = await connection.execute(`
            SELECT
            map_qc_rule.*,  qc_rule.type, mil.name AS batchQtyName,mil.id as inspectionLevelId,  d.code As displayName, d.id As displayNameId,
            CONCAT(ig.code, '-', d.code) AS qcRule

            FROM map_qc_rule 
            INNER JOIN qc_rule ON qc_rule.id = map_qc_rule.qcRuleId
            INNER JOIN mst_display_name d ON d.id = qc_rule.displayName
            INNER JOIN mst_item_group ig ON ig.id = qc_rule.itemGroupId

            LEFT JOIN mst_inspection_level mil ON map_qc_rule.batchQtyName = mil.id
            `, []
        );

        return handleSuccessResponse(res, 'Qc Rules', rows);
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}


exports.ruleMapDlt = async (req, res) => {
    try {


        const id = req.params.id;
        const [rows] = await connection.execute(`
            DELETE from  map_qc_rule WHERE id = ? `, [id]
        );

        return handleSuccessResponse(res, 'Deleted Sucessfully');
    } catch (err) {
        return handleErrorResponse(res, err)
    }
}



exports.assemblyProcess = async (req, res) => {
    try {
        const id = Number(req.params.id);

        const sqlQuery = `
            SELECT 
                mst_pm.id, mst_pm.code as process, mst_pm.id AS processId, qt.tempName
            FROM 
                qlty_template qt
            INNER JOIN mst_pm ON mst_pm.id = qt.process
            WHERE 
                qt.type = 'Assembly';
        `;

        const [rows] = await connection.execute(sqlQuery);

        const modifiedRows = rows.map(row => ({ ...row, itemId: id }));
        // //console.log(modifiedRows); // 

        return handleSuccessResponse(res, 'Assembly Process', modifiedRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

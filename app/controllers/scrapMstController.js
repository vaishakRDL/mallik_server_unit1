
const { connection, CustomError } = require('../config/dbSql');
const utility = require('../utility/utilityFunction');
const moment = require('moment-timezone');

exports.store = async (req, res) => {
    try {
        const scrap = req.body;

        const [rows, fields] = await connection.execute(`SELECT * FROM scrap_mst WHERE  type = ? AND name = ? `, [scrap.type, scrap.name]);

        if (rows.length > 0) {
            return res.status(400).json({ success: false, message: "rsnName is already exists!" });
        }


        const storeQuery = 'INSERT INTO scrap_mst (type, name, description) VALUES (?, ?, ?)';
        const values = [scrap.type, scrap.name, scrap.description];

        const [sRows] = await connection.execute(storeQuery, values);

        if (sRows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "data addded successfully" });
        } else {
            throw new CustomError("Something went wrong!");
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
};


exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const scrap = req.body;

        const [fRows] = await connection.execute(`SELECT * FROM scrap_mst WHERE id = ?`, [id]);

        if (fRows.length == 0) {
            throw new CustomError("data not found!", 404);
        }

        const updateQuery = `UPDATE scrap_mst SET type = ?, name = ?, description = ? WHERE id = ?`;
        const values = [scrap.type, scrap.name, scrap.description, id];

        const [uRows] = await connection.execute(updateQuery, values);

        if (uRows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully updated" });
        } else {
            throw new CustomError("Something went wrong!");
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};



exports.delete = async (req, res) => {
    try {
        const id = req.params.id;

        const [fRows] = await connection.execute(`SELECT * FROM scrap_mst WHERE id = ?`, [id]);

        if (fRows.length == 0) {
            throw new CustomError("rsn not found!", 404);
        }

        const [DRows] = await connection.execute(`UPDATE scrap_mst SET dflag = 1 WHERE id = ?`, [id]);

        return res.status(200).json({ success: true, message: "Successfully deleted" });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}



exports.show = async (req, res) => {
    try {

        const query = `
            SELECT id, type, name, description	
            FROM scrap_mst   
            WHERE dflag = 0`;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Scrap list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



// *********************************           SCRAP  REPORT        *************************************** //


//GET Machines From which are stored in scrap_data_logs Table only
exports.getMachine = async (req, res) => {
    try {

        const query = `
            SELECT  DISTINCT
                mach.id, mach.machineName

            FROM scrap_data_logs scrpDlg  
                INNER JOIN machines as mach ON scrpDlg.machineId = mach.id
            WHERE  scrpDlg.dflag = 0 `;

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




exports.getCategory = async (req, res) => {
    try {

        const query = `
            SELECT DISTINCT  category
            FROM scrap_data_logs WHERE category != 'Paint sludge'`;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.id = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Category list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}




exports.getMaterial = async (req, res) => {
    try {

        const query = `
            SELECT DISTINCT  material
            FROM scrap_data_logs`;


        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.id = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Raw Material list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}




exports.getThickness = async (req, res) => {
    try {

        const query = `
            SELECT DISTINCT thickness
            FROM scrap_data_logs
            ORDER BY CAST(SUBSTRING_INDEX(thickness, ' ', 1) AS DECIMAL(10,2))`;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.id = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Raw Material list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



exports.analysisRepo = async (req, res) => {
    try {
        const { machineId, material, thickness, from, to } = req.body;

        // ------------------------- MAIN SCRAP QUERY -------------------------
        let scrapQuery = `
            SELECT 
                scrp.material,
                scrp.thickness,
                SUM(CASE WHEN scrp.category = 'Button' THEN scrp.weightScan ELSE 0 END) AS weightWithButton,
                SUM(CASE WHEN scrp.category != 'Button' THEN scrp.weightScan ELSE 0 END) AS weightWithoutButton,
                SUM(scrp.weightScan) AS totalConsumption
            FROM scrap_data_logs scrp
            WHERE scrp.category != 'Paint sludge'
        `;

        const params = [];

        if (machineId) {
            scrapQuery += ` AND scrp.machineId = ?`;
            params.push(machineId);
        }
        if (material) {
            scrapQuery += ` AND scrp.material = ?`;
            params.push(material);
        }
        if (thickness) {
            scrapQuery += ` AND scrp.thickness = ?`;
            params.push(thickness);
        }
        if (from && to) {
            scrapQuery += ` AND DATE(scrp.created_at) BETWEEN ? AND ?`;
            params.push(from, to);
        }

        scrapQuery += ` GROUP BY scrp.material, scrp.thickness`;

        const [scrapRows] = await connection.execute(scrapQuery, params);

        // ---------------------- UPDATED SHEET CONSUMPTION QUERY ----------------------
        // const [sheetRows] = await connection.execute(`
        //     SELECT 
        //         store.itemCode,
        //         store.outwardQty,
        //         items.materialThickness,
        //         mst_item_group.code AS groupCode
        //     FROM store
        //     INNER JOIN items ON items.id = store.itemId
        //     INNER JOIN mst_item_group ON mst_item_group.id = items.itemGroup
        //     WHERE store.outwardQty IS NOT NULL
        // `);


        //   const [sheetRows] = await connection.execute(`
        //     SELECT 
        //         mid.itemCode,
        //         mid.issuedQty,
        //         items.materialThickness,
        //         mst_item_group.code AS groupCode
        //     FROM material_issue_dtl mid
        //     INNER JOIN items ON items.id = mid.itemId
        //     INNER JOIN mst_item_group ON mst_item_group.id = items.itemGroup
        // `);


        let sheetQuery = `
            SELECT 
                mid.itemCode,
                mid.issuedQty,
                items.materialThickness,
                mst_item_group.code AS groupCode
            FROM material_issue_dtl mid
            INNER JOIN items ON items.id = mid.itemId
            INNER JOIN mst_item_group ON mst_item_group.id = items.itemGroup
            WHERE 1=1
        `;

        const sheetParams = [];

        if (from && to) {
            sheetQuery += ` AND DATE(mid.created_at) BETWEEN ? AND ?`;
            sheetParams.push(from, to);
        }

        const [sheetRows] = await connection.execute(sheetQuery, sheetParams);

        // ---------------------- PREPARE SHEET GROUPING ----------------------
        const sheetMap = {};

        sheetRows.forEach(row => {
            const issuedQty = Number(row.issuedQty) || 0;

            // groupCode must begin with "RAW MATERIAL-"
            if (!row.groupCode || !row.groupCode.startsWith("RAW MATERIAL-")) {
                return;
            }

            // MATERIAL extracted after "RAW MATERIAL-"
            const material = row.groupCode.replace("RAW MATERIAL-", "").trim();  
            if (!material) return;

            // Thickness from items.materialThickness
            const thicknessNum = parseFloat(row.materialThickness);
            if (isNaN(thicknessNum)) return;

            const key = `${material}__${thicknessNum}`;

            if (!sheetMap[key]) sheetMap[key] = 0;

            sheetMap[key] += issuedQty;
        });

        // ---------------------- FINAL GROUPING ----------------------
        const final = {};

        scrapRows.forEach(row => {
            if (!row.material || !row.thickness) return;

            const scrapThicknessNum = parseFloat(row.thickness);
            if (isNaN(scrapThicknessNum)) return;

            const sheetKey = `${row.material}__${scrapThicknessNum}`;

            const sheetConsumption = sheetMap[sheetKey] || 0;

            const withBtn = Number(row.weightWithButton) || 0;
            const withoutBtn = Number(row.weightWithoutButton) || 0;
            const totalWeight = Number(row.totalConsumption) || 0;

            if (!final[row.material]) {
                final[row.material] = {
                    material: row.material,
                    scrapWeightTotal: 0,
                    withButtonTotal: 0,
                    withoutButtonTotal: 0,
                    sheetConsumptionTotal: 0,
                    withButtonPercentage: 0,
                    withoutButtonPercentage: 0,
                    details: []
                };
            }

            let withButtonRatio = 0;
            let withoutButtonRatio = 0;

            if (sheetConsumption !== 0) {
                withButtonRatio = withBtn / sheetConsumption *100;
                withoutButtonRatio = withoutBtn / sheetConsumption  *100;
            }

            final[row.material].details.push({
                thickness: row.thickness,
                totalWeight: totalWeight.toFixed(2),
                withButton: withBtn.toFixed(2),
                withoutButton: withoutBtn.toFixed(2),
                sheetConsumption: sheetConsumption.toFixed(2),
                withButtonPercentage: withButtonRatio.toFixed(2),
                withoutButtonPercentage: withoutButtonRatio.toFixed(2)
            });

            final[row.material].scrapWeightTotal += totalWeight;
            final[row.material].withButtonTotal += withBtn;
            final[row.material].withoutButtonTotal += withoutBtn;
            final[row.material].sheetConsumptionTotal += sheetConsumption;
        });

        // ---------------------- FINALIZE TOTAL RATIOS ----------------------
        const result = Object.values(final).map(x => {
            let withBtnRatio = 0;
            let withoutBtnRatio = 0;

            if (x.sheetConsumptionTotal !== 0) {
                withBtnRatio = x.withButtonTotal / x.sheetConsumptionTotal  *100;
                withoutBtnRatio = x.withoutButtonTotal / x.sheetConsumptionTotal  *100;
            }

            return {
                material: x.material,
                scrapWeightTotal: x.scrapWeightTotal.toFixed(2),
                withButtonTotal: x.withButtonTotal.toFixed(2),
                withoutButtonTotal: x.withoutButtonTotal.toFixed(2),
                sheetConsumptionTotal: x.sheetConsumptionTotal.toFixed(2),
                withButtonPercentage: withBtnRatio.toFixed(2),
                withoutButtonPercentage: withoutBtnRatio.toFixed(2),
                details: x.details
            };
        });

        return res.json({ success: true, data: result });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};


exports.report = async (req, res) => {
    try {
        const { machineId, category, material, thickness, from, to } = req.body;

        // Base query from the view
        let query = `
            SELECT *
            FROM scrap_report_view
            WHERE 1=1`; // Use WHERE 1=1 to simplify dynamic query building

        const params = [];

        // Dynamically append conditions
        if (machineId) {
            query += ` AND machineId = ?`;
            params.push(machineId);
        }
        if (category) {
            query += ` AND category = ?`;
            params.push(category);
        }
        if (material) {
            query += ` AND material = ?`;
            params.push(material);
        }
        if (thickness) {
            query += ` AND thickness = ?`;
            params.push(thickness);
        }
        if (from && to) {
            query += ` AND STR_TO_DATE(date, '%d-%m-%Y') BETWEEN STR_TO_DATE(?, '%Y-%m-%d') AND STR_TO_DATE(?, '%Y-%m-%d')`;
            params.push(from, to);
        }
        

        // Execute the query
        const [rows] = await connection.execute(query, params);

        // Add serial numbers to the rows
        rows.forEach((row, index) => {
            row.slNo = index + 1;
        });

        // Total consumption query using the view
        let totalConsumptionQuery = `
            SELECT ROUND(SUM(weightScan), 2) AS totalConsumption
            FROM scrap_report_view
            WHERE 1=1`;

        const totalParams = [];

        // Apply the same filters for total consumption
        if (machineId) {
            totalConsumptionQuery += ` AND machineId = ?`;
            totalParams.push(machineId);
        }
        if (category) {
            totalConsumptionQuery += ` AND category = ?`;
            totalParams.push(category);
        }
        if (material) {
            totalConsumptionQuery += ` AND material = ?`;
            totalParams.push(material);
        }
        if (thickness) {
            totalConsumptionQuery += ` AND thickness = ?`;
            totalParams.push(thickness);
        }
        if (from && to) {
            totalConsumptionQuery += ` AND STR_TO_DATE(date, '%d-%m-%Y') BETWEEN STR_TO_DATE(?, '%Y-%m-%d') AND STR_TO_DATE(?, '%Y-%m-%d')`;
            totalParams.push(from, to);
        }

        // Execute total consumption query
        const [totalResult] = await connection.execute(totalConsumptionQuery, totalParams);
        const totalConsumption = totalResult[0].totalConsumption;

        // Construct the response object
        const responseObject = {
            success: true,
            data: rows,
            totalConsumption: totalConsumption || 0 // Default to 0 if no rows are found
        };

        // Send the response
        res.json(responseObject);

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};




exports.paintRepo = async (req, res) => {
    try {
        const { machineId, from, to } = req.body;

        let query = `SELECT * FROM paint_sludge_view WHERE 1=1`;
        const params = [];

        if (machineId) {
            query += ` AND machineId = ?`;
            params.push(machineId);
        }

        if (from && to) {
            query += ` AND STR_TO_DATE(date, '%d-%m-%Y') BETWEEN STR_TO_DATE(?, '%Y-%m-%d') AND STR_TO_DATE(?, '%Y-%m-%d')`;
            params.push(from, to);
        }

        // Execute the SQL query to get the rows from the view
        const [rows] = await connection.execute(query, params);

        // Add serial numbers to each row
        rows.forEach((row, index) => {
            row.slNo = index + 1;
        });

        // Get the total consumption from the view
        let totalConsumptionQuery = `
            SELECT ROUND(SUM(weightScan), 2) AS totalConsumption
            FROM paint_sludge_view WHERE 1=1`;
        const totalParams = [];

        if (machineId) {
            totalConsumptionQuery += ` AND machineId = ?`;
            totalParams.push(machineId);
        }

        if (from && to) {
            totalConsumptionQuery += ` AND STR_TO_DATE(date, '%d-%m-%Y') BETWEEN STR_TO_DATE(?, '%Y-%m-%d') AND STR_TO_DATE(?, '%Y-%m-%d')`;
            totalParams.push(from, to);
        }


        const [totalResult] = await connection.execute(totalConsumptionQuery, totalParams);
        const totalConsumption = totalResult[0]?.totalConsumption || 0;

        // Construct the response object
        const responseObject = {
            success: true,
            data: rows,
            totalConsumption: totalConsumption // Default to 0 if no rows are found
        };

        // Send the responseObject as a response
        res.json(responseObject);

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
};

exports.paintAnalysis = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { from, to } = req.body;

        if (!from || !to) {
            throw new CustomError("from & to date are required!");
        }

        await conn.beginTransaction();

        /* ================================
           PAINT / PAINTING CONSUMPTION
           ================================ */

        const paintConsumptionSql = `
            SELECT 
                mig.code AS material,
                items.uom AS uom,
                ROUND(SUM(mid.issuedQty), 2) AS qty
            FROM material_issue_dtl mid
            INNER JOIN items ON items.id = mid.itemId
            INNER JOIN mst_item_group mig ON mig.id = items.itemGroup
            WHERE 
                LOWER(mig.code) LIKE '%paint%'
                AND DATE(mid.created_at) BETWEEN ? AND ?
            GROUP BY mig.code, items.uom
            ORDER BY mig.code
        `;

        const [paintConsumption] = await conn.query(
            paintConsumptionSql,
            [from, to]
        );

        /* ================================
           SLUDGE GENERATED (IN KGS)
           ================================ */

        const sludgeSql = `
            SELECT 
                IFNULL(ROUND(SUM(weightScan), 2), 0) AS sludgeGeneratedKg
            FROM paint_sludge_view
            WHERE STR_TO_DATE(date, '%d-%m-%Y') BETWEEN ? AND ?
        `;

        const [sludgeResult] = await conn.query(
            sludgeSql,
            [from, to]
        );

        await conn.commit();

        return res.status(200).json({
            success: true,
            data: {
                paintConsumption,
                sludgeGeneratedKg: sludgeResult[0]?.sludgeGeneratedKg || 0
            }
        });

    } catch (error) {
        await conn.rollback();
        console.error("paintAnalysis error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error"
        });
    } finally {
        conn.release();
    }
};


// *********************************           BIN WEIGHT        *************************************** //


//Get Type based Scrap List
exports.showType = async (req, res) => {
    try {
        const check = req.body.type;

        const query = `
        SELECT id, name FROM scrap_mst WHERE dflag = 0 AND type = ?`;

        const [rows] = await connection.execute(query, [check]);

        if (rows.length >= 0) {
            return res.status(200).json({
                success: true,
                message: "Scrap Lists",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}





//Get Type based Scrap List
exports.category = async (req, res) => {
    try {

        const query = `
        SELECT id, name FROM scrap_mst WHERE dflag = 0 AND type = "Category"`;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {
            return res.status(200).json({
                success: true,
                message: "Scrap Lists",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}







//Get Type based Scrap List
exports.material = async (req, res) => {
    try {

        const query = `
        SELECT id, name FROM scrap_mst WHERE dflag = 0 AND type = "Raw Material"`;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {
            return res.status(200).json({
                success: true,
                message: "Scrap Lists",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}



//Store BinValues data
exports.storeBin = async (req, res) => {
    try {
        const scrap = req.body;

        // const [rows, fields] = await connection.execute(`SELECT * FROM bin_weight WHERE  scrapMstId = ?  `, [scrap.scrapMstId]);

        // if (rows.length > 0) {
        //     return res.status(400).json({ success: false, message: "Duplicate entry can't exists!" });
        // }


        const storeQuery = 'INSERT INTO bin_weight (category, rawMaterial, weight) VALUES (?, ?, ?)';
        const values = [scrap.category, scrap.rawMaterial, scrap.weight];

        const [sRows] = await connection.execute(storeQuery, values);

        if (sRows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "data addded successfully" });
        } else {
            throw new CustomError("Something went wrong!");
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
};


//Update the Bin 
exports.binUpdate = async (req, res) => {
    try {
        const id = req.params.id;
        const scrap = req.body;

        //Current DateTime
        const dateTime = await utility.currentDateTime();

        const [fRows] = await connection.execute(`SELECT * FROM bin_weight WHERE id = ?`, [id]);

        if (fRows.length == 0) {
            throw new CustomError("data not found!", 404);
        }

        const updateQuery = `UPDATE bin_weight SET weight = ?, updated_at = ? WHERE id = ?`;
        const values = [scrap.weight, dateTime, id];

        const [uRows] = await connection.execute(updateQuery, values);

        if (uRows.affectedRows > 0) {
            return res.status(200).json({ success: true, message: "Successfully updated" });
        } else {
            throw new CustomError("Something went wrong!");
        }

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};




exports.binShow = async (req, res) => {
    try {

        // const check = req.body.type;

        const query = `

        SELECT  
        bin_weight.*
          
        FROM bin_weight`;

        const [rows] = await connection.execute(query, []);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Scrap list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}




// *********************************        MACHINE OPERATOR     *************************************** //



exports.getCounts = async (req, res) => {
    try {
        const mach = req.body.machine;

        const query = `
            SELECT 
                SUM(CASE WHEN scrpDlg.category != "Rejected Part" THEN 1 ELSE 0 END) AS scrapCount,
                SUM(CASE WHEN scrpDlg.category = "Rejected Part" THEN 1 ELSE 0 END) AS rejCount
            FROM scrap_data_logs scrpDlg  
            INNER JOIN machines as mach ON scrpDlg.machineId = mach.id
            WHERE mach.machineName = ? AND scrpDlg.dflag = 0`;

        const [rows] = await connection.execute(query, [mach]);

        if (rows.length > 0) {
            return res.status(200).json({
                success: true,
                message: "Counts",
                data: {

                    scrapCount: rows[0].scrapCount,
                    rejCount: rows[0].rejCount
                }
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}



// ***********************************          ANDRROID SCRAP  APP      ***************************************************//


//GET Machines 
exports.machineAll = async (req, res) => {
    try {

        const query = `
            SELECT  
             id, machineName

            FROM machines 
            WHERE  dflag = 0 `;

        const [rows] = await connection.execute(query, []);

        // if (rows.length >= 0) {

        //     return res.status(200).json({
        //         success: true,
        //         message: "Machine list",
        //         data: rows
        //     });
        // }

        if (rows.length > 0) {
            return res.status(200).json(rows);
        } else {
            return res.status(200).json([]);
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



//GET Category 
exports.categoryAll = async (req, res) => {
    try {

        const query = ` 
            SELECT id, name
            FROM scrap_mst 
            WHERE dflag = 0 AND type = "Category"`;

        const [rows] = await connection.execute(query, []);

        // if (rows.length >= 0) {

        //     return res.status(200).json({
        //         success: true,
        //         message: "Machine list",
        //         data: rows
        //     });
        // }

        if (rows.length > 0) {
            return res.status(200).json(rows);
        } else {
            return res.status(200).json([]);
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



//GET Materials 
exports.materialAll = async (req, res) => {
    try {

        const query = ` 
            SELECT id, name
            FROM scrap_mst 
            WHERE dflag = 0 AND type = "Raw Material"`;

        const [rows] = await connection.execute(query, []);

        // if (rows.length >= 0) {

        //     return res.status(200).json({
        //         success: true,
        //         message: "Machine list",
        //         data: rows
        //     });
        // }

        if (rows.length > 0) {
            return res.status(200).json(rows);
        } else {
            return res.status(200).json([]);
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



//GET Materials 
exports.getThicknesAll = async (req, res) => {
    try {

        const query = ` 
            SELECT id, name
            FROM scrap_mst 
            WHERE dflag = 0 AND type = "Thickness"
            ORDER BY 
            CAST(SUBSTRING_INDEX(name, ' ', 1) AS DECIMAL(10,2))`;

        const [rows] = await connection.execute(query, []);

        // if (rows.length >= 0) {

        //     return res.status(200).json({
        //         success: true,
        //         message: "Machine list",
        //         data: rows
        //     });
        // }

        if (rows.length > 0) {
            return res.status(200).json(rows);
        } else {
            return res.status(200).json([]);
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}


exports.dateTime2 = async () => {
    // Set the default timezone to Asia/Calcutta
    const timezone = 'Asia/Calcutta';

    // Get the current date and time in the specified timezone
    const currentDateTime = moment().tz(timezone);
    const currentDate = currentDateTime.format('DD-MM-YYYY');
    const currentTime = currentDateTime.format('HH:mm:ss');

    // Subtract 59 seconds from the current time
    const timeLess = currentDateTime.clone().subtract(59, 'seconds');
    const timeLessFormatted = timeLess.format('HH:mm:ss');

    return {
        currentTime: currentTime,
        timeLessMin: timeLessFormatted,
        date: currentDate
    };
}



// //Store 
// exports.storeData = async (req, res) => {
//     const dataArray = req.body; // Assuming req.body is an array of objects with the necessary fields

//     try {
//         const dateGet = await exports.dateTime2();

//         for (const data of dataArray) {
//             const { machineId, category, material, thickness, weightScan, mode, reason } = data;


//             // Fetch weight from bin_weight table
//             let [resultRows] = await connection.execute(
//                 `SELECT weight FROM bin_weight 
//                 WHERE category = ? 
//                 AND rawMaterial = ?`,
//                 [category, material]
//             );

//             if (resultRows.length === 0) {
//                 [resultRows] = await connection.execute(
//                     `SELECT weight FROM bin_weight 
//                     WHERE category = ?`,
//                     [category]
//                 );
//             }

//             let adjustedWeightScan;
//             if (resultRows.length > 0) {
//                 const getWeight = resultRows[0].weight;
//                 adjustedWeightScan = weightScan - getWeight;
//             } else {
//                 adjustedWeightScan = weightScan;
//             }

//             // Insert the new data into scrap_data_logs table
//             await connection.execute(
//                 `INSERT INTO scrap_data_logs (machineId, category, material, thickness, weightScan, date, time, mode, reason)
//                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//                 [machineId, category, material, thickness, adjustedWeightScan, dateGet.date, dateGet.currentTime, mode, reason]
//             );

//             // Call the stock function with necessary data
//             const stockData = {
//                 material: material,
//                 qty: adjustedWeightScan
//             };
//             const stockResult = await exports.stock(stockData);
//             //console.log(stockResult); // Optional: log the result of stock function
//         }

//         res.status(200).json({
//             message: "Data Added successfully!",
//             status: 200
//         });

//     } catch (err) {
//         return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
//     }
// };

// Store Data
exports.storeData = async (req, res) => {
    let dataArray = req.body;

    // If req.body is not an array, convert it to an array of one object
    if (!Array.isArray(dataArray)) {
        dataArray = [dataArray];
    }

    try {
        const dateGet = await exports.dateTime2();

        for (const data of dataArray) {
            const { machineId, category, material, thickness, weightScan, mode, reason } = data;

            // Fetch weight from bin_weight table
            let [resultRows] = await connection.execute(
                `SELECT weight FROM bin_weight 
                WHERE category = ? 
                AND rawMaterial = ?`,
                [category, material]
            );

            if (resultRows.length === 0) {
                [resultRows] = await connection.execute(
                    `SELECT weight FROM bin_weight 
                    WHERE category = ?`,
                    [category]
                );
            }

            let adjustedWeightScan;
            if (resultRows.length > 0) {
                const getWeight = resultRows[0].weight;
                adjustedWeightScan = weightScan - getWeight;
            } else {
                adjustedWeightScan = weightScan;
            }

            // Insert the new data into scrap_data_logs table
            await connection.execute(
                `INSERT INTO scrap_data_logs (machineId, category, material, thickness, weightScan, date, time, mode, reason)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [machineId, category, material, thickness, adjustedWeightScan, dateGet.date, dateGet.currentTime, mode, reason]
            );

            // Call the stock function only if material is not an empty string
            if (material !== "") {
                const stockData = {
                    material: material,
                    qty: adjustedWeightScan
                };

                const stockResult = await exports.stock(stockData);
                // //console.log(stockResult); // Optional: log the result of stock function
            }
        }

        res.status(200).json({
            message: "Data Added successfully!",
            status: 200
        });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};


// Store BinValues data
exports.stock = async (scrap) => {
    try {
        const dateGet = await exports.dateTime2();
        let totStk;
        let qty = Number(scrap.qty);

        const [rows, fields] = await connection.execute(
            `SELECT id, totStk FROM scrap_stock WHERE material = ? ORDER BY id DESC`,
            [scrap.material]
        );

        if (rows.length > 0) {
            const curStk = Number(rows[0].totStk);
            totStk = curStk + qty;

        } else {
            totStk = qty;
        }


        // Round totStk to 2 decimal places
        totStk = Number(totStk.toFixed(2));


        const storeQuery = 'INSERT INTO scrap_stock (date, time, material, inWard, totStk) VALUES (?, ?, ?, ?, ?)';
        const values = [dateGet.date, dateGet.currentTime, scrap.material, scrap.qty, totStk];

        const [sRows] = await connection.execute(storeQuery, values);

        if (sRows.affectedRows > 0) {
            return { success: true, totStk };
        } else {
            throw new Error("Something went wrong!");
        }

    } catch (err) {
        throw new Error(err.message || 'An error occurred');
    }
};




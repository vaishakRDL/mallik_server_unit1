const { connection, barcodeDB, CustomError, handleSuccessResponse, handleErrorResponse } = require('../config/dbSql');

const utility = require('../utility/utilityFunction');
const path = require('path');


exports.getContract = async (req, res) => {
    try {

        // const id = req.params.id;

        const query = `
            SELECT  DISTINCT
             ContractNo
            FROM Barcode_CSL   
            `;

        const [rows] = await barcodeDB.execute(query, []);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.id = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Contract list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



exports.getPart = async (req, res) => {
    try {

        const no = req.body.no;

        const query = `
            SELECT BOMPartNo, MIN(id) as id
            FROM Barcode_CSL
            WHERE ContractNo = ? AND BOMPartNo IS NOT NULL AND BOMPartNo != ''
            GROUP BY BOMPartNo
        
        `;

        const [rows] = await barcodeDB.execute(query, [no]);

        if (rows.length >= 0) {

            return res.status(200).json({
                success: true,
                message: "Assembly Parts list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



exports.upload = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {

        const kit = req.body;
        let contractNo, bomPart, flag;


        if (kit.txtField) {

            if (!kit.txtField.includes('-')) {
                throw new CustomError("Enter Specified AssemblyPart!.");
            }
            // Split the txtField value by the delimiter '-'
            const getPart = kit.txtField.split('-');

            // Get the first part of the split string
            contractNo = getPart[0];

            bomPart = kit.txtField;
            flag = 1;


        } else {

            contractNo = kit.contractNo;
            bomPart = kit.bomPart;
            flag = 0;
        }

        const fileName = utility.storeFileReq(kit.file, 'boxKit', bomPart);

        const storeQuery = 'INSERT INTO box_kit_files (contractNo,  BOMPartNo, txtFlag, file) VALUES (?, ?, ?, ?)';
        const values = [contractNo, bomPart, flag, fileName];

        const [sRows] = await connection.execute(storeQuery, values);

        await conn.commit();
        return handleSuccessResponse(res, "Image Uploaded Successfully.");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};



exports.viewFile = async (req, res) => {
    try {

        const kit = req.body;

        // Get the local IP address
        const ipAddress = utility.getLocalIpAddress();

        // Get the port number from environment variables
        const port = process.env.APP_PORT || 8000;

        let query = `
            SELECT 
                box_kit_files.id, CONCAT('http://', ? , ':', ? , '/', box_kit_files.file) AS file_url
            FROM box_kit_files`;

        const params = [ipAddress, port];

        //if value uploaded through dropDown so  (txtFlag =0) 
        if (kit.contract && kit.bomPart) {
            query += ` WHERE contractNo = ? AND BOMPartNo LIKE ?`;
            params.push(kit.contract, `%${kit.bomPart}%`);


            //if value uploaded through TextField so  (txtFlag =1)  
        } else if (kit.bomPart) {
            query += ` WHERE BOMPartNo LIKE ?`;
            params.push(`%${kit.bomPart}%`);
        }


        const [rows] = await connection.execute(query, params);

        if (rows.length >= 0) {

            return res.status(200).json({
                success: true,
                message: "File",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}


//App
exports.view = async (req, res) => {
    try {

        const kit = req.body;

        let query = `
            SELECT 
                box_kit_files.id,  box_kit_files.file 
            FROM box_kit_files
            WHERE box_kit_files.BOMPartNo = ?`;

        const params = [kit.bomPart];

        const [rows] = await connection.execute(query, params);

        if (rows.length >= 0) {

            return res.status(200).json({
                success: true,
                message: "File",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}

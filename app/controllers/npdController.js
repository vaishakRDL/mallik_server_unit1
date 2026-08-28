
const { connection, CustomError } = require('../config/dbSql');
const utility = require('../utility/utilityFunction');
const path = require('path');
const { getUser } = require("../utility/utilityFunction");


exports.search = async (req, res) => {
    try {
        // Get the search query from the request query parameters
        const { q } = req.query;
        
        // Construct the SQL query to include search functionality
        let fetch = `
            SELECT DISTINCT items.id, items.itemCode as label FROM items 
            INNER JOIN npd  ON npd.itemId = items.id
            WHERE items.dflag = 0
        `;
        
        const values = [];

        // If there's a search query, add a condition to filter items based on the search query
        if (q) {
            fetch += ` AND (items.itemCode LIKE ?)`;
            values.push(`%${q}%`); // Append '%' to the search query to match item codes starting with the search query
        }

        fetch += ` ORDER BY CASE WHEN items.itemCode REGEXP '[^a-zA-Z0-9 ]' THEN 1 ELSE 0 END, items.itemCode LIMIT 100`;

        const [rows, fields] = await connection.execute(fetch, values);

        return res.status(200).json({ success: true, message: "Items", data: rows });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: "Internal server error", error: err.message });
    }
}




exports.getId = async (req, res) => {
    try {
        const [fRows] = await connection.execute('SELECT fileId FROM npd ORDER BY id DESC', []);
        // let revNo = 1;
        let fid = 'FID1'; // Default fileId if no records exist

        if (fRows.length > 0) {
            // revNo = parseInt(fRows[0].revisionNo) + 1; // Increment revisionNo

            const lastFileId = fRows[0].fileId;
            const numericPart = (lastFileId && lastFileId.match(/\d+/)) ? parseInt(lastFileId.match(/\d+/)[0]) : 0;
            fid = 'FID' + (numericPart + 1);
        }

        return res.status(200).json({
            // revisionNo: revNo,
            fileId: fid
        });
        
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
};



exports.store = async (req, res) => {
    try {
        const npd = req.body;

        // const [rows, fields] = await connection.execute(`SELECT * FROM npd WHERE itemId = ?  AND  npd.dflag = 0`, [npd.itemId]);

        // if (rows.length > 0) {
        //     return res.status(400).json({ success: false, message: "item Code is already exists!" });
        // }

        const fileName = utility.storeFile(npd.file, 'npd');

        const storeQuery = 'INSERT INTO npd (type, fileId, itemId, cnNo, fileType, revisionNo,  revDate, file) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        const values = [npd.type, npd.fileId, npd.itemId, npd.cnNo, npd.fileType, npd.revisionNo, npd.revDate, fileName];

        const [sRows] = await connection.execute(storeQuery, values);

        const updateQuery = `UPDATE items SET npdFile = ? WHERE id = ?`;
        const updValues = [fileName, npd.itemId];

        const [uRows] = await connection.execute(updateQuery, updValues);

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
        const npd = req.body;

        // const [fRows] = await connection.execute(`SELECT * FROM npds WHERE id = ?`, [id]);

        // if (fRows.length == 0) {
        //     throw new CustomError("npd not found!", 404);
        // }

        const fileName = utility.storeFile(npd.image, 'npd');

        const updateQuery = `UPDATE npd SET fileId = ?, itemId = ?, cnNo = ?, fileType = ?, revisionNo = ?, revDate = ?, file = ? WHERE id = ?`;
        const values = [npd.fileId, npd.itemId, npd.cnNo, npd.fileType, npd.revisionNo, npd.revDate, fileName, id];

        const [uRows] = await connection.execute(updateQuery, values);


        const updItmQuery = `UPDATE items SET npdFile = ? WHERE id = ?`;
        const updValues = [fileName, npd.itemId];

        const [updRows] = await connection.execute(updItmQuery, updValues);

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
        const npd = req.body;
        const userName = await getUser(req);  // Assuming this returns a string like a username

        const currentDate = new Date().toLocaleDateString('en-GB'); // Format: DD-MM-YYYY

        const [fRows] = await connection.execute(`SELECT * FROM npd WHERE id = ?`, [id]);

        if (fRows.length === 0) {
            throw new CustomError("npd not found!", 404);
        }

        // Update npd record with dflag=1, deleted_at, and deleted_by
        const [DRows] = await connection.execute(
            `UPDATE npd SET dflag = 1, reason = ?, deleted_at = ?, deletedBy = ? WHERE id = ?`,
            [npd.remark, currentDate, userName, id]
        );

        // Update npdRevisions records with dflag=1 where npdId matches
        const [DrevRows] = await connection.execute(`UPDATE npdRevisions SET dflag=1 WHERE npdId = ?`, [id]);

        return res.status(200).json({ success: true, message: "Successfully deleted" });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}



exports.show = async (req, res) => {
    try {

        const itm = req.body.itemId;
        const type = req.body.type;

        let query = `
            SELECT  npd.id, npd.fileId, npd.itemId, npd.cnNo, npd.fileType, npd.revisionNo, 
            npd.file, npd.type, npd.revDate,
            itm.itemCode AS item	
            FROM npd   
            INNER JOIN items as itm ON npd.itemId = itm.id
            WHERE npd.dflag = 0
            `;

        const params = [];


        if (itm && type) {
            query += ` AND npd.itemId = ? AND npd.type = ?`;
            params.push(itm, type);
             
        }else if (itm) {
            query += ` AND npd.itemId = ?`;
            params.push(itm);

        }else if (type) {
            query += ` AND npd.type = ?`;
            params.push(type);
 
        }   

        query += ` ORDER BY npd.id DESC`;


        const [rows] = await connection.execute(query, params);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "npds list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}




exports.fileUpload = async (req, res) => {
    try {
        const npd = req.body;

        const storedImagePaths = utility.storeFiles(npd.filesData, 'npdFile');

        const updateNpdQueries = [];
        const updateNpdValues = [];
        const updateItemsQueries = [];
        const updateItemsValues = [];

        storedImagePaths.forEach((imagePath) => {
            const fileName = path.basename(imagePath);
            // Update npd table
            const updateNpdQuery = `UPDATE npd SET file = ? WHERE fileName = ? AND  dflag = 0`;
            const npdValues = [imagePath, fileName];
            updateNpdQueries.push(updateNpdQuery);
            updateNpdValues.push(npdValues);

            // // Update items table based on itemId
            // const updateItemsQuery = `
            // UPDATE items 
            // SET npdFile = ? 
            // WHERE id = (
            //     SELECT itemId 
            //     FROM npd 
            //     WHERE npd.fileName = ? AND npd.dflag = 0 
            //     ORDER BY id DESC 
            //     LIMIT 1
            // )`;
            // const itemsValues = [imagePath, fileName];
            // updateItemsQueries.push(updateItemsQuery);
            // updateItemsValues.push(itemsValues);


            // Update items table based on itemId
            const updateItemsQuery = `
                UPDATE items 
                JOIN npd ON npd.itemId = items.id
                SET items.npdFile = npd.file`;

            // const itemsValues = [imagePath, fileName];
            updateItemsQueries.push(updateItemsQuery);
            // updateItemsValues.push(itemsValues);
        });

        // Execute all update queries for npd table
        for (let i = 0; i < updateNpdQueries.length; i++) {
            const [uRows] = await connection.execute(updateNpdQueries[i], updateNpdValues[i]);
            if (uRows.affectedRows === 0) {
                throw new CustomError("Failed to update");
            }
        }

        // Execute all update queries for items table
        for (let i = 0; i < updateItemsQueries.length; i++) {
            const [uRows] = await connection.execute(updateItemsQueries[i]);
            if (uRows.affectedRows === 0) {
                throw new CustomError("Failed to update items table");
            }
        }

        // Fetch data from npd table for each fileName
        const dataPromises = storedImagePaths.map(async (imagePath) => {
            const fileName = path.basename(imagePath);

            const selectQuery = ` 
            SELECT  npd.id, npd.fileId, npd.itemId, npd.cnNo, npd.fileType, npd.revisionNo, npd.revDate, npd.file, 
            itm.itemCode AS item	
            FROM npd   
            INNER JOIN items as itm ON npd.itemId = itm.id
            WHERE npd.fileName = ? AND  npd.dflag = 0`;
            
            const selectValues = [fileName];
            const [rows] = await connection.execute(selectQuery, selectValues);

            // Auto Index value
            const rowsWithSerialNumbers = rows.map((element, index) => {
                return { ...element, sNo: index + 1 };
            });

            return rowsWithSerialNumbers;
        });

        let data = await Promise.all(dataPromises);

        // Flatten the data array
        data = data.flat();

        return res.status(200).json({ success: true, message: "Successfully updated", data });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
};


//Deleted Npd 
// exports.dltLog = async (req, res) => {
//     try {

//         // const id = req.query.id;

//         const query = `
//         SELECT  npd.id, npd.fileId, npd.itemId, npd.cnNo, npd.fileType, npd.revisionNo, npd.revDate,
//         npd.file, npd.deletedBy, deleted_at, npd.reason,  itm.itemCode AS item	
//         FROM npd   
//         INNER JOIN items as itm ON npd.itemId = itm.id

//         WHERE npd.dflag = 1`;

//         const [rows] = await connection.execute(query, []);

//         if (rows.length >= 0) {

//             //Auto Index value
//             rows.forEach((element, index) => {
//                 element.sNo = index + 1;
//             });

//             return res.status(200).json({
//                 success: true,
//                 message: "Delete Log list",
//                 data: rows
//             });
//         }
//     } catch (err) {
//         return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
//     }
// }



exports.dltLog = async (req, res) => {
    try {

        const id = req.query.id;

        let query = `
        SELECT  npd.id, npd.fileId, npd.itemId, npd.cnNo, npd.fileType, npd.revisionNo, npd.revDate,
        npd.file, npd.deletedBy, deleted_at, npd.reason,  itm.itemCode AS item	
        FROM npd   
        INNER JOIN items as itm ON npd.itemId = itm.id

        WHERE npd.dflag = 1`;

        const params = [];


        if (id) {
            query += ` AND npd.itemId = ?`;
            params.push(id);
 
        }   

        // query += ` ORDER BY npd.id DESC`;


        const [rows] = await connection.execute(query, params);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Delete Log list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}



exports.docDownload = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        const { id } = req.params;

        const fetchQuery = `SELECT file FROM npd WHERE id = ?`;
        const [results] = await conn.query(fetchQuery, [id]);

        if (!results || results.length === 0) {
          new CustomError ("File not found!")
        }

        const fileLoc = results[0].file;
        const filePath = `public/${fileLoc}`;

        utility.exportFile(res, filePath);

    } catch (err) {
       return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


  

//* **************************************         NPD REVISION           ************************************ */


exports.revStore = async (req, res) => {
    try {
        const npd = req.body;

        // const [rows, fields] = await connection.execute(`SELECT * FROM npd_mst WHERE name = ?`, [npd.name]);

        // if (rows.length > 0) {
        //     return res.status(400).json({ success: false, message: "npdName is already exists!" });
        // }

        const fileName = utility.storeFile(npd.file, 'npdRevisions');

        const storeQuery = 'INSERT INTO npdRevisions (npdId, fileType, revisionNo, version, file, remarks) VALUES (?, ?, ?, ?, ?, ?)';
        const values = [npd.npdId, npd.fileType, npd.revisionNo, npd.version, fileName, npd.remarks];

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


exports.revUpdate = async (req, res) => {
    try {
        const id = req.params.id;
        const npd = req.body;

        const fileName = utility.storeFile(npd.image, 'npd');

        const updateQuery = `UPDATE npdRevisions SET npdId = ?, fileType = ?, revisionNo = ?, version = ?, file = ?, remarks = ? WHERE id = ?`;
        const values = [npd.npdId, npd.fileType, npd.revisionNo, npd.version, fileName, npd.remarks, id];

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



exports.revDelete = async (req, res) => {
    try {
        const id = req.params.id;

        const [DRows] = await connection.execute(`DELETE FROM npdRevisions WHERE id = ?`, [id]);

        return res.status(200).json({ success: true, message: "Successfully deleted" });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
}



exports.revShow = async (req, res) => {
    try {

        const id = req.params.id;

        const query = `
            SELECT  id, npdId, fileType, revisionNo, version, remarks	
            FROM npdRevisions   
            WHERE  npdId = ? AND  dflag = 0`;

        const [rows] = await connection.execute(query, [id]);

        if (rows.length >= 0) {

            //Auto Index value
            rows.forEach((element, index) => {
                element.sNo = index + 1;
            });

            return res.status(200).json({
                success: true,
                message: "Revisions list",
                data: rows
            });
        }
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occured' });
    }
}




//*************************                FOR MACHINE PLANNING                 ***********************************//


exports.viewFile = async (req, res) => {
    try {
        const part = req.body.part; // Assuming this is how you get the type value

        // Get the local IP address
        const ipAddress = utility.getLocalIpAddress();
        
        // Get the port number from environment variables
        const port = process.env.APP_PORT || 8000;

        // Construct the SQL query
        const sqlQuery = `
            SELECT 
                npd.id, 
                CONCAT('http://', ? , ':', ? , '/', npd.file) AS file_url
            FROM 
                npd
                INNER JOIN items AS itm ON npd.itemId = itm.id
            WHERE 
                npd.dflag = 0 AND 
                itm.itemCode = ?`;

        // Execute the SQL query
        const [rows, fields] = await connection.execute(sqlQuery, [ipAddress, port, part]);

        //Auto Index value
        rows.forEach((element, index) => {
            element.sNo = index + 1;
        });

        if (rows.length >= 0) {
            return res.status(200).json({
                success: true,
                message: "Npd File",
                data: rows
            });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || 'An error occurred' });
    }
}



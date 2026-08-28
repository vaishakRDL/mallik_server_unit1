const { connection, CustomError, handleErrorResponse } = require('../../config/dbSql');
const excel = require('exceljs');
const { decodeBase64 } = require('../../utility/utilityFunction');


exports.template = async (req, res) => {
    try {
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');

        // Add headers
        const headerRow = worksheet.addRow(['Contract Number', 'Part No', 'Qty', 'Description', 'Box No']);

        // Apply styles to the header row
        headerRow.font = { bold: true };  // Make text bold
        headerRow.font = { size: 13 };
        headerRow.alignment = { horizontal: 'center' };  // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Set content type and disposition including desired filename
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename = SOB.xlsx');

        // Write the Excel file to the response
        workbook.xlsx.write(res)
            .then(() => {
                // End the response stream
                res.end();
            })
            .catch(err => {
                console.error('Error writing Excel file:', err);
                res.status(500).send('Error generating Excel file');
            });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
    }
};


// SOB extraction for 1 Sheet
exports.import = async (req, res) => {
    let sobMstId;
    let contractNos = []; // Array to store contract numbers

    try {
        const { file, kanbanDate } = req.body;

        // Extract base64 data
        const buffer = await decodeBase64(file);    

        // Excel Processing
        const workbook = new excel.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        const sheetName = worksheet.name;

        // Data Extraction
        const contents = [];
        const totalRows = worksheet.rowCount;

        for (let i = 8; i <= totalRows; i++) { // Start from row 8
            const row = worksheet.getRow(i);

            if (row.getCell(1).value === undefined || row.getCell(1).value === null) {
                break; // Break the loop if an empty row is found
            }

            const contractNo = row.getCell(1).text;
            const formattedMsd = row.getCell(2).value;
            const fim = await getFIM(contractNo);

            if (contractNos.includes(contractNo)) {
                throw new CustomError(`duplicate contract no: ${contractNo}`, 400);
            }
            contractNos.push(contractNo);   // Pushing contractNo to the array

            row.eachCell((cell, colNumber) => {
                if (colNumber > 3) {
                    const header = worksheet.getRow(6).getCell(colNumber).text;
                    const subHeader = worksheet.getRow(7).getCell(colNumber).text;
                    const mstFim = fim + header.slice(3);          // Extract characters starting from index 3
                    const cellVal = cell.text;

                    if (cellVal === 'YES' && subHeader === 'MALLIK') {
                        const array = { contractNo: contractNo, fim: header, mstFim: mstFim, msd: formattedMsd, sheetName: sheetName };
                        contents.push(array);
                    }
                }
            });
        };

        // Sob Mst
        sobMstId = await sobMst(kanbanDate, contractNos);


        const cRows = await cslDetail();    // Fetch current CSL

        if (cRows.length > 0) {
            const extractedCont = await index(contents, cRows);     // Extracting Items from csl comparing with sob
            const storeSob = await store(extractedCont, sobMstId) // Storing Sob

            if (storeSob) {
                // Store comma-separated contractNos in the sobMst table
                return res.status(200).json({ success: true, message: 'Successfuly Inserted' });
            }
            throw new CustomError('Something went wrong!', 400);
        } else {
            throw new CustomError('No Csl record found!', 400);
        }
    } catch (err) {
        if (sobMstId) {
            await connection.execute('DELETE FROM sob_mst WHERE id = ?', [sobMstId]);
        }
        return handleErrorResponse(res, err);
    }
};


async function getFIM(contractNo) {
    try {
        if (!contractNo) {
            throw new CustomError('Contract No not be null!', 400);
        }
        const [rows] = await connection.execute(`SELECT fim FROM csl_mst WHERE contractNo = ?`, [contractNo]);

        if (rows.length === 0) throw new CustomError(`Contract No not found: ${contractNo}`, 400);

        return rows[0].fim;
    } catch (err) {
        throw err;
    }

}

//  Fetch Contract No based Items from csl
async function index(sobArray, cslArray) {
    try {
        const [cRows] = await connection.execute('SELECT * FROM item_fim_id WHERE sob = ?', ['Y']);
        const fimArray = [];

        cRows.forEach(element => {
            fimArray.push(element.name);
        });

        const matchedArray = [];
        const matchedFim = [];

        for (const sobItem of sobArray) {
            for (const cslItem of cslArray) {
                // const sobFimNumbers = parseFloat(sobItem.fim.replace(/[^\d.]/g, ''));       // Extract only numbers from the sobItem.fim
                // const cslBoxNoNumbers = parseFloat(cslItem.boxNo.replace(/[^\d.]/g, ''));   // Extract only numbers from the cslItem.boxNo

                // Check for matching contractNo and numbers from sob.fim and csl.boxNo
                if (cslItem.contractNo === sobItem.contractNo && sobItem.mstFim === cslItem.boxNo) {
                    // if (cslItem.contractNo === sobItem.contractNo && sobFimNumbers === cslBoxNoNumbers) {

                    // Combine values from both arrays
                    let combinedObject = {
                        ...cslItem,
                        fim: cslItem.boxNo,
                        msd: sobItem.msd,
                        sheetName: sobItem.sheetName,
                    };

                    // Add the combined object to the new array
                    matchedArray.push(combinedObject);
                    // if (!matchedFim.includes(cslItem.boxNo)) {
                    //     matchedFim.push(cslItem.boxNo);
                    // }
                }
            }
        }

        // Insert 100% assigned FIM for Mallik which is not present in SOB
        // const cslId = [];
        // for (const item of cslArray) {
        //     if (!matchedFim.includes(item.boxNo) && fimArray.includes(item.boxNo)) {
        //         let combinedObject = {
        //             ...item,
        //             fim: item.boxNo,
        //             msd: null,
        //             sheetName: null,
        //         };
        //         // Add the combined object to the new array
        //         matchedArray.push(combinedObject);
        //         cslId.push(item.id);
        //     }
        // }

        return matchedArray;
    } catch (err) {
        throw error;
    }
};



async function store(items, sobMstId) {
    try {
        if (items.length <= 0) {
            throw new CustomError('No Items found in CSL!', 404);
        }
        const insertQuery = `INSERT INTO sob (sobMstId, cslMstId, cslId, contractNo, partNo, Qty, description, fimNo, msd, sheetName) VALUES ?`;
        const values = items.map(item => [sobMstId, item.cslMstId, item.id, item.contractNo, item.partNo, item.Qty, item.description, item.boxNo, item.msd, item.sheetName]);

        await connection.query(insertQuery, [values]);

        // Check each partNo in items table
        for (const item of items) {
            const partNoExistsQuery = 'SELECT COUNT(*) AS count FROM items WHERE itemCode = ?';
            const [result] = await connection.query(partNoExistsQuery, [item.partNo]);

            const partNoCount = result[0].count;

            if (partNoCount === 0) {
                // If partNo doesn't exist, insert into missing_csl table
                const missingCslQuery = 'INSERT INTO missing_csl (sobMstId, cslMstId, itemCode, description, Qty, fim) VALUES (?, ?, ?, ?, ?, ?)';
                await connection.query(missingCslQuery, [sobMstId, item.cslMstId, item.partNo, item.description, item.Qty, item.fim]);
            }
        }
        // await connection.execute(`UPDATE csl_mst SET sobStatus = 1 WHERE DATE(date) = CURDATE() AND sobStatus = 0`, []);

        return true;
    } catch (error) {
        throw error;
    }
}


// Fetch current CSL
async function cslDetail() {
    try {
        const [rows] = await connection.execute(`SELECT * FROM csl_mst WHERE sobStatus = ?`, [0]);

        if (rows.length === 0) {
            throw new CustomError('No Csl record found!', 400);
        }
        const array = [];

        for (const item of rows) {
            const [cRows] = await connection.execute('SELECT * FROM csl WHERE cslMstId = ?', [item.id]);
            array.push(...cRows);
        }

        return array;
    } catch (err) {
        throw err;
    }
}


async function getSobNo() {
    try {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = (currentDate.getMonth() + 1).toString().padStart(2, '0');

        const [fRows] = await connection.execute('SELECT * FROM sob_mst ORDER BY id DESC LIMIT 1', []);
        let intVal = 0;

        if (fRows.length > 0) {
            const string = fRows[0].sobNo;
            intVal = (string == null || string == "") ? 0 : parseInt(string.split('SO')[1], 10);
        }
        const yearMonthString = `${currentYear}${currentMonth}SO${intVal + 1}`;

        return yearMonthString;
    } catch (err) {
        throw err;
    }
}


// async function sobMst(kanban, contractNos) {
//     try {
//         const contractString = contractNos.join(',');
//         await connection.execute(`DELETE FROM sob_mst WHERE contractNos IN (?)`, [contractString]);

//         const sobNo = await getSobNo();
//         const [rows] = await connection.execute('INSERT INTO sob_mst (sobNo, kanbanDate) VALUES (?, ?)', [sobNo, kanban]);

//         if (rows.affectedRows > 0) {
//             return rows.insertId;
//         }

//         throw new CustomError('Failed to generate Sob No!', 400);
//     } catch (error) {
//         throw error;
//     }
// }

async function sobMst(kanban, contractNos) {
    try {
        const contractString = contractNos.join(',');
        await connection.execute(`DELETE FROM sob_mst WHERE contractNos IN (?)`, [contractString]);

        const sobNo = await getSobNo();
        const [rows] = await connection.execute('INSERT INTO sob_mst (sobNo, kanbanDate, contractNos) VALUES (?, ?, ?)', [sobNo, kanban, contractString]);

        if (rows.affectedRows > 0) {
            return rows.insertId;
        }

        throw new CustomError('Failed to generate Sob No!', 400);
    } catch (error) {
        throw error;
    }
}

// async function sobMst(kanban, contractNos) {
//     try {
//         /* Find existing SOB */
//         const [existingRows] = await connection.execute(
//             `
//             SELECT id, contractNos
//             FROM sob_mst
//             WHERE ${contractNos.map(() => "FIND_IN_SET(?, contractNos)").join(" OR ")}
//             LIMIT 1
//             `,
//             contractNos
//         );

//         /* If exists → merge old + new (unique) */
//         if (existingRows.length > 0) {
//             const { id: sobMstId, contractNos: oldContracts } = existingRows[0];

//             // Convert old + new → unique set
//             const mergedContracts = new Set([
//                 ...(oldContracts ? oldContracts.split(',') : []),
//                 ...contractNos
//             ]);

//             const finalContractString = [...mergedContracts].join(',');

//             await connection.execute(
//                 `
//                 UPDATE sob_mst
//                 SET 
//                     contractNos = ?,
//                     processed = 0,
//                     kanbanDate = ?
//                 WHERE id = ?
//                 `,
//                 [finalContractString, kanban, sobMstId]
//             );

//             return sobMstId;
//         }

//         /* Else → insert new */
//         const sobNo = await getSobNo();
//         const contractString = [...new Set(contractNos)].join(',');

//         const [rows] = await connection.execute(
//             `
//             INSERT INTO sob_mst (sobNo, kanbanDate, contractNos, processed)
//             VALUES (?, ?, ?, 0)
//             `,
//             [sobNo, kanban, contractString]
//         );

//         if (rows.affectedRows > 0) {
//             return rows.insertId;
//         }

//         throw new CustomError("Failed to generate Sob No!", 400);
//     } catch (error) {
//         throw error;
//     }
// }

exports.sobExport = async (req, res) => {
    try {
        const sobMstId = req.query.sobMstId;
        const [sRows] = await connection.execute('SELECT COUNT(*) FROM sob_mst WHERE id = ?', [sobMstId]);

        if (sRows.length === 0) throw new CustomError('Sob not found!', 404);

        const [sobRows] = await connection.execute(`SELECT contractNo, null as product, fimNo, DATE_FORMAT(msd, '%d-%m-%Y') AS msd, partNo, Qty FROM sob WHERE sobMstId = ?`, [sobMstId]);

        // Create a new Excel workbook
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Sob lists');

        // Add headers
        const headerRow = worksheet.addRow([
            "Contract No",
            "Product",
            "FIM No",
            "MSD",
            "Part No",
            "Qty",
        ]);

        // Apply styles to the header row
        headerRow.font = { bold: true }; // Make text bold
        headerRow.alignment = { horizontal: "center" }; // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        // Add data to the worksheet
        sobRows.forEach(row => {
            const rowData = Object.values(row);
            worksheet.addRow(rowData);
        });

        // Convert the workbook to a buffer
        const buffer = await workbook.xlsx.writeBuffer();

        // Set response headers for file download
        res.setHeader('Content-Disposition', 'attachment; filename="sob_data.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        // Send the buffer as a downloadable file
        res.send(buffer);
    } catch (err) {
        return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
    }
};


// exports.productMap = async (req, res) => {
//     try {
//         const sobMstId = req.body.sobMstId;
//         const file = req.body.file;

//         if (!sobMstId || !file) throw new CustomError('Request body can not be empty!', 400);

//         const products = await extractProduct(file);

//         // Proceed with updating product information in the database
//         for (const product of products) {
//             await connection.execute(
//                 `UPDATE csl_mst SET product = ? WHERE contractNo = ?`,
//                 [product.product, product.contractNo]
//             );
//         }

//         // Mark sobMstId as mapped
//         await connection.execute(`UPDATE sob_mst SET mapStatus = 1 WHERE id = ?`, [sobMstId]);

//         // Send success response
//         return res.status(200).json({ success: true, message: "Products mapped successfully" });

//     } catch (err) {
//         return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
//     }
// }

exports.productMap = async (req, res) => {
    try {
        const sobMstId = req.body.sobMstId;
        const file = req.body.file;

        if (!sobMstId || !file) throw new CustomError('Request body cannot be empty!', 400);

        const products = await extractProduct(file);
        const contractNos = products.map(product => product.contractNo);

        if (contractNos.length === 0) {
            throw new CustomError('No contract numbers found in the product file', 400);
        }

        // Generate placeholders for the contractNos
        const placeholders = contractNos.map(() => '?').join(',');

        // Check if all contractNos are in the csl_mst table
        const [rows] = await connection.execute(
            `SELECT contractNo FROM csl_mst WHERE contractNo IN (${placeholders})`,
            contractNos
        );

        const existingContractNos = rows.map(row => row.contractNo);
        const missingContractNos = contractNos.filter(contractNo => !existingContractNos.includes(contractNo));

        if (missingContractNos.length > 0) {
            throw new CustomError(`ContractNo(s) not found: ${missingContractNos.join(', ')}`, 404);
        }

        // Proceed with updating product information in the database
        for (const product of products) {
            await connection.execute(
                `UPDATE csl_mst SET product = ? WHERE contractNo = ?`,
                [product.product, product.contractNo]
            );
        }

        // Mark sobMstId as mapped
        await connection.execute(`UPDATE sob_mst SET mapStatus = 1 WHERE id = ?`, [sobMstId]);

        // Send success response
        return res.status(200).json({ success: true, message: "Products mapped successfully" });

    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal server error" });
    }
}



async function extractProduct(file) {
    try {
        const [mstProducts] = await connection.execute(`SELECT name as productName FROM mst_products WHERE dflag = ?`, [0]);
        const masterProductNames = new Set(mstProducts.map(product => product.productName));

        const buffer = await decodeBase64(file);
        const workbook = new excel.Workbook();

        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        const products = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) { // Skip header row
                const contractNo = row.getCell(1).text;
                const product = row.getCell(2).text;

                if (!masterProductNames.has(product)) {
                    throw new CustomError(`Unknown product recieved: ${product}`);
                }
                products.push({ contractNo, product });
            }
        });

        return products;
    } catch (error) {
        throw error;
    }
}


exports.missingCsl = async (req, res) => {
    try {
        const { sobMstId, q } = req.query;

        // Fetch missing CSL entries
        const [rows] = await connection.execute(`SELECT cm.contractNo, ms.itemCode, ms.description, ms.Qty, ms.fim FROM missing_csl ms
                INNER JOIN csl_mst cm ON cm.id = ms.cslMstId
                WHERE sobMstId = ? and dflag = ? and ms.fim LIKE ?`,
            [sobMstId, '0', `%${q}%`]
        );

        // Create a new Excel workbook
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet("Missing_Csl");

        // Add headers
        const headerRow = worksheet.addRow([
            "Contract No",
            "Part No",
            "Description",
            "Qty",
            "FIM"
        ]);

        // Apply styles to the header row
        headerRow.font = { bold: true, size: 13 };
        headerRow.alignment = { horizontal: "center" };

        worksheet.columns.forEach((column, index) => {
            column.width = index === 2 ? 45 : index === 1 ? 30 : 20;
            column.alignment = { horizontal: "center" }; // Center align all columns
        });

        // Add data to the worksheet
        rows.forEach(row => {
            const rowData = Object.values(row);
            worksheet.addRow(rowData);
        });

        // Convert the workbook to a buffer
        const buffer = await workbook.xlsx.writeBuffer();

        // Set response headers for file download
        res.setHeader('Content-Disposition', 'attachment; filename="Missing Csl.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        // Send the buffer as a downloadable file
        res.send(buffer);
    } catch (err) {
        handleErrorResponse(res, err);
    }
}


exports.testExcel = async (req, res) => {
    try {
        const buffer = await decodeBase64(req.body.file);
        const workbook = new excel.Workbook();

        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        // const products = [];
        // let stopProcessing = false; // Flag to indicate when to stop processing

        // worksheet.eachRow({ includeEmpty: true }, async (row, rowNumber) => {
        //     if (stopProcessing) return; // Skip processing if the flag is set

        //     // Check if the first cell is empty or null
        //     if (row.getCell(1).value === undefined || row.getCell(1).value === null) {
        //         stopProcessing = true; 
        //         return; 
        //     }

        //     products.push({
        //         contractNo: await checkCont(row.getCell(1).value),
        //         product: row.getCell(2).value    
        //     });
        // });

        const products = [];
        const totalRows = worksheet.rowCount; // Get the total number of rows in the worksheet

        for (let i = 1; i <= totalRows; i++) { // Start from 1 to skip the header row
            const row = worksheet.getRow(i);
            if (row.getCell(1).value === undefined || row.getCell(1).value === null) {
                break; // Break the loop if an empty row is found
            }
            products.push({
                contractNo: await checkCont(row.getCell(1).value),
                product: row.getCell(2).value
            });
        }

        res.send(products);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

async function checkCont(num) {
    if (num == '123') {
        return '987654';
    }
    return '555555';
}

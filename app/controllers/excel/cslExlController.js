const { connection, CustomError, handleErrorResponse, handleSuccessResponse } = require("../../config/dbSql");
const exceljs = require("exceljs");
const { currentDateTime } = require("../../utility/utilityFunction");

exports.template = async (req, res) => {
    try {
        const workbook = new exceljs.Workbook();
        const worksheet = workbook.addWorksheet("Sheet 1");

        const headerRow = worksheet.addRow([
            "Contract No",
            "Part No",
            "Qty",
            "Source",
            "Desciption",
            "Box No",
        ]);

        headerRow.font = { bold: true }; // Make text bold
        headerRow.alignment = { horizontal: "center" }; // Center align text

        worksheet.columns.forEach((column) => {
            column.width = 20;
        });

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", "attachment; filename = CSL.xlsx");

        workbook.xlsx
            .write(res)
            .then(() => {
                // End the response stream
                res.end();
            })
            .catch((err) => {
                console.error("Error writing Excel file:", err);
                res.status(500).send("Error generating Excel file");
            });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message || "An error occurred" });
    }
};

exports.import = async (req, res) => {
    try {
        const { type, contractList: excelDataArray } = req.body;

        if (!excelDataArray || excelDataArray.length === 0) {
            throw new CustomError('Please select a file!', 400);
        }

        // Export to excel
        if (type === 'Export') {
            return await exportCSL(res, excelDataArray);
        }

        const allSheetContents = [];
        const contractDetails = {};

        let hdrContractNo;
        let FIM = null;

        for (const excelData of excelDataArray) {
            const base64Data = excelData.data.replace(
                /^data:.*?;base64,/,
                ""
            );
            const buffer = Buffer.from(base64Data, "base64");

            const workbook = new exceljs.Workbook();
            await workbook.xlsx.load(buffer);

            const sheetContents = [];
            const errorMessages = new Set();

            workbook.eachSheet((worksheet) => {
                if (worksheet.name === "PackList") {
                    hdrContractNo = worksheet.getRow(3).getCell(1).text || "";
                    const rowFIM = worksheet.getRow(3).getCell(6).text || "";
                    FIM = (rowFIM.match(/^[^\d]*/) || [""])[0];

                    worksheet.eachRow((row, rowNumber) => {
                        if (rowNumber > 2) {
                            const contractNo = row.getCell(1).value;
                            const boxNo = row.getCell(6).value;

                            if (!contractNo && !boxNo) return; // skip empty rows

                            if (boxNo == null) {
                                errorMessages.add(`Box number is empty in Contract No ${hdrContractNo}`);
                            } else if (!String(boxNo).startsWith(FIM)) {
                                errorMessages.add(`Box number does not start with FIM: ${boxNo} at Contract No ${hdrContractNo}`);
                            } else if (hdrContractNo !== contractNo) {
                                errorMessages.add(`Mismatched Contract no ${contractNo} in sheet with header ${hdrContractNo}`);
                            } else if (row.getCell(3).value == null) {
                                errorMessages.add(`Quantity required for Part ${row.getCell(2).value}`);
                            }

                            const csl = {
                                id: rowNumber,
                                contractNo,
                                partNo: row.getCell(2).value,
                                Qty: row.getCell(3).value,
                                desc: row.getCell(5).value,
                                boxNo,
                            };
                            sheetContents.push(csl);
                        }
                    });
                }
            });

            allSheetContents.push({ [hdrContractNo]: sheetContents });

            const contractWS = workbook.getWorksheet(1);
            contractDetails[hdrContractNo] = {
                FIM,
                duty: contractWS.getCell("C2").value,
                stop: contractWS.getCell("C3").value,
                type: FIM.replace(/FIM/g, "") || FIM,
                errorMessage: errorMessages.size ? [...errorMessages].join(', ') : null
            };
        }

        let message = '';
        let result = [];

        if (type === 'View') {
            const allProcessedContracts = await processedContracts();

            allSheetContents.forEach((obj, index) => {
                const contractNo = Object.keys(obj)[0];
                const child = obj[contractNo];
                const modifiedContractNo = (contractNo || "").replace(/(\d+)[^\d]*$/, '$1');

                const contractLoaded = allProcessedContracts.includes(modifiedContractNo);

                result.push({
                    id: index + 1,
                    contractNo,
                    ...contractDetails[contractNo],
                    childItems: child,
                    contractLoaded
                });
            });

            message = 'Contracts list';
        } else if (type === 'Import') {
            result = await insertCSLData(allSheetContents, contractDetails);
            if (result) {
                message = 'Successfully imported';
                return handleSuccessResponse(res, message);
            }
        } else {
            throw new CustomError('Invalid type id provided!', 400);
        }

        return res.status(200).json({
            success: true,
            message,
            data: result
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

const exportCSL = async (res, contractList) => {
    try {
        if (!Array.isArray(contractList) || contractList.length === 0) {
            return res.status(400).json({ error: 'Invalid or empty contract list provided.' });
        }

        const workbook = new exceljs.Workbook();
        const worksheet = workbook.addWorksheet('CSL');

        const HEADERS = [
            'Contract No',
            'Part No',
            'Qty',
            'Description',
            'Box No',
            'Duty',
            'Stop',
            'Type'
        ];

        // Add header row with styling
        const headerRow = worksheet.addRow(HEADERS);
        headerRow.eachCell(cell => {
            cell.font = { bold: true, size: 13 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        // Process each contract
        contractList.forEach(contract => {
            const { duty = '', stop = '', type = '', childItems = [] } = contract;

            childItems.forEach(item => {
                const rowData = [
                    item.contractNo || '',
                    item.partNo || '',
                    item.Qty || '',
                    item.desc || '',
                    item.boxNo || '',
                    duty,
                    stop,
                    type
                ];

                const row = worksheet.addRow(rowData);
                row.eachCell(cell => {
                    cell.alignment = { horizontal: 'center' };
                });
            });
        });

        // Set column widths (based on importance)
        const columnWidths = [22, 32, 10, 35, 18, 10, 10, 12];
        worksheet.columns.forEach((column, i) => {
            column.width = columnWidths[i] || 20;
        });

        // Configure response headers for download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=contract-details.xlsx');
        res.status(200);

        // Write to response stream
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Error exporting CSL:', err);
        res.status(500).json({ error: 'Failed to export contract sheet list.' });
    }
};

const processedContracts = async () => {
    try {
        const [rows] = await connection.execute(`
            SELECT sob_mst.contractNos FROM order_plannings op
            INNER JOIN sob_mst on sob_mst.id = op.sobMstId
            WHERE mrpStatus = ?`
            , [1]);

        // Aggregate all contract numbers into a single array
        let allContracts = [];
        rows.forEach(row => {
            if (row.contractNos) {
                allContracts = allContracts.concat(row.contractNos.split(','));
            }
        });

        return allContracts;
    } catch (err) {
        throw err;
    }
}

const getProcessedContractNos = async () => {
    const [rows] = await connection.execute(
        `
        SELECT sob_mst.contractNos
        FROM sob_mst
        WHERE sob_mst.processed = ?
        `,
        [1]
    );

    return new Set(
        rows
            .flatMap(row => row.contractNos?.split(",") || [])
            .map(c => c.trim())
            .filter(Boolean)
    );
};

/*
async function masterCsl(
    conn,
    contractNo,
    contractDetails,
    processedContractsSet
) {
    const { FIM, duty, stop, type } = contractDetails;
    const dateTime = await currentDateTime();

    // ❌ HARD RULE: already processed → block
    if (processedContractsSet.has(contractNo)) {
        throw new CustomError(
            `ContractNo - ${contractNo} is already produced!`,
            400
        );
    }

    // 🔍 Check existing CSL (allowed to overwrite)
    const [[existingCsl]] = await conn.execute(
        "SELECT id FROM csl_mst WHERE contractNo = ? LIMIT 1",
        [contractNo]
    );

    // ♻️ Overwrite safely (CASCADE deletes children)
    if (existingCsl) {
        await conn.execute(
            "DELETE FROM csl_mst WHERE contractNo = ?",
            [contractNo]
        );
    }

    // 🔐 Concurrent-safe CSL number generation
    const [[lastRow]] = await conn.execute(
        "SELECT cslNo FROM csl_mst ORDER BY id DESC LIMIT 1 FOR UPDATE"
    );

    const nextNumber = lastRow?.cslNo
        ? Number(lastRow.cslNo.split("-")[1]) + 1
        : 1;

    const cslNo = `CSL-${nextNumber}`;

    const [insertResult] = await conn.execute(
        `
        INSERT INTO csl_mst
            (cslNo, contractNo, date, fim, duty, stop, type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [cslNo, contractNo, dateTime, FIM, duty, stop, type, "Pending"]
    );

    return insertResult.insertId;
}

async function insertCSLData(sheetContents, contractDetails) {
    const conn = await connection.getConnection();

    try {
        // Load once → fast lookups
        const processedContractsSet = await getProcessedContractNos();

        await conn.beginTransaction();

        for (const sheetContent of sheetContents) {
            const contractNo = Object.keys(sheetContent)[0];

            const cslMstId = await masterCsl(
                conn,
                contractNo,
                contractDetails[contractNo],
                processedContractsSet
            );

            const cslDetails = sheetContent[contractNo].map(
                ({ partNo, Qty, desc, boxNo }) => [
                    cslMstId,
                    contractNo,
                    partNo,
                    Qty,
                    desc,
                    boxNo
                ]
            );

            if (cslDetails.length) {
                await bulkInsertCSLDetails(conn, cslDetails);
            }
        }

        await conn.commit();
        return true;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function bulkInsertCSLDetails(conn, cslDetails) {
    const [result] = await conn.query(
        `
        INSERT INTO csl
            (cslMstId, contractNo, partNo, Qty, description, boxNo)
        VALUES ?
        `,
        [cslDetails]
    );

    if (!result.affectedRows) {
        throw new CustomError("Failed to insert CSL details.", 400);
    }

    return true;
}
*/

async function masterCsl(
    conn,
    contractNo,
    contractDetails,
    processedContractsSet
) {
    const { FIM, duty, stop, type } = contractDetails;
    const dateTime = await currentDateTime();

    if (processedContractsSet.has(contractNo)) {
        throw new CustomError(
            `ContractNo - ${contractNo} is already produced!`,
            400
        );
    }

    // ✅ Lock only this contract row
    const [[existingCsl]] = await conn.execute(
        `SELECT id FROM csl_mst WHERE contractNo = ? FOR UPDATE`,
        [contractNo]
    );

    if (existingCsl) {
        await conn.execute(
            `DELETE FROM csl_mst WHERE contractNo = ?`,
            [contractNo]
        );
    }

    // ✅ 🔥 BEST PRACTICE: counter table (atomic increment)
    await conn.execute(
        `UPDATE counter 
         SET number = LAST_INSERT_ID(number + 1)
         WHERE counterType = 'CSL'`
    );

    const [[row]] = await conn.execute(
        `SELECT LAST_INSERT_ID() AS nextNumber`
    );

    const nextNumber = row.nextNumber;
    const cslNo = `CSL-${nextNumber}`;

    const [insertResult] = await conn.execute(
        `
        INSERT INTO csl_mst
        (cslNo, contractNo, date, fim, duty, stop, type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [cslNo, contractNo, dateTime, FIM, duty, stop, type, "Pending"]
    );

    return insertResult.insertId;
}

async function insertCSLData(sheetContents, contractDetails) {
    const conn = await connection.getConnection();
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const processedContractsSet = await getProcessedContractNos();

            await conn.beginTransaction();

            // ✅ CRITICAL: consistent order to avoid deadlocks
            const sortedSheets = [...sheetContents].sort((a, b) => {
                const keyA = Object.keys(a)[0];
                const keyB = Object.keys(b)[0];
                return keyA.localeCompare(keyB);
            });

            for (const sheetContent of sortedSheets) {
                const contractNo = Object.keys(sheetContent)[0];

                const cslMstId = await masterCsl(
                    conn,
                    contractNo,
                    contractDetails[contractNo],
                    processedContractsSet
                );

                const cslDetails = sheetContent[contractNo].map(
                    ({ partNo, Qty, desc, boxNo }) => [
                        cslMstId,
                        contractNo,
                        partNo,
                        Qty,
                        desc,
                        boxNo
                    ]
                );

                if (cslDetails.length) {
                    await bulkInsertCSLDetails(conn, cslDetails);
                }
            }

            await conn.commit();
            return true;

        } catch (err) {
            await conn.rollback();

            // ✅ retry for deadlocks
            if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
                continue;
            }

            throw err;
        }
    }

    conn.release();
}

async function bulkInsertCSLDetails(conn, cslDetails) {
    const [result] = await conn.query(
        `
        INSERT INTO csl
        (cslMstId, contractNo, partNo, Qty, description, boxNo)
        VALUES ?
        `,
        [cslDetails]
    );

    if (!result.affectedRows) {
        throw new CustomError("Failed to insert CSL details.", 400);
    }

    return true;
}

exports.cslExport = async (req, res) => {
    try {
        const { cslMstId } = req.query;

        const workbook = new exceljs.Workbook();
        const worksheet = workbook.addWorksheet('CSL');

        const headerRow = worksheet.addRow([
            'Contract No',
            'Part No',
            'Qty',
            'Description',
            'Box No'
        ]);

        headerRow.eachCell({ includeEmpty: true }, function (cell) {
            cell.font = { bold: true, size: 13 };
            cell.alignment = { horizontal: "center", vertical: "middle" };
        });

        const [cslRows] = await connection.execute(`SELECT contractNo, partNo, Qty, description, boxNo FROM csl WHERE cslMstId = ?`, [cslMstId]);

        cslRows.forEach(cslRow => {
            const rowData = Object.values(cslRow);
            const newRow = worksheet.addRow(rowData);
            newRow.eachCell({ includeEmpty: true }, (cell, colNo) => {
                cell.alignment = { horizontal: 'center' };
            });
        });

        worksheet.columns.forEach((column, index) => {
            column.width = (index == 1 || index == 3) ? 30 : 22;
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=contract-details.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};
const { handleErrorResponse, connection, handleSuccessResponse, CustomError } = require("../config/dbSql")
const exceljs = require("exceljs");
const { getUser } = require("../utility/utilityFunction");
const fs = require("fs");

const deleteFile = (filePath) => {
    if (!filePath) return;
    fs.unlink(filePath, (err) => {
        if (err) console.error("File delete error:", filePath, err.message);
    });
};

exports.processCslAndSob = async (req, res) => {
    const cslFiles = req.files?.cslFile || [];
    const sobFile = req.files?.sobFile?.[0];

    try {
        if (cslFiles.length === 0) {
            throw new CustomError("At least one CSL file required", 400);
        }

        if (!sobFile) {
            throw new CustomError("SOB file is required", 400);
        }

        // -----------------------------
        // DECODE EXCEL (supports buffer or disk path)
        // -----------------------------
        const decodeWorkbook = async (file) => {
            const workbook = new exceljs.Workbook();

            if (file.buffer) {
                // memoryStorage
                await workbook.xlsx.load(file.buffer);
            } else if (file.path) {
                // diskStorage
                await workbook.xlsx.readFile(file.path);
            } else {
                throw new Error("Invalid file input: no buffer or path found");
            }

            return workbook;
        };

        const extractFIMPrefix = (str) => (str.match(/^[^\d]*/) || [""])[0];

        // -----------------------------
        // PROCESS ALL CSL FILES
        // -----------------------------
        const cslContracts = [];

        for (const file of cslFiles) {
            const workbook = await decodeWorkbook(file);

            let contractNo = null;
            let FIM = "";
            const errors = new Set();
            let childItems = [];

            workbook.eachSheet((ws) => {
                if (ws.name !== "PackList") return;

                contractNo = ws.getRow(3).getCell(1).text?.trim() || "";
                const rowFIM = ws.getRow(3).getCell(6).text || "";
                FIM = extractFIMPrefix(rowFIM);

                const items = [];

                ws.eachRow((row, rowNum) => {
                    if (rowNum <= 2) return;

                    const cNo = row.getCell(1).value;
                    const partNo = row.getCell(2).value;
                    const qty = row.getCell(3).value;
                    const desc = row.getCell(5).value;
                    const boxNo = row.getCell(6).value;

                    if (!cNo && !boxNo) return;

                    if (!boxNo) errors.add(`Box number empty for ${contractNo}`);

                    if (boxNo && !String(boxNo).startsWith(FIM))
                        errors.add(`Invalid box no '${boxNo}' for ${contractNo}`);

                    if (cNo && cNo !== contractNo)
                        errors.add(`Row contract ${cNo} != ${contractNo}`);

                    if (!qty)
                        errors.add(`Quantity required for Part ${partNo}`);

                    items.push({ contractNo, partNo, qty, desc, boxNo });
                });

                childItems = items;
            });

            if (contractNo) {
                cslContracts.push({
                    contractNo,
                    FIM,
                    childItems,
                    errorMessage: errors.size ? [...errors].join(", ") : null,
                });
            }
        }

        // -----------------------------
        // PROCESS SOB FILE
        // -----------------------------
        const sobWorkbook = await decodeWorkbook(sobFile);
        const ws = sobWorkbook.getWorksheet(1);

        const sobArray = [];
        const seenContracts = new Set();
        const totalRows = ws.rowCount;

        for (let i = 8; i <= totalRows; i++) {
            const row = ws.getRow(i);
            const contractNo = row.getCell(1).text?.trim();

            if (!contractNo) break;

            const msd = row.getCell(2).value;

            if (seenContracts.has(contractNo)) {
                throw new CustomError(`duplicate contract no: ${contractNo}`, 400);
            }
            seenContracts.add(contractNo);

            const csl = cslContracts.find(c => c.contractNo === contractNo);
            const fim = csl ? csl.FIM : "";

            row.eachCell((cell, colNumber) => {
                if (colNumber <= 3) return;

                const header = ws.getRow(6).getCell(colNumber).text;
                const subHeader = ws.getRow(7).getCell(colNumber).text;
                const mstFim = fim + header.slice(3);

                if (cell.text === "YES" && subHeader === "MALLIK") {
                    sobArray.push({
                        contractNo,
                        fim: header,
                        mstFim,
                        msd,
                        sheetName: ws.name
                    });
                }
            });
        }

        // -----------------------------
        // MATCHING LOGIC
        // -----------------------------
        const matchedArray = [];
        const itemSet = new Set();

        for (const sobItem of sobArray) {
            for (const cslContract of cslContracts) {
                for (const cslItem of cslContract.childItems) {

                    if (
                        sobItem.contractNo === cslItem.contractNo &&
                        sobItem.mstFim === cslItem.boxNo
                    ) {
                        matchedArray.push({
                            ...cslItem,
                            fim: cslItem.boxNo,
                            msd: sobItem.msd,
                            sheetName: sobItem.sheetName
                        });
                    }

                    itemSet.add(cslItem.partNo);
                }
            }
        }

        const placeholders = Array(itemSet.size).fill("?").join(",");
        const itemsList = [...itemSet];

        const [itemRows] = await connection.query(
            `SELECT itemCode FROM items WHERE itemCode IN (${placeholders})`,
            itemsList
        );

        const existingParts = new Set(itemRows.map(r => r.itemCode));

        // Maps to merge duplicates
        const finalMap = new Map();
        const missingMap = new Map();

        for (const row of matchedArray) {

            const key = `${row.contractNo}__${row.fim}__${row.partNo}`;

            if (!existingParts.has(row.partNo)) {
                // Missing CSL → merge Qty
                const old = missingMap.get(key);
                missingMap.set(key, {
                    contractNo: row.contractNo,
                    fimNo: row.fim,
                    partNo: row.partNo,
                    Qty: (old?.Qty || 0) + row.qty
                });
                continue;
            }

            // Found in DB → merge Qty
            const old = finalMap.get(key);
            finalMap.set(key, {
                contractNo: row.contractNo,
                fimNo: row.fim,
                partNo: row.partNo,
                Qty: (old?.Qty || 0) + row.qty
            });
        }

        // Convert Maps to arrays & add sNo and id
        let i = 0, j = 0;

        const finalOutput = [...finalMap.values()].map(obj => ({
            id: ++i,
            sNo: i,
            ...obj
        }));

        const missingCsl = [...missingMap.values()].map(obj => ({
            id: ++j,
            sNo: j,
            ...obj
        }));


        return res.status(200).json({
            success: true,
            message: "Processed successfully",
            data: finalOutput,
            missingCsl
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    } finally {
        for (const file of cslFiles) deleteFile(file.path);
        if (sobFile) deleteFile(sobFile.path);
    }
};

exports.compareCslAndSob = async (req, res) => {
    try {
        const { cslData } = req.body;

        const contractSet = [...new Set(cslData.map(x => x.contractNo))];

        // 1. Fetch SOB from DB
        const [sobRows] = await connection.query(
            `SELECT id, contractNo, fimNo, partNo, Qty 
             FROM sob 
             WHERE contractNo IN (${contractSet.map(() => '?').join(',')})`,
            contractSet
        );

        // 2. Create fast lookup map using ALL THREE keys
        const sobMap = new Map();

        for (const row of sobRows) {
            const key = `${row.contractNo}__${row.fimNo}__${row.partNo}`;

            if (sobMap.has(key)) {
                const existing = sobMap.get(key);
                existing.Qty = Number(existing.Qty) + Number(row.Qty);
                sobMap.set(key, existing);
            } else {
                sobMap.set(key, { ...row });
            }
        }

        const result = [];
        const matchedKeys = new Set();
        let sNo = 0;

        // 3. Compare CSL payload with SOB
        for (const row of cslData) {
            const key = `${row.contractNo}__${row.fimNo}__${row.partNo}`;
            const sobItem = sobMap.get(key);
            const { contractNo, fimNo, partNo, Qty } = row;

            if (!sobItem) {
                result.push({
                    id: sNo,
                    sNo: ++sNo,
                    contractNo, fimNo, partNo, Qty,
                    oldQty: 0,
                    status: "New product"
                });
                continue;
            }

            matchedKeys.add(key);

            const newQty = Number(Qty);
            const oldQty = Number(sobItem.Qty);

            if (newQty > oldQty) {
                result.push({ id: sobItem.id, sNo: ++sNo, contractNo, fimNo, partNo, Qty, oldQty, status: "Qty increased" });
            } else if (newQty < oldQty) {
                result.push({ id: sobItem.id, sNo: ++sNo, contractNo, fimNo, partNo, Qty, oldQty, status: "Qty reduced" });
            } else {
                result.push({ id: sobItem.id, sNo: ++sNo, contractNo, fimNo, partNo, Qty, oldQty, status: "No change" });
            }
        }

        // 4. Detect DELETED ITEMS (in SOB but NOT in CSL)
        for (const sobItem of sobRows) {
            const key = `${sobItem.contractNo}__${sobItem.fimNo}__${sobItem.partNo}`;
            if (!matchedKeys.has(key)) {
                result.push({
                    id: sobItem.id,
                    sNo: ++sNo,
                    contractNo: sobItem.contractNo,
                    fimNo: sobItem.fimNo,
                    partNo: sobItem.partNo,
                    Qty: sobItem.Qty,
                    oldQty: '',
                    status: "Deleted part"
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: "Comparison done",
            data: result
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

const deleteRevisedPlanItems = async (conn, user, arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return;

    // STEP 1 — Build composite keys (contractNo, fimNo, partNo)
    const keyTriples = arr.map(x => [
        x.contractNo,
        x.fimNo,
        x.partNo
    ]);

    const placeholders = keyTriples.map(() => "(?, ?, ?)").join(",");
    const flatParams = keyTriples.flat();

    // STEP 2 — Fetch matching rows BEFORE deleting (audit)
    const [rows] = await conn.query(
        `
        SELECT 
            id, sobMstId, cslMstId, cslId, 
            contractNo, fimNo, partNo, Qty, description, plannedStatus
        FROM sob
        WHERE (contractNo, fimNo, partNo) IN (${placeholders})
        `,
        flatParams
    );

    if (rows.length === 0) return;

    // STEP 3 — Insert rows into deleted_records table
    await conn.query(
        `
        INSERT INTO deleted_records (type, records, deletedBy)
        VALUES (?, ?, ?)
        `,
        ["sob_delete", JSON.stringify(rows), user]
    );

    // STEP 4 — Delete CLS child rows
    const cslIds = rows.map(r => r.cslId).filter(Boolean);

    if (cslIds.length > 0) {
        await conn.query(
            `DELETE FROM csl WHERE id IN (${cslIds.map(() => '?').join(',')})`,
            cslIds
        );
    }

    // STEP 5 — Delete SOB rows using composite key
    await conn.query(
        `
        DELETE FROM sob 
        WHERE (contractNo, fimNo, partNo) IN (${placeholders})
        `,
        flatParams
    );
};

const updateRevisedPlanItems = async (conn, arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return;

    // STEP 1 — Build composite keys for lookup
    const compositeKeys = arr.map(i => [i.contractNo, i.partNo]);
    const placeholders = compositeKeys.map(() => "(?, ?)").join(",");
    const flatParams = compositeKeys.flat();

    // STEP 2 — Fetch existing SOB rows (before delete)
    const [sobRows] = await conn.query(
        `SELECT sobMstId, cslMstId, cslId, contractNo, partNo
         FROM sob
         WHERE (contractNo, partNo) IN (${placeholders})`,
        flatParams
    );

    // STEP 3 — Build map so we can reuse IDs in new insert
    const sobMap = new Map();
    for (const r of sobRows) {
        const key = `${r.contractNo}__${r.partNo}`;

        // Store first occurrence only
        if (!sobMap.has(key)) {
            sobMap.set(key, {
                sobMstId: r.sobMstId,
                cslMstId: r.cslMstId,
                cslId: r.cslId
            });
        }
    }

    // STEP 4 — Delete old SOB rows using composite key
    await conn.query(
        `DELETE FROM sob
         WHERE (contractNo, partNo) IN (${placeholders})`,
        flatParams
    );

    // STEP 5 — Prepare fresh rows for INSERT
    const insertValues = arr.map(item => {
        const key = `${item.contractNo}__${item.partNo}`;
        const old = sobMap.get(key) || {};

        return [
            old.sobMstId || null,  // reuse sobMstId
            old.cslMstId || null,  // reuse cslMstId
            old.cslId || null,     // reuse cslId
            item.contractNo,
            item.fimNo,
            item.partNo,
            item.Qty,
            item.msd || null,
            item.sheetName || null
        ];
    });

    // STEP 6 — Insert fresh SOB rows (with reused IDs)
    await conn.query(
        `INSERT INTO sob (
            sobMstId,
            cslMstId,
            cslId,
            contractNo,
            fimNo,
            partNo,
            Qty,
            msd,
            sheetName
        ) VALUES ?`,
        [insertValues]
    );
};

const newProductInsert = async (conn, arr) => {
    try {
        if (arr.length === 0) return;

        const contracts = [...new Set(arr.map(i => i.contractNo))];

        const [sobRows] = await conn.query(
            `SELECT sobMstId, cslMstId, contractNo FROM sob 
            WHERE contractNo IN (${contracts.map(() => '?').join(',')})
            GROUP BY contractNo`,
            contracts
        );
        const sobMstMap = new Map();

        for (const r of sobRows) sobMstMap.set(r.contractNo, { sobMstId: r.sobMstId, cslMstId: r.cslMstId });

        for (const item of arr) {
            const mstIds = sobMstMap.get(item.contractNo);
            const sobMstId = mstIds ? mstIds.sobMstId : null;
            const cslMstId = mstIds ? mstIds.cslMstId : null;

            const [cslResult] = await conn.query(
                `INSERT INTO csl (cslMstId, contractNo, partNo, Qty, description, boxNo)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [cslMstId, item.contractNo, item.partNo, item.Qty, item.description || null, item.fimNo]
            );
            const cslId = cslResult.insertId;

            await conn.query(
                `INSERT INTO sob (sobMstId, cslMstId, cslId, contractNo, partNo, Qty, description, fimNo)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [sobMstId, cslMstId, cslId, item.contractNo, item.partNo, item.Qty, item.description || null, item.fimNo]
            );
        }

    } catch (err) {
        throw err;
    }
}

const partDetails = async (conn, partList) => {
    try {
        const map = new Map();
        for (const p of partList) {
            const qty = p.Qty ?? 0;
            map.set(p.partNo, (map.get(p.partNo) || 0) + qty);
        }

        const itemCodes = [...map.keys()];
        const len = itemCodes.length;
        if (len === 0) return [];

        const placeholders = new Array(len).fill("?").join(",");

        const [rows] = await conn.query(
            `SELECT id, id AS itemId, itemCode, itemName
             FROM items 
             WHERE itemCode IN (${placeholders})`,
            itemCodes
        );

        for (const row of rows) {
            row.Qty = map.get(row.itemCode) || 0;
        }

        return rows;
    } catch (err) {
        throw err;
    }
};

exports.processRevisedPlan = async (req, res) => {
    const conn = await connection.getConnection();

    try {
        const { revisedPlanData } = req.body;

        if(revisedPlanData.length === 0) {
            // return handleSuccessResponse(res, 'Revised Parts not avaibale to Process order')
            throw new CustomError('Revised Parts are not available to Process order')
        }

        const user = await getUser(req);

        const newItems = [];
        const updateItems = [];
        const deleteItems = [];
        const partsToProduce = [];

        for (const item of revisedPlanData) {
            const { status, Qty, oldQty } = item;

            switch (status) {
                case "New product":
                    newItems.push(item);
                    partsToProduce.push({ partNo: item.partNo, Qty });
                    break;

                case "Qty increased":
                    updateItems.push({ ...item, Qty });
                    partsToProduce.push({ partNo: item.partNo, Qty: Qty - oldQty });
                    break;

                case "Qty reduced":
                    updateItems.push({ ...item, Qty });
                    break;

                case "Deleted part":
                    deleteItems.push(item);
                    break;
            }
        }

        await conn.beginTransaction();

        await deleteRevisedPlanItems(conn, user, deleteItems);
        await updateRevisedPlanItems(conn, updateItems);
        await newProductInsert(conn, newItems);

        const partDetailsList = await partDetails(conn, partsToProduce);

        await conn.commit();

        return res.status(200).json({
            success: true,
            message: "Revised plan processed successfully",
            items: partDetailsList
        });
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.moveItems = async (req, res) => {
    try {
        const { cslData } = req.body;

        const contractSet = [...new Set(cslData.map(x => x.contractNo))];

        const [sobRows] = await connection.query(
            `SELECT sobMstId, cslMstId 
             FROM sob 
             WHERE contractNo IN (${contractSet.map(() => '?').join(',')})`,
            contractSet
        );

        return handleSuccessResponse(res, '', sobRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}






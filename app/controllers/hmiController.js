const { handleErrorResponse, connection, handleSuccessResponse, CustomError, barcodeDB } = require("../config/dbSql");
const { currentDateTime, getCurrentShift, decodeExcelBase64, currentDateTimeInd } = require("../utility/utilityFunction");
const { scheduledPlan } = require("./scheduleController");
const XLSX = require("xlsx");

exports.jcMainParts = async (req, res) => {
    try {
        const { machineName, date } = req.body;

        const fetchQuery = `
            SELECT job_card.id AS JCID,
                job_card.jcNo AS JCNO,
                job_card.created_at AS JCDate,
                job_card.itemCode,
                job_card.Qty AS JCQTY, 
                job_card.Nesting_Qty AS PRODUCED_QTY, op.kanbanDate
            FROM job_card
                inner JOIN item_vs_pm ON job_card.itemId = item_vs_pm.item
                inner JOIN machines ON item_vs_pm.machineName = machines.id
            WHERE machines.machineName = ? and DATE(job_card.created_at) = ?
        `;

        const [jcRows] = await connection.execute(fetchQuery, [machineName, date]);

        return handleSuccessResponse(res, 'Main-Parts', jcRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

async function fetchMainItems(bomMstId) {
    const query = `
        SELECT bom.itemId, bom.jcPart, bom.Qty, items.isBom FROM bom 
            INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
            INNER JOIN items ON items.id = bom.itemId
        WHERE bom_mst.itemId = ? AND bom.jcPart != 'NR'`;
    const [bom] = await connection.execute(query, [bomMstId]);
    return bom;
}


async function fetchItemsHmi(bomMstId, itemId = null, machineId, jcId, jcQty) {
    const query = `
        SELECT 
            items.id, items.itemCode AS SITEMCODE, items.itemName AS SITEMNAME, items.materialThickness AS MTHICKNESS, items.material, 
            (CAST(bom.Qty AS SIGNED) * ${jcQty}) as QTY, mrp.id as ChildId, mrp.Child_Produced_Qty as Child_Produced_Qty, mrp.isCompleted, ${jcId} as jcId, mrp.Child_Part_Completed,
            CASE 
                WHEN MAX(CASE WHEN item_vs_pm.machineName = ? THEN 1 ELSE 0 END) = 1 THEN 1 
                ELSE 0 
            END AS DisplayStatus 
        FROM bom 
        INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
        INNER JOIN items ON items.id = bom.itemId
        INNER JOIN mrp ON mrp.itemId = bom.itemId
        LEFT JOIN item_vs_pm ON item_vs_pm.item = bom.itemId
        LEFT JOIN machines ON machines.id = item_vs_pm.machineName
        WHERE bom_mst.itemId = ? AND bom.jcPart != ? AND mrp.jcId = ? AND item_vs_pm.dflag = ?${itemId ? ' AND bom.itemId = ?' : ''}
        GROUP BY items.itemCode
    `;
    const params = [machineId, bomMstId, 'NR', jcId, 0];
    if (itemId) params.push(itemId);

    const [bom] = await connection.execute(query, params);
    return bom;
}

async function fetchItemsProgrammer(bomMstId, itemId = null, machineId, jcId, jcQty) {
    const query = `
        SELECT mrp.id, items.itemCode AS SITEMCODE, items.itemName AS SITEMNAME, items.materialThickness AS MTHICKNESS, items.material, 
            (CAST(bom.Qty AS SIGNED) * ?) as QTY, mrp.id as mrpId, mrp.Child_Produced_Qty as Child_Produced_Qty, mrp.nest_qty, DATE_FORMAT(op.kanbanDate, '%d-%m-%Y') AS KanbanDate,
            mrp.isCompleted, ? as jcId, jc.jcNo as JC_No
        FROM bom 
        INNER JOIN bom_mst ON bom_mst.id = bom.bomMstId
        INNER JOIN items ON items.id = bom.itemId
        INNER JOIN mrp ON mrp.itemId = bom.itemId
        INNER JOIN item_vs_pm ON item_vs_pm.item = bom.itemId
        INNER JOIN machines ON machines.id = item_vs_pm.machineName
        LEFT JOIN order_plannings op ON op.id = mrp.orderPlnId
        LEFT JOIN job_card jc ON jc.id = mrp.jcId
        WHERE bom_mst.itemId = ? 
        AND bom.jcPart != 'NR' 
        AND mrp.jcId = ? 
        AND item_vs_pm.dflag = 0
        AND item_vs_pm.machineName = ?
        ${itemId ? ' AND bom.itemId = ?' : ''}
        GROUP BY items.itemCode
    `;

    const params = [jcQty, jcId, bomMstId, jcId, machineId];
    if (itemId) params.push(itemId);

    const [bom] = await connection.execute(query, params);
    return bom;
}


// Recursive function to fetch child details
async function childItems(software, mainItemId, machineId, jcId, jcQty) {
    try {
        const itemsList = [];
        const bom = await fetchMainItems(mainItemId);

        for (const element of bom) {
            const { itemId, jcPart, isBom, Qty } = element;

            if (jcPart == 'Y') {
                let childItems = [];

                if (software === 'hmi') {
                    childItems = await fetchItemsHmi(mainItemId, itemId, machineId, jcId, jcQty);
                } else if (software === 'programmer') {
                    childItems = await fetchItemsProgrammer(mainItemId, itemId, machineId, jcId, jcQty);
                }

                itemsList.push(...childItems);
            }

            if (isBom == 'Y') {
                const childParts = await childItems(software, itemId, machineId, jcId, jcQty * Qty); // Recursive call
                itemsList.push(...childParts);
            }
        }

        return itemsList;
    } catch (error) {
        throw error;
    }
}


exports.fetchChildParts = async (jcId, machineName, software) => {
    try {
        const [jc] = await connection.execute(`SELECT mrpMstId, itemId, Qty AS jcQty FROM job_card WHERE id = ?`, [jcId]);
        const [machineRows] = await connection.execute(`SELECT id FROM machines WHERE machineName = ?`, [machineName]);

        if (jc.length === 0) throw new CustomError('Job Card not found!', 404);
        const { mrpMstId, itemId: bomMstId, jcQty } = jc[0];
        const machineId = machineRows.length === 0 ? 0 : machineRows[0].id;

        const itemsList = [];
        const bom = await fetchMainItems(bomMstId);

        for (const element of bom) {
            const { itemId, jcPart, isBom, Qty } = element;

            if (jcPart == 'Y') {
                let itemsDetails = [];

                if (software === 'hmi') {
                    itemsDetails = await fetchItemsHmi(bomMstId, itemId, machineId, jcId, jcQty);
                } else if (software === 'programmer') {
                    itemsDetails = await fetchItemsProgrammer(bomMstId, itemId, machineId, jcId, jcQty);
                }

                itemsList.push(...itemsDetails);
            }

            if (isBom == 'Y') {
                const childParts = await childItems(software, itemId, machineId, jcId, Number(jcQty) * Number(Qty));
                itemsList.push(...childParts);
            }
        }

        return itemsList;
    } catch (err) {
        throw err;
    }
}

// Fetch Bom Details
exports.bomChildParts = async (req, res) => {
    try {
        const { jcId, machineName, software = 'hmi' } = req.body;

        const itemList = await this.fetchChildParts(jcId, machineName, software);

        return handleSuccessResponse(res, 'JC-Child details', itemList);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.processList = async (req, res) => {
    try {
        const { jcNo } = req.body;

        const [processRows] = await connection.execute(`
            SELECT 
                ROW_NUMBER() OVER (ORDER BY jp.id) AS sNo,
                jp.process,
                jp.machineName,
                jp.producedQty,
                CASE
                    WHEN jp.producedQty = 0 THEN 0
                    WHEN jp.producedQty > 0 AND jp.producedQty < jp.Qty THEN 1
                    WHEN jp.producedQty = jp.Qty THEN 2
                    WHEN jp.producedQty > jp.Qty THEN 3
                END AS colorCode
            FROM jobcard_planning jp
            WHERE jp.jcNo = ?
            ORDER BY jp.id
        `, [jcNo]);

        return handleSuccessResponse(res, 'Process List', processRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.childProcessList = async (req, res) => {
    try {
        const { jcNo, itemCode } = req.body;

        const [processRows] = await connection.execute(`
            SELECT
                ROW_NUMBER() OVER (ORDER BY c.id) AS sNo,
                c.processName AS process,
                c.machineName,
                c.Produced_QTY AS producedQty,
                CASE
                    WHEN c.Produced_QTY = 0 THEN 0
                    WHEN c.Produced_QTY > 0 AND c.Produced_QTY < c.Qty THEN 1
                    WHEN c.Produced_QTY = c.Qty THEN 2
                    WHEN c.Produced_QTY > c.Qty THEN 3
                END AS colorCode
            FROM childpart_planning c
            WHERE c.jcNo = ? AND c.itemCode = ?
        `, [jcNo, itemCode])

        return handleSuccessResponse(res, 'Process List', processRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

exports.fetchCurrentshift = async (conn, machine) => {
    try {
        const shifts = getCurrentShift();
        const curDate = (await currentDateTime()).split(" ")[0];

        const placeholders = shifts.map(() => '?').join(', ');

        const [shiftRows] = await conn.execute(`
            SELECT s.shiftNumber 
            FROM shift_production_planning s
            WHERE scheduleDate = ? 
              AND s.machineName = ? 
              AND shiftNumber IN (${placeholders})
        `, [curDate, machine, ...shifts]);

        if (!shiftRows.length) {
            throw new CustomError(`No shifts found for the machine on the current date.`);
        }

        return shiftRows[0].shiftNumber;
    } catch (err) {
        throw err;
    }
}

exports.updatePartCompletion = async (req, res) => {
    const conn = await connection.getConnection();

    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await conn.beginTransaction();

            let { jcNo, machine, process, prodDate = null, prodShift, prodQty } = req.body;
            const curDate = prodDate || await currentDateTime();

            if (!prodShift) {
                prodShift = await this.fetchCurrentshift(conn, machine);
            }

            // ❌ Removed unnecessary FOR UPDATE lock

            await conn.execute(
                `UPDATE jobcard_planning
                 SET producedQty = ?
                 WHERE jcNo = ? AND machineName = ? AND process = ?`,
                [prodQty, jcNo, machine, process]
            );

            await conn.execute(
                `UPDATE sf_schedule
                 SET prod_date = ?,
                     prod_shift = ?,
                     prod_qty = ?,
                     status = CASE
                        WHEN ? >= Qty THEN 1
                        ELSE 0
                     END
                 WHERE jcNo = ? AND machine = ? AND process = ?`,
                [curDate, prodShift, prodQty, prodQty, jcNo, machine, process]
            );

            await conn.commit();
            return handleSuccessResponse(res, "Update successful");

        } catch (err) {
            await conn.rollback();

            // ✅ Retry on deadlock
            if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
                continue;
            }

            return handleErrorResponse(res, err);
        }
    }

    conn.release();
};

exports.updateChildPartCompletion = async (req, res) => {
    const conn = await connection.getConnection();

    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await conn.beginTransaction();

            let { jcNo, childPart, machine, process, prodDate = null, prodShift, prodQty } = req.body;
            const curDate = prodDate || await currentDateTime();
            console.log(prodDate)

            if (!prodShift) {
                prodShift = await this.fetchCurrentshift(conn, machine);
            }

            await conn.execute(
                `UPDATE sf_schedule
                 SET 
                    prod_date = ?, 
                    prod_shift = ?, 
                    prod_qty = ?,
                    status = CASE 
                        WHEN ? >= Qty THEN 1
                        ELSE 0 
                    END
                 WHERE jcNo = ? AND machine = ? AND process = ? AND childItemCode = ?`,
                [curDate, prodShift, prodQty, prodQty, jcNo, machine, process, childPart]
            );

            await conn.execute(
                `UPDATE childpart_planning
                 SET 
                    Produced_date = ?,
                    Shift = ?,
                    Produced_QTY = ?,
                    Status = CASE 
                        WHEN ? >= Qty THEN 1
                        ELSE 0 
                    END
                 WHERE jcNo = ? AND machineName = ? AND itemCode = ?`,
                [curDate, prodShift, prodQty, prodQty, jcNo, machine, childPart]
            );

            await conn.commit();
            return handleSuccessResponse(res, "Update successful");

        } catch (err) {
            await conn.rollback();

            // ✅ Retry on deadlock
            if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
                continue;
            }

            return handleErrorResponse(res, err);
        }
    }

    conn.release();
};

exports.updateNestingQty = async (req, res) => {
    const conn = await connection.getConnection();

    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await conn.beginTransaction();

            const { jcNo, machine, partNo, nestNo, prodShift, prodQty } = req.body;

            if (!jcNo || !machine || !partNo || !nestNo) {
                throw new CustomError("Missing required fields!", 400);
            }

            const curDate = await currentDateTime();

            // ❌ Removed FOR UPDATE
            const [nestRows] = await conn.execute(
                `SELECT SUM(Produced_QTY) AS sumQty
                 FROM nesting_table
                 WHERE Jobcard_no = ? AND Part_no = ?`,
                [jcNo, partNo]
            );

            const previousProducedQty = Number(nestRows[0].sumQty) || 0;
            const updatedTotalProducedQty = previousProducedQty + Number(prodQty);

            // ✅ Maintain consistent order
            await conn.execute(
                `UPDATE nesting_table
                 SET Produced_QTY = ?
                 WHERE Jobcard_no = ? AND Part_no = ? AND Nesting_no = ?`,
                [prodQty, jcNo, partNo, nestNo]
            );

            await conn.execute(
                `UPDATE jobcard_planning
                 SET producedQty = ?
                 WHERE jcNo = ? AND machineName = ?`,
                [updatedTotalProducedQty, jcNo, machine]
            );

            await conn.execute(
                `UPDATE sf_schedule
                 SET prod_date = ?,
                     prod_shift = ?,
                     prod_qty = ?,
                     status = CASE
                        WHEN ? >= Qty THEN 1
                        ELSE 0
                     END
                 WHERE jcNo = ? AND machine = ?`,
                [curDate, prodShift, updatedTotalProducedQty, updatedTotalProducedQty, jcNo, machine]
            );

            await conn.commit();
            return handleSuccessResponse(res, "Nesting Quantity updated successfully");

        } catch (err) {
            await conn.rollback();

            // ✅ Retry on deadlock
            if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
                continue;
            }

            return handleErrorResponse(res, err);
        }
    }

    conn.release();
};

exports.updateChildPartQty = async (req, res) => {
    const conn = await connection.getConnection();

    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await conn.beginTransaction();

            const { jcNo, partNo, nestNo, prodShift, prodQty, machine } = req.body;

            if (!jcNo || !partNo) {
                throw new CustomError("Missing required fields");
            }

            const curDate = await currentDateTime();

            // Removed FOR UPDATE (major deadlock cause)
            const [nestRows] = await conn.execute(
                `SELECT SUM(Produced_QTY) AS sumQty
                 FROM nesting_table
                 WHERE Jobcard_no = ? AND Part_no = ?`,
                [jcNo, partNo]
            );

            const totalNestingQty = (Number(nestRows[0].sumQty) || 0) + Number(prodQty);

            // Keep consistent order (important)
            await conn.execute(
                `UPDATE nesting_table 
                 SET Produced_QTY = ?
                 WHERE Jobcard_no = ? AND Part_no = ? AND Nesting_no = ?`,
                [prodQty, jcNo, partNo, nestNo]
            );

            // Merge both updates into ONE (reduces lock time)
            await conn.execute(
                `UPDATE childpart_planning
                 SET 
                    Produced_date = ?,
                    Shift = ?,
                    Produced_QTY = ?,
                    Status = CASE 
                        WHEN ? >= Qty THEN 1
                        ELSE 0 
                    END
                 WHERE jcNo = ? AND machineName = ? AND itemCode = ?`,
                [curDate, prodShift, totalNestingQty, totalNestingQty, jcNo, machine, partNo]
            );

            await conn.commit();

            return handleSuccessResponse(res, "Nesting Quantity updated successfully");

        } catch (err) {
            await conn.rollback();

            // Retry only for deadlocks
            if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
                continue;
            }

            return handleErrorResponse(res, err);
        }
    }

    conn.release();
};

exports.updateChildPartManual = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        let { jcNo, machine, itemCode, prodShift, prodQty } = req.body;

        if (!prodShift) {
            prodShift = await this.fetchCurrentshift(conn, machine);
        }

        if (!jcNo || !itemCode || !prodShift) {
            throw new CustomError("Missing required fields!", 400);
        }
        const curDate = await currentDateTime();

        await conn.execute(
            `UPDATE childpart_planning 
             SET Produced_date = ?, Shift = ?, Produced_QTY = ?
             WHERE jcNo = ? AND machineName = ? AND itemCode = ?`,
            [curDate, prodShift, prodQty, jcNo, machine, itemCode]
        );

        await conn.execute(
            `UPDATE childpart_planning 
             SET Status = CASE 
                WHEN Produced_QTY >= Qty THEN 1
                ELSE 0
             END
             WHERE jcNo = ? AND machineName = ? AND itemCode = ?`,
            [jcNo, machine, itemCode]
        );
        await conn.commit();

        return handleSuccessResponse(res, 'Nesting Quantity updated successfully');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};

exports.childPartDetails = async (req, res) => {
    try {
        const { jcNo, itemCode } = req.body;

        const [processRows] = await connection.execute(`
            SELECT 
                ROW_NUMBER() OVER(ORDER BY c.id) as sNo, 
                c.machineName, 
                c.processName, 
                c.Produced_QTY as producedQty,
                CASE
                    WHEN c.Produced_QTY = 0 THEN 0
                    WHEN c.Produced_QTY > 0 AND c.Produced_QTY < c.Qty THEN 1
                    WHEN c.Produced_QTY = c.Qty THEN 2
                    WHEN c.Produced_QTY > c.Qty THEN 3
                END AS colorCode 
            FROM childpart_planning c
            WHERE c.jcNo = ? AND c.itemCode = ?
            `,
            [jcNo, itemCode]
        );

        return handleSuccessResponse(res, 'Child Part Process Details', processRows);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
}

const paginate = (arr, page = 0, limit = 10, view = '') => {
    if (!Array.isArray(arr)) return [];

    if (view === "first") {
        return arr.slice(0, limit);
    }

    if (view === "last") {
        return arr.slice(-limit);
    }

    const start = page * limit;
    return arr.slice(start, start + limit);
};

exports.machinePlanning = async (req, res) => {
    try {
        let { page = 0, limit = 15, view = '' } = req.body;

        const safeLimit = Math.max(1, Number(limit));
        const safePage = Math.max(0, Number(page));

        // Fetch machine planning list
        const machinePlan = await scheduledPlan(req) || [];

        // Apply pagination
        const paginatedData = paginate(machinePlan, safePage, safeLimit, view);

        const totRows = machinePlan.length;
        const totalPages = Math.ceil(totRows / limit);
        const workPlanned = Math.floor(machinePlan.reduce((sum, item) => sum + (Number(item['Work Planned']) || 0), 0));
        const TotCount = Math.floor(machinePlan.reduce((sum, item) => sum + (Number(item['TotCount']) || 0), 0));

        return res.status(200).json({
            success: true,
            message: 'Scheduled tasks',
            data: paginatedData,
            totRows,
            totalPages,
            workPlanned,
            TotCount
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.machinePlan = async (req, res) => {
    try {
        const { machine, date, shift } = req.body;

        const startDate = `${date} 00:00:00`;
        const endDate = `${date} 23:59:59`;

        const [rows] = await connection.execute(
            `
            SELECT 
                SUM(plannedQty) AS totalPlannedQty,
                SUM(producedQty) AS totalProducedQty
            FROM (
                -- Child planning totals
                SELECT 
                    SUM(Qty) AS plannedQty,
                    SUM(Produced_QTY) AS producedQty
                FROM childpart_planning
                WHERE machineName = ?
                  AND Produced_date BETWEEN ? AND ?
                  AND Shift = ?

                UNION ALL

                -- Schedule totals minus overlapping jcIds
                SELECT 
                    SUM(s.Qty) AS plannedQty,
                    SUM(s.prod_qty) AS producedQty
                FROM sf_schedule s
                LEFT JOIN childpart_planning c 
                    ON c.jcId = s.jcId
                   AND c.machineName = s.machine
                   AND c.Produced_date BETWEEN ? AND ?
                   AND c.Shift = s.prod_shift
                WHERE s.machine = ?
                  AND s.prod_date BETWEEN ? AND ?
                  AND s.prod_shift = ?
                  AND c.jcId IS NULL
            ) AS combined
            `,
            [
                machine, startDate, endDate, shift, // child
                startDate, endDate, machine, startDate, endDate, shift // schedule
            ]
        );

        return res.status(200).json({
            success: true,
            totalPlannedQty: rows[0].totalPlannedQty || 0,
            totalProducedQty: rows[0].totalProducedQty || 0
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// parseRow unchanged except ensure bomPartNo presence is validated
function parseRowFromJson(row) {
    // Row is array: [colA, colB, colC, ...]
    const get = (i) => (row[i - 1] ?? "").toString().trim();

    const obj = {
        csl: get(1),
        fimNo: get(2),
        partNo: get(3),
        desc: get(4),
        finish: get(5),
        qty: get(6),
        bom: get(7),
        bomPartNo: get(8),
        bomQty: get(9),
        bomDesc: get(10)
    };

    let error = "";
    if (obj.bomPartNo) {
        const parts = obj.bomPartNo.split("-");
        if (parts.length !== 2) {
            error = `Invalid BOM format (${obj.bomPartNo})`;
        } else {
            const [splitCsl, splitFim] = parts;
            if (obj.csl !== splitCsl || obj.fimNo !== splitFim) {
                error = obj.bomPartNo;
            }
        }
    }

    return { obj, error };
}

function chunkArray(arr, size = 500) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

exports.revisedBarcodeCsl = async (req, res) => {
    try {
        const fileBase64 = req.body?.file;
        if (!fileBase64) {
            throw new CustomError("File is required in Base64 format", 400);
        }

        /* ---------------------------------------------
         * Decode Base64 → Buffer
         * --------------------------------------------- */
        const buffer = await decodeExcelBase64(fileBase64);

        /* ---------------------------------------------
         * Read Workbook
         * --------------------------------------------- */
        const workbook = XLSX.read(buffer, { type: "buffer" });

        const sheetName = workbook.SheetNames.find(
            name => name.toLowerCase() === "supplyinfo"
        );

        if (!sheetName) {
            throw new CustomError("Worksheet 'SupplyInfo' not found", 400);
        }

        const sheet = workbook.Sheets[sheetName];

        /* ---------------------------------------------
         * Sheet → Rows
         * --------------------------------------------- */
        const rows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: ""
        });

        if (rows.length <= 1) {
            throw new CustomError("Sheet contains no data", 400);
        }

        /* ---------------------------------------------
         * Parse Rows
         * --------------------------------------------- */
        const records = [];
        const errors = [];

        const bomPartSet = new Set();              // Unique bomPartNos
        const bomPartQtyMap = {};                  // bomPartNo-partNo → qty

        rows.forEach((row, index) => {
            if (index === 0) return;

            const { obj, error } = parseRowFromJson(row);

            if (error) {
                errors.push(error);
                return;
            }

            records.push(obj);
            bomPartSet.add(obj.bomPartNo);

            const key = `${obj.bomPartNo}-${obj.partNo}`;
            bomPartQtyMap[key] = Number(obj.qty);
        });

        if (errors.length > 0) {
            throw new CustomError(
                `Mismatch BOM entries: ${errors.join(", ")}`,
                400
            );
        }

        const bomPartNos = [...bomPartSet];
        if (!bomPartNos.length) {
            throw new CustomError("No valid BOM Part No values found", 400);
        }

        /* ---------------------------------------------
         * Check Barcode Generation (BOM PART BASED)
         * --------------------------------------------- */
        const existingBomParts = new Set();
        const bomPartChunks = chunkArray(bomPartNos);

        for (const group of bomPartChunks) {
            const placeholders = group.map(() => "?").join(",");

            const [assemblyRows] = await barcodeDB.execute(
                `
                SELECT DISTINCT bomPartNo
                FROM assembly_barcode_no
                WHERE bomPartNo IN (${placeholders})
                `,
                group
            );

            const [kittingRows] = await barcodeDB.execute(
                `
                SELECT DISTINCT bomPartNo
                FROM box_kitting_assmbly_bcno
                WHERE bomPartNo IN (${placeholders})
                `,
                group
            );

            assemblyRows.forEach(r => existingBomParts.add(r.bomPartNo));
            kittingRows.forEach(r => existingBomParts.add(r.bomPartNo));
        }

        /* ---------------------------------------------
         * Qty Validation (barcode_csl)
         * --------------------------------------------- */
        if (existingBomParts.size > 0) {
            const existingArray = [...existingBomParts];
            const placeholders = existingArray.map(() => "?").join(",");

            const [existingQtyRows] = await barcodeDB.execute(
                `
                SELECT bomPartNo, partNo, qty
                FROM barcode_csl
                WHERE bomPartNo IN (${placeholders})
                `,
                existingArray
            );

            const qtyMismatchErrors = [];

            for (const row of existingQtyRows) {
                const key = `${row.bomPartNo}-${row.partNo}`;
                const excelQty = bomPartQtyMap[key];

                if (
                    excelQty !== undefined &&
                    Number(excelQty) !== Number(row.qty)
                ) {
                    qtyMismatchErrors.push(
                        `${row.bomPartNo}-${row.partNo} (Existing: ${row.qty}, Excel: ${excelQty})`
                    );
                }
            }

            if (qtyMismatchErrors.length > 0) {
                throw new CustomError(
                    `Qty mismatch for already generated barcodes: ${qtyMismatchErrors.join("; ")}`,
                    400
                );
            }
        }

        /* ---------------------------------------------
         * Insert / Update CSL
         * --------------------------------------------- */
        await updateBarcodeCsl(bomPartNos, records);

        return handleSuccessResponse(res, "Successfully imported");
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};


// updateBarcodeCsl: chunked INSERT ... ON DUPLICATE KEY UPDATE for bulk upsert
const updateBarcodeCsl = async (bomPartArray, cslRecords) => {
    const conn = await barcodeDB.getConnection();
    await conn.beginTransaction();

    try {
        // fetch existing BOMPartNo -> id mapping (in chunks)
        const existingMap = new Map();
        if (bomPartArray.length > 0) {
            const chunkSize = 500;
            for (let i = 0; i < bomPartArray.length; i += chunkSize) {
                const chunk = bomPartArray.slice(i, i + chunkSize);
                const placeholders = chunk.map(() => "?").join(",");
                const [rows] = await conn.execute(
                    `SELECT id, BOMPartNo FROM barcode_csl WHERE BOMPartNo IN (${placeholders})`,
                    chunk
                );
                for (const r of rows) existingMap.set(r.BOMPartNo, r.id);
            }
        }

        // separate records into all rows for upsert and also compute newRecords (not in existingMap)
        const newCslRecords = [];
        const upsertRows = []; // array of arrays matching columns order below
        for (const rec of cslRecords) {
            // normalize BOMPartNo existence
            if (!rec.bomPartNo) continue;
            const normalized = rec.bomPartNo;
            // track new records (those not in DB before)
            if (!existingMap.has(normalized)) newCslRecords.push(rec);

            // columns to insert/update (BOMPartNo must be unique key)
            upsertRows.push([
                rec.csl || null,
                rec.fimNo || null,
                normalized,
                rec.partNo || null,
                rec.desc || null,
                rec.finish || null,
                rec.qty || null,
                rec.bom || null,
                rec.bomQty || null,
                rec.bomDesc || null
            ]);
        }

        // if nothing to upsert, just commit and return newCslRecords
        if (upsertRows.length === 0) {
            await conn.commit();
            return newCslRecords;
        }

        // chunk upsertRows into safe batch sizes to prevent max_allowed_packet issues
        const rowsPerChunk = 400; // safe default; tune if necessary
        for (let i = 0; i < upsertRows.length; i += rowsPerChunk) {
            const batch = upsertRows.slice(i, i + rowsPerChunk);
            // build placeholders for each row: "(?,?,?,?,?,?,?,?)"
            const rowPlaceholders = batch.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",");
            // flatten parameters
            const params = batch.flat();

            // Assumes barcode_csl has UNIQUE(BOMPartNo)
            const sql = `
                INSERT INTO barcode_csl
                    (ContractNo, FIMNo, BOMPartNo, PartNo, Description, Finish, Qty, BOM, BOMQty, BOMDescription)
                VALUES ${rowPlaceholders}
                ON DUPLICATE KEY UPDATE
                    PartNo = VALUES(PartNo),
                    Description = VALUES(Description),
                    Finish = VALUES(Finish),
                    Qty = VALUES(Qty),
                    BOM = VALUES(BOM),
                    BOMQty = VALUES(BOMQty),
                    BOMDescription = VALUES(BOMDescription)
            `;

            await conn.execute(sql, params);
        }

        await conn.commit();
        return newCslRecords;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        try { conn.release(); } catch (e) { /* ignore release errors */ }
    }
};

exports.deleteBarcodeCsl = async (req, res) => {
    let serverConn, barcodeConn;

    try {
        const { bomPartNo } = req.body;

        if (!bomPartNo) {
            throw new CustomError("BOM Part No is required", 400);
        }

        const contractNo = bomPartNo.split("-")[0];
        const match = bomPartNo.match(/FIM\d+(\.\d+)?/);
        const fimNo = match ? match[0] : null;

        if (!fimNo) {
            throw new CustomError("Invalid BOM Part No (FIM not found)", 400);
        }

        // Prevent SQL injection
        if (!/^FIM\d+(\.\d+)?$/.test(fimNo)) {
            throw new CustomError("Invalid FIM number", 400);
        }

        serverConn = await connection.getConnection();
        barcodeConn = await barcodeDB.getConnection();

        await serverConn.beginTransaction();
        await barcodeConn.beginTransaction();

        const column = `\`${fimNo}\``;

        const [dispatchRows] = await serverConn.execute(
            `
            SELECT id
            FROM shipment_details
            WHERE ContractNo = ?
            AND ${column} = 'P/R/D'
            `,
            [contractNo]
        );

        if (dispatchRows.length > 0) {
            throw new CustomError(
                "This contract has already been dispatched and cannot be deleted.",
                400
            );
        }

        const [cslResult] = await barcodeConn.execute(
            `DELETE FROM barcode_csl WHERE BOMPartNo = ?`,
            [bomPartNo]
        );

        if (cslResult.affectedRows === 0) {
            throw new CustomError("No records found for given BOM Part No", 404);
        }

        await barcodeConn.execute(
            `DELETE FROM assembly_barcode_no WHERE BOMPartNo = ?`,
            [bomPartNo]
        );

        await barcodeConn.execute(
            `DELETE FROM box_kitting_assmbly_bcno WHERE BOMPartNo = ?`,
            [bomPartNo]
        );

        await serverConn.execute(
            `DELETE FROM fg_stocks WHERE itemCode = ?`,
            [bomPartNo]
        );

        await serverConn.execute(
            `UPDATE assembly_qc_counts
             SET qcStatus = 0
             WHERE contractNo = ? AND fimNo = ?`,
            [contractNo, fimNo]
        );

        await serverConn.commit();
        await barcodeConn.commit();

        return handleSuccessResponse(res, "Successfully deleted");
    } catch (err) {
        if (serverConn) await serverConn.rollback();
        if (barcodeConn) await barcodeConn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        if (serverConn) serverConn.release();
        if (barcodeConn) barcodeConn.release();
    }
};


exports.fecthBarcodeIds = async (req, res) => {
    try {
        const { mac } = req.query;

        const [[alloc]] = await connection.execute(
            `SELECT id FROM barcode_labels WHERE mac = ? LIMIT 1`,
            [mac]
        );

        const [rows] = await connection.execute(
            `SELECT id FROM barcode_labels WHERE mac IS NULL`,
        );

        return res.status(200).json({
            success: true,
            allocId: alloc?.id ?? null,
            data: rows
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.updateMacAdd = async (req, res) => {
    try {
        const { id, macAdd } = req.body;

        const now = new Date();
        const yy = now.getFullYear() % 100;

        const [result] = await connection.execute(`
            UPDATE barcode_labels SET mac = ?, counter_year = ? WHERE id = ? AND mac IS NULL`,
            [macAdd, yy, id]
        );

        if (result.affectedRows === 0) {
            throw new CustomError("Selected ID is already allocated or does not exist", 400);
        }

        return handleSuccessResponse(res, 'Successfully allocated');
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            err = new CustomError(
                "This MAC address is already assigned to another record",
                400
            );
        }

        return handleErrorResponse(res, err);
    }
}

function getISOWeek(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

exports.generateBarcodeLabel = async (req, res) => {
    try {
        const { machineId, Qty } = req.query;

        const now = new Date();
        const yy = now.getFullYear() % 100;
        const week = getISOWeek(now);

        // Atomic weekly reset + range reservation
        const [result] = await connection.execute(
            `
            UPDATE barcode_labels
            SET
                counter = CASE
                WHEN counter_year <> ? OR counter_week <> ?
                    THEN ?
                ELSE counter + ?
                END,
                counter_year = ?,
                counter_week = ?,
                counter = LAST_INSERT_ID(counter)
            WHERE id = ?
            `,
            [
                yy, week,
                Qty,
                Qty,
                yy, week,
                machineId
            ]
        );

        if (result.affectedRows === 0) {
            return handleErrorResponse(res, 'Invalid machineId');
        }

        const [[{ lastCounter }]] = await connection.execute(
            `SELECT LAST_INSERT_ID() AS lastCounter`
        );

        const startCounter = lastCounter - Qty + 1;

        const barcodes = [];
        for (let i = 0; i < Qty; i++) {
            barcodes.push(
                String(yy).padStart(2, '0') +
                String(week).padStart(2, '0') +
                String(machineId) +
                String(startCounter + i).padStart(5, '0')
            );
        }

        return handleSuccessResponse(res, 'Weekly barcode labels', barcodes);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.barcodeDetails = async (req, res) => {
    try {
        const { barcodeNo } = req.query;

        const [partNoRows] = await barcodeDB.execute(`
            SELECT ContractNo, PartNo, BOMPartNo, Scan_Date FROM partno_scandetails
            WHERE Barcode_No = ?`,
            [barcodeNo]
        );
        const [kittingRows] = await barcodeDB.execute(`
            SELECT ContractNo, PartNo, BOMPartNo, Scan_Date FROM kitting_partno_scanned
            WHERE Barcode_No = ?`,
            [barcodeNo]
        );

        return handleSuccessResponse(res, 'Barcode details', [...partNoRows, ...kittingRows]);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.saveToolSettingTime = async (req, res) => {
    try {
        const { nestingNo, startTime, endTime } = req.body;

        if (!nestingNo || !startTime || !endTime) {
            throw new CustomError("nestingNo, startTime, and endTime are required", 400);
        }

        const start = new Date(startTime);
        const end = new Date(endTime);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new CustomError("Invalid startTime or endTime format", 400);
        }

        if (end < start) {
            throw new CustomError("endTime must be after startTime", 400);
        }

        // Calculate time difference in minutes
        const toolSettingTime = parseFloat(((end - start) / 1000 / 60).toFixed(2));

        const insertQuery = `
            INSERT INTO tool_setting_time (nestingNo, startTime, endTime, toolSettingTime)
            VALUES (?, ?, ?, ?)
        `;

        await connection.execute(insertQuery, [nestingNo, startTime, endTime, toolSettingTime]);

        return handleSuccessResponse(res, "Tool setting time saved successfully", {
            nestingNo,
            startTime,
            endTime,
            toolSettingTime
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

// Batch size for the UNION-ALL join below — keeps a single UPDATE statement's
// parameter count and packet size reasonable for very large nestArr payloads.
const NEST_QTY_BATCH_SIZE = 500;

exports.updateNestingMapQty = async (req, res) => {
    const { nestArr = [] } = req.body;

    if (!Array.isArray(nestArr) || nestArr.length === 0) {
        return handleErrorResponse(res, new CustomError("At least one nesting record is required", 400));
    }

    const validRows = nestArr.filter(r => r && r.id != null && r.nest_qty != null);
    if (validRows.length === 0) {
        return handleErrorResponse(res, new CustomError("No valid nesting records provided", 400));
    }

    const conn = await connection.getConnection();
    try {
        await conn.beginTransaction();

        // One UPDATE ... JOIN per chunk instead of one round trip per row — collapses
        // what used to be `nestArr.length` separate queries (each grabbing its own
        // pool connection) into ceil(n / BATCH_SIZE) queries on a single connection,
        // and wraps them in a transaction so a mid-batch failure can't leave a partial update.
        for (let i = 0; i < validRows.length; i += NEST_QTY_BATCH_SIZE) {
            const chunk = validRows.slice(i, i + NEST_QTY_BATCH_SIZE);
            const params = [];
            const selects = chunk.map(({ id, nest_qty }) => {
                params.push(nest_qty, id);
                return `SELECT ? AS nest_qty, ? AS id`;
            }).join(' UNION ALL ');

            await conn.query(
                `UPDATE mrp m JOIN (${selects}) t ON m.id = t.id SET m.nest_qty = m.nest_qty + t.nest_qty`,
                params
            );
        }

        await conn.commit();
        return handleSuccessResponse(res, "Nesting quantities updated successfully");
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};
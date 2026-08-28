const { connection, handleSuccessResponse, handleErrorResponse, CustomError } = require('../config/dbSql');
const { getUser } = require("../utility/utilityFunction");



exports.searchMaterial = async (req, res) => {
  try {
    const { q } = req.query;

    let fetch = `SELECT material FROM valid_materials`;
    const values = [];

    if (q) {
      fetch += ` WHERE material LIKE ?`;
      values.push(`%${q}%`);
    }

    // order alphabetically and limit to 20
    fetch += ` ORDER BY material ASC LIMIT 20`;

    const [rows] = await connection.execute(fetch, values);

    rows.forEach((element, index) => {
      element.id = index + 1;
    });

    return handleSuccessResponse(res, "Materials", rows);
  } catch (err) {
    return handleErrorResponse(res, err);
  }
};



exports.store = async (req, res) => {
  const conn = await connection.getConnection(); // ensure you have connection pool/instance

  try {
    const qc = req.body;
    const { processId, material } = qc;
    const user = await getUser(req);

    const storeQuery = `
      INSERT INTO copq_mst (processId, material, addedBy)
      VALUES (?, ?, ?)
    `;

    await conn.execute(storeQuery, [processId, material, user]);

    return handleSuccessResponse(res, "Data added successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release(); // release connection if using pool
  }
};

exports.update = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;
    const { processId, material } = req.body;
    const user = await getUser(req);

    if (!id) {
      return handleErrorResponse(res, "Missing record ID");
    }

    const updateQc = `
      UPDATE copq_mst
        SET processId = ?, material = ?,  updatedBy = ?
      WHERE id = ?
    `;

    const updateValues = [processId, material, user, id];
    const [result] = await conn.execute(updateQc, updateValues);

    if (result.affectedRows === 0) {
      return handleErrorResponse(res, "No record found to update");
    }

    return handleSuccessResponse(res, "Data updated successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};




exports.show = async (req, res) => {
  try {
    const [rows] = await connection.execute(`
     SELECT 
       copq.id,  copq.processId, copq.material, p.code As process, p.name As processName
     FROM  
       copq_mst copq
     INNER JOIN mst_pm p ON p.id = copq.processId`, []
    );

    return handleSuccessResponse(res, 'Mrn lists', rows);
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}



exports.delete = async (req, res) => {
  try {
    const id = req.params.id;

    await connection.execute(`DELETE FROM copq_mst WHERE id = ?`, [id]);

    return handleSuccessResponse(res, 'Deleted successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}



// **************************************************************************         MATERIAL COPQ MASTER            ****************************************************************************************// 


exports.storeMatRate = async (req, res) => {
  const conn = await connection.getConnection(); // ensure you have connection pool/instance

  try {
    const qc = req.body;
    const { material, rate } = qc;
    const user = await getUser(req);

    const storeQuery = `
      INSERT INTO material_copq_mst (material, rate, addedBy)
      VALUES (?, ?, ?)
    `;

    await conn.execute(storeQuery, [material, rate, user]);

    return handleSuccessResponse(res, "Data added successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release(); // release connection if using pool
  }
};




exports.updateMatRate = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;
    const { material, rate } = req.body;
    const user = await getUser(req);

    if (!id) {
      return handleErrorResponse(res, "Missing record ID");
    }

    const updateQc = `
      UPDATE material_copq_mst
        SET  material = ?, rate = ?, updatedBy = ?
      WHERE id = ?
    `;

    const updateValues = [material, rate, user, id];
    const [result] = await conn.execute(updateQc, updateValues);

    if (result.affectedRows === 0) {
      return handleErrorResponse(res, "No record found to update");
    }

    return handleSuccessResponse(res, "Data updated successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};



exports.showMatRate = async (req, res) => {
  try {
    const [rows] = await connection.execute(`
      SELECT 
       copq.id,  copq.material, copq.rate
        FROM  
      material_copq_mst copq`, []
    );

    return handleSuccessResponse(res, 'Material COPQ Master lists', rows);
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}



exports.deleteMatRate = async (req, res) => {
  try {
    const id = req.params.id;

    await connection.execute(`DELETE FROM material_copq_mst WHERE id = ?`, [id]);

    return handleSuccessResponse(res, 'Deleted successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}


// **************************************************************************         PROCESS PRICE MAPPING COPQ MASTER            ****************************************************************************************// 


exports.storePrMap = async (req, res) => {
  const conn = await connection.getConnection(); // ensure you have connection pool/instance

  try {
    const qc = req.body;
    const { processId, priceFrom, priceTo, rate } = qc;
    const user = await getUser(req);

    if (!processId || priceFrom == null || priceTo == null || rate == null) {
      throw new CustomError("All fields are required!")
    }

    /* ---------- DUPLICATE CHECK ---------- */
    const checkSql = `
      SELECT id
      FROM pm_price_map
      WHERE processId = ? AND priceFrom = ? AND priceTo = ?
      LIMIT 1`;

    const [existing] = await conn.execute(checkSql, [
      processId, priceFrom, priceTo
    ]);

    if (existing.length > 0) {
      throw new CustomError("Price range already exists for this process!");
    }


    // Create range like: "1 To 100"
    const range = `${priceFrom}-${priceTo}`;

    const storeQuery = `
      INSERT INTO pm_price_map (processId, priceFrom, priceTo, \`range\`, rate, addedBy)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await conn.execute(storeQuery, [processId, priceFrom, priceTo, range, rate, user]);

    return handleSuccessResponse(res, "Data added successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release(); // release connection if using pool
  }
};

exports.updatePrMap = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;
    const { priceFrom, priceTo, rate } = req.body;
    const user = await getUser(req);


    // Create range like: "1 To 100"
    const range = `${priceFrom}-${priceTo}`;

    const updateQc = `
      UPDATE pm_price_map
        SET priceFrom = ?, priceTo = ?, \`range\` = ?, rate = ?, updatedBy = ?
      WHERE id = ?
    `;

    const updateValues = [priceFrom, priceTo, range, rate, user, id];
    const [result] = await conn.execute(updateQc, updateValues);

    if (result.affectedRows === 0) {
      return handleErrorResponse(res, "No record found to update");
    }

    return handleSuccessResponse(res, "Data updated successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};




exports.showPrMap = async (req, res) => {
  try {
    const [rows] = await connection.execute(`
      SELECT 
        copq.id,  copq.processId, copq.priceFrom, copq.priceTo, copq.range, copq.rate, p.code As process, p.name As processName
      FROM  
        pm_price_map copq
      INNER JOIN mst_pm p ON p.id = copq.processId`, []
    );

    return handleSuccessResponse(res, 'Price lists', rows);
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}



exports.deletePrMap = async (req, res) => {
  try {
    const id = req.params.id;

    await connection.execute(`DELETE FROM pm_price_map WHERE id = ?`, [id]);

    return handleSuccessResponse(res, 'Deleted successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}


// **************************************************************************         REWORK MAN HOUR RATE MASTER            ****************************************************************************************// 


exports.storeRewRate = async (req, res) => {
  const conn = await connection.getConnection(); // ensure you have connection pool/instance

  try {
    const qc = req.body;
    const { user, rate } = qc;
    const userBy = await getUser(req);

    const storeQuery = `
      INSERT INTO rework_rate_mst (user, rate, addedBy)
      VALUES (?, ?, ?)
    `;

    await conn.execute(storeQuery, [user, rate, userBy]);

    return handleSuccessResponse(res, "Data added successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release(); // release connection if using pool
  }
};




exports.updateRewtRate = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;
    const { user, rate } = req.body;
    const userBy = await getUser(req);

    if (!id) {
      return handleErrorResponse(res, "Missing record ID");
    }

    const updateQc = `
      UPDATE rework_rate_mst
        SET  user = ?, rate = ?, updatedBy = ?
      WHERE id = ?
    `;

    const updateValues = [user, rate, userBy, id];
    const [result] = await conn.execute(updateQc, updateValues);

    if (result.affectedRows === 0) {
      return handleErrorResponse(res, "No record found to update");
    }

    return handleSuccessResponse(res, "Data updated successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};



exports.showRewRate = async (req, res) => {
  try {
    const [rows] = await connection.execute(`
      SELECT 
       copq.id, copq.user, copq.rate
        FROM  
      rework_rate_mst copq`, []
    );

    return handleSuccessResponse(res, 'Material COPQ Master lists', rows);
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}



exports.deleteRewRate = async (req, res) => {
  try {
    const id = req.params.id;

    await connection.execute(`DELETE FROM rework_rate_mst WHERE id = ?`, [id]);

    return handleSuccessResponse(res, 'Deleted successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}





//LAST CHNAGES CODE WORKINGG SMOOTH(REJECTED QTY NOT TAKEN)
// exports.copqShow = async (req, res) => {
//   try {
//     const { from, to } = req.body;

//     const round2 = (num) => Number(Number(num || 0).toFixed(2));

//     /* ================= DAY RANGE ================= */
//     // const daySql = `
//     //   SELECT 
//     //     CONCAT(UPPER(DATE_FORMAT(d, '%b')),'-',DAY(d)) AS day
//     //   FROM (
//     //     SELECT DATE_ADD(?, INTERVAL seq DAY) d
//     //     FROM (
//     //       SELECT @row := @row + 1 AS seq
//     //       FROM 
//     //         (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
//     //          UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a,
//     //         (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
//     //          UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b,
//     //         (SELECT @row := -1) r
//     //     ) s
//     //     WHERE DATE_ADD(?, INTERVAL seq DAY) <= ?
//     //   ) x
//     // `;

//     const daySql = `
//       SELECT 
//         DATE_FORMAT(d,'%Y-%m-%d') AS date,
//         CONCAT(UPPER(DATE_FORMAT(d, '%b')),'-',DAY(d)) AS day
//       FROM (
//         SELECT DATE_ADD(?, INTERVAL seq DAY) d
//         FROM (
//           SELECT @row := @row + 1 AS seq
//           FROM 
//             (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
//             UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a,
//             (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
//             UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b,
//             (SELECT @row := -1) r
//         ) s
//         WHERE DATE_ADD(?, INTERVAL seq DAY) <= ?
//       ) x
//     `;
//     const [days] = await connection.execute(daySql, [from, from, to]);

//     /* ================= FINAL ================= */
//     // const finalSql = `
//     //   SELECT
//     //     CONCAT(UPPER(DATE_FORMAT(d.day, '%b')),'-',DAY(d.day)) AS day,
//     //     ROUND(
//     //       SUM(CAST(pm.count AS DECIMAL(10,2)) * ppm.rate)
//     //       +
//     //       SUM(DISTINCT COALESCE(i.netWeight, 0) * COALESCE(mat.rate, 0)),
//     //       2
//     //     ) AS final
//     //   FROM (
//     //     SELECT DISTINCT DATE(created_at) AS day, itemId, processId
//     //     FROM assembly_qlty_inspeclist_mst
//     //     WHERE status = 'scrap'
//     //       AND created_at >= ?
//     //       AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
//     //   ) d
//     //   INNER JOIN item_vs_pm pm
//     //     ON pm.item = d.itemId
//     //    AND pm.process = d.processId
//     //   INNER JOIN pm_price_map ppm
//     //     ON ppm.id = pm.priceRange
//     //   INNER JOIN items i
//     //     ON i.id = d.itemId
//     //   LEFT JOIN material_copq_mst mat
//     //     ON mat.material = i.material
//     //   GROUP BY d.day
//     // `;
//     // const [finalRows] = await connection.execute(finalSql, [from, to]);

  
    
//     /* ================= FINAL ================= */
//     const finalSql = `
//       SELECT
//         CONCAT(UPPER(DATE_FORMAT(d.day, '%b')),'-',DAY(d.day)) AS day,
//         ROUND(
//           SUM(CAST(prev_pm.count AS DECIMAL(10,2)) * ppm.rate)   -- ✅ removed CASE/vs, use prev_pm.count directly
//           +
//           SUM(DISTINCT COALESCE(i.netWeight, 0) * COALESCE(mat.rate, 0)),
//         2) AS final
//       FROM (
//         SELECT DISTINCT DATE(created_at) AS day, itemId, processId
//         FROM assembly_qlty_inspeclist_mst
//         WHERE status = 'scrap'
//           AND created_at >= ?
//           AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
//       ) d
//       INNER JOIN item_vs_pm cur_pm
//         ON cur_pm.item = d.itemId
//         AND cur_pm.process = d.processId
//       INNER JOIN item_vs_pm prev_pm
//         ON prev_pm.item = d.itemId
//         AND prev_pm.processPriority <= cur_pm.processPriority
//       INNER JOIN pm_price_map ppm
//         ON ppm.id = prev_pm.priceRange
//       INNER JOIN items i
//         ON i.id = d.itemId
//       LEFT JOIN material_copq_mst mat
//         ON mat.material = i.material
//       GROUP BY d.day
//     `;
//     const [finalRows] = await connection.execute(finalSql, [from, to]);  
    
//     /* ================= INPROCESS ================= */
//     const inprocessSql = `
//       SELECT
//         CONCAT(UPPER(DATE_FORMAT(d.day, '%b')),'-',DAY(d.day)) AS day,
//         ROUND(
//           SUM(
//             CAST(
//               CASE
//                 WHEN prev_pm.processPriority = cur_pm.processPriority
//                   THEN COALESCE(vs.scrap_count, cur_pm.count)
//                 ELSE prev_pm.count
//               END
//             AS DECIMAL(10,2)) * ppm.rate
//           ),
//         2) AS inprocess
//       FROM (
//         SELECT DISTINCT DATE(created_at) AS day, itemId, processId
//         FROM vw_pm_inspeclist_scrap
//         WHERE status = 'scrap'
//           AND created_at >= ?
//           AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
//       ) d
//       LEFT JOIN (
//         SELECT DATE(created_at) AS day, itemId, processId, count AS scrap_count
//         FROM vw_pm_inspeclist_scrap
//         WHERE status = 'scrap'
//         GROUP BY DATE(created_at), itemId, processId
//       ) vs
//         ON vs.day = d.day
//       AND vs.itemId = d.itemId
//       AND vs.processId = d.processId
//       INNER JOIN item_vs_pm cur_pm
//         ON cur_pm.item = d.itemId AND cur_pm.process = d.processId
//       INNER JOIN item_vs_pm prev_pm
//         ON prev_pm.item = d.itemId
//       AND prev_pm.processPriority <= cur_pm.processPriority
//       INNER JOIN pm_price_map ppm
//         ON ppm.id = prev_pm.priceRange
//       GROUP BY d.day
//     `;
//     const [inprocessRows] = await connection.execute(inprocessSql, [from, to]);

//     /* ================= MATERIAL ================= */
//     const materialRateSql = `
//       SELECT
//         CONCAT(UPPER(DATE_FORMAT(d.day, '%b')),'-',DAY(d.day)) AS day,
//         ROUND(
//           SUM(COALESCE(i.netWeight, 0) * COALESCE(mat.rate, 0)),
//           2
//         ) AS materialCost
//       FROM (
//         SELECT DISTINCT DATE(created_at) AS day, itemId
//         FROM vw_pm_inspeclist_scrap
//         WHERE status = 'scrap'
//           AND created_at >= ?
//           AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
//       ) d
//       INNER JOIN items i ON i.id = d.itemId
//       LEFT JOIN material_copq_mst mat ON mat.material = i.material
//       GROUP BY d.day
//     `;
//     const [materialRateRows] = await connection.execute(materialRateSql, [from, to]);

//     /* ================= REWORK ================= */
//     const reworkSql = `
//       SELECT 
//         CONCAT(UPPER(DATE_FORMAT(created_at, '%b')),'-',DAY(created_at)) AS day,
//         ROUND(SUM(totCost),2) AS reworkCost
//       FROM rework_rate_costs
//       WHERE DATE(created_at) BETWEEN ? AND ?
//       GROUP BY DATE(created_at)
//     `;
//     const [reworkRows] = await connection.execute(reworkSql, [from, to]);

//     /* ================= DESCRIPTION ================= */
//     const [allDescRows] = await connection.execute(`SELECT description FROM copy_desc_mst`);
//     const allDescriptions = allDescRows.map(d => d.description);

//     const descSql = `
//       SELECT 
//         CONCAT(UPPER(DATE_FORMAT(c.date, '%b')),'-',DAY(c.date)) AS day,
//         m.description,
//         ROUND(SUM(c.cost),2) AS cost
//       FROM copy_desc_costs_log c
//       INNER JOIN copy_desc_mst m ON m.id = c.descId
//       WHERE DATE(c.date) BETWEEN ? AND ?
//       GROUP BY DATE(c.date), m.description
//     `;
//     const [descRows] = await connection.execute(descSql, [from, to]);

//     /* ================= MERGE ================= */
//     const map = {};

//     // days.forEach(d => {
//     //   map[d.day] = {
//     //     day: d.day,
//     //     final: 0,
//     //     inprocess: 0,
//     //     materialCost: 0,
//     //     reworkCost: 0
//     //   };

//     //   allDescriptions.forEach(desc => {
//     //     map[d.day][desc] = 0;
//     //   });
//     // });

//     days.forEach(d => {
//       map[d.day] = {
//         day: d.day,
//         date: d.date,
//         final: 0,
//         inprocess: 0,
//         // materialCost: 0,
//         reworkCost: 0
//       };

//       allDescriptions.forEach(desc => {
//         map[d.day][desc] = 0;
//       });
//     });

//     /* FINAL */
//     finalRows.forEach(r => {
//       if (map[r.day]) {
//         map[r.day].final = round2(
//           map[r.day].final + Number(r.final || 0)
//         );
//       }
//     });

//     /* INPROCESS */
//     inprocessRows.forEach(r => {
//       if (map[r.day]) {
//         map[r.day].inprocess = round2(
//           map[r.day].inprocess + Number(r.inprocess || 0)
//         );
//       }
//     });

//     /* MATERIAL */
//     materialRateRows.forEach(r => {
//       if (map[r.day]) {

//         const materialCost = Number(r.materialCost || 0);

//         map[r.day].materialCost = round2(
//           map[r.day].materialCost + materialCost
//         );

//         map[r.day].inprocess = round2(
//           map[r.day].inprocess + materialCost
//         );
//       }
//     });

//     /* REWORK */
//     reworkRows.forEach(r => {
//       if (map[r.day]) {
//         map[r.day].reworkCost = round2(
//           map[r.day].reworkCost + Number(r.reworkCost || 0)
//         );
//       }
//     });

//     /* DESCRIPTION */
//     descRows.forEach(r => {
//       if (map[r.day]) {
//         map[r.day][r.description] = round2(
//           map[r.day][r.description] + Number(r.cost || 0)
//         );
//       }
//     });

//     /* FINAL SAFETY ROUND */
//     Object.values(map).forEach(d => {
//       d.final = round2(d.final);
//       d.inprocess = round2(d.inprocess);
//       // d.materialCost = round2(d.materialCost);
//       d.reworkCost = round2(d.reworkCost);
//     });

//     return handleSuccessResponse(
//       res,
//       "Day-wise COPQ Cost",
//       Object.values(map)
//     );

//   } catch (err) {
//     return handleErrorResponse(res, err);
//   }
// };



exports.copqShow = async (req, res) => {
  try {
    const { from, to } = req.body;

    const round2 = (num) => Number(Number(num || 0).toFixed(2));

    /* ================= DAY RANGE ================= */
    const daySql = `
      SELECT 
        DATE_FORMAT(d,'%Y-%m-%d') AS date,
        CONCAT(UPPER(DATE_FORMAT(d, '%b')),'-',DAY(d)) AS day
      FROM (
        SELECT DATE_ADD(?, INTERVAL seq DAY) d
        FROM (
          SELECT @row := @row + 1 AS seq
          FROM 
            (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a,
            (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b,
            (SELECT @row := -1) r
        ) s
        WHERE DATE_ADD(?, INTERVAL seq DAY) <= ?
      ) x
    `;
    const [days] = await connection.execute(daySql, [from, from, to]);


    /* ================= FINAL ================= */
    const finalSql = `
      SELECT
        CONCAT(UPPER(DATE_FORMAT(d.day, '%b')),'-',DAY(d.day)) AS day,
        ROUND(
          SUM(CAST(prev_pm.count AS DECIMAL(10,2)) * ppm.rate)   -- ✅ removed CASE/vs, use prev_pm.count directly
          +
          SUM(DISTINCT COALESCE(i.netWeight, 0) * COALESCE(mat.rate, 0)),
        2) AS final
      FROM (
        SELECT DISTINCT DATE(created_at) AS day, itemId, processId
        FROM assembly_qlty_inspeclist_mst
        WHERE status = 'scrap'
          AND created_at >= ?
          AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
      ) d
      INNER JOIN item_vs_pm cur_pm
        ON cur_pm.item = d.itemId
        AND cur_pm.process = d.processId
      INNER JOIN item_vs_pm prev_pm
        ON prev_pm.item = d.itemId
        AND prev_pm.processPriority <= cur_pm.processPriority
      INNER JOIN pm_price_map ppm
        ON ppm.id = prev_pm.priceRange
      INNER JOIN items i
        ON i.id = d.itemId
      LEFT JOIN material_copq_mst mat
        ON mat.material = i.material
      GROUP BY d.day
    `;
    const [finalRows] = await connection.execute(finalSql, [from, to]);  
    
    /* ================= INPROCESS ================= */
   
    // const inprocessSql = `
    //   SELECT
    //     CONCAT(UPPER(DATE_FORMAT(d.day, '%b')),'-',DAY(d.day)) AS day,
    //     ROUND(
    //       SUM(
    //         CAST(
    //           CASE
    //             WHEN prev_pm.processPriority = cur_pm.processPriority
    //               THEN COALESCE(vs.scrap_count, cur_pm.count)
    //             ELSE prev_pm.count
    //           END
    //         AS DECIMAL(10,2)) * ppm.rate
    //         * CASE
    //             WHEN prev_pm.processPriority = cur_pm.processPriority
    //             THEN COALESCE(vs.rejRewQty, 1)
    //             ELSE 1
    //           END
    //       ),
    //     2) AS inprocess
    //   FROM (
    //     SELECT DISTINCT DATE(created_at) AS day, itemId, processId
    //     FROM vw_pm_inspeclist_scrap
    //     WHERE status = 'scrap'
    //       AND created_at >= ?
    //       AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
    //   ) d
    //   LEFT JOIN (
    //     SELECT day, itemId, processId,
    //           count          AS scrap_count,
    //           SUM(rejRewQty) AS rejRewQty
    //     FROM (
    //       SELECT DISTINCT
    //         DATE(created_at) AS day,
    //         itemId,
    //         processId,
    //         qTestNo,
    //         jcId,
    //         rejRewQty,
    //         count
    //       FROM vw_pm_inspeclist_scrap
    //       WHERE status = 'scrap'
    //     ) deduped
    //     GROUP BY day, itemId, processId
    //   ) vs
    //     ON vs.day = d.day
    //     AND vs.itemId = d.itemId
    //     AND vs.processId = d.processId
    //   INNER JOIN item_vs_pm cur_pm
    //     ON cur_pm.item = d.itemId AND cur_pm.process = d.processId
    //   INNER JOIN item_vs_pm prev_pm
    //     ON prev_pm.item = d.itemId
    //     AND prev_pm.processPriority <= cur_pm.processPriority AND prev_pm.dflag = 0
    //   INNER JOIN pm_price_map ppm
    //     ON ppm.id = prev_pm.priceRange
    //   GROUP BY d.day
    // `;


     const inprocessSql = `
      SELECT
        CONCAT(UPPER(DATE_FORMAT(d.day, '%b')),'-',DAY(d.day)) AS day,
        ROUND(
          SUM(
            CAST(
              CASE
                WHEN prev_pm.processPriority = cur_pm.processPriority
                  THEN COALESCE(vs.scrap_count, cur_pm.count)
                ELSE prev_pm.count
              END
            AS DECIMAL(10,2)) * ppm.rate
            * CASE
                WHEN prev_pm.processPriority = cur_pm.processPriority
                THEN COALESCE(vs.rejRewQty, 1)
                ELSE 1
              END
          ),
        2) AS inprocess
      FROM (
        SELECT DISTINCT DATE(created_at) AS day, itemId, processId
        FROM vw_pm_inspeclist_scrap
        WHERE status = 'scrap'
          AND created_at >= ?
          AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
      ) d
      LEFT JOIN (
        SELECT day, itemId, processId,
              count          AS scrap_count,
              SUM(rejRewQty) AS rejRewQty
        FROM (
          SELECT DISTINCT
            DATE(created_at) AS day,
            itemId,
            processId,
            qTestNo,
            jcId,
            rejRewQty,
            count
          FROM vw_pm_inspeclist_scrap
          WHERE status = 'scrap'
        ) deduped
        GROUP BY day, itemId, processId
      ) vs
        ON vs.day = d.day
        AND vs.itemId = d.itemId
        AND vs.processId = d.processId
    INNER JOIN (
      SELECT item, process, processPriority, priceRange, count
      FROM item_vs_pm
      WHERE dflag = 0
      GROUP BY item, process, processPriority, priceRange, count
    ) cur_pm
      ON cur_pm.item = d.itemId
      AND cur_pm.process = d.processId

    INNER JOIN (
      SELECT item, process, processPriority, priceRange, count
      FROM item_vs_pm
      WHERE dflag = 0
      GROUP BY item, process, processPriority, priceRange, count
    ) prev_pm
      ON prev_pm.item = d.itemId
      AND prev_pm.processPriority <= cur_pm.processPriority  -- ✅ both are subquery aliases, no ambiguity
    INNER JOIN pm_price_map ppm
      ON ppm.id = prev_pm.priceRange
      GROUP BY d.day
    `;


    const [inprocessRows] = await connection.execute(inprocessSql, [from, to]);
    /* ================= MATERIAL ================= */
      const materialRateSql = `
      SELECT
        CONCAT(UPPER(DATE_FORMAT(d.day, '%b')),'-',DAY(d.day)) AS day,
        ROUND(
          SUM(COALESCE(i.netWeight, 0) * COALESCE(mat.rate, 0) * COALESCE(rq.rejRewQty, 1)),
          2
        ) AS materialCost
      FROM (
        SELECT DISTINCT DATE(created_at) AS day, itemId
        FROM vw_pm_inspeclist_scrap
        WHERE status = 'scrap'
          AND created_at >= ?
          AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
      ) d
      LEFT JOIN (
        SELECT day, itemId, SUM(rejRewQty) AS rejRewQty
        FROM (
          SELECT DISTINCT
            DATE(created_at) AS day,
            itemId,
            qTestNo,
            jcId,
            rejRewQty
          FROM vw_pm_inspeclist_scrap
          WHERE status = 'scrap'
        ) deduped
        GROUP BY day, itemId
      ) rq
        ON rq.day = d.day
        AND rq.itemId = d.itemId
      INNER JOIN items i ON i.id = d.itemId
      LEFT JOIN material_copq_mst mat ON mat.material = i.material
      GROUP BY d.day
    `;
    const [materialRateRows] = await connection.execute(materialRateSql, [from, to]);

    /* ================= REWORK ================= */
    const reworkSql = `
      SELECT 
        CONCAT(UPPER(DATE_FORMAT(created_at, '%b')),'-',DAY(created_at)) AS day,
        ROUND(SUM(totCost),2) AS reworkCost
      FROM rework_rate_costs
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY DATE(created_at)
    `;
    const [reworkRows] = await connection.execute(reworkSql, [from, to]);

    /* ================= DESCRIPTION ================= */
    const [allDescRows] = await connection.execute(`SELECT description FROM copy_desc_mst`);
    const allDescriptions = allDescRows.map(d => d.description);

    const descSql = `
      SELECT 
        CONCAT(UPPER(DATE_FORMAT(c.date, '%b')),'-',DAY(c.date)) AS day,
        m.description,
        ROUND(SUM(c.cost),2) AS cost
      FROM copy_desc_costs_log c
      INNER JOIN copy_desc_mst m ON m.id = c.descId
      WHERE DATE(c.date) BETWEEN ? AND ?
      GROUP BY DATE(c.date), m.description
    `;
    const [descRows] = await connection.execute(descSql, [from, to]);

    /* ================= MERGE ================= */
    const map = {};

    days.forEach(d => {
      map[d.day] = {
        day: d.day,
        date: d.date,
        final: 0,
        inprocess: 0,
        // materialCost: 0,
        reworkCost: 0
      };

      allDescriptions.forEach(desc => {
        map[d.day][desc] = 0;
      });
    });

    /* FINAL */
    finalRows.forEach(r => {
      if (map[r.day]) {
        map[r.day].final = round2(
          map[r.day].final + Number(r.final || 0)
        );
      }
    });

    /* INPROCESS */
    inprocessRows.forEach(r => {
      if (map[r.day]) {
        map[r.day].inprocess = round2(
          map[r.day].inprocess + Number(r.inprocess || 0)
        );
      }
    });

    /* MATERIAL */
    materialRateRows.forEach(r => {
      if (map[r.day]) {

        const materialCost = Number(r.materialCost || 0);

        map[r.day].materialCost = round2(
          map[r.day].materialCost + materialCost
        );

        map[r.day].inprocess = round2(
          map[r.day].inprocess + materialCost
        );
      }
    });

    /* REWORK */
    reworkRows.forEach(r => {
      if (map[r.day]) {
        map[r.day].reworkCost = round2(
          map[r.day].reworkCost + Number(r.reworkCost || 0)
        );
      }
    });

    /* DESCRIPTION */
    descRows.forEach(r => {
      if (map[r.day]) {
        map[r.day][r.description] = round2(
          map[r.day][r.description] + Number(r.cost || 0)
        );
      }
    });

    /* FINAL SAFETY ROUND */
    Object.values(map).forEach(d => {
      d.final = round2(d.final);
      d.inprocess = round2(d.inprocess);
      // d.materialCost = round2(d.materialCost);
      d.reworkCost = round2(d.reworkCost);
    });

    return handleSuccessResponse(
      res,
      "Day-wise COPQ Cost",
      Object.values(map)
    );

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


exports.copqDrillDown = async (req, res) => {
  try {

    const { day, description } = req.body;
    const targetDate = day;

    const round2 = (num) => Number(Number(num || 0).toFixed(2));

    let rows = [];

    /* ============================================================
       FINAL COST
    ============================================================ */
    if (description === "final") {

      const finalSql = `
        SELECT
          d.itemId,
          i.itemName,
          i.itemCode,
          i.netWeight,
          mat.rate                             AS materialRate,
          ROUND(COALESCE(i.netWeight,0) * COALESCE(mat.rate,0), 2) AS materialCost,
          d.processId                          AS scrapProcessId,
          p.name                               AS scrapProcessName,
          prev_pm.process                      AS processId,
          prev_p.name                          AS processName,
          prev_pm.processPriority              AS processPriority,
          prev_pm.count                        AS count,
          ppm.rate                             AS rate,
          ROUND(
            CAST(prev_pm.count AS DECIMAL(10,2)) * ppm.rate,
          2) AS cost
        FROM (
          SELECT DISTINCT itemId, processId
          FROM assembly_qlty_inspeclist_mst
          WHERE status = 'scrap'
            AND DATE(created_at) = ?
        ) d
        INNER JOIN item_vs_pm cur_pm
          ON cur_pm.item = d.itemId
          AND cur_pm.process = d.processId
        INNER JOIN item_vs_pm prev_pm
          ON prev_pm.item = d.itemId
          AND prev_pm.processPriority <= cur_pm.processPriority
        INNER JOIN pm_price_map ppm
          ON ppm.id = prev_pm.priceRange
        INNER JOIN items i
          ON i.id = d.itemId
        LEFT JOIN material_copq_mst mat
          ON mat.material = i.material
        LEFT JOIN mst_pm p
          ON p.id = d.processId
        LEFT JOIN mst_pm prev_p
          ON prev_p.id = prev_pm.process
        ORDER BY d.itemId, prev_pm.processPriority
      `;

      const finalMaterialSql = `
        SELECT
          d.itemId,
          i.itemName,
          i.itemCode,
          i.netWeight,
          mat.rate                             AS materialRate,
          ROUND(COALESCE(i.netWeight,0) * COALESCE(mat.rate,0), 2) AS materialCost
        FROM (
          SELECT DISTINCT itemId
          FROM assembly_qlty_inspeclist_mst
          WHERE status = 'scrap'
            AND DATE(created_at) = ?
        ) d
        INNER JOIN items i ON i.id = d.itemId
        LEFT JOIN material_copq_mst mat ON mat.material = i.material
      `;

      const finalScrapInfoSql = `
        SELECT DISTINCT
          s.itemId,
          s.processId   AS scrapProcessId,
          p.name        AS scrapProcessName
        FROM assembly_qlty_inspeclist_mst s
        LEFT JOIN mst_pm p
          ON p.id = s.processId
        WHERE s.status = 'scrap'
          AND DATE(s.created_at) = ?
      `;

      const [finalData]        = await connection.execute(finalSql,         [targetDate]);
      const [finalMaterialData] = await connection.execute(finalMaterialSql, [targetDate]);
      const [finalScrapInfo]    = await connection.execute(finalScrapInfoSql, [targetDate]);

      // Build scrapInfoMap keyed by itemId
      const scrapInfoMap = {};
      finalScrapInfo.forEach(r => {
        scrapInfoMap[String(r.itemId)] = {
          scrapProcessId:   r.scrapProcessId,
          scrapProcessName: r.scrapProcessName,
        };
      });

      // Build materialMap keyed by itemId
      const materialMap = {};
      finalMaterialData.forEach(r => {
        materialMap[String(r.itemId)] = {
          materialCost: Number(r.materialCost || 0),
          itemName:     r.itemName,
          itemCode:     r.itemCode,
          netWeight:    r.netWeight,
          materialRate: r.materialRate,
        };
      });

      // Group by itemId
      const itemMap = {};

      finalData.forEach(r => {
        const key = String(r.itemId);

        if (!itemMap[key]) {
          itemMap[key] = {
            itemId:           r.itemId,
            itemName:         r.itemName,
            itemCode:         r.itemCode,
            scrapProcessId:   r.scrapProcessId,
            scrapProcessName: r.scrapProcessName,
            netWeight:        r.netWeight    || 0,
            materialRate:     r.materialRate || 0,
            materialCost:     round2(Number(r.materialCost || 0)),
            processCost:      0,
            processes:        [],
            totalCost:        0,
          };
        }

        const cost = Number(r.cost || 0);
        itemMap[key].processCost = round2(itemMap[key].processCost + cost);

        itemMap[key].processes.push({
          processId:   r.processId,
          processName: r.processName,
          count:       r.count,
          rate:        r.rate,
          cost:        round2(cost),
        });
      });

      // totalCost = processCost + materialCost
      Object.values(itemMap).forEach(item => {
        item.totalCost = round2(item.processCost + item.materialCost);
      });

      rows = Object.values(itemMap);

      // Orphan items — materialCost only, no item_vs_pm entry
      const coveredItemIds = new Set(Object.keys(itemMap));

      finalMaterialData.forEach(r => {
        const matCost = Number(r.materialCost || 0);
        if (!coveredItemIds.has(String(r.itemId)) && matCost > 0) {
          const scrapInfo = scrapInfoMap[String(r.itemId)] || {};

          rows.push({
            itemId:           r.itemId,
            itemName:         r.itemName,
            itemCode:         r.itemCode,
            scrapProcessId:   scrapInfo.scrapProcessId   ?? null,
            scrapProcessName: scrapInfo.scrapProcessName ?? null,
            netWeight:        r.netWeight    || 0,
            materialRate:     r.materialRate || 0,
            materialCost:     round2(matCost),
            processCost:      0,
            processes:        [],
            totalCost:        round2(matCost),
          });
        }
      });
    }

    /* ============================================================
       INPROCESS COST
    ============================================================ */
    else if (description === "inprocess") {

      // const inprocessSql = `
      //   SELECT
      //     d.itemId,
      //     i.itemName,
      //     i.itemCode,
      //     d.processId                          AS scrapProcessId,
      //     p.name                               AS scrapProcessName,
      //     prev_pm.process                      AS processId,
      //     prev_p.name                          AS processName,
      //     prev_pm.processPriority              AS processPriority,
      //     prev_pm.count                        AS count,
      //     ppm.rate                             AS rate,
      //     vs.rejRewQty                         AS rejRewQty,
      //     ROUND(
      //       CAST(
      //         CASE
      //           WHEN prev_pm.processPriority = cur_pm.processPriority
      //           THEN COALESCE(vs.scrap_count, cur_pm.count)
      //           ELSE prev_pm.count
      //         END
      //       AS DECIMAL(10,2)) * ppm.rate
      //       * CASE
      //           WHEN prev_pm.processPriority = cur_pm.processPriority
      //           THEN COALESCE(vs.rejRewQty, 1)
      //           ELSE 1
      //         END,
      //     2) AS cost
      //   FROM (
      //     SELECT DISTINCT DATE(created_at) AS day, itemId, processId
      //     FROM vw_pm_inspeclist_scrap
      //     WHERE status = 'scrap'
      //       AND created_at >= ?
      //       AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
      //   ) d
      //   LEFT JOIN (
      //     SELECT day, itemId, processId,
      //           count          AS scrap_count,
      //           SUM(rejRewQty) AS rejRewQty
      //     FROM (
      //       SELECT DISTINCT
      //         DATE(created_at) AS day,
      //         itemId,
      //         processId,
      //         qTestNo,
      //         jcId,
      //         rejRewQty,
      //         count
      //       FROM vw_pm_inspeclist_scrap
      //       WHERE status = 'scrap'
      //     ) deduped
      //     GROUP BY day, itemId, processId
      //   ) vs
      //     ON vs.day = d.day
      //     AND vs.itemId = d.itemId
      //     AND vs.processId = d.processId
      //   INNER JOIN item_vs_pm cur_pm
      //     ON cur_pm.item = d.itemId
      //     AND cur_pm.process = d.processId
      //   INNER JOIN item_vs_pm prev_pm
      //     ON prev_pm.item = d.itemId
      //     AND prev_pm.processPriority <= cur_pm.processPriority
      //   INNER JOIN pm_price_map ppm
      //     ON ppm.id = prev_pm.priceRange
      //   INNER JOIN items i
      //     ON i.id = d.itemId
      //   LEFT JOIN mst_pm p
      //     ON p.id = d.processId
      //   LEFT JOIN mst_pm prev_p
      //     ON prev_p.id = prev_pm.process
      //   ORDER BY d.itemId, prev_pm.processPriority
      // `;


        const inprocessSql = `
        SELECT
          d.itemId,
          i.itemName,
          i.itemCode,
          d.processId                          AS scrapProcessId,
          p.name                               AS scrapProcessName,
          prev_pm.process                      AS processId,
          prev_p.name                          AS processName,
          prev_pm.processPriority              AS processPriority,
          prev_pm.count                        AS count,
          ppm.rate                             AS rate,
          vs.rejRewQty                         AS rejRewQty,
          ROUND(
            CAST(
              CASE
                WHEN prev_pm.processPriority = cur_pm.processPriority
                THEN COALESCE(vs.scrap_count, cur_pm.count)
                ELSE prev_pm.count
              END
            AS DECIMAL(10,2)) * ppm.rate
            * CASE
                WHEN prev_pm.processPriority = cur_pm.processPriority
                THEN COALESCE(vs.rejRewQty, 1)
                ELSE 1
              END,
          2) AS cost
        FROM (
          SELECT DISTINCT DATE(created_at) AS day, itemId, processId
          FROM vw_pm_inspeclist_scrap
          WHERE status = 'scrap'
            AND created_at >= ?
            AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
        ) d
        LEFT JOIN (
          SELECT day, itemId, processId,
                count          AS scrap_count,
                SUM(rejRewQty) AS rejRewQty
          FROM (
            SELECT DISTINCT
              DATE(created_at) AS day,
              itemId,
              processId,
              qTestNo,
              jcId,
              rejRewQty,
              count
            FROM vw_pm_inspeclist_scrap
            WHERE status = 'scrap'
          ) deduped
          GROUP BY day, itemId, processId
        ) vs
          ON vs.day = d.day
          AND vs.itemId = d.itemId
          AND vs.processId = d.processId
        INNER JOIN (
          SELECT item, process, processPriority, priceRange, count
          FROM item_vs_pm
          WHERE dflag = 0
          GROUP BY item, process, processPriority, priceRange, count
        ) cur_pm
          ON cur_pm.item = d.itemId
          AND cur_pm.process = d.processId
        INNER JOIN (
          SELECT item, process, processPriority, priceRange, count
          FROM item_vs_pm
          WHERE dflag = 0
          GROUP BY item, process, processPriority, priceRange, count
        ) prev_pm
          ON prev_pm.item = d.itemId
          AND prev_pm.processPriority <= cur_pm.processPriority
        INNER JOIN pm_price_map ppm
          ON ppm.id = prev_pm.priceRange
        INNER JOIN items i
          ON i.id = d.itemId
        LEFT JOIN mst_pm p
          ON p.id = d.processId
        LEFT JOIN mst_pm prev_p
          ON prev_p.id = prev_pm.process
        ORDER BY d.itemId, prev_pm.processPriority
        `;
      const materialSql = `
        SELECT
          d.itemId,
          i.itemName,
          i.itemCode,
          i.netWeight,
          mat.rate                             AS materialRate,
          ROUND(
            COALESCE(i.netWeight, 0) * COALESCE(mat.rate, 0)
            * COALESCE(rq.rejRewQty, 1),
          2) AS materialCost
        FROM (
          SELECT DISTINCT itemId
          FROM vw_pm_inspeclist_scrap
          WHERE status = 'scrap'
            AND created_at >= ?
            AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
        ) d
        LEFT JOIN (
          SELECT itemId, SUM(rejRewQty) AS rejRewQty
          FROM (
            SELECT DISTINCT
              itemId,
              qTestNo,
              jcId,
              rejRewQty
            FROM vw_pm_inspeclist_scrap
            WHERE status = 'scrap'
              AND created_at >= ?
              AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
          ) deduped
          GROUP BY itemId
        ) rq ON rq.itemId = d.itemId
        INNER JOIN items i ON i.id = d.itemId
        LEFT JOIN material_copq_mst mat ON mat.material = i.material
      `;

      const scrapInfoSql = `
        SELECT DISTINCT
          s.itemId,
          s.processId   AS scrapProcessId,
          p.name        AS scrapProcessName
        FROM vw_pm_inspeclist_scrap s
        LEFT JOIN mst_pm p
          ON p.id = s.processId
        WHERE s.status = 'scrap'
          AND s.created_at >= ?
          AND s.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      `;

      const [inprocessData] = await connection.execute(inprocessSql, [targetDate, targetDate]);
      const [materialData]  = await connection.execute(materialSql,  [targetDate, targetDate, targetDate, targetDate]); // ← 4 params
      const [scrapInfoData] = await connection.execute(scrapInfoSql, [targetDate, targetDate]);

      // Build scrapInfoMap keyed by itemId
      const scrapInfoMap = {};
      scrapInfoData.forEach(r => {
        scrapInfoMap[String(r.itemId)] = {
          scrapProcessId:   r.scrapProcessId,
          scrapProcessName: r.scrapProcessName,
        };
      });

      // Build materialMap keyed by itemId
      const materialMap = {};
      materialData.forEach(r => {
        materialMap[String(r.itemId)] = {
          materialCost: Number(r.materialCost || 0),
          itemName:     r.itemName,
          itemCode:     r.itemCode,
          netWeight:    r.netWeight,
          materialRate: r.materialRate,
        };
      });

      // Group by itemId
      const itemMap = {};

      inprocessData.forEach(r => {
        const key = String(r.itemId);

        if (!itemMap[key]) {
          const matInfo = materialMap[key] || {};
          const matCost = matInfo.materialCost || 0;

          itemMap[key] = {
            itemId:           r.itemId,
            itemName:         r.itemName,
            itemCode:         r.itemCode,
            scrapProcessId:   r.scrapProcessId,
            scrapProcessName: r.scrapProcessName,
            rejRewQty:        r.rejRewQty ?? null,
            netWeight:        matInfo.netWeight    || 0,
            materialRate:     matInfo.materialRate || 0,
            materialCost:     round2(matCost),       // already multiplied by rejRewQty in SQL
            processCost:      0,
            processes:        [],
            totalCost:        0,
          };
        }

        const cost = Number(r.cost || 0);
        itemMap[key].processCost = round2(itemMap[key].processCost + cost);

        itemMap[key].processes.push({
          processId:   r.processId,
          processName: r.processName,
          count:       r.count,
          rate:        r.rate,
          cost:        round2(cost),
        });
      });

      // totalCost = processCost + materialCost
      Object.values(itemMap).forEach(item => {
        item.totalCost = round2(item.processCost + item.materialCost);
      });

      rows = Object.values(itemMap);

      // Orphan items — materialCost only, no item_vs_pm entry
      const coveredItemIds = new Set(Object.keys(itemMap));

      materialData.forEach(r => {
        const matCost = Number(r.materialCost || 0);
        if (!coveredItemIds.has(String(r.itemId)) && matCost > 0) {
          const scrapInfo = scrapInfoMap[String(r.itemId)] || {};

          rows.push({
            itemId:           r.itemId,
            itemName:         r.itemName,
            itemCode:         r.itemCode,
            scrapProcessId:   scrapInfo.scrapProcessId   ?? null,
            scrapProcessName: scrapInfo.scrapProcessName ?? null,
            rejRewQty:        null,
            netWeight:        r.netWeight    || 0,
            materialRate:     r.materialRate || 0,
            materialCost:     round2(matCost),   // already multiplied by rejRewQty in SQL
            processCost:      0,
            processes:        [],
            totalCost:        round2(matCost),
          });
        }
      });
    }

    /* ============================================================
       REWORK COST
    ============================================================ */
    else if (description === "reworkCost") {

      const sql = `
        SELECT
          rw.itemId,
          i.itemName,
          i.itemCode,
          rm.user, 
          rm.rate, 
          p.name AS scrapProcessName,
          rw.totCost AS totalCost
        FROM rework_rate_costs rw
        INNER JOIN rework_rate_mst rm
          ON rm.id = rw.rework_rate_mst_id
        INNER JOIN items i
          ON i.id = rw.itemId
        LEFT JOIN mst_pm p
          ON p.id = rw.processId
        WHERE DATE(rw.created_at) = ?
      `;

      const [data] = await connection.execute(sql, [targetDate]);
      rows = data;
    }

    /* ============================================================
       OTHER DESCRIPTION COST
    ============================================================ */
    else {

      const sql = `
        SELECT
          m.description,
          c.cost AS totalCost
        FROM copy_desc_costs_log c
        INNER JOIN copy_desc_mst m
          ON m.id = c.descId
        WHERE DATE(c.date) = ?
          AND m.description = ?
      `;

      const [data] = await connection.execute(sql, [targetDate, description]);
      rows = data;
    }

    /* ============================================================
       ADD TOTAL ROW — only for final and inprocess
    ============================================================ */
    if (description === "final" || description === "inprocess") {

      const totalProcessCost = round2(
        rows.reduce((s, r) => s + Number(r.processCost || 0), 0)
      );

      const totalMaterialCost = round2(
        rows.reduce((s, r) => s + Number(r.materialCost || 0), 0)
      );

      const totalCost = round2(totalProcessCost + totalMaterialCost);

      rows.push({
        itemCode:     "TOTAL",
        processCost:  totalProcessCost,
        materialCost: totalMaterialCost,
        totalCost
      });

    } else {

      const totalCost = round2(
        rows.reduce((s, r) => s + Number(r.totalCost || 0), 0)
      );

      rows.push({
        itemCode:  "TOTAL",
        totalCost
      });
    }

    return handleSuccessResponse(res, "COPQ Drill-Down Detail", {
      day,
      description,
      records: rows
    });

  } catch (err) {
    return handleErrorResponse(res, err);
  }
};


/********************************************************************     COPQ DESCRIPTION MASTER      ***************************************************************************************/




exports.storeDesc = async (req, res) => {
  const conn = await connection.getConnection(); // ensure you have connection pool/instance

  try {
    const qc = req.body;
    const { description } = qc;
    const user = await getUser(req);

    const storeQuery = `
      INSERT INTO copy_desc_mst (description,  addedBy)
      VALUES (?, ?)
    `;

    await conn.execute(storeQuery, [description, user]);

    return handleSuccessResponse(res, "Data added successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release(); // release connection if using pool
  }
};

exports.updateDesc = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;
    const { description } = req.body;
    const user = await getUser(req);

    if (!id) {
      return handleErrorResponse(res, "Missing record ID");
    }

    const updateQc = `
      UPDATE copy_desc_mst
        SET description = ?, updatedBy = ?
      WHERE id = ?
    `;

    const updateValues = [description, user, id];
    const [result] = await conn.execute(updateQc, updateValues);

    if (result.affectedRows === 0) {
      return handleErrorResponse(res, "No record found to update");
    }

    return handleSuccessResponse(res, "Data updated successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};




exports.showDesc = async (req, res) => {
  try {
    const [rows] = await connection.execute(`
      SELECT 
        copq.id, copq.description
      FROM  
        copy_desc_mst copq
      `, []
    );

    return handleSuccessResponse(res, 'Copq lists', rows);
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}





exports.storeDescLog = async (req, res) => {
  const conn = await connection.getConnection(); // ensure you have connection pool/instance

  try {
    const qc = req.body;
    const { descId, date, cost } = qc;
    const user = await getUser(req);

    const storeQuery = `
      INSERT INTO copy_desc_costs_log (descId, date, cost, addedBy)
      VALUES (?, ?, ?, ?)
    `;

    await conn.execute(storeQuery, [descId, date, cost, user]);

    return handleSuccessResponse(res, "Data added successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release(); // release connection if using pool
  }
};

exports.updateDescLog = async (req, res) => {
  const conn = await connection.getConnection();

  try {
    const id = req.params.id;
    const { descId, date, cost } = req.body;
    const user = await getUser(req);

    if (!id) {
      return handleErrorResponse(res, "Missing record ID");
    }

    const updateQc = `
      UPDATE copy_desc_costs_log
        SET descId  = ?, date = ?, cost = ?, updatedBy = ?
      WHERE id = ?
    `;

    const updateValues = [descId, date, cost, user, id];
    const [result] = await conn.execute(updateQc, updateValues);

    if (result.affectedRows === 0) {
      return handleErrorResponse(res, "No record found to update");
    }

    return handleSuccessResponse(res, "Data updated successfully");
  } catch (err) {
    return handleErrorResponse(res, err);
  } finally {
    if (conn) conn.release();
  }
};




exports.showDescLog = async (req, res) => {
  try {
    const [rows] = await connection.execute(`
       SELECT 
        copq.id, mst.description, mst.id AS descId, copq.cost, date,  DATE_FORMAT(copq.date, '%d-%m-%Y') AS showDate
      FROM 
        copy_desc_costs_log copq
      INNER JOIN 
        copy_desc_mst mst ON mst.id = copq.descId
      `,
    );
    const result = rows.map((row, index) => ({
      slNo: index + 1,
      ...row
    }));

    return handleSuccessResponse(res, 'Copq lists', result);
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}




exports.deleteDescLog = async (req, res) => {
  try {
    const id = req.params.id;

    await connection.execute(`DELETE FROM copy_desc_costs_log WHERE id = ?`, [id]);

    return handleSuccessResponse(res, 'Deleted successfully');
  } catch (err) {
    return handleErrorResponse(res, err);
  }
}

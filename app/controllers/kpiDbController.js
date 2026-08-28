const { getFyMonthRangeCached } = require("../../cache/fyRange.cache");
const { handleErrorResponse, connection, CustomError, handleSuccessResponse } = require("../config/dbSql");
const { getTargetMap, KPI_KEYS, invalidateTargetCache } = require("../utility/kpiTargetUtil");

exports.dashboard = async (req, res) => {
    try {
        const month =
            req.query.month ||
            `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;

        const [[monthlyRows], targetMap, [dailyRows]] = await Promise.all([
            connection.execute(
                `
                SELECT
                    month, updated_at,
                    jc_pct, pm_pct, power_pct,
                    dg_unit_per_litre, bd_avg_hrs,
                    mttr_hrs, mtbf_hrs,
                    inw_ppm, prod_rej_ppm, prod_rew_ppm,
                    assembly_rej_ppm, fpi_per, yield_per,
                    po_cost_rate, fc_per, po_per,
                    inv_lvl_per, inv_turn, stk_age_45, discrp_per,
                    cancl_inv_per, pend_so_per, credit_note, pend_cust_dc_per,
                    pvp_pct, cap_pct, oee_pct,
                    tool_pm_pct, tool_maint_pct, tool_bd_avg_hrs, tool_mtbf_hrs, tool_mttr_hrs
                FROM kpi_monthly_summary
                WHERE month = ?
                `,
                [month]
            ),

            getTargetMap(connection),

            connection.execute(
                `
                SELECT
                    pvp_pct, cap_pct, oee_pct, mac_eff, vech_otd, vech_time
                FROM kpi_daily_summary
                ORDER BY kpi_date DESC
                LIMIT 1
                `
            )
        ]);

        const monthly = monthlyRows[0];
        const daily = dailyRows[0] || null;

        if (!monthly) {
            return res.status(404).json({
                success: false,
                message: "Monthly KPI data not found"
            });
        }

        const metric = (value, code) => ({
            value,
            target: targetMap[code]?.value ?? null,
            unit: targetMap[code]?.unit ?? null,
            cs: targetMap[code]?.cs ?? null
        });

        return res.json({
            success: true,
            data: {
                meta: {
                    month,
                    lastUpdated: monthly.updated_at
                },

                planning: {
                    jobCard: metric(monthly.jc_pct, "JC_PCT")
                },

                maintenance: {
                    preventiveMaintenance: metric(monthly.pm_pct, "PM_PCT"),
                    powerConsumption: metric(monthly.power_pct, "POWER_PCT"),
                    dieselGenerator: metric(monthly.dg_unit_per_litre, "DG_UNIT_PER_LTR"),
                    breakdown: metric(monthly.bd_avg_hrs, "BD_AVG_HRS"),
                    mttr: metric(monthly.mttr_hrs, "MTTR_HRS"),
                    mtbf: metric(monthly.mtbf_hrs, "MTBF_HRS")
                },

                quality: {
                    inwardPPM: metric(monthly.inw_ppm, "INWARD_PPM"),
                    inprocessRejPPM: metric(monthly.prod_rej_ppm, "INPROCESS_REJ_PPM"),
                    inprocessRewPPM: metric(monthly.prod_rew_ppm, "INPROCESS_REW_PPM"),
                    finalPPM: metric(monthly.assembly_rej_ppm, "FINAL_PPM"),
                    fpIPercentage: metric(monthly.fpi_per, "FPI_PER"),
                    yieldPercentage: metric(monthly.yield_per, "YIELD_PER")
                },

                purchase: {
                    purchaseCost: metric(monthly.po_cost_rate, "PURCHASE_COST"),
                    forecastAccuracy: metric(monthly.fc_per, "FC_ACC"),
                    poAccuracy: metric(monthly.po_per, "PO_ACC")
                },

                store: {
                    inventoryLevel: metric(monthly.inv_lvl_per, "INV_LVL_PER"),
                    inventoryTurns: metric(monthly.inv_turn, "INV_TURNS"),
                    inventoryStockAge: metric(monthly.stk_age_45, "INV_STK_AGE"),
                    inwardDiscrepancy: metric(monthly.discrp_per, "INWARD_DISCRP")
                },

                account: {
                    cancelledInvoice: metric(monthly.cancl_inv_per, "CANCEL_INV"),
                    pendingPo: metric(monthly.pend_so_per, "PENDING_PO"),
                    creditNote: metric(monthly.credit_note, "CREDIT_NOTE"),
                    customerDc: metric(monthly.pend_cust_dc_per, "CUST_DC")
                },

                production: {
                    planVsProd: metric(daily.pvp_pct, "PLAN_VS_PROD"),
                    capacityUtilization: metric(daily.cap_pct, "CAP_UTIL"),
                    oee: metric(daily.oee_pct, "OEE"),
                    machineEfficiency: metric(daily.mac_eff, "MC_EFF")
                },

                dispatch: {
                    dailyOtd: metric(daily.vech_otd, "OTD_TARGET"),
                    timeAnalysis: metric(daily.vech_time, "VEHICLE_TARGET")
                },

                tool: {
                    preventiveMaintenance: metric(monthly.tool_pm_pct, "TOOL_PM_PCT"),
                    maintenanceCost: metric(monthly.tool_maint_pct, "TOOL_MAINT_PCT"),
                    breakdown: metric(monthly.tool_bd_avg_hrs, "TOOL_BD_AVG_HRS"),
                    mtbf: metric(monthly.tool_mtbf_hrs, "TOOL_MTBF_HRS"),
                    // mttr: metric(monthly.tool_mttr_hrs, "TOOL_MTTR_HRS")
                }
            }
        });

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.monthlyKpiReport = async (req, res) => {
    try {
        const { fyfrom, fyto } = req.headers;
        const month = Number(req.query.month);
        const kpiMetric = req.query.kpi || "Production";

        if (!month || month < 1 || month > 12) {
            throw new CustomError("Invalid month");
        }

        if (!KPI_KEYS[kpiMetric]) {
            throw new CustomError("Invalid KPI metric");
        }
        const { start, end } = getFyMonthRangeCached(fyfrom, fyto, month);

        const kpiConfigs = await getTargetMap(connection);

        const config = [];
        const columns = [];

        for (const key of KPI_KEYS[kpiMetric]) {
            if (!kpiConfigs[key]) continue;
            config.push(kpiConfigs[key]);
            columns.push(kpiConfigs[key].key);
        }

        if (columns.length === 0) {
            throw new CustomError("No KPI columns found");
        }

        const [rows] = await connection.execute(
            `
            SELECT 
                DATE_FORMAT(kpi_date, '%d') AS kpi_day,
                ${columns.join(", ")}
            FROM kpi_daily_summary
            WHERE kpi_date >= ?
              AND kpi_date < DATE_ADD(?, INTERVAL 1 DAY)
            ORDER BY kpi_date ASC
            `,
            [start, end]
        );

        return res.json({
            success: true,
            config,
            data: rows
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.updateKpiTarget = async (req, res) => {
    try {
        const { kpiCode, targetValue, colorScheme } = req.body;

        if (!kpiCode || targetValue == null || !colorScheme) {
            throw new CustomError("kpiCode, targetValue, and colorScheme are required");
        }

        const [result] = await connection.execute(
            `
            UPDATE kpi_targets
            SET target_value = ?, color_scheme = ?
            WHERE kpi_code = ?
            `,
            [targetValue, colorScheme, kpiCode]
        );

        if (result.affectedRows === 0) {
            throw new CustomError("KPI code not found");
        }
        invalidateTargetCache();

        return handleSuccessResponse(res, "KPI target updated successfully");
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.kpiMetricReport = async (req, res) => {
    try {
        const { fyfrom, fyto } = req.headers;
        const month = Number(req.query.month);
        const { kpiCode, kpiKey } = req.query;

        if (!month || month < 1 || month > 12) {
            throw new CustomError("Invalid month");
        }

        const { start, end } = getFyMonthRangeCached(fyfrom, fyto, month);

        const kpiConfigs = await getTargetMap(connection);
        const kpiColumns = [kpiKey];

        if (kpiConfigs[kpiCode]?.kpiCol) {
            const subKeys = kpiConfigs[kpiCode].kpiCol.split(',').map(k => k.trim());
            kpiColumns.push(...subKeys);
        }

        const [rows] = await connection.execute(`
            SELECT 
                DATE_FORMAT(kpi_date, '%d') AS kpi_day,
                ${kpiColumns.join(", ")}
            FROM kpi_daily_summary
            WHERE kpi_date >= ?
              AND kpi_date < DATE_ADD(?, INTERVAL 1 DAY)
            ORDER BY kpi_date ASC
            `,
            [start, end]
        );

        // kpiConfigs[kpiCode]['subKeys'] = [
        //     {
        //         "key": "jc_plan",
        //         "label": "Planned JC"
        //     },
        //     {
        //         "key": "jc_comp",
        //         "label": "Completed JC"
        //     }
        // ],
        // kpiConfigs[kpiCode]['formula'] = "(Completed JC / Planned JC) * 100" 

        return res.json({
            success: true,
            config: kpiConfigs[kpiCode] || null,
            data: rows
        });
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

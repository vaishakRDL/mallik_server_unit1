let targetCache = null;
let lastLoadedAt = null;
const TTL_MS = 60 * 60 * 8000; // 1 hour

exports.getTargetMap = async (connection) => {
    const now = Date.now();

    if (targetCache && (now - lastLoadedAt) < TTL_MS) {
        return targetCache; // cache hit
    }

    const [rows] = await connection.execute(
        `SELECT kpi_code, label, kpiKey, target_value, unit, color_scheme, kpiCol, subKeys, formula FROM kpi_targets`
    );

    targetCache = rows.reduce((acc, t) => {

        let parsedSubKeys = [];

        if (t.subKeys) {
            parsedSubKeys = typeof t.subKeys === "string"
                ? JSON.parse(t.subKeys)
                : t.subKeys;
        }

        acc[t.kpi_code] = {
            kpi_code: t.kpi_code,
            label: t.label,
            key: t.kpiKey,
            value: t.target_value,
            unit: t.unit,
            cs: t.color_scheme,
            kpiCol: t.kpiCol,
            subKeys: parsedSubKeys,
            formula: t.formula
        };

        return acc;

    }, {});

    lastLoadedAt = now;
    return targetCache;
};

exports.invalidateTargetCache = () => {
    targetCache = null;
    lastLoadedAt = null;
};

// KPI Keys mapping (tb kpi_targets)
exports.KPI_KEYS = {
    Production: ['PLAN_VS_PROD', 'CAP_UTIL', 'OEE', 'IDLE_TIME', 'PAINT_SLUDGE', 'RM_SCRAP', 'WELD_WIRE', 'MC_EFF', 'MP_EFF'],
    Maintenance: ['PM_PCT', 'POWER_PCT', 'BD_AVG_HRS', 'MTBF_HRS', 'MTTR_HRS', 'DG_UNIT_PER_LTR'],
    Planning: ['JC_PCT'],
    Dispatch: ['OTD_TARGET', 'VEHICLE_TARGET'],
    Quality: ['INWARD_PPM', 'INPROCESS_REJ_PPM', 'INPROCESS_REW_PPM', 'FINAL_PPM', 'FPI_PER', 'YIELD_PER'],
    Purchase: ['PURCHASE_COST', 'FC_ACC', 'PO_ACC'],
    Store: ['INV_LVL_PER', 'INV_TURNS', 'INV_STK_AGE', 'INWARD_DISCRP'],
    Accounts: ['CANCEL_INV', 'PENDING_PO', 'CREDIT_NOTE', 'CUST_DC'],
    Tool: ['TOOL_PM_PCT', 'TOOL_MAINT_PCT', 'TOOL_BD_AVG_HRS', 'TOOL_MTBF_HRS', 'TOOL_MTTR_HRS'],
}
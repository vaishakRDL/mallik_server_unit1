const router = require("express").Router();
const { handleErrorResponse } = require("../config/dbSql");
const validateToken = require("../config/validateToken");

module.exports = (app) => {
    // Block TRACE and TRACK for security
    app.use((req, res, next) => {
        if (req.method === "TRACE" || req.method === "TRACK") {
            return res.status(405).send("Method Not Allowed");
        }
        next();
    });

    // Token validation
    // app.use((req, res, next) => {
    //     if (!["/", "/api/login"].includes(req.path)) {
    //         return validateToken(req, res, next);
    //     }
    //     next();
    // });

    /* ------------------------------ ROUTE GROUPS ------------------------------ */

    // Auth
    router.use("/", require("../routes/authApi"));

    // Master-Planning-Store
    router.use("/user", require("../routes/userApi"));
    router.use("/master", require("../routes/masterApi"));
    router.use("/supplier", require("../routes/supplierApi"));
    router.use("/multiAddress", require("../routes/multiAddApi"));
    router.use("/contactPerson", require("../routes/suppConPrsnApi"));
    router.use("/itemMaster", require("../routes/itemMstApi"));
    router.use("/item", require("../routes/itemApi"));
    router.use("/machineOperator", require("../routes/machineOperatorApi"));
    router.use("/bom", require("../routes/bomApi"));
    router.use("/csl", require("../routes/cslApi"));
    router.use("/sob", require("../routes/sobApi"));
    router.use("/sale", require("../routes/salesApi"));
    router.use("/mrp", require("../routes/mrpApi"));
    router.use("/order", require("../routes/orderPlnAPi"));
    router.use("/allocation", require("../routes/allocateApi"));
    router.use("/boi", require("../routes/boiApi"));
    router.use("/materialIssue", require("../routes/matIssueApi"));
    router.use("/planning", require("../routes/planningApi"));
    router.use("/gantt-chart", require("../routes/ganttChartApi"));
    router.use("/sfgVerification", require("../routes/sfgVerificationApi"));
    router.use("/delSchedule", require("../routes/delScheduleApi"));
    router.use("/jobCard", require("../routes/jcApi"));
    router.use("/jobWork-issue", require("../routes/jobWorkIssueApi"));
    router.use("/grn", require("../routes/grnApi"));
    router.use("/srn", require("../routes/srnApi"));
    router.use("/npdPlan", require("../routes/npdPlanApi"));
    router.use("/pcn", require("../routes/pcnApi"));
    router.use("/docs", require("../routes/docApi"));
    router.use("/so-verification", require("../routes/soApi"));
    router.use("/jobWork-reciept", require("../routes/jobWorkRecieptApi"));
    router.use("/schedule", require("../routes/scheduleApi"));
    router.use("/prodReport", require("../routes/prodApi"));
    router.use("/srnShortClose", require("../routes/srnShortCloseApi"));
    router.use("/orderStatus", require("../routes/orderStatusApi"));
    router.use("/module", require("../routes/moduleLockApi"));
    router.use("/hmi", require("../routes/hmiApi"));
    router.use("/revisedPlan", require("../routes/revisedPlanApi"));
    router.use("/dashboard", require("../routes/kpiDashboardApi"));
    router.use("/bulkUpdate", require("../routes/bulkUpdate.routes"));

    // Puneeth
    router.use("/pmVsUom", require("../routes/pmVsUomApi"));
    router.use("/machine", require("../routes/machineApi"));
    router.use("/shiftMaster", require("../routes/shiftMstApi"));
    router.use("/itemVsPm", require("../routes/itemVsPmApi"));
    router.use("/report", require("../routes/reportApi"));
    router.use("/approval", require("../routes/approvalApi"));
    router.use("/menuTypeMst", require("../routes/menuTypeMstApi"));
    router.use("/groupMst", require("../routes/groupMstApi"));
    router.use("/groupRight", require("../routes/groupRightsApi"));
    router.use("/holiday", require("../routes/holidayMstApi"));
    router.use("/npd", require("../routes/npdApi"));
    router.use("/npdFileType", require("../routes/fileTypeMstApi"));
    router.use("/dispatch", require("../routes/dispatchApi"));
    router.use("/scrapMst", require("../routes/scrapMstApi"));
    router.use("/boxKit", require("../routes/boxKitApi"));
    router.use("/info", require("../routes/infoApi"));
    router.use("/supervisorJc", require("../routes/supervisorJcApi"));
    router.use("/mrn", require("../routes/mrnApi"));
    router.use("/storeRepo", require("../routes/storeRepoApi"));
    router.use("/stockTransfer", require("../routes/stockTransfer"));
    router.use("/dispatchDashboard", require("../routes/dispatchDashApi"));
    router.use("/dashboardRemarks", require("../routes/remarksApi"));

    // Purchase
    router.use("/suppVsItem", require("../routes/suppVsItemApi"));
    router.use("/poGenerate", require("../routes/poGenerateApi"));
    router.use("/poBill", require("../routes/poBillApi"));
    router.use("/poBillWithOutPo", require("../routes/poBillWithoutPoApi"));
    router.use("/poFC", require("../routes/poForeCastApi"));

    // Quality
    router.use("/qltyTemp", require("../routes/qltyTempApi"));
    router.use("/itmPmVsInspec", require("../routes/itmPmVsInspectionApi"));
    router.use("/processInspec", require("../routes/qltyPmInspecApi"));
    router.use("/qltyReason", require("../routes/qltyReasonApi"));
    router.use("/qltyAssembly", require("../routes/qltyAssemblyApi"));
    router.use("/qltyItems", require("../routes/qltyItemsApi"));
    router.use("/inwardQc", require("../routes/inwardQcApi"));
    router.use("/spcQc", require("../routes/spcQcRoute"));
    router.use("/qcMst", require("../routes/qcMasterApi"));

    // Accounts
    router.use("/customer", require("../routes/customerApi"));
    router.use("/multiAddressCustomer", require("../routes/multiAddresscustomerApi"));
    router.use("/contactPersonCustomer", require("../routes/customerPerson"));
    router.use("/purchase", require("../routes/purchaseOrdApi"));
    router.use("/gstInvoice", require("../routes/gstInvoiceApi"));
    router.use("/transporter", require("../routes/transportApi"));
    router.use("/customerdc", require("../routes/CustomerDcApi"));
    router.use("/noCustomerdc", require("../routes/nonReturnDcApi"));
    router.use("/custVsItem", require("../routes/custVsItemApi"));
    router.use("/creditNote", require("../routes/creditNoteApi"));
    router.use("/perfomaInv", require("../routes/perfomaInvApi"));
    router.use("/fgitem", require("../routes/fgitemApi"));
    router.use("/shortClose", require("../routes/shortCloseApi"));
    router.use("/accountRepo", require("../routes/accountRepoApi"));

    // Excel
    router.use("/excel", require("../routes/excelRoutes/exlApi"));
    router.use("/supExcel", require("../routes/excelRoutes/supExcelApi"));
    router.use("/cslExl", require("../routes/excelRoutes/cslExlApi"));
    router.use("/sobExl", require("../routes/excelRoutes/sobExlApi"));
    router.use("/suppVsItmExl", require("../routes/excelRoutes/suppVsItmExlApi"));
    router.use("/itmVsPmExl", require("../routes/excelRoutes/itmVsPmExlApi"));
    router.use("/npdExl", require("../routes/excelRoutes/npdExlApi"));
    router.use("/qltyExl", require("../routes/excelRoutes/qltyExlApi"));
    router.use("/dispatchExl", require("../routes/excelRoutes/dispatchExlApi"));
    router.use("/scrapExl", require("../routes/excelRoutes/scrapExlApi"));

    // Tool Management
    router.use("/addtool", require("../routes/ToolApi"));
    router.use("/partvstoolvsprocess", require("../routes/partNoVSToolApi"));
    router.use("/toolmonitoring", require("../routes/toolMonitoringApi"));
    router.use("/toolgrinding", require("../routes/toolGrindingApi"));
    router.use("/toolreport", require("../routes/toolReportApi"));
    router.use("/toolComplaint", require("../routes/toolComplaintApi"));
    router.use("/maintenance", require("../routes/maintenance.routes"));

    // Checklist
    router.use("/assembly", require("../routes/assemblydowntimeApi"));
    router.use("/skillmatrics", require("../routes/skillmatricsApi"));
    router.use("/documentnumber", require("../routes/documentnumberApi"));

    router.use("/checklist/template", require("../routes/checklistTemplate.routes"));
    router.use("/checklist/master", require("../routes/checklistMaster.routes"));
    router.use("/checklist", require("../routes/checklistExecution.routes"));

    // Bind all routes under /api
    app.use("/api", router);

    /* --------------------------- DEFAULT ROUTE --------------------------- */
    app.get("/", (req, res) => {
        res.send("Server is running...");
    });

    /* ------------------------- GLOBAL ERROR HANDLER ------------------------- */
    app.use((err, req, res, next) => {
        return handleErrorResponse(res, err);
    });
};
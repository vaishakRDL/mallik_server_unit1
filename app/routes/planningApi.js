const router = require("express").Router();
const controller = require("../controllers/planningController");
const plExport = require("../controllers/excel/planningExlController");

// GET
router.get("/fim", controller.showFim);
router.get("/assemblyExport", plExport.assemblyExport);
router.get("/assemblyFim", controller.assemblyCell);
router.get("/fetchRejectedDoc", controller.fetchRejectedDoc);
router.get("/machineLoad", controller.machineLoadExcel);

// POST
router.post("/", controller.machinePlanning);
router.post("/assemblystore",controller.store);
router.post("/show", controller.show);
router.post("/assemblyShow", controller.assemblyShow);
router.post("/assemblyfilter", controller.assemblyfilter);
router.post("/getDropdownOptions", controller.getDropdownOptions);
router.post("/child", controller.childPlanning);
router.post("/storeRejectedParts", controller.handleRejectedParts);
router.post("/approveRejectedParts", controller.approveRejectedParts);
router.post("/declineRejectedParts", controller.declineRejectedParts);
router.post("/kanbanProducts", controller.kanbanProducts);
// router.post("/productReport", controller.productReportExcel);

module.exports = router;
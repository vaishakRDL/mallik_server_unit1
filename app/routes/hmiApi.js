const router = require("express").Router();
const controller = require("../controllers/hmiController");

router.get("/fecthBarcodeIds", controller.fecthBarcodeIds);
router.get("/generateBarcodeLabel", controller.generateBarcodeLabel);
router.get("/barcodeDetails", controller.barcodeDetails);

router.post("/updateJC", controller.updatePartCompletion);
router.post("/jcProcessList", controller.processList);
router.post("/updateNestingQty", controller.updateNestingQty);
router.post("/updateChildPartQty", controller.updateChildPartQty);
router.post("/childPartDetails", controller.childPartDetails);
router.post("/updateChildPartManual", controller.updateChildPartManual);
router.post("/machinePlanning", controller.machinePlanning);
router.post("/machinePlan", controller.machinePlan);
router.post("/revisedBarcodeCsl", controller.revisedBarcodeCsl);
router.post("/deleteBarcodeCsl", controller.deleteBarcodeCsl);
router.post("/updateMacAdd", controller.updateMacAdd);

module.exports = router;


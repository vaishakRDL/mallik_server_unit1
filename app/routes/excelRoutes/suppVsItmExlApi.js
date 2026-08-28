const supVsItmExl = require("../../controllers/excel/suppVsItmExlController");
const router = require("express").Router();


router.get("/download/:id", supVsItmExl.download);
router.get("/template", supVsItmExl.template);

router.post("/import", supVsItmExl.import);
router.post("/dbImport", supVsItmExl.dbImport);
router.post("/saveData", supVsItmExl.store);
// router.post("/saveData2", supVsItmExl.storeExcelData);


module.exports = router;

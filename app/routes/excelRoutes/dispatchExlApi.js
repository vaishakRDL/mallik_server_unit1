const router = require("express").Router();
const disp = require("../../controllers/excel/dispatchExlController")

router.get("/uniqueId", disp.uniqueId);


router.get("/conractTemp", disp.templateContract);
router.get("/partTemp", disp.templatePart);
router.get("/search/excelId", disp.getExcelId);

router.post("/import", disp.import);
router.post("/importPart", disp.importPart);
router.post("/partUpload", disp.store);

module.exports = router;
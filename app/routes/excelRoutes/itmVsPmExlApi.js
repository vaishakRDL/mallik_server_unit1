const router = require("express").Router();
const itmVsPm = require("../../controllers/excel/itmVsPmExlController")


router.get("/template", itmVsPm.template);
router.get("/copyTemplate", itmVsPm.copyTemplate);
router.get("/deSelectTemp", itmVsPm.deSelectTemp);
router.get("/export/:id", itmVsPm.export);

router.post("/import", itmVsPm.import);
router.post("/copy", itmVsPm.copy);
router.post("/deSelect", itmVsPm.deSelect);
router.post("/dbImport", itmVsPm.dbImport);

module.exports = router;
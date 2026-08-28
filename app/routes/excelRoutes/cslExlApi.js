const router = require("express").Router();
const csl = require("../../controllers/excel/cslExlController")

router.get("/template", csl.template);
router.get("/export", csl.cslExport);
router.post("/import", csl.import);

module.exports = router;
const router = require("express").Router();
const qlt = require("../../controllers/excel/qltyExlController")


router.get("/template", qlt.template);
router.get("/copyTemplate", qlt.copyTemplate);

router.get("/export", qlt.export);

router.get("/assemblyExport/:id", qlt.assemblyExport);
router.get("/itemsExport/:id", qlt.itemsExport);

router.post("/copy", qlt.copy);
router.post("/import", qlt.import);


module.exports = router;
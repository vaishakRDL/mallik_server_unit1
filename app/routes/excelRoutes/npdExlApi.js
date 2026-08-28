const router = require("express").Router();
const npd = require("../../controllers/excel/npdExlController")


router.get("/template", npd.template);
router.get("/report", npd.export);


router.post("/import", npd.import);


module.exports = router;
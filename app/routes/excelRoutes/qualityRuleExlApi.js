const router = require("express").Router();
const qr = require("../../controllers/excel/QualityRuleExl")


router.get("/template", qr.template);
router.get("/report", qr.export);
router.post("/import", qr.import);


module.exports = router;
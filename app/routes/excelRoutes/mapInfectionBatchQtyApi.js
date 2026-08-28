const router = require("express").Router();
const mibq = require("../../controllers/excel/mapInfectionBatchQtyController.js")

router.get("/template", mibq.template);
router.get("/report", mibq.export);
router.post("/import", mibq.import);

module.exports = router;
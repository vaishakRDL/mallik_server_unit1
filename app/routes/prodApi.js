const router = require("express").Router();
const prod = require("../controllers/prodReportController");

router.get('/view', prod.viewProductionReport);
router.get('/export', prod.exportProductionReport);

module.exports = router;
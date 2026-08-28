const router = require('express').Router();
const controller = require('../controllers/kpiDbController');

router.get('/', controller.dashboard);
router.get('/monthlyKpiReport', controller.monthlyKpiReport);
router.get('/kpiMetricReport', controller.kpiMetricReport);
router.put('/updateKpiTarget', controller.updateKpiTarget);

module.exports = router;
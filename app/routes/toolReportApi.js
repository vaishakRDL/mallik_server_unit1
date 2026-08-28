const express = require('express');
const router = express.Router();
const controller = require('../controllers/toolReportController');

router.get('/toolbymachine/:machineId', controller.getToolsByMachineId);

router.post('/toolalertreport', controller.getToolAlertReport);





module.exports = router;
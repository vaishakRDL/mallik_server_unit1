const express = require('express');
const router = express.Router();
const controller = require('../controllers/toolMonitoringController');

router.get('/gettoolmonitor', controller.getToolMonitoring);  
router.get('/searchByName', controller.searchToolByName);
router.get('/gettools/:id', controller.getToolDetailsById);   



// router.post('/test', controller.updateToolDailyKPIs);//preventive maintenance summary single api
// router.post('/testMonthly', controller.updateToolMonthlyKPIs);//preventive maintenance summary single api

router.put('/updatetoolmonitor/:id', controller.updateToolMonitoring);   
router.delete('/deletetoolmonitor/:id', controller.deleteToolMonitoring);   

// router.get('/searchtoolno', controller.searchTool); 







module.exports = router;



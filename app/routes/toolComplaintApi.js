const express = require('express');
const router = express.Router();
const controller = require('../controllers/toolComplaintController');

router.get('/', controller.getAllComplaints);  
router.get('/getOperators', controller.getOperators);  
router.get('/getToolsByMachine', controller.getToolsByMachine);  
router.get('/operatorlist', controller.operatorlist);  
router.get('/getAllToolUsage', controller.getAllToolUsage);  
router.get('/getGrindingTools', controller.getGrindingTools);  
router.get('/getGrindingToolsreport', controller.getGrindingToolsreport);  

router.post('/getUsageReport', controller.getUsageReport);  
router.post('/storeComplaint', controller.storeComplaint); 
router.post('/getGrindReport', controller.getGrindReport); 

router.post('/getComplaintsByFilter/operator', controller.getComplaintsByFilter);  
router.post('/getToolNoByMachineId/show', controller.getToolNoByMachineId);  
router.post('/getToolNameByToolNo/display', controller.getToolNameByToolNo);  
router.post('/getMissingReports/show', controller.getMissingReports);  
router.post('/getBrokenReports/report', controller.getBrokenReports);  
router.post('/getComplaintsByFilter/operator', controller.getComplaintsByFilter);  
router.post('/toolUsageCountUpdate/update', controller.updateToolUsageAPI); 
router.post('/updateGrindingTime/grind', controller.updateGrindingTime);


router.put('/updateComplaint/:id', controller.updateComplaint);



router.delete('/deleteComplaint/:id', controller.deleteComplaint);





module.exports = router;
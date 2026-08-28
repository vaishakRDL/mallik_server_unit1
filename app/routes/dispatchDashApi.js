const router = require("express").Router();
const controller = require("../controllers/dispatchDashController");


router.get('/screenCheck', controller.screenCheck);

router.get('/showdropdown/dropdown', controller.showdropdown);

router.get('/getContractDetails/filter/:contractNo', controller.getContractDetails);


router.get('/dailyKpiDash', controller.dailyKpiDash);//kpi dashboard


router.post('/view', controller.fetchDispatch);
router.post('/getDispatchWithVehicle/post', controller.getDispatchWithVehicle);//deployed partdashboard code 
router.post('/footerPartNo/show', controller.footerPartNo);
router.post('/showdashcontractnodotnet',controller.dashcontractnodotnet);
router.post('/getDispatchPlan', controller.getDispatchPlan);//contractdashboard api
router.post('/dailydashboardcontractno',controller.dailydashboardcontractno);//contractfooterapi


// router.post('/getPartData/view',controller.getPartWithVehicle);
router.post('/postRemarks', controller.postRemarks);//comment thie CR 
router.post('/updateStartTime/update', controller.updateStartTime);//comment thie CR  partNo
router.post('/searchShipment/DelNoteNo', controller.searchShipment);
router.post('/getContractsByShipmentDate/show', controller.getContractsByShipmentDate);
router.post('/getFIMValuesByContract/fim', controller.getFIMValuesByContract);
router.post('/getDelNotesByDeliveryDate/date', controller.getDelNotesByDeliveryDate);
router.post('/getPartFilteredData/showparts', controller.getPartFilteredData);


router.put('/updatePartRemarks', controller.updatePartRemarks);
router.put('/updateStartTime', controller.updateShipmentTime);
router.put('/updateFimStatus/dispatch', controller.updateFimStatus);


router.put('/updateSobRemarks', controller.updateSobRemarks);//new
router.put('/updateDispatch/:id', controller.updateDispatch);

module.exports = router;
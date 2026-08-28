const router = require("express").Router();
const controller = require("../controllers/scheduleController");

router.get('/materials', controller.materialLists);
router.get('/operatorLog', controller.assemblyOperatorLog);
router.get('/machinePlanning', controller.machinePlanning);
router.post('/', controller.fetchSchedules);
router.post('/shopFloor', controller.schedulingTasks);
router.post('/machine', controller.machineSchedule);
router.post('/reallocateShifts', controller.reallocateShifts);
router.post('/reassignShifts', controller.reassignShifts);
router.post('/nestingPlan', controller.nestingPlan);
router.post('/cutSheet', controller.storeSheetDetails);

module.exports = router;
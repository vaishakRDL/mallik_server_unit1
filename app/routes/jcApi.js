const router = require("express").Router();
const controller = require('../controllers/jcController');
const hmi = require('../controllers/hmiController');

router.get('/export', controller.exportSchedules);
router.get('/jcNo', controller.getJobCardNo);

router.post('/', controller.jcList);
router.post('/number', controller.jcNumber);
router.post('/view', controller.jcView);
router.post('/shortClose', controller.shortCloseJc);

// Hmi screen
router.post('/items', hmi.jcMainParts);
router.post('/childParts', hmi.bomChildParts);

// New Api's
router.post('/fetchSchedules', controller.fetchSchedules);
router.post('/details', controller.jcDetails);
router.post('/childProcess', controller.childPartPorcess);
router.post('/pendingChildParts', controller.pendingChildParts);

module.exports = router;
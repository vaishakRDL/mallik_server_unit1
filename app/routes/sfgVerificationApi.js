const router = require("express").Router();
const controller = require("../controllers/sfgVerificationController");

// GET 
router.get('/vendorProcess',  controller.vendorProcess);
router.get('/sfgParts',  controller.sfgParts);
router.get('/view',  controller.viewSFG);
router.get('/search',  controller.getSfgNo);
router.get('/',  controller.sfgVerification);

// PUT
router.put('/updateStatus',  controller.sfgAutoSatatus);

// POST
router.post('/',  controller.sfgAllocatedParts);
router.post('/fetch',  controller.fetchCompletedSfg);
router.post('/store',  controller.storeSfg);
router.post('/createJobWork',  controller.createJobWork);

router.post('/updateNextProcess',  controller.nextProcess);

module.exports = router;
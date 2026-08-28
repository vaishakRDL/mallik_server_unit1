const router = require("express").Router();
const controller = require("../controllers/moduleLockController");
const { moduleLockCheck } = require("../utility/moduleLockCache");

router.get('/', controller.modulesList);
router.get('/activeConnections',  controller.activeConnections);

router.get('/health', moduleLockCheck("Planning"), controller.healthCheck);
router.post('/lock',  controller.moduleLock);
router.post('/unLock',  controller.moduleUnlock);

module.exports = router;
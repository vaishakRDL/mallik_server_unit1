const router = require("express").Router();
const controller = require('../controllers/srnController');
const storeReq = require('../controllers/storeReqController');
const { moduleLockCheck } = require("../utility/moduleLockCache");

// GET
router.get('/uniqueNumber', controller.getSrnNo);
router.get('/items', controller.items);
router.get('/display', controller.display);
router.get('/template', controller.template);
router.get('/getData/:id', controller.getData);
router.get('/getSrnByType/:type', controller.getSrnByType);

// POST
router.post('/', controller.store);
router.post('/assembly', controller.assemblySrn);
router.post('/srnRequest', storeReq.srnRequest);
router.post('/import', controller.import);
router.post('/report', controller.srnReport);

router.put('/:id', controller.update);

router.delete('/:id', controller.delete);

module.exports = router;
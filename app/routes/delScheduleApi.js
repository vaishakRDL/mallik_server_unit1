const controller = require('../controllers/delScheduleController');
const router = require('express').Router();

// GET
router.get('/template', controller.template);
router.get('/dcNo', controller.search);

router.get('/sfgRefNo', controller.sfgRefNo);
router.get('/history', controller.delscheduleHistory);
router.get('/details', controller.vendorDeliverySchedule);
router.get('/items', controller.deliveryScheduleItems);
router.get('/jobWork', controller.jobWorkIsuue);


// POST
router.post('/show', controller.show);
router.post('/update', controller.updateQty);
router.post('/import', controller.import);
router.post('/', controller.store);


module.exports = router;
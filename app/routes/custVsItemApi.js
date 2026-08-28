const router = require("express").Router();
const custItem = require('../controllers/custVsItemController');
const custItemExl = require('../controllers/excel/custVsItemExlController');

router.get('/getCustomer', custItem.searchCust) ;
router.get('/getItems', custItem.searchItem) ;
router.get('/template', custItemExl.template);
router.get('/copyTemplate', custItemExl.copyTemplate);
router.get('/rateApproval', custItem.rateApproval);
router.get('/rejected', custItem.rejected);
router.get('/rateTemplate', custItemExl.rateTemplate);

router.get('/report', custItem.custVsItemReport);
// router.get('/show/:id', custItem.show);

router.get('/:id', custItem.showData);


router.post('/', custItem.store);
router.post('/import', custItemExl.import);
router.post('/importCopy', custItemExl.copy);
router.post('/import/rateUpadate', custItemExl.rateImport);

// router.put('/:id', custItem.updateRow);
router.put('/approval/submit', custItem.updateApproval);
router.put('/approval/reject', custItem.rejecteApproval);



router.delete('/:id', custItem.delete);


module.exports = router;
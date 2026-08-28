const router = require("express").Router();
const controller = require("../controllers/qcMasterController");

// GET 
router.get('/',  controller.show);
router.get('/material',  controller.showMatRate);
router.get('/reworkRate',  controller.showRewRate);
router.get('/copq/desc',  controller.showDesc);
router.get('/copq/descLog',  controller.showDescLog);
router.get('/material/search',  controller.searchMaterial);
router.get('/copq/priceMap',  controller.showPrMap);


router.post('/',  controller.store);
router.post('/material',  controller.storeMatRate);
router.post('/reworkRate',  controller.storeRewRate);
router.post('/copqRepo',  controller.copqShow);
router.post('/copq/desc',  controller.storeDesc);
router.post('/copq/descLog',  controller.storeDescLog);
router.post('/copq/priceMap',  controller.storePrMap);
router.post('/copqRepo/detail',  controller.copqDrillDown);


router.put('/:id',  controller.update);
router.put('/reworkRate/:id',  controller.updateRewtRate);
router.put('/material/:id',  controller.updateMatRate);
router.put('/copq/desc/:id',  controller.updateDesc);
router.put('/copq/descLog/:id',  controller.updateDescLog);
router.put('/copq/priceMap/:id',  controller.updatePrMap);


router.delete('/:id', controller.delete);
router.delete('/material/:id',  controller.deleteMatRate);
router.delete('/reworkRate',  controller.deleteRewRate);
router.delete('/copq/descLog/:id',  controller.deleteDescLog);
router.delete('/copq/priceMap/:id',  controller.deletePrMap);


module.exports = router;
const item = require('../controllers/itemController');
const ItemExl = require('../controllers/excel/itemExlController');
const ItemExlV2 = require('../controllers/excel/itemExlV2Controller');
const router = require('express').Router();

/* Item Excel */
router.get('/template', ItemExlV2.template);
router.get('/export', ItemExl.export);
router.get('/duplicateTemplate', ItemExl.dupTemplate);
router.post('/loadBulkItems', ItemExl.viewBulkCreationItems);
router.post('/storeBulkItems', ItemExl.storeBulkCreationItems);
router.post('/itemImport', ItemExl.itemImport);

/* Items */
router.get('/', item.show);
router.get('/fetchItems', item.fetch);
router.get('/search', item.itemSearch);
router.get("/buildNgramsForAllItems", item.buildNgramsForAllItems);
router.get("/clearItemCache", item.clearItemCache);
router.get("/getAllItemCache", item.getAllItemCache);
router.get('/supVsItem/:id', item.supVsItem);
router.post('/', item.store);
router.put('/:id', item.update);
router.delete('/:id', item.delete);

router.get('/getItems', item.getItems);
router.get('/getRmCode', item.getRmCode);

/* Item Stock */
router.get('/stock/template', ItemExl.stockTemplate);
router.post('/stock/import', ItemExl.stockImport);
router.post('/stock', item.storeStock);

/* Item rate */
router.get('/rate/template', ItemExl.itemRateTemplate);
router.post('/rate/import', ItemExl.itemRateImport);
router.post('/rate/update', item.updateItemRate);

/* Item Excel v2 */
router.post('/importExcel', ItemExlV2.import);
router.post('/storeBulk', ItemExlV2.store);

module.exports = router;
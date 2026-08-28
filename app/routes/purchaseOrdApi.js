const router = require("express").Router();
const purchase = require('../controllers/purchase_orderMst');


// router.get('/', purchase.show) ;
router.get('/showname', purchase.showname);
router.get('/item/:id', purchase.search);
router.get('/itemSearch/:id', purchase.itemSearch);

router.get('/template', purchase.template);
router.get('/export', purchase.export);
router.get('/uniqueId/', purchase.uniqueId);
router.get('/showpo/', purchase.showaddedpo);
router.get('/shortClose', purchase.shortClose);
router.get('/getItems', purchase.getItems);
router.get("/searcPo", purchase.searchPo);

router.get('/adddress/:id', purchase.showaddress);
router.get('/multiAddress/:id', purchase.multiAddress);
// router.get('/showpdfdata/:id', purchase.showPdfdata);
// router.get('/showPOpdfdata/:id', purchase.getPOSalesshow);
// router.get('/showpobyid/:id', purchase.showaddedpoid);
router.get('/exportPo/:id', purchase.exportPo);
router.get('/showData/:id', purchase.showData);
router.get('/itemDtl/:id/:id2', purchase.showitemsbyid);

router.post('/', purchase.insertPurchaseOrderAndItems);
router.post('/import', purchase.import);
router.post('/importexceldata/:id', purchase.importExeldata);

router.post('/updateRate', purchase.updateRate);
router.post('/updateRate2', purchase.updateRate2);

router.post('/soVerified/items', purchase.verfiedItems);
router.post('/importMultiSO', purchase.importMultiSO);
router.post("/shortCloseCron", purchase.shortCloseCron);


router.put('/:id', purchase.update);

router.delete('/:id', purchase.delete);


module.exports = router;
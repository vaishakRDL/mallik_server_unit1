const router = require("express").Router();
const dc = require('../controllers/CustomerDc');

router.get('/', dc.show);
router.get('/uniqueId', dc.uniqueId);
router.get('/template', dc.template);
// router.get('/show/:id', dc.showdatabyid);
router.get('/getItems', dc.getItems);
router.get('/qcPending', dc.qcPending);

router.get("/searchCustomer", dc.searchCust);
router.get("/searchItems", dc.searchItems);
// router.get('/dcselection/:id', dc.showdc);
router.get('/showData/:id', dc.showData);
router.get('/export/:id', dc.exportCustDc);


router.post('/', dc.store);
router.post('/importexceldata', dc.importExeldata);
router.post('/qcSubmit', dc.qcSubmit);
// router.post('/item/:id', dc.showitemsbyid);

router.put('/:id', dc.update);

router.delete('/:id', dc.delete);


module.exports = router;
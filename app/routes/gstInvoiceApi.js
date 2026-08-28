const router = require("express").Router();
const gstInvoice = require('../controllers/gstInvoiceController');
const accExl = require('../controllers/excel/AccExlController');


router.get('/', gstInvoice.showdata);
router.get('/customer', gstInvoice.getCustomer);
router.get('/template', gstInvoice.template);
router.get('/gstinvoice', gstInvoice.showgstinvoice);
router.get('/getItems', gstInvoice.getItems);
router.get('/approval/cancelInvoice', gstInvoice.pendCancelInvoice);
router.get('/dispatch', gstInvoice.dispatchShow);
router.get('/searchDel', gstInvoice.searchDel);
router.get("/gstTemplate", accExl.gstTemplate);
router.get("/getDispatchList", gstInvoice.getDispatchList);

router.get('/:id/searchItm', gstInvoice.search);
router.get('/item/:id', gstInvoice.showitemsbyid);
router.get('/address/:id', gstInvoice.showaddress);
router.get('/pendingSo/:id', gstInvoice.pendingso);
router.get('/gstshowinvoice/:id', gstInvoice.getGSTSalesInvoiceshow);
router.get('/fgdcAll/:id', gstInvoice.getFgDcAll);
router.get('/exportGstInvice/:id', gstInvoice.exportGstInvice);
router.get('/canceledInvoice/:id', gstInvoice.canceledInvoiceshow);
router.get('/showInvoice/:id', gstInvoice.showInvoice);
router.get('/jsonDoc/:id', gstInvoice.jsonDoc);
router.get('/fetch', gstInvoice.fetchGSTInvoice);
router.get('/:id', gstInvoice.showdatabyid);

router.post('/multiGstInvoice', gstInvoice.multiGSTsalesInvoice);
router.post('/pendingDel/:id', gstInvoice.pendingDel);
router.post('/', gstInvoice.insertGSTSalesInvoice);
router.post('/dispatch', gstInvoice.dispatchAdd);
router.post('/multiInvoiceXml', gstInvoice.multiInvoice);
router.post('/unique/', gstInvoice.uniqueId);

router.post('/einvoice', gstInvoice.einvoice);
router.post('/makeInvoice', gstInvoice.makeInvoice);

router.post('/saveEinvoice', gstInvoice.saveEinvoice);
router.post('/gstImport', accExl.gstImport);
router.post('/multiInvoiceView', gstInvoice.multiInvoiceXml);
router.post('/gstzenFix', gstInvoice.gstzenFix);

router.post('/gstshowinvoiceTally/:id', gstInvoice.getGSTInvoiceshowTally);
router.post('/fgdc/:id', gstInvoice.getFgDc);
router.post('/pendingDc/:id', gstInvoice.pendingDc);

router.put('/approval/submit', gstInvoice.approveSubmit);
router.put('/updatePrintStatus', gstInvoice.updateInovicePrintStatus);
router.put('/dispatch/:id', gstInvoice.dispatchUpdate);
router.put("/cancelInvoice/:id", gstInvoice.cancelInvoice);
router.put('/:id', gstInvoice.updateGSTSalesInvoice);

router.delete('/:id', gstInvoice.delete);
router.delete('/dispatch/:id', gstInvoice.dispatchDelete);

module.exports = router;
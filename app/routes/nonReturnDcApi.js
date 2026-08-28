const router = require("express").Router();
const nodc = require('../controllers/nonReturnDc');

router.get('/shownodc/', nodc.showAddedNonReturnableDC);
router.get('/downloadTemplate',nodc.downloadTemplate);
router.get('/getItems', nodc.getItems);
router.get('/json',  nodc.jsonDoc);
router.get('/showData/:id', nodc.showData);
router.get('/shownodc/:id', nodc.shownoDcById);
router.get('/exportndc/:id', nodc.exportndc);
router.get('/address/:id', nodc.showaddress);
router.get('/getinvoiceitem/:id', nodc.getitemsbyidinvoice);
router.get('/invoicePrint/:id', nodc.invoiceData);
router.post('/getData', nodc.getData);


router.post('/', nodc.insertNonReturnableDCData);
router.post('/uniqueId', nodc.uniqueId);
router.post('/importndc', nodc.importndc);
router.post('/item/:id', nodc.showitemsbyid);
router.post('/invoiceitem/:id', nodc.showitemsbyidinvoice);
router.post('/importexceldata/:id', nodc.importExeldata);

router.post('/pendingInvoice/:id', nodc.pendInvoice);
router.post('/getInvoiceItems', nodc.invItems);

router.post('/pendingDc/:id', nodc.pendingDc);
router.post('/getDcItems', nodc.pendingDcItems);

router.put('/:id', nodc.updateNonReturnableDCData);

router.delete('/:id', nodc.delete);

module.exports = router;
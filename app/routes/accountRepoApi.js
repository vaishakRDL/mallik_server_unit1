const router = require("express").Router();
const repo = require('../controllers/accountRepoController');

// router.get('/exportInvCustDc', repo.exportInvCustDcToExcel);
// router.get('/exportCustomerDc', repo.exportCustDcToExcel);
router.get('/itemLedjer', repo.itemLedjer);
router.get('/saleInvoice/export', repo.saleInvoiceExport);


router.post('/saleInvoice', repo.saleInvoice);
router.post('/saleRegister', repo.saleRegister);
router.post('/soCustpo', repo.soCustpo);
router.post('/custPo', repo.custPo);

router.post('/invCustDc', repo.invCustDc);
router.post('/customerDc', repo.custDc);
router.post('/creditNote', repo.creditNote);
router.post('/customer/nrdc', repo.nrdcCust);

router.post('/cancel/saleInvoice', repo.cancelSaleInvoice);
router.post('/cancel/saleInvoice/summary', repo.cancelInvSummary);

router.post('/fgStockRepo', repo.fgStockRepo);
router.post('/fgStock/summary', repo.fgStockSum);

router.post('/dailyStock', repo.dailyStock);

module.exports = router;
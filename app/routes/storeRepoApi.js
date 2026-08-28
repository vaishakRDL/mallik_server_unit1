const storeRepo = require("../controllers/storeRepoController");
const router = require("express").Router();

router.get('/ReferenceLatest/:id', storeRepo.referenceLatest);
router.get('/stockTemplate', storeRepo.template);
router.get('/download/stockBalance', storeRepo.repoStkBalanceDownload);
router.get('/download/stockBalance2', storeRepo.repoStkBalanceDownload2);


router.post('/referenceAll/:id', storeRepo.referenceAll);
router.post('/grnLog/:id', storeRepo.grnLogData);
router.post('/stockLedger', storeRepo.stkLedger);
router.post('/itemConsumption', storeRepo.itemCons);

router.post('/stockBalance', storeRepo.stkBalanceDisplay);

router.post('/stockAge', storeRepo.stkAge);
router.post('/stockAge45', storeRepo.stkAgeAbove45);


router.post('/quarantine', storeRepo.quarantine);
router.post('/upload/stock', storeRepo.import);
router.post('/upload/confirm', storeRepo.store);

module.exports = router;
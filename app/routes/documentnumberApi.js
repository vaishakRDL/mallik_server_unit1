const router = require("express").Router();
const docno = require("../controllers/documentnumber");

router.get('/', docno.showdoc);
router.get('/financialYear', docno.fetchFY);
router.get('/view', docno.docNumbersList);
router.get('/generateDocNo', docno.generateDocNumber);

router.get('/test', docno.testDocNumber);
router.get('/testSync', docno.testSyncDocNumber);

router.put('/financialYear', docno.updateFY);

router.post('/', docno.updatedoc);
router.post('/financialYear', docno.storeFY);


module.exports = router;
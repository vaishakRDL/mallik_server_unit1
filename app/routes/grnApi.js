const router = require("express").Router();
const grn = require("../controllers/grnController");

router.get('/', grn.fetchGrn);

router.put('/issue-automatic', grn.issueAutomatic);

router.post('/fetch', grn.fetchGrnNo);
router.post('/issue', grn.assignGrn);
router.post('/reset-stock', grn.resetGrnStock);

module.exports = router;
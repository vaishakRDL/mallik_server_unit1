const router = require("express").Router();
const material = require("../controllers/matIssueController");

router.get('/', material.fetchMRP);
router.get('/search', material.searchIssueNo);
router.get('/export', material.materialIsuueExport);
router.get('/view', material.viewIssueNote);
router.get('/indentReport', material.indentReport);
router.get('/srnReport', material.srnReport);
router.post('/:id', material.allocatedMaterials);

module.exports = router;
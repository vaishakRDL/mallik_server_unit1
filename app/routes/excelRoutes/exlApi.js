const router = require("express").Router();
const excel = require("../../controllers/excel/exlController");


router.post('/master/import', excel.mstImport);
router.post('/bomPart/import', excel.bomPart);
router.get('/update', excel.bomMstUpdate);
router.post('/fim', excel.importFim);

module.exports = router;
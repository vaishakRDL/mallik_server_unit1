const router = require("express").Router();
const info = require("../controllers/infoController");
const infoExl = require("../controllers/excel/infoExlController");

router.get('/scrapExport', infoExl.scrapExport);
router.get('/sheetExport', infoExl.sheetExport);

router.post('/scrap/:id', info.scrapShow);
router.post('/sheet/:id', info.sheetShow);


module.exports = router;
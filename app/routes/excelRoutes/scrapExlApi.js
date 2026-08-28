const router = require("express").Router();
const qlt = require("../../controllers/excel/scrapExlController")


router.get("/repoDownload", qlt.export);
router.get("/repo/paintSludge", qlt.exportPaint);
router.get("/repo/analysis", qlt.exportAnalysis);



module.exports = router;  
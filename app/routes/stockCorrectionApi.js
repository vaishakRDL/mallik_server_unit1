const stock = require("../controllers/stockCorrectionController");
const router = require("express").Router();

// Download a blank Stock Correction xlsx template (itmCode | qty | grn).
router.get("/template", stock.template);

// Parse + validate a Stock Correction xlsx (itmCode | qty | grn) and return a preview.
router.post("/import", stock.import);

// Commit the previewed rows into the store ledger (reset-to-0 row + set-qty row per item).
router.post("/store", stock.storeToMain);

module.exports = router;

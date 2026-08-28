const qlty = require("../controllers/qltyItemsController");
const router = require("express").Router();

router.get("/uniqueId", qlty.uniqueId);
router.get("/rejected", qlty.rejected);
router.get("/reportView/:id", qlty.reportView);

router.post("/showData", qlty.showData);
router.post("/getTotQty", qlty.getTotQty);

router.post("/showType", qlty.showType);
router.post("/submit", qlty.submit);
router.post("/report", qlty.report);


module.exports = router;

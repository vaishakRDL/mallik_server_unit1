const approve = require("../controllers/approvalController");
const router = require("express").Router();

router.get("/pendingPo", approve.pendingPo);
router.get("/rateList", approve.rateList);
router.get("/rateRejected", approve.rateRejected);
router.get("/poRejected", approve.poRejected);
router.get("/pendingItems", approve.pendingStock);

router.post("/rateStatus", approve.rateStatus);
router.post("/poView", approve.poView);
router.post("/poStatus/:id", approve.poStatus);
router.post("/stockSubmit", approve.storeToMain);

// router.post("/validate", approve.validate); 

module.exports = router;

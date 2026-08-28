const qlty = require("../controllers/inwardQcController");
const router = require("express").Router();

router.get("/processList/:id", qlty.inwardProcess);
router.get("/uniqueId", qlty.uniqueId);
router.get("/rejected", qlty.rejected);
router.get("/searchPo", qlty.searchPo);
router.get("/reportView/:id", qlty.reportView);
router.get("/withoutPo/uniqueId", qlty.withoutPoUniqueId);
router.get("/withoutPo/searchPo", qlty.withoutPoSearch);
router.get("/withoutPo/reportView/:id", qlty.withoutPoReportView);

router.put("/updateOneQcFile", qlty.updateOneQcFile);


router.post("/showData", qlty.showData);
router.post("/showType", qlty.showType);
router.post("/submit", qlty.submit);

router.post("/report", qlty.report);
router.post("/rejected", qlty.rejected);
router.post("/qcFileUpload/:id", qlty.qcFile);
router.post("/multiQcFile/upload/:id", qlty.multiQcFile);
router.post("/qcApprove", qlty.qcApprove);


// router.post("/dashboard/inwardPPMRej", qlty.inwardPPMRej);

router.post("/withoutPo/showType", qlty.withoutPoShowType);
router.post("/withoutPo/submit", qlty.withoutPosubmit);
// router.post("/withoutPo/submit2", qlty.withoutPosubmit2);

router.post("/withoutPo/report", qlty.withoutPoReport);
router.post("/withoutPo/rejected", qlty.withoutPorejected);

module.exports = router;

const pmInspec = require("../controllers/qltyPmInspecController");
const router = require("express").Router();

router.get("/searchMachine", pmInspec.search);
router.get("/getMachine", pmInspec.getMachine);
router.get("/uniqueId", pmInspec.uniqueId);

router.get("/rejected", pmInspec.rejected);
router.get("/download/:id", pmInspec.download);
router.get("/scrapCount", pmInspec.scrapCount);
router.get("/getKanban", pmInspec.getKanaban);
// router.get("/reportView/:id/:jc/:item", pmInspec.reportView);


router.post("/showData", pmInspec.showData);
router.post("/childPart", pmInspec.childPart);
router.post("/showType", pmInspec.showType);
router.post("/submit", pmInspec.submit);
router.post("/report", pmInspec.report);
router.post("/qltByJc", pmInspec.reportByJc);
router.post("/reportView", pmInspec.reportView)

router.post("/report/fpy", pmInspec.fpy);
router.post("/report/fpyDetail", pmInspec.fpyDetail);
router.post("/report/fpyDetail2", pmInspec.fpyDetail2);

router.post("/report/ppm", pmInspec.fetchPPM);


// router.post("/dashboard/finalPPMRej", pmInspec.finalPPMRej);
// router.post("/dashboard/finalPPMRew", pmInspec.finalPPMRew);
// router.post("/dashboard/fpiYield", pmInspec.fpiYield);

router.put("/forceComplete", pmInspec.forceComplete);

module.exports = router;

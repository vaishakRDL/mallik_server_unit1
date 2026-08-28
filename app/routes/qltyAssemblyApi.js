const qlty = require("../controllers/qltyAssemblyController");
const router = require("express").Router();

router.get("/uniqueId", qlty.uniqueId);
router.get("/rejected", qlty.rejected);
router.get("/reportView/:id", qlty.reportView);

router.post("/getKanaban", qlty.kanaban);
router.post("/searchContracts", qlty.searchContracts);

router.post("/showData/:id", qlty.showData);

router.post("/showType", qlty.showType);
router.post("/submit", qlty.submit);
router.post("/report", qlty.report);
router.post("/assemblyPlan", qlty.assemblyShow);

router.post("/AssemblyQcDone", qlty.qcVerified);
router.post("/assemblyPlan/showType", qlty.assemblyPlanShowType);
router.post("/showType2", qlty.productionShowType);       //Testing api(Directly used in assemblyPlanShowType)

router.post("/assemblyPlan/submit", qlty.assemblyPlanSubmit);


module.exports = router;

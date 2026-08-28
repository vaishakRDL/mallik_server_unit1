const scrap = require("../controllers/scrapMstController");
const router = require("express").Router();


router.get("/", scrap.show);  //Scrap-Master
router.get("/getMachine", scrap.getMachine);//Report
router.get("/getCategory", scrap.getCategory);//Report
router.get("/getMaterial", scrap.getMaterial);//Report
router.get("/getThickness", scrap.getThickness);//Report
router.get("/binShow", scrap.binShow);//Bin weight
router.get("/bin/material", scrap.material);//Bin weight
router.get("/bin/category", scrap.category);//Bin weight

router.get("/scrapApp/getMachine", scrap.machineAll);// scrapApp
router.get("/scrapApp/getCategory", scrap.categoryAll);//scrapApp
router.get("/scrapApp/getMaterial", scrap.materialAll);//scrapApp
router.get("/scrapApp/getThickness", scrap.getThicknesAll);//scrapApp



router.post("/", scrap.store);      //Scrap-Master
router.post("/report", scrap.report);//Report
router.post("/report/analysis", scrap.analysisRepo);//Report
router.post("/report/paintSludge", scrap.paintRepo);//Report
router.post("/report/paintAnalysis", scrap.paintAnalysis);//Report


router.post("/showType", scrap.showType);//Bin weight
router.post("/storeBin", scrap.storeBin);//Bin weight
router.post("/getCounts", scrap.getCounts);
router.post("/scrapApp/store", scrap.storeData); //scrapApp
router.post("/stock", scrap.stock);


router.put("/:id", scrap.update);//Scrap-Master
router.put("/binUpdate/:id", scrap.binUpdate);//Bin weight

router.delete("/:id", scrap.delete);//Scrap-Master



module.exports = router;


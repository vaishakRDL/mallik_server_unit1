const po = require("../controllers/poForeCastController");
const router = require("express").Router();

router.get("/", po.showData);
router.get("/uniqueId", po.uniqueId);
router.get("/getSupp", po.getSupp);
router.get("/searchSup", po.searchSup);
router.get('/getPoItems', po.getPoItems);

router.post("/", po.store);
router.post("/viewDtl", po.viewDtl);
router.post("/report", po.report);
router.post("/getItems/:id", po.getItems);

router.put("/", po.update);

router.delete("/:id", po.delete);

router.post("/report/fcVsPo", po.poFcReport);



  
module.exports = router;
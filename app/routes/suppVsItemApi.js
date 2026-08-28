const supVsItm = require("../controllers/suppVsItemController");
const router = require("express").Router();

router.get("/getSupp", supVsItm.getSupp);
router.get("/search", supVsItm.search);

router.post("/", supVsItm.store);
router.post("/getPriceRevision", supVsItm.getPriceRevision);
router.post("/copyData", supVsItm.copy);
router.post("/getSuppItm/:id?", supVsItm.getSupItm);
router.post("/searchIetm", supVsItm.searchItm);
router.post("/suppReport", supVsItm.suppReport);

router.delete('/:id', supVsItm.delete);
router.delete('/deleteAll/:id', supVsItm.deleteAll);



module.exports = router;

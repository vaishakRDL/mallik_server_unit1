const ItemVsPm = require("../controllers/itemVsPmController");
const router = require("express").Router();


router.get("/search", ItemVsPm.search);
// router.get("/itemSearch", ItemVsPm.itemSearch);

router.get("/getItem", ItemVsPm.getItem);
router.get("/getTool", ItemVsPm.getTool);

router.get("/showData/:id", ItemVsPm.show);
// router.get("/showByItm/:id", ItemVsPm.showByItm);
router.get("/showItems/:id", ItemVsPm.showItems);
router.get("/priceGroup/:id", ItemVsPm.showPrMap);

router.get("/machine/search/:id", ItemVsPm.searchItm);

router.post("/", ItemVsPm.store);
router.post("/getPmMach", ItemVsPm.getPmMach);

router.post("/deSelect", ItemVsPm.deSelect);

router.put("/:id", ItemVsPm.update );






module.exports = router;


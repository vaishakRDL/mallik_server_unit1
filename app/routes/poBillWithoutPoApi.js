const po = require("../controllers/poBillWithoutPoController");
const poExl = require("../controllers/excel/poExlController");
const router = require("express").Router();

router.get("/", po.showData);
router.get("/searchSup", po.searchSup);
router.get("/searchItm", po.searchItm);
router.get("/getItems/:id", po.getItems);
router.get("/grn", po.grn);
router.get("/qcPending", po.pending);
router.get('/getPoItems', po.getPoItems);


router.post("/", po.store);
router.post("/uniqueId", po.uniqueId);
router.post("/viewDtl", po.viewDtl);
router.post("/import", poExl.purBillWithoutPo);
router.post("/report", po.report);
router.post("/multiPrint", po.mutliInv);
router.post("/multiPrint/view", po.multiInvPrint);
  
router.put("/", po.update);
router.delete("/:id", po.delete);

module.exports = router;
const poBill = require("../controllers/poBillController");
const poExl = require("../controllers/excel/poExlController");
const router = require("express").Router();

router.get("/", poBill.showData);
router.get("/template", poExl.poBillTemplate);

router.get("/search/:id", poBill.search);

router.get("/poSupplier", poBill.poSupp);
router.get("/poSupplier2", poBill.poSupp2);
router.get("/grn", poBill.grn);
router.get("/qcPending", poBill.pending);
router.get('/getItems', poBill.getItems);
// router.get('/chekcInv', poBill.chekcInv);

router.get('/checkLot/:id', poBill.checkLot);
router.get('/checkInv/:id', poBill.checkInv);
router.get('/itc03/download', poBill.itcRepoExcel);


router.post("/", poBill.store);
router.post("/uniqueId", poBill.uniqueId);
router.post("/getPoSuppItm", poBill.poSuppItm);
router.post("/getPoJcSuppItm", poBill.jcPoSuppItm);
router.post("/checkFright", poBill.checkFright);
router.post("/viewDtl", poBill.viewDtl);
router.post("/import", poExl.poBillImport);
router.post("/report", poBill.report);
router.post("/postPoReport", poBill.postPoReport);
router.post("/multiPrint", poBill.mutliInv);
router.post("/multiPrint/view", poBill.multiInvPrint);

router.post("/report/summary", poBill.summary);
router.post("/report/detailed", poBill.detailed);
router.post("/report/lotwiseStock", poBill.lotwiseStock);
router.post("/report/itc03", poBill.itcRepo);


router.put("/", poBill.update);
router.delete("/:id", poBill.delete);


module.exports = router;
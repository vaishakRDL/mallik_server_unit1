const poGen = require("../controllers/poGenerateController");
const poExl = require("../controllers/excel/poExlController");
const router = require("express").Router();

router.get("/", poGen.showData);
router.get("/getSuggeation", poGen.getSuggeation);
router.get("/suppItems/:id", poGen.getSuppItm2);
router.get("/pendPoDtl/:id", poGen.pendPoDtl);
router.get("/poTemplate", poExl.poTemplate);
router.get("/searchSupplier", poGen.searchSup);
router.get("/searchItems", poGen.searchItems);
router.get("/searcPo", poGen.searchPo);
router.get('/getItems', poGen.getItems);
router.get('/pendingJW', poGen.pendingJW);
router.get('/getSupRates/:id', poGen.getSupRates);
router.get('/getLocQoh/:id', poGen.getLocQoh);


// router.post("/get/updateSuppItems/:id", poGen.getUpdSupItm);
router.post("/uniqueId", poGen.uniqueId);

router.post("/getAddress", poGen.getAddress);
router.post("/checkMax", poGen.checkMax);
router.post("/", poGen.store);
router.post("/poType2", poGen.poType2);
router.post("/poImport", poExl.poImport);
router.post("/invoice", poGen.invoice);
router.post("/poBillDtl", poGen.poBillDtl);
router.post("/poBill", poGen.poBill);
router.post("/report", poGen.report);
router.post("/shortClose", poGen.shortClose);
router.post("/shortClosedRepo", poGen.shortClosedRepo);
router.post("/report/purchaseVsReceipt", poGen.purchaseVsReceiept);
router.post("/report/authorization", poGen.authorization);
router.post("/report/deliveryRate", poGen.purchaseDeliveryRate);


router.put("/", poGen.update);
router.put("/updateOpt", poGen.updateOpt);

router.delete("/:id", poGen.delete);
router.delete("/delete/item/:id", poGen.deleteItm);


module.exports = router;
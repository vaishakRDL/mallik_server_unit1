const itmPmVsInspec = require("../controllers/itmPmVsInspectionController");
const router = require("express").Router();


router.get("/qcRule", itmPmVsInspec.qcRule); 
router.get("/qcRuleMap", itmPmVsInspec.qcRuleMap); 
router.get("/getQcRule", itmPmVsInspec.getQcRule); 
router.get("/processList/:id", itmPmVsInspec.assemblyProcess);


router.post("/", itmPmVsInspec.store); 
router.post("/getProcess", itmPmVsInspec.getPm);
router.post("/spcAdd", itmPmVsInspec.spcAdd); 

router.post("/getQcList", itmPmVsInspec.getQcList);
router.post("/addInspec", itmPmVsInspec.addInspec);

router.post("/qcRule", itmPmVsInspec.qcRuleAdd); 
router.post("/qcRuleMap", itmPmVsInspec.ruleMapAdd); 

router.put("/qcRule/:id", itmPmVsInspec.qcRuleUpdate); 
router.put("/qcRuleMap/:id", itmPmVsInspec.ruleMapUpdate); 


router.delete("/qcRule/:id", itmPmVsInspec.qcRuleDlt); 
router.delete("/ruleMapDlt/:id", itmPmVsInspec.ruleMapDlt); 

module.exports = router;
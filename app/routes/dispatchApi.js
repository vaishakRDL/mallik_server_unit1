const disp = require("../controllers/dispatchController");
const router = require("express").Router();

router.get("/searchFim", disp.searchFim);
router.get("/getFim", disp.getFim); //Not Used
router.get("/getId", disp.getId); 
// router.get("/uniqueId", disp.uniqueId); //Not used

router.post("/custDelSchedule", disp.delNoteShow);
router.get("/delStatus", disp.delNoteVerification);
router.get("/viewDelNote", disp.getCompletedDelNote);

router.post("/showData", disp.show);
router.post("/getContractPart", disp.getContractPart);
router.post("/openPo", disp.openPo);

router.post("/delShow", disp.delShow);
router.post("/crtDelNote", disp.crtDelNote);
router.post("/custDelSchedule/showDetail", disp.eachDelNoteDtl);
router.post("/qcApprove", disp.qcApprove);
router.post('/sendMail', disp.sendMail);

router.put("/approveDelNote", disp.approveDelNote);
router.put("/invoiceClick/:id", disp.invoiceClick);

router.delete("/custDelSchedule/:id", disp.delete);
router.delete("/deleteAll/:id", disp.deleteAll);
  
module.exports = router;


const router = require("express").Router();
const remarksController = require("../controllers/remarksController");


router.get("/showRemarks", remarksController.showRemarks);
router.post("/addRemark", remarksController.addRemark);
router.put("/updateRemark/:id", remarksController.updateRemark);
router.delete("/deleteRemark/:id", remarksController.deleteRemark);



module.exports = router;
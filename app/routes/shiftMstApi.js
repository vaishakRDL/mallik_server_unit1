const ShiftMst = require("../controllers/shiftMstController");
const router = require("express").Router();

router.post("/", ShiftMst.store);
router.put("/:id", ShiftMst.update);
router.delete("/:id", ShiftMst.delete);
router.get("/", ShiftMst.show);
  
module.exports = router;


const MachineOperator = require("../controllers/machineOperatorController");
const router = require("express").Router();

router.post("/", MachineOperator.store);
router.put("/:id", MachineOperator.update);
router.delete("/:id", MachineOperator.delete);
router.get("/", MachineOperator.show);
  
module.exports = router;


const Machine = require("../controllers/machineController");
const router = require("express").Router();

router.post("/", Machine.store);

router.put("/:id", Machine.update);
router.delete("/:id", Machine.delete);
router.get("/", Machine.show);
router.get("/getShift", Machine.getShift);
router.post("/getUom", Machine.getUom);
router.get("/show", Machine.machineList);

  
module.exports = router;


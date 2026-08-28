const PmVsUom = require("../controllers/pmVsUomController");
const router = require("express").Router();

router.post("/", PmVsUom.store);
router.put("/:id", PmVsUom.update);
router.delete("/:id", PmVsUom.delete);
router.get("/", PmVsUom.show);

  
module.exports = router;


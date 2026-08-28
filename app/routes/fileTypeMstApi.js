const npd = require("../controllers/fileTypeMstConroller");
const router = require("express").Router();


router.post("/", npd.store);
router.put("/:id", npd.update);
router.delete("/:id", npd.delete);
router.get("/", npd.show);

  
module.exports = router;


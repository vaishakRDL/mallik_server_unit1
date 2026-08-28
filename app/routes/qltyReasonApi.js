const reason = require("../controllers/qltyReasonController");
const router = require("express").Router();

router.get("/", reason.show);
router.get("/getId", reason.getId);

router.post("/", reason.store);
router.put("/:id", reason.update);
router.delete("/:id", reason.delete);

  
module.exports = router;


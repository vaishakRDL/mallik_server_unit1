const group = require("../controllers/menuTypeMstController");
const router = require("express").Router();

router.post("/", group.store);
router.put("/:id", group.update);
router.delete("/:id", group.delete);
router.get("/", group.show);
  
router.get("/show2", group.show2);

module.exports = router;


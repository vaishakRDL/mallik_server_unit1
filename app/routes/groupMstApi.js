const group = require("../controllers/groupMstController");
const router = require("express").Router();

router.post("/", group.store);
router.put("/:id", group.update);
router.delete("/:id", group.delete);
router.get("/", group.show);
    
router.post("/userAssign/:id", group.userAssign);
router.get("/userShow/:id", group.userShow);
router.put("/userAssign/:id", group.dltUser);


module.exports = router;


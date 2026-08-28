const Users = require("../controllers/userController.js");
const router = require("express").Router();

router.get("/", Users.show);
router.post("/", Users.store);
router.put("/:id", Users.update);
router.delete("/:id", Users.delete);

module.exports = router;
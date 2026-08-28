const groupRight = require("../controllers/groupRightsController");
const router = require("express").Router();

router.post("/getPermissions", groupRight.getRights);
// router.put("/:id", groupRight.updateRights);

router.post("/submit", groupRight.submit);

module.exports = router;


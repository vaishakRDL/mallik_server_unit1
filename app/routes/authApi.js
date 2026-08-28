const auth = require("../controllers/authController");
const router = require("express").Router();

router.post("/login", auth.login);
router.post("/refreshToken", auth.refreshToken);
router.post("/changePassword", auth.changePassword);

module.exports = router;

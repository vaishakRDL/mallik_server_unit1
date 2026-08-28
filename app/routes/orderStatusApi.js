const router = require("express").Router();
const controller = require("../controllers/orderStatusController");

// GET
router.get("/", controller.orderStatusReport);
router.get("/detailedReport", controller.jcDetails);

module.exports = router;
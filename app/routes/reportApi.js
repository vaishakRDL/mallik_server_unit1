const controller = require("../controllers/reportController");
const router = require("express").Router();

router.get("/planning", controller.planReport);
router.post("/getMaterialIssueReport", controller.getMaterialIssueReport);

router.post("/consumptionTrend", controller.consumptionTrend);
router.post("/minMax", controller.minMaxReport);

module.exports = router;

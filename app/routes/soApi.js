const router = require("express").Router();
const controller = require("../controllers/soController");

// GET
router.get("/po", controller.verifiedPo);
router.get("/template", controller.template);
router.get("/details", controller.priceVerificationDetails);
router.get("/authorize", controller.authorize);

// POST
router.post("/", controller.compareRates);
router.post("/store", controller.store);

module.exports = router;

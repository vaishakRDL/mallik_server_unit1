const router = require("express").Router();
const op = require("../controllers/orderPlanningController");
const plan = require("../controllers/planScheduleController");

// GET
router.get("/list/:id", op.orderList);
router.get("/revertAllocation", plan.revertAllocation);
router.get("/authDocuments", plan.getAuthDocs);

// POST
router.post("/processOrder", op.processOrder);
router.post("/processSales", op.processSales);
router.post("/split", op.splitOrder);
router.post("/updatePriority", op.updatePriority);
router.post("/scrap", op.scrapItems);
router.post("/authRequest", plan.reqForAuthorization);
router.post("/processPlanningDocs", plan.processPlanningDocs);
router.post("/declineDocs", plan.declinePlanningDocs);
router.post("/processMRP", plan.processMRP);
router.post("/", plan.planning);

// DELETE
router.delete("/delete/:id", op.deleteOrderPln);

module.exports = router;
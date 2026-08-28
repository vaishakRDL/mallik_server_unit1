const router = require("express").Router();
const sob = require("../controllers/sobController");

// GET
router.get("/missingCsl", sob.missingCsl);
router.get("/deletedItems", sob.deletedItems);
router.get("/resAndDev", sob.resAndDev);
router.get("/resAndDevAll", sob.resAndDevAll);
router.get("/fim", sob.showFim);
router.get("/:id", sob.show);


// POST
router.post("/", sob.store);
router.post("/consolidateSob", sob.consolidateSob);
router.post("/missingCsl", sob.deleteMissingCsl);
router.post("/moveItems", sob.moveItems);
router.post("/fetch", sob.fetchSob);

// PUT
router.put("/:id", sob.update);

// DELETE
router.delete("/:id", sob.delete);


module.exports = router;
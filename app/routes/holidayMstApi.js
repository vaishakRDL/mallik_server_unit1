const holiday = require("../controllers/holidayMstController");
const router = require("express").Router();

router.get("/", holiday.show);
router.post("/", holiday.store);
router.put("/:id", holiday.update);
router.delete("/:id", holiday.delete);


module.exports = router;


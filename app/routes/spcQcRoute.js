const spc = require("../controllers/spcQcController");
const router = require("express").Router();

router.get("/searchItems", spc.searchItems);
router.get("/searchQp", spc.searchQp);

router.post("/showData", spc.showData);

module.exports = router;

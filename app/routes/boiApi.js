const router = require("express").Router();
const boi = require("../controllers/boiController");

router.get('/', boi.show);
router.get('/suppliers', boi.search);
router.post('/spAndItemList', boi.spAndItemList);

module.exports = router;
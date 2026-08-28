const router = require("express").Router()
const controller = require("../controllers/ganttChartController");

router.post('/', controller.index);

module.exports = router;
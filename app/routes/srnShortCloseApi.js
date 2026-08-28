const router = require("express").Router();
const controller = require('../controllers/srnShortCloseController');

// GET
router.post('/', controller.srnLists);

router.post('/update', controller.shortClose);

module.exports = router;
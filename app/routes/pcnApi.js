const router = require("express").Router();
const controller = require("../controllers/pcnControler");

router.get('/uniqueNo', controller.getSrnNo);
router.get('/template', controller.template);
router.get('/', controller.showData);

router.post('/import', controller.import);
router.post('/store', controller.storePCN);

module.exports = router;
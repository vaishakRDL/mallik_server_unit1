const router = require("express").Router();
const controller = require("../controllers/docController");

router.get('/', controller.authPendingDoc);
router.post('/', controller.authDocs);
router.post('/sendMail', controller.sendMail);
// router.post('/testMail', controller.testMail);

module.exports = router;
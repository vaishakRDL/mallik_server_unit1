const router = require("express").Router();
const boxkit = require("../controllers/boxKitController");

router.get('/getContract', boxkit.getContract);


router.post('/getPart', boxkit.getPart);
router.post('/upload', boxkit.upload);
router.post('/viewFile', boxkit.viewFile);
router.post('/view', boxkit.view);


module.exports = router;
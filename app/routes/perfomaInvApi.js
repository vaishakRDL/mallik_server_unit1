const router = require("express").Router();
const perfoma = require('../controllers/perfomaInvController');
const accExl = require('../controllers/excel/AccExlController');



router.get('/getItems', perfoma.getItems);
router.get("/template", accExl.perfomaTemp);

router.get("/:id", perfoma.invShow);
router.get("/exportInv/:id", accExl.exportInv);

router.post('/', perfoma.store);
router.post('/unique', perfoma.uniqueId);
router.post('/import', accExl.perfomaImport);

router.put('/', perfoma.update);

router.delete('/:id', perfoma.delete);

module.exports = router;

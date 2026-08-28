const router = require("express").Router();
const controller = require("../controllers/mrnController");

// GET 
router.get('/',  controller.show);
router.get('/view',  controller.viewMrn);
router.get('/search',  controller.search);
router.get('/:id',  controller.mrnItem);
router.get('/download/excel',  controller.downloadItemExcel);

router.post('/',  controller.store);
router.post('/uniqueId',  controller.uniqueId);
router.post('/getMrnDetails',  controller.getMrnDetails);
router.post('/importItems/import',  controller.importItems);

router.put('/:id',  controller.update);

router.delete('/:id', controller.deleteMrn);

module.exports = router;
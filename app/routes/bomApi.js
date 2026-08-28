const bom = require('../controllers/bomController');
const bomExl = require('../controllers/excel/bomExlController');
const router = require('express').Router();

// GET
router.get('/template', bomExl.template);
router.get('/details', bomExl.showAllRecords);
router.get('/export', bomExl.bomDetails);
router.get('/items', bom.itemSearch);
router.get('/mainParts', bom.fetchMainParts);
router.get('/itemDetails', bom.itemDetails);
router.get('/getBomList', bom.getList);

// PUT
router.put('/update', bom.updateBom);

// DELETE
router.delete('/items/:id', bom.delItem);
router.delete('/delete/:itemCode', bom.bomMstDlt);

// POST
router.post('/import', bom.import);
router.post('/store', bom.storeBom);
// router.post('/getBomList', bom.getList);

module.exports = router;
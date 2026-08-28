const router = require("express").Router();
const supplier = require('../controllers/supplierController');

router.get('/', supplier.show);
router.get('/searchCity', supplier.searchCity);
router.get('/getId', supplier.generateId);
router.get('/display', supplier.display);
router.get('/:id', supplier.showById);
router.get('/getFiles/:id', supplier.docShow);
router.get('/download/:id', supplier.docDownload);


router.post('/', supplier.store);
router.post('/uploadFile', supplier.docUpload);

router.put('/update/:id', supplier.update);

router.delete('/:id', supplier.delete);
router.delete('/deleteFile/:id', supplier.docDelete);
router.delete('/deleteFileById/:id', supplier.docDeleteById);




module.exports = router;
const router = require('express').Router();
const multer = require('multer');
const bulkUpdateController = require('../controllers/bulkUpdate.controller');
const excelBulkLoadController = require('../controllers/excelBulkLoad.controller');

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 } // 10MB limit
});

router.post('/master', bulkUpdateController.bulkUpdateMaster);
router.post('/load', upload.single('file'), excelBulkLoadController.loadExcel);

module.exports = router;

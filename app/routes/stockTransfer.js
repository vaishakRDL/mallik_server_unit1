const stock = require('../controllers/stockTransferController');
const router = require('express').Router();

router.get('/uniqueId', stock.uniqueId);
router.get("/search", stock.search);
router.get('/getItems', stock.getItems);
router.get('/:id', stock.showById);

// router.get('/gstInvoices/:id', stock.gstInvoices);
// router.get('/items/:id', stock.invItems);

router.post('/', stock.store);

module.exports = router;
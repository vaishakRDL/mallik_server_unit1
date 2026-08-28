const router = require("express").Router();
const customer = require('../controllers/customerMstController');
const custExl = require('../controllers/excel/custExlController')

// GET routes
router.get('/template', custExl.template);
router.get('/search', customer.search);
router.get('/get', customer.getCustomers);
router.get('/', customer.show);

// PUT DELETE routes
router.put('/:id', customer.update);
router.delete('/:id', customer.delete);

// POST routes
router.post('/import', custExl.import);
router.post('/store', custExl.storeBulk);
router.post('/', customer.store);

module.exports = router;
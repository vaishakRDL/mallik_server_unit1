const creditNote = require('../controllers/creditNoteController');
const router = require('express').Router();


router.get('/uniqueId', creditNote.uniqueId);
router.get('/customer', creditNote.invCustomer);
router.get('/getItems', creditNote.getItems);
router.get('/:id', creditNote.showById);

router.get('/gstInvoices/:id', creditNote.gstInvoices);
router.get('/items/:id', creditNote.invItems);

router.post('/', creditNote.store);

module.exports = router;
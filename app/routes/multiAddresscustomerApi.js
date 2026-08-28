const controller = require('../controllers/multiAddCustomerController');
const router = require('express').Router();

router.post('/', controller.store);
router.put('/:id', controller.update);
router.delete('/:id', controller.deleteById);
router.delete('/delete/:id', controller.delete);
router.get('/:id', controller.show);


module.exports = router;
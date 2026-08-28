const cp = require('../controllers/suppConPrsnController');
const router = require('express').Router();

router.post('/', cp.store);
router.put('/:id', cp.update);
router.delete('/:id', cp.deleteById);
router.delete('/delete/:id', cp.delete);
router.get('/:id', cp.show);

module.exports = router;
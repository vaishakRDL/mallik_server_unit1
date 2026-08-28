const master = require('../controllers/masterController');
const router = require('express').Router();

router.post('/', master.store);
router.put('/:id', master.update);
router.delete('/:id', master.delete);
router.get('/:master', master.show);


module.exports = router;
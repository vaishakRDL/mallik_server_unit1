const itemMst = require('../controllers/itemMstController');
const router = require('express').Router();

router.post('/', itemMst.store);
router.put('/:id', itemMst.update);
router.delete('/:id', itemMst.delete);
router.get('/:master', itemMst.show);


module.exports = router;
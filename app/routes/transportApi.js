const router = require("express").Router();
const transport = require('../controllers/transportController');


router.get('/', transport.show);
router.post('/',transport.store);
router.put('/:id', transport.update);
router.delete('/:id', transport.delete);



module.exports = router;
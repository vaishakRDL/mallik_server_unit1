const csl = require('../controllers/cslController');
const router = require('express').Router();


router.get('/missing/:id', csl.missingCsl);
router.get('/search', csl.search);
router.get('/:id', csl.fetch);

router.post('/', csl.store);
router.post('/show', csl.show);

router.put('/:id', csl.update);

router.delete('/:id', csl.delete);


module.exports = router;
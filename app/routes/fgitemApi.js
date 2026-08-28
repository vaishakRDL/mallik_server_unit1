const router = require("express").Router();
const fgitem = require('../controllers/Fgitem');

router.get('/', fgitem.show);
router.get('/custDcAll', fgitem.custDcpartAll);

router.get('/search/po', fgitem.getPo);
router.get('/search/dcItm', fgitem.dcItm);
router.get('/search/poItem/:id', fgitem.poItm);


router.post('/', fgitem.store);

router.post('/showDtl', fgitem.showDtl);

router.put('/update', fgitem.update);

module.exports = router;
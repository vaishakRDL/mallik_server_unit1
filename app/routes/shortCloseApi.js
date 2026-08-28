const router = require("express").Router();
const shortClose = require('../controllers/shortCloseController');


router.post('/getData', shortClose.showData) ;
router.post('/save', shortClose.save) ;
router.put('/shortCls', shortClose.shortCls) ;

module.exports = router;
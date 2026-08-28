const master = require('../controllers/masterController');
const router = require('express').Router();

router.get('/template', master.downloadTemplate);
router.get('/export', master.downloadMasters);
router.get('/companyInfo', master.fetchCompanyInfo);
router.get('/getState/:id', master.getState);

router.get('/getEmailSettings', master.getEmailSettings);

router.get('/:master', master.show);

router.post('/', master.store);
router.post('/import', master.importMasters);
router.post('/companyInfo', master.storeCompanyInfo);

router.put('/:id', master.update);
router.put('/updateEmailSettings/:id', master.updateEmailSettings);


router.delete('/:id', master.delete);

module.exports = router;
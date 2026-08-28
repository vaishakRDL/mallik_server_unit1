const supJc = require('../controllers/supervisorJcController.js');
const router = require('express').Router();

router.get("/getMachine", supJc.machine);
router.get("/getMaterial", supJc.material);
router.get("/getNetWeight/:id", supJc.netWeight);
router.get("/getUnique", supJc.unique);
router.get("/viewSrnDoc", supJc.viewSrnDoc);

router.post('/jc', supJc.jobCard);
router.post('/nestShow', supJc.nestShow);
router.post('/nestShowDtl', supJc.nestShowDtl);
router.post('/rqstMaterial', supJc.rqstMaterial); 
router.post('/manualRqstMaterial', supJc.manualRqstMaterial); 

router.post('/getList2', supJc.getList2); 

router.put('/submit', supJc.submit); 

module.exports = router;
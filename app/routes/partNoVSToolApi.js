const express = require('express');
const router = express.Router();
const controller = require('../controllers/partNoVSProcessVSToolController');

router.get('/getpartnovstool', controller.getAllPartNoVsTool);   
router.get('/gettoolno/:id', controller.getPartNoVsToolByToolId);   
router.get('/getmachineprocess/:id', controller.getMachineProcess);  
router.get('/gettemplate', controller.downloadPartNoVsToolTemplate);  
router.get('/gettool', controller.getTool);      
router.get('/search/:id', controller.search);

router.post('/addpartnovstool', controller.addPartNoVsTool);  
router.post('/importpartnovstool', controller.importPartNoVsTool);  


router.put('/updatepartnovstool/:id', controller.updatePartNoVsTool);   


router.delete('/deletepartnovstool/:id', controller.deletePartNoVsTool);   


module.exports = router;
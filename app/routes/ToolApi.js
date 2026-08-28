const express = require('express');
const router = express.Router();
const controller = require('../controllers/addToolController');

router.get('/gettool', controller.getAllTools);       
router.get('/toolexceldownload', controller.downloadToolTemplate);
router.get('/toolitemcode', controller.toolitemcode);  
router.get('/getToolList', controller.getToolList);  
router.get('/getToolDetails', controller.getToolDetails);  
router.get('/list', controller.toolsList);  
router.get('/machines', controller.machineList);  
router.get('/:id', controller.getToolById);                  
router.get('/getMachineProcessMap/show', controller.getMachineProcessMap);                  
router.get('/downloadToolTemplate/download', controller.downloadToolsTemplate);                  
router.get('/toolTree/tree', controller.tooltree);               
router.get('/toolDetailsExport/export', controller.toolDetailsExport);               

router.post('/addtool', controller.AddTool);  
router.post('/importtool', controller.importTool);
router.post('/generateToolCount/generate', controller.generateToolCount);
router.post('/importToolsExcel/getimport', controller.importToolsExcel);
router.post('/storeValidatedTools/store', controller.storeValidatedTools);

router.put('/gettoolcount', controller.updateToolUsageCount);   
router.put('/updatetool/:id', controller.updateTool);    
router.put('/updateToolMappingCount/:id', controller.updateToolMappingCount);    
router.put('/updateMappedTool', controller.updateMappedTool);    
 
router.delete('/deletetool/:id', controller.deleteTool);                
router.delete('/deleteToolMapping/:id', controller.deleteToolMapping);                

module.exports = router;
const router = require("express").Router();
const controller = require("../controllers/jobWorkIssueController");

// GET 
router.get('/',  controller.show);
router.get('/itemsList',  controller.jobWorkItems);
router.get('/dcNo',  controller.getDcNo);
router.get('/items',  controller.itemsList);
router.get('/delSchedule',  controller.delSchedule);
router.get('/pending',  controller.loadPendingJobWork);
router.get('/json',  controller.jsonDoc);
router.get('/serachRemarks',  controller.serachRemarks);
router.get('/pendingJobWork',  controller.pendingJobWork);
router.get('/exportReport',  controller.downloadReport);
router.get('/quarantineStock',  controller.loadQuarantineStock);
router.get('/searchItem',  controller.searchItem);
router.get('/getItemDetails',  controller.getItemDetails);

// PUT
router.put('/update',  controller.updateJobWork);

// DELETE
router.delete('/delete',  controller.deleteJobWork);

// POST
router.post('/',  controller.store);
router.post('/viewReport',  controller.viewReport);
router.post('/itcJwReport',  controller.itcJobWorkReport);
router.post('/getJobworkReceiptsReport',  controller.getJobworkReceiptsReport);


module.exports = router;
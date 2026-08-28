const router = require("express").Router();
const controller = require("../controllers/jobWorkRecieptController");

// GET 
router.get('/uniqueNo',  controller.jwrNo);
router.get('/search',  controller.searchJwrNo);
router.get('/',  controller.show);

// POST
router.post('/store',  controller.store);

// PUT
router.put('/update',  controller.update);

// DELETE
router.delete('/delete',  controller.delete);

module.exports = router;
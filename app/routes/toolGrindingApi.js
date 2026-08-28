const express = require('express');
const router = express.Router();
const controller = require('../controllers/toolGrindingController');

router.get('/gettoolgrinding', controller.getToolGrinding);
router.put('/updategrinding/:id', controller.updateToolGrinding);
router.delete('/deletegrinding/:id', controller.deleteToolGrinding);





module.exports = router;
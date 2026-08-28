const router = require("express").Router();
const alloc = require("../controllers/allocateController");

router.get('/mrp', alloc.fetchMrp);
router.get('/jc/:id', alloc.fetchJc);
router.put('/update/:id', alloc.allocate);
router.put('/automatic/:id', alloc.automaticAlloc);

router.put('/mode', alloc.updateMode);
router.get('/mode', alloc.fetchMode);

router.get('/sfg', alloc.storeSfg);

module.exports = router;
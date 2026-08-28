const router = require("express").Router();
const sale = require('../controllers/salesController');
const saleOrder = require('../controllers/salesOrderController');

// Utility / helper
router.get("/getOrderNo", sale.getOrderNo);

// CRUD
router.get("/", sale.show);
router.post("/", sale.store);
router.put("/:id", sale.update);
router.delete("/:id", sale.delete);

// Fetching based on custom logic
router.post("/fetch", sale.fetch);


// Template download
router.get("/order/template", saleOrder.template);
router.get("/order/:id", saleOrder.show);

// CRUD
router.post("/order", saleOrder.store);
router.put("/order/:id", saleOrder.update);

// Delete (by id or custom route)
router.delete("/order/deleteById/:id", saleOrder.deleteById);
router.delete("/order/delete/:id", saleOrder.delete);

// Fetch and import
router.post("/order/fetch", saleOrder.fetch);
router.post("/order/import", saleOrder.importItems);

module.exports = router;

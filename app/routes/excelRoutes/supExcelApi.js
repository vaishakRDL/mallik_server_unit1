const excel = require("../../controllers/excel/supExcelController");
const router = require("express").Router();

router.get("/template", excel.template);
router.post("/import", excel.import);
  
module.exports = router;
const skillmatrics = require("../controllers/skillmatricsController.");
const router = require("express").Router();
router.get("/getId", skillmatrics.getId);
router.get("/downloadtemp", skillmatrics.downloadtemp);
router.get("/machine", skillmatrics.machinelist);
router.post("/", skillmatrics.store);
router.get("/", skillmatrics.show);
router.put("/:id", skillmatrics.update);
router.delete("/:id", skillmatrics.delete);
router.post("/viewFile", skillmatrics.viewFile);
router.post("/importSkillmatrics/import", skillmatrics.importSkillmatricsExcel);
router.post("/uploadSkillmatricsFiles", skillmatrics.uploadSkillmatricsFiles);


module.exports = router;
const npd = require("../controllers/npdController");
const router = require("express").Router();


router.get("/search", npd.search);
router.get("/getId", npd.getId);
router.get("/dltLog", npd.dltLog);
router.get("/docDownload/:id", npd.docDownload);
router.get("/revision/:id", npd.revShow);

router.post("/", npd.store);
router.post("/showData", npd.show);
router.post("/fileUpload", npd.fileUpload);
router.post("/revision", npd.revStore);
router.post("/viewFile", npd.viewFile);

router.put("/:id", npd.update);
router.put("/revision/:id", npd.revUpdate);

router.delete("/:id", npd.delete);
router.delete("/revision/:id", npd.revDelete);



module.exports = router;


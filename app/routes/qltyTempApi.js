const temp = require("../controllers/qltyTempController");
const router = require("express").Router();

router.get("/", temp.show);
router.get("/inspec", temp.inspecShow);
router.get("/qc/:id", temp.qcShow);


router.post("/", temp.store);
router.post("/inspec", temp.inspecStore);
router.post("/qc", temp.qcStore);


router.put("/inspec/:id", temp.inspecUpdate);
router.put("/qc/:id", temp.qcUpdate);
router.put("/:id", temp.update);

router.delete("/inspec/:id", temp.inspecDelete);
router.delete("/qc/:id", temp.qcDelete);
router.delete("/:id", temp.delete);


module.exports = router;


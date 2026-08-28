const assembly = require("../controllers/assemblydowntime");
const router = require("express").Router();

router.get("/machines", assembly.Showmachines);
router.get("/reasons", assembly.Showdowntimereasons);


module.exports = router;

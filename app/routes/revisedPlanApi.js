const controller = require("../controllers/revisedPlanController");
const router = require("express").Router();
const multer = require("multer");

const upload = multer({
  storage: multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
  }),
  limits: { fileSize: 200 * 1024 * 1024 } // allow 200MB if needed
});

router.post("/compareCslAndSob", controller.compareCslAndSob);
router.post("/processRevisedPlan", controller.processRevisedPlan);
router.post(
    "/processCslAndSob",
    upload.fields([
        { name: "cslFile", maxCount: 20 }, // multiple CSL files
        { name: "sobFile", maxCount: 1 }   // single SOB file
    ]),
    controller.processCslAndSob
);


module.exports = router;

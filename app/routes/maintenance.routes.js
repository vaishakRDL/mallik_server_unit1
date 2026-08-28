const router = require("express").Router();
const controller = require("../controllers/maintenance.controller");
const normalizeFilePaths = require("../middlewares/filePath.middleware");
const upload = require("../middlewares/upload.middleware");

router.get("/supervisors", controller.supervisorList);
router.get("/machines", controller.machineList);
router.get("/operators", controller.operatorList);
router.get("/details", controller.getMaintenanceDetails);
router.get("/records/breakdown", controller.getBreakdownMaintenanceRecords);
router.get("/mtbf", controller.getMTBFReport);

router.route("/schedule")
    .get(controller.getMaintenanceSchedule)
    .post(
        upload("maintenance").fields([
            { name: "bd_img1", maxCount: 1 },
            { name: "bd_img2", maxCount: 1 },
            { name: "bd_img3", maxCount: 1 },
            { name: "bd_img4", maxCount: 1 }
        ]),
        normalizeFilePaths("maintenance"),
        controller.createMaintenanceSchedule
    );

router.post("/schedule/process", controller.processMaintenanceSchedule);

module.exports = router;
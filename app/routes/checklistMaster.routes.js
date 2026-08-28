const { Router } = require("express");
const {
    createChecklistMaster,
    getAllChecklistMasters,
    getChecklistMasterById,
    updateChecklistMaster,
    deleteChecklistMaster,
    assignToolsToChecklist,
    getAssignedTools,
    exportChecklistMaster,
    getMappedChecklistsByTool
} = require("../controllers/checklistMaster.controller");

const router = Router();

router.post("/", createChecklistMaster);
router.get("/", getAllChecklistMasters);
router.get("/:id", getChecklistMasterById);
router.put("/:id", updateChecklistMaster);
router.delete("/:id", deleteChecklistMaster);
router.post("/:id/assign", assignToolsToChecklist);
router.get("/:id/tools", getAssignedTools);
router.get("/:id/export", exportChecklistMaster);
router.get("/tool/:toolId", getMappedChecklistsByTool);

module.exports = router;

const { Router } = require("express");
const {
    generateChecklist,
    getChecklist,
    getExecutionData,
    submitChecklist
} = require("../controllers/checklistExecution.controller");
const {
    getChecklistReport,
    getChecklistKPIs
} = require("../controllers/checklistReport.controller");

const router = Router();

router.post("/generate", generateChecklist);
router.get("/", getChecklist);
router.get("/report", getChecklistReport);
router.get("/kpis", getChecklistKPIs);
router.get("/:id", getExecutionData);
router.post("/submit", submitChecklist);

module.exports = router;
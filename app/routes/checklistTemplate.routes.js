const { Router } = require("express");
const {
    createTemplate,
    addFields,
    addChecklistItems,
    getTemplate,
    fetchTemplate,
    getSectionsById,
    getSectionFields,
    getTemplateItems,
    updateTemplate,
    deleteTemplate
} = require("../controllers/checklistTemplate.controller");

const router = Router();

router.post("/", createTemplate);
router.post("/fields", addFields);
router.post("/items", addChecklistItems);
router.get("/", fetchTemplate);
router.get("/:templateId/items", getTemplateItems);
router.get("/:id", getTemplate);
router.get("/sections/:sectionId/fields", getSectionFields);
router.get("/sections/:id", getSectionsById);
router.put("/:id", updateTemplate);
router.delete("/:id", deleteTemplate);

module.exports = router;
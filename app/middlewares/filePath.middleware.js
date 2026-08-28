const path = require("path");

const normalizeFilePaths = (folder) => (req, res, next) => {
    if (!req.files) return next();

    const images = {};

    for (const field in req.files) {
        const file = req.files[field][0];

        images[field] = file
            ? `${folder}/${file.filename}`
            : null;
    }

    req.uploadedImages = images;

    next();
};

module.exports = normalizeFilePaths;
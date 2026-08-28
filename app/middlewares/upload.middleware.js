const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

/* Allowed MIME Types */
const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/svg+xml"
];

/* Ensure Upload Folder Exists */
const createUploadFolder = (folder) => {
    const uploadPath = path.join(process.cwd(), "public", folder);

    if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
    }

    return uploadPath;
};

/* Multer Storage */
const createStorage = (folder = "general") => multer.diskStorage({

    destination: (req, file, cb) => {
        const uploadPath = createUploadFolder(folder);
        cb(null, uploadPath);
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `${uuidv4()}${ext}`;
        cb(null, filename);
    }
});

/* File Filter */
const fileFilter = (req, file, cb) => {

    if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(new Error("Invalid file type. Only images are allowed."));
    }

    cb(null, true);
};

/* Upload Factory */
const upload = (folder = "general") => multer({
    storage: createStorage(folder),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter
});

module.exports = upload;
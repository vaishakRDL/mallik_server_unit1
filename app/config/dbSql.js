const mysql2 = require('mysql2/promise');
const logger = require('../utility/logger');
require('dotenv').config();

// Database connection
const connection = mysql2.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 200,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Shop floor DB connection
const secondaryDB = mysql2.createPool({
    host: process.env.S_DB_HOST,
    user: process.env.S_DB_USER,
    database: process.env.S_DB_DATABASE,
    password: process.env.S_DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 100,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Barcode DB 
const barcodeDB = mysql2.createPool({
    host: process.env.BARCODE_DB_HOST,
    user: process.env.BARCODE_DB_USER,
    database: process.env.BARCODE_DB_NAME,
    password: process.env.BARCODE_DB_PASS,
    waitForConnections: true,
    connectionLimit: 25,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Custom error handling
class CustomError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        Error.captureStackTrace(this, this.constructor);
    }
}

// Error Response handling
function handleErrorResponse(res, err) {
    if (err instanceof CustomError) {
        return res.status(err.statusCode || 400).json({
            success: false,
            message: err.message
        });
    } else {
        logger.error({
            message: err.message,
            stack: err.stack
        });
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: err.message
        });
    }
}

// Success Response handling
function handleSuccessResponse(res, message, data) {
    return res.status(200).json({
        success: true,
        message,
        data
    });
};

module.exports = { connection, CustomError, handleErrorResponse, handleSuccessResponse, secondaryDB, barcodeDB };

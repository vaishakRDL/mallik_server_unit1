const fs = require('fs');
const { connection, CustomError } = require('../config/dbSql');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const axios = require('axios');
const { generateDocNo } = require('./docNo');

// Image extension
function getExtension(image) {
    const extension = image.substring(image.indexOf('/') + 1, image.indexOf(';'));
    if (extension === 'jpg') {
        return 'jpg';
    } else if (extension === 'png') {
        return 'png';
    } else if (extension === 'jpeg') {
        return 'jpeg';
    } else if (extension === 'mp4') {
        return 'mp4';
    } else if (extension === 'vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        return 'xlsx';
    } else {
        return extension;
    }
}

//used only in Npd Upload Function
function storeFiles(images, folder) {
    if (images && images.length > 0) {
        const folderPath = path.join('public/', folder);

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true }); // If the folder doesn't exist, create it
        }

        const storedImagePaths = [];


        images.forEach((image) => {
            // if (image.data && image.name !== 'desktop.ini') {
            if (image.data && path.extname(image.name) !== '.ini') {

                const base64Data = image.data.split(';base64,')[1];
                const imageBuffer = Buffer.from(base64Data, 'base64');
                const fileName = path.basename(image.name); // Extract the file name
                const imagePath = path.join(folder, fileName).replace(/\\/g, '/'); // Replace backslashes with forward slashes

                const fullImagePath = path.join(folderPath, fileName); // Construct the full image path

                fs.writeFileSync(fullImagePath, imageBuffer);
                storedImagePaths.push(imagePath); // Push the relative file path
            }
        });


        return storedImagePaths; // Return array of relative file paths
    } else {
        return 'No image data found';
    }
}


// Image storing function
function storeFile(image, folder) {
    if (image) {
        const folderPath = path.join('public/', folder);

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });      // If the folder doesn't exist, create it
        }
        const extension = getExtension(image);
        const base64Data = image.split(',')[1];;
        const imageBuffer = Buffer.from(base64Data, 'base64');
        const imageName = `${folder}/${uuidv4()}.${extension}`;
        const imagePath = path.join(`public/`, imageName);

        fs.writeFileSync(imagePath, imageBuffer);

        return imageName;
    } else {
        return null;
    }
};

async function urlSaveDownload(imageUrl, folder) {
    if (!imageUrl) return null;

    try {
        const folderPath = path.join('public/', folder);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        const imageName = `${folder}/${uuidv4()}.png`;
        const imagePath = path.join('public/', imageName);

        // Download the image
        const response = await axios({
            url: imageUrl,
            responseType: 'stream',
        });

        const writer = fs.createWriteStream(imagePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        return imageName;
    } catch (error) {
        console.error("Error downloading image:", error);
        return null;
    }
}




// Image storing function based on provided field data
function storeFileReq(image, folder, field) {
    if (image) {
        const folderPath = path.join('public', folder); // Folder path includes 'public'

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true }); // If the folder doesn't exist, create it
        }

        const extension = getExtension(image);
        const base64Data = image.split(',')[1];
        const imageBuffer = Buffer.from(base64Data, 'base64');

        let counter = 1;
        let imageName;
        let imagePath;

        do {
            imageName = `${field}(${counter}).${extension}`; // Construct file name
            imagePath = path.join(folderPath, imageName);
            counter++;
        } while (fs.existsSync(imagePath));

        fs.writeFileSync(imagePath, imageBuffer);

        // Remove 'public/' from the start of imagePath when returning it
        const dbPath = imagePath.replace(/^public[\\/]/, '');

        return dbPath; // Return the path without 'public'
    } else {
        return 'No image data found';
    }
}

async function uniqueId([tableName, idPrefix, uId]) {
    const sql = `
        SELECT ?? 
        FROM ?? 
        ORDER BY id DESC 
        LIMIT 1
    `;

    const [rows] = await connection.query(sql, [uId, tableName]);

    if (!rows.length) {
        return `${idPrefix}-1`;
    }

    const lastValue = rows[0][uId] || `${idPrefix}-0`;
    const num = parseInt(lastValue.split("-")[1], 10) || 0;

    return `${idPrefix}-${num + 1}`;
}

function exportFile(res, docPath, fileName) {
    const filePath = path.join(docPath);
    if (fs.existsSync(filePath)) {
        const fileExtension = path.extname(filePath).toLowerCase();
        let contentType = 'application/octet-stream'; // Default content type for unknown file types
        const exportedName = fileName + fileExtension;

        switch (fileExtension) {
            case '.pdf':
                contentType = 'application/pdf';
                break;
            case '.xlsx':
                contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                break;
            case '.jpg':
            case '.jpeg':
                contentType = 'image/jpeg';
                break;
            case '.png':
                contentType = 'image/png';
                break;
        }

        // Set the appropriate headers for the response
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename=${exportedName}`);

        // Stream the file to the response
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

    } else {
        res.status(404).send('File not found');
    }
}


async function getUniqueId(table, col, prefix, rowNo) {
    try {
        const [rows, fields] = await connection.execute(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 1`, []);

        const uId = (rows.length > 0 && rows[0][col] !== "" && rows[0][col] !== null) ? rows[0][col] : `${prefix}-0`;

        // Extract the numeric part and increment by 1
        const len = parseInt(uId.split('-')[1]);
        const increment = len + rowNo;
        const newStr = `${prefix}-${increment}`;

        return newStr;
    } catch (error) {
        //console.log(error.message);
        throw error;
    }
}


async function fetchItemId(itemCode) {
    try {
        if (!itemCode) {
            throw new CustomError('Item code is null or undefined');
        }

        const [rows, fields] = await connection.execute(`SELECT id FROM items WHERE itemCode = ?`, [itemCode]);

        if (rows.length > 0) {
            return rows[0].id;
        }
        throw new CustomError(`Invalid Item Code ${itemCode}`);
    } catch (error) {
        // console.error(`Error fetching ${master} id: ${error.message}`);
        throw error;
    }
}

async function fetchItemIds(itemCodes) {
    if (!Array.isArray(itemCodes) || itemCodes.length === 0) {
        throw new CustomError("Item code list is empty");
    }

    const [rows] = await connection.query(
        `SELECT id, itemCode, itemName FROM items WHERE itemCode IN (?)`,
        [itemCodes]
    );

    const itemMap = {};
    for (const row of rows) {
        itemMap[row.itemCode] = { id: row.id, itemName: row.itemName };
    }

    return itemMap;
}

async function fetchOpQty(item) {
    try {

        const [rows, fields] = await connection.execute(`SELECT opQty FROM opening_stock WHERE itemId = ?`, [item]);

        if (rows.length > 0) {
            return rows[0].opQty;
        } else {
            return 0;
        }
    } catch (error) {
        // console.error(`Error fetching ${master} id: ${error.message}`);
        throw error;
    }
}

async function currentDateTime() {
    try {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        const formattedDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        return formattedDate;
    } catch (error) {
        console.error(`Error fetching Date: ${error.message}`);
        throw errror;
    }
}

async function getOrderNo(req) {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { uniqueNo } = await generateDocNo(conn, req, { docType: 'OrderPlan' });

        await conn.commit();
        return uniqueNo;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function updateOrderNo() {
    const currentDate = new Date();
    const yearMonth = `${currentDate.getFullYear()}${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;

    await connection.execute(`
        UPDATE counter SET number = number + 1 WHERE counterType = ? AND month = ?`,
        ['OrderPlan', yearMonth]
    );

    return true;
}

async function updateCounter(counterType) {
    await connection.execute(`
        UPDATE counter SET number = number + 1 WHERE counterType = ?`,
        [counterType]
    );

    return true;
}

// Format date and time to d-m-Y H:i:s
async function formatDate(inputDate) {
    const originalDate = new Date(inputDate.toString()); // Convert input date to string explicitly
    let formattedDate;

    const dateOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };

    const containsT = inputDate.toString().includes('T'); // Check if converted input date contains 'T'
    formattedDate = originalDate.toLocaleDateString('en-GB', dateOptions).replace(/\//g, '-');

    if (containsT) formattedDate += ' ' + originalDate.toLocaleTimeString('en-GB', timeOptions);

    return formattedDate;
}


async function dateFormatUpperCase(kanbanDate) {
    const [year, month, day] = kanbanDate.split('-');
    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const monthIndex = parseInt(month) - 1; // Month index starts from 0
    const monthName = (monthIndex > 12 || monthIndex < 0) ? monthIndex.toString() : monthNames[monthIndex];
    const formattedDate = `${day}-${monthName.toUpperCase()}-${year.slice(2)}`;

    return formattedDate;
}


async function decodeBase64(file) {
    if (!file || file == "") {
        throw new CustomError('file can not be empty!', 400);
    }
    const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
    const base64Data = file.replace(base64URL, '');

    const buffer = Buffer.from(base64Data, 'base64');

    return buffer;
}

async function decodeExcelBase64(file) {
    if (!file || typeof file !== "string" || file.trim() === "") {
        throw new CustomError("File cannot be empty!", 400);
    }

    let base64Data = file.trim();

    // ⭐ Remove ANY Base64 header: data:*/*;base64,
    const prefixMatch = base64Data.match(/^data:.*;base64,/i);
    if (prefixMatch) {
        base64Data = base64Data.slice(prefixMatch[0].length);
    }

    let buffer;
    try {
        buffer = Buffer.from(base64Data, "base64");
    } catch {
        throw new CustomError("Invalid Base64 encoding!", 400);
    }

    // ⭐ Magic number (first 4 bytes)
    const magic = buffer.slice(0, 4).toString("hex").toUpperCase();

    const XLSX_MAGIC = "504B0304";  // ZIP-based Excel (.xlsx, .xlsm)
    const XLS_MAGIC = "D0CF11E0";  // OLE2 Excel (.xls)

    // Allow both XLS and XLSX
    if (magic !== XLSX_MAGIC && magic !== XLS_MAGIC) {
        throw new CustomError(
            "Invalid Excel file! Only .xls or .xlsx formats are supported.",
            400
        );
    }

    return buffer;
}

// Function to get local IP address
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const interfaceName in interfaces) {
        const iface = interfaces[interfaceName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '127.0.0.1'; // Default to localhost if no IP address found
}

async function getUser(req) {
    const userName = req.headers.username ?? 'admin';
    return userName;
}

async function calculateDayDifference(date1, date2) {
    // Parse the dates
    const firstDate = new Date(date1);
    const secondDate = new Date(date2);

    // Calculate the difference in milliseconds
    const differenceInMilliseconds = secondDate - firstDate;

    // Convert the difference from milliseconds to days
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const differenceInDays = differenceInMilliseconds / millisecondsPerDay;

    return differenceInDays;
}

const getCurrentTime = () => {
    const now = new Date();
    const options = {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    };
    const formatter = new Intl.DateTimeFormat('en-GB', options);
    const parts = formatter.formatToParts(now);
    const time = {
        hour: parts.find(p => p.type === 'hour')?.value || '00',
        minute: parts.find(p => p.type === 'minute')?.value || '00',
        second: parts.find(p => p.type === 'second')?.value || '00',
    };
    return `${time.hour}:${time.minute}:${time.second}`;
};

const getCurrentShift = () => {
    const shiftTimings = {
        1: { start: '06:00:00', end: '14:00:00' },
        4: { start: '08:00:00', end: '17:00:00' },
        2: { start: '14:00:00', end: '22:00:00' },
        3: { start: '22:00:00', end: '06:00:00' }
    };

    const timeToNumber = (time) => {
        return time.split(':').reduce((acc, timeUnit) => (60 * acc) + +timeUnit, 0);
    };

    const curTimeNumber = timeToNumber(getCurrentTime());

    let currentShift = [];

    for (const [shiftId, timings] of Object.entries(shiftTimings)) {
        const start = timeToNumber(timings.start);
        const end = timeToNumber(timings.end);

        if (end <= start) {
            // Shift crosses midnight
            if (curTimeNumber >= start || curTimeNumber < end) {
                currentShift.push(parseInt(shiftId));
            }
        } else {
            // Shift does not cross midnight
            if (curTimeNumber >= start && curTimeNumber < end) {
                currentShift.push(parseInt(shiftId));
            }
        }
    }

    return currentShift;
}

const getDocNo = async (docType) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const docObj = {
            So: { pattern: 'SO', leadZero: 0 },
            Po: { pattern: 'PO', leadZero: 0 },
            Srn: { pattern: 'SRN', leadZero: 0 },
            JobCard: { pattern: 'JC', leadZero: 0 },
            Sfg: { pattern: '', leadZero: 5 },
            Mrp: { pattern: '-MRP', leadZero: 3 },
        };

        if (!docObj[docType]) {
            throw new Error('Invalid document type');
        }
        const { pattern, leadZero } = docObj[docType];

        const currentDate = new Date();
        const yearMonth = `${currentDate.getFullYear().toString().slice(-2)}${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;

        let incNo = 1;

        const [counterRows] = await conn.execute(
            `SELECT number FROM counter WHERE counterType = ? AND month = ?`,
            [docType, yearMonth]
        );

        if (counterRows.length === 0) {
            const [rows] = await conn.execute(
                `UPDATE counter SET month = ?, number = ? WHERE counterType = ? AND month != ?`,
                [yearMonth, incNo, docType, yearMonth]
            );

            if (rows.affectedRows === 0) {
                await conn.execute(
                    `INSERT INTO counter(counterType, month, number) VALUES(?, ?, ?)`,
                    [docType, yearMonth, incNo]
                );
            }
        } else {
            incNo = counterRows[0].number;
        }
        await conn.commit();

        const numStr = incNo.toString().padStart(leadZero, '0');

        return `${yearMonth}${pattern}${numStr}`;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
};

// Function to format date from ISO string or dd/mm/yyyy / dd-mm-yyyy to yyyy-mm-dd
const dateFormat = (dateStr) => {
    if (!dateStr) return null;

    // Case 1: If it's a Date object
    if (dateStr instanceof Date) {
        return dateStr.toISOString().split('T')[0]; // Extract YYYY-MM-DD
    }

    // Case 2: If it's an ISO string like "2025-10-30T00:00:00.000Z"
    if (typeof dateStr === 'string' && dateStr.includes('T')) {
        return dateStr.split('T')[0]; // Keep only YYYY-MM-DD
    }

    // Case 3: If it's in dd/mm/yyyy or dd-mm-yyyy format
    if (typeof dateStr === 'string') {
        const cleaned = dateStr.replace(/-/g, '/');
        const [day, month, year] = cleaned.split('/');
        if (!day || !month || !year) return null;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    return null;
};


const currentDateTimeInd = () => {
    const now = new Date().toLocaleString("en-GB", {
        timeZone: "Asia/Kolkata",
        hour12: false
    });

    const [date, time] = now.split(', ');
    const [day, month, year] = date.split('/');

    return `${year}-${month}-${day} ${time}`;
}


function storeFilesexcel(buffer, fileName, folder) {
    const folderPath = path.join('public', folder);

    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }

    const filePath = path.join(folderPath, fileName);
    fs.writeFileSync(filePath, buffer);

    // Return path for reading later
    return filePath;
}



async function company() {
    try {
        const companyQuery = `
            SELECT 
                cd.companyName,  cd.address AS companyAdd, cd.email, cd.telNo, cd.website,
                cd.image AS companyImage,  cd.gstNo As cmpGstNo,  cd.cinNo As cmpCinNo,  cd.panNo As cmpPanNo
            FROM company_details cd
            LIMIT 1
        `;

        const [rows] = await connection.execute(companyQuery);

        // Return single company record or null if not found
        return rows.length > 0 ? rows[0] : null;

    } catch (error) {
        console.error('Error fetching company details:', error.message);
        throw error;
    }
}

function generateNgrams(str, size = 2) {
    if (!str) return [];
    const s = String(str).trim().toUpperCase();

    const grams = [];
    for (let i = 0; i <= s.length - size; i++) {
        grams.push(s.substring(i, i + size));
    }
    return grams;
}

let cachedRange;
let cachedMonth = -1;

function getMonthDateRange() {
    const now = new Date();
    if (now.getMonth() !== cachedMonth) {
        cachedMonth = now.getMonth();
        cachedRange = {
            startOfMonth: new Date(now.getFullYear(), cachedMonth, 1),
            endOfMonth: new Date(now.getFullYear(), cachedMonth + 1, 1)
        };
    }
    return cachedRange;
}


module.exports = {
    storeFiles,
    storeFile,
    storeFilesexcel,
    storeFileReq,
    urlSaveDownload,
    uniqueId,
    exportFile,
    getUniqueId,
    fetchItemId,
    currentDateTime,
    getOrderNo,
    updateOrderNo,
    formatDate,
    decodeBase64,
    decodeExcelBase64,
    dateFormatUpperCase,
    getLocalIpAddress,
    getUser,
    calculateDayDifference,
    getCurrentTime,
    getCurrentShift,
    updateCounter,
    fetchOpQty,
    getDocNo,
    dateFormat,
    currentDateTimeInd,
    company,
    generateNgrams,
    getMonthDateRange,
    fetchItemIds
};


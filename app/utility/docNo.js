const { CustomError, connection } = require("../config/dbSql");

// Utility function to get the current financial year
// let cachedFinancialYear = null;

// const getCurrentFinancialYear = () => {
//     const today = new Date();

//     // If cached and still valid, return it
//     if (cachedFinancialYear && today >= new Date(cachedFinancialYear.fyFrom) && today <= new Date(cachedFinancialYear.fyTo)) {
//         return cachedFinancialYear;
//     }

//     const year = today.getFullYear();
//     const month = today.getMonth() + 1;
//     const fyStartYear = month >= 4 ? year : year - 1;
//     const fyEndYear = fyStartYear + 1;

//     cachedFinancialYear = {
//         fyFrom: `${fyStartYear}-04-01`,
//         fyTo: `${fyEndYear}-03-31`
//     };

//     return cachedFinancialYear;
// };

const getCurrentFinancialYear = async () => {
    const [[fyRow]] = await connection.execute(`
        SELECT 
            DATE_FORMAT(fromDate, '%d-%m-%Y') AS fyFrom,
            DATE_FORMAT(toDate, '%d-%m-%Y') AS fyTo
        FROM financial_year
        WHERE isActive = 1
        LIMIT 1
    `);

    if (!fyRow) {
        throw new CustomError('Active financial year not found.', 404);
    }

    return {
        fyFrom: fyRow.fyFrom,
        fyTo: fyRow.fyTo
    };
};

const getCurrentFinancialYearYMD = async () => {
    const [[fyRow]] = await connection.execute(`
        SELECT 
            fromDate AS fyFrom,
            toDate AS fyTo
        FROM financial_year
        WHERE isActive = 1
        LIMIT 1
    `);

    if (!fyRow) {
        throw new CustomError('Active financial year not found.', 404);
    }

    return {
        fyFrom: fyRow.fyFrom,
        fyTo: fyRow.fyTo
    };
};


// Utility function to get the current week number
const getCurrentWeekNumber = () => {
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const pastDays = Math.floor((today - startOfYear) / (24 * 60 * 60 * 1000));
    return Math.ceil((pastDays + startOfYear.getDay() + 1) / 7);
};

// Convert 'DD-MM-YYYY' to 'YYYY-MM-DD'
const formatDate = (dateStr) => {
    const [day, month, year] = dateStr.split('-');
    return `${year}-${month}-${day}`;
};

const isValidDateFormat = (dateStr) => /^\d{2}-\d{2}-\d{4}$/.test(dateStr);

// Utility function to validate the financial year
const validateFinancialYear = async (fyFrom, fyTo) => {
    if (!isValidDateFormat(fyFrom) || !isValidDateFormat(fyTo)) {
        throw new CustomError('Invalid date format for financial year. Expected DD-MM-YYYY.', 400);
    }

    const { fyFrom: currentFyFrom, fyTo: currentFyTo } = await getCurrentFinancialYear();

    if (fyFrom !== currentFyFrom || fyTo !== currentFyTo) {
        throw new CustomError('Please switch to the active financial year to make a transaction!', 400);
    }
};

// Utility function to generate the document number
const generateDocumentNumber = (docNoFormat, prefixObj, customValue, incrementedLastNo) => {
    const parts = docNoFormat.split(',');
    let result = [];

    for (let i = 0; i < parts.length; i++) {
        const key = parts[i];

        if (key === '1' && customValue === '') {
            // Skip key '1' and also remove the previous '/' (if present)
            if (result.length > 0 && result[result.length - 1] === prefixObj['11']) {
                result.pop();  // Remove previous '/'
            }
            continue;
        }
        if (key === '1') {
            result.push(customValue);
            continue;
        }
        if (['6', '8', '9', '12'].includes(key)) {
            result.push(incrementedLastNo.toString().padStart(prefixObj[key].length, '0'));
            continue;
        }

        result.push(prefixObj[key]);
    }

    return result.join('');
};


// Function to get the document counter
const getCounter = async (conn, docType, resetObj, docObj) => {
    try {
        const { curYear, curMonth, curWeek, customValue } = docObj;
        const { resetForWeek, resetForCustom } = resetObj;
        let number;

        // Check if reset for week or custom value is required
        let whereClause = '', values = [];
        if (resetForWeek) {
            whereClause += ' AND week = ?';
            values.push(curWeek);
        }
        if (resetForCustom) {
            whereClause += ' AND custom = ?';
            values.push(customValue);
        }

        // Check if the counter already exists
        const [counterRows] = await conn.execute(
            `SELECT counter FROM document_counter WHERE docType = ? AND year = ? ${whereClause} ORDER BY id DESC LIMIT 1`,
            [docType, curYear, ...values]
        );

        if (counterRows.length) {
            number = counterRows[0].counter;
        } else {
            number = 1;
            await conn.execute(
                `INSERT INTO document_counter(docType, year, month, week, custom, counter) VALUES(?, ?, ?, ?, ?, ?)`,
                [docType, curYear, curMonth, curWeek, customValue, number]
            );
        }

        return number;
    } catch (err) {
        throw err;
    }
};

const DocumentTypes = new Set();
const validateDocumentType = async (conn, docType) => {
    if (!DocumentTypes.has(docType)) {
        const [docs] = await conn.execute(`SELECT id FROM document_number WHERE DocKey = ?`, [docType]);

        if (!docs.length) {
            throw new CustomError(`Invalid document type! ${docType}`, 400);
        }
        DocumentTypes.add(docType);
    }
    return true;
}

// Controller function to generate document number
const generateDocNo = async (conn, req, docObj) => {
    try {
        const { fyfrom: fyFrom, fyto: fyTo } = req.headers;
        const { docType, customValue = '' } = docObj;

        // Validate financial year and document type
        await validateFinancialYear(fyFrom, fyTo);
        await validateDocumentType(conn, docType);

        // Fetch financial year details
        const { fyFrom: currentFyFrom, fyTo: currentFyTo } = await getCurrentFinancialYearYMD();
        const YrFrom = new Date(currentFyFrom).getFullYear();
        const YrTo = new Date(currentFyTo).getFullYear();
        const ShYrFrom = YrFrom.toString().slice(-2);
        const ShYrTo = YrTo.toString().slice(-2);
        const curMonth = new Date().getMonth() + 1; // Months are 0-based
        // const curYear = curMonth >= 4
        //     ? new Date().getFullYear()
        //     : new Date().getFullYear() - 1;
        const curYear = YrFrom;
        const curWeek = getCurrentWeekNumber(); // Dynamic week calculation

        // Prefix mapping
        const prefixObj = {
            1: customValue,
            2: YrFrom.toString(),
            3: YrTo.toString(),
            4: ShYrFrom,
            5: ShYrTo,
            6: '00001',
            7: '1',
            8: '0001',
            9: '001',
            10: curWeek.toString(),
            11: '/',
            12: '000001'
        };

        // Fetch document format from database
        const [docRows] = await conn.execute(
            `SELECT id AS docID, docNoFormat, resetForWeek, resetForCustom FROM document_number WHERE DocKey = ?`,
            [docType]
        );

        if (!docRows.length) {
            throw new CustomError('Document type not found!', 404);
        }
        if (!docRows[0].docNoFormat) {
            throw new CustomError('Document format is not defined!', 404);
        }

        const { docID, docNoFormat, resetForWeek, resetForCustom } = docRows[0];
        const incrementedLastNo = await getCounter(conn, docType, { resetForWeek, resetForCustom }, { curYear, curMonth, curWeek, customValue });
        const padStartNo = padStartNum(docNoFormat, prefixObj, incrementedLastNo);

        // Generate document number
        const uniqueNo = generateDocumentNumber(docNoFormat, prefixObj, customValue, incrementedLastNo);

        return { curYear, curMonth, curWeek, padStartNo, uniqueNo };
    } catch (err) {
        throw err;
    }
};

const docNoReset = async (conn, req, docObj) => {
    try {
        const { fyfrom: fyFrom, fyto: fyTo } = req.headers;
        const { docType, table, col } = docObj;

        // Validate inputs
        await validateFinancialYear(fyFrom, fyTo);
        await validateDocumentType(conn, docType);

        const fyFromISO = formatDate(fyFrom);
        const fyToISO = formatDate(fyTo);

        const [docRows] = await conn.execute(
            `SELECT id, ${col} FROM ${table} WHERE DATE(created_at) >= ? AND DATE(created_at) <= ? ORDER BY id DESC LIMIT 1`,
            [fyFromISO, fyToISO]
        );

        let newCounter = 1;

        if (docRows.length > 0 && docRows[0][col]) {
            const lastNumber = parseInt(docRows[0][col]);
            if (!isNaN(lastNumber)) {
                newCounter = lastNumber + 1;
            }
        }

        await conn.execute(
            `UPDATE document_counter SET counter = ? WHERE DocType = ?`,
            [newCounter, docType]
        );

    } catch (err) {
        throw err;
    }
};


const padStartNum = (docNoFormat, prefixObj, docNo) => {
    const padKeys = new Set(['6', '7', '8', '9', '12']);
    const keys = docNoFormat.split(',');

    for (const key of keys) {
        if (padKeys.has(key) && prefixObj[key]) {
            return docNo.toString().padStart(prefixObj[key].length, '0'); value
        }
    }
    return docNo.toString();
};

const extractCounter = (docNo) => {
    const lastPart = docNo.split('/').pop();
    const counter = parseInt(lastPart, 10);

    if (isNaN(counter)) {
        throw new CustomError('Invalid document number format!', 400);
    }

    return { counter, nextCounter: counter + 1 };
};

const updateDocCounter = async (conn, doctype, docObj) => {
    const { docNo = '', type = '' } = docObj || {};
    const hasType = Boolean(type);
    const typeValue = type.toUpperCase();

    if (docNo) {
        const { nextCounter } = extractCounter(docNo);

        const query = `
            UPDATE document_counter 
            SET counter = ? 
            WHERE docType = ? 
            AND counter < ? 
            ${hasType ? 'AND custom = ?' : ''}
            ORDER BY id DESC 
            LIMIT 1
        `;

        const params = hasType
            ? [nextCounter, doctype, nextCounter, typeValue]
            : [nextCounter, doctype, nextCounter];

        await conn.execute(query, params);
    } else {
        const query = `
            UPDATE document_counter 
            SET counter = counter + 1 
            WHERE id = (
                SELECT id FROM (
                    SELECT id FROM document_counter 
                    WHERE docType = ? 
                    ${hasType ? 'AND custom = ?' : ''}
                    ORDER BY id DESC 
                    LIMIT 1
                ) AS sub
            )
        `;

        const params = hasType ? [doctype, typeValue] : [doctype];

        await conn.execute(query, params);
    }
};

// const updateDocCounter = async (conn, doctype, docObj) => {
//     const { docNo = '', type = '' } = docObj || {};
//     const hasType = Boolean(type);
//     const typeValue = type.toUpperCase();

//     const month =  new Date().getMonth() + 1;   // Dynamic week calculation
//     const week = getCurrentWeekNumber();// Months are 0-based


//     //console.log('Current  week:', week);
//     //console.log('Current Month:', month);
//     if (docNo) {
//         const { nextCounter } = extractCounter(docNo);

//         //console.log('Next Counter:', nextCounter);


//         const query = `
//             UPDATE document_counter 
//             SET counter = ?, week = ?, month = ?
//             WHERE docType = ? 
//             AND counter < ? 
//             ${hasType ? 'AND custom = ?' : ''}
//             ORDER BY id DESC 
//             LIMIT 1
//         `;

//         const params = hasType
//             ? [nextCounter, week, month, doctype, nextCounter, typeValue]
//             : [nextCounter, week, month, doctype, nextCounter];

//         await conn.execute(query, params);
//     } else {

//         //console.log('Next2 Counter:');

//         const query = `
//             UPDATE document_counter 
//             SET counter = counter + 1, week = ?, month = ?
//             WHERE id = (
//                 SELECT id FROM (
//                     SELECT id FROM document_counter 
//                     WHERE docType = ? 
//                     ${hasType ? 'AND custom = ?' : ''}
//                     ORDER BY id DESC 
//                     LIMIT 1
//                 ) AS sub
//             )
//         `;

//         const params = hasType ? [week, month, doctype, typeValue] : [week, month, doctype];

//         await conn.execute(query, params);
//     }
// };

const formatFinancialYears = (req) => {
    const { fyfrom, fyto } = req.headers;
    if (!fyfrom || !fyto) {
        throw new CustomError('Financial years not found!', 400);
    }
    return {
        fyFrom: formatDate(fyfrom),
        fyTo: formatDate(fyto)
    };
};

const syncCounter = async (req, docObj) => {
    try {
        const { docType, lastDocNumber } = docObj;

        const [counters] = await connection.execute(`
            SELECT counter FROM document_counter 
            WHERE DocType = ?
            ORDER BY id DESC
            LIMIT 1
        `, [docType]);

        if (!counters.length) {
            throw new CustomError('Document counter not found!', 404);
        }

        const currentCounter = Number(counters[0].counter);
        const expectedCounter = Number(lastDocNumber) + 1;

        // If out of sync, update it
        if (currentCounter !== expectedCounter) {
            await connection.execute(`
                UPDATE document_counter 
                SET counter = ? 
                WHERE DocType = ?
            `, [expectedCounter, docType]);
        }

        return true;
    } catch (err) {
        throw err;
    }
};


module.exports = {
    getCurrentFinancialYear,
    generateDocNo,
    updateDocCounter,
    formatDate,
    formatFinancialYears,
    syncCounter,
    docNoReset
}
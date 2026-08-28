const { handleErrorResponse, connection, handleSuccessResponse, CustomError } = require("../config/dbSql")
const { getUser, currentDateTime } = require("../utility/utilityFunction")
const { sendEmail } = require("../config/emailService")
const { Buffer } = require('buffer'); // Ensure the Buffer module is imported
const nodemailer = require('nodemailer');


// const docTypes = [
//     { key: 'pcnCount', docType: 'PCN', tbName: 'pcn_mst', colName: 'pcnNo', colName2: 'createdBy', label: 'Price Change Note' },
//     { key: 'srnCount', docType: 'SRN', tbName: 'srn_mst', colName: 'srnNo', colName2: 'mrpMstId', label: 'Store Request Note' },
//     { key: 'poCount', docType: 'PO', tbName: 'po_main', colName: 'poNo', colName2: 'digit', label: 'Purchase Order' },
// ];
const docTypes = [
    { key: 'pcnCount', docType: 'PCN', tbName: 'pcn_mst', colName: 'pcnNo', colName2: 'createdBy', label: 'Price Change Note' },
    { key: 'srnCount', docType: 'SRN', tbName: 'srn_mst', colName: 'srnNo', colName2: 'requestedBy', label: 'Store Request Note' },
    { key: 'poCount', docType: 'PO', tbName: 'po_main', colName: 'poNo', colName2: 'digit', label: 'Purchase Order' },
];

// Total documents to be Autorized
const getAuthDocs = async () => {
    const [firstAuth] = await connection.execute(`SELECT auth_pending_docs.* FROM auth_pending_docs`, []);
    const [secondAuth] = await connection.execute(`
        SELECT 
            (SELECT COUNT(0) FROM auth_docs WHERE docType = 'PO' AND second_lvl_auth = 0) AS poCount,
            (SELECT COUNT(0) FROM auth_docs WHERE docType = 'PCN' AND second_lvl_auth = 0) AS pcnCount,
            (SELECT COUNT(0) FROM auth_docs WHERE docType = 'SRN' AND second_lvl_auth = 0) AS srnCount;`,
        []
    );

    if (!firstAuth.length || !secondAuth.length) throw new CustomError(`Authorization pending docs not found!`, 404);

    const [fstLvlDocs, scndLvlDocs] = [firstAuth[0], secondAuth[0]];

    return docTypes.map((item, index) => ({
        id: index + 1,
        docType: item.docType,
        docName: item.label,
        docCount: fstLvlDocs[item.key],
        secondLvlAuth: scndLvlDocs[item.key]
    }));
};

// first level documents to be Autorized
const getFirstLevelAuthDocs = async (tbName, colName, colName2, docType) => {
    let query = `SELECT tb.id, tb.${colName} as refNo, tb.${colName2} AS addedBy, DATE_FORMAT(tb.created_at, '%d-%m-%Y') as createdDate`;
    let params = [0];

    if (docType === 'PO') {
        query += `, sp.spCode, sp.spName, tb.potype, tb.digit, tb.type, tb.refNoDate as poRefNo, tb.addedBy, CONCAT(cur.code, ':', tb.grossAmount) AS poValue,
            DATE_FORMAT(tb.date, '%d-%m-%Y') as createdDate
            FROM ${tbName} AS tb 
            LEFT JOIN supplier sp ON sp.id = tb.spName
            LEFT JOIN mst_currency cur ON cur.id = sp.currency

         WHERE tb.firstAuth = ?`;
    } else {
        query += ` FROM ${tbName} AS tb WHERE tb.authorized = ?`;
    }

    const [result] = await connection.execute(query, params);
    return result;
};

// Second level documents to be Autorized
const getSecondLevelAuthDocs = async (tbName, colName, colName2, docType) => {
    let query = `
        SELECT ad.id, ad.refNo, DATE_FORMAT(ad.created_at, '%d-%m-%Y') as createdDate, ad.firstAuthBy, ${tbName}.${colName2}`;

    if (docType === 'PO') {
        query += `, sp.spCode, sp.spName, ${tbName}.id As poMainId, ${tbName}.potype,   ${tbName}.digit, ${tbName}.type, ${tbName}.refNoDate as poRefNo, ${tbName}.addedBy,
             CONCAT(cur.code, ':', ${tbName}.grossAmount) AS poValue
                FROM auth_docs ad
                LEFT JOIN ${tbName} ON ${tbName}.${colName} = ad.refNo
                LEFT JOIN supplier sp ON sp.id = ${tbName}.spName
                LEFT JOIN mst_currency cur ON cur.id = sp.currency

            WHERE ad.second_lvl_auth = ? AND ad.docType = ?`;
    } else {
        query += ` FROM auth_docs ad
                  LEFT JOIN ${tbName} ON ${tbName}.${colName} = ad.refNo
                  WHERE ad.second_lvl_auth = ? AND ad.docType = ?`;
    }

    const [result] = await connection.execute(query, [0, docType]);
    return result;
};

exports.authPendingDoc = async (req, res) => {
    try {
        const { docType, authLevel } = req.query;
        let result = [];

        if (!docType) {
            result = await getAuthDocs();
        } else {
            const docConfig = docTypes.find(item => item.docType === docType);

            if (!docConfig) throw new CustomError("Invalid document type!", 400);

            const { tbName, colName, colName2, label } = docConfig;

            if (authLevel === 'first') {
                result = await getFirstLevelAuthDocs(tbName, colName, colName2, docType);
            } else if (authLevel === 'second') {
                result = await getSecondLevelAuthDocs(tbName, colName, colName2, docType);
            } else {
                throw new CustomError("Invalid authorization level!", 400);
            }
        }

        return handleSuccessResponse(res, 'Authorize documents', result);
    } catch (err) {
        return handleErrorResponse(res, err);
    }
};



// exports.authDocs = async (req, res) => {
//     const conn = await connection.getConnection();
//     await conn.beginTransaction();
//     try {
//         const { docType, refNos: docsArray, authLevel } = req.body;

//         const approvedBy = await getUser(req);
//         const currentDate = await currentDateTime();

//         const refNos = docsArray.map(doc => doc.refNo);
//         const docObj = docTypes.find(item => item.docType === docType);

//         if (docObj && authLevel === 'first') {
//             const { tbName, colName } = docObj;
//             const scndLvlAuth = docType === 'PO' ? 0 : 1;

//             const iPlaceholders = refNos.map(() => "(?, ?, ?, ?, ?)").join(', ');
//             const values = refNos.reduce((acc, refNo) => acc.concat([docType, refNo, scndLvlAuth, approvedBy, currentDate]), []);

//             // Insert into auth_docs
//             await conn.execute(`INSERT INTO auth_docs (docType, refNo, second_lvl_auth, firstAuthBy, firstAuthDate) VALUES ${iPlaceholders}`, values);

//             // Update authorized status in respective table
//             const uPlaceholders = refNos.map(() => "?").join(', ');
//             await conn.execute(`UPDATE ${tbName} SET authorized = ? WHERE ${colName} IN (${uPlaceholders})`, [1, ...refNos]);

//         } else if (docObj && authLevel === 'second') {
//             const placeholders = refNos.map(() => '?').join(',');
//             await conn.execute(`UPDATE auth_docs SET second_lvl_auth = ?, secondAuthBy = ?, secondAuthDate = ? WHERE refNo IN (${placeholders})`, [1, approvedBy, currentDate, ...refNos]);

//         } else {
//             throw new CustomError("Invalid document type", 400);
//         }
//         // Commit transaction
//         await conn.commit();

//         return handleSuccessResponse(res, 'Authorization successful');
//     } catch (err) {
//         await conn.rollback();
//         return handleErrorResponse(res, err);
//     } finally {
//         conn.release();
//     }
// }



exports.authDocs = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();
    try {
        const { docType, refNos: docsArray, authLevel } = req.body;

        const approvedBy = await getUser(req);
        const currentDate = await currentDateTime();

        const refNos = docsArray.map(doc => doc.refNo);
        const docObj = docTypes.find(item => item.docType === docType);

        if (!docObj) {
            throw new Error("Invalid document type");
        }

        let { tbName, colName } = docObj; // Move tbName and colName outside of conditions

        if (authLevel === 'first') {
            const scndLvlAuth = docType === 'PO' ? 0 : 1;

            const iPlaceholders = refNos.map(() => "(?, ?, ?, ?, ?)").join(', ');
            const values = refNos.flatMap(refNo => [docType, refNo, scndLvlAuth, approvedBy, currentDate]);

            // Insert into auth_docs
            await conn.execute(
                `INSERT INTO auth_docs (docType, refNo, second_lvl_auth, firstAuthBy, firstAuthDate) VALUES ${iPlaceholders}`,
                values
            );

            // Update authorized status in respective table
            if (tbName !== 'po_main') {
                const uPlaceholders = refNos.map(() => "?").join(', ');
                await conn.execute(`UPDATE ${tbName} SET authorized = 1 WHERE ${colName} IN (${uPlaceholders})`, refNos);
            } else {
                const uPlaceholders = refNos.map(() => "?").join(', ');
                await conn.execute(`UPDATE ${tbName} SET firstAuth = 1 WHERE ${colName} IN (${uPlaceholders})`, refNos);
            }

        } else if (authLevel === 'second') {
            const placeholders = refNos.map(() => '?').join(',');
            await conn.execute(
                `UPDATE auth_docs SET second_lvl_auth = 1, secondAuthBy = ?, secondAuthDate = ? WHERE refNo IN (${placeholders})`,
                [approvedBy, currentDate, ...refNos]
            );

            // Update authorized status in `po_main` table only
            if (tbName === 'po_main') {
                const uPlaceholders = refNos.map(() => "?").join(', ');
                await conn.execute(`UPDATE ${tbName} SET authorized = 1 WHERE ${colName} IN (${uPlaceholders})`, refNos);
            }
        } else {
            throw new Error("Invalid authorization level");
        }

        // Commit transaction
        await conn.commit();

        return handleSuccessResponse(res, 'Authorization successful');
    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};







// exports.sendMail = async (req, res) => {
//     try {
//         const { file, poMainId } = req.body;

//         if (!file || !poMainId) {
//             return res.status(400).send('Missing required fields: file or poMainId');
//         }

//         // Fetch supplier and user email info
//         const [supplierRows] = await connection.execute(
//             `SELECT 
//              sup.spCode, po.poNo, po.date As poDate, sup.email AS supplierEmail, 
//              u.email AS userEmail, des.name As designation, u.userName, u.mobile
//              FROM supplier sup
//              INNER JOIN po_main po ON sup.id = po.spName
//              INNER JOIN users u ON u.userName = po.addedBy
//              LEFT JOIN mst_designation des ON des.id = u.designation
//              WHERE po.dflag = 0 AND sup.dflag = 0 AND po.id = ?`,
//             [poMainId]
//         );

//         if (!supplierRows.length) {
//             return res.status(404).send('No supplier found for the given PO ID');
//         }

//         const { spCode, supplierEmail, userEmail, userName, designation, mobile, poNo, poDate } = supplierRows[0];

//         if (!supplierEmail) {
//             return res.status(400).send(`No email assigned for supplier: ${spCode}`);
//         }

//         // Fetch SMTP settings
//         const [settingsRows] = await connection.execute(
//             `SELECT * FROM emailsettings WHERE email = ? AND type = 'Purchase'`,
//             [userEmail]
//         );

//         if (!settingsRows.length) {
//             return res.status(404).send('No email settings found for the user');
//         }

//         const settings = settingsRows[0];

//         // Prepare PDF attachment
//         const base64Content = file.split(';base64,').pop();
//         if (!base64Content) {
//             return res.status(400).send('Invalid file format');
//         }

//         const attachmentBuffer = Buffer.from(base64Content, 'base64');
//         const attachments = [{
//             filename: `Purchase_Order_${poNo}.pdf`,
//             content: attachmentBuffer,
//             contentType: 'application/pdf'
//         }];

//         // Prepare transporter
//         const transporter = nodemailer.createTransport({
//             host: settings.smtp_host,
//             port: settings.smtp_port,
//             secure: true,
//             auth: {
//                 user: settings.email,
//                 pass: settings.password,
//             },
//         });

//         // Prepare email content
//         const emailList = supplierEmail.split(',').map(e => e.trim()).filter(Boolean);


//         const formattedDate = new Date(poDate).toLocaleDateString('en-GB', {
//             day: '2-digit', month: 'short', year: 'numeric'
//         });

//         // const htmlContent = `
//         //     <p>Dear Sir/Madam,</p>
//         //     <p>
//         //         Please find herewith attached our Purchase Order No: <strong>${poNo}</strong>, 
//         //         DT: <strong>${formattedDate}</strong>, kindly acknowledge the receipt of the same 
//         //         and arrange the materials as per the given schedule.
//         //     </p>
//         //     <p style="color: red; font-weight: bold;">
//         //         Note: This is an auto-generated email. Kindly confirm the receipt through return email mandatorily.
//         //     </p>
//         // `;

//         const htmlContent = `
//             <p>Dear Sir/Madam,</p>
//             <p>
//                 Please find herewith attached our Purchase Order No: <strong>${poNo}</strong>, 
//                 DT: <strong>${formattedDate}</strong>, kindly acknowledge the receipt of the same 
//                 and arrange the materials as per the given schedule.
//             </p>
//             <p style="color: red; font-weight: bold;">
//                 Note: This is an auto-generated email. Kindly confirm the receipt through return email mandatorily.
//             </p>
//             <br/>
//             <p>Regards,</p>
//             <p><strong>${userName}</strong><br/>
//             ${designation}<br/>
//             ${mobile}<br/>
//             MALLIK ENGINEERING (INDIA) PVT. LTD.</p>
//         `;


//         // Respond immediately — do not wait for email sending
//         res.status(200).json({
//             success: true,
//             message: 'Email Sent.',
//         });

//         // Send emails asynchronously
//         emailList.forEach(async (recipient) => {
//             try {
//                 await transporter.sendMail({
//                     from: settings.email,
//                     to: recipient,
//                     cc: settings.email,
//                     subject: `Purchase Order ${poNo} Approved Notification For your reference.`,
//                     text: 'Please find attached the Purchase Order.',
//                     html: htmlContent,
//                     attachments
//                 });
//                 // console.log(`Email sent to ${recipient}`);
//             } catch (mailErr) {
//                 console.error(`Failed to send email to ${recipient}:`, mailErr.message);
//                 // Optionally, log to DB or error table
//             }
//         });

//     } catch (error) {
//         console.error('Error preparing email:', error);
//         return res.status(500).send('An error occurred while preparing the email');
//     }
// };


exports.sendMail = async (req, res) => {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        const { file, poMainId } = req.body;

        if (!file || !poMainId) {
            return res.status(400).send('Missing required fields: file or poMainId');
        }

        // Fetch supplier & user email info
        const [supplierRows] = await conn.execute(
            `SELECT 
                sup.spCode, po.poNo, po.date AS poDate,
                sup.email AS supplierEmail, 
                u.email AS userEmail, 
                des.name AS designation, 
                u.userName, u.mobile
             FROM supplier sup
             INNER JOIN po_main po ON sup.id = po.spName
             INNER JOIN users u ON u.userName = po.addedBy
             LEFT JOIN mst_designation des ON des.id = u.designation
             WHERE po.dflag = 0 AND sup.dflag = 0 AND po.id = ?`,
            [poMainId]
        );

        if (!supplierRows.length) {
            return res.status(404).send('No supplier found for the given PO ID');
        }

        const { spCode, supplierEmail, userEmail, userName, designation, mobile, poNo, poDate } = supplierRows[0];

        if (!supplierEmail) {
            return res.status(400).send(`No email assigned for supplier: ${spCode}`);
        }

        // Fetch SMTP settings
        const [settingsRows] = await conn.execute(
            `SELECT * FROM emailsettings WHERE email = ? AND type = 'Purchase'`,
            [userEmail]
        );

        if (!settingsRows.length) {
            return res.status(404).send('No email settings found for the user');
        }

        const settings = settingsRows[0];

        // Prepare PDF attachment
        const base64Content = file.split(';base64,').pop();
        if (!base64Content) {
            return res.status(400).send('Invalid file format');
        }

        const attachmentBuffer = Buffer.from(base64Content, 'base64');
        const attachments = [{
            filename: `Purchase_Order_${poNo}.pdf`,
            content: attachmentBuffer,
            contentType: 'application/pdf'
        }];

        // Prepare transporter
        const transporter = nodemailer.createTransport({
            host: settings.smtp_host,
            port: settings.smtp_port,
            secure: true,
            auth: {
                user: settings.email,
                pass: settings.password,
            },
        });

        // Prepare email list
        const emailList = supplierEmail.split(',').map(e => e.trim()).filter(Boolean);

        const formattedDate = new Date(poDate).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        });

        // Email HTML content
        const htmlContent = `
            <p>Dear Sir/Madam,</p>
            <p>
                Please find herewith attached our Purchase Order No: <strong>${poNo}</strong>,
                Dated: <strong>${formattedDate}</strong>. Kindly acknowledge the receipt of the same 
                and arrange the materials as per the given schedule.
            </p>
            <p style="color: red; font-weight: bold;">
                Note: This is an auto-generated email. Kindly confirm the receipt through return email mandatorily.
            </p>
            <br/>
            <p>Regards,</p>
            <p><strong>${userName}</strong><br/>
            ${designation || ''}<br/>
            ${mobile || ''}<br/>
            MALLIK ENGINEERING (INDIA) PVT. LTD.</p>
        `;

        // Send emails properly
        for (const recipient of emailList) {
            try {
                await transporter.sendMail({
                    from: settings.email,
                    to: recipient,
                    cc: settings.email,
                    subject: `Purchase Order ${poNo} Approved Notification For your reference.`,
                    html: htmlContent,
                    attachments
                });
                // console.log(` Email sent to ${recipient}`);
            } catch (mailErr) {
                console.error(`Failed to send email to ${recipient}:`, mailErr.message);
                // You could optionally log this to DB
            }
        }

        // Commit after all emails sent
        await conn.commit();

        return handleSuccessResponse(res, 'Email sent.');

    } catch (err) {
        await conn.rollback();
        return handleErrorResponse(res, err);
    } finally {
        conn.release();
    }
};


//Testing purpose
// exports.testMail = async (req, res) => {
//     try {
//         const  to = req.body.to;

//         // if (!to || !Array.isArray(to) || to.length === 0) {
//         //     return res.status(400).json({ success: false, message: "Recipient email(s) required" });
//         // }


//         const type = 'Testing';

//         // Email content
//         const htmlContent = `
//             <h2 style="font-weight: bold;">Purchase Order</h2>
//             <p>From Test Dispatch</p>
//         `;

//         // Dummy PDF buffer for demo purposes (replace with your real PDF content)
//         const attachmentBuffer = Buffer.from('Sample PDF content'); // <- Replace this

//         const attachments = [{
//             filename: 'PoRepo.pdf',
//             content: attachmentBuffer,
//             contentType: 'application/pdf'
//         }];

//         // Send emails concurrently
//         await sendEmail({
//                 to: to,
//                 subject: 'Dispatch Order',
//                 cc: to, // Optional: you may remove or change this
//                 htmlContent,
//                 text: 'Attached is your Dispatch Order.',
//                 attachments,
//                 type
//             })
//         return res.status(200).json({
//             success: true,
//             message: "Emails sent successfully"
//         });
//     } catch (error) {
//         console.error('Error sending email:', error);
//         return res.status(500).json({
//             success: false,
//             message: "Error sending email",
//             error: error.message
//         });
//     }
// };

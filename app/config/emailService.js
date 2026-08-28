const nodemailer = require('nodemailer');
const { connection } = require('../config/dbSql');
require('dotenv').config();

exports.sendEmail = async ({ to, subject, cc, htmlContent, text, attachments = [], type }) => {
    try {
        if (!to) throw new Error("Recipient email address is required.");
        if (!type) throw new Error("Email type is required.");

        // Get email settings for the given type
        const [rows] = await connection.execute(
            `SELECT * FROM emailsettings WHERE type = ?`,
            [type]
        );

        if (!rows.length) throw new Error(`No email settings found for type: ${type}`);
        const settings = rows[0];

        const transporter = nodemailer.createTransport({
            host: settings.smtp_host,
            port: settings.smtp_port,
            secure: settings.smtp_port == 465,
            auth: {
                user: settings.email,
                pass: settings.password,
            }
        });

        const mailOptions = {
            from: settings.email,
            to,
            cc: settings.email,
            subject,
            html: htmlContent,
            text,
            attachments
        };

        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error("Email sending failed:", error);
        throw error;
    }
};

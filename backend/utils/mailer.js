// backend/utils/mailer.js
require('dotenv').config();
const nodemailer = require('nodemailer');

const port = parseInt(process.env.SMTP_PORT || '587', 10);
const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: port,
  secure: port === 465,
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

async function sendMail({ to, subject, text, html }) {
  const senderUser = smtpUser || 'no-reply@assignmentportal.local';
  const fromAddress = process.env.MAIL_FROM || `"Online Assignment Portal" <${senderUser}>`;

  if (!smtpUser || !smtpPass) {
    console.warn('[Mailer Warning] SMTP credentials missing in .env');
    console.log('--- OTP Fallback Output ---');
    console.log(`To: ${to}`);
    console.log(text || html);
    console.log('---------------------------');
    return { devFallback: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text: text || '',
      html: html || text || '',
    });
    console.log(`[Brevo SMTP] Email sent successfully to ${to} (MessageID: ${info.messageId})`);
    return info;
  } catch (err) {
    console.error(`[Brevo SMTP Error] Failed to send to ${to}:`, err.message);
    console.log('--- OTP Console Fallback ---');
    console.log(`To: ${to}`);
    console.log(text || html);
    console.log('----------------------------');
    return null;
  }
}

async function sendOtpEmail(email, otp, purpose = 'verification') {
  const subject = `Your OTP for ${purpose.toUpperCase()}`;
  const text = `Your OTP verification code is: ${otp}. Valid for 10 minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 500px; margin: 0 auto;">
      <h2 style="color: #2563eb; margin-top: 0;">Assignment Portal Verification</h2>
      <p style="color: #334155; font-size: 15px;">Use the following code to complete your <strong>${purpose}</strong>:</p>
      <div style="background: #f1f5f9; padding: 12px 20px; text-align: center; border-radius: 6px; margin: 20px 0;">
        <h1 style="letter-spacing: 6px; color: #1e293b; font-size: 32px; margin: 0;">${otp}</h1>
      </div>
      <p style="color: #64748b; font-size: 13px;">This code is valid for 10 minutes. Please do not share it.</p>
    </div>
  `;
  return await sendMail({ to: email, subject, text, html });
}

module.exports = { sendMail, sendOtpEmail };
// backend/utils/mailer.js

require("dotenv").config();

const nodemailer = require("nodemailer");

// ============================================================
// SMTP CONFIGURATION
// ============================================================

const smtpHost =
  process.env.SMTP_HOST || "smtp-relay.brevo.com";

const smtpPort =
  Number(process.env.SMTP_PORT) || 587;

const smtpUser =
  process.env.SMTP_USER
    ? process.env.SMTP_USER.trim()
    : "";

const smtpPass =
  process.env.SMTP_PASS
    ? process.env.SMTP_PASS.trim()
    : "";

const configuredMailFrom =
  process.env.MAIL_FROM
    ? process.env.MAIL_FROM.trim()
    : "";

// ============================================================
// EMAIL VALIDATION
// ============================================================

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(email || "").trim()
  );
}

// ============================================================
// NORMALIZE MAIL FROM ADDRESS
// ============================================================

function getMailFrom() {
  // Example:
  // Online Assignment Portal <example@gmail.com>

  const angleMatch =
    configuredMailFrom.match(
      /<\s*([^<>@\s]+@[^<>@\s]+)\s*>/
    );

  if (angleMatch) {
    return {
      name: "Online Assignment Portal",
      address: angleMatch[1].trim(),
    };
  }

  // Example:
  // example@gmail.com

  if (
    configuredMailFrom &&
    isValidEmail(configuredMailFrom)
  ) {
    return {
      name: "Online Assignment Portal",
      address: configuredMailFrom,
    };
  }

  // Fallback to SMTP username

  if (
    smtpUser &&
    isValidEmail(smtpUser)
  ) {
    return {
      name: "Online Assignment Portal",
      address: smtpUser,
    };
  }

  return null;
}

const mailFrom = getMailFrom();

// ============================================================
// CREATE SMTP TRANSPORTER
// ============================================================

let transporter = null;

if (smtpUser && smtpPass) {
  transporter =
    nodemailer.createTransport({
      host: smtpHost,

      port: smtpPort,

      // Port 465 = SSL
      // Port 587 = STARTTLS
      secure: smtpPort === 465,

      auth: {
        user: smtpUser,
        pass: smtpPass,
      },

      tls: {
        minVersion: "TLSv1.2",
      },
    });
}

// ============================================================
// SEND EMAIL
// ============================================================

async function sendMail({
  to,
  subject,
  text,
  html,
}) {
  // ----------------------------------------------------------
  // Validate recipient
  // ----------------------------------------------------------

  if (!to || !isValidEmail(to)) {
    throw new Error(
      "Invalid recipient email address."
    );
  }

  // ----------------------------------------------------------
  // Check SMTP configuration
  // ----------------------------------------------------------

  if (!transporter) {
    console.error(
      "[Mailer] SMTP credentials are missing."
    );

    throw new Error(
      "SMTP is not configured. Check SMTP_USER and SMTP_PASS in .env."
    );
  }

  // ----------------------------------------------------------
  // Check sender
  // ----------------------------------------------------------

  if (!mailFrom) {
    console.error(
      "[Mailer] MAIL_FROM is invalid."
    );

    throw new Error(
      "Invalid MAIL_FROM email address."
    );
  }

  // ----------------------------------------------------------
  // Send email
  // ----------------------------------------------------------

  try {
    const info =
      await transporter.sendMail({
        from: {
          name: mailFrom.name,
          address: mailFrom.address,
        },

        to: String(to).trim(),

        subject:
          String(subject || "").trim(),

        text: text || "",

        html:
          html ||
          text ||
          "",
      });

    console.log(
      "================================================"
    );

    console.log(
      "[Mailer] EMAIL SENT SUCCESSFULLY"
    );

    console.log(
      `[Mailer] To: ${to}`
    );

    console.log(
      `[Mailer] Subject: ${subject}`
    );

    console.log(
      `[Mailer] Message ID: ${info.messageId}`
    );

    console.log(
      "================================================"
    );

    return {
      success: true,
      messageId: info.messageId,
    };

  } catch (err) {
    console.error(
      "================================================"
    );

    console.error(
      "[Mailer] EMAIL SENDING FAILED"
    );

    console.error(
      "[Mailer] Error:",
      err.message
    );

    console.error(
      "================================================"
    );

    throw new Error(
      `Unable to send email: ${err.message}`
    );
  }
}

// ============================================================
// SEND OTP EMAIL
// ============================================================

async function sendOtpEmail(
  email,
  otp,
  purpose = "Modification"
) {
  // ----------------------------------------------------------
  // Validate email
  // ----------------------------------------------------------

  if (!email || !isValidEmail(email)) {
    throw new Error(
      "Invalid student email address."
    );
  }

  // ----------------------------------------------------------
  // Validate OTP
  // ----------------------------------------------------------

  if (
    !otp ||
    !/^\d{6}$/.test(
      String(otp)
    )
  ) {
    throw new Error(
      "Invalid OTP."
    );
  }

  // ----------------------------------------------------------
  // Purpose
  // ----------------------------------------------------------

  const safePurpose =
    String(purpose)
      .replace(/_/g, " ")
      .toUpperCase();

  // ----------------------------------------------------------
  // Subject
  // ----------------------------------------------------------

  const subject =
    `Online Assignment Portal - ${safePurpose} OTP`;

  // ----------------------------------------------------------
  // Plain text email
  // ----------------------------------------------------------

  const text = `
Online Assignment Portal

Your OTP verification code for ${safePurpose} is:

${otp}

This OTP is valid for 10 minutes.

Do not share this OTP with anyone.

If you did not request this OTP, please ignore this email.
`;

  // ----------------------------------------------------------
  // HTML email
  // ----------------------------------------------------------

  const html = `
<!DOCTYPE html>

<html>

<head>
  <meta charset="UTF-8">

  <title>
    Online Assignment Portal OTP
  </title>
</head>

<body
  style="
    margin:0;
    padding:30px;
    background:#f8fafc;
    font-family:Arial,Helvetica,sans-serif;
  "
>

  <div
    style="
      max-width:500px;
      margin:auto;
      background:white;
      border:1px solid #e2e8f0;
      border-radius:10px;
      padding:30px;
    "
  >

    <h2
      style="
        margin-top:0;
        text-align:center;
        color:#172033;
      "
    >
      Online Assignment Portal
    </h2>

    <p>
      Your verification code for
      <strong>${safePurpose}</strong>
      is:
    </p>

    <div
      style="
        margin:25px 0;
        padding:18px;
        text-align:center;
        background:#f1f5f9;
        border-radius:8px;
      "
    >

      <span
        style="
          font-size:32px;
          font-weight:bold;
          letter-spacing:8px;
          color:#4f46e5;
        "
      >
        ${otp}
      </span>

    </div>

    <p>
      This OTP is valid for
      <strong>10 minutes</strong>.
    </p>

    <p
      style="
        font-size:13px;
        color:#64748b;
      "
    >
      Never share this OTP with anyone.
    </p>

    <p
      style="
        font-size:13px;
        color:#64748b;
      "
    >
      If you did not request this OTP,
      you can safely ignore this email.
    </p>

  </div>

</body>

</html>
`;

  // ----------------------------------------------------------
  // Send
  // ----------------------------------------------------------

  return sendMail({
    to: email,
    subject: subject,
    text: text,
    html: html,
  });
}

// ============================================================
// SMTP CONNECTION TEST
// ============================================================

async function verifyMailer() {
  if (!smtpUser || !smtpPass) {
    console.error(
      "[Mailer] SMTP_USER or SMTP_PASS is missing."
    );

    return false;
  }

  if (!mailFrom) {
    console.error(
      "[Mailer] MAIL_FROM is invalid."
    );

    return false;
  }

  if (!transporter) {
    console.error(
      "[Mailer] SMTP transporter was not created."
    );

    return false;
  }

  try {
    await transporter.verify();

    console.log(
      "================================================"
    );

    console.log(
      "[Mailer] SMTP CONNECTION VERIFIED"
    );

    console.log(
      `[Mailer] Host: ${smtpHost}`
    );

    console.log(
      `[Mailer] Port: ${smtpPort}`
    );

    console.log(
      `[Mailer] Sender: ${mailFrom.address}`
    );

    console.log(
      "================================================"
    );

    return true;

  } catch (err) {
    console.error(
      "================================================"
    );

    console.error(
      "[Mailer] SMTP VERIFICATION FAILED"
    );

    console.error(
      "[Mailer] Error:",
      err.message
    );

    console.error(
      "================================================"
    );

    return false;
  }
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  sendMail,
  sendOtpEmail,
  verifyMailer,
};
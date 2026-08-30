// backend/utils/otp.js
const db = require("../config/db");
const { sendOtpEmail } = require("./mailer");

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Creates and dispatches an Email OTP. */
async function issueOtpPair(user, purpose = "register") {
  if (!user || !user.id || !user.email) {
    throw new Error("Valid user object with id and email is required to issue an OTP.");
  }

  const emailCode = genCode();

  // Invalidate any previous unused OTPs for this user and purpose
  await db.query(
    "UPDATE otp_codes SET used = 1, is_used = 1 WHERE user_id = ? AND purpose = ? AND used = 0",
    [user.id, purpose]
  );

  // Insert fresh OTP using MySQL native 10-minute expiry
  await db.query(
    `INSERT INTO otp_codes (user_id, purpose, channel, code, target, used, is_used, expires_at) 
     VALUES (?, ?, 'email', ?, ?, 0, 0, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [user.id, purpose, emailCode, user.email]
  );

  await sendOtpEmail(user.email, emailCode, purpose);

  return { success: true };
}

/** Verifies the Email OTP code. */
async function verifyOtp(userId, purpose, channel = "email", code) {
  if (!userId || !code) {
    return { ok: false, reason: "User ID and OTP code are required." };
  }

  try {
    const [rows] = await db.query(
      `SELECT * FROM otp_codes 
       WHERE user_id = ? AND purpose = ? AND channel = ? AND used = 0 AND is_used = 0 
       ORDER BY id DESC LIMIT 1`,
      [userId, purpose, channel]
    );

    const row = rows[0];
    if (!row) {
      return { ok: false, reason: "No active verification code found." };
    }

    // Verify code characters
    if (row.code.trim() !== String(code).trim()) {
      return { ok: false, reason: "Incorrect OTP code. Please check and try again." };
    }

    // Verify expiration against MySQL server timestamp
    const [expCheck] = await db.query(
      "SELECT id FROM otp_codes WHERE id = ? AND expires_at >= NOW()",
      [row.id]
    );

    if (!expCheck || expCheck.length === 0) {
      return { ok: false, reason: "OTP has expired. Click 'Resend Code' for a new one." };
    }

    // Mark as consumed
    await db.query("UPDATE otp_codes SET used = 1, is_used = 1 WHERE id = ?", [row.id]);
    return { ok: true };
  } catch (err) {
    console.error("verifyOtp error:", err.message || err);
    return { ok: false, reason: "Database error during OTP verification." };
  }
}

module.exports = { 
  issueOtpPair, 
  verifyOtp, 
  genCode 
};
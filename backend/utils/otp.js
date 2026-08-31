// backend/utils/otp.js

const db = require("../config/db");
const { sendOtpEmail } = require("./mailer");

// ============================================================
// GENERATE 6 DIGIT OTP
// ============================================================

function genCode() {
  return String(
    Math.floor(100000 + Math.random() * 900000)
  );
}

// ============================================================
// ISSUE OTP
// ============================================================

async function issueOtpPair(user, purpose = "register") {
  if (!user || !user.id || !user.email) {
    throw new Error(
      "Valid user object with id and email is required to issue an OTP."
    );
  }

  const emailCode = genCode();

  // Invalidate previous OTPs
  // IMPORTANT: consumed is PostgreSQL BOOLEAN
  await db.query(
    `
    UPDATE otp_codes
    SET consumed = TRUE
    WHERE user_id = $1
      AND purpose = $2
      AND channel = 'email'
      AND consumed = FALSE
    `,
    [user.id, purpose]
  );

  // Create new OTP
  await db.query(
    `
    INSERT INTO otp_codes
    (
      user_id,
      purpose,
      channel,
      code,
      expires_at,
      consumed
    )
    VALUES
    (
      $1,
      $2,
      'email',
      $3,
      CURRENT_TIMESTAMP + INTERVAL '10 minutes',
      FALSE
    )
    `,
    [
      user.id,
      purpose,
      emailCode,
    ]
  );

  // Send email
  await sendOtpEmail(
    user.email,
    emailCode,
    purpose
  );

  console.log(
    `[OTP] OTP sent to ${user.email} for ${purpose}`
  );

  return {
    success: true,
  };
}

// ============================================================
// VERIFY OTP
// ============================================================

async function verifyOtp(
  userId,
  purpose,
  channel = "email",
  code
) {
  if (!userId || !code) {
    return {
      ok: false,
      reason:
        "User ID and OTP code are required.",
    };
  }

  try {
    const result = await db.query(
      `
      SELECT *
      FROM otp_codes
      WHERE user_id = $1
        AND purpose = $2
        AND channel = $3
        AND consumed = FALSE
      ORDER BY id DESC
      LIMIT 1
      `,
      [
        userId,
        purpose,
        channel,
      ]
    );

    const row = result.rows[0];

    if (!row) {
      return {
        ok: false,
        reason:
          "No active verification code found.",
      };
    }

    // Check OTP
    if (
      String(row.code).trim() !==
      String(code).trim()
    ) {
      return {
        ok: false,
        reason:
          "Incorrect OTP code. Please check and try again.",
      };
    }

    // Check expiry
    const expiryResult = await db.query(
      `
      SELECT id
      FROM otp_codes
      WHERE id = $1
        AND expires_at >= CURRENT_TIMESTAMP
        AND consumed = FALSE
      `,
      [row.id]
    );

    if (expiryResult.rows.length === 0) {
      return {
        ok: false,
        reason:
          "OTP has expired. Click 'Resend Code' for a new one.",
      };
    }

    // Consume OTP
    await db.query(
      `
      UPDATE otp_codes
      SET consumed = TRUE
      WHERE id = $1
      `,
      [row.id]
    );

    return {
      ok: true,
    };

  } catch (err) {
    console.error(
      "VERIFY OTP ERROR:",
      err.message
    );

    return {
      ok: false,
      reason:
        "Database error during OTP verification.",
    };
  }
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  issueOtpPair,
  verifyOtp,
  genCode,
};
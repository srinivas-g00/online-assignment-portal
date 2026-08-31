// backend/routes/authRoutes.js

require("dotenv").config();

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../config/db");
const {
  issueOtpPair,
  verifyOtp,
} = require("../utils/otp");

const router = express.Router();

// ============================================================
// CAPTCHA STORE
// ============================================================

const activeCaptchas = new Map();

setInterval(() => {
  const now = Date.now();

  for (const [id, record] of activeCaptchas.entries()) {
    if (record.expiresAt < now) {
      activeCaptchas.delete(id);
    }
  }
}, 60 * 1000);

// ============================================================
// CAPTCHA VERIFICATION
// ============================================================

function verifyCaptchaLocal(captchaId, answer) {
  if (!captchaId || !answer) {
    return false;
  }

  const record = activeCaptchas.get(captchaId);

  if (!record) {
    return false;
  }

  if (record.expiresAt < Date.now()) {
    activeCaptchas.delete(captchaId);
    return false;
  }

  // Prevent replay
  activeCaptchas.delete(captchaId);

  return (
    record.answer.toLowerCase() ===
    String(answer).trim().toLowerCase()
  );
}

// ============================================================
// DELETE UNVERIFIED USER
// ============================================================

async function deleteUnverifiedUser(userId) {
  try {
    const result = await db.query(
      `
      SELECT id, is_active
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    const user = result.rows[0];

    if (!user) {
      return;
    }

    // PostgreSQL BOOLEAN
    if (user.is_active === true) {
      return;
    }

    await db.query(
      `
      DELETE FROM student_profile
      WHERE user_id = $1
      `,
      [userId]
    );

    await db.query(
      `
      DELETE FROM faculty_profile
      WHERE user_id = $1
      `,
      [userId]
    );

    await db.query(
      `
      DELETE FROM otp_codes
      WHERE user_id = $1
      `,
      [userId]
    );

    await db.query(
      `
      DELETE FROM users
      WHERE id = $1
      `,
      [userId]
    );

    console.log(
      `Unverified registration ${userId} deleted.`
    );
  } catch (err) {
    console.error(
      "DELETE UNVERIFIED USER ERROR:",
      err.message
    );
  }
}

// ============================================================
// CAPTCHA
// ============================================================

router.get("/captcha", async (req, res) => {
  try {
    const chars =
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let text = "";

    for (let i = 0; i < 5; i++) {
      text += chars.charAt(
        Math.floor(Math.random() * chars.length)
      );
    }

    const captchaId =
      Date.now().toString() +
      Math.random().toString(36).substring(2, 8);

    const expiresAt =
      Date.now() + 5 * 60 * 1000;

    activeCaptchas.set(captchaId, {
      answer: text,
      expiresAt,
    });

    res.json({
      captchaId,
      captchaText: text,
      text,
    });
  } catch (err) {
    console.error(
      "CAPTCHA ERROR:",
      err.message
    );

    res.status(500).json({
      error: "Could not generate captcha.",
    });
  }
});

// ============================================================
// REGISTER
// ============================================================

router.post("/register", async (req, res) => {
  let userId = null;

  try {
    const {
      role,
      name,
      username,
      email,
      password,
      confirmPassword,
      captchaId,
      captchaAnswer,
      branch = null,
      year = null,
      subject = null,
      slot = null,
    } = req.body;

    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (!["student", "faculty"].includes(role)) {
      return res.status(400).json({
        error: "Invalid role.",
      });
    }

    if (!name || !username || !email || !password) {
      return res.status(400).json({
        error: "All required fields must be filled.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters.",
      });
    }

    if (!confirmPassword || password !== confirmPassword) {
      return res.status(400).json({
        error: "Passwords do not match.",
      });
    }

    // --------------------------------------------------------
    // CAPTCHA
    // --------------------------------------------------------

    if (!verifyCaptchaLocal(captchaId, captchaAnswer)) {
      return res.status(400).json({
        error:
          "Captcha verification failed. Please try again.",
      });
    }

    const cleanName = name.trim();
    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    // --------------------------------------------------------
    // CHECK EXISTING USER
    // --------------------------------------------------------

    const existingResult = await db.query(
      `
      SELECT id, is_active
      FROM users
      WHERE username = $1
         OR LOWER(email) = $2
      LIMIT 1
      `,
      [cleanUsername, cleanEmail]
    );

    if (existingResult.rows.length > 0) {
      const existingUser = existingResult.rows[0];

      // PostgreSQL BOOLEAN
      if (existingUser.is_active === true) {
        return res.status(409).json({
          error:
            "Username or email already registered.",
        });
      }

      await deleteUnverifiedUser(existingUser.id);
    }

    // --------------------------------------------------------
    // HASH PASSWORD
    // --------------------------------------------------------

    const passwordHash = await bcrypt.hash(
      password,
      12
    );

    // --------------------------------------------------------
    // INSERT USER
    // IMPORTANT:
    // PostgreSQL uses TRUE/FALSE, not 1/0.
    // --------------------------------------------------------

    const insertResult = await db.query(
      `
      INSERT INTO users
      (
        name,
        username,
        email,
        password,
        role,
        email_verified,
        is_active,
        branch,
        year,
        subject,
        slot
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        FALSE,
        FALSE,
        $6,
        $7,
        $8,
        $9
      )
      RETURNING id
      `,
      [
        cleanName,
        cleanUsername,
        cleanEmail,
        passwordHash,
        role,
        branch,
        year,
        subject,
        slot,
      ]
    );

    userId = insertResult.rows[0].id;

    // --------------------------------------------------------
    // STUDENT PROFILE
    // --------------------------------------------------------

    if (role === "student") {
      await db.query(
        `
        INSERT INTO student_profile
        (
          user_id,
          branch,
          year
        )
        VALUES
        (
          $1,
          $2,
          $3
        )
        `,
        [
          userId,
          branch,
          year,
        ]
      );
    }

    // --------------------------------------------------------
    // FACULTY PROFILE
    // --------------------------------------------------------

    if (role === "faculty") {
      await db.query(
        `
        INSERT INTO faculty_profile
        (
          user_id,
          branch,
          subject,
          slot
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4
        )
        `,
        [
          userId,
          branch,
          subject,
          slot,
        ]
      );
    }

    // --------------------------------------------------------
    // GET USER
    // --------------------------------------------------------

    const userResult = await db.query(
      `
      SELECT *
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    const user = userResult.rows[0];

    // --------------------------------------------------------
    // SEND REGISTRATION OTP
    // --------------------------------------------------------

    await issueOtpPair(
      user,
      "register"
    );

    res.json({
      message:
        "Registration successful. OTP sent to your email.",
      userId,
      needsVerification: true,
    });

  } catch (err) {
    console.error(
      "REGISTRATION ERROR:",
      err.message
    );

    if (userId) {
      await deleteUnverifiedUser(userId);
    }

    res.status(500).json({
      error:
        "Registration failed: " + err.message,
    });
  }
});

// ============================================================
// VERIFY REGISTRATION OTP
// ============================================================

router.post(
  "/verify-registration",
  async (req, res) => {
    try {
      const {
        userId,
        emailOtp,
        otp,
      } = req.body;

      const code = emailOtp || otp;

      if (!userId || !code) {
        return res.status(400).json({
          error:
            "User ID and OTP are required.",
        });
      }

      const result = await db.query(
        `
        SELECT *
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      const user = result.rows[0];

      if (!user) {
        return res.status(404).json({
          error:
            "Registration not found.",
        });
      }

      // PostgreSQL BOOLEAN
      if (user.is_active === true) {
        return res.status(400).json({
          error:
            "Account already verified.",
        });
      }

      const check = await verifyOtp(
        userId,
        "register",
        "email",
        code
      );

      if (!check.ok) {
        return res.status(400).json({
          error: check.reason,
        });
      }

      await db.query(
        `
        UPDATE users
        SET
          email_verified = TRUE,
          is_active = TRUE,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [userId]
      );

      res.json({
        message:
          "Account verified. You can now login.",
        verified: true,
      });

    } catch (err) {
      console.error(
        "VERIFY REGISTRATION ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Verification failed.",
      });
    }
  }
);

// ============================================================
// RESEND OTP
// ============================================================

router.post(
  "/resend-otp",
  async (req, res) => {
    try {
      const {
        userId,
        purpose = "register",
      } = req.body;

      if (!userId) {
        return res.status(400).json({
          error:
            "User ID is required.",
        });
      }

      const result = await db.query(
        `
        SELECT *
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      const user = result.rows[0];

      if (!user) {
        return res.status(404).json({
          error:
            "Account not found.",
        });
      }

      await issueOtpPair(
        user,
        purpose
      );

      res.json({
        message:
          "OTP resent to your email.",
      });

    } catch (err) {
      console.error(
        "RESEND OTP ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not resend OTP.",
      });
    }
  }
);

// ============================================================
// LOGIN
// ============================================================

router.post(
  "/login",
  async (req, res) => {
    try {
      const {
        role,
        usernameOrEmail,
        password,
        captchaId,
        captchaAnswer,
      } = req.body;

      if (
        !role ||
        !usernameOrEmail ||
        !password
      ) {
        return res.status(400).json({
          error:
            "Role, username/email and password are required.",
        });
      }

      // ------------------------------------------------------
      // CAPTCHA
      // ------------------------------------------------------

      if (!verifyCaptchaLocal(
        captchaId,
        captchaAnswer
      )) {
        return res.status(400).json({
          error:
            "Captcha verification failed. Please try again.",
        });
      }

      const loginValue =
        usernameOrEmail.trim().toLowerCase();

      // ------------------------------------------------------
      // FIND USER
      // ------------------------------------------------------

      const result = await db.query(
        `
        SELECT *
        FROM users
        WHERE role = $1
          AND
          (
            LOWER(username) = $2
            OR LOWER(email) = $2
          )
        LIMIT 1
        `,
        [
          role,
          loginValue,
        ]
      );

      const user = result.rows[0];

      if (!user) {
        return res.status(401).json({
          error:
            "Invalid credentials.",
        });
      }

      // ------------------------------------------------------
      // PASSWORD
      // ------------------------------------------------------

      const passwordMatches =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!passwordMatches) {
        return res.status(401).json({
          error:
            "Invalid credentials.",
        });
      }

      // ------------------------------------------------------
      // EMAIL VERIFICATION
      // PostgreSQL BOOLEAN
      // ------------------------------------------------------

      if (user.is_active !== true) {
        await issueOtpPair(
          user,
          "register"
        );

        return res.status(403).json({
          error:
            "Account not verified. A verification code has been sent to your email.",
          needsVerification: true,
          userId: user.id,
        });
      }

      // ------------------------------------------------------
      // JWT
      // ------------------------------------------------------

      if (!process.env.JWT_SECRET) {
        console.error(
          "JWT_SECRET is missing from .env"
        );

        return res.status(500).json({
          error:
            "Server authentication configuration is missing.",
        });
      }

      const token = jwt.sign(
        {
          id: user.id,
          role: user.role,
          username: user.username,
          name: user.name,
        },
        process.env.JWT_SECRET,
        {
          expiresIn:
            process.env.JWT_EXPIRES_IN || "7d",
        }
      );

      res.json({
        token,
        user: {
          id: user.id,
          role: user.role,
          username: user.username,
          name: user.name,
          email: user.email,
        },
      });

    } catch (err) {
      console.error(
        "LOGIN ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Login failed: " + err.message,
      });
    }
  }
);

// ============================================================
// FORGOT PASSWORD
// ============================================================

router.post(
  "/forgot-password",
  async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          error:
            "Email is required.",
        });
      }

      const cleanEmail =
        email.trim().toLowerCase();

      const result = await db.query(
        `
        SELECT *
        FROM users
        WHERE LOWER(email) = $1
          AND is_active = TRUE
        LIMIT 1
        `,
        [cleanEmail]
      );

      const user = result.rows[0];

      if (!user) {
        return res.status(404).json({
          error:
            "No active account found with this email.",
        });
      }

      await issueOtpPair(
        user,
        "reset_password"
      );

      res.json({
        message:
          "Password reset OTP sent to your email.",
        userId: user.id,
      });

    } catch (err) {
      console.error(
        "FORGOT PASSWORD ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not initiate password reset.",
      });
    }
  }
);

// ============================================================
// RESET PASSWORD
// ============================================================

router.post(
  "/reset-password",
  async (req, res) => {
    try {
      const {
        userId,
        otp,
        newPassword,
      } = req.body;

      if (
        !userId ||
        !otp ||
        !newPassword
      ) {
        return res.status(400).json({
          error:
            "All fields are required.",
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          error:
            "Password must be at least 8 characters.",
        });
      }

      const check = await verifyOtp(
        userId,
        "reset_password",
        "email",
        otp
      );

      if (!check.ok) {
        return res.status(400).json({
          error:
            check.reason,
        });
      }

      const newPasswordHash =
        await bcrypt.hash(
          newPassword,
          12
        );

      await db.query(
        `
        UPDATE users
        SET
          password = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        `,
        [
          newPasswordHash,
          userId,
        ]
      );

      res.json({
        message:
          "Password reset successful. You can now login with your new password.",
      });

    } catch (err) {
      console.error(
        "RESET PASSWORD ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Failed to reset password.",
      });
    }
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
// backend/routes/authRoutes.js
require("dotenv").config();

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../config/db");
const { issueOtpPair, verifyOtp } = require("../utils/otp");

const router = express.Router();

// In-memory store for instant text captcha validation
const activeCaptchas = new Map();

// Periodic cleanup of expired captchas
setInterval(() => {
  const now = Date.now();
  for (const [id, record] of activeCaptchas.entries()) {
    if (record.expiresAt < now) {
      activeCaptchas.delete(id);
    }
  }
}, 60 * 1000);

function verifyCaptchaLocal(captchaId, answer) {
  if (!captchaId || !answer) return false;
  const record = activeCaptchas.get(captchaId);
  if (!record) return false;
  if (record.expiresAt < Date.now()) {
    activeCaptchas.delete(captchaId);
    return false;
  }
  // Remove once verified to prevent replay
  activeCaptchas.delete(captchaId);
  return record.answer.toLowerCase() === String(answer).trim().toLowerCase();
}

async function deleteUnverifiedUser(userId) {
  try {
    const [rows] = await db.query("SELECT id, is_active FROM users WHERE id = ?", [userId]);
    const user = rows[0];
    if (!user || user.is_active) return;

    await db.query("DELETE FROM student_profile WHERE user_id = ?", [userId]).catch(() => {});
    await db.query("DELETE FROM faculty_profile WHERE user_id = ?", [userId]).catch(() => {});
    await db.query("DELETE FROM otp_codes WHERE user_id = ?", [userId]).catch(() => {});
    await db.query("DELETE FROM users WHERE id = ?", [userId]);
    console.log(`Unverified registration ${userId} deleted.`);
  } catch (error) {
    console.error("Error deleting unverified user:", error.message || error);
  }
}

// CAPTCHA: Fast In-Memory Text Captcha
router.get("/captcha", async (req, res) => {
  try {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let text = "";
    for (let i = 0; i < 5; i++) {
      text += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const captchaId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

    activeCaptchas.set(captchaId, {
      answer: text,
      expiresAt: expiresAt,
    });

    res.json({
      captchaId,
      captchaText: text,
      text: text,
    });
  } catch (e) {
    console.error("CAPTCHA ERROR:", e.message || e);
    res.status(500).json({ error: "Could not generate captcha." });
  }
});

// REGISTER (Requires Email OTP & Password Confirmation)
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

    if (!["student", "faculty"].includes(role)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    if (!name || !username || !email || !password) {
      return res.status(400).json({ error: "All required fields must be filled." });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    const captchaValid = verifyCaptchaLocal(captchaId, captchaAnswer);
    if (!captchaValid) {
      return res.status(400).json({ error: "Captcha verification failed. Please try again." });
    }

    const [existsRows] = await db.query(
      "SELECT id, is_active FROM users WHERE username = ? OR email = ? LIMIT 1",
      [username.trim(), email.trim()]
    );

    if (existsRows.length > 0) {
      const existingUser = existsRows[0];
      if (existingUser.is_active) {
        return res.status(409).json({ error: "Username or email already registered." });
      }
      await deleteUnverifiedUser(existingUser.id);
    }

    const hash = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `INSERT INTO users (role, name, username, email, password_hash, email_verified, is_active, branch, year, subject, slot)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
      [role, name.trim(), username.trim(), email.trim(), hash, branch, year, subject, slot]
    );

    userId = result.insertId;

    if (role === "student") {
      await db.query("INSERT INTO student_profile (user_id, branch, year) VALUES (?, ?, ?)", [
        userId,
        branch,
        year,
      ]).catch(() => {});
    } else {
      await db.query(
        "INSERT INTO faculty_profile (user_id, branch, subject, slot) VALUES (?, ?, ?, ?)",
        [userId, branch, subject, slot]
      ).catch(() => {});
    }

    const [userRows] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
    const user = userRows[0];

    await issueOtpPair(user, "register");

    res.json({
      message: "Registration successful. OTP sent to your email.",
      userId: userId,
      needsVerification: true,
    });
  } catch (e) {
    console.error("REGISTRATION ERROR:", e.message || e);
    if (userId) await deleteUnverifiedUser(userId);
    res.status(500).json({ error: "Registration failed." });
  }
});

// VERIFY REGISTRATION OTP
router.post("/verify-registration", async (req, res) => {
  const { userId, emailOtp, otp } = req.body;
  const codeToVerify = emailOtp || otp;

  try {
    const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
    const user = rows[0];

    if (!user) return res.status(404).json({ error: "Registration not found." });
    if (user.is_active) return res.status(400).json({ error: "Account already verified." });

    const check = await verifyOtp(userId, "register", "email", codeToVerify);
    if (!check.ok) {
      return res.status(400).json({ error: check.reason });
    }

    await db.query("UPDATE users SET email_verified = 1, is_active = 1 WHERE id = ?", [userId]);

    res.json({ message: "Account verified. You can now login.", verified: true });
  } catch (e) {
    console.error("VERIFY REGISTRATION ERROR:", e.message || e);
    res.status(500).json({ error: "Verification failed." });
  }
});

// RESEND REGISTRATION OTP
router.post("/resend-otp", async (req, res) => {
  try {
    const { userId, purpose } = req.body;
    const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
    const user = rows[0];

    if (!user) return res.status(404).json({ error: "Account not found." });

    await issueOtpPair(user, purpose || "register");
    res.json({ message: "OTP resent to your email." });
  } catch (e) {
    console.error("RESEND OTP ERROR:", e.message || e);
    res.status(500).json({ error: "Could not resend OTP." });
  }
});

// DIRECT LOGIN (NO OTP)
router.post("/login", async (req, res) => {
  try {
    const { role, usernameOrEmail, password, captchaId, captchaAnswer } = req.body;

    const captchaValid = verifyCaptchaLocal(captchaId, captchaAnswer);
    if (!captchaValid) {
      return res.status(400).json({ error: "Captcha verification failed. Please try again." });
    }

    const [rows] = await db.query(
      "SELECT * FROM users WHERE role = ? AND (username = ? OR email = ?)",
      [role, usernameOrEmail.trim(), usernameOrEmail.trim()]
    );
    const user = rows[0];

    if (!user) return res.status(401).json({ error: "Invalid credentials." });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Invalid credentials." });

    if (!user.is_active) {
      await issueOtpPair(user, "register");
      return res.status(403).json({
        error: "Account not verified. A verification code has been sent to your email.",
        needsVerification: true,
        userId: user.id,
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, username: user.username, name: user.name },
      process.env.JWT_SECRET || "super_secret_jwt_key_autotrack_ai_2026",
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
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
  } catch (e) {
    console.error("LOGIN ERROR:", e.message || e);
    res.status(500).json({ error: "Login failed." });
  }
});

// FORGOT PASSWORD - STEP 1: SEND RESET OTP
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const [rows] = await db.query("SELECT * FROM users WHERE email = ? AND is_active = 1", [
      email.trim(),
    ]);
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ error: "No active account found with this email." });
    }

    await issueOtpPair(user, "reset_password");

    res.json({
      message: "Password reset OTP sent to your email.",
      userId: user.id,
    });
  } catch (e) {
    console.error("FORGOT PASSWORD ERROR:", e.message || e);
    res.status(500).json({ error: "Could not initiate password reset." });
  }
});

// FORGOT PASSWORD - STEP 2: VERIFY OTP AND UPDATE PASSWORD
router.post("/reset-password", async (req, res) => {
  try {
    const { userId, otp, newPassword } = req.body;

    if (!userId || !otp || !newPassword) {
      return res.status(400).json({ error: "All fields are required." });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const check = await verifyOtp(userId, "reset_password", "email", otp);
    if (!check.ok) {
      return res.status(400).json({ error: check.reason });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, userId]);

    res.json({ message: "Password reset successful. You can now login with your new password." });
  } catch (e) {
    console.error("RESET PASSWORD ERROR:", e.message || e);
    res.status(500).json({ error: "Failed to reset password." });
  }
});

module.exports = router;
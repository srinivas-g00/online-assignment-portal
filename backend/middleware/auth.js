// backend/middleware/auth.js

require("dotenv").config();

const jwt = require("jsonwebtoken");

// ============================================================
// GET JWT SECRET
// ============================================================

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || !secret.trim()) {
    console.error(
      "AUTH ERROR: JWT_SECRET is missing from .env"
    );

    throw new Error(
      "JWT_SECRET is not configured."
    );
  }

  return secret;
}

// ============================================================
// AUTHENTICATE JWT
// ============================================================

function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // No Authorization header
    if (!authHeader) {
      return res.status(401).json({
        error: "Authentication token is required.",
      });
    }

    // Invalid Authorization format
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Invalid authentication format.",
      });
    }

    // Extract token
    const token = authHeader
      .substring(7)
      .trim();

    if (!token) {
      return res.status(401).json({
        error: "Authentication token is required.",
      });
    }

    // Get secret
    const secret = getJwtSecret();

    // Verify JWT
    const decoded = jwt.verify(
      token,
      secret
    );

    // Store decoded user information
    req.user = decoded;

    return next();

  } catch (err) {
    console.error(
      "JWT AUTHENTICATION ERROR:",
      err.message || err
    );

    return res.status(401).json({
      error:
        "Invalid or expired session. Please log in again.",
    });
  }
}

// ============================================================
// ROLE AUTHORIZATION
// ============================================================

function requireRole(requiredRole) {
  return function (req, res, next) {

    // User not authenticated
    if (!req.user) {
      return res.status(401).json({
        error: "Authentication required.",
      });
    }

    // Check role
    if (req.user.role !== requiredRole) {
      return res.status(403).json({
        error:
          `Access denied. Requires ${requiredRole} role.`,
      });
    }

    return next();
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  auth,
  authenticate: auth,
  requireRole,
};
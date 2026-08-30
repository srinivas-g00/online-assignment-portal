// backend/middleware/auth.js
const jwt = require("jsonwebtoken");

/**
 * Authenticates standard JWT bearer tokens.
 */
function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication token is required." });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "default_secret_key");
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
  }
}

/**
 * Role authorization guard
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: `Access denied. Requires ${role} role.` });
    }
    next();
  };
}

module.exports = {
  auth,
  authenticate: auth,
  requireRole,
};
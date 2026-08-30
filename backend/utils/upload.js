// backend/utils/upload.js
// Multer storage config used by every upload route (question papers,
// answer-key files, and student answer submissions). Accepts ANY file
// type (pdf, doc/docx, images, zip, etc.) up to MAX_UPLOAD_MB (default 5MB).
require("dotenv").config();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 5);

function getUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function makeUploader(subfolder) {
  const dest = path.join(__dirname, "..", "uploads", subfolder);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 12);
      cb(null, `${Date.now()}_${getUuid()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_MB * 1024 * 1024 },
  });
}

module.exports = {
  uploadAnswer: makeUploader("answers"),
  uploadQuestion: makeUploader("questions"),
  uploadKey: makeUploader("keys"),
  MAX_MB,
};
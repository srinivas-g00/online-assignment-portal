// backend/utils/captcha.js
// Generates a 5-character mixed alphanumeric captcha and renders it as an
// inline SVG (no native canvas dependency needed) or plain text.
const crypto = require("crypto");
const db = require("../config/db");

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz"; // no 0/O/1/l/I to avoid confusion

function randomText(len = 5) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return out;
}

function buildSvg(text) {
  const width = 170;
  const height = 60;
  const colors = ["#1d4ed8", "#c2413a", "#16825d", "#7c3aed", "#b45309"];
  let letters = "";

  for (let i = 0; i < text.length; i++) {
    const x = 18 + i * 30;
    const y = 38 + (Math.random() * 10 - 5);
    const rotate = Math.floor(Math.random() * 34) - 17;
    const color = colors[i % colors.length];
    letters += `<text x="${x}" y="${y}" font-size="30" font-family="Verdana,Arial,sans-serif" font-weight="700" fill="${color}" transform="rotate(${rotate} ${x} ${y})">${text[i]}</text>`;
  }

  let noise = "";
  for (let i = 0; i < 6; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    noise += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#c7d2e1" stroke-width="1.5"/>`;
  }

  let dots = "";
  for (let i = 0; i < 40; i++) {
    dots += `<circle cx="${(Math.random() * width).toFixed(1)}" cy="${(Math.random() * height).toFixed(1)}" r="1" fill="#dbe4f0"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f4f7fc" rx="10"/>${dots}${noise}${letters}</svg>`;
}

/** Creates a new captcha, stores it (5 min expiry) and returns {captchaId, svg, text, captchaText} */
async function createCaptcha() {
  const text = randomText(5);
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");

  await db.query(
    "INSERT INTO captchas (id, captcha_text, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))",
    [id, text]
  );

  // Background cleanup: drop expired captchas
  db.query("DELETE FROM captchas WHERE expires_at < NOW()").catch(() => {});

  const svg = buildSvg(text);

  return {
    captchaId: id,
    svg,
    captchaText: text,
    text,
  };
}

/** Verifies + consumes a captcha answer (case-insensitive, single use) */
async function verifyCaptcha(captchaId, answer) {
  if (!captchaId || !answer) return false;

  try {
    const [rows] = await db.query("SELECT * FROM captchas WHERE id = ?", [captchaId]);
    const row = rows[0];
    if (!row) return false;

    // Single use: delete record immediately
    await db.query("DELETE FROM captchas WHERE id = ?", [captchaId]);

    // Check expiry using DB comparison
    const [expRows] = await db.query("SELECT id FROM captchas WHERE id = ? AND expires_at >= NOW()", [
      captchaId,
    ]);

    // If already expired in DB
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return false;
    }

    return row.captcha_text.toLowerCase() === String(answer).trim().toLowerCase();
  } catch (err) {
    console.error("verifyCaptcha error:", err.message || err);
    return false;
  }
}

module.exports = {
  createCaptcha,
  verifyCaptcha,
};
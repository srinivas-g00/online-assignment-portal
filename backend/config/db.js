// backend/config/db.js
require("dotenv").config();
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "assignment_portal",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

async function safeAddColumn(tableName, columnName, columnDefinition) {
  try {
    const [cols] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
    if (cols.length === 0) {
      await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefinition}`);
      console.log(`[DB Migration] Added missing column '${columnName}' to table '${tableName}'.`);
    }
  } catch (err) {
    if (err.errno !== 1146) {
      console.warn(`[DB Migration Warning] ${tableName}.${columnName}:`, err.message);
    }
  }
}

async function autoMigrate() {
  // 1. Ensure core exam tables exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exams (
      id INT AUTO_INCREMENT PRIMARY KEY,
      faculty_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      exam_date DATE NOT NULL,
      start_time TIME NOT NULL,
      duration_min INT NOT NULL DEFAULT 30,
      total_marks INT NOT NULL DEFAULT 0,
      subject VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `).catch((err) => console.warn("[DB Init Warning] exams table:", err.message));

  // Ensure exam_questions exists (required by foreign key in exam_answers)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_questions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exam_id INT NOT NULL,
      question_text TEXT NOT NULL,
      option_a VARCHAR(255) NOT NULL,
      option_b VARCHAR(255) NOT NULL,
      option_c VARCHAR(255) NOT NULL,
      option_d VARCHAR(255) NOT NULL,
      correct_option VARCHAR(5) NOT NULL,
      marks INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `).catch((err) => console.warn("[DB Init Warning] exam_questions table:", err.message));

  // Sync questions table if exam_questions exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exam_id INT NOT NULL,
      question_text TEXT NOT NULL,
      option_a VARCHAR(255) NOT NULL,
      option_b VARCHAR(255) NOT NULL,
      option_c VARCHAR(255) NOT NULL,
      option_d VARCHAR(255) NOT NULL,
      correct_option VARCHAR(5) NOT NULL,
      marks INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `).catch((err) => console.warn("[DB Init Warning] questions table:", err.message));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_attempts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exam_id INT NOT NULL,
      student_id INT NOT NULL,
      score INT NULL,
      posted TINYINT(1) DEFAULT 0,
      auto_submitted TINYINT(1) DEFAULT 0,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `).catch((err) => console.warn("[DB Init Warning] exam_attempts table:", err.message));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_answers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      attempt_id INT NOT NULL,
      question_id INT NOT NULL,
      selected VARCHAR(5) NULL
    )
  `).catch((err) => console.warn("[DB Init Warning] exam_answers table:", err.message));

  // 2. Ensure Exams table columns
  await safeAddColumn("exams", "total_marks", "INT NOT NULL DEFAULT 0");
  await safeAddColumn("exams", "subject", "VARCHAR(255) NULL");
  await safeAddColumn("exams", "duration_min", "INT NOT NULL DEFAULT 30");

  // 3. Ensure Submissions table columns
  await safeAddColumn("submissions", "file_path", "VARCHAR(255) NULL");
  await safeAddColumn("submissions", "file_original", "VARCHAR(255) NULL");
  await safeAddColumn("submissions", "submitted_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
  await safeAddColumn("submissions", "final_marks", "INT NULL");
  await safeAddColumn("submissions", "posted", "TINYINT(1) DEFAULT 0");
  await safeAddColumn("submissions", "posted_at", "DATETIME NULL");
  await safeAddColumn("submissions", "resubmit_count", "INT DEFAULT 0");
  await safeAddColumn("submissions", "similarity_pct", "INT DEFAULT 0");
  await safeAddColumn("submissions", "duplicate_flag", "TINYINT(1) DEFAULT 0");
  await safeAddColumn("submissions", "auto_marks", "INT NULL");
  await safeAddColumn("submissions", "auto_feedback", "TEXT NULL");

  // 4. Ensure Assignments table columns
  await safeAddColumn("assignments", "due_time", "TIME DEFAULT '23:59:59'");
  await safeAddColumn("assignments", "question_file", "VARCHAR(255) NULL");
  await safeAddColumn("assignments", "question_original", "VARCHAR(255) NULL");
  await safeAddColumn("assignments", "answer_key", "TEXT NULL");
  await safeAddColumn("assignments", "answer_key_file", "VARCHAR(255) NULL");
  await safeAddColumn("assignments", "closed", "TINYINT(1) DEFAULT 0");

  // 5. Ensure Users table columns
  await safeAddColumn("users", "branch", "VARCHAR(100) NULL");
  await safeAddColumn("users", "year", "VARCHAR(50) NULL");
  await safeAddColumn("users", "subject", "VARCHAR(255) NULL");
  await safeAddColumn("users", "slot", "VARCHAR(100) NULL");
  await safeAddColumn("users", "email_otp", "VARCHAR(10) NULL");
  await safeAddColumn("users", "otp_expires_at", "DATETIME NULL");

  // 6. Ensure Exam Attempts table columns
  await safeAddColumn("exam_attempts", "score", "INT NULL");
  await safeAddColumn("exam_attempts", "posted", "TINYINT(1) DEFAULT 0");
  await safeAddColumn("exam_attempts", "auto_submitted", "TINYINT(1) DEFAULT 0");
  await safeAddColumn("exam_attempts", "submitted_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
}

pool
  .getConnection()
  .then(async (conn) => {
    console.log(`Connected to Local MySQL database "${process.env.DB_NAME || "assignment_portal"}".`);
    conn.release();
    await autoMigrate();
  })
  .catch((err) => {
    console.error("Could not connect to MySQL. Check DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME in .env");
    console.error(err.message);
  });

module.exports = pool;
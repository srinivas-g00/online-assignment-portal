// backend/routes/studentRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../config/db");
const { auth, requireRole } = require("../middleware/auth");

// File upload configuration for student answers
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "..", "uploads", "answers");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const maxMb = Number(process.env.MAX_UPLOAD_MB) || 15;
const upload = multer({
  storage,
  limits: { fileSize: maxMb * 1024 * 1024 },
});

// Protect all student routes
router.use(auth);
router.use(requireRole("student"));

// 1. Get current logged-in student profile
router.get("/me", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, username, email, role, branch, year FROM users WHERE id = ?",
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found." });
    res.json(rows[0]);
  } catch (err) {
    console.error("Student /me error:", err.message);
    res.status(500).json({ error: "Failed to fetch student profile." });
  }
});

// 2. Search & list faculties with registration status
router.get("/faculties", async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search.trim()}%` : "%";
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.subject, u.slot, u.branch,
              e.status AS enrollStatus
       FROM users u
       LEFT JOIN enrollments e ON e.faculty_id = u.id AND e.student_id = ?
       WHERE u.role = 'faculty'
         AND (u.name LIKE ? OR u.subject LIKE ? OR u.branch LIKE ?)
       ORDER BY u.name ASC`,
      [req.user.id, search, search, search]
    );
    res.json(rows);
  } catch (err) {
    console.error("Student /faculties error:", err.message);
    res.status(500).json({ error: "Failed to fetch faculty list." });
  }
});

// 3. Get specific faculty profile and enroll status
router.get("/faculties/:facultyId", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.subject, u.slot, u.branch,
              e.status AS enrollStatus
       FROM users u
       LEFT JOIN enrollments e ON e.faculty_id = u.id AND e.student_id = ?
       WHERE u.id = ? AND u.role = 'faculty'`,
      [req.user.id, req.params.facultyId]
    );
    if (!rows.length) return res.status(404).json({ error: "Faculty not found." });
    res.json(rows[0]);
  } catch (err) {
    console.error("Student /faculties/:id error:", err.message);
    res.status(500).json({ error: "Failed to fetch faculty details." });
  }
});

// 4. Enroll under a faculty
router.post("/faculties/:facultyId/enroll", async (req, res) => {
  try {
    const [existing] = await db.query(
      "SELECT id, status FROM enrollments WHERE student_id = ? AND faculty_id = ?",
      [req.user.id, req.params.facultyId]
    );

    if (existing.length) {
      return res.status(400).json({ error: `Registration request already exists (${existing[0].status}).` });
    }

    await db.query(
      "INSERT INTO enrollments (student_id, faculty_id, status) VALUES (?, ?, 'pending')",
      [req.user.id, req.params.facultyId]
    );
    res.json({ message: "Registration request sent successfully." });
  } catch (err) {
    console.error("Student enroll error:", err.message);
    res.status(500).json({ error: "Failed to send registration request." });
  }
});

// 5. Get assignments posted by a specific accepted faculty
router.get("/faculties/:facultyId/assignments", async (req, res) => {
  try {
    const [enrollment] = await db.query(
      "SELECT status FROM enrollments WHERE student_id = ? AND faculty_id = ? AND status = 'accepted'",
      [req.user.id, req.params.facultyId]
    );

    if (!enrollment.length) {
      return res.status(403).json({ error: "You are not enrolled/accepted under this faculty." });
    }

    const [rows] = await db.query(
      `SELECT a.id, a.faculty_id, a.title, a.description, a.total_marks,
              a.due_date, COALESCE(a.due_time, '23:59:59') AS due_time, a.closed, 
              a.question_file, a.question_original,
              s.id AS submission_id, s.file_path, s.file_original,
              s.submitted_at, s.final_marks, s.posted, s.resubmit_count
       FROM assignments a
       LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
       WHERE a.faculty_id = ?
       ORDER BY a.due_date ASC`,
      [req.user.id, req.params.facultyId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Student faculty assignments error:", err.message);
    res.status(500).json({ error: "Failed to load assignments." });
  }
});

// 6. Submit an assignment answer
router.post("/assignments/:assignmentId/submit", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file was uploaded." });

  try {
    const [assignRows] = await db.query("SELECT * FROM assignments WHERE id = ?", [req.params.assignmentId]);
    if (!assignRows.length) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Assignment not found." });
    }

    const assignment = assignRows[0];
    const dueTime = assignment.due_time || "23:59:59";
    const dueMs = new Date(`${assignment.due_date}T${dueTime}`).getTime();

    if (assignment.closed || (!isNaN(dueMs) && dueMs < Date.now())) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Submission deadline has passed." });
    }

    const [existingSub] = await db.query(
      "SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?",
      [assignment.id, req.user.id]
    );

    if (existingSub.length) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Assignment already submitted. Use modify to replace." });
    }

    await db.query(
      `INSERT INTO submissions (assignment_id, student_id, file_path, file_original, submitted_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [assignment.id, req.user.id, req.file.filename, req.file.originalname]
    );

    res.json({ message: "Submission uploaded successfully." });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error("Student submit error:", err.message);
    res.status(500).json({ error: "Failed to submit assignment." });
  }
});

// 7. Request OTP to modify/replace submission
router.post("/submissions/:submissionId/request-modify-otp", async (req, res) => {
  try {
    const [sub] = await db.query(
      `SELECT s.*, u.email
       FROM submissions s
       JOIN users u ON u.id = s.student_id
       WHERE s.id = ? AND s.student_id = ?`,
      [req.params.submissionId, req.user.id]
    );

    if (!sub.length) return res.status(404).json({ error: "Submission not found." });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.query(
      "UPDATE users SET email_otp = ?, otp_expires_at = ? WHERE id = ?",
      [otp, expiresAt, req.user.id]
    );

    res.json({ message: "OTP sent to your registered email address." });
  } catch (err) {
    console.error("Modify OTP request error:", err.message);
    res.status(500).json({ error: "Failed to generate OTP." });
  }
});

// 8. Modify/replace existing submission with OTP
router.post("/submissions/:submissionId/modify", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No replacement file provided." });
  const { emailOtp } = req.body;

  try {
    const [userRows] = await db.query(
      "SELECT email_otp, otp_expires_at FROM users WHERE id = ?",
      [req.user.id]
    );

    if (!userRows.length || userRows[0].email_otp !== String(emailOtp).trim()) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Invalid OTP code." });
    }

    if (new Date(userRows[0].otp_expires_at).getTime() < Date.now()) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "OTP code has expired." });
    }

    await db.query(
      `UPDATE submissions
       SET file_path = ?, file_original = ?, submitted_at = NOW(), resubmit_count = resubmit_count + 1
       WHERE id = ? AND student_id = ?`,
      [req.file.filename, req.file.originalname, req.params.submissionId, req.user.id]
    );

    await db.query("UPDATE users SET email_otp = NULL WHERE id = ?", [req.user.id]);
    res.json({ message: "Submission updated successfully." });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error("Student modify submission error:", err.message);
    res.status(500).json({ error: "Failed to replace submission." });
  }
});

// 9. Get enrolled courses list
router.get("/my-courses", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.id, e.status, u.name, u.subject, u.slot, u.branch
       FROM enrollments e
       JOIN users u ON u.id = e.faculty_id
       WHERE e.student_id = ?
       ORDER BY e.id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Student /my-courses error:", err.message);
    res.status(500).json({ error: "Failed to load courses." });
  }
});

// 10. Get all posted marks for student
router.get("/marks", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.title, a.total_marks, u.name AS faculty_name,
              s.submitted_at, s.final_marks, s.posted
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN users u ON u.id = a.faculty_id
       WHERE s.student_id = ? AND s.posted = 1
       ORDER BY s.submitted_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Student /marks error:", err.message);
    res.status(500).json({ error: "Failed to load marks." });
  }
});

// 11. Get exams list available to student
router.get("/exams", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.id, e.title, e.exam_date, e.start_time, e.duration_min, e.total_marks,
              u.name AS faculty_name,
              att.submitted_at, att.score, att.posted
       FROM exams e
       JOIN users u ON u.id = e.faculty_id
       JOIN enrollments en ON en.faculty_id = e.faculty_id AND en.student_id = ? AND en.status = 'accepted'
       LEFT JOIN exam_attempts att ON att.exam_id = e.id AND att.student_id = ?
       ORDER BY e.exam_date DESC, e.start_time DESC`,
      [req.user.id, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Student /exams error:", err.message);
    res.status(500).json({ error: "Failed to load exams." });
  }
});

module.exports = router;
// backend/routes/facultyRoutes.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const db = require("../config/db");
const { auth, requireRole } = require("../middleware/auth");

// Fallback upload handlers
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = file.fieldname === "keyFile" ? "keys" : "questions";
    const dest = path.join(__dirname, "..", "uploads", folder);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
  },
});
const u = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });
const uploadQuestion = u;
const uploadKey = u;

// Robust File Text Extractor
async function extractTextFromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".docx") {
      try {
        const mammoth = require("mammoth");
        const res = await mammoth.extractRawText({ path: filePath });
        return res.value || "";
      } catch {
        const content = fs.readFileSync(filePath, "binary");
        return content.replace(/[^\x20-\x7E\n]/g, " ").replace(/\s+/g, " ");
      }
    } else if (ext === ".pdf") {
      try {
        const pdfParse = require("pdf-parse");
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text || "";
      } catch {
        const content = fs.readFileSync(filePath, "binary");
        return content.replace(/[^\x20-\x7E\n]/g, " ").replace(/\s+/g, " ");
      }
    } else if (ext === ".txt") {
      return fs.readFileSync(filePath, "utf8");
    }
    return "";
  } catch (err) {
    console.warn("Text extraction warning on", filePath, err.message);
    return "";
  }
}

// Token-based Jaccard similarity
function calculateSimilarity(text1, text2) {
  const getTokens = (t) =>
    (String(t || "").toLowerCase().match(/\b[a-z0-9_]{3,}\b/g) || []);

  const tokens1 = getTokens(text1);
  const tokens2 = getTokens(text2);

  if (!tokens1.length || !tokens2.length) return 0;

  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  let intersection = 0;
  set1.forEach((token) => {
    if (set2.has(token)) intersection++;
  });

  const union = new Set([...set1, ...set2]).size;
  return union === 0 ? 0 : Math.round((intersection / union) * 100);
}

const router = express.Router();
router.use(auth);
router.use(requireRole("faculty"));

// ---------- PROFILE ----------
router.get("/me", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.username, u.email, 
              COALESCE(u.branch, fp.branch, '') AS branch, 
              COALESCE(u.subject, fp.subject, '') AS subject, 
              COALESCE(u.slot, fp.slot, '') AS slot
       FROM users u 
       LEFT JOIN faculty_profile fp ON fp.user_id = u.id 
       WHERE u.id = ?`,
      [req.user.id]
    );
    res.json(rows[0] || {});
  } catch (err) {
    console.error("GET PROFILE ERROR:", err.message);
    res.status(500).json({ error: "Could not fetch profile." });
  }
});

// ---------- STUDENTS: pending / accepted enrollment requests ----------
router.get("/students", async (req, res) => {
  const status = req.query.status || "pending";
  try {
    const [rows] = await db.query(
      `SELECT e.id AS enrollment_id, u.id AS student_id, u.name, u.username,
              COALESCE(u.branch, sp.branch, '') AS branch, 
              COALESCE(u.year, sp.year, '') AS year,
              COALESCE(e.requested_at, NOW()) AS requested_at
       FROM enrollments e 
       JOIN users u ON u.id = e.student_id
       LEFT JOIN student_profile sp ON sp.user_id = u.id
       WHERE e.faculty_id = ? AND e.status = ? 
       ORDER BY e.id DESC`,
      [req.user.id, status]
    );
    res.json(rows || []);
  } catch (err) {
    try {
      const [fallbackRows] = await db.query(
        `SELECT e.id AS enrollment_id, u.id AS student_id, u.name, u.username,
                COALESCE(u.branch, '') AS branch, 
                COALESCE(u.year, '') AS year,
                NOW() AS requested_at
         FROM enrollments e 
         JOIN users u ON u.id = e.student_id
         WHERE e.faculty_id = ? AND e.status = ? 
         ORDER BY e.id DESC`,
        [req.user.id, status]
      );
      res.json(fallbackRows || []);
    } catch (fallbackErr) {
      console.error("GET STUDENTS ERROR:", fallbackErr.message);
      res.json([]);
    }
  }
});

router.post("/students/:enrollmentId/decision", async (req, res) => {
  const { decision } = req.body;
  if (!["accepted", "rejected"].includes(decision)) {
    return res.status(400).json({ error: "Invalid decision. Must be 'accepted' or 'rejected'." });
  }

  try {
    const [rows] = await db.query("SELECT * FROM enrollments WHERE id = ? AND faculty_id = ?", [
      req.params.enrollmentId,
      req.user.id,
    ]);
    const enrollment = rows[0];
    if (!enrollment) return res.status(404).json({ error: "Enrollment request not found." });

    await db.query("UPDATE enrollments SET status = ? WHERE id = ?", [decision, enrollment.id]);
    res.json({ message: `Student ${decision}.` });
  } catch (err) {
    console.error("ENROLLMENT DECISION ERROR:", err.message);
    res.status(500).json({ error: "Could not update enrollment decision." });
  }
});

// ---------- ASSIGNMENTS: create ----------
router.post("/assignments", uploadQuestion.single("questionFile"), async (req, res) => {
  const { title, description, totalMarks, dueDate, dueTime, subject, slot } = req.body;

  if (!title || !totalMarks || !dueDate || !dueTime) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Title, total marks, due date and due time are required." });
  }

  try {
    const fileName = req.file ? req.file.filename : null;
    const [result] = await db.query(
      `INSERT INTO assignments 
        (faculty_id, title, description, question_file, question_original, total_marks, due_date, due_time, subject, slot, closed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        req.user.id,
        title.trim(),
        (description || "").trim(),
        fileName,
        req.file ? req.file.originalname : null,
        Number(totalMarks),
        dueDate,
        dueTime,
        subject || null,
        slot || null,
      ]
    );

    res.json({ message: "Assignment posted.", assignmentId: result.insertId });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error("CREATE ASSIGNMENT ERROR:", err.message);
    res.status(500).json({ error: "Failed to create assignment." });
  }
});

// ---------- ASSIGNMENTS: list mine ----------
router.get("/assignments", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.*, (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count
       FROM assignments a 
       WHERE a.faculty_id = ? 
       ORDER BY a.due_date DESC, a.due_time DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET ASSIGNMENTS ERROR:", err.message);
    res.status(500).json({ error: "Could not fetch assignments." });
  }
});

// ---------- ASSIGNMENT: submissions list ----------
router.get("/assignments/:id/submissions", async (req, res) => {
  try {
    const [aRows] = await db.query(
      "SELECT * FROM assignments WHERE id = ? AND faculty_id = ?",
      [req.params.id, req.user.id]
    );
    const assignment = aRows[0];
    if (!assignment) return res.status(404).json({ error: "Assignment not found." });

    const [rows] = await db.query(
      `SELECT s.*, u.name AS student_name, u.username AS student_username
       FROM submissions s 
       JOIN users u ON u.id = s.student_id
       WHERE s.assignment_id = ? 
       ORDER BY s.submitted_at ASC`,
      [req.params.id]
    );

    res.json({ assignment, submissions: rows });
  } catch (err) {
    console.error("GET SUBMISSIONS ERROR:", err.message);
    res.status(500).json({ error: "Could not fetch submissions." });
  }
});

// ---------- ASSIGNMENT: set/update answer key ----------
router.post("/assignments/:id/answer-key", uploadKey.single("keyFile"), async (req, res) => {
  try {
    const [aRows] = await db.query(
      "SELECT * FROM assignments WHERE id = ? AND faculty_id = ?",
      [req.params.id, req.user.id]
    );
    const assignment = aRows[0];
    if (!assignment) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Assignment not found." });
    }

    let keyText = (req.body.keyText || "").trim();
    if (req.file) {
      try {
        const extracted = await extractTextFromFile(req.file.path);
        keyText = [keyText, extracted].filter(Boolean).join("\n");
      } catch {
        /* proceed */
      }
    }

    if (!keyText && !req.file) {
      return res.status(400).json({ error: "Provide answer-key text or upload a key document." });
    }

    const keyFileName = req.file ? req.file.filename : null;
    await db.query(
      "UPDATE assignments SET answer_key = ?, answer_key_file = COALESCE(?, answer_key_file) WHERE id = ?",
      [keyText, keyFileName, assignment.id]
    );

    res.json({ message: "Answer key saved. You can now run auto-correction." });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error("SET ANSWER KEY ERROR:", err.message);
    res.status(500).json({ error: "Could not save answer key." });
  }
});

// ---------- ASSIGNMENT: run auto-correction & duplicate detection ----------
router.post("/assignments/:id/auto-correct", async (req, res) => {
  try {
    const assignmentId = req.params.id;
    const { penaltyMarks = 0, matchThreshold = 70 } = req.body;
    const penalty = Number(penaltyMarks) || 0;
    const threshold = Math.max(1, Math.min(100, Number(matchThreshold) || 70));

    const [aRows] = await db.query(
      "SELECT * FROM assignments WHERE id = ? AND faculty_id = ?",
      [assignmentId, req.user.id]
    );
    const assignment = aRows[0];
    if (!assignment) return res.status(404).json({ error: "Assignment not found." });

    let answerKeyText = assignment.answer_key || "";
    if (assignment.answer_key_file) {
      const keyFilePath = path.join(__dirname, "..", "uploads", "keys", assignment.answer_key_file);
      const extractedKey = await extractTextFromFile(keyFilePath);
      answerKeyText += " " + extractedKey;
    }

    const [submissions] = await db.query(
      `SELECT s.*, u.name AS student_name, u.username AS student_username
       FROM submissions s
       JOIN users u ON u.id = s.student_id
       WHERE s.assignment_id = ?`,
      [assignmentId]
    );

    if (!submissions.length) {
      return res.status(400).json({ error: "No submissions to evaluate." });
    }

    // 1. Extract text from submitted files
    for (const sub of submissions) {
      const filePath = path.join(__dirname, "..", "uploads", "answers", sub.file_path);
      sub.extractedText = await extractTextFromFile(filePath);
    }

    // 2. Cross-compare submissions for duplicates
    for (let i = 0; i < submissions.length; i++) {
      submissions[i].duplicate_flag = 0;
      submissions[i].matched_with = [];

      for (let j = 0; j < submissions.length; j++) {
        if (i === j) continue;
        const sim = calculateSimilarity(submissions[i].extractedText, submissions[j].extractedText);
        if (sim >= 70) {
          submissions[i].duplicate_flag = 1;
          submissions[i].matched_with.push({
            name: submissions[j].student_name,
            pct: sim,
          });
        }
      }
    }

    // 3. Score against key & deduct duplicate penalty
    for (const sub of submissions) {
      const keySim = answerKeyText.trim() ? calculateSimilarity(sub.extractedText, answerKeyText) : 50;
      sub.similarity_pct = keySim;

      let calculatedMarks = 0;
      if (keySim >= threshold) {
        calculatedMarks = assignment.total_marks;
      } else {
        calculatedMarks = Math.round((keySim / threshold) * assignment.total_marks);
      }

      let feedback = `AI Score: ${keySim}% match with answer key.`;
      if (sub.duplicate_flag) {
        calculatedMarks = Math.max(0, calculatedMarks - penalty);
        const dupNames = sub.matched_with.map((m) => `${m.name} (${m.pct}%)`).join(", ");
        feedback += ` [DUPLICATE DETECTED: Similar to ${dupNames}. Deducted ${penalty} marks.]`;
      }

      await db.query(
        `UPDATE submissions 
         SET similarity_pct = ?, duplicate_flag = ?, final_marks = ?, auto_marks = ?, auto_feedback = ?, graded = 1
         WHERE id = ?`,
        [keySim, sub.duplicate_flag ? 1 : 0, calculatedMarks, calculatedMarks, feedback, sub.id]
      );
    }

    res.json({ message: "Auto-correction completed successfully." });
  } catch (err) {
    console.error("AUTO CORRECT ERROR:", err.message);
    res.status(500).json({ error: "Auto-correction failed: " + err.message });
  }
});

// ---------- SUBMISSION: change marks manually ----------
router.put("/submissions/:id/marks", async (req, res) => {
  const { marks } = req.body;
  try {
    const [rows] = await db.query(
      `SELECT s.*, a.faculty_id, a.total_marks 
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id 
       WHERE s.id = ?`,
      [req.params.id]
    );
    const sub = rows[0];
    if (!sub || sub.faculty_id !== req.user.id) {
      return res.status(404).json({ error: "Submission not found." });
    }

    const maxMarks = Number(sub.total_marks) || 100;
    const n = Math.max(0, Math.min(maxMarks, Number(marks) || 0));
    await db.query(
      "UPDATE submissions SET final_marks = ?, graded = 1, posted = 0 WHERE id = ?",
      [n, sub.id]
    );

    res.json({ message: "Marks updated." });
  } catch (err) {
    console.error("UPDATE MARKS ERROR:", err.message);
    res.status(500).json({ error: "Could not update marks." });
  }
});

// ---------- SUBMISSION: post marks ----------
router.post("/submissions/:id/post", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, a.faculty_id 
       FROM submissions s 
       JOIN assignments a ON a.id = s.assignment_id 
       WHERE s.id = ?`,
      [req.params.id]
    );
    const sub = rows[0];
    if (!sub || sub.faculty_id !== req.user.id) {
      return res.status(404).json({ error: "Submission not found." });
    }
    if (sub.final_marks == null) {
      return res.status(400).json({ error: "Set marks before posting." });
    }

    await db.query("UPDATE submissions SET posted = 1 WHERE id = ?", [sub.id]);
    res.json({ message: "Marks posted to student." });
  } catch (err) {
    console.error("POST MARKS ERROR:", err.message);
    res.status(500).json({ error: "Could not post marks." });
  }
});

// ---------- CREATE EXAM WITH QUESTIONS ----------
router.post("/exams", async (req, res) => {
  const { title, examDate, startTime, durationMin, questions, subject } = req.body;

  if (!title || !examDate || !startTime || !durationMin || !Array.isArray(questions) || !questions.length) {
    return res.status(400).json({
      error: "Title, date, start time, duration and at least one question are required.",
    });
  }

  const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 1), 0);

  try {
    const [examResult] = await db.query(
      `INSERT INTO exams (faculty_id, title, exam_date, start_time, duration_min, total_marks, subject) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        title.trim(),
        examDate,
        startTime,
        Number(durationMin),
        totalMarks,
        subject || null,
      ]
    );
    const examId = examResult.insertId;

    for (const q of questions) {
      const qParams = [
        examId,
        q.questionText,
        q.optionA,
        q.optionB,
        q.optionC,
        q.optionD,
        String(q.correctOption).toUpperCase(),
        Number(q.marks) || 1,
      ];

      // Primary insert into exam_questions
      try {
        await db.query(
          `INSERT INTO exam_questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          qParams
        );
      } catch (err) {
        console.warn("Insert to exam_questions fallback:", err.message);
      }

      // Secondary sync into questions
      try {
        await db.query(
          `INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          qParams
        );
      } catch (err) {
        /* proceed */
      }
    }

    res.json({ message: "Exam created.", examId });
  } catch (e) {
    console.error("CREATE EXAM ERROR:", e.message);
    res.status(500).json({ error: "Could not create exam." });
  }
});

// ---------- LIST MY EXAMS ----------
router.get("/exams", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM exams WHERE faculty_id = ? ORDER BY exam_date DESC, start_time DESC",
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("LIST EXAMS ERROR:", err.message);
    res.status(500).json({ error: "Could not fetch exams." });
  }
});

// ---------- RESULTS FOR ONE EXAM ----------
router.get("/exams/:id/results", async (req, res) => {
  try {
    const [examRows] = await db.query("SELECT * FROM exams WHERE id = ? AND faculty_id = ?", [
      req.params.id,
      req.user.id,
    ]);
    const exam = examRows[0];
    if (!exam) return res.status(404).json({ error: "Exam not found." });

    const [rows] = await db.query(
      `SELECT at.*, u.name AS student_name, u.username AS student_username
       FROM exam_attempts at 
       JOIN users u ON u.id = at.student_id
       WHERE at.exam_id = ? 
       ORDER BY at.submitted_at DESC`,
      [exam.id]
    );

    res.json({ exam, results: rows });
  } catch (err) {
    console.error("GET EXAM RESULTS ERROR:", err.message);
    res.status(500).json({ error: "Could not fetch exam results." });
  }
});

// ---------- EDIT A RESULT SCORE ----------
router.put("/exam-attempts/:id/score", async (req, res) => {
  const { score } = req.body;
  try {
    const [rows] = await db.query(
      `SELECT at.*, ex.faculty_id, ex.total_marks 
       FROM exam_attempts at
       JOIN exams ex ON ex.id = at.exam_id 
       WHERE at.id = ?`,
      [req.params.id]
    );
    const attempt = rows[0];
    if (!attempt || attempt.faculty_id !== req.user.id) {
      return res.status(404).json({ error: "Attempt not found." });
    }

    const maxMarks = Number(attempt.total_marks) || 100;
    const n = Math.max(0, Math.min(maxMarks, Number(score) || 0));
    await db.query("UPDATE exam_attempts SET score = ?, posted = 0 WHERE id = ?", [n, attempt.id]);

    res.json({ message: "Score updated." });
  } catch (err) {
    console.error("UPDATE EXAM SCORE ERROR:", err.message);
    res.status(500).json({ error: "Could not update score." });
  }
});

// ---------- POST EXAM RESULT TO STUDENT ----------
router.post("/exam-attempts/:id/post", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT at.*, ex.faculty_id 
       FROM exam_attempts at 
       JOIN exams ex ON ex.id = at.exam_id 
       WHERE at.id = ?`,
      [req.params.id]
    );
    const attempt = rows[0];
    if (!attempt || attempt.faculty_id !== req.user.id) {
      return res.status(404).json({ error: "Attempt not found." });
    }
    if (attempt.score == null) {
      return res.status(400).json({ error: "Score the attempt before posting." });
    }

    await db.query("UPDATE exam_attempts SET posted = 1 WHERE id = ?", [attempt.id]);
    res.json({ message: "Result posted to student." });
  } catch (err) {
    console.error("POST EXAM RESULT ERROR:", err.message);
    res.status(500).json({ error: "Could not post result." });
  }
});

module.exports = router;
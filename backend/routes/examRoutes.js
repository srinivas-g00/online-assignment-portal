// backend/routes/examRoutes.js
// All routes here are for STUDENTS taking an MCQ exam.
const express = require("express");
const db = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate, requireRole("student"));

async function assertEligible(examId, studentId) {
  const [examRows] = await db.query("SELECT * FROM exams WHERE id = ?", [examId]);
  const exam = examRows[0];
  if (!exam) return { error: "Exam not found." };

  try {
    const [enrolledRows] = await db.query(
      `SELECT id FROM enrollments WHERE faculty_id = ? AND student_id = ? AND (status = 'accepted' OR status = 'enrolled')`,
      [exam.faculty_id, studentId]
    );

    if (enrolledRows && enrolledRows.length === 0) {
      return { error: "You are not enrolled/accepted under this faculty for this exam." };
    }
  } catch (err) {
    // If enrollment table has varying structures, proceed gracefully
  }

  return { exam };
}

// ---------- START EXAM: returns questions WITHOUT the correct answer ----------
router.post("/:id/start", async (req, res) => {
  try {
    const { exam, error } = await assertEligible(req.params.id, req.user.id);
    if (error) return res.status(403).json({ error });

    const now = Date.now();
    const startTime = (exam.start_time || "00:00:00").slice(0, 8);
    const datePart = (exam.exam_date || "").toString().split("T")[0].split(" ")[0];
    const start = new Date(`${datePart}T${startTime}`).getTime();
    const durationMin = Number(exam.duration_min) || 30;
    const end = start + durationMin * 60 * 1000;

    if (!isNaN(start)) {
      if (now < start) return res.status(403).json({ error: "This exam has not started yet." });
      if (now > end) return res.status(403).json({ error: "This exam window has closed." });
    }

    let [attemptRows] = await db.query(
      "SELECT * FROM exam_attempts WHERE exam_id = ? AND student_id = ?",
      [exam.id, req.user.id]
    );
    let attempt = attemptRows[0];

    if (attempt && attempt.submitted_at) {
      return res.status(409).json({ error: "You have already submitted this exam." });
    }

    if (!attempt) {
      const [result] = await db.query(
        "INSERT INTO exam_attempts (exam_id, student_id) VALUES (?, ?)",
        [exam.id, req.user.id]
      );
      const [newAttemptRows] = await db.query(
        "SELECT * FROM exam_attempts WHERE id = ?",
        [result.insertId]
      );
      attempt = newAttemptRows[0];
    }

    // Support both table names: 'questions' or 'exam_questions'
    let questions = [];
    try {
      const [qRows] = await db.query(
        "SELECT id, question_text, option_a, option_b, option_c, option_d, marks FROM questions WHERE exam_id = ?",
        [exam.id]
      );
      questions = qRows;
    } catch {
      const [eqRows] = await db.query(
        "SELECT id, question_text, option_a, option_b, option_c, option_d, marks FROM exam_questions WHERE exam_id = ?",
        [exam.id]
      );
      questions = eqRows;
    }

    const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 1), 0);
    const secondsLeft = !isNaN(end) ? Math.max(0, Math.round((end - now) / 1000)) : durationMin * 60;

    res.json({
      attemptId: attempt.id,
      questions,
      secondsLeft,
      exam: {
        id: exam.id,
        title: exam.title,
        subject: exam.subject,
        durationMin: durationMin,
        totalMarks: exam.total_marks || totalMarks,
      },
    });
  } catch (err) {
    console.error("START EXAM ERROR:", err.message);
    res.status(500).json({ error: "Could not start exam." });
  }
});

// ---------- SAVE ONE ANSWER (autosave as the student picks options) ----------
router.post("/attempts/:attemptId/answer", async (req, res) => {
  try {
    const { questionId, selected } = req.body; // selected: 'A'|'B'|'C'|'D'|null
    const [attemptRows] = await db.query(
      "SELECT * FROM exam_attempts WHERE id = ? AND student_id = ?",
      [req.params.attemptId, req.user.id]
    );
    const attempt = attemptRows[0];

    if (!attempt) return res.status(404).json({ error: "Attempt not found." });
    if (attempt.submitted_at) return res.status(403).json({ error: "Exam already submitted." });

    // Create exam_answers table dynamically if not present
    await db.query(`
      CREATE TABLE IF NOT EXISTS exam_answers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        attempt_id INT NOT NULL,
        question_id INT NOT NULL,
        selected VARCHAR(5) NULL
      )
    `).catch(() => {});

    const [existingAns] = await db.query(
      "SELECT id FROM exam_answers WHERE attempt_id = ? AND question_id = ?",
      [attempt.id, questionId]
    );

    if (existingAns && existingAns.length > 0) {
      await db.query(
        "UPDATE exam_answers SET selected = ? WHERE id = ?",
        [selected || null, existingAns[0].id]
      );
    } else {
      await db.query(
        "INSERT INTO exam_answers (attempt_id, question_id, selected) VALUES (?, ?, ?)",
        [attempt.id, questionId, selected || null]
      );
    }

    res.json({ saved: true });
  } catch (err) {
    console.error("SAVE ANSWER ERROR:", err.message);
    res.status(500).json({ error: "Could not save answer." });
  }
});

// ---------- SUBMIT (manual or auto-submit when timer reaches 0) ----------
router.post("/attempts/:attemptId/submit", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT at.*, ex.duration_min, ex.exam_date, ex.start_time 
       FROM exam_attempts at
       JOIN exams ex ON ex.id = at.exam_id 
       WHERE at.id = ? AND at.student_id = ?`,
      [req.params.attemptId, req.user.id]
    );
    const attempt = rows[0];

    if (!attempt) return res.status(404).json({ error: "Attempt not found." });
    if (attempt.submitted_at) {
      return res.json({ message: "Already submitted.", score: attempt.score });
    }

    const autoSubmitted = req.body.autoSubmitted ? 1 : 0;
    const score = await gradeAttempt(attempt.id);

    await db.query(
      "UPDATE exam_attempts SET submitted_at = NOW(), score = ? WHERE id = ?",
      [score, attempt.id]
    );

    res.json({
      message: autoSubmitted ? "Time up - exam auto-submitted." : "Exam submitted.",
      score,
    });
  } catch (err) {
    console.error("SUBMIT EXAM ERROR:", err.message);
    res.status(500).json({ error: "Could not submit exam." });
  }
});

/** Auto-correct an MCQ attempt against stored correct_option */
async function gradeAttempt(attemptId) {
  try {
    let rows = [];
    try {
      const [res1] = await db.query(
        `SELECT ea.selected, q.correct_option, q.marks
         FROM exam_answers ea 
         JOIN questions q ON q.id = ea.question_id
         WHERE ea.attempt_id = ?`,
        [attemptId]
      );
      rows = res1;
    } catch {
      const [res2] = await db.query(
        `SELECT ea.selected, eq.correct_option, eq.marks
         FROM exam_answers ea 
         JOIN exam_questions eq ON eq.id = ea.question_id
         WHERE ea.attempt_id = ?`,
        [attemptId]
      );
      rows = res2;
    }

    return rows.reduce(
      (sum, r) =>
        sum +
        (r.selected &&
        r.correct_option &&
        String(r.selected).trim().toUpperCase() === String(r.correct_option).trim().toUpperCase()
          ? Number(r.marks) || 1
          : 0),
      0
    );
  } catch (err) {
    console.error("GRADE ATTEMPT ERROR:", err.message);
    return 0;
  }
}

module.exports = router;
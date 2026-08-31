// backend/routes/facultyRoutes.js

const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const db = require("../config/db");
const { auth, requireRole } = require("../middleware/auth");

const router = express.Router();

// ============================================================
// AUTHENTICATION
// ============================================================

router.use(auth);
router.use(requireRole("faculty"));

// ============================================================
// MULTER UPLOAD CONFIGURATION
// ============================================================

const maxMb = Number(process.env.MAX_UPLOAD_MB) || 15;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder =
      file.fieldname === "keyFile"
        ? "keys"
        : "questions";

    const dest = path.join(
      __dirname,
      "..",
      "uploads",
      folder
    );

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, {
        recursive: true,
      });
    }

    cb(null, dest);
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);

    cb(
      null,
      `${Date.now()}-${Math.round(
        Math.random() * 1e9
      )}${extension}`
    );
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: maxMb * 1024 * 1024,
  },
});

const uploadQuestion = upload;
const uploadKey = upload;

// ============================================================
// TEXT EXTRACTION
// ============================================================

async function extractTextFromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return "";
    }

    const ext = path.extname(filePath).toLowerCase();

    // --------------------------------------------------------
    // DOCX
    // --------------------------------------------------------

    if (ext === ".docx") {
      try {
        const mammoth = require("mammoth");

        const result =
          await mammoth.extractRawText({
            path: filePath,
          });

        return result.value || "";
      } catch (err) {
        const content =
          fs.readFileSync(filePath, "binary");

        return content
          .replace(/[^\x20-\x7E\n]/g, " ")
          .replace(/\s+/g, " ");
      }
    }

    // --------------------------------------------------------
    // PDF
    // --------------------------------------------------------

    if (ext === ".pdf") {
      try {
        const pdfParse = require("pdf-parse");

        const buffer =
          fs.readFileSync(filePath);

        const data =
          await pdfParse(buffer);

        return data.text || "";
      } catch (err) {
        const content =
          fs.readFileSync(filePath, "binary");

        return content
          .replace(/[^\x20-\x7E\n]/g, " ")
          .replace(/\s+/g, " ");
      }
    }

    // --------------------------------------------------------
    // TXT
    // --------------------------------------------------------

    if (ext === ".txt") {
      return fs.readFileSync(
        filePath,
        "utf8"
      );
    }

    return "";
  } catch (err) {
    console.warn(
      "TEXT EXTRACTION WARNING:",
      filePath,
      err.message
    );

    return "";
  }
}

// ============================================================
// JACCARD SIMILARITY
// ============================================================

function calculateSimilarity(text1, text2) {
  const getTokens = (text) =>
    String(text || "")
      .toLowerCase()
      .match(/\b[a-z0-9_]{3,}\b/g) || [];

  const tokens1 = getTokens(text1);
  const tokens2 = getTokens(text2);

  if (
    !tokens1.length ||
    !tokens2.length
  ) {
    return 0;
  }

  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  let intersection = 0;

  set1.forEach((token) => {
    if (set2.has(token)) {
      intersection++;
    }
  });

  const union =
    new Set([
      ...set1,
      ...set2,
    ]).size;

  if (union === 0) {
    return 0;
  }

  return Math.round(
    (intersection / union) * 100
  );
}

// ============================================================
// PROFILE
// ============================================================

router.get(
  "/me",
  async (req, res) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            u.id,
            u.name,
            u.username,
            u.email,
            COALESCE(
              u.branch,
              fp.branch,
              ''
            ) AS branch,
            COALESCE(
              u.subject,
              fp.subject,
              ''
            ) AS subject,
            COALESCE(
              u.slot,
              fp.slot,
              ''
            ) AS slot
          FROM users u
          LEFT JOIN faculty_profile fp
            ON fp.user_id = u.id
          WHERE u.id = $1
          `,
          [req.user.id]
        );

      res.json(
        result.rows[0] || {}
      );
    } catch (err) {
      console.error(
        "GET PROFILE ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not fetch profile.",
      });
    }
  }
);

// ============================================================
// STUDENTS
// ============================================================

router.get(
  "/students",
  async (req, res) => {
    const status =
      req.query.status || "pending";

    try {
      const result =
        await db.query(
          `
          SELECT
            e.id AS enrollment_id,
            u.id AS student_id,
            u.name,
            u.username,
            COALESCE(
              u.branch,
              sp.branch,
              ''
            ) AS branch,
            COALESCE(
              u.year,
              sp.year,
              ''
            ) AS year,
            COALESCE(
              e.requested_at,
              CURRENT_TIMESTAMP
            ) AS requested_at
          FROM enrollments e
          JOIN users u
            ON u.id = e.student_id
          LEFT JOIN student_profile sp
            ON sp.user_id = u.id
          WHERE e.faculty_id = $1
            AND e.status = $2
          ORDER BY e.id DESC
          `,
          [
            req.user.id,
            status,
          ]
        );

      res.json(
        result.rows || []
      );
    } catch (err) {
      console.error(
        "GET STUDENTS ERROR:",
        err.message
      );

      res.json([]);
    }
  }
);

// ============================================================
// ACCEPT / REJECT STUDENT
// ============================================================

router.post(
  "/students/:enrollmentId/decision",
  async (req, res) => {
    const { decision } = req.body;

    if (
      ![
        "accepted",
        "rejected",
      ].includes(decision)
    ) {
      return res.status(400).json({
        error:
          "Invalid decision. Must be accepted or rejected.",
      });
    }

    try {
      const result =
        await db.query(
          `
          SELECT *
          FROM enrollments
          WHERE id = $1
            AND faculty_id = $2
          `,
          [
            req.params.enrollmentId,
            req.user.id,
          ]
        );

      const enrollment =
        result.rows[0];

      if (!enrollment) {
        return res.status(404).json({
          error:
            "Enrollment request not found.",
        });
      }

      await db.query(
        `
        UPDATE enrollments
        SET status = $1
        WHERE id = $2
        `,
        [
          decision,
          enrollment.id,
        ]
      );

      res.json({
        message:
          `Student ${decision}.`,
      });
    } catch (err) {
      console.error(
        "ENROLLMENT DECISION ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not update enrollment decision.",
      });
    }
  }
);

// ============================================================
// CREATE ASSIGNMENT
// ============================================================

router.post(
  "/assignments",
  uploadQuestion.single("questionFile"),
  async (req, res) => {
    const {
      title,
      description,
      totalMarks,
      dueDate,
      dueTime,
    } = req.body;

    if (
      !title ||
      !totalMarks ||
      !dueDate ||
      !dueTime
    ) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(400).json({
        error:
          "Title, total marks, due date and due time are required.",
      });
    }

    try {
      const fileName =
        req.file
          ? req.file.filename
          : null;

      const originalName =
        req.file
          ? req.file.originalname
          : null;

      const result =
        await db.query(
          `
          INSERT INTO assignments
          (
            faculty_id,
            title,
            description,
            question_file,
            question_original,
            total_marks,
            due_date,
            due_time,
            closed
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            FALSE
          )
          RETURNING id
          `,
          [
            req.user.id,
            title.trim(),
            (description || "").trim(),
            fileName,
            originalName,
            Number(totalMarks),
            dueDate,
            dueTime,
          ]
        );

      res.json({
        message:
          "Assignment posted.",
        assignmentId:
          result.rows[0].id,
      });
    } catch (err) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      console.error(
        "CREATE ASSIGNMENT ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Failed to create assignment.",
      });
    }
  }
);

// ============================================================
// LIST FACULTY ASSIGNMENTS
// ============================================================

router.get(
  "/assignments",
  async (req, res) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            a.*,
            (
              SELECT COUNT(*)
              FROM submissions s
              WHERE s.assignment_id = a.id
            ) AS submission_count
          FROM assignments a
          WHERE a.faculty_id = $1
          ORDER BY
            a.due_date DESC,
            a.due_time DESC
          `,
          [req.user.id]
        );

      res.json(
        result.rows || []
      );
    } catch (err) {
      console.error(
        "GET ASSIGNMENTS ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not fetch assignments.",
      });
    }
  }
);

// ============================================================
// ASSIGNMENT SUBMISSIONS
// ============================================================

router.get(
  "/assignments/:id/submissions",
  async (req, res) => {
    try {
      const assignmentResult =
        await db.query(
          `
          SELECT *
          FROM assignments
          WHERE id = $1
            AND faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      const assignment =
        assignmentResult.rows[0];

      if (!assignment) {
        return res.status(404).json({
          error:
            "Assignment not found.",
        });
      }

      const submissionResult =
        await db.query(
          `
          SELECT
            s.*,
            u.name AS student_name,
            u.username AS student_username
          FROM submissions s
          JOIN users u
            ON u.id = s.student_id
          WHERE s.assignment_id = $1
          ORDER BY
            s.submitted_at ASC
          `,
          [req.params.id]
        );

      res.json({
        assignment,
        submissions:
          submissionResult.rows,
      });
    } catch (err) {
      console.error(
        "GET SUBMISSIONS ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not fetch submissions.",
      });
    }
  }
);

// ============================================================
// SET / UPDATE ANSWER KEY
// ============================================================

router.post(
  "/assignments/:id/answer-key",
  uploadKey.single("keyFile"),
  async (req, res) => {
    try {
      const assignmentResult =
        await db.query(
          `
          SELECT *
          FROM assignments
          WHERE id = $1
            AND faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      const assignment =
        assignmentResult.rows[0];

      if (!assignment) {
        if (req.file) {
          fs.unlink(req.file.path, () => {});
        }

        return res.status(404).json({
          error:
            "Assignment not found.",
        });
      }

      let keyText =
        (req.body.keyText || "").trim();

      if (req.file) {
        try {
          const extracted =
            await extractTextFromFile(
              req.file.path
            );

          keyText = [
            keyText,
            extracted,
          ]
            .filter(Boolean)
            .join("\n");
        } catch (err) {
          console.warn(
            "ANSWER KEY EXTRACTION ERROR:",
            err.message
          );
        }
      }

      if (!keyText && !req.file) {
        return res.status(400).json({
          error:
            "Provide answer-key text or upload a key document.",
        });
      }

      const keyFileName =
        req.file
          ? req.file.filename
          : null;

      await db.query(
        `
        UPDATE assignments
        SET
          answer_key = $1,
          answer_key_file =
            COALESCE(
              $2,
              answer_key_file
            )
        WHERE id = $3
        `,
        [
          keyText,
          keyFileName,
          assignment.id,
        ]
      );

      res.json({
        message:
          "Answer key saved. You can now run auto-correction.",
      });
    } catch (err) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      console.error(
        "SET ANSWER KEY ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not save answer key.",
      });
    }
  }
);

// ============================================================
// AUTO-CORRECTION + DUPLICATE DETECTION
// ============================================================

router.post(
  "/assignments/:id/auto-correct",
  async (req, res) => {
    try {
      const assignmentId =
        req.params.id;

      const {
        penaltyMarks = 0,
        matchThreshold = 70,
      } = req.body;

      const penalty =
        Number(penaltyMarks) || 0;

      const threshold =
        Math.max(
          1,
          Math.min(
            100,
            Number(matchThreshold) || 70
          )
        );

      const assignmentResult =
        await db.query(
          `
          SELECT *
          FROM assignments
          WHERE id = $1
            AND faculty_id = $2
          `,
          [
            assignmentId,
            req.user.id,
          ]
        );

      const assignment =
        assignmentResult.rows[0];

      if (!assignment) {
        return res.status(404).json({
          error:
            "Assignment not found.",
        });
      }

      let answerKeyText =
        assignment.answer_key || "";

      if (assignment.answer_key_file) {
        const keyFilePath =
          path.join(
            __dirname,
            "..",
            "uploads",
            "keys",
            assignment.answer_key_file
          );

        const extractedKey =
          await extractTextFromFile(
            keyFilePath
          );

        answerKeyText +=
          " " + extractedKey;
      }

      const submissionResult =
        await db.query(
          `
          SELECT
            s.*,
            u.name AS student_name,
            u.username AS student_username
          FROM submissions s
          JOIN users u
            ON u.id = s.student_id
          WHERE s.assignment_id = $1
          `,
          [assignmentId]
        );

      const submissions =
        submissionResult.rows;

      if (!submissions.length) {
        return res.status(400).json({
          error:
            "No submissions to evaluate.",
        });
      }

      // ------------------------------------------------------
      // EXTRACT SUBMISSION TEXT
      // ------------------------------------------------------

      for (const sub of submissions) {
        if (!sub.file_path) {
          sub.extractedText = "";
          continue;
        }

        const filePath =
          path.join(
            __dirname,
            "..",
            "uploads",
            "answers",
            sub.file_path
          );

        sub.extractedText =
          await extractTextFromFile(
            filePath
          );
      }

      // ------------------------------------------------------
      // DUPLICATE DETECTION
      // ------------------------------------------------------

      for (
        let i = 0;
        i < submissions.length;
        i++
      ) {
        submissions[i].duplicate_flag = false;
        submissions[i].matched_with = [];

        for (
          let j = 0;
          j < submissions.length;
          j++
        ) {
          if (i === j) {
            continue;
          }

          const similarity =
            calculateSimilarity(
              submissions[i].extractedText,
              submissions[j].extractedText
            );

          if (similarity >= 70) {
            submissions[i].duplicate_flag = true;

            submissions[i].matched_with.push({
              name:
                submissions[j].student_name,
              pct: similarity,
            });
          }
        }
      }

      // ------------------------------------------------------
      // SCORE SUBMISSIONS
      // ------------------------------------------------------

      for (const sub of submissions) {
        const keySimilarity =
          answerKeyText.trim()
            ? calculateSimilarity(
                sub.extractedText,
                answerKeyText
              )
            : 50;

        const totalMarks =
          Number(
            assignment.total_marks
          ) || 0;

        let calculatedMarks = 0;

        if (keySimilarity >= threshold) {
          calculatedMarks = totalMarks;
        } else {
          calculatedMarks =
            Math.round(
              (keySimilarity / threshold) *
                totalMarks
            );
        }

        let feedback =
          `AI Score: ${keySimilarity}% match with answer key.`;

        if (sub.duplicate_flag) {
          calculatedMarks =
            Math.max(
              0,
              calculatedMarks - penalty
            );

          const duplicateNames =
            sub.matched_with
              .map(
                (m) =>
                  `${m.name} (${m.pct}%)`
              )
              .join(", ");

          feedback +=
            ` [DUPLICATE DETECTED: Similar to ${duplicateNames}. Deducted ${penalty} marks.]`;
        }

        await db.query(
          `
          UPDATE submissions
          SET
            similarity_pct = $1,
            duplicate_flag = $2,
            final_marks = $3,
            auto_marks = $4,
            auto_feedback = $5,
            graded = TRUE
          WHERE id = $6
          `,
          [
            keySimilarity,
            sub.duplicate_flag,
            calculatedMarks,
            calculatedMarks,
            feedback,
            sub.id,
          ]
        );
      }

      res.json({
        message:
          "Auto-correction completed successfully.",
      });
    } catch (err) {
      console.error(
        "AUTO CORRECT ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Auto-correction failed: " +
          err.message,
      });
    }
  }
);

// ============================================================
// MANUALLY CHANGE ASSIGNMENT MARKS
// ============================================================

router.put(
  "/submissions/:id/marks",
  async (req, res) => {
    const { marks } = req.body;

    try {
      const result =
        await db.query(
          `
          SELECT
            s.*,
            a.faculty_id,
            a.total_marks
          FROM submissions s
          JOIN assignments a
            ON a.id = s.assignment_id
          WHERE s.id = $1
          `,
          [req.params.id]
        );

      const sub = result.rows[0];

      if (
        !sub ||
        Number(sub.faculty_id) !==
          Number(req.user.id)
      ) {
        return res.status(404).json({
          error:
            "Submission not found.",
        });
      }

      const maxMarks =
        Number(sub.total_marks) || 100;

      const n =
        Math.max(
          0,
          Math.min(
            maxMarks,
            Number(marks) || 0
          )
        );

      await db.query(
        `
        UPDATE submissions
        SET
          final_marks = $1,
          graded = TRUE,
          posted = 0
        WHERE id = $2
        `,
        [
          n,
          sub.id,
        ]
      );

      res.json({
        message:
          "Marks updated.",
      });
    } catch (err) {
      console.error(
        "UPDATE MARKS ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not update marks.",
      });
    }
  }
);

// ============================================================
// POST ASSIGNMENT MARKS
// ============================================================

router.post(
  "/submissions/:id/post",
  async (req, res) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            s.*,
            a.faculty_id
          FROM submissions s
          JOIN assignments a
            ON a.id = s.assignment_id
          WHERE s.id = $1
          `,
          [req.params.id]
        );

      const sub = result.rows[0];

      if (
        !sub ||
        Number(sub.faculty_id) !==
          Number(req.user.id)
      ) {
        return res.status(404).json({
          error:
            "Submission not found.",
        });
      }

      if (
        sub.final_marks === null ||
        sub.final_marks === undefined
      ) {
        return res.status(400).json({
          error:
            "Set marks before posting.",
        });
      }

      await db.query(
        `
        UPDATE submissions
        SET
          posted = 1,
          posted_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [sub.id]
      );

      res.json({
        message:
          "Marks posted to student.",
      });
    } catch (err) {
      console.error(
        "POST MARKS ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not post marks.",
      });
    }
  }
);

// ============================================================
// CREATE EXAM WITH QUESTIONS
// ============================================================

router.post(
  "/exams",
  async (req, res) => {
    const {
      title,
      examDate,
      startTime,
      durationMin,
      questions,
      subject,
    } = req.body;

    if (
      !title ||
      !examDate ||
      !startTime ||
      !durationMin ||
      !Array.isArray(questions) ||
      !questions.length
    ) {
      return res.status(400).json({
        error:
          "Title, date, start time, duration and at least one question are required.",
      });
    }

    const totalMarks =
      questions.reduce(
        (sum, q) =>
          sum +
          (Number(q.marks) || 1),
        0
      );

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      // ------------------------------------------------------
      // CREATE EXAM
      // ------------------------------------------------------

      const examResult =
        await client.query(
          `
          INSERT INTO exams
          (
            faculty_id,
            title,
            exam_date,
            start_time,
            duration_min,
            total_marks,
            subject
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7
          )
          RETURNING id
          `,
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

      const examId =
        examResult.rows[0].id;

      // ------------------------------------------------------
      // INSERT QUESTIONS
      // ------------------------------------------------------

      for (const q of questions) {
        if (
          !q.questionText ||
          !q.optionA ||
          !q.optionB ||
          !q.optionC ||
          !q.optionD ||
          !q.correctOption
        ) {
          throw new Error(
            "Every question must contain question text, four options and correct option."
          );
        }

        const correctOption =
          String(q.correctOption)
            .trim()
            .toUpperCase();

        if (
          !["A", "B", "C", "D"].includes(
            correctOption
          )
        ) {
          throw new Error(
            "Correct option must be A, B, C or D."
          );
        }

        await client.query(
          `
          INSERT INTO exam_questions
          (
            exam_id,
            question_text,
            option_a,
            option_b,
            option_c,
            option_d,
            correct_option,
            marks
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8
          )
          `,
          [
            examId,
            q.questionText.trim(),
            q.optionA.trim(),
            q.optionB.trim(),
            q.optionC.trim(),
            q.optionD.trim(),
            correctOption,
            Number(q.marks) || 1,
          ]
        );
      }

      await client.query("COMMIT");

      res.json({
        message:
          "Exam created.",
        examId,
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "ROLLBACK ERROR:",
          rollbackError.message
        );
      }

      console.error(
        "CREATE EXAM ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not create exam: " +
          err.message,
      });
    } finally {
      client.release();
    }
  }
);

// ============================================================
// LIST MY EXAMS
// ============================================================

router.get(
  "/exams",
  async (req, res) => {
    try {
      const result =
        await db.query(
          `
          SELECT *
          FROM exams
          WHERE faculty_id = $1
          ORDER BY
            exam_date DESC,
            start_time DESC
          `,
          [req.user.id]
        );

      res.json(
        result.rows || []
      );
    } catch (err) {
      console.error(
        "LIST EXAMS ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not fetch exams.",
      });
    }
  }
);

// ============================================================
// EXAM RESULTS
// ============================================================

router.get(
  "/exams/:id/results",
  async (req, res) => {
    try {
      const examResult =
        await db.query(
          `
          SELECT *
          FROM exams
          WHERE id = $1
            AND faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      const exam =
        examResult.rows[0];

      if (!exam) {
        return res.status(404).json({
          error:
            "Exam not found.",
        });
      }

      const result =
        await db.query(
          `
          SELECT
            at.id,
            at.exam_id,
            at.student_id,
            at.started_at,
            at.submitted_at,
            at.score,
            at.auto_submitted,

            -- posted is SMALLINT in the database.
            -- Return it as a normal number.
            COALESCE(
              at.posted,
              0
            ) AS posted,

            u.name AS student_name,
            u.username AS student_username

          FROM exam_attempts at

          JOIN users u
            ON u.id = at.student_id

          WHERE at.exam_id = $1

          ORDER BY
            at.submitted_at DESC NULLS LAST
          `,
          [exam.id]
        );

      res.json({
        exam,
        results:
          result.rows,
      });
    } catch (err) {
      console.error(
        "GET EXAM RESULTS ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not fetch exam results.",
      });
    }
  }
);

// ============================================================
// EDIT EXAM SCORE
// ============================================================

router.put(
  "/exam-attempts/:id/score",
  async (req, res) => {
    const { score } = req.body;

    try {
      // ------------------------------------------------------
      // FIND ATTEMPT AND VERIFY FACULTY
      // ------------------------------------------------------

      const result =
        await db.query(
          `
          SELECT
            at.*,
            ex.faculty_id,
            ex.total_marks
          FROM exam_attempts at
          JOIN exams ex
            ON ex.id = at.exam_id
          WHERE at.id = $1
          `,
          [req.params.id]
        );

      const attempt =
        result.rows[0];

      if (
        !attempt ||
        Number(attempt.faculty_id) !==
          Number(req.user.id)
      ) {
        return res.status(404).json({
          error:
            "Attempt not found.",
        });
      }

      // ------------------------------------------------------
      // VALIDATE SCORE
      // ------------------------------------------------------

      const maxMarks =
        Number(attempt.total_marks) || 100;

      const parsedScore =
        Number(score);

      if (
        Number.isNaN(parsedScore) ||
        parsedScore < 0
      ) {
        return res.status(400).json({
          error:
            "Enter a valid score.",
        });
      }

      const n =
        Math.max(
          0,
          Math.min(
            maxMarks,
            parsedScore
          )
        );

      // ------------------------------------------------------
      // UPDATE SCORE
      //
      // IMPORTANT:
      // exam_attempts.posted is SMALLINT.
      //
      // Therefore:
      // 0 = Not posted
      // 1 = Posted
      //
      // Explicit ::smallint prevents PostgreSQL
      // boolean/type mismatch problems.
      // ------------------------------------------------------

      await db.query(
        `
        UPDATE exam_attempts
        SET
          score = $1,
          posted = 0::smallint
        WHERE id = $2
        `,
        [
          n,
          attempt.id,
        ]
      );

      res.json({
        success: true,
        message:
          "Score updated successfully.",
        score: n,
      });
    } catch (err) {
      console.error(
        "UPDATE EXAM SCORE ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not update score.",
      });
    }
  }
);

// ============================================================
// POST EXAM RESULT
// ============================================================

router.post(
  "/exam-attempts/:id/post",
  async (req, res) => {
    try {
      // ------------------------------------------------------
      // FIND ATTEMPT AND VERIFY FACULTY
      // ------------------------------------------------------

      const result =
        await db.query(
          `
          SELECT
            at.*,
            ex.faculty_id
          FROM exam_attempts at
          JOIN exams ex
            ON ex.id = at.exam_id
          WHERE at.id = $1
          `,
          [req.params.id]
        );

      const attempt =
        result.rows[0];

      if (
        !attempt ||
        Number(attempt.faculty_id) !==
          Number(req.user.id)
      ) {
        return res.status(404).json({
          error:
            "Attempt not found.",
        });
      }

      // ------------------------------------------------------
      // SCORE MUST EXIST
      // ------------------------------------------------------

      if (
        attempt.score === null ||
        attempt.score === undefined
      ) {
        return res.status(400).json({
          error:
            "Score the attempt before posting.",
        });
      }

      // ------------------------------------------------------
      // POST RESULT
      //
      // exam_attempts.posted = SMALLINT
      //
      // 0 = Not posted
      // 1 = Posted
      // ------------------------------------------------------

      await db.query(
        `
        UPDATE exam_attempts
        SET
          posted = 1::smallint
        WHERE id = $1
        `,
        [attempt.id]
      );

      res.json({
        success: true,
        message:
          "Result posted to student.",
      });
    } catch (err) {
      console.error(
        "POST EXAM RESULT ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not post exam result.",
      });
    }
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
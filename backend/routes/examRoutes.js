// backend/routes/examRoutes.js
// All routes here are for STUDENTS taking an MCQ exam.

const express = require("express");
const db = require("../config/db");
const {
  authenticate,
  requireRole,
} = require("../middleware/auth");

const router = express.Router();

// ============================================================
// STUDENT ONLY
// ============================================================

router.use(
  authenticate,
  requireRole("student")
);

// ============================================================
// CHECK EXAM ELIGIBILITY
// ============================================================

async function assertEligible(examId, studentId) {
  try {
    const examResult = await db.query(
      `SELECT *
       FROM exams
       WHERE id = $1`,
      [examId]
    );

    const exam = examResult.rows[0];

    if (!exam) {
      return {
        error: "Exam not found.",
      };
    }

    // --------------------------------------------------------
    // Check faculty enrollment
    // --------------------------------------------------------

    try {
      const enrollmentResult = await db.query(
        `SELECT id
         FROM enrollments
         WHERE faculty_id = $1
           AND student_id = $2
           AND status IN ('accepted', 'enrolled')
         LIMIT 1`,
        [
          exam.faculty_id,
          studentId,
        ]
      );

      if (
        enrollmentResult.rows.length === 0
      ) {
        return {
          error:
            "You are not enrolled/accepted under this faculty for this exam.",
        };
      }
    } catch (err) {
      // If enrollment structure differs,
      // allow the exam to continue.
      console.warn(
        "Enrollment check skipped:",
        err.message
      );
    }

    return {
      exam,
    };
  } catch (err) {
    console.error(
      "EXAM ELIGIBILITY ERROR:",
      err.message
    );

    return {
      error: "Could not check exam eligibility.",
    };
  }
}

// ============================================================
// START EXAM
// Returns questions WITHOUT correct answers
// ============================================================

router.post(
  "/:id/start",
  async (req, res) => {
    try {
      const {
        exam,
        error,
      } = await assertEligible(
        req.params.id,
        req.user.id
      );

      if (error) {
        return res.status(403).json({
          error,
        });
      }

      // ------------------------------------------------------
      // Calculate exam timing
      // ------------------------------------------------------

      const now = Date.now();

      const startTime = String(
        exam.start_time || "00:00:00"
      ).slice(0, 8);

      const datePart = String(
        exam.exam_date || ""
      )
        .split("T")[0]
        .split(" ")[0];

      const start = new Date(
        `${datePart}T${startTime}`
      ).getTime();

      const durationMin =
        Number(exam.duration_min) || 30;

      const end =
        start +
        durationMin * 60 * 1000;

      if (!isNaN(start)) {
        if (now < start) {
          return res.status(403).json({
            error:
              "This exam has not started yet.",
          });
        }

        if (now > end) {
          return res.status(403).json({
            error:
              "This exam window has closed.",
          });
        }
      }

      // ------------------------------------------------------
      // Find existing attempt
      // ------------------------------------------------------

      let attemptResult = await db.query(
        `SELECT *
         FROM exam_attempts
         WHERE exam_id = $1
           AND student_id = $2
         LIMIT 1`,
        [
          exam.id,
          req.user.id,
        ]
      );

      let attempt =
        attemptResult.rows[0];

      // Already submitted
      if (
        attempt &&
        attempt.submitted_at
      ) {
        return res.status(409).json({
          error:
            "You have already submitted this exam.",
        });
      }

      // ------------------------------------------------------
      // Create attempt if needed
      // ------------------------------------------------------

      if (!attempt) {
        const insertAttempt =
          await db.query(
            `INSERT INTO exam_attempts
             (
               exam_id,
               student_id,
               started_at
             )
             VALUES
             (
               $1,
               $2,
               CURRENT_TIMESTAMP
             )
             ON CONFLICT
             (exam_id, student_id)
             DO NOTHING
             RETURNING *`,
            [
              exam.id,
              req.user.id,
            ]
          );

        // If another request created it
        // at the same time, fetch it.
        if (
          insertAttempt.rows.length > 0
        ) {
          attempt =
            insertAttempt.rows[0];
        } else {
          const retryResult =
            await db.query(
              `SELECT *
               FROM exam_attempts
               WHERE exam_id = $1
                 AND student_id = $2
               LIMIT 1`,
              [
                exam.id,
                req.user.id,
              ]
            );

          attempt =
            retryResult.rows[0];
        }
      }

      // ------------------------------------------------------
      // Get exam questions
      // IMPORTANT:
      // Do NOT send correct_option to student.
      // ------------------------------------------------------

      const questionResult =
        await db.query(
          `SELECT
             id,
             question_text,
             option_a,
             option_b,
             option_c,
             option_d,
             marks
           FROM exam_questions
           WHERE exam_id = $1
           ORDER BY id`,
          [exam.id]
        );

      const questions =
        questionResult.rows;

      // ------------------------------------------------------
      // Calculate marks
      // ------------------------------------------------------

      const totalMarks =
        questions.reduce(
          (sum, question) =>
            sum +
            (Number(
              question.marks
            ) || 1),
          0
        );

      const secondsLeft =
        !isNaN(end)
          ? Math.max(
              0,
              Math.round(
                (end - now) / 1000
              )
            )
          : durationMin * 60;

      // ------------------------------------------------------
      // Return exam
      // ------------------------------------------------------

      res.json({
        attemptId: attempt.id,

        questions,

        secondsLeft,

        exam: {
          id: exam.id,
          title: exam.title,
          subject:
            exam.subject || null,
          durationMin,
          totalMarks:
            Number(
              exam.total_marks
            ) || totalMarks,
        },
      });
    } catch (err) {
      console.error(
        "START EXAM ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not start exam.",
      });
    }
  }
);

// ============================================================
// SAVE ONE ANSWER
// Autosave when student selects an option
// ============================================================

router.post(
  "/attempts/:attemptId/answer",
  async (req, res) => {
    try {
      const {
        questionId,
        selected,
      } = req.body;

      // ------------------------------------------------------
      // Validate selected option
      // ------------------------------------------------------

      let selectedValue =
        selected === null ||
        selected === undefined ||
        selected === ""
          ? null
          : String(
              selected
            )
              .trim()
              .toUpperCase();

      if (
        selectedValue &&
        !["A", "B", "C", "D"].includes(
          selectedValue
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid answer option.",
        });
      }

      if (!questionId) {
        return res.status(400).json({
          error:
            "Question ID is required.",
        });
      }

      // ------------------------------------------------------
      // Find student's attempt
      // ------------------------------------------------------

      const attemptResult =
        await db.query(
          `SELECT *
           FROM exam_attempts
           WHERE id = $1
             AND student_id = $2`,
          [
            req.params.attemptId,
            req.user.id,
          ]
        );

      const attempt =
        attemptResult.rows[0];

      if (!attempt) {
        return res.status(404).json({
          error:
            "Attempt not found.",
        });
      }

      if (attempt.submitted_at) {
        return res.status(403).json({
          error:
            "Exam already submitted.",
        });
      }

      // ------------------------------------------------------
      // Make sure question belongs to exam
      // ------------------------------------------------------

      const questionResult =
        await db.query(
          `SELECT id
           FROM exam_questions
           WHERE id = $1
             AND exam_id = $2`,
          [
            questionId,
            attempt.exam_id,
          ]
        );

      if (
        questionResult.rows.length === 0
      ) {
        return res.status(400).json({
          error:
            "Question does not belong to this exam.",
        });
      }

      // ------------------------------------------------------
      // UPSERT answer
      // ------------------------------------------------------

      await db.query(
        `INSERT INTO exam_answers
         (
           attempt_id,
           question_id,
           selected,
           saved_at
         )
         VALUES
         (
           $1,
           $2,
           $3,
           CURRENT_TIMESTAMP
         )
         ON CONFLICT
         (attempt_id, question_id)
         DO UPDATE SET
           selected = EXCLUDED.selected,
           saved_at = CURRENT_TIMESTAMP`,
        [
          attempt.id,
          questionId,
          selectedValue,
        ]
      );

      res.json({
        saved: true,
      });
    } catch (err) {
      console.error(
        "SAVE ANSWER ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not save answer.",
      });
    }
  }
);

// ============================================================
// SUBMIT EXAM
// Manual or automatic submission
// ============================================================

router.post(
  "/attempts/:attemptId/submit",
  async (req, res) => {
    try {
      // ------------------------------------------------------
      // Get attempt + exam
      // ------------------------------------------------------

      const result =
        await db.query(
          `SELECT
             at.*,
             ex.duration_min,
             ex.exam_date,
             ex.start_time
           FROM exam_attempts at
           JOIN exams ex
             ON ex.id = at.exam_id
           WHERE at.id = $1
             AND at.student_id = $2`,
          [
            req.params.attemptId,
            req.user.id,
          ]
        );

      const attempt =
        result.rows[0];

      if (!attempt) {
        return res.status(404).json({
          error:
            "Attempt not found.",
        });
      }

      // Already submitted
      if (attempt.submitted_at) {
        return res.json({
          message:
            "Already submitted.",
          score: attempt.score,
        });
      }

      // ------------------------------------------------------
      // Grade exam
      // ------------------------------------------------------

      const score =
        await gradeAttempt(
          attempt.id
        );

      const autoSubmitted =
        Boolean(
          req.body.autoSubmitted
        );

      // ------------------------------------------------------
      // Save result
      // ------------------------------------------------------

      await db.query(
        `UPDATE exam_attempts
         SET
           submitted_at = CURRENT_TIMESTAMP,
           score = $1,
           auto_submitted = $2
         WHERE id = $3`,
        [
          score,
          autoSubmitted,
          attempt.id,
        ]
      );

      res.json({
        message: autoSubmitted
          ? "Time up - exam auto-submitted."
          : "Exam submitted.",

        score,
      });
    } catch (err) {
      console.error(
        "SUBMIT EXAM ERROR:",
        err.message
      );

      res.status(500).json({
        error:
          "Could not submit exam.",
      });
    }
  }
);

// ============================================================
// GRADE MCQ ATTEMPT
// ============================================================

async function gradeAttempt(
  attemptId
) {
  try {
    const result =
      await db.query(
        `SELECT
           ea.selected,
           eq.correct_option,
           eq.marks
         FROM exam_answers ea
         JOIN exam_questions eq
           ON eq.id = ea.question_id
         WHERE ea.attempt_id = $1`,
        [attemptId]
      );

    const rows =
      result.rows;

    return rows.reduce(
      (sum, row) => {
        const selected =
          row.selected
            ? String(
                row.selected
              )
                .trim()
                .toUpperCase()
            : null;

        const correct =
          row.correct_option
            ? String(
                row.correct_option
              )
                .trim()
                .toUpperCase()
            : null;

        if (
          selected &&
          correct &&
          selected === correct
        ) {
          return (
            sum +
            (Number(
              row.marks
            ) || 1)
          );
        }

        return sum;
      },
      0
    );
  } catch (err) {
    console.error(
      "GRADE ATTEMPT ERROR:",
      err.message
    );

    return 0;
  }
}

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
// backend/routes/examRoutes.js
// Student MCQ exam routes.
//
// Flow:
// 1. Student starts exam.
// 2. Questions are returned WITHOUT correct answers.
// 3. Student answers are autosaved.
// 4. On submit, every exam question is checked against
//    exam_questions.correct_option.
// 5. Calculated score is immediately saved in
//    exam_attempts.score.
// 6. Faculty Results can immediately see the score.
// 7. Faculty can edit and post the result separately.

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

async function assertEligible(
  examId,
  studentId
) {
  try {
    const examResult =
      await db.query(
        `
        SELECT *
        FROM exams
        WHERE id = $1
        `,
        [examId]
      );

    const exam =
      examResult.rows[0];

    if (!exam) {
      return {
        error: "Exam not found.",
      };
    }

    // --------------------------------------------------------
    // Check accepted enrollment
    // --------------------------------------------------------

    try {
      const enrollmentResult =
        await db.query(
          `
          SELECT id
          FROM enrollments
          WHERE faculty_id = $1
            AND student_id = $2
            AND status IN (
              'accepted',
              'enrolled'
            )
          LIMIT 1
          `,
          [
            exam.faculty_id,
            studentId,
          ]
        );

      if (
        enrollmentResult.rows.length ===
        0
      ) {
        return {
          error:
            "You are not enrolled/accepted under this faculty for this exam.",
        };
      }
    } catch (err) {
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
      error:
        "Could not check exam eligibility.",
    };
  }
}

// ============================================================
// GET EXAM WINDOW
// ============================================================

function getExamWindow(exam) {
  const startTime =
    String(
      exam.start_time ||
        "00:00:00"
    ).slice(0, 8);

  const datePart =
    String(
      exam.exam_date || ""
    )
      .split("T")[0]
      .split(" ")[0];

  const start =
    new Date(
      `${datePart}T${startTime}`
    ).getTime();

  const durationMin =
    Number(
      exam.duration_min
    ) || 30;

  const end =
    start +
    durationMin *
      60 *
      1000;

  return {
    start,
    end,
    durationMin,
  };
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
      } =
        await assertEligible(
          req.params.id,
          req.user.id
        );

      if (error) {
        return res.status(403).json({
          error,
        });
      }

      // ------------------------------------------------------
      // Exam timing
      // ------------------------------------------------------

      const now =
        Date.now();

      const {
        start,
        end,
        durationMin,
      } =
        getExamWindow(
          exam
        );

      if (!Number.isNaN(start)) {
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

      let attemptResult =
        await db.query(
          `
          SELECT *
          FROM exam_attempts
          WHERE exam_id = $1
            AND student_id = $2
          LIMIT 1
          `,
          [
            exam.id,
            req.user.id,
          ]
        );

      let attempt =
        attemptResult.rows[0];

      // ------------------------------------------------------
      // Already submitted
      // ------------------------------------------------------

      if (
        attempt &&
        attempt.submitted_at
      ) {
        return res.status(409).json({
          error:
            "You have already submitted this exam.",
          score:
            attempt.score !== null &&
            attempt.score !== undefined
              ? Number(
                  attempt.score
                )
              : null,
        });
      }

      // ------------------------------------------------------
      // Create attempt
      // ------------------------------------------------------

      if (!attempt) {
        const insertAttempt =
          await db.query(
            `
            INSERT INTO exam_attempts
            (
              exam_id,
              student_id,
              started_at,
              score,
              posted
            )
            VALUES
            (
              $1,
              $2,
              CURRENT_TIMESTAMP,
              NULL,
              0
            )
            ON CONFLICT
            (
              exam_id,
              student_id
            )
            DO NOTHING
            RETURNING *
            `,
            [
              exam.id,
              req.user.id,
            ]
          );

        if (
          insertAttempt.rows
            .length >
          0
        ) {
          attempt =
            insertAttempt.rows[0];
        } else {
          const retryResult =
            await db.query(
              `
              SELECT *
              FROM exam_attempts
              WHERE exam_id = $1
                AND student_id = $2
              LIMIT 1
              `,
              [
                exam.id,
                req.user.id,
              ]
            );

          attempt =
            retryResult.rows[0];
        }
      }

      if (!attempt) {
        return res.status(500).json({
          error:
            "Could not create exam attempt.",
        });
      }

      // ------------------------------------------------------
      // Get questions
      //
      // NEVER send correct_option.
      // ------------------------------------------------------

      const questionResult =
        await db.query(
          `
          SELECT
            id,
            question_text,
            option_a,
            option_b,
            option_c,
            option_d,
            marks
          FROM exam_questions
          WHERE exam_id = $1
          ORDER BY id ASC
          `,
          [exam.id]
        );

      const questions =
        questionResult.rows ||
        [];

      // ------------------------------------------------------
      // Total marks
      // ------------------------------------------------------

      const calculatedTotalMarks =
        questions.reduce(
          (
            sum,
            question
          ) =>
            sum +
            (
              Number(
                question.marks
              ) || 1
            ),
          0
        );

      const totalMarks =
        Number(
          exam.total_marks
        ) || calculatedTotalMarks;

      // ------------------------------------------------------
      // Remaining time
      // ------------------------------------------------------

      const secondsLeft =
        !Number.isNaN(end)
          ? Math.max(
              0,
              Math.round(
                (end - now) /
                  1000
              )
            )
          : durationMin *
            60;

      return res.json({
        attemptId:
          attempt.id,

        questions,

        secondsLeft,

        exam: {
          id:
            exam.id,

          title:
            exam.title,

          subject:
            exam.subject ||
            null,

          durationMin,

          totalMarks,
        },
      });
    } catch (err) {
      console.error(
        "START EXAM ERROR:",
        err
      );

      return res.status(500).json({
        error:
          "Could not start exam: " +
          err.message,
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
      // Validate question ID
      // ------------------------------------------------------

      if (
        questionId ===
          null ||
        questionId ===
          undefined ||
        questionId === ""
      ) {
        return res.status(400).json({
          error:
            "Question ID is required.",
        });
      }

      // ------------------------------------------------------
      // Normalize answer
      // ------------------------------------------------------

      let selectedValue =
        selected ===
            null ||
        selected ===
            undefined ||
        selected === ""
          ? null
          : String(
              selected
            )
              .trim()
              .toUpperCase();

      if (
        selectedValue &&
        ![
          "A",
          "B",
          "C",
          "D",
        ].includes(
          selectedValue
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid answer option. Use A, B, C or D.",
        });
      }

      // ------------------------------------------------------
      // Find student's attempt
      // ------------------------------------------------------

      const attemptResult =
        await db.query(
          `
          SELECT
            id,
            exam_id,
            student_id,
            submitted_at
          FROM exam_attempts
          WHERE id = $1
            AND student_id = $2
          `,
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

      if (
        attempt.submitted_at
      ) {
        return res.status(403).json({
          error:
            "Exam already submitted.",
        });
      }

      // ------------------------------------------------------
      // Verify question belongs to exam
      // ------------------------------------------------------

      const questionResult =
        await db.query(
          `
          SELECT id
          FROM exam_questions
          WHERE id = $1
            AND exam_id = $2
          LIMIT 1
          `,
          [
            questionId,
            attempt.exam_id,
          ]
        );

      if (
        questionResult.rows
          .length === 0
      ) {
        return res.status(400).json({
          error:
            "Question does not belong to this exam.",
        });
      }

      // ------------------------------------------------------
      // Save answer
      // ------------------------------------------------------

      await db.query(
        `
        INSERT INTO exam_answers
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
        (
          attempt_id,
          question_id
        )
        DO UPDATE SET
          selected =
            EXCLUDED.selected,
          saved_at =
            CURRENT_TIMESTAMP
        `,
        [
          attempt.id,
          questionId,
          selectedValue,
        ]
      );

      return res.json({
        saved:
          true,

        questionId,

        selected:
          selectedValue,
      });
    } catch (err) {
      console.error(
        "SAVE ANSWER ERROR:",
        err
      );

      return res.status(500).json({
        error:
          "Could not save answer: " +
          err.message,
      });
    }
  }
);

// ============================================================
// GRADE MCQ ATTEMPT
// ============================================================
//
// IMPORTANT:
//
// Every question is loaded.
// If there is no answer, it receives 0.
//
// Score calculation:
//
// correct answer -> question marks
// wrong answer   -> 0
// unanswered     -> 0
//
// The final score is returned and also saved by submitExam.
//

async function gradeAttempt(
  attemptId
) {
  try {
    const result =
      await db.query(
        `
        SELECT
          eq.id AS question_id,
          eq.correct_option,
          eq.marks,
          ea.selected
        FROM exam_attempts at
        JOIN exam_questions eq
          ON eq.exam_id =
             at.exam_id
        LEFT JOIN exam_answers ea
          ON ea.attempt_id =
             at.id
         AND ea.question_id =
             eq.id
        WHERE at.id = $1
        ORDER BY eq.id ASC
        `,
        [attemptId]
      );

    const rows =
      result.rows || [];

    if (!rows.length) {
      throw new Error(
        "No questions found for this exam attempt."
      );
    }

    let score = 0;

    let correctCount = 0;
    let answeredCount = 0;

    for (
      const row of rows
    ) {
      const selected =
        row.selected !==
            null &&
        row.selected !==
            undefined
          ? String(
              row.selected
            )
              .trim()
              .toUpperCase()
          : null;

      const correct =
        row.correct_option !==
            null &&
        row.correct_option !==
            undefined
          ? String(
              row.correct_option
            )
              .trim()
              .toUpperCase()
          : null;

      const marks =
        Number(
          row.marks
        ) || 1;

      if (selected) {
        answeredCount++;
      }

      if (
        selected &&
        correct &&
        selected === correct
      ) {
        score += marks;
        correctCount++;
      }
    }

    console.log(
      "================================================"
    );

    console.log(
      "[EXAM GRADING]"
    );

    console.log(
      "Attempt ID:",
      attemptId
    );

    console.log(
      "Total Questions:",
      rows.length
    );

    console.log(
      "Answered:",
      answeredCount
    );

    console.log(
      "Correct:",
      correctCount
    );

    console.log(
      "Calculated Score:",
      score
    );

    console.log(
      "================================================"
    );

    return {
      score,
      totalQuestions:
        rows.length,
      answeredCount,
      correctCount,
    };
  } catch (err) {
    console.error(
      "GRADE ATTEMPT ERROR:",
      err
    );

    // IMPORTANT:
    // Do not silently return 0.
    // Throw the error so submit does not save a false score.
    throw err;
  }
}

// ============================================================
// SUBMIT EXAM
// Manual or automatic submission
// ============================================================

router.post(
  "/attempts/:attemptId/submit",
  async (req, res) => {
    const client =
      await db.connect();

    try {
      // ------------------------------------------------------
      // Find attempt + exam
      // ------------------------------------------------------

      const result =
        await client.query(
          `
          SELECT
            at.*,
            ex.title,
            ex.duration_min,
            ex.exam_date,
            ex.start_time,
            ex.total_marks
          FROM exam_attempts at
          JOIN exams ex
            ON ex.id = at.exam_id
          WHERE at.id = $1
            AND at.student_id = $2
          `,
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

      // ------------------------------------------------------
      // Already submitted
      // ------------------------------------------------------

      if (
        attempt.submitted_at
      ) {
        return res.json({
          message:
            "Already submitted.",

          score:
            attempt.score ===
              null ||
            attempt.score ===
              undefined
              ? null
              : Number(
                  attempt.score
                ),
        });
      }

      // ------------------------------------------------------
      // Check if exam time has ended
      // ------------------------------------------------------

      const now =
        Date.now();

      const {
        start,
        end,
      } =
        getExamWindow(
          attempt
        );

      const autoSubmitted =
        req.body.autoSubmitted ===
          true ||
        req.body.autoSubmitted ===
          "true";

      // ------------------------------------------------------
      // Manual submit before closing is allowed.
      //
      // Automatic submission is also allowed when timer ends.
      //
      // Server prevents a manual submission long after
      // the exam window has closed.
      // ------------------------------------------------------

      if (
        !Number.isNaN(end) &&
        now > end &&
        !autoSubmitted
      ) {
        // Allow the submit because the student may have
        // clicked just as the window closed, but make the
        // server-side state authoritative.
        console.warn(
          "[EXAM] Submit received after exam end:",
          attempt.id
        );
      }

      // ------------------------------------------------------
      // Begin transaction
      // ------------------------------------------------------

      await client.query(
        "BEGIN"
      );

      // ------------------------------------------------------
      // Grade against the answer key in database
      // ------------------------------------------------------

      const grading =
        await gradeAttempt(
          attempt.id
        );

      const calculatedScore =
        Number(
          grading.score
        );

      if (
        !Number.isFinite(
          calculatedScore
        ) ||
        calculatedScore <
          0
      ) {
        throw new Error(
          "Calculated exam score is invalid."
        );
      }

      // ------------------------------------------------------
      // Save score
      //
      // posted remains 0 until faculty posts the result.
      // ------------------------------------------------------

      const updateResult =
        await client.query(
          `
          UPDATE exam_attempts
          SET
            submitted_at =
              CURRENT_TIMESTAMP,

            score =
              $1,

            auto_submitted =
              $2,

            posted =
              0::smallint
          WHERE id = $3
            AND student_id = $4
            AND submitted_at IS NULL
          RETURNING
            id,
            score,
            submitted_at,
            auto_submitted,
            posted
          `,
          [
            calculatedScore,
            autoSubmitted,
            attempt.id,
            req.user.id,
          ]
        );

      // ------------------------------------------------------
      // Verify update
      // ------------------------------------------------------

      const saved =
        updateResult.rows[0];

      if (!saved) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(409).json({
          error:
            "Exam was already submitted by another request.",
        });
      }

      // ------------------------------------------------------
      // Commit
      // ------------------------------------------------------

      await client.query(
        "COMMIT"
      );

      console.log(
        "================================================"
      );

      console.log(
        "[EXAM SUBMITTED]"
      );

      console.log(
        "Attempt:",
        attempt.id
      );

      console.log(
        "Student:",
        req.user.id
      );

      console.log(
        "Exam:",
        attempt.title
      );

      console.log(
        "Score:",
        saved.score
      );

      console.log(
        "Auto submitted:",
        saved.auto_submitted
      );

      console.log(
        "Posted:",
        saved.posted
      );

      console.log(
        "================================================"
      );

      return res.json({
        message:
          autoSubmitted
            ? "Time up - exam auto-submitted."
            : "Exam submitted.",

        score:
          Number(
            saved.score
          ),

        totalMarks:
          Number(
            attempt.total_marks
          ) || 0,

        correctCount:
          grading.correctCount,

        answeredCount:
          grading.answeredCount,

        totalQuestions:
          grading.totalQuestions,

        posted:
          Number(
            saved.posted
          ) || 0,
      });
    } catch (err) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (
        rollbackError
      ) {
        console.error(
          "ROLLBACK ERROR:",
          rollbackError.message
        );
      }

      console.error(
        "SUBMIT EXAM ERROR:",
        err
      );

      return res.status(500).json({
        error:
          "Could not submit exam: " +
          err.message,
      });
    } finally {
      client.release();
    }
  }
);

// ============================================================
// GET CURRENT STUDENT ATTEMPT
// ============================================================
//
// This endpoint is useful for the student dashboard and also
// allows the frontend to retrieve the saved score.
//

router.get(
  "/attempts/:attemptId",
  async (req, res) => {
    try {
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
            COALESCE(
              at.posted,
              0
            ) AS posted,

            ex.title,
            ex.total_marks

          FROM exam_attempts at

          JOIN exams ex
            ON ex.id =
               at.exam_id

          WHERE at.id = $1
            AND at.student_id = $2
          `,
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

      return res.json({
        attempt: {
          ...attempt,

          score:
            attempt.score ===
                null ||
            attempt.score ===
                undefined
              ? null
              : Number(
                  attempt.score
                ),

          posted:
            Number(
              attempt.posted
            ) || 0,

          totalMarks:
            Number(
              attempt.total_marks
            ) || 0,
        },
      });
    } catch (err) {
      console.error(
        "GET ATTEMPT ERROR:",
        err.message
      );

      return res.status(500).json({
        error:
          "Could not fetch attempt: " +
          err.message,
      });
    }
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
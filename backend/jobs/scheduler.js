// backend/jobs/scheduler.js
//
// Runs every minute:
//  1. Deletes unverified registrations older than 10 minutes.
//  2. Marks assignments as closed once their due date/time has passed.
//  3. Auto-submits and auto-corrects MCQ exam attempts
//     whose exam window has ended.
//

const cron = require("node-cron");
const db = require("../config/db");

// ============================================================
// DELETE UNVERIFIED REGISTRATIONS
// ============================================================

async function deleteExpiredUnverifiedUsers() {
  try {
    const result = await db.query(`
      DELETE FROM users
      WHERE is_active = FALSE
        AND email_verified = FALSE
        AND created_at < NOW() - INTERVAL '10 minutes'
    `);

    if (result && result.rowCount > 0) {
      console.log(
        `Cleanup: deleted ${result.rowCount} expired unverified registration(s).`
      );
    }
  } catch (e) {
    console.error(
      "Unverified registration cleanup error:",
      e.message || e
    );
  }
}

// ============================================================
// GRADE EXAM ATTEMPT
// ============================================================

async function gradeAttempt(attemptId) {
  try {
    const result = await db.query(
      `
      SELECT
        ea.selected,
        eq.correct_option,
        eq.marks
      FROM exam_answers ea
      JOIN exam_questions eq
        ON eq.id = ea.question_id
      WHERE ea.attempt_id = $1
      `,
      [attemptId]
    );

    const rows = result.rows || [];

    return rows.reduce((sum, r) => {
      const selected = r.selected
        ? String(r.selected).trim().toUpperCase()
        : "";

      const correct = r.correct_option
        ? String(r.correct_option).trim().toUpperCase()
        : "";

      if (selected && correct && selected === correct) {
        return sum + (Number(r.marks) || 1);
      }

      return sum;
    }, 0);
  } catch (err) {
    console.error(
      `[Scheduler] Grade attempt ${attemptId} failed:`,
      err.message || err
    );

    return 0;
  }
}

// ============================================================
// CLOSE OVERDUE ASSIGNMENTS
// ============================================================

async function closeOverdueAssignments() {
  try {
    const result = await db.query(`
      UPDATE assignments
      SET closed = TRUE
      WHERE closed = FALSE
        AND due_date IS NOT NULL
        AND due_time IS NOT NULL
        AND (due_date + due_time) < NOW()
      RETURNING id
    `);

    if (result.rowCount > 0) {
      console.log(
        `[Scheduler] Closed ${result.rowCount} overdue assignment(s).`
      );
    }
  } catch (e) {
    console.error(
      "Assignment close error:",
      e.message || e
    );
  }
}

// ============================================================
// AUTO-SUBMIT EXPIRED EXAM ATTEMPTS
// ============================================================

async function autoSubmitExpiredExamAttempts() {
  try {
    const result = await db.query(`
      SELECT
        at.id AS attempt_id,
        ex.exam_date,
        ex.start_time,
        ex.duration_min
      FROM exam_attempts at
      JOIN exams ex
        ON ex.id = at.exam_id
      WHERE at.submitted_at IS NULL
        AND (
          ex.exam_date
          + ex.start_time
          + (COALESCE(ex.duration_min, 30) * INTERVAL '1 minute')
        ) < NOW()
    `);

    const inProgress = result.rows || [];

    if (inProgress.length === 0) {
      return;
    }

    for (const row of inProgress) {
      const score = await gradeAttempt(row.attempt_id);

      await db.query(
        `
        UPDATE exam_attempts
        SET
          submitted_at = NOW(),
          auto_submitted = TRUE,
          score = $1
        WHERE id = $2
          AND submitted_at IS NULL
        `,
        [score, row.attempt_id]
      );

      console.log(
        `[Scheduler] Auto-submitted expired exam attempt ${row.attempt_id} with score: ${score}`
      );
    }
  } catch (e) {
    console.error(
      "Auto-submit exam attempts error:",
      e.message || e
    );
  }
}

// ============================================================
// START SCHEDULER
// ============================================================

function start() {
  // Runs every minute
  cron.schedule("* * * * *", async () => {
    try {
      // 1. DELETE EXPIRED UNVERIFIED REGISTRATIONS
      await deleteExpiredUnverifiedUsers();

      // 2. CLOSE OVERDUE ASSIGNMENTS
      await closeOverdueAssignments();

      // 3. AUTO-SUBMIT EXPIRED EXAMS
      await autoSubmitExpiredExamAttempts();
    } catch (e) {
      console.error(
        "Scheduler error:",
        e.message || e
      );
    }
  });

  console.log(
    "Scheduler started: checking unverified registrations, assignments and exam timers every minute."
  );
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  start,
  deleteExpiredUnverifiedUsers,
  closeOverdueAssignments,
  autoSubmitExpiredExamAttempts,
};
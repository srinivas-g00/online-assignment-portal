// backend/jobs/scheduler.js
//
// Runs every minute:
//  1. Deletes unverified registrations older than 10 minutes.
//  2. Marks assignments 'closed' once their due date/time has passed.
//  3. Auto-submits (and auto-corrects) any MCQ exam attempt
//     whose exam window has ended but the student never clicked "Submit".
//

const cron = require("node-cron");
const db = require("../config/db");

// ============================================================
// DELETE UNVERIFIED REGISTRATIONS
// ============================================================
async function deleteExpiredUnverifiedUsers() {
  try {
    const [result] = await db.query(`
      DELETE FROM users
      WHERE is_active = 0
        AND email_verified = 0
        AND created_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
    `);

    if (result && result.affectedRows > 0) {
      console.log(
        `Cleanup: deleted ${result.affectedRows} expired unverified registration(s).`
      );
    }
  } catch (e) {
    console.error("Unverified registration cleanup error:", e.message || e);
  }
}

// ============================================================
// GRADE EXAM ATTEMPT
// ============================================================
async function gradeAttempt(attemptId) {
  try {
    const [rows] = await db.query(
      `
      SELECT
        ea.selected,
        eq.correct_option,
        eq.marks
      FROM exam_answers ea
      JOIN exam_questions eq
        ON eq.id = ea.question_id
      WHERE ea.attempt_id = ?
      `,
      [attemptId]
    );

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
    console.error(`[Scheduler] Grade attempt ${attemptId} failed:`, err.message || err);
    return 0;
  }
}

// ============================================================
// CLOSE OVERDUE ASSIGNMENTS
// ============================================================
async function closeOverdueAssignments() {
  try {
    const [open] = await db.query(
      `
      SELECT
        id,
        due_date,
        due_time
      FROM assignments
      WHERE closed = 0
        AND due_date IS NOT NULL
      `
    );

    if (!open || !open.length) return;

    const now = Date.now();
    const expiredIds = [];

    for (const a of open) {
      const timePart = a.due_time || "23:59:59";
      const dueAt = new Date(`${a.due_date}T${timePart}`).getTime();

      if (!isNaN(dueAt) && now > dueAt) {
        expiredIds.push(a.id);
      }
    }

    if (expiredIds.length > 0) {
      await db.query(
        `
        UPDATE assignments
        SET closed = 1
        WHERE id IN (?)
        `,
        [expiredIds]
      );
      console.log(`[Scheduler] Closed ${expiredIds.length} overdue assignment(s).`);
    }
  } catch (e) {
    console.error("Assignment close error:", e.message || e);
  }
}

// ============================================================
// AUTO-SUBMIT EXPIRED EXAM ATTEMPTS
// ============================================================
async function autoSubmitExpiredExamAttempts() {
  try {
    const now = Date.now();

    const [inProgress] = await db.query(
      `
      SELECT
        at.id AS attempt_id,
        ex.exam_date,
        ex.start_time,
        ex.duration_min
      FROM exam_attempts at
      JOIN exams ex
        ON ex.id = at.exam_id
      WHERE at.submitted_at IS NULL
      `
    );

    if (!inProgress || !inProgress.length) return;

    for (const row of inProgress) {
      const startTime = row.start_time || "00:00:00";
      const startMs = new Date(`${row.exam_date}T${startTime}`).getTime();
      const endMs = startMs + (Number(row.duration_min) || 30) * 60 * 1000;

      if (!isNaN(startMs) && now > endMs) {
        const score = await gradeAttempt(row.attempt_id);

        await db.query(
          `
          UPDATE exam_attempts
          SET
            submitted_at = NOW(),
            auto_submitted = 1,
            score = ?
          WHERE id = ?
          `,
          [score, row.attempt_id]
        );
        console.log(
          `[Scheduler] Auto-submitted expired exam attempt ${row.attempt_id} with score: ${score}`
        );
      }
    }
  } catch (e) {
    console.error("Auto-submit exam attempts error:", e.message || e);
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
      console.error("Scheduler error:", e.message || e);
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
};
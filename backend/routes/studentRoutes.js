// backend/routes/studentRoutes.js

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const db = require("../config/db");
const { auth, requireRole } = require("../middleware/auth");

// ============================================================
// OTP / EMAIL UTILITY
// ============================================================

const { sendOtpEmail } = require("../utils/mailer");

// ============================================================
// FILE UPLOAD CONFIGURATION
// ============================================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(
      __dirname,
      "..",
      "uploads",
      "answers"
    );

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, {
        recursive: true,
      });
    }

    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const uniqueSuffix =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9);

    cb(
      null,
      uniqueSuffix +
        path.extname(file.originalname)
    );
  },
});

const maxMb =
  Number(process.env.MAX_UPLOAD_MB) || 15;

const upload = multer({
  storage,
  limits: {
    fileSize:
      maxMb * 1024 * 1024,
  },
});

// ============================================================
// PROTECT ALL STUDENT ROUTES
// ============================================================

router.use(auth);
router.use(requireRole("student"));

// ============================================================
// 1. CURRENT STUDENT PROFILE
// ============================================================

router.get("/me", async (req, res) => {
  try {
    const result =
      await db.query(
        `
        SELECT
          id,
          name,
          username,
          email,
          role,
          branch,
          year
        FROM users
        WHERE id = $1
        `,
        [req.user.id]
      );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "User not found.",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(
      "Student /me error:",
      err.message
    );

    res.status(500).json({
      error:
        "Failed to fetch student profile.",
    });
  }
});

// ============================================================
// 2. SEARCH FACULTIES
// ============================================================

router.get(
  "/faculties",
  async (req, res) => {
    try {
      const searchText =
        req.query.search
          ? req.query.search.trim()
          : "";

      const search =
        `%${searchText}%`;

      const result =
        await db.query(
          `
          SELECT
            u.id,
            u.name,
            u.subject,
            u.slot,
            u.branch,
            e.status AS "enrollStatus"
          FROM users u
          LEFT JOIN enrollments e
            ON e.faculty_id = u.id
            AND e.student_id = $1
          WHERE u.role = 'faculty'
            AND (
              u.name ILIKE $2
              OR u.subject ILIKE $2
              OR u.branch ILIKE $2
            )
          ORDER BY u.name ASC
          `,
          [
            req.user.id,
            search,
          ]
        );

      res.json(
        result.rows || []
      );
    } catch (err) {
      console.error(
        "Student /faculties error:",
        err.message
      );

      res.status(500).json({
        error:
          "Failed to fetch faculty list.",
      });
    }
  }
);

// ============================================================
// 3. SPECIFIC FACULTY
// ============================================================

router.get(
  "/faculties/:facultyId",
  async (req, res) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            u.id,
            u.name,
            u.subject,
            u.slot,
            u.branch,
            e.status AS "enrollStatus"
          FROM users u
          LEFT JOIN enrollments e
            ON e.faculty_id = u.id
            AND e.student_id = $1
          WHERE u.id = $2
            AND u.role = 'faculty'
          `,
          [
            req.user.id,
            req.params.facultyId,
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:
            "Faculty not found.",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (err) {
      console.error(
        "Student /faculties/:id error:",
        err.message
      );

      res.status(500).json({
        error:
          "Failed to fetch faculty details.",
      });
    }
  }
);

// ============================================================
// 4. ENROLL UNDER FACULTY
// ============================================================

router.post(
  "/faculties/:facultyId/enroll",
  async (req, res) => {
    try {
      const facultyResult =
        await db.query(
          `
          SELECT id
          FROM users
          WHERE id = $1
            AND role = 'faculty'
          `,
          [req.params.facultyId]
        );

      if (!facultyResult.rows.length) {
        return res.status(404).json({
          error:
            "Faculty not found.",
        });
      }

      const existingResult =
        await db.query(
          `
          SELECT id, status
          FROM enrollments
          WHERE student_id = $1
            AND faculty_id = $2
          `,
          [
            req.user.id,
            req.params.facultyId,
          ]
        );

      if (existingResult.rows.length) {
        return res.status(400).json({
          error:
            `Registration request already exists (${existingResult.rows[0].status}).`,
        });
      }

      await db.query(
        `
        INSERT INTO enrollments
        (
          student_id,
          faculty_id,
          status
        )
        VALUES
        (
          $1,
          $2,
          'pending'
        )
        `,
        [
          req.user.id,
          req.params.facultyId,
        ]
      );

      res.json({
        message:
          "Registration request sent successfully.",
      });
    } catch (err) {
      console.error(
        "Student enroll error:",
        err.message
      );

      res.status(500).json({
        error:
          "Failed to send registration request.",
      });
    }
  }
);

// ============================================================
// 5. FACULTY ASSIGNMENTS
// ============================================================

router.get(
  "/faculties/:facultyId/assignments",
  async (req, res) => {
    try {
      const enrollmentResult =
        await db.query(
          `
          SELECT status
          FROM enrollments
          WHERE student_id = $1
            AND faculty_id = $2
            AND status = 'accepted'
          `,
          [
            req.user.id,
            req.params.facultyId,
          ]
        );

      if (!enrollmentResult.rows.length) {
        return res.status(403).json({
          error:
            "You are not enrolled/accepted under this faculty.",
        });
      }

      const result =
        await db.query(
          `
          SELECT
            a.id,
            a.faculty_id,
            a.title,
            a.description,
            a.total_marks,
            a.due_date,

            COALESCE(
              a.due_time,
              '23:59:59'
            ) AS due_time,

            a.closed,

            a.question_file,
            a.question_original,

            s.id AS submission_id,
            s.file_path,
            s.file_original,
            s.submitted_at,
            s.final_marks,
            s.posted,
            s.resubmit_count

          FROM assignments a

          LEFT JOIN submissions s
            ON s.assignment_id = a.id
            AND s.student_id = $1

          WHERE a.faculty_id = $2

          ORDER BY
            a.due_date ASC,
            a.due_time ASC
          `,
          [
            req.user.id,
            req.params.facultyId,
          ]
        );

      res.json(
        result.rows || []
      );
    } catch (err) {
      console.error(
        "Student faculty assignments error:",
        err.message
      );

      res.status(500).json({
        error:
          "Failed to load assignments.",
      });
    }
  }
);

// ============================================================
// 5A. PROTECTED QUESTION PAPER VIEW
// ============================================================

router.get(
  "/assignments/:assignmentId/question-paper",
  async (req, res) => {
    try {
      const assignmentId =
        Number(
          req.params.assignmentId
        );

      if (
        !Number.isInteger(
          assignmentId
        ) ||
        assignmentId <= 0
      ) {
        return res.status(400).json({
          error:
            "Invalid assignment ID.",
        });
      }

      // ------------------------------------------------------
      // Get assignment
      // ------------------------------------------------------

      const assignmentResult =
        await db.query(
          `
          SELECT
            a.id,
            a.faculty_id,
            a.question_file,
            a.question_original
          FROM assignments a
          WHERE a.id = $1
          `,
          [assignmentId]
        );

      if (
        !assignmentResult.rows.length
      ) {
        return res.status(404).json({
          error:
            "Assignment not found.",
        });
      }

      const assignment =
        assignmentResult.rows[0];

      // ------------------------------------------------------
      // Check accepted enrollment
      // ------------------------------------------------------

      const enrollmentResult =
        await db.query(
          `
          SELECT id
          FROM enrollments
          WHERE student_id = $1
            AND faculty_id = $2
            AND status = 'accepted'
          LIMIT 1
          `,
          [
            req.user.id,
            assignment.faculty_id,
          ]
        );

      if (
        !enrollmentResult.rows.length
      ) {
        return res.status(403).json({
          error:
            "You are not enrolled/accepted under this faculty.",
        });
      }

      // ------------------------------------------------------
      // Check question paper exists
      // ------------------------------------------------------

      if (
        !assignment.question_file
      ) {
        return res.status(404).json({
          error:
            "Question paper has not been uploaded.",
        });
      }

      // ------------------------------------------------------
      // Safe filename
      // ------------------------------------------------------

      const safeFileName =
        path.basename(
          assignment.question_file
        );

      const questionPaperPath =
        path.join(
          __dirname,
          "..",
          "uploads",
          "questions",
          safeFileName
        );

      // ------------------------------------------------------
      // Check physical file
      // ------------------------------------------------------

      if (
        !fs.existsSync(
          questionPaperPath
        )
      ) {
        console.error(
          "Question paper missing:",
          questionPaperPath
        );

        return res.status(404).json({
          error:
            "Question paper file not found on server.",
        });
      }

      // ------------------------------------------------------
      // Determine MIME type
      // ------------------------------------------------------

      const extension =
        path.extname(
          safeFileName
        ).toLowerCase();

      const mimeTypes = {
        ".pdf":
          "application/pdf",

        ".doc":
          "application/msword",

        ".docx":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

        ".txt":
          "text/plain",

        ".png":
          "image/png",

        ".jpg":
          "image/jpeg",

        ".jpeg":
          "image/jpeg",
      };

      const contentType =
        mimeTypes[extension] ||
        "application/octet-stream";

      res.setHeader(
        "Content-Type",
        contentType
      );

      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(
          assignment.question_original ||
          safeFileName
        )}"`
      );

      res.setHeader(
        "Cache-Control",
        "private, no-store"
      );

      return res.sendFile(
        questionPaperPath,
        (err) => {
          if (err) {
            console.error(
              "QUESTION PAPER SEND ERROR:",
              err.message
            );

            if (!res.headersSent) {
              return res.status(500).json({
                error:
                  "Could not open question paper.",
              });
            }
          }
        }
      );

    } catch (err) {
      console.error(
        "VIEW QUESTION PAPER ERROR:",
        err.message
      );

      if (!res.headersSent) {
        return res.status(500).json({
          error:
            "Could not open question paper.",
        });
      }
    }
  }
);

// ============================================================
// 6. SUBMIT ASSIGNMENT
// ============================================================

router.post(
  "/assignments/:assignmentId/submit",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error:
          "No file was uploaded.",
      });
    }

    try {
      const assignmentResult =
        await db.query(
          `
          SELECT *
          FROM assignments
          WHERE id = $1
          `,
          [
            req.params.assignmentId,
          ]
        );

      if (
        !assignmentResult.rows.length
      ) {
        fs.unlink(
          req.file.path,
          () => {}
        );

        return res.status(404).json({
          error:
            "Assignment not found.",
        });
      }

      const assignment =
        assignmentResult.rows[0];

      const enrollmentResult =
        await db.query(
          `
          SELECT id
          FROM enrollments
          WHERE student_id = $1
            AND faculty_id = $2
            AND status = 'accepted'
          `,
          [
            req.user.id,
            assignment.faculty_id,
          ]
        );

      if (
        !enrollmentResult.rows.length
      ) {
        fs.unlink(
          req.file.path,
          () => {}
        );

        return res.status(403).json({
          error:
            "You are not enrolled under this faculty.",
        });
      }

      const dueTime =
        assignment.due_time ||
        "23:59:59";

      const dueDate =
        assignment.due_date
          .toISOString
          ? assignment.due_date
              .toISOString()
              .split("T")[0]
          : String(
              assignment.due_date
            ).split("T")[0];

      const dueMs =
        new Date(
          `${dueDate}T${dueTime}`
        ).getTime();

      if (
        assignment.closed === true ||
        assignment.closed === 1 ||
        (
          !isNaN(dueMs) &&
          dueMs < Date.now()
        )
      ) {
        fs.unlink(
          req.file.path,
          () => {}
        );

        return res.status(400).json({
          error:
            "Submission deadline has passed.",
        });
      }

      const existingResult =
        await db.query(
          `
          SELECT id
          FROM submissions
          WHERE assignment_id = $1
            AND student_id = $2
          `,
          [
            assignment.id,
            req.user.id,
          ]
        );

      if (
        existingResult.rows.length
      ) {
        fs.unlink(
          req.file.path,
          () => {}
        );

        return res.status(400).json({
          error:
            "Assignment already submitted. Use modify to replace.",
        });
      }

      await db.query(
        `
        INSERT INTO submissions
        (
          assignment_id,
          student_id,
          file_path,
          file_original,
          file_size,
          submitted_at
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          CURRENT_TIMESTAMP
        )
        `,
        [
          assignment.id,
          req.user.id,
          req.file.filename,
          req.file.originalname,
          req.file.size || 0,
        ]
      );

      res.json({
        message:
          "Submission uploaded successfully.",
      });

    } catch (err) {
      fs.unlink(
        req.file.path,
        () => {}
      );

      console.error(
        "Student submit error:",
        err.message
      );

      res.status(500).json({
        error:
          "Failed to submit assignment.",
      });
    }
  }
);

// ============================================================
// 7. REQUEST MODIFY OTP
// ============================================================
//
// FIXED:
// This route now actually sends the OTP email.
// Previously it only generated/saved the OTP.
// ============================================================

router.post(
  "/submissions/:submissionId/request-modify-otp",
  async (req, res) => {
    try {
      // ------------------------------------------------------
      // Get submission + student's email
      // ------------------------------------------------------

      const result =
        await db.query(
          `
          SELECT
            s.id,
            s.assignment_id,
            s.student_id,
            u.email,
            u.name
          FROM submissions s
          JOIN users u
            ON u.id = s.student_id
          WHERE s.id = $1
            AND s.student_id = $2
          `,
          [
            req.params.submissionId,
            req.user.id,
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:
            "Submission not found.",
        });
      }

      const student =
        result.rows[0];

      // ------------------------------------------------------
      // Check registered email
      // ------------------------------------------------------

      if (
        !student.email ||
        !String(student.email).trim()
      ) {
        return res.status(400).json({
          error:
            "No registered email address found.",
        });
      }

      // ------------------------------------------------------
      // Generate 6 digit OTP
      // ------------------------------------------------------

      const otp =
        Math.floor(
          100000 +
            Math.random() *
              900000
        ).toString();

      // ------------------------------------------------------
      // OTP expires after 10 minutes
      // ------------------------------------------------------

      const expiresAt =
        new Date(
          Date.now() +
            10 * 60 * 1000
        );

      // ------------------------------------------------------
      // Save OTP in users table
      // ------------------------------------------------------

      await db.query(
        `
        UPDATE users
        SET
          email_otp = $1,
          otp_expires_at = $2
        WHERE id = $3
        `,
        [
          otp,
          expiresAt,
          req.user.id,
        ]
      );

      // ------------------------------------------------------
      // SEND EMAIL
      // ------------------------------------------------------

      await sendOtpEmail(
        student.email,
        otp
      );

      console.log(
        `[OTP] Modification OTP sent to ${student.email}`
      );

      // ------------------------------------------------------
      // Success response
      // ------------------------------------------------------

      return res.json({
        message:
          "OTP sent to your registered email address.",
      });

    } catch (err) {
      console.error(
        "MODIFICATION OTP ERROR:",
        err
      );

      return res.status(500).json({
        error:
          "Failed to send modification OTP email.",
      });
    }
  }
);

// ============================================================
// 8. MODIFY / REPLACE SUBMISSION
// ============================================================

router.post(
  "/submissions/:submissionId/modify",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error:
          "No replacement file provided.",
      });
    }

    const emailOtp =
      String(
        req.body.emailOtp || ""
      ).trim();

    try {
      // ------------------------------------------------------
      // Get OTP
      // ------------------------------------------------------

      const userResult =
        await db.query(
          `
          SELECT
            email_otp,
            otp_expires_at
          FROM users
          WHERE id = $1
          `,
          [req.user.id]
        );

      if (
        !userResult.rows.length
      ) {
        fs.unlink(
          req.file.path,
          () => {}
        );

        return res.status(404).json({
          error:
            "User not found.",
        });
      }

      const user =
        userResult.rows[0];

      // ------------------------------------------------------
      // Check OTP
      // ------------------------------------------------------

      if (
        !user.email_otp ||
        user.email_otp !== emailOtp
      ) {
        fs.unlink(
          req.file.path,
          () => {}
        );

        return res.status(400).json({
          error:
            "Invalid OTP code.",
        });
      }

      // ------------------------------------------------------
      // Check OTP expiry
      // ------------------------------------------------------

      if (
        !user.otp_expires_at ||
        new Date(
          user.otp_expires_at
        ).getTime() <
          Date.now()
      ) {
        fs.unlink(
          req.file.path,
          () => {}
        );

        return res.status(400).json({
          error:
            "OTP code has expired.",
        });
      }

      // ------------------------------------------------------
      // Verify submission belongs to student
      // ------------------------------------------------------

      const submissionResult =
        await db.query(
          `
          SELECT
            s.id,
            s.assignment_id,
            a.due_date,
            a.due_time,
            a.closed
          FROM submissions s
          JOIN assignments a
            ON a.id = s.assignment_id
          WHERE s.id = $1
            AND s.student_id = $2
          `,
          [
            req.params.submissionId,
            req.user.id,
          ]
        );

      if (
        !submissionResult.rows.length
      ) {
        fs.unlink(
          req.file.path,
          () => {}
        );

        return res.status(404).json({
          error:
            "Submission not found.",
        });
      }

      const submission =
        submissionResult.rows[0];

      // ------------------------------------------------------
      // Check deadline
      // ------------------------------------------------------

      const dueTime =
        submission.due_time ||
        "23:59:59";

      const dueDate =
        submission.due_date
          .toISOString
          ? submission.due_date
              .toISOString()
              .split("T")[0]
          : String(
              submission.due_date
            ).split("T")[0];

      const dueMs =
        new Date(
          `${dueDate}T${dueTime}`
        ).getTime();

      if (
        submission.closed === true ||
        submission.closed === 1 ||
        (
          !isNaN(dueMs) &&
          dueMs < Date.now()
        )
      ) {
        fs.unlink(
          req.file.path,
          () => {}
        );

        return res.status(400).json({
          error:
            "Assignment deadline has passed.",
        });
      }

      // ------------------------------------------------------
      // Replace submission
      // ------------------------------------------------------

      await db.query(
        `
        UPDATE submissions
        SET
          file_path = $1,
          file_original = $2,
          file_size = $3,
          submitted_at = CURRENT_TIMESTAMP,

          resubmit_count =
            COALESCE(
              resubmit_count,
              0
            ) + 1,

          graded = FALSE,
          posted = 0,

          final_marks = NULL,
          auto_marks = NULL,
          auto_feedback = NULL

        WHERE id = $4
          AND student_id = $5
        `,
        [
          req.file.filename,
          req.file.originalname,
          req.file.size || 0,
          req.params.submissionId,
          req.user.id,
        ]
      );

      // ------------------------------------------------------
      // Consume OTP
      // ------------------------------------------------------

      await db.query(
        `
        UPDATE users
        SET
          email_otp = NULL,
          otp_expires_at = NULL
        WHERE id = $1
        `,
        [req.user.id]
      );

      return res.json({
        message:
          "Submission updated successfully.",
      });

    } catch (err) {
      fs.unlink(
        req.file.path,
        () => {}
      );

      console.error(
        "Student modify submission error:",
        err.message
      );

      return res.status(500).json({
        error:
          "Failed to replace submission.",
      });
    }
  }
);

// ============================================================
// 9. MY COURSES
// ============================================================

router.get(
  "/my-courses",
  async (req, res) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            e.id,
            e.status,
            u.name,
            u.subject,
            u.slot,
            u.branch
          FROM enrollments e
          JOIN users u
            ON u.id = e.faculty_id
          WHERE e.student_id = $1
          ORDER BY e.id DESC
          `,
          [req.user.id]
        );

      res.json(
        result.rows || []
      );

    } catch (err) {
      console.error(
        "Student /my-courses error:",
        err.message
      );

      res.status(500).json({
        error:
          "Failed to load courses.",
      });
    }
  }
);

// ============================================================
// 10. POSTED ASSIGNMENT MARKS
// ============================================================

router.get(
  "/marks",
  async (req, res) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            a.title,
            a.total_marks,
            u.name AS faculty_name,
            s.submitted_at,
            s.final_marks,
            s.posted
          FROM submissions s
          JOIN assignments a
            ON a.id = s.assignment_id
          JOIN users u
            ON u.id = a.faculty_id
          WHERE s.student_id = $1
            AND s.posted = 1
          ORDER BY
            s.submitted_at DESC
          `,
          [req.user.id]
        );

      res.json(
        result.rows || []
      );

    } catch (err) {
      console.error(
        "Student /marks error:",
        err.message
      );

      res.status(500).json({
        error:
          "Failed to load marks.",
      });
    }
  }
);

// ============================================================
// 11. AVAILABLE EXAMS
// ============================================================

router.get(
  "/exams",
  async (req, res) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            e.id,
            e.title,
            e.exam_date,
            e.start_time,
            e.duration_min,
            e.total_marks,

            u.name AS faculty_name,

            att.submitted_at,
            att.score,
            att.posted

          FROM exams e

          JOIN users u
            ON u.id = e.faculty_id

          JOIN enrollments en
            ON en.faculty_id = e.faculty_id
            AND en.student_id = $1
            AND en.status = 'accepted'

          LEFT JOIN exam_attempts att
            ON att.exam_id = e.id
            AND att.student_id = $1

          ORDER BY
            e.exam_date DESC,
            e.start_time DESC
          `,
          [req.user.id]
        );

      res.json(
        result.rows || []
      );

    } catch (err) {
      console.error(
        "Student /exams error:",
        err.message
      );

      res.status(500).json({
        error:
          "Failed to load exams.",
      });
    }
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
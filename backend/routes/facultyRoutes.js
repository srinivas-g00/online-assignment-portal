// backend/routes/facultyRoutes.js

const express = require("express");
const fs = require("fs");
const path = require("path");

const db = require("../config/db");
const {
  auth,
  requireRole,
} = require("../middleware/auth");

// ============================================================
// SUPABASE STORAGE
// ============================================================

const {
  uploadQuestion,
  uploadKey,
  uploadToSupabase,
  downloadFromSupabase,
  deleteFromSupabase,
  BUCKETS,
} = require("../utils/upload");

// ============================================================
// ROUTER
// ============================================================

const router = express.Router();

// ============================================================
// AUTHENTICATION
// ============================================================

router.use(auth);
router.use(requireRole("faculty"));

// ============================================================
// TEXT EXTRACTION FROM BUFFER
// ============================================================
//
// Supports:
//   PDF
//   DOCX
//   TXT
//
// This is used for:
//   - answer keys
//   - student submissions
//
// Files are now stored in Supabase Storage, so we extract
// directly from downloaded buffers instead of Render disk.
//

async function extractTextFromBuffer(
  buffer,
  fileName
) {
  try {
    if (!Buffer.isBuffer(buffer)) {
      return "";
    }

    const extension =
      path
        .extname(
          String(fileName || "")
        )
        .toLowerCase();

    // --------------------------------------------------------
    // TXT
    // --------------------------------------------------------

    if (extension === ".txt") {
      return buffer.toString(
        "utf8"
      );
    }

    // --------------------------------------------------------
    // DOCX
    // --------------------------------------------------------

    if (extension === ".docx") {
      try {
        const mammoth =
          require("mammoth");

        const result =
          await mammoth.extractRawText(
            {
              buffer,
            }
          );

        return result.value || "";
      } catch (err) {
        console.warn(
          "DOCX EXTRACTION ERROR:",
          err.message
        );

        return "";
      }
    }

    // --------------------------------------------------------
    // PDF
    // --------------------------------------------------------

    if (extension === ".pdf") {
      try {
        const pdfParse =
          require("pdf-parse");

        const data =
          await pdfParse(
            buffer
          );

        return data.text || "";
      } catch (err) {
        console.warn(
          "PDF EXTRACTION ERROR:",
          err.message
        );

        return "";
      }
    }

    return "";
  } catch (err) {
    console.warn(
      "BUFFER TEXT EXTRACTION WARNING:",
      err.message
    );

    return "";
  }
}

// ============================================================
// TEXT EXTRACTION FROM SUPABASE STORAGE
// ============================================================

async function extractTextFromStorage(
  bucket,
  storagePath,
  originalName
) {
  try {
    if (!storagePath) {
      return "";
    }

    const buffer =
      await downloadFromSupabase(
        bucket,
        storagePath
      );

    return await extractTextFromBuffer(
      buffer,
      originalName || storagePath
    );
  } catch (err) {
    console.warn(
      "SUPABASE TEXT EXTRACTION WARNING:",
      bucket,
      storagePath,
      err.message
    );

    return "";
  }
}

// ============================================================
// JACCARD SIMILARITY
// ============================================================

function calculateSimilarity(
  text1,
  text2
) {
  const getTokens =
    (text) =>
      String(text || "")
        .toLowerCase()
        .match(
          /\b[a-z0-9_]{3,}\b/g
        ) || [];

  const tokens1 =
    getTokens(text1);

  const tokens2 =
    getTokens(text2);

  if (
    !tokens1.length ||
    !tokens2.length
  ) {
    return 0;
  }

  const set1 =
    new Set(tokens1);

  const set2 =
    new Set(tokens2);

  let intersection = 0;

  set1.forEach(
    (token) => {
      if (
        set2.has(token)
      ) {
        intersection++;
      }
    }
  );

  const union =
    new Set([
      ...set1,
      ...set2,
    ]).size;

  if (!union) {
    return 0;
  }

  return Math.round(
    (
      intersection /
      union
    ) *
      100
  );
}

// ============================================================
// MIME TYPE
// ============================================================

function getMimeType(
  fileName
) {
  const extension =
    path
      .extname(
        String(
          fileName || ""
        )
      )
      .toLowerCase();

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

    ".gif":
      "image/gif",

    ".webp":
      "image/webp",

    ".zip":
      "application/zip",

    ".ppt":
      "application/vnd.ms-powerpoint",

    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",

    ".xls":
      "application/vnd.ms-excel",

    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  return (
    mimeTypes[extension] ||
    "application/octet-stream"
  );
}

// ============================================================
// PROFILE
// ============================================================

router.get(
  "/me",
  async (
    req,
    res
  ) => {
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
          [
            req.user.id,
          ]
        );

      return res.json(
        result.rows[0] || {}
      );
    } catch (err) {
      console.error(
        "GET PROFILE ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  async (
    req,
    res
  ) => {
    const status =
      req.query.status ||
      "pending";

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
            ON u.id =
               e.student_id

          LEFT JOIN student_profile sp
            ON sp.user_id =
               u.id

          WHERE e.faculty_id = $1
            AND e.status = $2

          ORDER BY
            e.id DESC
          `,
          [
            req.user.id,
            status,
          ]
        );

      return res.json(
        result.rows || []
      );
    } catch (err) {
      console.error(
        "GET STUDENTS ERROR:",
        err.message
      );

      return res.json([]);
    }
  }
);

// ============================================================
// ACCEPT / REJECT STUDENT
// ============================================================

router.post(
  "/students/:enrollmentId/decision",
  async (
    req,
    res
  ) => {
    const {
      decision,
    } = req.body;

    if (
      ![
        "accepted",
        "rejected",
      ].includes(
        decision
      )
    ) {
      return res.status(
        400
      ).json({
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
        return res.status(
          404
        ).json({
          error:
            "Enrollment request not found.",
        });
      }

      await db.query(
        `
        UPDATE enrollments
        SET
          status = $1
        WHERE id = $2
        `,
        [
          decision,
          enrollment.id,
        ]
      );

      return res.json({
        message:
          `Student ${decision}.`,
      });
    } catch (err) {
      console.error(
        "ENROLLMENT DECISION ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not update enrollment decision.",
      });
    }
  }
);

// ============================================================
// CREATE ASSIGNMENT
// ============================================================
//
// Question paper:
//   Browser -> Multer memory -> Supabase questions bucket
//
// Database stores:
//   question_file = Supabase Storage path
//
// ============================================================

router.post(
  "/assignments",
  uploadQuestion,
  async (
    req,
    res
  ) => {
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
      return res.status(
        400
      ).json({
        error:
          "Title, total marks, due date and due time are required.",
      });
    }

    let storagePath =
      null;

    try {
      // ------------------------------------------------------
      // Upload question paper to Supabase
      // ------------------------------------------------------

      if (req.file) {
        const uploaded =
          await uploadToSupabase(
            req.file,
            BUCKETS.questions
          );

        storagePath =
          uploaded.path;
      }

      // ------------------------------------------------------
      // Insert assignment
      // ------------------------------------------------------

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

            String(
              title
            ).trim(),

            (
              description ||
              ""
            ).trim(),

            storagePath,

            req.file
              ? req.file.originalname
              : null,

            Number(
              totalMarks
            ),

            dueDate,

            dueTime,
          ]
        );

      return res.json({
        message:
          "Assignment posted.",

        assignmentId:
          result.rows[0].id,
      });
    } catch (err) {
      // ------------------------------------------------------
      // Clean up Supabase file if DB insertion failed
      // ------------------------------------------------------

      if (storagePath) {
        try {
          await deleteFromSupabase(
            BUCKETS.questions,
            storagePath
          );
        } catch (cleanupError) {
          console.error(
            "QUESTION FILE CLEANUP ERROR:",
            cleanupError.message
          );
        }
      }

      console.error(
        "CREATE ASSIGNMENT ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Failed to create assignment: " +
          err.message,
      });
    }
  }
);

// ============================================================
// LIST FACULTY ASSIGNMENTS
// ============================================================

router.get(
  "/assignments",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            a.*,

            (
              SELECT COUNT(*)
              FROM submissions s
              WHERE s.assignment_id =
                    a.id
            ) AS submission_count

          FROM assignments a

          WHERE a.faculty_id = $1

          ORDER BY
            a.due_date DESC,
            a.due_time DESC
          `,
          [
            req.user.id,
          ]
        );

      return res.json(
        result.rows || []
      );
    } catch (err) {
      console.error(
        "GET ASSIGNMENTS ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  async (
    req,
    res
  ) => {
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
        return res.status(
          404
        ).json({
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
          [
            req.params.id,
          ]
        );

      return res.json({
        assignment,

        submissions:
          submissionResult.rows,
      });
    } catch (err) {
      console.error(
        "GET SUBMISSIONS ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not fetch submissions.",
      });
    }
  }
);

// ============================================================
// FACULTY QUESTION PAPER VIEW
// ============================================================
//
// Protected route for faculty.
//
// The file is downloaded from the private Supabase
// `questions` bucket and streamed through the backend.
//

router.get(
  "/assignments/:id/question-paper",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            id,
            question_file,
            question_original
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
        result.rows[0];

      if (!assignment) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      if (
        !assignment.question_file
      ) {
        return res.status(
          404
        ).json({
          error:
            "Question paper has not been uploaded.",
        });
      }

      const storagePath =
        String(
          assignment.question_file
        ).trim();

      const buffer =
        await downloadFromSupabase(
          BUCKETS.questions,
          storagePath
        );

      const displayName =
        assignment.question_original ||
        path.basename(
          storagePath
        );

      res.setHeader(
        "Content-Type",
        getMimeType(
          displayName
        )
      );

      res.setHeader(
        "Content-Length",
        buffer.length
      );

      res.setHeader(
        "Content-Disposition",
        `inline; filename="${String(
          displayName
        ).replace(
          /["\r\n]/g,
          "_"
        )}"`
      );

      res.setHeader(
        "Cache-Control",
        "private, no-store"
      );

      return res.send(
        buffer
      );
    } catch (err) {
      console.error(
        "FACULTY QUESTION PAPER ERROR:",
        err.message
      );

      if (!res.headersSent) {
        return res.status(
          500
        ).json({
          error:
            "Could not open question paper.",
        });
      }
    }
  }
);

// ============================================================
// SET / UPDATE ANSWER KEY
// ============================================================
//
// Answer key file:
//   Browser -> Multer memory -> Supabase keys bucket
//
// Extracted text is saved into:
//   assignments.answer_key
//
// Storage path is saved into:
//   assignments.answer_key_file
//
// ============================================================

router.post(
  "/assignments/:id/answer-key",
  uploadKey,
  async (
    req,
    res
  ) => {
    let storagePath =
      null;

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
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      // ------------------------------------------------------
      // Text directly from textarea
      // ------------------------------------------------------

      let keyText =
        String(
          req.body.keyText ||
            ""
        ).trim();

      // ------------------------------------------------------
      // Upload key file + extract text
      // ------------------------------------------------------

      if (req.file) {
        const uploaded =
          await uploadToSupabase(
            req.file,
            BUCKETS.keys
          );

        storagePath =
          uploaded.path;

        const extracted =
          await extractTextFromBuffer(
            req.file.buffer,
            req.file.originalname
          );

        if (extracted) {
          keyText = [
            keyText,
            extracted,
          ]
            .filter(Boolean)
            .join("\n");
        }
      }

      if (
        !keyText &&
        !storagePath
      ) {
        return res.status(
          400
        ).json({
          error:
            "Provide answer-key text or upload a key document.",
        });
      }

      // ------------------------------------------------------
      // Save database record
      // ------------------------------------------------------

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
          storagePath,
          assignment.id,
        ]
      );

      return res.json({
        message:
          "Answer key saved. You can now run auto-correction.",
      });
    } catch (err) {
      // ------------------------------------------------------
      // Clean up uploaded key if DB update failed
      // ------------------------------------------------------

      if (storagePath) {
        try {
          await deleteFromSupabase(
            BUCKETS.keys,
            storagePath
          );
        } catch (cleanupError) {
          console.error(
            "KEY FILE CLEANUP ERROR:",
            cleanupError.message
          );
        }
      }

      console.error(
        "SET ANSWER KEY ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not save answer key: " +
          err.message,
      });
    }
  }
);

// ============================================================
// AUTO-CORRECTION + DUPLICATE DETECTION
// ============================================================
//
// Answer key:
//   Supabase keys bucket
//
// Student submissions:
//   Supabase answers bucket
//
// ============================================================

router.post(
  "/assignments/:id/auto-correct",
  async (
    req,
    res
  ) => {
    try {
      const assignmentId =
        req.params.id;

      const {
        penaltyMarks = 0,
        matchThreshold = 70,
      } = req.body;

      const penalty =
        Math.max(
          0,
          Number(
            penaltyMarks
          ) || 0
        );

      const threshold =
        Math.max(
          1,
          Math.min(
            100,
            Number(
              matchThreshold
            ) || 70
          )
        );

      // ------------------------------------------------------
      // Assignment
      // ------------------------------------------------------

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
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      // ------------------------------------------------------
      // ANSWER KEY
      // ------------------------------------------------------

      let answerKeyText =
        String(
          assignment.answer_key ||
            ""
        );

      if (
        assignment.answer_key_file
      ) {
        const extractedKey =
          await extractTextFromStorage(
            BUCKETS.keys,
            assignment.answer_key_file,
            assignment.answer_key_file
          );

        if (extractedKey) {
          answerKeyText = [
            answerKeyText,
            extractedKey,
          ]
            .filter(Boolean)
            .join("\n");
        }
      }

      if (
        !answerKeyText.trim()
      ) {
        return res.status(
          400
        ).json({
          error:
            "No usable answer key was found. Save an answer key before running auto-correction.",
        });
      }

      // ------------------------------------------------------
      // GET SUBMISSIONS
      // ------------------------------------------------------

      const submissionResult =
        await db.query(
          `
          SELECT
            s.*,
            u.name AS student_name,
            u.username AS student_username

          FROM submissions s

          JOIN users u
            ON u.id =
               s.student_id

          WHERE s.assignment_id =
                $1

          ORDER BY
            s.submitted_at ASC
          `,
          [
            assignmentId,
          ]
        );

      const submissions =
        submissionResult.rows;

      if (
        !submissions.length
      ) {
        return res.status(
          400
        ).json({
          error:
            "No submissions to evaluate.",
        });
      }

      // ======================================================
      // DOWNLOAD + EXTRACT STUDENT FILES
      // ======================================================

      for (
        const sub of submissions
      ) {
        sub.extractedText =
          "";

        if (
          !sub.file_path
        ) {
          continue;
        }

        try {
          sub.extractedText =
            await extractTextFromStorage(
              BUCKETS.answers,
              sub.file_path,
              sub.file_original ||
                sub.file_path
            );
        } catch (err) {
          console.warn(
            "SUBMISSION EXTRACTION ERROR:",
            sub.id,
            err.message
          );

          sub.extractedText =
            "";
        }
      }

      // ======================================================
      // DUPLICATE DETECTION
      // ======================================================

      for (
        let i = 0;
        i < submissions.length;
        i++
      ) {
        submissions[i]
          .duplicate_flag =
          false;

        submissions[i]
          .matched_with =
          [];

        for (
          let j = 0;
          j < submissions.length;
          j++
        ) {
          if (
            i === j
          ) {
            continue;
          }

          const text1 =
            submissions[i]
              .extractedText;

          const text2 =
            submissions[j]
              .extractedText;

          // Don't flag empty/unreadable files
          if (
            !text1 ||
            !text1.trim() ||
            !text2 ||
            !text2.trim()
          ) {
            continue;
          }

          const similarity =
            calculateSimilarity(
              text1,
              text2
            );

          if (
            similarity >= 70
          ) {
            submissions[i]
              .duplicate_flag =
              true;

            submissions[i]
              .matched_with
              .push({
                name:
                  submissions[j]
                    .student_name,

                pct:
                  similarity,
              });
          }
        }
      }

      // ======================================================
      // SCORE SUBMISSIONS
      // ======================================================

      for (
        const sub of submissions
      ) {
        const answerText =
          String(
            sub.extractedText ||
              ""
          ).trim();

        const keySimilarity =
          answerText &&
          answerKeyText.trim()
            ? calculateSimilarity(
                answerText,
                answerKeyText
              )
            : 0;

        const totalMarks =
          Number(
            assignment.total_marks
          ) || 0;

        let calculatedMarks =
          0;

        if (
          keySimilarity >=
          threshold
        ) {
          calculatedMarks =
            totalMarks;
        } else if (
          keySimilarity > 0
        ) {
          calculatedMarks =
            Math.round(
              (
                keySimilarity /
                threshold
              ) *
                totalMarks
            );
        }

        let feedback =
          `AI Score: ${keySimilarity}% match with answer key.`;

        if (
          !answerText
        ) {
          feedback =
            "AI Score: 0% - no readable text could be extracted from the submission.";
        }

        // ----------------------------------------------------
        // Duplicate penalty
        // ----------------------------------------------------

        if (
          sub.duplicate_flag
        ) {
          calculatedMarks =
            Math.max(
              0,
              calculatedMarks -
                penalty
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

        // ----------------------------------------------------
        // Safety clamp
        // ----------------------------------------------------

        calculatedMarks =
          Math.max(
            0,
            Math.min(
              totalMarks,
              Number(
                calculatedMarks
              ) || 0
            )
          );

        // ----------------------------------------------------
        // SAVE MARKS
        // ----------------------------------------------------

        await db.query(
          `
          UPDATE submissions
          SET
            similarity_pct = $1,
            duplicate_flag = $2,
            final_marks = $3,
            auto_marks = $4,
            auto_feedback = $5,
            graded = TRUE,
            posted = 0
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

      return res.json({
        success: true,

        message:
          "Auto-correction completed successfully.",

        submissionsEvaluated:
          submissions.length,
      });
    } catch (err) {
      console.error(
        "AUTO CORRECT ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  async (
    req,
    res
  ) => {
    const {
      marks,
    } = req.body;

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
            ON a.id =
               s.assignment_id

          WHERE s.id = $1
          `,
          [
            req.params.id,
          ]
        );

      const sub =
        result.rows[0];

      if (
        !sub ||
        Number(
          sub.faculty_id
        ) !==
          Number(
            req.user.id
          )
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found.",
        });
      }

      const maxMarks =
        Number(
          sub.total_marks
        ) || 100;

      const parsedMarks =
        Number(
          marks
        );

      if (
        Number.isNaN(
          parsedMarks
        ) ||
        parsedMarks < 0
      ) {
        return res.status(
          400
        ).json({
          error:
            "Enter a valid mark value.",
        });
      }

      const finalMarks =
        Math.max(
          0,
          Math.min(
            maxMarks,
            parsedMarks
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
          finalMarks,
          sub.id,
        ]
      );

      return res.json({
        success: true,

        message:
          "Marks updated.",

        marks:
          finalMarks,
      });
    } catch (err) {
      console.error(
        "UPDATE MARKS ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            s.*,
            a.faculty_id

          FROM submissions s

          JOIN assignments a
            ON a.id =
               s.assignment_id

          WHERE s.id = $1
          `,
          [
            req.params.id,
          ]
        );

      const sub =
        result.rows[0];

      if (
        !sub ||
        Number(
          sub.faculty_id
        ) !==
          Number(
            req.user.id
          )
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found.",
        });
      }

      if (
        sub.final_marks ===
          null ||
        sub.final_marks ===
          undefined
      ) {
        return res.status(
          400
        ).json({
          error:
            "Set marks before posting.",
        });
      }

      await db.query(
        `
        UPDATE submissions
        SET
          posted = 1,
          posted_at =
            CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [
          sub.id,
        ]
      );

      return res.json({
        success: true,

        message:
          "Marks posted to student.",
      });
    } catch (err) {
      console.error(
        "POST MARKS ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  async (
    req,
    res
  ) => {
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
      !Array.isArray(
        questions
      ) ||
      !questions.length
    ) {
      return res.status(
        400
      ).json({
        error:
          "Title, date, start time, duration and at least one question are required.",
      });
    }

    // --------------------------------------------------------
    // Validate questions BEFORE transaction
    // --------------------------------------------------------

    for (
      const q of questions
    ) {
      if (
        !q.questionText ||
        !q.optionA ||
        !q.optionB ||
        !q.optionC ||
        !q.optionD ||
        !q.correctOption
      ) {
        return res.status(
          400
        ).json({
          error:
            "Every question must contain question text, four options and correct option.",
        });
      }

      const correctOption =
        String(
          q.correctOption
        )
          .trim()
          .toUpperCase();

      if (
        ![
          "A",
          "B",
          "C",
          "D",
        ].includes(
          correctOption
        )
      ) {
        return res.status(
          400
        ).json({
          error:
            "Correct option must be A, B, C or D.",
        });
      }
    }

    const totalMarks =
      questions.reduce(
        (
          sum,
          q
        ) =>
          sum +
          (
            Number(
              q.marks
            ) || 1
          ),
        0
      );

    const client =
      await db.connect();

    try {
      await client.query(
        "BEGIN"
      );

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
            String(
              title
            ).trim(),
            examDate,
            startTime,
            Number(
              durationMin
            ),
            totalMarks,
            subject
              ? String(
                  subject
                ).trim()
              : null,
          ]
        );

      const examId =
        examResult.rows[0]
          .id;

      // ------------------------------------------------------
      // INSERT QUESTIONS
      // ------------------------------------------------------

      for (
        const q of questions
      ) {
        const correctOption =
          String(
            q.correctOption
          )
            .trim()
            .toUpperCase();

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

            String(
              q.questionText
            ).trim(),

            String(
              q.optionA
            ).trim(),

            String(
              q.optionB
            ).trim(),

            String(
              q.optionC
            ).trim(),

            String(
              q.optionD
            ).trim(),

            correctOption,

            Math.max(
              1,
              Number(
                q.marks
              ) || 1
            ),
          ]
        );
      }

      await client.query(
        "COMMIT"
      );

      return res.json({
        success: true,

        message:
          "Exam created.",

        examId,
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
        "CREATE EXAM ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  async (
    req,
    res
  ) => {
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
          [
            req.user.id,
          ]
        );

      return res.json(
        result.rows || []
      );
    } catch (err) {
      console.error(
        "LIST EXAMS ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  async (
    req,
    res
  ) => {
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
        return res.status(
          404
        ).json({
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

            COALESCE(
              at.posted,
              0
            ) AS posted,

            u.name AS student_name,
            u.username AS student_username

          FROM exam_attempts at

          JOIN users u
            ON u.id =
               at.student_id

          WHERE at.exam_id = $1

          ORDER BY
            at.submitted_at
              DESC NULLS LAST
          `,
          [
            exam.id,
          ]
        );

      return res.json({
        exam,

        results:
          result.rows,
      });
    } catch (err) {
      console.error(
        "GET EXAM RESULTS ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not fetch exam results.",
      });
    }
  }
);

// ============================================================
// EDIT EXAM SCORE
// ============================================================
//
// IMPORTANT:
// exam_attempts.posted is SMALLINT.
//
// 0 = Not posted
// 1 = Posted
//
// ============================================================

router.put(
  "/exam-attempts/:id/score",
  async (
    req,
    res
  ) => {
    const {
      score,
    } = req.body;

    try {
      const result =
        await db.query(
          `
          SELECT
            at.*,
            ex.faculty_id,
            ex.total_marks

          FROM exam_attempts at

          JOIN exams ex
            ON ex.id =
               at.exam_id

          WHERE at.id = $1
          `,
          [
            req.params.id,
          ]
        );

      const attempt =
        result.rows[0];

      if (
        !attempt ||
        Number(
          attempt.faculty_id
        ) !==
          Number(
            req.user.id
          )
      ) {
        return res.status(
          404
        ).json({
          error:
            "Attempt not found.",
        });
      }

      const maxMarks =
        Number(
          attempt.total_marks
        ) || 100;

      const parsedScore =
        Number(
          score
        );

      if (
        Number.isNaN(
          parsedScore
        ) ||
        parsedScore < 0
      ) {
        return res.status(
          400
        ).json({
          error:
            "Enter a valid score.",
        });
      }

      const finalScore =
        Math.max(
          0,
          Math.min(
            maxMarks,
            parsedScore
          )
        );

      await db.query(
        `
        UPDATE exam_attempts
        SET
          score = $1,
          posted =
            0::smallint

        WHERE id = $2
        `,
        [
          finalScore,
          attempt.id,
        ]
      );

      return res.json({
        success: true,

        message:
          "Score updated successfully.",

        score:
          finalScore,
      });
    } catch (err) {
      console.error(
        "UPDATE EXAM SCORE ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not update score.",
      });
    }
  }
);

// ============================================================
// POST EXAM RESULT
// ============================================================
//
// exam_attempts.posted is SMALLINT.
//
// ============================================================

router.post(
  "/exam-attempts/:id/post",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            at.*,
            ex.faculty_id

          FROM exam_attempts at

          JOIN exams ex
            ON ex.id =
               at.exam_id

          WHERE at.id = $1
          `,
          [
            req.params.id,
          ]
        );

      const attempt =
        result.rows[0];

      if (
        !attempt ||
        Number(
          attempt.faculty_id
        ) !==
          Number(
            req.user.id
          )
      ) {
        return res.status(
          404
        ).json({
          error:
            "Attempt not found.",
        });
      }

      if (
        attempt.score ===
          null ||
        attempt.score ===
          undefined
      ) {
        return res.status(
          400
        ).json({
          error:
            "Score the attempt before posting.",
        });
      }

      await db.query(
        `
        UPDATE exam_attempts
        SET
          posted =
            1::smallint

        WHERE id = $1
        `,
        [
          attempt.id,
        ]
      );

      return res.json({
        success: true,

        message:
          "Result posted to student.",
      });
    } catch (err) {
      console.error(
        "POST EXAM RESULT ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
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
// backend/routes/facultyRoutes.js

const express = require("express");
const path = require("path");
const fs = require("fs");

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
  getSupabase,
} = require("../utils/upload");

// ============================================================
// ROUTER
// ============================================================

const router = express.Router();

// ============================================================
// AUTHENTICATION & DIRECT BROWSER TOKEN PARSER
// ============================================================

router.use((req, res, next) => {
  if (!req.headers.authorization && req.query && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});

router.use(auth);
router.use(requireRole("faculty"));

// ============================================================
// TEXT EXTRACTION FROM BUFFER
// ============================================================

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
      return buffer.toString("utf8");
    }

    // --------------------------------------------------------
    // DOCX
    // --------------------------------------------------------

    if (extension === ".docx") {
      try {
        const mammoth =
          require("mammoth");

        const result =
          await mammoth.extractRawText({
            buffer,
          });

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
          await pdfParse(buffer);

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
// TEXT EXTRACTION FROM SUPABASE STORAGE (WITH LOCAL FALLBACK)
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

    let buffer = null;

    try {
      buffer =
        await downloadFromSupabase(
          bucket,
          storagePath
        );
    } catch {
      const folder = bucket === BUCKETS.keys ? "keys" : "answers";
      const localPath = path.join(__dirname, "..", "uploads", folder, path.basename(storagePath));
      if (fs.existsSync(localPath)) {
        buffer = fs.readFileSync(localPath);
      }
    }

    if (!buffer) return "";

    return await extractTextFromBuffer(
      buffer,
      originalName || storagePath
    );
  } catch (err) {
    console.warn(
      "TEXT EXTRACTION WARNING:",
      bucket,
      storagePath,
      err.message
    );

    return "";
  }
}

// ============================================================
// STORAGE PATH HELPERS
// ============================================================

function getPossibleStoragePaths(
  storagePath
) {
  const raw =
    String(
      storagePath || ""
    ).trim();

  if (!raw) {
    return [];
  }

  const normalized =
    raw.replace(
      /\\/g,
      "/"
    );

  const noLeadingSlash =
    normalized.replace(
      /^\/+/,
      ""
    );

  const withoutUploads =
    noLeadingSlash.replace(
      /^uploads\/+/i,
      ""
    );

  const withoutAnswers =
    withoutUploads.replace(
      /^answers\/+/i,
      ""
    );

  const baseName =
    path.basename(
      normalized
    );

  const candidates = [
    normalized,
    noLeadingSlash,
    withoutUploads,
    withoutAnswers,
    baseName,

    `answers/${withoutAnswers}`,
    `answers/${baseName}`,

    `uploads/answers/${baseName}`,
  ];

  return [
    ...new Set(
      candidates.filter(
        Boolean
      )
    ),
  ];
}

// ============================================================
// DOWNLOAD STUDENT SUBMISSION (WITH LOCAL FALLBACK)
// ============================================================

async function downloadSubmissionFile(
  storagePath
) {
  const possiblePaths =
    getPossibleStoragePaths(
      storagePath
    );

  let lastError =
    null;

  // 1. Try Supabase candidates
  for (
    const candidate
    of possiblePaths
  ) {
    try {
      const buffer =
        await downloadFromSupabase(
          BUCKETS.answers,
          candidate
        );

      if (
        Buffer.isBuffer(buffer) &&
        buffer.length > 0
      ) {
        return {
          buffer,
          storagePath:
            candidate,
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  // 2. Search bucket by filename
  try {
    const supabase =
      getSupabase();

    const fileName =
      path.basename(
        String(storagePath || "").replace(/\\/g, "/").trim()
      );

    if (fileName && supabase) {
      const {
        data,
        error,
      } =
        await supabase
          .storage
          .from(
            BUCKETS.answers
          )
          .list(
            "",
            {
              limit: 1000,
              search: fileName,
            }
          );

      if (!error && Array.isArray(data)) {
        const exactMatch =
          data.find(
            (item) => item && item.name === fileName
          );

        if (exactMatch) {
          const buffer =
            await downloadFromSupabase(
              BUCKETS.answers,
              exactMatch.name
            );

          if (buffer && buffer.length) {
            return {
              buffer,
              storagePath:
                exactMatch.name,
            };
          }
        }
      }
    }
  } catch (err) {
    lastError = err;
  }

  // 3. Fallback to Local Disk (/uploads/answers)
  const cleanFileName =
    path.basename(String(storagePath || "").replace(/\\/g, "/").trim());

  const localDiskPath =
    path.join(__dirname, "..", "uploads", "answers", cleanFileName);

  if (fs.existsSync(localDiskPath)) {
    const localBuffer = fs.readFileSync(localDiskPath);
    if (localBuffer && localBuffer.length) {
      console.log(`[Storage] Loaded submission file from local disk: ${cleanFileName}`);
      return {
        buffer: localBuffer,
        storagePath: cleanFileName,
      };
    }
  }

  console.error(
    "[Storage] STUDENT SUBMISSION NOT FOUND",
    {
      databasePath:
        storagePath,
      possiblePaths,
    }
  );

  throw (
    lastError ||
    new Error(
      "Student submission was not found in storage."
    )
  );
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
      String(
        text || ""
      )
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

  let intersection =
    0;

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
        result.rows[0] ||
          {}
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

      return res.json(
        []
      );
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
        SET status = $1
        WHERE id = $2
        `,
        [
          decision,
          enrollment.id,
        ]
      );

      return res.json({
        success: true,
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
      if (req.file) {
        try {
          const uploaded =
            await uploadToSupabase(
              req.file,
              BUCKETS.questions
            );

          storagePath =
            uploaded.path;
        } catch (supErr) {
          console.warn("[Storage Fallback] Supabase question upload warning:", supErr.message);
        }

        // Always save a local copy as resilient backup
        if (req.file.buffer) {
          const destDir = path.join(__dirname, "..", "uploads", "questions");
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          const safeName = storagePath ? path.basename(storagePath) : `${Date.now()}-${req.file.originalname}`;
          fs.writeFileSync(path.join(destDir, safeName), req.file.buffer);
          if (!storagePath) storagePath = safeName;
        }
      }

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

            String(
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
        success: true,

        message:
          "Assignment posted.",

        assignmentId:
          result.rows[0].id,
      });
    } catch (err) {
      if (storagePath) {
        try {
          await deleteFromSupabase(
            BUCKETS.questions,
            storagePath
          );
        } catch (
          cleanupError
        ) {
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
            ON u.id =
               s.student_id

          WHERE s.assignment_id =
                $1

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
// VIEW / DOWNLOAD STUDENT SUBMISSION
// ============================================================

router.get(
  "/submissions/:submissionId/file",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            s.id,
            s.file_path,
            s.file_original,
            s.file_size,
            s.submitted_at,

            a.id AS assignment_id,
            a.title AS assignment_title,
            a.faculty_id

          FROM submissions s

          JOIN assignments a
            ON a.id =
               s.assignment_id

          WHERE s.id = $1
            AND a.faculty_id = $2
          `,
          [
            req.params.submissionId,
            req.user.id,
          ]
        );

      const submission =
        result.rows[0];

      if (!submission) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found or you do not have permission to access it.",
        });
      }

      if (
        !submission.file_path ||
        !String(
          submission.file_path
        ).trim()
      ) {
        return res.status(
          404
        ).json({
          error:
            "No submitted file is attached to this submission.",
        });
      }

      let downloadResult;

      try {
        downloadResult =
          await downloadSubmissionFile(
            submission.file_path
          );
      } catch (
        storageError
      ) {
        return res.status(
          404
        ).json({
          error:
            "Student submission file was not found in storage.",
        });
      }

      const buffer =
        downloadResult.buffer;

      const displayName =
        String(
          submission.file_original ||
            path.basename(
              downloadResult.storagePath
            ) ||
            "student-submission"
        )
          .replace(
            /["\r\n]/g,
            "_"
          );

      const mimeType =
        getMimeType(
          displayName
        );

      res.setHeader(
        "Content-Type",
        mimeType
      );

      res.setHeader(
        "Content-Length",
        buffer.length
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${displayName}"`
      );

      res.setHeader(
        "Cache-Control",
        "private, no-store, max-age=0"
      );

      return res.send(
        buffer
      );
    } catch (err) {
      console.error(
        "VIEW STUDENT SUBMISSION ERROR:",
        err.message
      );

      if (!res.headersSent) {
        return res.status(
          500
        ).json({
          error:
            "Could not open student submission: " +
            err.message,
        });
      }
    }
  }
);

// ============================================================
// FACULTY QUESTION PAPER VIEW (WITH LOCAL FALLBACK)
// ============================================================

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

      const possiblePaths =
        getPossibleStoragePaths(
          assignment.question_file
        );

      let buffer =
        null;

      let usedPath =
        null;

      for (
        const candidate
        of possiblePaths
      ) {
        try {
          buffer =
            await downloadFromSupabase(
              BUCKETS.questions,
              candidate
            );

          usedPath =
            candidate;

          break;
        } catch {
          /* try next candidate */
        }
      }

      if (!buffer) {
        const localPath = path.join(
          __dirname,
          "..",
          "uploads",
          "questions",
          path.basename(assignment.question_file)
        );
        if (fs.existsSync(localPath)) {
          buffer = fs.readFileSync(localPath);
        }
      }

      if (!buffer) {
        return res.status(
          404
        ).json({
          error:
            "Question paper was not found in storage.",
        });
      }

      const displayName =
        assignment.question_original ||
        path.basename(
          usedPath ||
            assignment.question_file
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
        `attachment; filename="${String(
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

      let keyText =
        String(
          req.body.keyText ||
            ""
        ).trim();

      if (req.file) {
        try {
          const uploaded =
            await uploadToSupabase(
              req.file,
              BUCKETS.keys
            );

          storagePath =
            uploaded.path;
        } catch {
          const safeName = `${Date.now()}-${req.file.originalname}`;
          const destDir = path.join(__dirname, "..", "uploads", "keys");
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          fs.writeFileSync(path.join(destDir, safeName), req.file.buffer);
          storagePath = safeName;
        }

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
        success: true,

        message:
          "Answer key saved. You can now run auto-correction.",
      });
    } catch (err) {
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

      // ------------------------------------------------------
      // DOWNLOAD + EXTRACT STUDENT FILES
      // ------------------------------------------------------

      for (
        const sub
        of submissions
      ) {
        sub.extractedText =
          "";

        if (
          !sub.file_path
        ) {
          continue;
        }

        try {
          const storageResult =
            await downloadSubmissionFile(
              sub.file_path
            );

          sub.extractedText =
            await extractTextFromBuffer(
              storageResult.buffer,
              sub.file_original ||
                storageResult.storagePath
            );
        } catch (
          err
        ) {
          console.warn(
            "SUBMISSION EXTRACTION ERROR:",
            sub.id,
            err.message
          );

          sub.extractedText =
            "";
        }
      }

      // ------------------------------------------------------
      // DUPLICATE DETECTION
      // ------------------------------------------------------

      for (
        let i = 0;
        i <
        submissions.length;
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
          j <
          submissions.length;
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
            similarity >=
            70
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

      // ------------------------------------------------------
      // SCORE SUBMISSIONS
      // ------------------------------------------------------

      for (
        const sub
        of submissions
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
              .join(
                ", "
              );

          feedback +=
            ` [DUPLICATE DETECTED: Similar to ${duplicateNames}. Deducted ${penalty} marks.]`;
        }

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

    for (
      const q
      of questions
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
        examResult
          .rows[0]
          .id;

      for (
        const q
        of questions
      ) {
        const correctOption =
          String(
            q.correctOption
          )
            .trim()
            .toUpperCase();

        const qParams = [
          examId,
          String(q.questionText).trim(),
          String(q.optionA).trim(),
          String(q.optionB).trim(),
          String(q.optionC).trim(),
          String(q.optionD).trim(),
          correctOption,
          Math.max(1, Number(q.marks) || 1),
        ];

        // Insert into exam_questions
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
          qParams
        );

        // Synchronize into questions table as fallback
        try {
          await client.query(
            `
            INSERT INTO questions
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
            qParams
          );
        } catch {
          /* questions table fallback */
        }
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
          posted = 0::smallint

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
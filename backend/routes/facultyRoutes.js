// backend/routes/facultyRoutes.js

const express = require("express");

const path = require("path");

const fs = require("fs");

const db = require("../config/db");

const {
  auth,
  requireRole,
} = require("../middleware/auth");

const {
  visionExtractBuffer,
} = require("../utils/grading");

const {
  gradeWithAI,
} = require("../utils/aiGrading");

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
  if (
    !req.headers.authorization &&
    req.query &&
    req.query.token
  ) {
    req.headers.authorization =
      `Bearer ${req.query.token}`;
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

    const extension = path
      .extname(String(fileName || ""))
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
      let extracted = "";

      try {
        const pdfParse =
          require("pdf-parse");

        const data =
          await pdfParse(buffer);

        extracted =
          data.text || "";
      } catch (err) {
        console.warn(
          "PDF TEXT EXTRACTION ERROR:",
          err.message
        );
      }

      // Use vision OCR for scanned/image-only PDFs.
      if (
        extracted.trim().length < 100 &&
        typeof visionExtractBuffer ===
          "function"
      ) {
        try {
          const visionText =
            await visionExtractBuffer(
              buffer,
              "application/pdf"
            );

          if (
            visionText &&
            visionText.trim()
          ) {
            return visionText;
          }
        } catch (err) {
          console.warn(
            "PDF VISION OCR ERROR:",
            err.message
          );
        }
      }

      return extracted;
    }

    // --------------------------------------------------------
    // IMAGE / HANDWRITTEN SUBMISSION
    // --------------------------------------------------------

    if (
      [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".bmp",
      ].includes(extension)
    ) {
      if (
        typeof visionExtractBuffer ===
        "function"
      ) {
        try {
          const mimeType =
            extension === ".png"
              ? "image/png"
              : extension === ".webp"
              ? "image/webp"
              : extension === ".bmp"
              ? "image/bmp"
              : "image/jpeg";

          return (
            (await visionExtractBuffer(
              buffer,
              mimeType
            )) || ""
          );
        } catch (err) {
          console.warn(
            "IMAGE VISION OCR ERROR:",
            err.message
          );
        }
      }

      return "";
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
// WITH LOCAL FALLBACK
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
      const folder =
        bucket === BUCKETS.keys
          ? "keys"
          : "answers";

      const localPath =
        path.join(
          __dirname,
          "..",
          "uploads",
          folder,
          path.basename(storagePath)
        );

      if (
        fs.existsSync(localPath)
      ) {
        buffer =
          fs.readFileSync(
            localPath
          );
      }
    }

    if (!buffer) {
      return "";
    }

    return await extractTextFromBuffer(
      buffer,
      originalName ||
        storagePath
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
      /^uploads\//i,
      ""
    );

  const withoutAnswers =
    withoutUploads.replace(
      /^answers\//i,
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
// DOWNLOAD STUDENT SUBMISSION
// WITH LOCAL FALLBACK
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

  // ----------------------------------------------------------
  // 1. Try Supabase candidates
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // 2. Search bucket by filename
  // ----------------------------------------------------------

  try {
    const supabase =
      getSupabase();

    const fileName =
      path.basename(
        String(
          storagePath || ""
        )
          .replace(
            /\\/g,
            "/"
          )
          .trim()
      );

    if (
      fileName &&
      supabase
    ) {
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

      if (
        !error &&
        Array.isArray(data)
      ) {
        const exactMatch =
          data.find(
            (item) =>
              item &&
              item.name ===
                fileName
          );

        if (exactMatch) {
          const buffer =
            await downloadFromSupabase(
              BUCKETS.answers,
              exactMatch.name
            );

          if (
            buffer &&
            buffer.length
          ) {
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

  // ----------------------------------------------------------
  // 3. Fallback to Local Disk
  // ----------------------------------------------------------

  const cleanFileName =
    path.basename(
      String(
        storagePath || ""
      )
        .replace(
          /\\/g,
          "/"
        )
        .trim()
    );

  const localDiskPath =
    path.join(
      __dirname,
      "..",
      "uploads",
      "answers",
      cleanFileName
    );

  if (
    fs.existsSync(
      localDiskPath
    )
  ) {
    const localBuffer =
      fs.readFileSync(
        localDiskPath
      );

    if (
      localBuffer &&
      localBuffer.length
    ) {
      console.log(
        `[Storage] Loaded submission file from local disk: ${cleanFileName}`
      );

      return {
        buffer:
          localBuffer,
        storagePath:
          cleanFileName,
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

    ".bmp":
      "image/bmp",

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
          "Could not update enrollment.",
      });
    }
  }
);

// ============================================================
// FACULTY DASHBOARD
// ============================================================

router.get(
  "/dashboard",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            (SELECT COUNT(*)
             FROM enrollments
             WHERE faculty_id = $1
               AND status = 'accepted') AS accepted_students,

            (SELECT COUNT(*)
             FROM enrollments
             WHERE faculty_id = $1
               AND status = 'pending') AS pending_students,

            (SELECT COUNT(*)
             FROM assignments
             WHERE faculty_id = $1) AS total_assignments,

            (SELECT COUNT(*)
             FROM submissions s
             JOIN assignments a
               ON a.id = s.assignment_id
             WHERE a.faculty_id = $1) AS total_submissions
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
        "DASHBOARD ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not load dashboard.",
      });
    }
  }
);

// ============================================================
// ASSIGNMENTS
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
          SELECT *
          FROM assignments
          WHERE faculty_id = $1
          ORDER BY id DESC
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
// GET SINGLE ASSIGNMENT
// ============================================================

router.get(
  "/assignments/:id",
  async (
    req,
    res
  ) => {
    try {
      const result =
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

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      return res.json(
        result.rows[0]
      );
    } catch (err) {
      console.error(
        "GET ASSIGNMENT ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not fetch assignment.",
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
    let questionFilePath =
      null;

    try {
      const {
        title,
        description,
        totalMarks,
        dueDate,
      } = req.body;

      if (!title) {
        return res.status(
          400
        ).json({
          error:
            "Assignment title is required.",
        });
      }

      if (req.file) {
        try {
          const uploaded =
            await uploadToSupabase(
              req.file,
              BUCKETS.questions
            );

          questionFilePath =
            uploaded.path;
        } catch (uploadError) {
          const safeName =
            `${Date.now()}-${req.file.originalname}`;

          const destDir =
            path.join(
              __dirname,
              "..",
              "uploads",
              "questions"
            );

          if (
            !fs.existsSync(
              destDir
            )
          ) {
            fs.mkdirSync(
              destDir,
              {
                recursive: true,
              }
            );
          }

          fs.writeFileSync(
            path.join(
              destDir,
              safeName
            ),
            req.file.buffer
          );

          questionFilePath =
            safeName;
        }
      }

      const result =
        await db.query(
          `
          INSERT INTO assignments (
            faculty_id,
            title,
            description,
            total_marks,
            due_date,
            question_file
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6
          )
          RETURNING *
          `,
          [
            req.user.id,
            title,
            description ||
              "",
            Number(
              totalMarks
            ) || 0,
            dueDate ||
              null,
            questionFilePath,
          ]
        );

      return res.status(
        201
      ).json({
        success: true,
        assignment:
          result.rows[0],
      });
    } catch (err) {
      console.error(
        "CREATE ASSIGNMENT ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not create assignment.",
      });
    }
  }
);

// ============================================================
// UPDATE ASSIGNMENT
// ============================================================

router.put(
  "/assignments/:id",
  async (
    req,
    res
  ) => {
    try {
      const {
        title,
        description,
        totalMarks,
        dueDate,
      } = req.body;

      const result =
        await db.query(
          `
          UPDATE assignments
          SET
            title = COALESCE($1, title),
            description = COALESCE($2, description),
            total_marks = COALESCE($3, total_marks),
            due_date = COALESCE($4, due_date)
          WHERE id = $5
            AND faculty_id = $6
          RETURNING *
          `,
          [
            title,
            description,
            totalMarks !==
            undefined
              ? Number(
                  totalMarks
                )
              : null,
            dueDate ||
              null,
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      return res.json({
        success: true,
        assignment:
          result.rows[0],
      });
    } catch (err) {
      console.error(
        "UPDATE ASSIGNMENT ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not update assignment.",
      });
    }
  }
);

// ============================================================
// DELETE ASSIGNMENT
// ============================================================

router.delete(
  "/assignments/:id",
  async (
    req,
    res
  ) => {
    try {
      const result =
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
        assignment.question_file
      ) {
        try {
          await deleteFromSupabase(
            BUCKETS.questions,
            assignment.question_file
          );
        } catch {}
      }

      if (
        assignment.answer_key_file
      ) {
        try {
          await deleteFromSupabase(
            BUCKETS.keys,
            assignment.answer_key_file
          );
        } catch {}
      }

      await db.query(
        `
        DELETE FROM assignments
        WHERE id = $1
          AND faculty_id = $2
        `,
        [
          req.params.id,
          req.user.id,
        ]
      );

      return res.json({
        success: true,
        message:
          "Assignment deleted successfully.",
      });
    } catch (err) {
      console.error(
        "DELETE ASSIGNMENT ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not delete assignment.",
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
          SELECT id
          FROM assignments
          WHERE id = $1
            AND faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !assignmentResult.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      const result =
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
          ORDER BY s.submitted_at ASC
          `,
          [
            req.params.id,
          ]
        );

      return res.json(
        result.rows || []
      );
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
// ANSWER KEY UPLOAD
// ============================================================

router.post(
  "/assignments/:id/answer-key",
  uploadKey,
  async (req, res) => {
    try {
      const assignmentId =
        req.params.id;

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

      if (
        !assignmentResult.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      // --------------------------------------------------------
      // GET ANSWER KEY TEXT
      // --------------------------------------------------------
      //
      // The faculty can paste the answer key directly.
      // We do NOT OCR the answer key.
      //
      // Accept the possible field names used by the frontend.
      // --------------------------------------------------------

      let answerKeyText =
        String(
          req.body.answerKeyText ||
          req.body.answer_key_text ||
          req.body.keyText ||
          ""
        ).trim();

      // --------------------------------------------------------
      // OPTIONAL FILE
      // --------------------------------------------------------
      //
      // A file can still be uploaded and stored, but it is NOT
      // used for OCR/grading. The text answer key is authoritative.
      // --------------------------------------------------------

      let answerKeyPath =
        null;

      if (req.file) {
        try {
          const uploaded =
            await uploadToSupabase(
              req.file,
              BUCKETS.keys
            );

          answerKeyPath =
            uploaded.path;
        } catch (uploadError) {
          console.warn(
            "Answer key Supabase upload failed. Using local storage:",
            uploadError.message
          );

          const safeName =
            `${Date.now()}-${req.file.originalname}`;

          const destDir =
            path.join(
              __dirname,
              "..",
              "uploads",
              "keys"
            );

          if (
            !fs.existsSync(
              destDir
            )
          ) {
            fs.mkdirSync(
              destDir,
              {
                recursive: true,
              }
            );
          }

          const localPath =
            path.join(
              destDir,
              safeName
            );

          fs.writeFileSync(
            localPath,
            req.file.buffer
          );

          answerKeyPath =
            safeName;
        }
      }

      // --------------------------------------------------------
      // REQUIRE TEXT ANSWER KEY
      // --------------------------------------------------------

      if (
        !answerKeyText
      ) {
        return res.status(
          400
        ).json({
          error:
            "Answer key text is required. Please paste the answer key.",
        });
      }

      // --------------------------------------------------------
      // SAVE ANSWER KEY TEXT
      // --------------------------------------------------------
      //
      // answer_key_text = actual reference answer
      //
      // answer_key = optional stored file path
      //
      // The AI auto-correction route reads answer_key_text.
      // --------------------------------------------------------

      await db.query(
        `
        UPDATE assignments
        SET
          answer_key_text = $1,
          answer_key = COALESCE(
            $2,
            answer_key
          )
        WHERE id = $3
          AND faculty_id = $4
        `,
        [
          answerKeyText,
          answerKeyPath,
          assignmentId,
          req.user.id,
        ]
      );

      console.log(
        `[ANSWER KEY] Text saved for assignment ${assignmentId}. Length: ${answerKeyText.length}`
      );

      return res.json({
        success: true,

        message:
          "Answer key text saved successfully.",

        assignmentId,

        answerKeyTextLength:
          answerKeyText.length,
      });
    } catch (err) {
      console.error(
        "ANSWER KEY SAVE ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not save answer key.",
        details:
          err.message,
      });
    }
  }
);


// ============================================================
// DOWNLOAD / VIEW ASSIGNMENT QUESTION
// ============================================================

router.get(
  "/assignments/:id/question",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            question_file
          FROM assignments
          WHERE id = $1
            AND faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      const questionFile =
        result.rows[0]
          .question_file;

      if (!questionFile) {
        return res.status(
          404
        ).json({
          error:
            "Question file not found.",
        });
      }

      try {
        const buffer =
          await downloadFromSupabase(
            BUCKETS.questions,
            questionFile
          );

        const mimeType =
          getMimeType(
            questionFile
          );

        res.setHeader(
          "Content-Type",
          mimeType
        );

        res.setHeader(
          "Content-Disposition",
          `inline; filename="${path.basename(
            questionFile
          )}"`
        );

        return res.send(
          buffer
        );
      } catch (storageError) {
        const localPath =
          path.join(
            __dirname,
            "..",
            "uploads",
            "questions",
            path.basename(
              questionFile
            )
          );

        if (
          fs.existsSync(
            localPath
          )
        ) {
          res.setHeader(
            "Content-Type",
            getMimeType(
              questionFile
            )
          );

          return res.send(
            fs.readFileSync(
              localPath
            )
          );
        }

        throw storageError;
      }
    } catch (err) {
      console.error(
        "QUESTION DOWNLOAD ERROR:",
        err.message
      );

      return res.status(
        404
      ).json({
        error:
          "Question file could not be found.",
      });
    }
  }
);


// ============================================================
// DOWNLOAD / VIEW ANSWER KEY
// ============================================================

router.get(
  "/assignments/:id/answer-key",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            answer_key
          FROM assignments
          WHERE id = $1
            AND faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      const answerKey =
        result.rows[0]
          .answer_key;

      if (!answerKey) {
        return res.status(
          404
        ).json({
          error:
            "Answer key not found.",
        });
      }

      try {
        const buffer =
          await downloadFromSupabase(
            BUCKETS.keys,
            answerKey
          );

        res.setHeader(
          "Content-Type",
          getMimeType(
            answerKey
          )
        );

        res.setHeader(
          "Content-Disposition",
          `inline; filename="${path.basename(
            answerKey
          )}"`
        );

        return res.send(
          buffer
        );
      } catch (storageError) {
        const localPath =
          path.join(
            __dirname,
            "..",
            "uploads",
            "keys",
            path.basename(
              answerKey
            )
          );

        if (
          fs.existsSync(
            localPath
          )
        ) {
          res.setHeader(
            "Content-Type",
            getMimeType(
              answerKey
            )
          );

          return res.send(
            fs.readFileSync(
              localPath
            )
          );
        }

        throw storageError;
      }
    } catch (err) {
      console.error(
        "ANSWER KEY DOWNLOAD ERROR:",
        err.message
      );

      return res.status(
        404
      ).json({
        error:
          "Answer key could not be found.",
      });
    }
  }
);


// ============================================================
// SINGLE SUBMISSION
// ============================================================

router.get(
  "/submissions/:id",
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
            u.name AS student_name,
            u.username AS student_username,
            u.email AS student_email,
            a.title AS assignment_title,
            a.total_marks
          FROM submissions s
          JOIN assignments a
            ON a.id =
               s.assignment_id
          JOIN users u
            ON u.id =
               s.student_id
          WHERE s.id = $1
            AND a.faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found.",
        });
      }

      return res.json(
        result.rows[0]
      );
    } catch (err) {
      console.error(
        "GET SUBMISSION ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not fetch submission.",
      });
    }
  }
);


// ============================================================
// VIEW SUBMISSION FILE
// ============================================================

router.get(
  "/submissions/:id/file",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            s.file_path,
            s.file_name,
            s.assignment_id
          FROM submissions s

          JOIN assignments a
            ON a.id =
               s.assignment_id

          WHERE s.id = $1
            AND a.faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found.",
        });
      }

      const submission =
        result.rows[0];

      const storagePath =
        submission.file_path;

      if (!storagePath) {
        return res.status(
          404
        ).json({
          error:
            "Submission file path is missing.",
        });
      }

      const downloaded =
        await downloadSubmissionFile(
          storagePath
        );

      const fileName =
        submission.file_name ||
        path.basename(
          downloaded.storagePath
        );

      res.setHeader(
        "Content-Type",
        getMimeType(
          fileName
        )
      );

      res.setHeader(
        "Content-Disposition",
        `inline; filename="${fileName.replace(
          /"/g,
          ""
        )}"`
      );

      return res.send(
        downloaded.buffer
      );
    } catch (err) {
      console.error(
        "VIEW SUBMISSION ERROR:",
        err.message
      );

      return res.status(
        404
      ).json({
        error:
          "Submission file could not be loaded.",
      });
    }
  }
);


// ============================================================
// EXTRACT TEXT FROM SINGLE SUBMISSION
// ============================================================

router.get(
  "/submissions/:id/extracted-text",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            s.file_path,
            s.file_name,
            a.faculty_id
          FROM submissions s

          JOIN assignments a
            ON a.id =
               s.assignment_id

          WHERE s.id = $1
            AND a.faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found.",
        });
      }

      const submission =
        result.rows[0];

      const downloaded =
        await downloadSubmissionFile(
          submission.file_path
        );

      const text =
        await extractTextFromBuffer(
          downloaded.buffer,
          submission.file_name ||
            downloaded.storagePath
        );

      return res.json({
        success: true,
        submissionId:
          req.params.id,
        text:
          text || "",
        readable:
          Boolean(
            text &&
            text.trim().length
          ),
      });
    } catch (err) {
      console.error(
        "EXTRACT SUBMISSION TEXT ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not extract submission text.",
      });
    }
  }
);


// ============================================================
// MANUAL GRADE SUBMISSION
// ============================================================

router.put(
  "/submissions/:id/grade",
  async (
    req,
    res
  ) => {
    try {
      const {
        marks,
        feedback,
      } = req.body;

      const result =
        await db.query(
          `
          SELECT
            s.id,
            a.total_marks
          FROM submissions s
          JOIN assignments a
            ON a.id =
               s.assignment_id
          WHERE s.id = $1
            AND a.faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found.",
        });
      }

      const totalMarks =
        Number(
          result.rows[0]
            .total_marks
        ) || 100;

      let finalMarks =
        Number(marks);

      if (
        Number.isNaN(
          finalMarks
        )
      ) {
        return res.status(
          400
        ).json({
          error:
            "Marks must be a valid number.",
        });
      }

      finalMarks =
        Math.max(
          0,
          Math.min(
            totalMarks,
            finalMarks
          )
        );

      await db.query(
        `
        UPDATE submissions
        SET
          final_marks = $1,
          auto_marks = $1,
          auto_feedback = $2,
          graded = 1
        WHERE id = $3
        `,
        [
          finalMarks,
          feedback || "",
          req.params.id,
        ]
      );

      return res.json({
        success: true,
        marks:
          finalMarks,
        feedback:
          feedback || "",
      });
    } catch (err) {
      console.error(
        "MANUAL GRADE ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not save grade.",
      });
    }
  }
);


// ============================================================
// POST MARKS TO STUDENT
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
            s.id
          FROM submissions s

          JOIN assignments a
            ON a.id =
               s.assignment_id

          WHERE s.id = $1
            AND a.faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found.",
        });
      }

      await db.query(
        `
        UPDATE submissions
        SET
          posted = 1,
          graded = 1
        WHERE id = $1
        `,
        [
          req.params.id,
        ]
      );

      return res.json({
        success: true,
        message:
          "Marks posted successfully.",
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
// POST ALL GRADED MARKS
// ============================================================

router.post(
  "/assignments/:id/post-all",
  async (
    req,
    res
  ) => {
    try {
      const assignmentResult =
        await db.query(
          `
          SELECT id
          FROM assignments
          WHERE id = $1
            AND faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !assignmentResult.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      const result =
        await db.query(
          `
          UPDATE submissions
          SET
            posted = 1,
            graded = 1
          WHERE assignment_id = $1
            AND graded = 1
          `,
          [
            req.params.id,
          ]
        );

      return res.json({
        success: true,
        message:
          "All graded marks posted successfully.",
        updated:
          result.rowCount,
      });
    } catch (err) {
      console.error(
        "POST ALL MARKS ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not post all marks.",
      });
    }
  }
);


// ============================================================
// AI AUTO-GRADE ONE SUBMISSION
// ============================================================

router.post(
  "/submissions/:id/ai-grade",
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
            a.title AS assignment_title,
            a.total_marks,
            a.answer_key,
            a.answer_key_text
          FROM submissions s

          JOIN assignments a
            ON a.id =
               s.assignment_id

          WHERE s.id = $1
            AND a.faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found.",
        });
      }

      const submission =
        result.rows[0];

      const downloaded =
        await downloadSubmissionFile(
          submission.file_path
        );

      const studentAnswer =
        await extractTextFromBuffer(
          downloaded.buffer,
          submission.file_name ||
            downloaded.storagePath
        );

      if (
        !studentAnswer ||
        studentAnswer.trim()
          .length < 20
      ) {
        return res.status(
          400
        ).json({
          error:
            "The student submission could not be read. Manual review is required.",
          reviewRequired:
            true,
        });
      }

      let answerKeyText =
        submission.answer_key_text ||
        "";

      if (
        !answerKeyText &&
        submission.answer_key
      ) {
        answerKeyText =
          await extractTextFromStorage(
            BUCKETS.keys,
            submission.answer_key,
            submission.answer_key
          );
      }

      if (
        !answerKeyText ||
        answerKeyText.trim()
          .length < 10
      ) {
        return res.status(
          400
        ).json({
          error:
            "Answer key could not be read.",
        });
      }

      const totalMarks =
        Number(
          submission.total_marks
        ) || 100;

      const aiResult =
        await gradeWithAI(
          submission.assignment_title ||
            "Assignment",
          answerKeyText,
          studentAnswer,
          totalMarks
        );

      if (!aiResult) {
        return res.status(
          500
        ).json({
          error:
            "AI grading failed.",
          reviewRequired:
            true,
        });
      }

      let feedback =
        aiResult.feedback ||
        "";

      const questions =
        Array.isArray(
          aiResult.questions
        )
          ? aiResult.questions
          : [];

      if (questions.length) {
        feedback +=
          "\n\nQUESTION-WISE EVALUATION:\n";

        for (
          const question
          of questions
        ) {
          feedback +=
            `Q${question.question}: ` +
            `${question.marks} marks - ` +
            `${question.status}. ` +
            `${question.feedback}\n`;
        }
      }

      const marks =
        Math.max(
          0,
          Math.min(
            totalMarks,
            Number(
              aiResult.marks ??
                aiResult.marksObtained ??
                0
            )
          )
        );

      await db.query(
        `
        UPDATE submissions
        SET
          auto_marks = $1,
          final_marks = $1,
          auto_feedback = $2,
          graded = 1
        WHERE id = $3
        `,
        [
          marks,
          feedback,
          req.params.id,
        ]
      );

      return res.json({
        success: true,

        submissionId:
          req.params.id,

        marks,

        totalMarks,

        reviewRequired:
          Boolean(
            aiResult.reviewRequired
          ),

        questions,

        feedback,
      });
    } catch (err) {
      console.error(
        "AI SINGLE GRADE ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not grade submission using AI.",
        reviewRequired:
          true,
      });
    }
  }
);
// ============================================================
// AI AUTO-CORRECTION + HANDWRITTEN OCR + DUPLICATE DETECTION
// ============================================================

router.post(
  "/assignments/:id/auto-correct",
  async (req, res) => {
    try {
      const assignmentId =
        req.params.id;

      // --------------------------------------------------------
      // SETTINGS
      // --------------------------------------------------------

      const {
        matchThreshold = 70,
      } = req.body || {};

      const duplicateThreshold =
        Math.max(
          1,
          Math.min(
            100,
            Number(matchThreshold) || 70
          )
        );

      // --------------------------------------------------------
      // 1. GET ASSIGNMENT
      // --------------------------------------------------------

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
          success: false,
          error:
            "Assignment not found.",
        });
      }

      // --------------------------------------------------------
      // 2. GET TEXT ANSWER KEY
      // --------------------------------------------------------
      //
      // The answer key is already stored as TEXT.
      // We do NOT OCR the answer key again.
      //
      // Priority:
      // answer_key_text
      // answer_key_content
      // answer_key
      // --------------------------------------------------------

      let answerKeyText =
        String(
          assignment.answer_key_text ||
          assignment.answer_key_content ||
          ""
        ).trim();

      // Some older records may have the actual answer
      // key text inside answer_key.
      //
      // Only use answer_key as text when it does not
      // look like a stored file path.

      if (!answerKeyText) {
        const possibleKey =
          String(
            assignment.answer_key ||
            ""
          ).trim();

        if (
          possibleKey &&
          !possibleKey.includes("/") &&
          !possibleKey.includes("\\")
        ) {
          answerKeyText =
            possibleKey;
        }
      }

      if (
        !answerKeyText ||
        answerKeyText.length < 10
      ) {
        return res.status(400).json({
          success: false,
          error:
            "No usable text answer key was found. Please save the answer key text before running auto-correction.",
        });
      }

      console.log(
        `[AI GRADING] Answer key loaded. Length: ${answerKeyText.length}`
      );

      // --------------------------------------------------------
      // 3. GET ALL STUDENT SUBMISSIONS
      // --------------------------------------------------------

      const submissionsResult =
        await db.query(
          `
          SELECT
            s.*,
            u.name AS student_name,
            u.username AS student_username,
            u.email AS student_email
          FROM submissions s
          JOIN users u
            ON u.id = s.student_id
          WHERE s.assignment_id = $1
          ORDER BY s.id ASC
          `,
          [
            assignmentId,
          ]
        );

      const submissions =
        submissionsResult.rows;

      if (
        !submissions ||
        !submissions.length
      ) {
        return res.status(404).json({
          success: false,
          error:
            "No student submissions found.",
        });
      }

      // --------------------------------------------------------
      // 4. TOTAL MARKS
      // --------------------------------------------------------

      const totalMarks =
        Number(
          assignment.total_marks ||
          assignment.max_marks ||
          100
        );

      // --------------------------------------------------------
      // 5. OCR ALL STUDENT SUBMISSIONS FIRST
      // --------------------------------------------------------
      //
      // Handwritten:
      // JPG / JPEG / PNG / WEBP / BMP
      //
      // Scanned PDF:
      // PDF -> Gemini Vision OCR
      //
      // Text/DOCX:
      // Normal extraction
      //
      // We extract everybody BEFORE duplicate detection
      // because duplicate detection needs the OCR text.
      // --------------------------------------------------------

      const extracted =
        [];

      for (
        const submission
        of submissions
      ) {
        let answerText =
          "";

        let ocrSuccessful =
          false;

        try {
          if (
            submission.file_path
          ) {
            console.log(
              `[OCR] Reading submission ${submission.id}`
            );

            const downloaded =
              await downloadSubmissionFile(
                submission.file_path
              );

            if (
              downloaded &&
              downloaded.buffer &&
              Buffer.isBuffer(
                downloaded.buffer
              )
            ) {
              answerText =
                await extractTextFromBuffer(
                  downloaded.buffer,
                  submission.file_original ||
                    downloaded.storagePath ||
                    submission.file_path
                );

              if (
                answerText &&
                answerText.trim()
              ) {
                ocrSuccessful =
                  true;
              }
            }
          }
        } catch (error) {
          console.error(
            `SUBMISSION ${submission.id} OCR ERROR:`,
            error.message
          );
        }

        answerText =
          String(
            answerText || ""
          ).trim();

        console.log(
          `[OCR] Submission ${submission.id}: ${answerText.length} characters extracted`
        );

        extracted.push({
          submission,
          answerText,
          ocrSuccessful,
        });
      }

      // --------------------------------------------------------
      // 6. PROCESS EACH STUDENT
      // --------------------------------------------------------

      const results =
        [];

      for (
        let i = 0;
        i < extracted.length;
        i++
      ) {
        const current =
          extracted[i];

        const currentSubmission =
          current.submission;

        const studentAnswer =
          current.answerText;

        // ------------------------------------------------------
        // DUPLICATE DETECTION
        // ------------------------------------------------------
        //
        // Compare student's OCR answer against every OTHER
        // student's OCR answer.
        //
        // This is NOT used for marks.
        //
        // AI grading determines marks.
        //
        // Similarity is only used to flag possible duplicates.
        // ------------------------------------------------------

        let highestSimilarity =
          0;

        let matchedSubmission =
          null;

        if (
          studentAnswer &&
          studentAnswer.trim()
        ) {
          for (
            let j = 0;
            j < extracted.length;
            j++
          ) {
            if (i === j) {
              continue;
            }

            const other =
              extracted[j];

            const otherAnswer =
              String(
                other.answerText || ""
              ).trim();

            if (
              otherAnswer.length < 20
            ) {
              continue;
            }

            const similarity =
              calculateSimilarity(
                studentAnswer,
                otherAnswer
              );

            if (
              similarity >
              highestSimilarity
            ) {
              highestSimilarity =
                similarity;

              matchedSubmission =
                other.submission;
            }
          }
        }

        const duplicateFlag =
          highestSimilarity >=
          duplicateThreshold;

        // ------------------------------------------------------
        // AI GRADING
        // ------------------------------------------------------
        //
        // IMPORTANT:
        // AI receives:
        //
        // 1. Assignment title
        // 2. TEXT ANSWER KEY
        // 3. OCR'd STUDENT HANDWRITTEN ANSWER
        // 4. Total marks
        //
        // AI grades the actual meaning.
        // ------------------------------------------------------

        let aiResult =
          null;

        if (
          studentAnswer &&
          studentAnswer.length >= 20
        ) {
          try {
            console.log(
              `[AI] Grading submission ${currentSubmission.id}`
            );

            aiResult =
              await gradeWithAI(
                assignment.title ||
                  "Assignment",
                answerKeyText,
                studentAnswer,
                totalMarks
              );

            if (aiResult) {
              console.log(
                `[AI] Submission ${currentSubmission.id} graded: ${aiResult.marks}/${totalMarks}`
              );
            }
          } catch (error) {
            console.error(
              `AI GRADING ERROR FOR SUBMISSION ${currentSubmission.id}:`,
              error.message
            );
          }
        }

        // ------------------------------------------------------
        // 7. CALCULATE MARKS
        // ------------------------------------------------------

        let marks =
          Number(
            aiResult?.marks ??
            aiResult?.marksObtained ??
            0
          );

        if (
          Number.isNaN(marks)
        ) {
          marks = 0;
        }

        marks =
          Math.max(
            0,
            Math.min(
              totalMarks,
              marks
            )
          );

        // ------------------------------------------------------
        // 8. QUESTION-WISE AI RESULTS
        // ------------------------------------------------------

        const questionResults =
          Array.isArray(
            aiResult?.questions
          )
            ? aiResult.questions
            : [];

        // ------------------------------------------------------
        // 9. REVIEW CONDITIONS
        // ------------------------------------------------------

        const unreadable =
          !studentAnswer ||
          studentAnswer.length < 20;

        const aiReviewRequired =
          Boolean(
            aiResult?.reviewRequired
          );

        const reviewRequired =
          unreadable ||
          aiReviewRequired ||
          duplicateFlag;

        // ------------------------------------------------------
        // 10. BUILD FEEDBACK
        // ------------------------------------------------------

        let feedback =
          String(
            aiResult?.feedback ||
            ""
          );

        if (!feedback) {
          feedback =
            "AI grading completed.";
        }

        // ------------------------------------------------------
        // QUESTION-WISE FEEDBACK
        // ------------------------------------------------------

        if (
          questionResults.length
        ) {
          feedback +=
            "\n\nQUESTION-WISE EVALUATION:\n";

          for (
            const question
            of questionResults
          ) {
            feedback +=
              `Q${question.question}: ` +
              `${question.marks} marks - ` +
              `${question.status}. ` +
              `${question.feedback}\n`;
          }
        }

        // ------------------------------------------------------
        // OCR REVIEW MESSAGE
        // ------------------------------------------------------

        if (
          unreadable
        ) {
          feedback +=
            "\n\nMANUAL REVIEW REQUIRED: " +
            "The handwritten/scanned submission could not be reliably read.";
        }

        // ------------------------------------------------------
        // AI REVIEW MESSAGE
        // ------------------------------------------------------

        if (
          aiReviewRequired
        ) {
          feedback +=
            "\n\nMANUAL REVIEW REQUIRED: " +
            "AI grading detected unclear content or another condition requiring faculty review.";
        }

        // ------------------------------------------------------
        // DUPLICATE MESSAGE
        // ------------------------------------------------------

        if (
          duplicateFlag
        ) {
          feedback +=
            "\n\nDUPLICATE REVIEW FLAG: " +
            `${highestSimilarity.toFixed(2)}% similarity detected with another submission. ` +
            "Faculty review is required.";
        }

        // ------------------------------------------------------
        // 11. SAVE RESULT TO DATABASE
        // ------------------------------------------------------

        await db.query(
          `
          UPDATE submissions
          SET
            similarity_pct = $1,
            duplicate_flag = $2,
            final_marks = $3,
            auto_marks = $4,
            auto_feedback = $5,
            graded = 1,
            posted = 0
          WHERE id = $6
          `,
          [
            highestSimilarity,

            duplicateFlag
              ? 1
              : 0,

            marks,

            marks,

            feedback,

            currentSubmission.id,
          ]
        );

        // ------------------------------------------------------
        // 12. ADD RESULT TO RESPONSE
        // ------------------------------------------------------

        results.push({
          submissionId:
            currentSubmission.id,

          studentId:
            currentSubmission.student_id,

          studentName:
            currentSubmission.student_name ||
            currentSubmission.student_username ||
            "Student",

          studentUsername:
            currentSubmission.student_username ||
            "",

          marks,

          totalMarks,

          percentage:
            totalMarks > 0
              ? Number(
                  (
                    (marks /
                      totalMarks) *
                    100
                  ).toFixed(2)
                )
              : 0,

          ocrSuccessful,

          extractedAnswer:
            studentAnswer,

          reviewRequired,

          duplicateFlag,

          duplicateSimilarity:
            Number(
              highestSimilarity.toFixed(
                2
              )
            ),

          matchedWith:
            matchedSubmission
              ? {
                  submissionId:
                    matchedSubmission.id,

                  studentName:
                    matchedSubmission.student_name ||
                    matchedSubmission.student_username ||
                    "Student",
                }
              : null,

          questionResults,

          feedback,
        });
      }

      // --------------------------------------------------------
      // 13. FILTER DUPLICATES
      // --------------------------------------------------------
      //
      // This gives the faculty frontend a separate list of
      // possible duplicate submissions.
      // --------------------------------------------------------

      const duplicateResults =
        results.filter(
          (item) =>
            item.duplicateFlag
        );

      const cleanResults =
        results.filter(
          (item) =>
            !item.duplicateFlag
        );

      const reviewResults =
        results.filter(
          (item) =>
            item.reviewRequired
        );

      // --------------------------------------------------------
      // 14. FINAL RESPONSE
      // --------------------------------------------------------

      return res.json({
        success: true,

        message:
          "Handwritten OCR, AI correction, marks calculation and duplicate detection completed successfully.",

        assignmentId,

        assignmentTitle:
          assignment.title,

        totalMarks,

        totalSubmissions:
          submissions.length,

        successfullyRead:
          results.filter(
            (item) =>
              item.ocrSuccessful
          ).length,

        unreadableSubmissions:
          results.filter(
            (item) =>
              !item.ocrSuccessful
          ).length,

        reviewedSubmissions:
          reviewResults.length,

        duplicateSubmissions:
          duplicateResults.length,

        normalSubmissions:
          cleanResults.length,

        duplicateThreshold,

        // All results
        results,

        // Only possible duplicates
        duplicates:
          duplicateResults,

        // Only non-duplicate submissions
        cleanSubmissions:
          cleanResults,

        // Anything requiring faculty review
        reviewRequired:
          reviewResults,
      });
    } catch (error) {
      console.error(
        "AUTO CORRECTION ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          "Auto-correction failed.",

        details:
          error.message,

        reviewRequired:
          true,
      });
    }
  }
);

// ============================================================
// CHECK DUPLICATE SUBMISSIONS ONLY
// ============================================================

router.get(
  "/assignments/:id/duplicates",
  async (
    req,
    res
  ) => {
    try {
      const assignmentResult =
        await db.query(
          `
          SELECT id
          FROM assignments
          WHERE id = $1
            AND faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !assignmentResult.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      const submissionsResult =
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
          ORDER BY s.id ASC
          `,
          [
            req.params.id,
          ]
        );

      const submissions =
        submissionsResult.rows;

      const extracted =
        [];

      for (
        const submission
        of submissions
      ) {
        let text = "";

        try {
          if (
            submission.file_path
          ) {
            const downloaded =
              await downloadSubmissionFile(
                submission.file_path
              );

            text =
              await extractTextFromBuffer(
                downloaded.buffer,
                submission.file_name ||
                  downloaded.storagePath
              );
          }
        } catch {}

        extracted.push({
          submission,
          text:
            text || "",
        });
      }

      const threshold =
        Number(
          req.query.threshold
        ) || 70;

      const duplicates =
        [];

      for (
        let i = 0;
        i < extracted.length;
        i++
      ) {
        for (
          let j = i + 1;
          j < extracted.length;
          j++
        ) {
          if (
            !extracted[i].text ||
            !extracted[j].text
          ) {
            continue;
          }

          const similarity =
            calculateSimilarity(
              extracted[i].text,
              extracted[j].text
            );

          if (
            similarity >=
            threshold
          ) {
            duplicates.push({
              submission1:
                extracted[i]
                  .submission
                  .id,

              student1:
                extracted[i]
                  .submission
                  .student_name ||
                extracted[i]
                  .submission
                  .student_username,

              submission2:
                extracted[j]
                  .submission
                  .id,

              student2:
                extracted[j]
                  .submission
                  .student_name ||
                extracted[j]
                  .submission
                  .student_username,

              similarity,
            });
          }
        }
      }

      return res.json({
        success: true,

        threshold,

        count:
          duplicates.length,

        duplicates,
      });
    } catch (error) {
      console.error(
        "DUPLICATE CHECK ERROR:",
        error.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not check duplicate submissions.",
      });
    }
  }
);


// ============================================================
// GET SUBMISSION FEEDBACK
// ============================================================

router.get(
  "/submissions/:id/feedback",
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
            s.auto_marks,
            s.final_marks,
            s.auto_feedback,
            s.similarity_pct,
            s.duplicate_flag,
            s.graded,
            s.posted,
            a.total_marks,
            a.title
          FROM submissions s
          JOIN assignments a
            ON a.id = s.assignment_id
          WHERE s.id = $1
            AND a.faculty_id = $2
          `,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found.",
        });
      }

      const row =
        result.rows[0];

      return res.json({
        success: true,

        submissionId:
          row.id,

        marks:
          row.final_marks ??
          row.auto_marks ??
          0,

        autoMarks:
          row.auto_marks ??
          0,

        totalMarks:
          row.total_marks ??
          0,

        feedback:
          row.auto_feedback ||
          "",

        similarity:
          row.similarity_pct ??
          0,

        duplicateFlag:
          Boolean(
            row.duplicate_flag
          ),

        graded:
          Boolean(
            row.graded
          ),

        posted:
          Boolean(
            row.posted
          ),
      });
    } catch (error) {
      console.error(
        "GET FEEDBACK ERROR:",
        error.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not load feedback.",
      });
    }
  }
);


// ============================================================
// ASSIGNMENT RESULTS SUMMARY
// ============================================================

router.get(
  "/assignments/:id/results",
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

      if (
        !assignmentResult.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      const assignment =
        assignmentResult.rows[0];

      const result =
        await db.query(
          `
          SELECT
            s.id,
            s.student_id,
            u.name AS student_name,
            u.username,
            u.email,

            s.final_marks,
            s.auto_marks,
            s.auto_feedback,

            s.similarity_pct,
            s.duplicate_flag,

            s.graded,
            s.posted,

            s.submitted_at

          FROM submissions s

          JOIN users u
            ON u.id =
               s.student_id

          WHERE s.assignment_id = $1

          ORDER BY
            s.final_marks DESC NULLS LAST,
            s.id ASC
          `,
          [
            req.params.id,
          ]
        );

      const rows =
        result.rows || [];

      const marks =
        rows
          .map(
            (row) =>
              Number(
                row.final_marks ??
                  row.auto_marks
              )
          )
          .filter(
            (value) =>
              !Number.isNaN(
                value
              )
          );

      const average =
        marks.length
          ? Number(
              (
                marks.reduce(
                  (
                    sum,
                    value
                  ) =>
                    sum +
                    value,
                  0
                ) /
                marks.length
              ).toFixed(2)
            )
          : 0;

      const highest =
        marks.length
          ? Math.max(
              ...marks
            )
          : 0;

      const lowest =
        marks.length
          ? Math.min(
              ...marks
            )
          : 0;

      return res.json({
        success: true,

        assignment: {
          id:
            assignment.id,

          title:
            assignment.title,

          totalMarks:
            Number(
              assignment.total_marks
            ) || 0,
        },

        summary: {
          totalSubmissions:
            rows.length,

          graded:
            rows.filter(
              (row) =>
                row.graded
            ).length,

          posted:
            rows.filter(
              (row) =>
                row.posted
            ).length,

          duplicates:
            rows.filter(
              (row) =>
                row.duplicate_flag
            ).length,

          average,

          highest,

          lowest,
        },

        results:
          rows,
      });
    } catch (error) {
      console.error(
        "RESULTS ERROR:",
        error.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not load assignment results.",
      });
    }
  }
);


// ============================================================
// STUDENT PERFORMANCE
// ============================================================

router.get(
  "/students/:studentId/performance",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            s.id AS submission_id,

            a.id AS assignment_id,
            a.title,
            a.total_marks,
            a.due_date,

            s.final_marks,
            s.auto_marks,
            s.auto_feedback,

            s.graded,
            s.posted,
            s.submitted_at

          FROM submissions s

          JOIN assignments a
            ON a.id =
               s.assignment_id

          WHERE s.student_id = $1
            AND a.faculty_id = $2

          ORDER BY
            a.id DESC
          `,
          [
            req.params.studentId,
            req.user.id,
          ]
        );

      const rows =
        result.rows || [];

      return res.json({
        success: true,

        studentId:
          req.params.studentId,

        submissions:
          rows,
      });
    } catch (error) {
      console.error(
        "STUDENT PERFORMANCE ERROR:",
        error.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not load student performance.",
      });
    }
  }
);


// ============================================================
// NOTIFICATIONS / PENDING COUNTS
// ============================================================

router.get(
  "/notifications",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(
          `
          SELECT
            COUNT(*) FILTER (
              WHERE e.status = 'pending'
            ) AS pending_students,

            COUNT(*) FILTER (
              WHERE s.graded = 0
                 OR s.graded IS NULL
            ) AS ungraded_submissions

          FROM enrollments e

          LEFT JOIN assignments a
            ON a.faculty_id =
               e.faculty_id

          LEFT JOIN submissions s
            ON s.assignment_id =
               a.id

          WHERE e.faculty_id = $1
          `,
          [
            req.user.id,
          ]
        );

      return res.json({
        success: true,

        notifications:
          result.rows[0] || {
            pending_students:
              0,

            ungraded_submissions:
              0,
          },
      });
    } catch (error) {
      console.error(
        "NOTIFICATIONS ERROR:",
        error.message
      );

      return res.json({
        success: true,

        notifications: {
          pending_students:
            0,

          ungraded_submissions:
            0,
        },
      });
    }
  }
);


// ============================================================
// CHANGE ASSIGNMENT DEADLINE
// ============================================================

router.patch(
  "/assignments/:id/deadline",
  async (
    req,
    res
  ) => {
    try {
      const {
        dueDate,
      } = req.body;

      if (
        !dueDate
      ) {
        return res.status(
          400
        ).json({
          error:
            "Due date is required.",
        });
      }

      const result =
        await db.query(
          `
          UPDATE assignments
          SET due_date = $1
          WHERE id = $2
            AND faculty_id = $3
          RETURNING *
          `,
          [
            dueDate,
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Assignment not found.",
        });
      }

      return res.json({
        success: true,

        assignment:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "DEADLINE UPDATE ERROR:",
        error.message
      );

      return res.status(
        500
      ).json({
        error:
          "Could not update deadline.",
      });
    }
  }
);
// ============================================================
// PART 4 / 4
// CONTINUATION — KEEP THIS AFTER PART 3
// ============================================================


// ============================================================
// EXAM MANAGEMENT
// ============================================================

router.get(
  "/exams",
  async (req, res) => {
    try {
      const result = await db.query(
        `
        SELECT *
        FROM exams
        WHERE faculty_id = $1
        ORDER BY id DESC
        `,
        [req.user.id]
      );

      return res.json(result.rows || []);
    } catch (err) {
      console.error(
        "GET EXAMS ERROR:",
        err.message
      );

      return res.status(500).json({
        error: "Could not fetch exams.",
      });
    }
  }
);


// ============================================================
// GET SINGLE EXAM
// ============================================================

router.get(
  "/exams/:id",
  async (req, res) => {
    try {
      const result = await db.query(
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

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Exam not found.",
        });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error(
        "GET EXAM ERROR:",
        err.message
      );

      return res.status(500).json({
        error: "Could not fetch exam.",
      });
    }
  }
);


// ============================================================
// CREATE EXAM
// ============================================================

router.post(
  "/exams",
  async (req, res) => {
    try {
      const {
        title,
        description,
        duration,
        totalMarks,
        startTime,
        endTime,
      } = req.body;

      if (!title) {
        return res.status(400).json({
          error: "Exam title is required.",
        });
      }

      const result = await db.query(
        `
        INSERT INTO exams (
          faculty_id,
          title,
          description,
          duration,
          total_marks,
          start_time,
          end_time
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7
        )
        RETURNING *
        `,
        [
          req.user.id,
          title,
          description || "",
          Number(duration) || 0,
          Number(totalMarks) || 0,
          startTime || null,
          endTime || null,
        ]
      );

      return res.status(201).json({
        success: true,
        exam: result.rows[0],
      });
    } catch (err) {
      console.error(
        "CREATE EXAM ERROR:",
        err.message
      );

      return res.status(500).json({
        error: "Could not create exam.",
      });
    }
  }
);


// ============================================================
// UPDATE EXAM
// ============================================================

router.put(
  "/exams/:id",
  async (req, res) => {
    try {
      const {
        title,
        description,
        duration,
        totalMarks,
        startTime,
        endTime,
      } = req.body;

      const result = await db.query(
        `
        UPDATE exams
        SET
          title = COALESCE($1, title),
          description = COALESCE($2, description),
          duration = COALESCE($3, duration),
          total_marks = COALESCE($4, total_marks),
          start_time = COALESCE($5, start_time),
          end_time = COALESCE($6, end_time)
        WHERE id = $7
          AND faculty_id = $8
        RETURNING *
        `,
        [
          title,
          description,
          duration !== undefined
            ? Number(duration)
            : null,
          totalMarks !== undefined
            ? Number(totalMarks)
            : null,
          startTime || null,
          endTime || null,
          req.params.id,
          req.user.id,
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Exam not found.",
        });
      }

      return res.json({
        success: true,
        exam: result.rows[0],
      });
    } catch (err) {
      console.error(
        "UPDATE EXAM ERROR:",
        err.message
      );

      return res.status(500).json({
        error: "Could not update exam.",
      });
    }
  }
);


// ============================================================
// DELETE EXAM
// ============================================================

router.delete(
  "/exams/:id",
  async (req, res) => {
    try {
      const result = await db.query(
        `
        DELETE FROM exams
        WHERE id = $1
          AND faculty_id = $2
        RETURNING id
        `,
        [
          req.params.id,
          req.user.id,
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Exam not found.",
        });
      }

      return res.json({
        success: true,
        message: "Exam deleted successfully.",
      });
    } catch (err) {
      console.error(
        "DELETE EXAM ERROR:",
        err.message
      );

      return res.status(500).json({
        error: "Could not delete exam.",
      });
    }
  }
);


// ============================================================
// EXAM ATTEMPTS
// ============================================================

router.get(
  "/exams/:id/attempts",
  async (req, res) => {
    try {
      const examResult = await db.query(
        `
        SELECT id
        FROM exams
        WHERE id = $1
          AND faculty_id = $2
        `,
        [
          req.params.id,
          req.user.id,
        ]
      );

      if (!examResult.rows.length) {
        return res.status(404).json({
          error: "Exam not found.",
        });
      }

      const result = await db.query(
        `
        SELECT
          at.*,
          u.name AS student_name,
          u.username AS student_username,
          u.email AS student_email
        FROM exam_attempts at
        JOIN users u
          ON u.id = at.student_id
        WHERE at.exam_id = $1
        ORDER BY at.id DESC
        `,
        [req.params.id]
      );

      return res.json(result.rows || []);
    } catch (err) {
      console.error(
        "GET EXAM ATTEMPTS ERROR:",
        err.message
      );

      return res.status(500).json({
        error: "Could not fetch exam attempts.",
      });
    }
  }
);


// ============================================================
// SINGLE EXAM ATTEMPT
// ============================================================

router.get(
  "/exam-attempts/:id",
  async (req, res) => {
    try {
      const result = await db.query(
        `
        SELECT
          at.*,
          ex.title AS exam_title,
          ex.total_marks,
          ex.faculty_id,
          u.name AS student_name,
          u.username AS student_username
        FROM exam_attempts at
        JOIN exams ex
          ON ex.id = at.exam_id
        JOIN users u
          ON u.id = at.student_id
        WHERE at.id = $1
          AND ex.faculty_id = $2
        `,
        [
          req.params.id,
          req.user.id,
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Exam attempt not found.",
        });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error(
        "GET EXAM ATTEMPT ERROR:",
        err.message
      );

      return res.status(500).json({
        error: "Could not fetch exam attempt.",
      });
    }
  }
);


// ============================================================
// GRADE EXAM ATTEMPT
// ============================================================

router.put(
  "/exam-attempts/:id/grade",
  async (req, res) => {
    try {
      const result = await db.query(
        `
        SELECT
          at.*,
          ex.total_marks,
          ex.faculty_id
        FROM exam_attempts at
        JOIN exams ex
          ON ex.id = at.exam_id
        WHERE at.id = $1
          AND ex.faculty_id = $2
        `,
        [
          req.params.id,
          req.user.id,
        ]
      );

      const attempt = result.rows[0];

      if (!attempt) {
        return res.status(404).json({
          error: "Exam attempt not found.",
        });
      }

      const requestedMarks =
        Number(req.body.marks);

      if (Number.isNaN(requestedMarks)) {
        return res.status(400).json({
          error: "Marks must be a valid number.",
        });
      }

      const totalMarks =
        Number(attempt.total_marks) || 100;

      const score = Math.max(
        0,
        Math.min(
          totalMarks,
          requestedMarks
        )
      );

      await db.query(
        `
        UPDATE exam_attempts
        SET
          score = $1,
          feedback = $2,
          graded = 1
        WHERE id = $3
        `,
        [
          score,
          req.body.feedback || "",
          req.params.id,
        ]
      );

      return res.json({
        success: true,
        score,
        totalMarks,
      });
    } catch (err) {
      console.error(
        "GRADE EXAM ATTEMPT ERROR:",
        err.message
      );

      return res.status(500).json({
        error: "Could not grade exam attempt.",
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
      const result = await db.query(
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

      const attempt = result.rows[0];

      if (
        !attempt ||
        Number(attempt.faculty_id) !==
          Number(req.user.id)
      ) {
        return res.status(404).json({
          error: "Attempt not found.",
        });
      }

      if (
        attempt.score === null ||
        attempt.score === undefined
      ) {
        return res.status(400).json({
          error:
            "Score the attempt before posting.",
        });
      }

      await db.query(
        `
        UPDATE exam_attempts
        SET
          posted = 1
        WHERE id = $1
        `,
        [attempt.id]
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

      return res.status(500).json({
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
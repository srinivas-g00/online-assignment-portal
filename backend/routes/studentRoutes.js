// backend/routes/studentRoutes.js
//
// Student routes.
//
// Permanent file storage:
//   Question papers -> Supabase Storage: questions
//   Student answers -> Supabase Storage: answers
//
// IMPORTANT:
//   Render local disk is NOT used for permanent files.
//
// Flow for student answer:
//   Browser
//      ↓
//   Multer memoryStorage
//      ↓
//   Supabase Storage / answers
//      ↓
//   PostgreSQL submissions.file_path
//
// The faculty can then securely access the file through:
//
//   GET /api/faculty/submissions/:submissionId/file
//
// The answers bucket should remain PRIVATE.
//

const express =
  require("express");

const router =
  express.Router();

const path =
  require("path");

const fs =
  require("fs");

const db =
  require("../config/db");

const {
  auth,
  requireRole,
} = require("../middleware/auth");

// ============================================================
// SUPABASE STORAGE
// ============================================================

const {
  uploadAnswer,
  uploadToSupabase,
  downloadFromSupabase,
  deleteFromSupabase,
  BUCKETS,
  getSupabase,
} = require("../utils/upload");

// ============================================================
// OTP / EMAIL
// ============================================================

const {
  sendOtpEmail,
} = require("../utils/mailer");

// ============================================================
// TOKEN OVERRIDE FOR DIRECT BROWSER DOWNLOADS
// ============================================================
//
// Allows browser GET requests initiated by <a> tags to authenticate
// using ?token=<jwt> when headers cannot be manually attached.
//

router.use(
  (
    req,
    res,
    next
  ) => {
    const queryToken =
      req.query &&
      (
        req.query.token ||
        req.query.t ||
        req.query.access_token
      );

    if (
      !req.headers.authorization &&
      queryToken
    ) {
      const cleanToken =
        String(
          queryToken
        )
          .trim()
          .replace(
            /^Bearer\s+/i,
            ""
          );

      req.headers.authorization =
        `Bearer ${cleanToken}`;
    }

    next();
  }
);

// ============================================================
// PROTECT ALL STUDENT ROUTES
// ============================================================

router.use(
  auth
);

router.use(
  requireRole(
    "student"
  )
);

// ============================================================
// HELPER: STORAGE PATH CANDIDATES
// ============================================================

function getPossibleStoragePaths(
  storagePath,
  folderName
) {
  const raw =
    String(
      storagePath || ""
    ).trim();

  if (
    !raw
  ) {
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

  const withoutFolder =
    withoutUploads.replace(
      new RegExp(
        `^${folderName}\/+`,
        "i"
      ),
      ""
    );

  const baseName =
    path.basename(
      normalized
    );

  const candidates = [
    withoutFolder,
    baseName,
    normalized,
    noLeadingSlash,
    withoutUploads,
    `${folderName}/${withoutFolder}`,
    `${folderName}/${baseName}`,
    `uploads/${folderName}/${baseName}`,
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
// HELPER: DOWNLOAD FILE WITH RESILIENT FALLBACKS
// ============================================================

async function fetchFileWithFallback(
  bucket,
  storagePath
) {
  const possiblePaths =
    getPossibleStoragePaths(
      storagePath,
      bucket
    );

  let lastError =
    null;

  // 1. Try candidate paths on Supabase
  for (
    const candidate
    of possiblePaths
  ) {
    try {
      const buffer =
        await downloadFromSupabase(
          bucket,
          candidate
        );

      if (
        Buffer.isBuffer(
          buffer
        ) &&
        buffer.length >
          0
      ) {
        return {
          buffer,
          usedPath:
            candidate,
        };
      }
    } catch (
      err
    ) {
      lastError =
        err;
    }
  }

  // 2. Search bucket by base filename
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

  try {
    const supabase =
      getSupabase();

    if (
      cleanFileName &&
      supabase
    ) {
      const {
        data,
        error,
      } =
        await supabase
          .storage
          .from(
            bucket
          )
          .list(
            "",
            {
              limit: 1000,
              search: cleanFileName,
            }
          );

      if (
        !error &&
        Array.isArray(
          data
        )
      ) {
        const exactMatch =
          data.find(
            (
              item
            ) =>
              item &&
              item.name ===
                cleanFileName
          );

        if (
          exactMatch
        ) {
          const buffer =
            await downloadFromSupabase(
              bucket,
              exactMatch.name
            );

          if (
            buffer &&
            buffer.length >
              0
          ) {
            return {
              buffer,
              usedPath:
                exactMatch.name,
            };
          }
        }
      }
    }
  } catch (
    err
  ) {
    lastError =
      err;
  }

  // 3. Fallback to local disk directory mirror
  const localDiskCandidates = [
    path.join(
      __dirname,
      "..",
      "uploads",
      bucket,
      cleanFileName
    ),
    path.join(
      __dirname,
      "..",
      "uploads",
      cleanFileName
    ),
    path.join(
      __dirname,
      "..",
      "uploads",
      bucket,
      storagePath
    ),
    path.join(
      __dirname,
      "..",
      storagePath
    ),
  ];

  for (
    const localPath
    of localDiskCandidates
  ) {
    if (
      fs.existsSync(
        localPath
      )
    ) {
      try {
        const localBuffer =
          fs.readFileSync(
            localPath
          );

        if (
          localBuffer &&
          localBuffer.length >
            0
        ) {
          return {
            buffer:
              localBuffer,
            usedPath:
              cleanFileName,
          };
        }
      } catch (
        readErr
      ) {
        lastError =
          readErr;
      }
    }
  }

  throw (
    lastError ||
    new Error(
      `File was not found in storage bucket: ${bucket}`
    )
  );
}

// ============================================================
// HELPER: REMOVE LOCAL TEMP FILE
// ============================================================

function removeLocalFile(
  file
) {
  if (
    file &&
    file.path &&
    fs.existsSync(
      file.path
    )
  ) {
    fs.unlink(
      file.path,
      () => {}
    );
  }
}

// ============================================================
// HELPER: FILE EXTENSION
// ============================================================

function getFileExtension(
  fileName
) {
  return path
    .extname(
      String(
        fileName || ""
      )
    )
    .toLowerCase();
}

// ============================================================
// HELPER: MIME TYPE
// ============================================================

function getMimeType(
  fileName
) {
  const extension =
    getFileExtension(
      fileName
    );

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
    mimeTypes[
      extension
    ] ||
    "application/octet-stream"
  );
}

// ============================================================
// 1. CURRENT STUDENT PROFILE
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
          [
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
            "User not found.",
        });
      }

      return res.json(
        result.rows[0]
      );
    } catch (
      err
    ) {
      console.error(
        "Student /me error:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Failed to fetch student profile.",
      });
    }
  }
);

// ============================================================
// 2. SEARCH FACULTIES
// ============================================================

router.get(
  "/faculties",
  async (
    req,
    res
  ) => {
    try {
      const searchText =
        req.query.search
          ? String(
              req.query.search
            ).trim()
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
            ON e.faculty_id =
               u.id
           AND e.student_id =
               $1

          WHERE u.role =
                'faculty'

            AND (
              u.name ILIKE $2
              OR u.subject ILIKE $2
              OR u.branch ILIKE $2
            )

          ORDER BY
            u.name ASC
          `,
          [
            req.user.id,
            search,
          ]
        );

      return res.json(
        result.rows || []
      );
    } catch (
      err
    ) {
      console.error(
        "Student /faculties error:",
        err.message
      );

      return res.status(
        500
      ).json({
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
            u.subject,
            u.slot,
            u.branch,
            e.status AS "enrollStatus"

          FROM users u

          LEFT JOIN enrollments e
            ON e.faculty_id =
               u.id
           AND e.student_id =
               $1

          WHERE u.id = $2
            AND u.role =
                'faculty'
          `,
          [
            req.user.id,
            req.params.facultyId,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Faculty not found.",
        });
      }

      return res.json(
        result.rows[0]
      );
    } catch (
      err
    ) {
      console.error(
        "Student /faculties/:id error:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  async (
    req,
    res
  ) => {
    try {
      const facultyResult =
        await db.query(
          `
          SELECT
            id
          FROM users
          WHERE id = $1
            AND role =
                'faculty'
          `,
          [
            req.params.facultyId,
          ]
        );

      if (
        !facultyResult.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Faculty not found.",
        });
      }

      const existingResult =
        await db.query(
          `
          SELECT
            id,
            status
          FROM enrollments
          WHERE student_id = $1
            AND faculty_id = $2
          `,
          [
            req.user.id,
            req.params.facultyId,
          ]
        );

      if (
        existingResult.rows.length
      ) {
        return res.status(
          400
        ).json({
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

      return res.json({
        success:
          true,

        message:
          "Registration request sent successfully.",
      });
    } catch (
      err
    ) {
      console.error(
        "Student enroll error:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Failed to send registration request.",
      });
    }
  }
);

// ============================================================
// 5. FACULTY ASSIGNMENTS (WITH CONCEALED UNPOSTED MARKS)
// ============================================================

router.get(
  "/faculties/:facultyId/assignments",
  async (
    req,
    res
  ) => {
    try {
      // ------------------------------------------------------
      // Check accepted enrollment
      // ------------------------------------------------------

      const enrollmentResult =
        await db.query(
          `
          SELECT
            status
          FROM enrollments

          WHERE student_id = $1
            AND faculty_id = $2
            AND status =
                'accepted'
          `,
          [
            req.user.id,
            req.params.facultyId,
          ]
        );

      if (
        !enrollmentResult.rows.length
      ) {
        return res.status(
          403
        ).json({
          error:
            "You are not enrolled/accepted under this faculty.",
        });
      }

      // ------------------------------------------------------
      // Get assignments + student submission
      // Conceals final_marks if not posted
      // ------------------------------------------------------

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

            CASE
              WHEN s.posted = TRUE OR s.posted = 1::boolean
                THEN s.final_marks
              ELSE NULL
            END AS final_marks,

            COALESCE(
              s.posted,
              FALSE
            ) AS posted,

            s.resubmit_count

          FROM assignments a

          LEFT JOIN submissions s
            ON s.assignment_id =
               a.id
           AND s.student_id =
               $1

          WHERE a.faculty_id =
                $2

          ORDER BY
            a.due_date ASC,
            a.due_time ASC
          `,
          [
            req.user.id,
            req.params.facultyId,
          ]
        );

      return res.json(
        result.rows || []
      );
    } catch (
      err
    ) {
      console.error(
        "Student faculty assignments error:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Failed to load assignments.",
      });
    }
  }
);

// ============================================================
// 5A. STUDENT QUESTION PAPER DOWNLOAD
// ============================================================

router.get(
  "/assignments/:assignmentId/question-paper",
  async (
    req,
    res
  ) => {
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
        return res.status(
          400
        ).json({
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
            id,
            faculty_id,
            question_file,
            question_original

          FROM assignments

          WHERE id = $1
          `,
          [
            assignmentId,
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

      // ------------------------------------------------------
      // Check accepted enrollment
      // ------------------------------------------------------

      const enrollmentResult =
        await db.query(
          `
          SELECT
            id

          FROM enrollments

          WHERE student_id = $1
            AND faculty_id = $2
            AND status =
                'accepted'

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
        return res.status(
          403
        ).json({
          error:
            "You are not enrolled/accepted under this faculty.",
        });
      }

      // ------------------------------------------------------
      // Validate storage path
      // ------------------------------------------------------

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

      if (
        !storagePath
      ) {
        return res.status(
          404
        ).json({
          error:
            "Question paper storage path is empty.",
        });
      }

      // ------------------------------------------------------
      // Download from Storage
      // ------------------------------------------------------

      const download =
        await fetchFileWithFallback(
          BUCKETS.questions,
          storagePath
        );

      const displayName =
        assignment.question_original ||
        path.basename(
          download.usedPath ||
            storagePath
        ) ||
        "question-paper.pdf";

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
        download.buffer.length
      );

      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(
          displayName
        )}"`
      );

      res.setHeader(
        "Cache-Control",
        "private, no-cache, no-store, must-revalidate"
      );

      return res.send(
        download.buffer
      );
    } catch (
      err
    ) {
      console.error(
        "VIEW QUESTION PAPER ERROR:",
        err.message
      );

      if (
        !res.headersSent
      ) {
        return res.status(
          404
        ).json({
          error:
            "Question paper file was not found in storage: " +
            err.message,
        });
      }
    }
  }
);

// ============================================================
// 5B. STUDENT SUBMISSION FILE DOWNLOAD
// ============================================================

router.get(
  "/submissions/:submissionId/file",
  async (
    req,
    res
  ) => {
    try {
      const submissionId =
        Number(
          req.params.submissionId
        );

      if (
        !Number.isInteger(
          submissionId
        ) ||
        submissionId <= 0
      ) {
        return res.status(
          400
        ).json({
          error:
            "Invalid submission ID.",
        });
      }

      const submissionResult =
        await db.query(
          `
          SELECT
            id,
            student_id,
            file_path,
            file_original

          FROM submissions

          WHERE id = $1
            AND student_id = $2
          `,
          [
            submissionId,
            req.user.id,
          ]
        );

      if (
        !submissionResult.rows.length
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission not found or access denied.",
        });
      }

      const submission =
        submissionResult.rows[0];

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
            "Submission file record is empty.",
        });
      }

      const storagePath =
        String(
          submission.file_path
        ).trim();

      const download =
        await fetchFileWithFallback(
          BUCKETS.answers,
          storagePath
        );

      const displayName =
        submission.file_original ||
        path.basename(
          download.usedPath ||
            storagePath
        ) ||
        "submission-file.pdf";

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
        download.buffer.length
      );

      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(
          displayName
        )}"`
      );

      res.setHeader(
        "Cache-Control",
        "private, no-cache, no-store, must-revalidate"
      );

      return res.send(
        download.buffer
      );
    } catch (
      err
    ) {
      console.error(
        "DOWNLOAD SUBMISSION ERROR:",
        err.message
      );

      if (
        !res.headersSent
      ) {
        return res.status(
          404
        ).json({
          error:
            "Submission file was not found in storage: " +
            err.message,
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
  uploadAnswer,
  async (
    req,
    res
  ) => {
    if (
      !req.file
    ) {
      return res.status(
        400
      ).json({
        error:
          "No file was uploaded.",
      });
    }

    let uploadedStoragePath =
      null;

    try {
      // ------------------------------------------------------
      // Get assignment
      // ------------------------------------------------------

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
        removeLocalFile(
          req.file
        );

        return res.status(
          404
        ).json({
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
          SELECT
            id

          FROM enrollments

          WHERE student_id = $1
            AND faculty_id = $2
            AND status =
                'accepted'

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
        removeLocalFile(
          req.file
        );

        return res.status(
          403
        ).json({
          error:
            "You are not enrolled under this faculty.",
        });
      }

      // ------------------------------------------------------
      // Check deadline
      // ------------------------------------------------------

      const dueTime =
        assignment.due_time ||
        "23:59:59";

      const dueDate =
        assignment.due_date &&
        assignment.due_date.toISOString
          ? assignment.due_date
              .toISOString()
              .split("T")[0]
          : String(
              assignment.due_date ||
                ""
            ).split("T")[0];

      const dueMs =
        new Date(
          `${dueDate}T${dueTime}`
        ).getTime();

      if (
        assignment.closed ===
          true ||
        assignment.closed ===
          1 ||
        (
          !Number.isNaN(
            dueMs
          ) &&
          dueMs <
            Date.now()
        )
      ) {
        removeLocalFile(
          req.file
        );

        return res.status(
          400
        ).json({
          error:
            "Submission deadline has passed.",
        });
      }

      // ------------------------------------------------------
      // Prevent duplicate submission
      // ------------------------------------------------------

      const existingResult =
        await db.query(
          `
          SELECT
            id

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
        removeLocalFile(
          req.file
        );

        return res.status(
          400
        ).json({
          error:
            "Assignment already submitted. Use modify to replace.",
        });
      }

      // ------------------------------------------------------
      // Upload to Supabase answers bucket
      // ------------------------------------------------------

      const uploaded =
        await uploadToSupabase(
          req.file,
          BUCKETS.answers
        );

      uploadedStoragePath =
        uploaded.path;

      // ------------------------------------------------------
      // Save submission
      // ------------------------------------------------------

      await db.query(
        `
        INSERT INTO submissions
        (
          assignment_id,
          student_id,
          file_path,
          file_original,
          file_size,
          submitted_at,
          graded,
          posted
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          CURRENT_TIMESTAMP,
          FALSE,
          FALSE
        )
        `,
        [
          assignment.id,
          req.user.id,
          uploaded.path,
          uploaded.originalName ||
            req.file.originalname,
          uploaded.size ||
            req.file.size ||
            req.file.buffer.length,
        ]
      );

      console.log(
        `[SUBMISSION] Student ${req.user.id} uploaded ${uploaded.path}`
      );

      return res.json({
        success:
          true,

        message:
          "Submission uploaded successfully.",

        submission: {
          fileName:
            uploaded.originalName ||
            req.file.originalname,

          size:
            uploaded.size,

          storage:
            "supabase",
        },
      });
    } catch (
      err
    ) {
      if (
        uploadedStoragePath
      ) {
        try {
          await deleteFromSupabase(
            BUCKETS.answers,
            uploadedStoragePath
          );
        } catch (
          cleanupError
        ) {
          console.error(
            "CLEANUP ANSWER FILE ERROR:",
            cleanupError.message
          );
        }
      }

      removeLocalFile(
        req.file
      );

      console.error(
        "STUDENT SUBMIT ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Failed to submit assignment: " +
          err.message,
      });
    }
  }
);

// ============================================================
// 7. REQUEST MODIFY OTP
// ============================================================

router.post(
  "/submissions/:submissionId/request-modify-otp",
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
            s.assignment_id,
            s.student_id,
            u.email,
            u.name

          FROM submissions s

          JOIN users u
            ON u.id =
               s.student_id

          WHERE s.id = $1
            AND s.student_id = $2
          `,
          [
            req.params.submissionId,
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

      const student =
        result.rows[0];

      if (
        !student.email ||
        !String(
          student.email
        ).trim()
      ) {
        return res.status(
          400
        ).json({
          error:
            "No registered email address found.",
        });
      }

      const otp =
        Math.floor(
          100000 +
            Math.random() *
              900000
        ).toString();

      const expiresAt =
        new Date(
          Date.now() +
            10 * 60 * 1000
        );

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

      await sendOtpEmail(
        student.email,
        otp,
        "modify_submission"
      );

      console.log(
        `[OTP] Modification OTP sent to ${student.email}`
      );

      return res.json({
        success:
          true,

        message:
          "OTP sent to your registered email address.",
      });
    } catch (
      err
    ) {
      console.error(
        "MODIFICATION OTP ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  uploadAnswer,
  async (
    req,
    res
  ) => {
    if (
      !req.file
    ) {
      return res.status(
        400
      ).json({
        error:
          "No replacement file provided.",
      });
    }

    const emailOtp =
      String(
        req.body.emailOtp ||
          ""
      ).trim();

    let newStoragePath =
      null;

    try {
      const userResult =
        await db.query(
          `
          SELECT
            email_otp,
            otp_expires_at

          FROM users

          WHERE id = $1
          `,
          [
            req.user.id,
          ]
        );

      if (
        !userResult.rows.length
      ) {
        removeLocalFile(
          req.file
        );

        return res.status(
          404
        ).json({
          error:
            "User not found.",
        });
      }

      const user =
        userResult.rows[0];

      if (
        !user.email_otp ||
        user.email_otp !==
          emailOtp
      ) {
        removeLocalFile(
          req.file
        );

        return res.status(
          400
        ).json({
          error:
            "Invalid OTP code.",
        });
      }

      if (
        !user.otp_expires_at ||
        new Date(
          user.otp_expires_at
        ).getTime() <
          Date.now()
      ) {
        removeLocalFile(
          req.file
        );

        return res.status(
          400
        ).json({
          error:
            "OTP code has expired.",
        });
      }

      const submissionResult =
        await db.query(
          `
          SELECT
            s.id,
            s.assignment_id,
            s.file_path,
            a.due_date,
            a.due_time,
            a.closed

          FROM submissions s

          JOIN assignments a
            ON a.id =
               s.assignment_id

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
        removeLocalFile(
          req.file
        );

        return res.status(
          404
        ).json({
          error:
            "Submission not found.",
        });
      }

      const submission =
        submissionResult.rows[0];

      const oldStoragePath =
        submission.file_path
          ? String(
              submission.file_path
            ).trim()
          : null;

      const dueTime =
        submission.due_time ||
        "23:59:59";

      const dueDate =
        submission.due_date &&
        submission.due_date.toISOString
          ? submission.due_date
              .toISOString()
              .split("T")[0]
          : String(
              submission.due_date ||
                ""
            ).split("T")[0];

      const dueMs =
        new Date(
          `${dueDate}T${dueTime}`
        ).getTime();

      if (
        submission.closed ===
          true ||
        submission.closed ===
          1 ||
        (
          !Number.isNaN(
            dueMs
          ) &&
          dueMs <
            Date.now()
        )
      ) {
        removeLocalFile(
          req.file
        );

        return res.status(
          400
        ).json({
          error:
            "Assignment deadline has passed.",
        });
      }

      const uploaded =
        await uploadToSupabase(
          req.file,
          BUCKETS.answers
        );

      newStoragePath =
        uploaded.path;

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
          posted = FALSE,
          final_marks = NULL,
          auto_marks = NULL,
          auto_feedback = NULL,
          similarity_pct = NULL,
          duplicate_flag = FALSE

        WHERE id = $4
          AND student_id = $5
        `,
        [
          uploaded.path,
          uploaded.originalName ||
            req.file.originalname,
          uploaded.size ||
            req.file.size ||
            req.file.buffer.length,
          req.params.submissionId,
          req.user.id,
        ]
      );

      if (
        oldStoragePath &&
        oldStoragePath !==
          newStoragePath
      ) {
        try {
          await deleteFromSupabase(
            BUCKETS.answers,
            oldStoragePath
          );
        } catch (
          deleteError
        ) {
          console.warn(
            "OLD ANSWER FILE DELETE WARNING:",
            deleteError.message
          );
        }
      }

      await db.query(
        `
        UPDATE users

        SET
          email_otp = NULL,
          otp_expires_at = NULL

        WHERE id = $1
        `,
        [
          req.user.id,
        ]
      );

      console.log(
        `[SUBMISSION MODIFY] Student ${req.user.id} replaced submission ${req.params.submissionId}`
      );

      return res.json({
        success:
          true,

        message:
          "Submission updated successfully.",
      });
    } catch (
      err
    ) {
      if (
        newStoragePath
      ) {
        try {
          await deleteFromSupabase(
            BUCKETS.answers,
            newStoragePath
          );
        } catch (
          cleanupError
        ) {
          console.error(
            "NEW ANSWER FILE CLEANUP ERROR:",
            cleanupError.message
          );
        }
      }

      removeLocalFile(
        req.file
      );

      console.error(
        "STUDENT MODIFY SUBMISSION ERROR:",
        err.message
      );

      return res.status(
        500
      ).json({
        error:
          "Failed to replace submission: " +
          err.message,
      });
    }
  }
);

// ============================================================
// 9. MY COURSES
// ============================================================

router.get(
  "/my-courses",
  async (
    req,
    res
  ) => {
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
            ON u.id =
               e.faculty_id

          WHERE e.student_id = $1

          ORDER BY
            e.id DESC
          `,
          [
            req.user.id,
          ]
        );

      return res.json(
        result.rows || []
      );
    } catch (
      err
    ) {
      console.error(
        "Student /my-courses error:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  async (
    req,
    res
  ) => {
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
            ON a.id =
               s.assignment_id

          JOIN users u
            ON u.id =
               a.faculty_id

          WHERE s.student_id = $1
            AND (
              s.posted = TRUE
              OR s.posted = 1::boolean
            )

          ORDER BY
            s.submitted_at DESC
          `,
          [
            req.user.id,
          ]
        );

      return res.json(
        result.rows || []
      );
    } catch (
      err
    ) {
      console.error(
        "Student /marks error:",
        err.message
      );

      return res.status(
        500
      ).json({
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
  async (
    req,
    res
  ) => {
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
            ON u.id =
               e.faculty_id

          JOIN enrollments en
            ON en.faculty_id =
               e.faculty_id
           AND en.student_id =
               $1
           AND en.status =
               'accepted'

          LEFT JOIN exam_attempts att
            ON att.exam_id =
               e.id
           AND att.student_id =
               $1

          ORDER BY
            e.exam_date DESC,
            e.start_time DESC
          `,
          [
            req.user.id,
          ]
        );

      return res.json(
        result.rows || []
      );
    } catch (
      err
    ) {
      console.error(
        "Student /exams error:",
        err.message
      );

      return res.status(
        500
      ).json({
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
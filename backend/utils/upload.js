// backend/utils/upload.js
//
// Supabase Storage upload utility with automatic local disk fallback.
//
// Buckets:
//    questions
//    answers
//    keys
//
// Required environment variables:
//
// SUPABASE_URL=https://your-project.supabase.co
// SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
//
// IMPORTANT:
// The service-role key is SERVER ONLY.
// NEVER put it in frontend JavaScript.
//

require("dotenv").config();

const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const {
  createClient,
} = require("@supabase/supabase-js");

// ============================================================
// CONFIGURATION
// ============================================================

const MAX_MB =
  Number(
    process.env.MAX_UPLOAD_MB || 15
  );

// ============================================================
// SUPABASE CONFIG
// ============================================================

const SUPABASE_URL =
  String(
    process.env.SUPABASE_URL || ""
  ).trim();

const SUPABASE_SERVICE_ROLE_KEY =
  String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      ""
  ).trim();

// ============================================================
// CONFIGURATION WARNINGS
// ============================================================

if (!SUPABASE_URL) {
  console.warn(
    "[Storage] SUPABASE_URL is not configured. Local disk fallback active."
  );
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[Storage] SUPABASE_SERVICE_ROLE_KEY is not configured. Local disk fallback active."
  );
}

// ============================================================
// SUPABASE SERVER CLIENT
// ============================================================
//
// This client runs ONLY on the backend.
// The service-role key is NEVER sent to the browser.
//

let supabase = null;

if (
  SUPABASE_URL &&
  SUPABASE_SERVICE_ROLE_KEY
) {
  try {
    supabase =
      createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
          },
        }
      );
  } catch (clientErr) {
    console.warn(
      "[Storage] Supabase client init error:",
      clientErr.message
    );
  }
}

// ============================================================
// BUCKET NAMES & LOCAL DIRECTORIES
// ============================================================

const BUCKETS = {
  answers: "answers",
  questions: "questions",
  keys: "keys",
};

// Ensure local upload mirror folders exist
Object.values(BUCKETS).forEach((folder) => {
  const dir = path.join(__dirname, "..", "uploads", folder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ============================================================
// UUID
// ============================================================

function getUuid() {
  if (
    typeof crypto.randomUUID ===
    "function"
  ) {
    return crypto.randomUUID();
  }

  return crypto
    .randomBytes(16)
    .toString("hex");
}

// ============================================================
// SAFE STORAGE FILE NAME
// ============================================================

function makeSafeFileName(
  originalName
) {
  const original =
    String(
      originalName || "file"
    );

  const extension =
    path
      .extname(original)
      .toLowerCase()
      .slice(0, 20);

  return (
    `${Date.now()}_${getUuid()}${extension}`
  );
}

// ============================================================
// MULTER MEMORY STORAGE
// ============================================================
//
// Files are temporarily kept in memory and then uploaded
// directly to Supabase Storage and mirrored locally.
//

const memoryStorage =
  multer.memoryStorage();

const baseUploader =
  multer({
    storage:
      memoryStorage,

    limits: {
      fileSize:
        MAX_MB *
        1024 *
        1024,
    },
  });

// ============================================================
// GET SUPABASE CLIENT
// ============================================================

function getSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return supabase;
}

// ============================================================
// VALIDATE BUCKET
// ============================================================

function getBucketName(
  bucket
) {
  const name =
    String(
      bucket || ""
    ).trim();

  if (
    !Object.values(
      BUCKETS
    ).includes(name)
  ) {
    throw new Error(
      `Invalid Supabase Storage bucket: ${name}`
    );
  }

  return name;
}

// ============================================================
// UPLOAD TO SUPABASE (WITH LOCAL DISK BACKUP)
// ============================================================

async function uploadToSupabase(
  file,
  bucket
) {
  if (!file) {
    throw new Error(
      "No file provided for Supabase Storage upload."
    );
  }

  if (
    !Buffer.isBuffer(
      file.buffer
    )
  ) {
    throw new Error(
      "Uploaded file buffer is missing."
    );
  }

  if (
    file.buffer.length === 0
  ) {
    throw new Error(
      "Uploaded file is empty."
    );
  }

  const bucketName =
    getBucketName(
      bucket
    );

  const fileName =
    makeSafeFileName(
      file.originalname
    );

  const storagePath =
    fileName;

  // ----------------------------------------------------------
  // 1. SAVE LOCAL DISK BACKUP
  // ----------------------------------------------------------

  try {
    const localDir =
      path.join(
        __dirname,
        "..",
        "uploads",
        bucketName
      );

    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(
        localDir,
        { recursive: true }
      );
    }

    fs.writeFileSync(
      path.join(
        localDir,
        fileName
      ),
      file.buffer
    );

    console.log(
      `[Storage] Saved local backup: uploads/${bucketName}/${fileName}`
    );
  } catch (fsErr) {
    console.warn(
      "[Storage] Local disk write warning:",
      fsErr.message
    );
  }

  // ----------------------------------------------------------
  // LOG UPLOAD INFORMATION
  // ----------------------------------------------------------

  console.log(
    "================================================"
  );

  console.log(
    "[Storage] UPLOAD START"
  );

  console.log(
    `[Storage] Supabase URL: ${SUPABASE_URL || "NOT SET"}`
  );

  console.log(
    `[Storage] Bucket: ${bucketName}`
  );

  console.log(
    `[Storage] Path: ${storagePath}`
  );

  console.log(
    `[Storage] Original file: ${file.originalname}`
  );

  console.log(
    `[Storage] MIME type: ${
      file.mimetype ||
      "application/octet-stream"
    }`
  );

  console.log(
    `[Storage] Size: ${file.buffer.length} bytes`
  );

  console.log(
    "================================================"
  );

  // ----------------------------------------------------------
  // 2. UPLOAD TO SUPABASE IF CONFIGURED
  // ----------------------------------------------------------

  let actualPath = storagePath;

  if (supabase) {
    try {
      const client = getSupabase();

      const {
        data,
        error,
      } =
        await client
          .storage
          .from(
            bucketName
          )
          .upload(
            storagePath,
            file.buffer,
            {
              contentType:
                file.mimetype ||
                "application/octet-stream",

              cacheControl:
                "3600",

              upsert:
                false,
            }
          );

      if (error) {
        console.warn(
          "[Storage] Supabase remote upload failed (using local backup):",
          error.message || error
        );
      } else {
        actualPath =
          data && data.path
            ? data.path
            : storagePath;

        console.log(
          `[Storage] Upload API reported success: ${bucketName}/${actualPath}`
        );

        // ----------------------------------------------------
        // VERIFY BY DOWNLOADING THE OBJECT
        // ----------------------------------------------------

        try {
          const {
            data: verifyData,
            error: verifyError,
          } =
            await client
              .storage
              .from(
                bucketName
              )
              .download(
                actualPath
              );

          if (verifyError || !verifyData) {
            console.warn(
              "[Storage] Verification download failed, relying on local backup:",
              verifyError ? verifyError.message : "No data"
            );
          } else {
            console.log(
              `[Storage] UPLOAD VERIFIED: ${bucketName}/${actualPath}`
            );
          }
        } catch (verifyEx) {
          console.warn(
            "[Storage] Verification exception:",
            verifyEx.message
          );
        }
      }
    } catch (supEx) {
      console.warn(
        "[Storage] Supabase upload exception (using local backup):",
        supEx.message
      );
    }
  }

  return {
    bucket:
      bucketName,

    path:
      actualPath,

    fileName:
      fileName,

    originalName:
      file.originalname,

    size:
      Number(
        file.size
      ) ||
      file.buffer.length,

    mimeType:
      file.mimetype ||
      "application/octet-stream",
  };
}

// ============================================================
// DOWNLOAD FROM SUPABASE (WITH LOCAL DISK FALLBACK)
// ============================================================

async function downloadFromSupabase(
  bucket,
  storagePath
) {
  const bucketName =
    getBucketName(
      bucket
    );

  const safePath =
    String(
      storagePath || ""
    )
      .replace(
        /\\/g,
        "/"
      )
      .trim();

  if (!safePath) {
    throw new Error(
      "Storage file path is required."
    );
  }

  const fileName =
    path.basename(safePath);

  // ----------------------------------------------------------
  // 1. TRY SUPABASE DOWNLOAD IF AVAILABLE
  // ----------------------------------------------------------

  if (supabase) {
    try {
      const client = getSupabase();

      console.log(
        `[Storage] DOWNLOAD ATTEMPT FROM SUPABASE: ${bucketName}/${safePath}`
      );

      const {
        data,
        error,
      } =
        await client
          .storage
          .from(
            bucketName
          )
          .download(
            safePath
          );

      if (!error && data) {
        const arrayBuffer =
          await data.arrayBuffer();

        const buffer =
          Buffer.from(
            arrayBuffer
          );

        if (buffer && buffer.length > 0) {
          console.log(
            `[Storage] DOWNLOAD SUCCESS FROM SUPABASE: ${bucketName}/${safePath} (${buffer.length} bytes)`
          );

          return buffer;
        }
      } else if (error) {
        console.warn(
          `[Storage] Supabase download failed (${bucketName}/${safePath}): ${error.message}. Checking local disk.`
        );
      }
    } catch (supErr) {
      console.warn(
        `[Storage] Supabase download error (${bucketName}/${safePath}): ${supErr.message}. Checking local disk.`
      );
    }
  }

  // ----------------------------------------------------------
  // 2. CHECK LOCAL DISK FALLBACK
  // ----------------------------------------------------------

  const localCandidates = [
    path.join(__dirname, "..", "uploads", bucketName, fileName),
    path.join(__dirname, "..", "uploads", bucketName, safePath),
    path.join(__dirname, "..", "uploads", safePath),
    path.join(__dirname, "..", safePath),
  ];

  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        const localBuffer =
          fs.readFileSync(candidate);

        if (
          localBuffer &&
          localBuffer.length > 0
        ) {
          console.log(
            `[Storage] DOWNLOAD SUCCESS FROM LOCAL DISK: ${candidate} (${localBuffer.length} bytes)`
          );

          return localBuffer;
        }
      } catch (readErr) {
        console.warn(
          `[Storage] Error reading local candidate ${candidate}:`,
          readErr.message
        );
      }
    }
  }

  throw new Error(
    `File was not found in Supabase Storage or local disk: ${bucketName}/${safePath}`
  );
}

// ============================================================
// DELETE FROM SUPABASE & LOCAL DISK
// ============================================================

async function deleteFromSupabase(
  bucket,
  storagePath
) {
  const bucketName =
    getBucketName(
      bucket
    );

  const safePath =
    String(
      storagePath || ""
    )
      .replace(
        /\\/g,
        "/"
      )
      .trim();

  if (!safePath) {
    return;
  }

  const fileName =
    path.basename(safePath);

  // 1. Remove local mirror copy
  const localCandidates = [
    path.join(__dirname, "..", "uploads", bucketName, fileName),
    path.join(__dirname, "..", "uploads", bucketName, safePath),
    path.join(__dirname, "..", "uploads", safePath),
  ];

  localCandidates.forEach((locPath) => {
    if (fs.existsSync(locPath)) {
      fs.unlink(locPath, () => {});
    }
  });

  // 2. Remove from Supabase
  if (supabase) {
    try {
      const client = getSupabase();

      await client
        .storage
        .from(bucketName)
        .remove([safePath]);

      console.log(
        `[Storage] Deleted ${bucketName}/${safePath} from Supabase`
      );
    } catch (err) {
      console.warn(
        "[Storage] Remote delete warning:",
        err.message
      );
    }
  }
}

// ============================================================
// CREATE SIGNED URL
// ============================================================

async function createSignedUrl(
  bucket,
  storagePath,
  expiresIn = 600
) {
  const client =
    getSupabase();

  const bucketName =
    getBucketName(
      bucket
    );

  const safePath =
    String(
      storagePath || ""
    )
      .replace(
        /\\/g,
        "/"
      )
      .trim();

  if (!safePath) {
    throw new Error(
      "Supabase Storage file path is required."
    );
  }

  const expiry =
    Math.max(
      60,
      Number(
        expiresIn
      ) || 600
    );

  const {
    data,
    error,
  } =
    await client
      .storage
      .from(
        bucketName
      )
      .createSignedUrl(
        safePath,
        expiry
      );

  if (error) {
    throw new Error(
      error.message ||
        "Could not create signed URL."
    );
  }

  if (
    !data ||
    !data.signedUrl
  ) {
    throw new Error(
      "Supabase did not return a signed URL."
    );
  }

  return data.signedUrl;
}

// ============================================================
// TEMPORARY FILE HELPERS
// ============================================================

async function saveTemporaryFile(
  buffer,
  originalName
) {
  if (
    !Buffer.isBuffer(buffer)
  ) {
    throw new Error(
      "Buffer is required."
    );
  }

  const tempDir =
    path.join(
      __dirname,
      "..",
      "tmp",
      "uploads"
    );

  if (
    !fs.existsSync(
      tempDir
    )
  ) {
    fs.mkdirSync(
      tempDir,
      {
        recursive:
          true,
      }
    );
  }

  const fileName =
    makeSafeFileName(
      originalName
    );

  const filePath =
    path.join(
      tempDir,
      fileName
    );

  await fs.promises.writeFile(
    filePath,
    buffer
  );

  return filePath;
}

async function deleteTemporaryFile(
  filePath
) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(
      filePath
    );
  } catch (err) {
    if (
      err.code !==
      "ENOENT"
    ) {
      console.warn(
        "[Storage] Could not remove temp file:",
        err.message
      );
    }
  }
}

// ============================================================
// MULTER MIDDLEWARE
// ============================================================

const uploadAnswer =
  baseUploader.single(
    "file"
  );

const uploadQuestion =
  baseUploader.single(
    "questionFile"
  );

const uploadKey =
  baseUploader.single(
    "keyFile"
  );

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  uploadAnswer,
  uploadQuestion,
  uploadKey,

  uploadToSupabase,
  downloadFromSupabase,
  deleteFromSupabase,

  createSignedUrl,

  saveTemporaryFile,
  deleteTemporaryFile,

  getSupabase,
  getBucketName,

  BUCKETS,

  MAX_MB,
};
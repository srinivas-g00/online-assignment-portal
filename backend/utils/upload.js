// backend/utils/upload.js
//
// Supabase Storage upload utility.
//
// Buckets:
//   questions
//   answers
//   keys
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
    process.env.MAX_UPLOAD_MB || 5
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
    "[Storage] SUPABASE_URL is not configured."
  );
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[Storage] SUPABASE_SERVICE_ROLE_KEY is not configured."
  );
}

// ============================================================
// SUPABASE SERVER CLIENT
// ============================================================
//
// This client runs ONLY on the backend.
//

let supabase = null;

if (
  SUPABASE_URL &&
  SUPABASE_SERVICE_ROLE_KEY
) {
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
}

// ============================================================
// BUCKET NAMES
// ============================================================

const BUCKETS = {
  answers: "answers",
  questions: "questions",
  keys: "keys",
};

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
// Files are kept in memory temporarily and then uploaded to
// Supabase Storage.
//
// This is important for Render because local disk should not be
// treated as permanent file storage.
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
// UPLOAD TO SUPABASE
// ============================================================
//
// file = req.file from multer.memoryStorage()
//
// Returns:
//
// {
//   bucket,
//   path,
//   fileName,
//   originalName,
//   size,
//   mimeType
// }
//

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

  const client =
    getSupabase();

  const bucketName =
    getBucketName(bucket);

  const fileName =
    makeSafeFileName(
      file.originalname
    );

  const storagePath =
    fileName;

  const {
    data,
    error,
  } =
    await client
      .storage
      .from(bucketName)
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
    console.error(
      "[Storage] Upload error:",
      error.message ||
        error
    );

    throw new Error(
      error.message ||
        "Could not upload file to Supabase Storage."
    );
  }

  console.log(
    `[Storage] Uploaded ${file.originalname} -> ${bucketName}/${storagePath}`
  );

  return {
    bucket:
      bucketName,

    path:
      data &&
      data.path
        ? data.path
        : storagePath,

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
// DOWNLOAD FROM SUPABASE
// ============================================================
//
// Used by the backend for:
//   - displaying protected files
//   - extracting text
//   - grading
//

async function downloadFromSupabase(
  bucket,
  storagePath
) {
  const client =
    getSupabase();

  const bucketName =
    getBucketName(bucket);

  const safePath =
    String(
      storagePath || ""
    ).trim();

  if (!safePath) {
    throw new Error(
      "Supabase Storage file path is required."
    );
  }

  const {
    data,
    error,
  } =
    await client
      .storage
      .from(bucketName)
      .download(
        safePath
      );

  if (error) {
    console.error(
      "[Storage] Download error:",
      error.message ||
        error
    );

    throw new Error(
      error.message ||
        "Could not download file from Supabase Storage."
    );
  }

  if (!data) {
    throw new Error(
      "Supabase returned an empty file."
    );
  }

  const arrayBuffer =
    await data.arrayBuffer();

  return Buffer.from(
    arrayBuffer
  );
}

// ============================================================
// DELETE FROM SUPABASE
// ============================================================

async function deleteFromSupabase(
  bucket,
  storagePath
) {
  const client =
    getSupabase();

  const bucketName =
    getBucketName(bucket);

  const safePath =
    String(
      storagePath || ""
    ).trim();

  if (!safePath) {
    return;
  }

  const {
    error,
  } =
    await client
      .storage
      .from(bucketName)
      .remove([
        safePath,
      ]);

  if (error) {
    console.error(
      "[Storage] Delete error:",
      error.message ||
        error
    );

    throw new Error(
      error.message ||
        "Could not delete file from Supabase Storage."
    );
  }

  console.log(
    `[Storage] Deleted ${bucketName}/${safePath}`
  );
}

// ============================================================
// CREATE SIGNED URL
// ============================================================
//
// Useful if you decide to give the browser temporary access
// to a private file.
//
// The service-role key is never exposed.
//

async function createSignedUrl(
  bucket,
  storagePath,
  expiresIn = 600
) {
  const client =
    getSupabase();

  const bucketName =
    getBucketName(bucket);

  const safePath =
    String(
      storagePath || ""
    ).trim();

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
      .from(bucketName)
      .createSignedUrl(
        safePath,
        expiry
      );

  if (error) {
    console.error(
      "[Storage] Signed URL error:",
      error.message ||
        error
    );

    throw new Error(
      error.message ||
        "Could not create signed URL."
    );
  }

  return (
    data &&
    data.signedUrl
      ? data.signedUrl
      : null
  );
}

// ============================================================
// TEMPORARY FILE HELPERS
// ============================================================
//
// These are optional utilities for older code that requires
// a physical file path.
//
// Permanent files remain in Supabase Storage.
//

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

// ============================================================
// DELETE TEMPORARY FILE
// ============================================================

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
//
// These names match your current routes.
//

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
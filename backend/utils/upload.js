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
// The service-role key is NEVER sent to the browser.
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
// Files are temporarily kept in memory and then uploaded
// directly to Supabase Storage.
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
// Uploads the file and then immediately downloads it back
// to verify that the object really exists.
//
// This prevents a false "upload successful" state.
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

  if (
    file.buffer.length === 0
  ) {
    throw new Error(
      "Uploaded file is empty."
    );
  }

  const client =
    getSupabase();

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
  // LOG UPLOAD INFORMATION
  // ----------------------------------------------------------

  console.log(
    "================================================"
  );

  console.log(
    "[Storage] UPLOAD START"
  );

  console.log(
    `[Storage] Supabase URL: ${SUPABASE_URL}`
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
  // UPLOAD
  // ----------------------------------------------------------

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
    console.error(
      "[Storage] UPLOAD FAILED:",
      error.message ||
        error
    );

    throw new Error(
      error.message ||
        "Could not upload file to Supabase Storage."
    );
  }

  const actualPath =
    data &&
    data.path
      ? data.path
      : storagePath;

  console.log(
    `[Storage] Upload API reported success: ${bucketName}/${actualPath}`
  );

  // ----------------------------------------------------------
  // VERIFY BY DOWNLOADING THE OBJECT
  // ----------------------------------------------------------

  let verificationBuffer =
    null;

  try {
    console.log(
      `[Storage] Verifying uploaded object: ${bucketName}/${actualPath}`
    );

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

    if (verifyError) {
      throw new Error(
        verifyError.message ||
          "Could not verify uploaded object."
      );
    }

    if (!verifyData) {
      throw new Error(
        "Supabase returned no object while verifying the upload."
      );
    }

    const arrayBuffer =
      await verifyData.arrayBuffer();

    verificationBuffer =
      Buffer.from(
        arrayBuffer
      );

    if (
      verificationBuffer.length ===
      0
    ) {
      throw new Error(
        "Supabase returned an empty object during upload verification."
      );
    }

    if (
      verificationBuffer.length !==
      file.buffer.length
    ) {
      throw new Error(
        `Upload verification size mismatch. Original: ${file.buffer.length} bytes, stored: ${verificationBuffer.length} bytes.`
      );
    }

    console.log(
      `[Storage] UPLOAD VERIFIED: ${bucketName}/${actualPath} (${verificationBuffer.length} bytes)`
    );
  } catch (verificationError) {
    console.error(
      "[Storage] UPLOAD VERIFICATION FAILED:",
      verificationError.message
    );

    // --------------------------------------------------------
    // Try removing an object that cannot be verified
    // --------------------------------------------------------

    try {
      await client
        .storage
        .from(
          bucketName
        )
        .remove([
          actualPath,
        ]);

      console.log(
        `[Storage] Removed unverified object: ${bucketName}/${actualPath}`
      );
    } catch (cleanupError) {
      console.error(
        "[Storage] Could not remove unverified object:",
        cleanupError.message
      );
    }

    throw new Error(
      `Supabase upload verification failed: ${verificationError.message}`
    );
  }

  console.log(
    "================================================"
  );

  console.log(
    "[Storage] UPLOAD COMPLETE"
  );

  console.log(
    `Bucket: ${bucketName}`
  );

  console.log(
    `Path: ${actualPath}`
  );

  console.log(
    "================================================"
  );

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
// DOWNLOAD FROM SUPABASE
// ============================================================

async function downloadFromSupabase(
  bucket,
  storagePath
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

  console.log(
    `[Storage] DOWNLOAD: ${bucketName}/${safePath}`
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

  if (error) {
    console.error(
      `[Storage] DOWNLOAD FAILED: ${bucketName}/${safePath}`,
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

  const buffer =
    Buffer.from(
      arrayBuffer
    );

  if (
    buffer.length ===
    0
  ) {
    throw new Error(
      "Supabase returned a zero-byte file."
    );
  }

  console.log(
    `[Storage] DOWNLOAD SUCCESS: ${bucketName}/${safePath} (${buffer.length} bytes)`
  );

  return buffer;
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

  const {
    error,
  } =
    await client
      .storage
      .from(
        bucketName
      )
      .remove([
        safePath,
      ]);

  if (error) {
    console.error(
      "[Storage] DELETE ERROR:",
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
    console.error(
      "[Storage] SIGNED URL ERROR:",
      error.message ||
        error
    );

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
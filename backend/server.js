// backend/server.js

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

require("./config/db"); // Supabase PostgreSQL pool

const authRoutes = require("./routes/authRoutes");
const studentRoutes = require("./routes/studentRoutes");
const facultyRoutes = require("./routes/facultyRoutes");
const examRoutes = require("./routes/examRoutes");

const scheduler = require("./jobs/scheduler");

const app = express();

// =====================================================
// 1. CREATE REQUIRED UPLOAD FOLDERS
// =====================================================

const uploadDirs = [
  "answers",
  "questions",
  "keys",
];

uploadDirs.forEach((dir) => {
  const fullPath = path.join(
    __dirname,
    "uploads",
    dir
  );

  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, {
      recursive: true,
    });
  }
});

// =====================================================
// 2. CORS
// =====================================================

app.use(
  cors({
    origin:
      process.env.FRONTEND_URL ||
      "http://localhost:5000",

    credentials: true,
  })
);

// =====================================================
// 3. BODY PARSING
// =====================================================

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  })
);

// =====================================================
// 4. SERVE UPLOADED FILES
// =====================================================
//
// IMPORTANT:
// This MUST come BEFORE the frontend fallback.
//
// This allows:
// /uploads/questions/file.pdf
// /uploads/questions/file.docx
// /uploads/answers/file.pdf
// /uploads/keys/file.pdf
//
// to access the actual uploaded files instead of
// receiving index.html.
//

app.use(
  "/uploads",
  express.static(
    path.join(
      __dirname,
      "uploads"
    )
  )
);

// =====================================================
// 5. SERVE FRONTEND
// =====================================================

const frontendPath = path.join(
  __dirname,
  "..",
  "frontend"
);

app.use(
  express.static(frontendPath)
);

// =====================================================
// 6. API ROUTES
// =====================================================

app.use(
  "/api/auth",
  authRoutes
);

app.use(
  "/api/student",
  studentRoutes
);

app.use(
  "/api/faculty",
  facultyRoutes
);

app.use(
  "/api/exams",
  examRoutes
);

// =====================================================
// 7. HEALTH CHECK
// =====================================================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
  });
});

// =====================================================
// 8. FRONTEND FALLBACK
// =====================================================
//
// IMPORTANT:
// Do NOT send index.html for /uploads requests.
//
// /uploads has already been handled above.
//
// Only normal frontend pages should reach this.
//

app.get(
  /^\/(?!api(?:\/|$)|uploads(?:\/|$)).*/,
  (req, res) => {
    res.sendFile(
      path.join(
        frontendPath,
        "index.html"
      )
    );
  }
);

// =====================================================
// 9. CENTRAL ERROR HANDLER
// =====================================================

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    const maxMb =
      process.env.MAX_UPLOAD_MB ||
      5;

    // Multer file-size error
    if (
      err &&
      err.code ===
        "LIMIT_FILE_SIZE"
    ) {
      return res.status(400).json({
        error:
          `File is too large. Maximum allowed size is ${maxMb}MB.`,
      });
    }

    console.error(
      "Server error:",
      err.message || err
    );

    res.status(500).json({
      error:
        "Something went wrong on the server.",
    });
  }
);

// =====================================================
// 10. START SERVER
// =====================================================

const PORT =
  process.env.PORT || 5000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Online Assignment Portal running on port ${PORT}`
    );

    scheduler.start();
  }
);
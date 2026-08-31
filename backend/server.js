// backend/server.js

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

require("./config/db");

const authRoutes = require("./routes/authRoutes");
const studentRoutes = require("./routes/studentRoutes");
const facultyRoutes = require("./routes/facultyRoutes");
const examRoutes = require("./routes/examRoutes");
const scheduler = require("./jobs/scheduler");

const app = express();

// =====================================================
// 1. PORT
// =====================================================

const PORT =
  Number(process.env.PORT) || 5000;

// =====================================================
// 2. CORS
// =====================================================
//
// Same-origin deployment on Render does not require CORS,
// but keeping it enabled makes local development easier.
//
// FRONTEND_URL example:
// https://your-app.onrender.com
//
// For local development:
// http://localhost:5000
//

const allowedOrigin =
  process.env.FRONTEND_URL ||
  `http://localhost:${PORT}`;

app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

// =====================================================
// 3. BODY PARSING
// =====================================================

app.use(
  express.json({
    limit: "2mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb",
  })
);

// =====================================================
// 4. BASIC SECURITY / CACHE HEADERS
// =====================================================

app.disable("x-powered-by");

app.use(
  (req, res, next) => {
    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    res.setHeader(
      "X-Frame-Options",
      "SAMEORIGIN"
    );

    next();
  }
);

// =====================================================
// 5. FRONTEND PATH
// =====================================================

const frontendPath =
  path.join(
    __dirname,
    "..",
    "frontend"
  );

// =====================================================
// 6. SERVE FRONTEND
// =====================================================
//
// The frontend is committed to Git and can therefore be
// served normally by the Render web service.
//

app.use(
  express.static(
    frontendPath,
    {
      index: false,
      maxAge: "1h",
    }
  )
);

// =====================================================
// 7. API ROUTES
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
// 8. HEALTH CHECK
// =====================================================

app.get(
  "/api/health",
  (req, res) => {
    return res.status(200).json({
      ok: true,
      service:
        "Online Assignment Portal",
      time:
        new Date().toISOString(),
      environment:
        process.env.NODE_ENV ||
        "development",
    });
  }
);

// =====================================================
// 9. FRONTEND FALLBACK
// =====================================================
//
// IMPORTANT:
//
// Do NOT return index.html for API requests.
//
// API errors should remain JSON.
//
// Only normal browser page requests should reach
// the frontend fallback.
//

app.get(
  /^\/(?!api(?:\/|$)).*$/,
  (req, res) => {
    return res.sendFile(
      path.join(
        frontendPath,
        "index.html"
      )
    );
  }
);

// =====================================================
// 10. 404 FOR UNKNOWN API ROUTES
// =====================================================

app.use(
  "/api",
  (req, res) => {
    return res.status(404).json({
      error:
        "API endpoint not found.",
    });
  }
);

// =====================================================
// 11. CENTRAL ERROR HANDLER
// =====================================================

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      "================================================"
    );

    console.error(
      "[SERVER ERROR]"
    );

    console.error(
      "Method:",
      req.method
    );

    console.error(
      "Path:",
      req.path
    );

    console.error(
      "Error:",
      err &&
        (err.message ||
          err)
    );

    console.error(
      "================================================"
    );

    // -------------------------------------------------
    // Multer file-size error
    // -------------------------------------------------

    if (
      err &&
      err.code ===
        "LIMIT_FILE_SIZE"
    ) {
      const maxMb =
        Number(
          process.env.MAX_UPLOAD_MB
        ) || 5;

      return res.status(400).json({
        error:
          `File is too large. Maximum allowed size is ${maxMb}MB.`,
      });
    }

    // -------------------------------------------------
    // Malformed JSON
    // -------------------------------------------------

    if (
      err &&
      (
        err.type ===
          "entity.parse.failed" ||
        err instanceof
          SyntaxError
      )
    ) {
      return res.status(400).json({
        error:
          "Invalid JSON request.",
      });
    }

    // -------------------------------------------------
    // Default error
    // -------------------------------------------------

    return res.status(500).json({
      error:
        process.env.NODE_ENV ===
        "production"
          ? "Something went wrong on the server."
          : (
              err &&
              err.message
            ) ||
            "Something went wrong on the server.",
    });
  }
);

// =====================================================
// 12. START SERVER
// =====================================================

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        "================================================"
      );

      console.log(
        "Online Assignment Portal"
      );

      console.log(
        `Server running on port ${PORT}`
      );

      console.log(
        `Environment: ${
          process.env.NODE_ENV ||
          "development"
        }`
      );

      console.log(
        "================================================"
      );

      // -------------------------------------------------
      // Start scheduler
      // -------------------------------------------------

      try {
        if (
          scheduler &&
          typeof scheduler.start ===
            "function"
        ) {
          scheduler.start();

          console.log(
            "[Scheduler] Started successfully."
          );
        } else {
          console.warn(
            "[Scheduler] start() not available."
          );
        }
      } catch (schedulerError) {
        console.error(
          "[Scheduler] Failed to start:",
          schedulerError.message
        );
      }
    }
  );

// =====================================================
// 13. GRACEFUL SHUTDOWN
// =====================================================

function shutdown(
  signal
) {
  console.log(
    `[Server] ${signal} received. Shutting down...`
  );

  server.close(
    () => {
      console.log(
        "[Server] HTTP server closed."
      );

      process.exit(0);
    }
  );
}

process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);

// =====================================================
// 14. UNHANDLED ERRORS
// =====================================================

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "[UNHANDLED REJECTION]",
      reason
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "[UNCAUGHT EXCEPTION]",
      error
    );
  }
);
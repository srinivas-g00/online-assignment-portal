// scripts/init-db.js
// Convenience script: applies database/schema.sql to your MySQL server so
// you don't have to leave VS Code / use the mysql CLI. Run with:
//   npm run init-db
// This is the same file as running: mysql -u root -p < database/schema.sql
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function main() {
  const schemaPath = path.join(__dirname, "..", "database", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true, // needed to run the whole schema.sql in one go
  });

  console.log("Applying database/schema.sql ...");
  try {
    await connection.query(sql);
    console.log("Done. Database and tables are ready.");
  } catch (err) {
    if (err.code === "ER_DUP_KEYNAME") {
      console.log("Tables already existed - indexes were already created. That's fine.");
    } else {
      console.error("Failed to apply schema.sql:", err.message);
      process.exitCode = 1;
    }
  } finally {
    await connection.end();
  }
}

main();

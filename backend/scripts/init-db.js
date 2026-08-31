// backend/scripts/init-db.js

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing from .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function main() {
  const schemaPath = path.join(
    __dirname,
    "..",
    "database",
    "schema.sql"
  );

  if (!fs.existsSync(schemaPath)) {
    console.error("schema.sql not found:");
    console.error(schemaPath);
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, "utf8");

  console.log("Connecting to Supabase PostgreSQL...");
  
  const client = await pool.connect();

  try {
    console.log("Connected to Supabase PostgreSQL.");
    console.log("Applying database/schema.sql ...");

    await client.query("BEGIN");

    await client.query(sql);

    await client.query("COMMIT");

    console.log("Done. Database and tables are ready.");
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("Failed to apply schema.sql:");
    console.error(err.message);

    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
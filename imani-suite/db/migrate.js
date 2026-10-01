// Creates the database tables if they don't already exist. Every statement
// in schema.sql is IF NOT EXISTS, so this is safe to run every time the app
// boots (see src/server.js) as well as by hand.
const fs = require("fs");
const path = require("path");

async function migrate(pool) {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
}

module.exports = { migrate };

// Still runnable directly: `npm run db:migrate`
if (require.main === module) {
  require("dotenv").config();
  const { Pool } = require("pg");
  (async () => {
    if (!process.env.DATABASE_URL) {
      console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in first.");
      process.exit(1);
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await migrate(pool);
      console.log("Database is up to date.");
    } catch (err) {
      console.error("Migration failed:", err.message);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}

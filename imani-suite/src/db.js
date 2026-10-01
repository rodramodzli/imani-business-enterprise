const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on("error", (err) => {
  // A background/idle client error should not crash the whole server.
  console.error("Unexpected database error:", err.message);
});

module.exports = { pool };

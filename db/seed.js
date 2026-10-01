// Creates (or resets the password for) the first login, and pre-loads a
// starter service catalog spanning Imani's four service lines so there's a
// usable structure on day one — real rates need to be entered from the
// Services screen (left at a sensible placeholder here, not guessed).
// Usable two ways:
//   - as a CLI script: `npm run db:seed` (for local dev)
//   - as a module: `require("./seed").seed(pool, { username, password })`
//     (used automatically by src/server.js on startup — Render's free tier
//     has no Shell access to run this by hand)
const bcrypt = require("bcryptjs");

const DEFAULT_SERVICES = [
  // Cleaning Services
  { name: "Office cleaning — daily", industry: "cleaning", unit: "per month" },
  { name: "Office deep clean", industry: "cleaning", unit: "per clean" },
  { name: "Carpet & upholstery cleaning", industry: "cleaning", unit: "per clean" },
  { name: "Window cleaning", industry: "cleaning", unit: "per clean" },
  { name: "Post-construction clean", industry: "cleaning", unit: "per clean" },
  // Hygiene Services
  { name: "Washroom hygiene service", industry: "hygiene", unit: "per month" },
  { name: "Sanitary bin service", industry: "hygiene", unit: "per month" },
  { name: "Air freshener & dispenser service", industry: "hygiene", unit: "per month" },
  { name: "Sanitisation / fogging treatment", industry: "hygiene", unit: "per treatment" },
  // Pest Control Services
  { name: "General pest control treatment", industry: "pest_control", unit: "per treatment" },
  { name: "Fumigation", industry: "pest_control", unit: "per treatment" },
  { name: "Rodent control programme", industry: "pest_control", unit: "per month" },
  { name: "Termite treatment", industry: "pest_control", unit: "per treatment" },
  // Security Services
  { name: "Security guard — 12hr shift", industry: "security", unit: "per guard/shift" },
  { name: "Armed response monitoring", industry: "security", unit: "per month" },
  { name: "CCTV installation & monitoring", industry: "security", unit: "per site/month" },
  { name: "Access control management", industry: "security", unit: "per site/month" },
];

async function seed(pool, { username, password } = {}) {
  username = username || process.env.ADMIN_USERNAME;
  password = password || process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set.");
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD should be at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [username, passwordHash]
  );

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM services");
  let servicesSeeded = 0;
  if (rows[0].count === 0) {
    for (const s of DEFAULT_SERVICES) {
      await pool.query(
        `INSERT INTO services (name, industry, unit, default_rate) VALUES ($1, $2, $3, 0)`,
        [s.name, s.industry, s.unit]
      );
    }
    servicesSeeded = DEFAULT_SERVICES.length;
  }

  return { username, servicesSeeded, existingServiceCount: rows[0].count };
}

module.exports = { seed };

// Still runnable directly: `npm run db:seed`
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
      const result = await seed(pool, {
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD,
      });
      console.log(`Login ready — username: "${result.username}"`);
      if (result.servicesSeeded) {
        console.log(`Seeded ${result.servicesSeeded} starter services (rates are 0 — set your real rates from the Services screen).`);
      } else {
        console.log(`Service catalog already has ${result.existingServiceCount} entries — left as is.`);
      }
    } catch (err) {
      console.error("Seed failed:", err.message);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}

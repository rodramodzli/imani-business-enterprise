require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

const { pool } = require("./db");
const { migrate } = require("../db/migrate");
const { seed } = require("../db/seed");
const { router: authRouter, requireAuth } = require("./auth");
const customersRouter = require("./routes/customers");
const servicesRouter = require("./routes/services");
const quotesRouter = require("./routes/quotes");
const contractsRouter = require("./routes/contracts");
const libraryRouter = require("./routes/library");
const dashboardRouter = require("./routes/dashboard");

const app = express();
const PUBLIC_DIR = path.join(__dirname, "..", "public");

app.disable("x-powered-by");
app.set("trust proxy", 1); // needed so req.ip / secure cookies work behind Render's proxy

app.use(express.json());
app.use(cookieParser());

// API routes
app.use("/api/auth", authRouter);
app.use("/api/customers", requireAuth, customersRouter);
app.use("/api/services", requireAuth, servicesRouter);
app.use("/api/quotes", requireAuth, quotesRouter);
app.use("/api/contracts", requireAuth, contractsRouter);
app.use("/api/library", requireAuth, libraryRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);

// Static assets (CSS/JS/logo) — safe to serve to anyone, they contain no data.
app.use(express.static(PUBLIC_DIR, { index: false }));

function isAuthed(req) {
  const token = req.cookies && req.cookies.session;
  if (!token) return false;
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

app.get("/login", (req, res) => {
  if (isAuthed(req)) return res.redirect("/");
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/", (req, res) => {
  if (!isAuthed(req)) return res.redirect("/login");
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Set up the database automatically on boot — creates tables if they don't
// exist yet, and creates/updates the login. Both are safe to run on every
// restart: migrate() only uses CREATE TABLE IF NOT EXISTS, and the user
// upsert uses ON CONFLICT. This matters because Render's free tier has no
// Shell access to run `npm run db:migrate && npm run db:seed` by hand.
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function setupDatabase() {
  // A free-tier Neon database goes to sleep after 5 minutes idle and can take
  // a few seconds to wake back up, so the very first connection attempt after
  // a cold start may fail — retry a few times with a short backoff before
  // giving up, rather than treating a slow wake-up as a hard failure.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await migrate(pool);
      console.log("Database schema is up to date.");
      break;
    } catch (err) {
      console.error(`Database migration attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err.message);
      if (attempt === MAX_ATTEMPTS) {
        console.error("Giving up on database setup for now — the app will still start, but nothing will work until the database is reachable. It will retry on the next restart.");
        return;
      }
      await sleep(attempt * 2000);
    }
  }

  try {
    const result = await seed(pool, {
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
    });
    console.log(`Login ready — username: "${result.username}"`);
    if (result.servicesSeeded) {
      console.log(`Seeded ${result.servicesSeeded} starter services into the catalog (rates are 0 — set your real rates from the Services screen).`);
    }
  } catch (err) {
    // Don't crash the whole app over seeding — the tables exist either way,
    // and a missing ADMIN_USERNAME/PASSWORD just means no login was created yet.
    console.error("Database seed step failed (app will still start):", err.message);
  }
}

const PORT = process.env.PORT || 3000;
setupDatabase().finally(() => {
  app.listen(PORT, () => {
    console.log(`Imani Business Enterprise running on http://localhost:${PORT}`);
  });
});

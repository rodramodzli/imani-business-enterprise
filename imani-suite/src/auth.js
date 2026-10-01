const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("./db");

const COOKIE_NAME = "session";
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "change-this-to-a-long-random-string") {
  console.warn(
    "WARNING: JWT_SECRET is missing or still the example value. " +
    "Set a real random JWT_SECRET in .env before deploying."
  );
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  };
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not signed in." });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    res.clearCookie(COOKIE_NAME, cookieOptions());
    return res.status(401).json({ error: "Your session expired — please sign in again." });
  }
}

// Very small in-memory brute-force guard. Resets on server restart, and
// doesn't share state across multiple server instances — good enough for a
// single small internal tool, not a substitute for a real rate limiter if
// this ever needs to withstand serious abuse.
const attempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  const now = Date.now();
  if (!rec || now > rec.resetAt) return false;
  return rec.count >= MAX_ATTEMPTS;
}
function recordAttempt(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    rec.count += 1;
  }
}
function clearAttempts(ip) {
  attempts.delete(ip);
}

const router = express.Router();

router.post("/login", async (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    const user = rows[0];
    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!ok) {
      recordAttempt(ip);
      return res.status(401).json({ error: "Incorrect username or password." });
    }
    clearAttempts(ip);

    const token = jwt.sign({ sub: user.id, username: user.username }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ ok: true, username: user.username });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Something went wrong signing you in." });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

module.exports = { router, requireAuth };

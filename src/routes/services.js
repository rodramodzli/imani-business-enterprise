const express = require("express");
const { pool } = require("../db");

const router = express.Router();
const INDUSTRIES = ["cleaning", "hygiene", "pest_control", "security", "other"];

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

// GET /api/services?industry=&includeInactive=1
router.get("/", async (req, res) => {
  const { industry, includeInactive } = req.query;
  const clauses = [];
  const params = [];
  if (!includeInactive) clauses.push("active = true");
  if (industry) {
    if (!INDUSTRIES.includes(industry)) return badRequest(res, "Unknown industry.");
    params.push(industry);
    clauses.push(`industry = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(`SELECT * FROM services ${where} ORDER BY industry, name`, params);
    res.json(rows);
  } catch (err) {
    console.error("List services error:", err.message);
    res.status(500).json({ error: "Could not load the service catalog." });
  }
});

// POST /api/services
router.post("/", async (req, res) => {
  const { name, industry, unit, default_rate, notes } = req.body || {};
  if (!name || !name.trim()) return badRequest(res, "A service name is required.");
  if (!industry || !INDUSTRIES.includes(industry)) return badRequest(res, "A valid industry is required.");
  try {
    const { rows } = await pool.query(
      `INSERT INTO services (name, industry, unit, default_rate, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name.trim(), industry, unit || "service", default_rate || 0, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Create service error:", err.message);
    res.status(500).json({ error: "Could not add that service." });
  }
});

// PATCH /api/services/:id
router.patch("/:id", async (req, res) => {
  const fields = ["name", "industry", "unit", "default_rate", "active", "notes"];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
      let val = req.body[f];
      if (f === "industry" && val && !INDUSTRIES.includes(val)) return badRequest(res, "Unknown industry.");
      params.push(val);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) return badRequest(res, "Nothing to update.");
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE services SET ${updates.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: "Service not found." });
    res.json(rows[0]);
  } catch (err) {
    console.error("Update service error:", err.message);
    res.status(500).json({ error: "Could not update that service." });
  }
});

// DELETE /api/services/:id
router.delete("/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM services WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Service not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete service error:", err.message);
    res.status(500).json({ error: "Could not delete that service." });
  }
});

module.exports = router;

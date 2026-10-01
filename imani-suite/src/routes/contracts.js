const express = require("express");
const { pool } = require("../db");

const router = express.Router();

// Read-only, cross-customer views of the contracts table. Creating,
// editing and deleting a contract happens through its customer record
// (POST/PATCH/DELETE /api/customers/:id/contracts/...) since a contract
// always belongs to exactly one customer — this router exists so the
// Contracts screen can show everything in one list without having to loop
// over every customer first.

// GET /api/contracts?status=&q=
router.get("/", async (req, res) => {
  const { status, q } = req.query;
  const clauses = [];
  const params = [];
  if (status) {
    if (!["active", "expired", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Unknown status." });
    }
    params.push(status);
    clauses.push(`ct.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(ct.title ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT ct.*, c.name AS customer_name, c.industry AS customer_industry
       FROM contracts ct JOIN customers c ON c.id = ct.customer_id
       ${where}
       ORDER BY ct.end_date NULLS LAST, ct.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("List contracts error:", err.message);
    res.status(500).json({ error: "Could not load contracts." });
  }
});

module.exports = router;

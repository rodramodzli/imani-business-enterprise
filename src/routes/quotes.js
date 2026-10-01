const express = require("express");
const { pool } = require("../db");
const { renderQuotePdf, computeTotals } = require("../pdf");

const router = express.Router();

const STATUSES = ["draft", "sent", "accepted", "rejected", "expired"];
const FREQUENCIES = ["once_off", "weekly", "monthly", "quarterly", "annual"];

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

async function getQuoteWithItems(id) {
  const { rows } = await pool.query(
    `SELECT q.*, c.name AS customer_name, c.industry AS customer_industry,
            c.country AS customer_country, c.location AS customer_location,
            c.email AS customer_email, c.phone AS customer_phone
     FROM quotes q JOIN customers c ON c.id = q.customer_id
     WHERE q.id = $1`,
    [id]
  );
  const quote = rows[0];
  if (!quote) return null;
  const items = await pool.query(
    "SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order, id",
    [id]
  );
  return { ...quote, items: items.rows, totals: computeTotals(quote, items.rows) };
}

// GET /api/quotes?status=&q=&customer_id=
router.get("/", async (req, res) => {
  const { status, q, customer_id } = req.query;
  const clauses = [];
  const params = [];
  if (status) {
    if (!STATUSES.includes(status)) return badRequest(res, "Unknown status.");
    params.push(status);
    clauses.push(`q.status = $${params.length}`);
  }
  if (customer_id) {
    params.push(customer_id);
    clauses.push(`q.customer_id = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(c.name ILIKE $${params.length} OR q.quote_number ILIKE $${params.length})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT q.*, c.name AS customer_name, c.industry AS customer_industry,
        COALESCE(SUM(i.quantity * i.rate), 0) AS subtotal,
        COUNT(i.id)::int AS item_count
       FROM quotes q
       JOIN customers c ON c.id = q.customer_id
       LEFT JOIN quote_items i ON i.quote_id = q.id
       ${where}
       GROUP BY q.id, c.name, c.industry
       ORDER BY q.created_at DESC`,
      params
    );
    const withTotals = rows.map((r) => {
      const t = computeTotals(r, [{ quantity: 1, rate: r.subtotal }]);
      return { ...r, total: t.total };
    });
    res.json(withTotals);
  } catch (err) {
    console.error("List quotes error:", err.message);
    res.status(500).json({ error: "Could not load quotes." });
  }
});

// GET /api/quotes/:id
router.get("/:id", async (req, res) => {
  try {
    const quote = await getQuoteWithItems(req.params.id);
    if (!quote) return res.status(404).json({ error: "Quote not found." });
    res.json(quote);
  } catch (err) {
    console.error("Get quote error:", err.message);
    res.status(500).json({ error: "Could not load that quote." });
  }
});

// GET /api/quotes/:id/pdf
router.get("/:id/pdf", async (req, res) => {
  try {
    const quote = await getQuoteWithItems(req.params.id);
    if (!quote) return res.status(404).json({ error: "Quote not found." });
    renderQuotePdf(res, quote, quote.items);
  } catch (err) {
    console.error("PDF error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Could not generate the PDF." });
  }
});

// POST /api/quotes — create a new quote for an existing customer
router.post("/", async (req, res) => {
  const { customer_id, deal_id, payment_terms, site_notes, callout_fee, vat_pct, valid_until } = req.body || {};
  if (!customer_id) return badRequest(res, "A customer is required.");
  try {
    const customerCheck = await pool.query("SELECT id FROM customers WHERE id = $1", [customer_id]);
    if (!customerCheck.rows[0]) return badRequest(res, "That customer doesn't exist.");

    const inserted = await pool.query(
      `INSERT INTO quotes (customer_id, deal_id, payment_terms, site_notes, callout_fee, vat_pct, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        customer_id, deal_id || null, payment_terms || null, site_notes || null,
        callout_fee || 0, vat_pct != null && vat_pct !== "" ? vat_pct : null, valid_until || null,
      ]
    );
    const quote = inserted.rows[0];
    const year = new Date(quote.created_at).getFullYear();
    const quoteNumber = `IQ-${year}-${String(quote.id).padStart(4, "0")}`;
    await pool.query("UPDATE quotes SET quote_number = $1 WHERE id = $2", [quoteNumber, quote.id]);

    // Moving a prospect past "new" the moment a quote exists for them.
    await pool.query(
      `UPDATE customers SET stage = CASE WHEN stage IN ('new','contacted','in_conversation') THEN 'quoted' ELSE stage END, updated_at = now() WHERE id = $1`,
      [customer_id]
    );

    res.status(201).json(await getQuoteWithItems(quote.id));
  } catch (err) {
    console.error("Create quote error:", err.message);
    res.status(500).json({ error: "Could not create that quote." });
  }
});

// PATCH /api/quotes/:id
router.patch("/:id", async (req, res) => {
  const fields = ["deal_id", "status", "valid_until", "payment_terms", "site_notes", "callout_fee", "vat_pct"];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
      let val = req.body[f];
      if (f === "status" && val && !STATUSES.includes(val)) return badRequest(res, "Unknown status.");
      if (val === "") val = null;
      params.push(val);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) return badRequest(res, "Nothing to update.");
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE quotes SET ${updates.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: "Quote not found." });

    if (req.body.status === "accepted") {
      await pool.query(`UPDATE customers SET stage = 'won', updated_at = now() WHERE id = $1`, [rows[0].customer_id]);
    }

    res.json(await getQuoteWithItems(req.params.id));
  } catch (err) {
    console.error("Update quote error:", err.message);
    res.status(500).json({ error: "Could not update that quote." });
  }
});

// DELETE /api/quotes/:id
router.delete("/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM quotes WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Quote not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete quote error:", err.message);
    res.status(500).json({ error: "Could not delete that quote." });
  }
});

// POST /api/quotes/:id/items — service + frequency + rate line item
router.post("/:id/items", async (req, res) => {
  const { service_id, service_name, frequency, quantity, rate } = req.body || {};
  if (!service_name || rate == null) {
    return badRequest(res, "service_name and rate are required.");
  }
  if (frequency && !FREQUENCIES.includes(frequency)) return badRequest(res, "Unknown frequency.");
  try {
    const quoteCheck = await pool.query("SELECT id FROM quotes WHERE id = $1", [req.params.id]);
    if (!quoteCheck.rows[0]) return res.status(404).json({ error: "Quote not found." });

    const countRes = await pool.query("SELECT COUNT(*)::int AS c FROM quote_items WHERE quote_id = $1", [req.params.id]);
    await pool.query(
      `INSERT INTO quote_items (quote_id, service_id, service_name, frequency, quantity, rate, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.params.id, service_id || null, service_name, frequency || "once_off", quantity || 1, rate, countRes.rows[0].c]
    );
    await pool.query("UPDATE quotes SET updated_at = now() WHERE id = $1", [req.params.id]);
    res.status(201).json(await getQuoteWithItems(req.params.id));
  } catch (err) {
    console.error("Add item error:", err.message);
    res.status(500).json({ error: "Could not add that line item." });
  }
});

// PATCH /api/quotes/:quoteId/items/:itemId
router.patch("/:quoteId/items/:itemId", async (req, res) => {
  const fields = ["service_name", "frequency", "quantity", "rate"];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
      let val = req.body[f];
      if (f === "frequency" && val && !FREQUENCIES.includes(val)) return badRequest(res, "Unknown frequency.");
      params.push(val);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) return badRequest(res, "Nothing to update.");
  params.push(req.params.itemId, req.params.quoteId);
  try {
    const { rowCount } = await pool.query(
      `UPDATE quote_items SET ${updates.join(", ")} WHERE id = $${params.length - 1} AND quote_id = $${params.length}`,
      params
    );
    if (!rowCount) return res.status(404).json({ error: "Line item not found." });
    await pool.query("UPDATE quotes SET updated_at = now() WHERE id = $1", [req.params.quoteId]);
    res.json(await getQuoteWithItems(req.params.quoteId));
  } catch (err) {
    console.error("Update item error:", err.message);
    res.status(500).json({ error: "Could not update that line item." });
  }
});

// DELETE /api/quotes/:quoteId/items/:itemId
router.delete("/:quoteId/items/:itemId", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM quote_items WHERE id = $1 AND quote_id = $2",
      [req.params.itemId, req.params.quoteId]
    );
    if (!rowCount) return res.status(404).json({ error: "Line item not found." });
    await pool.query("UPDATE quotes SET updated_at = now() WHERE id = $1", [req.params.quoteId]);
    res.json(await getQuoteWithItems(req.params.quoteId));
  } catch (err) {
    console.error("Delete item error:", err.message);
    res.status(500).json({ error: "Could not delete that line item." });
  }
});

module.exports = router;

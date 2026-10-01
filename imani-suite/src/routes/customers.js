const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const INDUSTRIES = ["cleaning", "hygiene", "pest_control", "security", "other"];
const SOURCES = ["referral", "inbound", "cold_outreach", "direct", "other"];
const STAGES = ["new", "contacted", "in_conversation", "quoted", "won", "on_hold", "lost", "inactive"];
const ACTIVITY_TYPES = ["call", "email", "whatsapp", "meeting", "site_visit", "note"];
const DEAL_STAGES = ["new", "qualifying", "quoted", "negotiating", "won", "lost"];

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

async function getCustomerDetail(id) {
  const { rows } = await pool.query("SELECT * FROM customers WHERE id = $1", [id]);
  const customer = rows[0];
  if (!customer) return null;

  const [contacts, deals, contracts, jobs, activities] = await Promise.all([
    pool.query("SELECT * FROM contacts WHERE customer_id = $1 ORDER BY is_primary DESC, name", [id]),
    pool.query("SELECT * FROM deals WHERE customer_id = $1 ORDER BY created_at DESC", [id]),
    pool.query("SELECT * FROM contracts WHERE customer_id = $1 ORDER BY end_date NULLS LAST", [id]),
    pool.query("SELECT * FROM service_jobs WHERE customer_id = $1 ORDER BY job_date DESC, id DESC", [id]),
    pool.query(
      `SELECT a.*, c.name AS contact_name, d.title AS deal_title
       FROM activities a
       LEFT JOIN contacts c ON c.id = a.contact_id
       LEFT JOIN deals d ON d.id = a.deal_id
       WHERE a.customer_id = $1 ORDER BY a.occurred_at DESC`,
      [id]
    ),
  ]);

  return {
    ...customer,
    contacts: contacts.rows,
    deals: deals.rows,
    contracts: contracts.rows,
    jobs: jobs.rows,
    activities: activities.rows,
  };
}

// GET /api/customers?q=&industry=&stage=&source=
router.get("/", async (req, res) => {
  const { q, industry, stage, source } = req.query;
  const clauses = [];
  const params = [];
  if (industry) {
    if (!INDUSTRIES.includes(industry)) return badRequest(res, "Unknown industry.");
    params.push(industry);
    clauses.push(`industry = $${params.length}`);
  }
  if (stage) {
    if (!STAGES.includes(stage)) return badRequest(res, "Unknown stage.");
    params.push(stage);
    clauses.push(`stage = $${params.length}`);
  }
  if (source) {
    if (!SOURCES.includes(source)) return badRequest(res, "Unknown source.");
    params.push(source);
    clauses.push(`source = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(name ILIKE $${params.length} OR country ILIKE $${params.length} OR location ILIKE $${params.length} OR notes ILIKE $${params.length})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM deals d WHERE d.customer_id = c.id AND d.stage NOT IN ('won','lost')) AS open_deal_count,
        (SELECT COUNT(*)::int FROM contracts ct WHERE ct.customer_id = c.id AND ct.status = 'active') AS active_contract_count
       FROM customers c
       ${where}
       ORDER BY
         CASE c.stage WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'in_conversation' THEN 2 WHEN 'quoted' THEN 3 WHEN 'won' THEN 4 ELSE 5 END,
         c.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("List customers error:", err.message);
    res.status(500).json({ error: "Could not load customers." });
  }
});

// GET /api/customers/:id
router.get("/:id", async (req, res) => {
  try {
    const customer = await getCustomerDetail(req.params.id);
    if (!customer) return res.status(404).json({ error: "Customer not found." });
    res.json(customer);
  } catch (err) {
    console.error("Get customer error:", err.message);
    res.status(500).json({ error: "Could not load that customer." });
  }
});

// POST /api/customers
router.post("/", async (req, res) => {
  const { name, industry, country, location, address, phone, email, website, notes, source, stage, next_action_date, next_action_note } = req.body || {};
  if (!name || !name.trim()) return badRequest(res, "A customer name is required.");
  if (industry && !INDUSTRIES.includes(industry)) return badRequest(res, "Unknown industry.");
  if (source && !SOURCES.includes(source)) return badRequest(res, "Unknown source.");
  if (stage && !STAGES.includes(stage)) return badRequest(res, "Unknown stage.");
  try {
    const { rows } = await pool.query(
      `INSERT INTO customers (name, industry, country, location, address, phone, email, website, notes, source, stage, next_action_date, next_action_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        name.trim(), industry || null, country || null, location || null, address || null,
        phone || null, email || null, website || null, notes || null,
        source || "direct", stage || "new", next_action_date || null, next_action_note || null,
      ]
    );
    res.status(201).json({ ...rows[0], contacts: [], deals: [], contracts: [], jobs: [], activities: [] });
  } catch (err) {
    console.error("Create customer error:", err.message);
    res.status(500).json({ error: "Could not add that customer." });
  }
});

// PATCH /api/customers/:id
router.patch("/:id", async (req, res) => {
  const fields = ["name", "industry", "country", "location", "address", "phone", "email", "website", "notes", "source", "stage", "next_action_date", "next_action_note"];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
      let val = req.body[f];
      if (f === "industry" && val && !INDUSTRIES.includes(val)) return badRequest(res, "Unknown industry.");
      if (f === "source" && val && !SOURCES.includes(val)) return badRequest(res, "Unknown source.");
      if (f === "stage" && val && !STAGES.includes(val)) return badRequest(res, "Unknown stage.");
      if (val === "") val = null;
      params.push(val);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) return badRequest(res, "Nothing to update.");
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE customers SET ${updates.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: "Customer not found." });
    const customer = await getCustomerDetail(req.params.id);
    res.json(customer);
  } catch (err) {
    console.error("Update customer error:", err.message);
    res.status(500).json({ error: "Could not update that customer." });
  }
});

// DELETE /api/customers/:id
router.delete("/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM customers WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Customer not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete customer error:", err.message);
    res.status(500).json({ error: "Could not delete that customer." });
  }
});

// ---------- contacts ----------

router.post("/:id/contacts", async (req, res) => {
  const { name, role, email, phone, is_primary, notes } = req.body || {};
  if (!name || !name.trim()) return badRequest(res, "A contact name is required.");
  try {
    const check = await pool.query("SELECT id FROM customers WHERE id = $1", [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: "Customer not found." });
    if (is_primary) {
      await pool.query("UPDATE contacts SET is_primary = false WHERE customer_id = $1", [req.params.id]);
    }
    await pool.query(
      `INSERT INTO contacts (customer_id, name, role, email, phone, is_primary, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.params.id, name.trim(), role || null, email || null, phone || null, !!is_primary, notes || null]
    );
    res.status(201).json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Add contact error:", err.message);
    res.status(500).json({ error: "Could not add that contact." });
  }
});

router.patch("/:id/contacts/:cid", async (req, res) => {
  const fields = ["name", "role", "email", "phone", "is_primary", "notes"];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
      params.push(req.body[f]);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) return badRequest(res, "Nothing to update.");
  try {
    if (req.body.is_primary) {
      await pool.query("UPDATE contacts SET is_primary = false WHERE customer_id = $1", [req.params.id]);
    }
    params.push(req.params.cid, req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE contacts SET ${updates.join(", ")}, updated_at = now() WHERE id = $${params.length - 1} AND customer_id = $${params.length}`,
      params
    );
    if (!rowCount) return res.status(404).json({ error: "Contact not found." });
    res.json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Update contact error:", err.message);
    res.status(500).json({ error: "Could not update that contact." });
  }
});

router.delete("/:id/contacts/:cid", async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM contacts WHERE id = $1 AND customer_id = $2", [req.params.cid, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Contact not found." });
    res.json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Delete contact error:", err.message);
    res.status(500).json({ error: "Could not delete that contact." });
  }
});

// ---------- deals ----------

router.post("/:id/deals", async (req, res) => {
  const { title, stage, value, expected_close_date, notes } = req.body || {};
  if (!title || !title.trim()) return badRequest(res, "A deal title is required.");
  if (stage && !DEAL_STAGES.includes(stage)) return badRequest(res, "Unknown deal stage.");
  try {
    const check = await pool.query("SELECT id FROM customers WHERE id = $1", [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: "Customer not found." });
    await pool.query(
      `INSERT INTO deals (customer_id, title, stage, value, expected_close_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.params.id, title.trim(), stage || "new", value || null, expected_close_date || null, notes || null]
    );
    res.status(201).json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Add deal error:", err.message);
    res.status(500).json({ error: "Could not add that deal." });
  }
});

router.patch("/:id/deals/:did", async (req, res) => {
  const fields = ["title", "stage", "value", "expected_close_date", "notes"];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
      let val = req.body[f];
      if (f === "stage" && val && !DEAL_STAGES.includes(val)) return badRequest(res, "Unknown deal stage.");
      if (val === "") val = null;
      params.push(val);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) return badRequest(res, "Nothing to update.");
  if (req.body.stage === "won" || req.body.stage === "lost") {
    updates.push(`closed_at = now()`);
  }
  params.push(req.params.did, req.params.id);
  try {
    const { rowCount } = await pool.query(
      `UPDATE deals SET ${updates.join(", ")}, updated_at = now() WHERE id = $${params.length - 1} AND customer_id = $${params.length}`,
      params
    );
    if (!rowCount) return res.status(404).json({ error: "Deal not found." });
    res.json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Update deal error:", err.message);
    res.status(500).json({ error: "Could not update that deal." });
  }
});

router.delete("/:id/deals/:did", async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM deals WHERE id = $1 AND customer_id = $2", [req.params.did, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Deal not found." });
    res.json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Delete deal error:", err.message);
    res.status(500).json({ error: "Could not delete that deal." });
  }
});

// ---------- activities ----------

router.post("/:id/activities", async (req, res) => {
  const { type, summary, contact_id, deal_id, occurred_at } = req.body || {};
  if (!type || !ACTIVITY_TYPES.includes(type)) return badRequest(res, "A valid activity type is required.");
  if (!summary || !summary.trim()) return badRequest(res, "A summary is required.");
  try {
    const check = await pool.query("SELECT id, stage FROM customers WHERE id = $1", [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: "Customer not found." });
    await pool.query(
      `INSERT INTO activities (customer_id, contact_id, deal_id, type, summary, occurred_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))`,
      [req.params.id, contact_id || null, deal_id || null, type, summary.trim(), occurred_at || null]
    );
    // Logging an activity on a brand-new lead moves it to "contacted" automatically.
    await pool.query(
      `UPDATE customers SET updated_at = now(), stage = CASE WHEN stage = 'new' THEN 'contacted' ELSE stage END WHERE id = $1`,
      [req.params.id]
    );
    res.status(201).json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Add activity error:", err.message);
    res.status(500).json({ error: "Could not log that activity." });
  }
});

router.delete("/:id/activities/:aid", async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM activities WHERE id = $1 AND customer_id = $2", [req.params.aid, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Activity not found." });
    res.json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Delete activity error:", err.message);
    res.status(500).json({ error: "Could not delete that activity." });
  }
});

// ---------- contracts ----------

router.post("/:id/contracts", async (req, res) => {
  const { title, start_date, end_date, value, billing_frequency, status, notes } = req.body || {};
  if (!title || !title.trim()) return badRequest(res, "A contract title is required.");
  try {
    const check = await pool.query("SELECT id FROM customers WHERE id = $1", [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: "Customer not found." });
    await pool.query(
      `INSERT INTO contracts (customer_id, title, start_date, end_date, value, billing_frequency, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.params.id, title.trim(), start_date || null, end_date || null, value || null, billing_frequency || null, status || "active", notes || null]
    );
    res.status(201).json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Add contract error:", err.message);
    res.status(500).json({ error: "Could not add that contract." });
  }
});

router.patch("/:id/contracts/:ctid", async (req, res) => {
  const fields = ["title", "start_date", "end_date", "value", "billing_frequency", "status", "notes"];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
      let val = req.body[f];
      if (f === "status" && val && !["active", "expired", "cancelled"].includes(val)) return badRequest(res, "Unknown status.");
      if (val === "") val = null;
      params.push(val);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) return badRequest(res, "Nothing to update.");
  params.push(req.params.ctid, req.params.id);
  try {
    const { rowCount } = await pool.query(
      `UPDATE contracts SET ${updates.join(", ")}, updated_at = now() WHERE id = $${params.length - 1} AND customer_id = $${params.length}`,
      params
    );
    if (!rowCount) return res.status(404).json({ error: "Contract not found." });
    res.json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Update contract error:", err.message);
    res.status(500).json({ error: "Could not update that contract." });
  }
});

router.delete("/:id/contracts/:ctid", async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM contracts WHERE id = $1 AND customer_id = $2", [req.params.ctid, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Contract not found." });
    res.json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Delete contract error:", err.message);
    res.status(500).json({ error: "Could not delete that contract." });
  }
});

// ---------- service jobs ----------

router.post("/:id/jobs", async (req, res) => {
  const { deal_id, contract_id, description, amount, job_date, status, notes } = req.body || {};
  if (!description || !description.trim()) return badRequest(res, "A description is required.");
  try {
    const check = await pool.query("SELECT id FROM customers WHERE id = $1", [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: "Customer not found." });
    await pool.query(
      `INSERT INTO service_jobs (customer_id, deal_id, contract_id, description, amount, job_date, status, notes)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, $8)`,
      [req.params.id, deal_id || null, contract_id || null, description.trim(), amount || 0, job_date || null, status || "scheduled", notes || null]
    );
    res.status(201).json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Add job error:", err.message);
    res.status(500).json({ error: "Could not add that job." });
  }
});

router.patch("/:id/jobs/:jid", async (req, res) => {
  const fields = ["deal_id", "contract_id", "description", "amount", "job_date", "status", "notes"];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
      let val = req.body[f];
      if (f === "status" && val && !["scheduled", "completed", "cancelled"].includes(val)) return badRequest(res, "Unknown status.");
      if (val === "") val = null;
      params.push(val);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) return badRequest(res, "Nothing to update.");
  params.push(req.params.jid, req.params.id);
  try {
    const { rowCount } = await pool.query(
      `UPDATE service_jobs SET ${updates.join(", ")}, updated_at = now() WHERE id = $${params.length - 1} AND customer_id = $${params.length}`,
      params
    );
    if (!rowCount) return res.status(404).json({ error: "Job not found." });
    res.json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Update job error:", err.message);
    res.status(500).json({ error: "Could not update that job." });
  }
});

router.delete("/:id/jobs/:jid", async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM service_jobs WHERE id = $1 AND customer_id = $2", [req.params.jid, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Job not found." });
    res.json(await getCustomerDetail(req.params.id));
  } catch (err) {
    console.error("Delete job error:", err.message);
    res.status(500).json({ error: "Could not delete that job." });
  }
});

module.exports = router;

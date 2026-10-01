const express = require("express");
const multer = require("multer");
const { pool } = require("../db");

const router = express.Router();

// Stored in memory only long enough to write straight into Postgres as
// bytea — nothing touches disk, which matters on Render's free tier where
// the filesystem doesn't survive a restart or redeploy anyway.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per document
});

const VALID_CATEGORIES = new Set(["company_profiles", "compliance", "financials", "legal_contracts", "templates"]);

function toJson(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    filename: row.filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    notes: row.notes || "",
    expiryDate: row.expiry_date,
    uploadedAt: row.uploaded_at,
  };
}

router.get("/", async (req, res) => {
  try {
    const category = req.query.category;
    const { rows } = VALID_CATEGORIES.has(category)
      ? await pool.query(
          "SELECT id, category, title, filename, mime_type, file_size, notes, expiry_date, uploaded_at FROM library_documents WHERE category = $1 ORDER BY uploaded_at DESC",
          [category]
        )
      : await pool.query(
          "SELECT id, category, title, filename, mime_type, file_size, notes, expiry_date, uploaded_at FROM library_documents ORDER BY uploaded_at DESC"
        );
    res.json(rows.map(toJson));
  } catch (err) {
    console.error("List library documents failed:", err.message);
    res.status(500).json({ error: "Couldn't load the Document Library." });
  }
});

router.post("/", upload.single("file"), async (req, res) => {
  const body = req.body || {};
  if (!req.file) {
    return res.status(400).json({ error: "Choose a file to upload." });
  }
  if (!VALID_CATEGORIES.has(body.category)) {
    return res.status(400).json({ error: "Choose a valid category." });
  }
  const title = (body.title && String(body.title).trim()) || req.file.originalname;
  try {
    const { rows } = await pool.query(
      `INSERT INTO library_documents (category, title, filename, mime_type, file_size, file_data, notes, expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, category, title, filename, mime_type, file_size, notes, expiry_date, uploaded_at`,
      [
        body.category,
        title,
        req.file.originalname,
        req.file.mimetype || "application/octet-stream",
        req.file.size,
        req.file.buffer,
        body.notes || "",
        body.expiryDate || null,
      ]
    );
    res.status(201).json(toJson(rows[0]));
  } catch (err) {
    console.error("Upload library document failed:", err.message);
    res.status(500).json({ error: "Couldn't upload that document." });
  }
});

router.get("/:id/download", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT filename, mime_type, file_data FROM library_documents WHERE id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Document not found." });
    const doc = rows[0];
    res.setHeader("Content-Type", doc.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename.replace(/"/g, "")}"`);
    res.send(doc.file_data);
  } catch (err) {
    console.error("Download library document failed:", err.message);
    res.status(500).json({ error: "Couldn't download that document." });
  }
});

router.patch("/:id", async (req, res) => {
  const body = req.body || {};
  const fieldMap = { title: "title", category: "category", notes: "notes", expiryDate: "expiry_date" };
  const sets = [];
  const values = [];
  let i = 1;
  for (const [jsKey, column] of Object.entries(fieldMap)) {
    if (Object.prototype.hasOwnProperty.call(body, jsKey)) {
      if (jsKey === "category" && !VALID_CATEGORIES.has(body[jsKey])) {
        return res.status(400).json({ error: "Choose a valid category." });
      }
      sets.push(`${column} = $${i++}`);
      values.push(body[jsKey] === "" ? null : body[jsKey]);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: "Nothing to update." });
  values.push(req.params.id);

  try {
    const { rows } = await pool.query(
      `UPDATE library_documents SET ${sets.join(", ")} WHERE id = $${i}
       RETURNING id, category, title, filename, mime_type, file_size, notes, expiry_date, uploaded_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Document not found." });
    res.json(toJson(rows[0]));
  } catch (err) {
    console.error("Update library document failed:", err.message);
    res.status(500).json({ error: "Couldn't save changes." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM library_documents WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Document not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete library document failed:", err.message);
    res.status(500).json({ error: "Couldn't delete the document." });
  }
});

// Multer's file-too-large error would otherwise bubble up as an
// unhandled 500 with an ugly stack trace — turn it into a clean message.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "That file is too large (25MB limit)." });
  }
  next(err);
});

module.exports = router;

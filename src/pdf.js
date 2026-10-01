// Renders a branded quotation PDF straight to an HTTP response, using
// pdfkit (pure JS, no native dependencies — safe on Render's free tier).
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const BRAND_GREEN = "#3F8F29";
const DARK_GREEN = "#2C661C";
const INK = "#1B2420";
const INK_SOFT = "#5C6660";
const LINE = "#DCE6D9";
const LOGO_PATH = path.join(__dirname, "..", "public", "brand", "imani-leaf.png");

const FREQUENCY_LABELS = {
  once_off: "Once-off",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

function money(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function computeTotals(quote, items) {
  const subtotal = items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.rate), 0);
  const calloutFee = Number(quote.callout_fee) || 0;
  const vatPct = quote.vat_pct != null ? Number(quote.vat_pct) : null;
  const vatBase = subtotal + calloutFee;
  const vatAmount = vatPct != null ? (vatBase * vatPct) / 100 : 0;
  const total = vatBase + vatAmount;
  return { subtotal, calloutFee, vatPct, vatAmount, total };
}

function renderQuotePdf(res, quote, items) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${quote.quote_number || "quotation"}.pdf"`);
  doc.pipe(res);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totals = computeTotals(quote, items);

  // ---- Header: logo plate + quotation title/meta ----
  const headerTop = doc.y;
  doc.roundedRect(50, headerTop, 170, 62, 6).fill("#EFF6EC");
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, 62, headerTop + 11, { width: 40 });
  }
  doc.fillColor(DARK_GREEN).font("Helvetica-Bold").fontSize(13).text("Imani Business", 112, headerTop + 16, { width: 100 });
  doc.text("Enterprise", 112, headerTop + 30, { width: 100 });
  doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(BRAND_GREEN).text("we make it possible", 62, headerTop + 46);

  doc.fillColor(INK).fontSize(20).font("Helvetica-Bold").text("QUOTATION", 300, headerTop, { width: pageWidth - 250, align: "right" });
  doc.fontSize(10).font("Helvetica").fillColor(INK_SOFT);
  doc.text(`Quote #: ${quote.quote_number || "-"}`, 300, headerTop + 26, { width: pageWidth - 250, align: "right" });
  doc.text(`Date: ${new Date(quote.created_at).toLocaleDateString("en-ZA")}`, 300, headerTop + 40, { width: pageWidth - 250, align: "right" });
  if (quote.valid_until) {
    doc.text(`Valid until: ${new Date(quote.valid_until).toLocaleDateString("en-ZA")}`, 300, headerTop + 54, { width: pageWidth - 250, align: "right" });
  }

  doc.y = headerTop + 85;
  doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).strokeColor(LINE).stroke();
  doc.moveDown(1);

  // ---- Company + customer blocks ----
  const blockTop = doc.y;
  doc.fontSize(9).fillColor(INK_SOFT).font("Helvetica-Bold").text("FROM", 50, blockTop);
  doc.font("Helvetica").fillColor(INK).fontSize(10);
  doc.text("Imani Business Enterprise", 50, blockTop + 14);
  doc.fillColor(INK_SOFT).fontSize(9);
  doc.text("Cleaning · Hygiene · Pest Control · Security Services", 50, blockTop + 29, { width: 220 });

  doc.font("Helvetica-Bold").fillColor(INK_SOFT).fontSize(9).text("QUOTED TO", 320, blockTop);
  doc.font("Helvetica").fillColor(INK).fontSize(10);
  doc.text(quote.customer_name || "-", 320, blockTop + 14, { width: pageWidth - 270 });
  doc.fillColor(INK_SOFT).fontSize(9);
  let cy = blockTop + 29;
  if (quote.customer_email || quote.customer_phone) {
    doc.text([quote.customer_email, quote.customer_phone].filter(Boolean).join(" · "), 320, cy, { width: pageWidth - 270 });
    cy += 13;
  }
  const loc = [quote.customer_location, quote.customer_country].filter(Boolean).join(", ");
  if (loc) { doc.text(loc, 320, cy, { width: pageWidth - 270 }); cy += 13; }

  doc.y = Math.max(blockTop + 75, cy + 10);
  doc.moveDown(0.5);

  // ---- Line items table ----
  const colX = { service: 50, freq: 270, qty: 350, rate: 410, total: 484 };
  const tableTop = doc.y;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#fff");
  doc.rect(50, tableTop, pageWidth, 22).fill(DARK_GREEN);
  doc.fillColor("#fff");
  doc.text("SERVICE", colX.service + 8, tableTop + 6);
  doc.text("FREQUENCY", colX.freq, tableTop + 6, { width: 75 });
  doc.text("QTY", colX.qty, tableTop + 6, { width: 50, align: "right" });
  doc.text("RATE", colX.rate, tableTop + 6, { width: 65, align: "right" });
  doc.text("LINE TOTAL", colX.total, tableTop + 6, { width: 61, align: "right" });

  let rowY = tableTop + 22;
  doc.font("Helvetica").fontSize(9.5).fillColor(INK);
  items.forEach((it, idx) => {
    const rowHeight = 22;
    if (idx % 2 === 1) doc.rect(50, rowY, pageWidth, rowHeight).fill("#F4F7F2");
    doc.fillColor(INK);
    const lineTotal = Number(it.quantity) * Number(it.rate);
    doc.text(it.service_name, colX.service + 8, rowY + 6, { width: 210 });
    doc.text(FREQUENCY_LABELS[it.frequency] || it.frequency, colX.freq, rowY + 6, { width: 75 });
    doc.text(String(it.quantity), colX.qty, rowY + 6, { width: 50, align: "right" });
    doc.text("R " + money(it.rate), colX.rate, rowY + 6, { width: 65, align: "right" });
    doc.text("R " + money(lineTotal), colX.total, rowY + 6, { width: 61, align: "right" });
    rowY += rowHeight;
  });
  doc.moveTo(50, rowY).lineTo(50 + pageWidth, rowY).strokeColor(LINE).stroke();

  // ---- Totals ----
  let ty = rowY + 12;
  function totalLine(label, value, opts) {
    opts = opts || {};
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.bold ? 11 : 9.5).fillColor(opts.bold ? INK : INK_SOFT);
    doc.text(label, 340, ty, { width: 100, align: "right" });
    doc.fillColor(INK).text("R " + money(value), colX.total, ty, { width: 61, align: "right" });
    ty += opts.bold ? 20 : 16;
  }
  totalLine("Subtotal", totals.subtotal);
  if (totals.calloutFee) totalLine("Call-out fee", totals.calloutFee);
  if (totals.vatPct != null) totalLine(`VAT (${totals.vatPct}%)`, totals.vatAmount);
  doc.moveTo(340, ty).lineTo(50 + pageWidth, ty).strokeColor(LINE).stroke();
  ty += 8;
  totalLine("TOTAL", totals.total, { bold: true });

  doc.y = ty + 20;

  // ---- Terms / notes ----
  if (quote.payment_terms) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK_SOFT).text("PAYMENT TERMS", 50, doc.y);
    doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(quote.payment_terms, 50, doc.y + 14, { width: pageWidth });
    doc.moveDown(1);
  }
  if (quote.site_notes) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK_SOFT).text("SITE / SERVICE NOTES", 50, doc.y);
    doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(quote.site_notes, 50, doc.y + 14, { width: pageWidth });
    doc.moveDown(1);
  }

  // ---- Footer ----
  const footerY = doc.page.height - doc.page.margins.bottom - 40;
  doc.moveTo(50, footerY).lineTo(50 + pageWidth, footerY).strokeColor(LINE).stroke();
  doc.font("Helvetica").fontSize(8).fillColor(INK_SOFT).text(
    "Imani Business Enterprise — cleaning, hygiene, pest control and security services. " +
    "This quotation is valid until the date shown above and is subject to Imani's standard terms of service.",
    50, footerY + 8, { width: pageWidth }
  );

  doc.end();
}

module.exports = { renderQuotePdf, computeTotals };

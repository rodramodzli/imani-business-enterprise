const express = require("express");
const { pool } = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const [
      customerCounts,
      dealRows,
      jobTotals,
      quoteTotals,
      contractsDue,
      recentActivity,
      followUpsDue,
      industryBreakdown,
    ] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE stage = 'won')::int AS active_customers,
           COUNT(*) FILTER (WHERE stage NOT IN ('won','lost','inactive'))::int AS open_prospects
         FROM customers`
      ),
      pool.query("SELECT stage, value FROM deals"),
      pool.query(
        `SELECT
           COALESCE(SUM(amount), 0) AS total_all_time,
           COALESCE(SUM(amount) FILTER (WHERE job_date >= (CURRENT_DATE - INTERVAL '30 days')), 0) AS total_last_30_days
         FROM service_jobs WHERE status != 'cancelled'`
      ),
      pool.query(
        `SELECT q.status, COALESCE(SUM(i.quantity * i.rate), 0) + COALESCE(q.callout_fee,0) AS value
         FROM quotes q LEFT JOIN quote_items i ON i.quote_id = q.id
         GROUP BY q.id, q.status`
      ),
      pool.query(
        `SELECT ct.*, c.name AS customer_name FROM contracts ct
         JOIN customers c ON c.id = ct.customer_id
         WHERE ct.status = 'active' AND ct.end_date IS NOT NULL AND ct.end_date <= (CURRENT_DATE + INTERVAL '30 days')
         ORDER BY ct.end_date ASC LIMIT 10`
      ),
      pool.query(
        `SELECT a.*, c.name AS customer_name FROM activities a
         JOIN customers c ON c.id = a.customer_id
         ORDER BY a.occurred_at DESC LIMIT 8`
      ),
      pool.query(
        `SELECT id, name, industry, stage, next_action_date, next_action_note FROM customers
         WHERE next_action_date IS NOT NULL AND next_action_date <= (CURRENT_DATE + INTERVAL '7 days')
         ORDER BY next_action_date ASC LIMIT 10`
      ),
      pool.query(
        `SELECT industry, COUNT(*)::int AS count FROM customers WHERE industry IS NOT NULL GROUP BY industry`
      ),
    ]);

    const byStage = { new: 0, qualifying: 0, quoted: 0, negotiating: 0, won: 0, lost: 0 };
    const valueByStage = { new: 0, qualifying: 0, quoted: 0, negotiating: 0, won: 0, lost: 0 };
    dealRows.rows.forEach((d) => {
      byStage[d.stage] = (byStage[d.stage] || 0) + 1;
      valueByStage[d.stage] = (valueByStage[d.stage] || 0) + (Number(d.value) || 0);
    });
    const openDealValue = valueByStage.new + valueByStage.qualifying + valueByStage.quoted + valueByStage.negotiating;

    const quotesByStatus = { draft: 0, sent: 0, accepted: 0, rejected: 0, expired: 0 };
    const quoteValueByStatus = { draft: 0, sent: 0, accepted: 0, rejected: 0, expired: 0 };
    quoteTotals.rows.forEach((q) => {
      quotesByStatus[q.status] = (quotesByStatus[q.status] || 0) + 1;
      quoteValueByStatus[q.status] = (quoteValueByStatus[q.status] || 0) + Number(q.value);
    });

    const industryCounts = { cleaning: 0, hygiene: 0, pest_control: 0, security: 0, other: 0 };
    industryBreakdown.rows.forEach((r) => { industryCounts[r.industry] = r.count; });

    res.json({
      activeCustomers: customerCounts.rows[0].active_customers,
      openProspects: customerCounts.rows[0].open_prospects,
      dealsByStage: byStage,
      openDealValue,
      wonDealValue: valueByStage.won,
      revenueAllTime: Number(jobTotals.rows[0].total_all_time),
      revenueLast30Days: Number(jobTotals.rows[0].total_last_30_days),
      quotesByStatus,
      quoteValueByStatus,
      contractsDue: contractsDue.rows,
      recentActivity: recentActivity.rows,
      followUpsDue: followUpsDue.rows,
      industryCounts,
    });
  } catch (err) {
    console.error("Dashboard error:", err.message);
    res.status(500).json({ error: "Could not load the dashboard." });
  }
});

module.exports = router;

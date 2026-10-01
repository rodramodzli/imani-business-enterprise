/* Imani Business Enterprise — front end. Plain JS, no build step, no framework. */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const INDUSTRIES = [
  { id: "cleaning", label: "Cleaning" },
  { id: "hygiene", label: "Hygiene" },
  { id: "pest_control", label: "Pest Control" },
  { id: "security", label: "Security" },
  { id: "other", label: "Other" },
];
const STAGES = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "in_conversation", label: "In Conversation" },
  { id: "quoted", label: "Quoted" },
  { id: "won", label: "Won (Active)" },
  { id: "on_hold", label: "On Hold" },
  { id: "lost", label: "Lost" },
  { id: "inactive", label: "Inactive" },
];
const BOARD_STAGES = ["new", "contacted", "in_conversation", "quoted", "won"];
const SOURCES = [
  { id: "referral", label: "Referral" },
  { id: "inbound", label: "Inbound enquiry" },
  { id: "cold_outreach", label: "Cold outreach" },
  { id: "direct", label: "Direct" },
  { id: "other", label: "Other" },
];
const DEAL_STAGES = ["new", "qualifying", "quoted", "negotiating", "won", "lost"];
const ACTIVITY_TYPES = [
  { id: "call", label: "Call" },
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "meeting", label: "Meeting" },
  { id: "site_visit", label: "Site visit" },
  { id: "note", label: "Note" },
];
const FREQUENCIES = [
  { id: "once_off", label: "Once-off" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "annual", label: "Annual" },
];
const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"];
const LIBRARY_CATEGORIES = [
  { id: "all", label: "All Documents" },
  { id: "company_profiles", label: "Company Profiles" },
  { id: "compliance", label: "Compliance Documents" },
  { id: "financials", label: "Financials" },
  { id: "legal_contracts", label: "Legal, Contracts & References" },
  { id: "templates", label: "Templates" },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let view = "dashboard";
let customers = [];
let services = [];
let quotes = [];
let contracts = [];
let libraryDocs = [];
let dashboard = null;

let industryFilter = "";
let stageFilter = "";
let searchQuery = "";
let libraryTab = "all";
let showClosedOnBoard = false;

let sheetMode = null; // "customer" | "quote"
let openCustomerId = null;
let openQuoteId = null;
let openCustomerDetail = null;
let openQuoteDetail = null;
let saveTimer = null;

let activeCharts = [];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function api(path, opts) {
  const res = await fetch("/api" + path, {
    method: (opts && opts.method) || "GET",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || "Something went wrong.");
  return data;
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function fmtMoney(n) {
  const num = Number(n) || 0;
  return "R " + num.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}
function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}
// Expiry badge for a document: null if no expiry date set, otherwise
// {level: "crit"|"warn", text} — crit once it's past, warn inside 30 days.
function expiryBadge(expiryDate) {
  if (!expiryDate) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.ceil((new Date(expiryDate) - new Date()) / msPerDay);
  if (days < 0) return { level: "crit", text: `Expired ${fmtDate(expiryDate)}` };
  if (days === 0) return { level: "crit", text: "Expires today" };
  if (days <= 30) return { level: "warn", text: `Expires in ${days} day${days === 1 ? "" : "s"}` };
  return null;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function industryLabel(id) {
  const i = INDUSTRIES.find((x) => x.id === id);
  return i ? i.label : "—";
}
function industryBadge(id) {
  if (!id) return "";
  return `<span class="cat-badge ${id}">${esc(industryLabel(id))}</span>`;
}
function stageLabel(id) {
  const s = STAGES.find((x) => x.id === id);
  return s ? s.label : id;
}
function stagePill(id) {
  const cls = id === "won" ? "good" : id === "lost" ? "crit" : id === "on_hold" || id === "inactive" ? "neutral" : "warn";
  return `<span class="pill ${cls}">${esc(stageLabel(id))}</span>`;
}
function industrySelectOptions(selected) {
  return `<option value="">—</option>` + INDUSTRIES.map((i) => `<option value="${i.id}" ${selected === i.id ? "selected" : ""}>${esc(i.label)}</option>`).join("");
}
function stageSelectOptions(selected) {
  return STAGES.map((s) => `<option value="${s.id}" ${selected === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("");
}
function industryFilterBar() {
  const chips = [{ id: "", label: "All Industries" }].concat(INDUSTRIES.filter((i) => i.id !== "other"));
  return `<div class="cat-filter">` + chips.map((c) => {
    const active = industryFilter === c.id;
    const chipCls = c.id ? `ind-${c.id}-chip` : "";
    return `<button class="cat-chip ${active ? "active " + chipCls : ""}" data-industry-filter="${c.id}">${esc(c.label)}</button>`;
  }).join("") + `</div>`;
}
function filteredCustomers() {
  return customers.filter((c) => {
    if (industryFilter && c.industry !== industryFilter) return false;
    if (stageFilter && c.stage !== stageFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!(c.name || "").toLowerCase().includes(q) && !(c.country || "").toLowerCase().includes(q) && !(c.location || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------
async function loadAll() {
  const [me, c, s, q, ct, lib, dash] = await Promise.all([
    api("/auth/me"),
    api("/customers"),
    api("/services?includeInactive=1"),
    api("/quotes"),
    api("/contracts"),
    api("/library"),
    api("/dashboard"),
  ]);
  document.getElementById("whoami").textContent = me.username;
  customers = c; services = s; quotes = q; contracts = ct; libraryDocs = lib; dashboard = dash;
}

async function refreshCustomers() { customers = await api("/customers"); }
async function refreshQuotes() { quotes = await api("/quotes"); }
async function refreshServices() { services = await api("/services?includeInactive=1"); }
async function refreshContracts() { contracts = await api("/contracts"); }
async function refreshLibrary() { libraryDocs = await api("/library"); }
async function refreshDashboard() { dashboard = await api("/dashboard"); }

// ---------------------------------------------------------------------------
// Render dispatch
// ---------------------------------------------------------------------------
function render() {
  const main = document.getElementById("mainView");
  document.querySelectorAll("#railNav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "dashboard") return renderDashboard(main);
  if (view === "customers") return renderCustomers(main);
  if (view === "pipeline") return renderPipeline(main);
  if (view === "quotes") return renderQuotes(main);
  if (view === "services") return renderServices(main);
  if (view === "contracts") return renderContracts(main);
  if (view === "library") return renderLibrary(main);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function destroyCharts() {
  activeCharts.forEach((c) => c.destroy());
  activeCharts = [];
}

function buildRecommendations(d) {
  const recs = [];
  if (d.openProspects > 0 && d.activeCustomers === 0) {
    recs.push({ icon: "🌱", text: `<strong>${d.openProspects} open prospect(s)</strong> and no active customers yet — focus on moving the earliest-stage leads to a quote.` });
  }
  const quoted = d.quotesByStatus.sent || 0;
  const accepted = d.quotesByStatus.accepted || 0;
  const totalSentOrPast = accepted + (d.quotesByStatus.rejected || 0) + (d.quotesByStatus.expired || 0);
  if (totalSentOrPast >= 3) {
    const rate = Math.round((accepted / totalSentOrPast) * 100);
    if (rate < 35) {
      recs.push({ icon: "⚠️", text: `Quote acceptance rate is <strong>${rate}%</strong> — consider reviewing pricing or follow-up timing on sent quotes.` });
    } else {
      recs.push({ icon: "✅", text: `Quote acceptance rate is a healthy <strong>${rate}%</strong> — keep the follow-up cadence that's working.` });
    }
  }
  if (quoted > 0) {
    recs.push({ icon: "📨", text: `<strong>${quoted} quote(s)</strong> are sent and awaiting a response — a follow-up call or WhatsApp often tips these.` });
  }
  if (d.contractsDue && d.contractsDue.length > 0) {
    recs.push({ icon: "📅", text: `<strong>${d.contractsDue.length} contract(s)</strong> renew within 30 days — line up renewal conversations now to avoid a service gap.` });
  }
  if (d.followUpsDue && d.followUpsDue.length > 0) {
    recs.push({ icon: "⏰", text: `<strong>${d.followUpsDue.length} follow-up(s)</strong> are due in the next 7 days.` });
  }
  if (d.documentsExpiring && d.documentsExpiring.length > 0) {
    const expiredCount = d.documentsExpiring.filter((doc) => new Date(doc.expiry_date) < new Date()).length;
    recs.push({
      icon: "📄",
      text: expiredCount > 0
        ? `<strong>${expiredCount} document(s)</strong> in the Library have already expired — renew and re-upload them.`
        : `<strong>${d.documentsExpiring.length} document(s)</strong> in the Library expire within 30 days.`,
    });
  }
  const industries = Object.entries(d.industryCounts || {}).filter(([k, v]) => v > 0 && k !== "other");
  if (industries.length === 1) {
    recs.push({ icon: "🎯", text: `All current customers are in <strong>${industryLabel(industries[0][0])}</strong> — the other three service lines are untapped so far.` });
  }
  if (recs.length === 0) {
    recs.push({ icon: "👍", text: "Nothing urgent to flag right now — the pipeline looks steady." });
  }
  return recs;
}

function renderCharts(d) {
  destroyCharts();
  const dealCtx = document.getElementById("chartDeals");
  if (dealCtx) {
    activeCharts.push(new Chart(dealCtx, {
      type: "doughnut",
      data: {
        labels: DEAL_STAGES.map((s) => s[0].toUpperCase() + s.slice(1)),
        datasets: [{ data: DEAL_STAGES.map((s) => d.dealsByStage[s] || 0), backgroundColor: ["#8B968E", "#1B6FA8", "#9A6A00", "#6A4BA8", "#1F6F5C", "#C2410C"] }],
      },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10.5 } } } }, maintainAspectRatio: false },
    }));
  }
  const indCtx = document.getElementById("chartIndustry");
  if (indCtx) {
    const labels = ["cleaning", "hygiene", "pest_control", "security"];
    activeCharts.push(new Chart(indCtx, {
      type: "bar",
      data: {
        labels: labels.map(industryLabel),
        datasets: [{ label: "Customers", data: labels.map((l) => d.industryCounts[l] || 0), backgroundColor: ["#1B6FA8", "#0E8F7D", "#9A6A00", "#6A4BA8"] }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, maintainAspectRatio: false },
    }));
  }
  const quoteCtx = document.getElementById("chartQuotes");
  if (quoteCtx) {
    activeCharts.push(new Chart(quoteCtx, {
      type: "bar",
      data: {
        labels: QUOTE_STATUSES.map((s) => s[0].toUpperCase() + s.slice(1)),
        datasets: [{ label: "Quotes", data: QUOTE_STATUSES.map((s) => d.quotesByStatus[s] || 0), backgroundColor: "#3F8F29" }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0, maxTicksLimit: 5 } } }, maintainAspectRatio: false },
    }));
  }
}

function renderDashboard(main) {
  const d = dashboard;
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>Dashboard</h1><p>Imani Business Enterprise — cleaning, hygiene, pest control &amp; security</p></div>
      </div>
      <div class="stats">
        <div class="stat"><div class="k">Active Customers</div><div class="v good">${d.activeCustomers}</div><div class="sub">won / currently serviced</div></div>
        <div class="stat"><div class="k">Open Prospects</div><div class="v">${d.openProspects}</div><div class="sub">in the pipeline</div></div>
        <div class="stat"><div class="k">Open Deal Value</div><div class="v">${fmtMoney(d.openDealValue)}</div><div class="sub">deals not yet won/lost</div></div>
        <div class="stat"><div class="k">Revenue (30 days)</div><div class="v">${fmtMoney(d.revenueLast30Days)}</div><div class="sub">completed jobs</div></div>
      </div>

      <div class="charts-grid">
        <div class="chart-box"><h3>Deals by stage</h3><div class="chart-canvas-wrap"><canvas id="chartDeals"></canvas></div></div>
        <div class="chart-box"><h3>Customers by industry</h3><div class="chart-canvas-wrap"><canvas id="chartIndustry"></canvas></div></div>
        <div class="chart-box"><h3>Quotes by status</h3><div class="chart-canvas-wrap"><canvas id="chartQuotes"></canvas></div></div>
      </div>

      <div class="panel">
        <h2>Recommendations</h2>
        <div class="reco-list">${buildRecommendations(d).map((r) => `<div class="reco-item"><span class="reco-icon">${r.icon}</span><span class="reco-text">${r.text}</span></div>`).join("")}</div>
      </div>

      <div class="panel">
        <h2>Needs attention</h2>
        ${d.followUpsDue.length === 0 && d.contractsDue.length === 0 && (!d.documentsExpiring || d.documentsExpiring.length === 0) ? '<div class="empty-note">Nothing due this week.</div>' : ""}
        ${d.followUpsDue.map((f) => `<div class="attn-row" data-open-customer="${f.id}"><span class="attn-dot warn"></span><span class="attn-title">${esc(f.name)} — ${esc(f.next_action_note || "follow up")}</span><span class="attn-meta">${fmtDate(f.next_action_date)}</span></div>`).join("")}
        ${d.contractsDue.map((c) => `<div class="attn-row" data-open-customer="${c.customer_id}"><span class="attn-dot crit"></span><span class="attn-title">${esc(c.customer_name)} — ${esc(c.title)} renews</span><span class="attn-meta">${fmtDate(c.end_date)}</span></div>`).join("")}
        ${(d.documentsExpiring || []).map((doc) => {
          const badge = expiryBadge(doc.expiry_date);
          return `<div class="attn-row" data-open-library="${doc.id}"><span class="attn-dot ${badge ? badge.level : "warn"}"></span><span class="attn-title">${esc(doc.title)} (Document Library)</span><span class="attn-meta">${badge ? esc(badge.text) : fmtDate(doc.expiry_date)}</span></div>`;
        }).join("")}
      </div>

      <div class="panel">
        <h2>Recent activity</h2>
        ${d.recentActivity.length === 0 ? '<div class="empty-note">No activity logged yet.</div>' : ""}
        ${d.recentActivity.map((a) => `<div class="attn-row" data-open-customer="${a.customer_id}"><span class="attn-dot"></span><span class="attn-title">${esc(a.customer_name)} — ${esc(a.summary)}</span><span class="attn-meta">${fmtDate(a.occurred_at)}</span></div>`).join("")}
      </div>
    </div>
  `;
  renderCharts(d);
  main.querySelectorAll("[data-open-customer]").forEach((el) => el.addEventListener("click", () => openCustomer(el.dataset.openCustomer)));
  main.querySelectorAll("[data-open-library]").forEach((el) => el.addEventListener("click", () => { view = "library"; render(); }));
}

// ---------------------------------------------------------------------------
// Customers (list)
// ---------------------------------------------------------------------------
function renderCustomers(main) {
  const list = filteredCustomers();
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>Customers</h1><p>Every prospect and client, one record from first contact to active service.</p></div>
        <button class="btn" id="addCustomerBtn">+ New customer</button>
      </div>
      ${industryFilterBar()}
      <div class="panel" style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
        <input type="text" placeholder="Search name, country, location…" id="customerSearch" value="${esc(searchQuery)}" style="flex:1; min-width:200px; border:1px solid var(--line); border-radius:8px; padding:9px 12px; background:var(--surface); color:var(--ink);">
        <select id="stageFilterSelect" style="border:1px solid var(--line); border-radius:8px; padding:9px 12px; background:var(--surface); color:var(--ink);">
          <option value="">All stages</option>
          ${STAGES.map((s) => `<option value="${s.id}" ${stageFilter === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
        </select>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Name</th><th>Industry</th><th>Stage</th><th>Location</th><th>Open deals</th><th>Contracts</th><th>Next action</th></tr></thead>
          <tbody>
            ${list.length === 0 ? `<tr><td colspan="7" class="empty-note">No customers match these filters.</td></tr>` : ""}
            ${list.map((c) => `
              <tr data-open-customer="${c.id}" style="cursor:pointer;">
                <td><strong>${esc(c.name)}</strong></td>
                <td>${industryBadge(c.industry)}</td>
                <td>${stagePill(c.stage)}</td>
                <td>${esc([c.location, c.country].filter(Boolean).join(", ")) || "—"}</td>
                <td class="mono">${c.open_deal_count}</td>
                <td class="mono">${c.active_contract_count}</td>
                <td class="mono">${c.next_action_date ? fmtDate(c.next_action_date) : "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  main.querySelectorAll("[data-open-customer]").forEach((el) => el.addEventListener("click", () => openCustomer(el.dataset.openCustomer)));
  main.querySelectorAll("[data-industry-filter]").forEach((el) => el.addEventListener("click", () => { industryFilter = el.dataset.industryFilter; render(); }));
  document.getElementById("addCustomerBtn").addEventListener("click", () => openNewCustomerModal());
  document.getElementById("customerSearch").addEventListener("input", (e) => { searchQuery = e.target.value; renderCustomers(main); });
  document.getElementById("stageFilterSelect").addEventListener("change", (e) => { stageFilter = e.target.value; render(); });
}

// ---------------------------------------------------------------------------
// Pipeline (kanban)
// ---------------------------------------------------------------------------
function renderPipeline(main) {
  const list = filteredCustomers().filter((c) => showClosedOnBoard || BOARD_STAGES.includes(c.stage) || c.stage === "on_hold");
  const cols = BOARD_STAGES.concat(["on_hold"]);
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>Pipeline</h1><p>Drag nothing — click a card to update its stage from the detail panel.</p></div>
        <button class="btn" id="addCustomerBtn">+ New customer</button>
      </div>
      ${industryFilterBar()}
      <div class="board-wrap">
        <div class="board">
          ${cols.map((stageId) => {
            const inCol = list.filter((c) => c.stage === stageId);
            return `
              <div class="col">
                <div class="col-head"><span class="t">${esc(stageLabel(stageId))}</span><span class="c">${inCol.length}</span></div>
                <div class="col-body">
                  ${inCol.map((c) => `
                    <div class="card" data-open-customer="${c.id}">
                      <div class="ct">${esc(c.name)}</div>
                      <div class="ci">${industryBadge(c.industry)}</div>
                      <div class="cf">
                        <span class="cd norm">${esc(c.location || c.country || "—")}</span>
                        ${c.next_action_date ? `<span class="cv">${fmtDate(c.next_action_date)}</span>` : ""}
                      </div>
                    </div>
                  `).join("")}
                  <button class="col-add" data-add-stage="${stageId}">+ Add customer</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;
  main.querySelectorAll("[data-open-customer]").forEach((el) => el.addEventListener("click", () => openCustomer(el.dataset.openCustomer)));
  main.querySelectorAll("[data-industry-filter]").forEach((el) => el.addEventListener("click", () => { industryFilter = el.dataset.industryFilter; render(); }));
  main.querySelectorAll("[data-add-stage]").forEach((el) => el.addEventListener("click", () => openNewCustomerModal(el.dataset.addStage)));
  document.getElementById("addCustomerBtn").addEventListener("click", () => openNewCustomerModal());
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
function renderQuotes(main) {
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>Quotes</h1><p>Service + frequency + rate line items, branded PDF export.</p></div>
        <button class="btn" id="addQuoteBtn">+ New quote</button>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Quote #</th><th>Customer</th><th>Industry</th><th>Status</th><th>Items</th><th>Total</th><th>Created</th></tr></thead>
          <tbody>
            ${quotes.length === 0 ? `<tr><td colspan="7" class="empty-note">No quotes yet.</td></tr>` : ""}
            ${quotes.map((q) => `
              <tr data-open-quote="${q.id}" style="cursor:pointer;">
                <td class="mono">${esc(q.quote_number || "—")}</td>
                <td><strong>${esc(q.customer_name)}</strong></td>
                <td>${industryBadge(q.customer_industry)}</td>
                <td>${quoteStatusPill(q.status)}</td>
                <td class="mono">${q.item_count}</td>
                <td class="mono">${fmtMoney(q.total)}</td>
                <td class="mono">${fmtDate(q.created_at)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  main.querySelectorAll("[data-open-quote]").forEach((el) => el.addEventListener("click", () => openQuote(el.dataset.openQuote)));
  document.getElementById("addQuoteBtn").addEventListener("click", () => openNewQuoteModal());
}
function quoteStatusPill(status) {
  const cls = status === "accepted" ? "good" : status === "rejected" || status === "expired" ? "crit" : status === "sent" ? "warn" : "neutral";
  return `<span class="pill ${cls}">${esc(status)}</span>`;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
function renderServices(main) {
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>Services</h1><p>The catalog quote line items are drawn from — one set across all four industries.</p></div>
        <button class="btn" id="addServiceBtn">+ New service</button>
      </div>
      ${["cleaning", "hygiene", "pest_control", "security", "other"].map((ind) => {
        const items = services.filter((s) => s.industry === ind);
        if (items.length === 0) return "";
        return `
          <div class="panel">
            <h2>${industryBadge(ind)} ${esc(industryLabel(ind))}</h2>
            <div class="tbl-wrap">
              <table>
                <thead><tr><th>Service</th><th>Unit</th><th>Default rate</th><th>Active</th><th></th></tr></thead>
                <tbody>
                  ${items.map((s) => `
                    <tr>
                      <td>${esc(s.name)}</td>
                      <td class="mono">${esc(s.unit)}</td>
                      <td class="mono">${fmtMoney(s.default_rate)}</td>
                      <td><input type="checkbox" data-toggle-service="${s.id}" ${s.active ? "checked" : ""}></td>
                      <td><button class="icon-btn" data-delete-service="${s.id}">✕</button></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
  document.getElementById("addServiceBtn").addEventListener("click", () => openNewServiceModal());
  main.querySelectorAll("[data-toggle-service]").forEach((el) => el.addEventListener("change", async (e) => {
    try {
      await api(`/services/${el.dataset.toggleService}`, { method: "PATCH", body: { active: e.target.checked } });
      await refreshServices();
      toast("Saved.");
    } catch (err) { toast(err.message); }
  }));
  main.querySelectorAll("[data-delete-service]").forEach((el) => el.addEventListener("click", async () => {
    if (!confirm("Delete this service? Past quotes keep their own copy of the name/rate.")) return;
    try {
      await api(`/services/${el.dataset.deleteService}`, { method: "DELETE" });
      await refreshServices();
      renderServices(main);
      toast("Service deleted.");
    } catch (err) { toast(err.message); }
  }));
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------
function renderContracts(main) {
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>Contracts</h1><p>Recurring service agreements across every customer — add one from a customer's detail panel.</p></div>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Title</th><th>Customer</th><th>Industry</th><th>Billing</th><th>Value</th><th>Ends</th><th>Status</th></tr></thead>
          <tbody>
            ${contracts.length === 0 ? `<tr><td colspan="7" class="empty-note">No contracts yet — add one from a customer's detail panel.</td></tr>` : ""}
            ${contracts.map((c) => `
              <tr data-open-customer="${c.customer_id}" style="cursor:pointer;">
                <td><strong>${esc(c.title)}</strong></td>
                <td>${esc(c.customer_name)}</td>
                <td>${industryBadge(c.customer_industry)}</td>
                <td class="mono">${esc(c.billing_frequency || "—")}</td>
                <td class="mono">${c.value ? fmtMoney(c.value) : "—"}</td>
                <td class="mono">${fmtDate(c.end_date)}</td>
                <td>${contractStatusPill(c.status)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  main.querySelectorAll("[data-open-customer]").forEach((el) => el.addEventListener("click", () => openCustomer(el.dataset.openCustomer)));
}
function contractStatusPill(status) {
  const cls = status === "active" ? "good" : status === "cancelled" ? "crit" : "neutral";
  return `<span class="pill ${cls}">${esc(status)}</span>`;
}

// ---------------------------------------------------------------------------
// Document Library
// ---------------------------------------------------------------------------
function fileIcon(mime) {
  if (!mime) return "📄";
  if (mime.includes("pdf")) return "📕";
  if (mime.includes("word") || mime.includes("document")) return "📘";
  if (mime.includes("sheet") || mime.includes("excel")) return "📗";
  if (mime.includes("image")) return "🖼️";
  return "📄";
}
function renderLibrary(main) {
  const docs = libraryTab === "all" ? libraryDocs : libraryDocs.filter((d) => d.category === libraryTab);
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>Document Library</h1><p>Company profiles, compliance certificates, financials, contracts and templates — all in one place.</p></div>
        <button class="btn" id="uploadDocBtn">+ Upload document</button>
      </div>
      <div class="lib-tabs">
        ${LIBRARY_CATEGORIES.map((c) => `<button class="lib-tab ${libraryTab === c.id ? "active" : ""}" data-lib-tab="${c.id}">${esc(c.label)}</button>`).join("")}
      </div>
      <div class="lib-grid">
        ${docs.length === 0 ? `<div class="empty-note">No documents in this category yet.</div>` : ""}
        ${docs.map((d) => `
          <div class="doc-card">
            <div class="doc-ic">${fileIcon(d.mimeType)}</div>
            <div class="doc-info">
              <div class="doc-title">${esc(d.title)}</div>
              <div class="doc-meta">${esc(d.filename)} · ${fmtBytes(d.fileSize)}</div>
              ${d.expiryDate ? (() => {
                const badge = expiryBadge(d.expiryDate);
                return badge
                  ? `<div class="doc-meta"><span class="pill ${badge.level}">${esc(badge.text)}</span></div>`
                  : `<div class="doc-meta">Expires ${fmtDate(d.expiryDate)}</div>`;
              })() : ""}
              ${d.notes ? `<div class="doc-notes">${esc(d.notes)}</div>` : ""}
            </div>
            <div class="doc-actions">
              <a class="btn secondary" href="/api/library/${d.id}/download" style="text-decoration:none;">Download</a>
              <button class="btn ghost" data-delete-doc="${d.id}">Delete</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
  main.querySelectorAll("[data-lib-tab]").forEach((el) => el.addEventListener("click", () => { libraryTab = el.dataset.libTab; renderLibrary(main); }));
  document.getElementById("uploadDocBtn").addEventListener("click", () => openUploadLibraryModal());
  main.querySelectorAll("[data-delete-doc]").forEach((el) => el.addEventListener("click", async () => {
    if (!confirm("Delete this document?")) return;
    try {
      await api(`/library/${el.dataset.deleteDoc}`, { method: "DELETE" });
      await refreshLibrary();
      renderLibrary(main);
      toast("Document deleted.");
    } catch (err) { toast(err.message); }
  }));
}

// ---------------------------------------------------------------------------
// Sheet (slide-over): customer detail
// ---------------------------------------------------------------------------
function closeSheet() {
  document.getElementById("sheet").classList.remove("open");
  document.getElementById("scrim").classList.remove("open");
  openCustomerId = null; openQuoteId = null; sheetMode = null;
  openCustomerDetail = null; openQuoteDetail = null;
}

async function openCustomer(id) {
  try {
    openCustomerDetail = await api(`/customers/${id}`);
  } catch (err) { return toast(err.message); }
  openCustomerId = id; sheetMode = "customer";
  renderCustomerSheet();
  document.getElementById("sheet").classList.add("open");
  document.getElementById("scrim").classList.add("open");
}

function renderCustomerSheet() {
  const c = openCustomerDetail;
  document.getElementById("tTitle").value = c.name;
  document.getElementById("tDelete").textContent = "Delete customer";
  document.getElementById("sheetSaveState").textContent = "Saved";
  document.getElementById("sheetBody").innerHTML = `
    <div class="row2">
      <div class="field"><label>Industry</label><select id="fIndustry">${industrySelectOptions(c.industry)}</select></div>
      <div class="field"><label>Stage</label><select id="fStage">${stageSelectOptions(c.stage)}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label>Country</label><input id="fCountry" value="${esc(c.country || "")}"></div>
      <div class="field"><label>Location</label><input id="fLocation" value="${esc(c.location || "")}"></div>
    </div>
    <div class="field"><label>Address</label><input id="fAddress" value="${esc(c.address || "")}"></div>
    <div class="row2">
      <div class="field"><label>Phone</label><input id="fPhone" value="${esc(c.phone || "")}"></div>
      <div class="field"><label>Email</label><input id="fEmail" value="${esc(c.email || "")}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Source</label><select id="fSource">${SOURCES.map((s) => `<option value="${s.id}" ${c.source === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>
      <div class="field"><label>Next action date</label><input type="date" id="fNextActionDate" value="${c.next_action_date ? c.next_action_date.substring(0, 10) : ""}"></div>
    </div>
    <div class="field"><label>Next action note</label><input id="fNextActionNote" value="${esc(c.next_action_note || "")}"></div>
    <div class="field"><label>Notes</label><textarea id="fNotes">${esc(c.notes || "")}</textarea></div>

    <div class="section-title">Contacts</div>
    ${c.contacts.map((p) => `
      <div class="chk-item">
        <div class="txt"><strong>${esc(p.name)}</strong>${p.is_primary ? " ⭐" : ""} ${p.role ? "— " + esc(p.role) : ""}<br><span style="color:var(--ink-faint); font-size:12px;">${esc([p.email, p.phone].filter(Boolean).join(" · "))}</span></div>
        <button class="chk-remove" data-delete-contact="${p.id}">✕</button>
      </div>
    `).join("") || '<div class="empty-note">No contacts yet.</div>'}
    <button class="btn secondary" id="addContactBtn" style="margin-top:8px;">+ Add contact</button>

    <div class="section-title">Deals</div>
    ${c.deals.map((d) => `
      <div class="chk-item">
        <div class="txt"><strong>${esc(d.title)}</strong> — ${esc(d.stage)} ${d.value ? "· " + fmtMoney(d.value) : ""}</div>
        <button class="chk-remove" data-delete-deal="${d.id}">✕</button>
      </div>
    `).join("") || '<div class="empty-note">No deals yet.</div>'}
    <button class="btn secondary" id="addDealBtn" style="margin-top:8px;">+ Add deal</button>

    <div class="section-title">Contracts</div>
    ${c.contracts.map((ct) => `
      <div class="chk-item">
        <div class="txt"><strong>${esc(ct.title)}</strong> — ${esc(ct.status)} ${ct.end_date ? "· ends " + fmtDate(ct.end_date) : ""}</div>
        <button class="chk-remove" data-delete-contract="${ct.id}">✕</button>
      </div>
    `).join("") || '<div class="empty-note">No contracts yet.</div>'}
    <button class="btn secondary" id="addContractBtn" style="margin-top:8px;">+ Add contract</button>

    <div class="section-title">Jobs</div>
    ${c.jobs.map((j) => `
      <div class="chk-item">
        <div class="txt"><strong>${esc(j.description)}</strong> — ${esc(j.status)} ${j.amount ? "· " + fmtMoney(j.amount) : ""} <span style="color:var(--ink-faint);">${fmtDate(j.job_date)}</span></div>
        <button class="chk-remove" data-delete-job="${j.id}">✕</button>
      </div>
    `).join("") || '<div class="empty-note">No jobs logged yet.</div>'}
    <button class="btn secondary" id="addJobBtn" style="margin-top:8px;">+ Add job</button>

    <div class="section-title">Activity</div>
    ${c.activities.map((a) => `
      <div class="chk-item">
        <div class="txt"><strong>${esc(a.type)}</strong> — ${esc(a.summary)} <span style="color:var(--ink-faint); font-size:12px;">${fmtDate(a.occurred_at)}</span></div>
        <button class="chk-remove" data-delete-activity="${a.id}">✕</button>
      </div>
    `).join("") || '<div class="empty-note">No activity logged yet.</div>'}
    <button class="btn secondary" id="addActivityBtn" style="margin-top:8px;">+ Log activity</button>

    <div class="section-title">Quotes</div>
    ${quotes.filter((q) => q.customer_id == c.id).map((q) => `
      <div class="chk-item" data-open-quote-link="${q.id}" style="cursor:pointer;">
        <div class="txt"><strong>${esc(q.quote_number)}</strong> — ${quoteStatusPill(q.status)} · ${fmtMoney(q.total)}</div>
      </div>
    `).join("") || '<div class="empty-note">No quotes for this customer yet.</div>'}
    <button class="btn secondary" id="addQuoteForCustomerBtn" style="margin-top:8px;">+ New quote</button>
  `;
  wireCustomerSheetEvents();
}

function wireCustomerSheetEvents() {
  const c = openCustomerDetail;
  const debouncedSave = (fields) => {
    clearTimeout(saveTimer);
    document.getElementById("sheetSaveState").textContent = "Saving…";
    saveTimer = setTimeout(async () => {
      try {
        await api(`/customers/${c.id}`, { method: "PATCH", body: fields });
        await refreshCustomers();
        document.getElementById("sheetSaveState").textContent = "Saved";
      } catch (err) { toast(err.message); document.getElementById("sheetSaveState").textContent = "Error"; }
    }, 500);
  };

  document.getElementById("tTitle").addEventListener("input", (e) => debouncedSave({ name: e.target.value }));
  const fieldMap = { fIndustry: "industry", fStage: "stage", fCountry: "country", fLocation: "location", fAddress: "address", fPhone: "phone", fEmail: "email", fSource: "source", fNextActionDate: "next_action_date", fNextActionNote: "next_action_note", fNotes: "notes" };
  Object.keys(fieldMap).forEach((id) => {
    const el = document.getElementById(id);
    const evt = (el.tagName === "SELECT") ? "change" : "input";
    el.addEventListener(evt, () => debouncedSave({ [fieldMap[id]]: el.value }));
  });

  document.getElementById("tDelete").onclick = async () => {
    if (!confirm(`Delete ${c.name}? This also removes their contacts, deals, contracts, jobs and activity.`)) return;
    try {
      await api(`/customers/${c.id}`, { method: "DELETE" });
      await refreshCustomers();
      closeSheet();
      render();
      toast("Customer deleted.");
    } catch (err) { toast(err.message); }
  };
  document.getElementById("sheetClose").onclick = () => { closeSheet(); render(); };

  document.getElementById("addContactBtn").onclick = () => openModal("contact", c.id);
  document.getElementById("addDealBtn").onclick = () => openModal("deal", c.id);
  document.getElementById("addContractBtn").onclick = () => openModal("contract", c.id);
  document.getElementById("addJobBtn").onclick = () => openModal("job", c.id);
  document.getElementById("addActivityBtn").onclick = () => openModal("activity", c.id);
  document.getElementById("addQuoteForCustomerBtn").onclick = () => openNewQuoteModal(c.id);

  document.querySelectorAll("[data-delete-contact]").forEach((el) => el.addEventListener("click", async () => {
    try { openCustomerDetail = await api(`/customers/${c.id}/contacts/${el.dataset.deleteContact}`, { method: "DELETE" }); renderCustomerSheet(); } catch (err) { toast(err.message); }
  }));
  document.querySelectorAll("[data-delete-deal]").forEach((el) => el.addEventListener("click", async () => {
    try { openCustomerDetail = await api(`/customers/${c.id}/deals/${el.dataset.deleteDeal}`, { method: "DELETE" }); renderCustomerSheet(); } catch (err) { toast(err.message); }
  }));
  document.querySelectorAll("[data-delete-contract]").forEach((el) => el.addEventListener("click", async () => {
    try { openCustomerDetail = await api(`/customers/${c.id}/contracts/${el.dataset.deleteContract}`, { method: "DELETE" }); await refreshContracts(); renderCustomerSheet(); } catch (err) { toast(err.message); }
  }));
  document.querySelectorAll("[data-delete-job]").forEach((el) => el.addEventListener("click", async () => {
    try { openCustomerDetail = await api(`/customers/${c.id}/jobs/${el.dataset.deleteJob}`, { method: "DELETE" }); renderCustomerSheet(); } catch (err) { toast(err.message); }
  }));
  document.querySelectorAll("[data-delete-activity]").forEach((el) => el.addEventListener("click", async () => {
    try { openCustomerDetail = await api(`/customers/${c.id}/activities/${el.dataset.deleteActivity}`, { method: "DELETE" }); renderCustomerSheet(); } catch (err) { toast(err.message); }
  }));
  document.querySelectorAll("[data-open-quote-link]").forEach((el) => el.addEventListener("click", () => openQuote(el.dataset.openQuoteLink)));
}

// ---------------------------------------------------------------------------
// Sheet: quote detail
// ---------------------------------------------------------------------------
async function openQuote(id) {
  try {
    openQuoteDetail = await api(`/quotes/${id}`);
  } catch (err) { return toast(err.message); }
  openQuoteId = id; sheetMode = "quote";
  renderQuoteSheet();
  document.getElementById("sheet").classList.add("open");
  document.getElementById("scrim").classList.add("open");
}

function quoteItemTotals(q) {
  const subtotal = q.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.rate), 0);
  const calloutFee = Number(q.callout_fee) || 0;
  const vatPct = q.vat_pct != null ? Number(q.vat_pct) : null;
  const vatBase = subtotal + calloutFee;
  const vatAmount = vatPct != null ? (vatBase * vatPct) / 100 : 0;
  return { subtotal, calloutFee, vatPct, vatAmount, total: vatBase + vatAmount };
}

function renderQuoteSheet() {
  const q = openQuoteDetail;
  const t = quoteItemTotals(q);
  document.getElementById("tTitle").value = `${q.quote_number || "New quote"} — ${q.customer_name}`;
  document.getElementById("tDelete").textContent = "Delete quote";
  document.getElementById("sheetSaveState").textContent = "Saved";
  document.getElementById("sheetBody").innerHTML = `
    <div class="row2">
      <div class="field"><label>Status</label><select id="fQStatus">${QUOTE_STATUSES.map((s) => `<option value="${s}" ${q.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
      <div class="field"><label>Valid until</label><input type="date" id="fQValidUntil" value="${q.valid_until ? q.valid_until.substring(0, 10) : ""}"></div>
    </div>
    <div class="field"><label>Payment terms</label><input id="fQPaymentTerms" value="${esc(q.payment_terms || "")}"></div>
    <div class="field"><label>Site / service notes</label><textarea id="fQSiteNotes">${esc(q.site_notes || "")}</textarea></div>
    <div class="row2">
      <div class="field"><label>Call-out fee</label><input type="number" step="0.01" id="fQCalloutFee" value="${q.callout_fee || 0}"></div>
      <div class="field"><label>VAT % (blank = none)</label><input type="number" step="0.01" id="fQVat" value="${q.vat_pct != null ? q.vat_pct : ""}"></div>
    </div>

    <div class="section-title">Line items</div>
    <div class="items-tbl-wrap">
      <table class="items-tbl">
        <thead><tr><th>Service</th><th>Frequency</th><th>Qty</th><th>Rate</th><th>Total</th><th></th></tr></thead>
        <tbody>
          ${q.items.map((it) => `
            <tr>
              <td>${esc(it.service_name)}</td>
              <td>${esc(FREQUENCIES.find((f) => f.id === it.frequency)?.label || it.frequency)}</td>
              <td class="num">${it.quantity}</td>
              <td class="num">${fmtMoney(it.rate)}</td>
              <td class="num">${fmtMoney(it.quantity * it.rate)}</td>
              <td><button class="icon-btn" data-delete-item="${it.id}">✕</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="panel" style="margin-top:4px; padding:14px;">
      <div class="row2">
        <select id="newItemService"><option value="">Choose a service…</option>${services.filter((s) => s.active).map((s) => `<option value="${s.id}" data-rate="${s.default_rate}" data-unit="${esc(s.unit)}" data-name="${esc(s.name)}">${esc(industryLabel(s.industry))} — ${esc(s.name)}</option>`).join("")}</select>
        <select id="newItemFrequency">${FREQUENCIES.map((f) => `<option value="${f.id}">${esc(f.label)}</option>`).join("")}</select>
      </div>
      <div class="row3" style="margin-top:8px;">
        <input type="text" id="newItemName" placeholder="Or type a custom service name">
        <input type="number" step="1" id="newItemQty" placeholder="Qty" value="1">
        <input type="number" step="0.01" id="newItemRate" placeholder="Rate (R)">
      </div>
      <button class="btn secondary" id="addItemBtn" style="margin-top:10px;">+ Add line item</button>
    </div>

    <div class="quote-totals">
      <div class="line"><span>Subtotal</span><span>${fmtMoney(t.subtotal)}</span></div>
      ${t.calloutFee ? `<div class="line"><span>Call-out fee</span><span>${fmtMoney(t.calloutFee)}</span></div>` : ""}
      ${t.vatPct != null ? `<div class="line"><span>VAT (${t.vatPct}%)</span><span>${fmtMoney(t.vatAmount)}</span></div>` : ""}
      <div class="line total"><span>Total</span><span>${fmtMoney(t.total)}</span></div>
    </div>
    <a class="btn" href="/api/quotes/${q.id}/pdf" target="_blank" style="text-decoration:none; margin-top:14px;">Download PDF</a>
  `;
  wireQuoteSheetEvents();
}

function wireQuoteSheetEvents() {
  const q = openQuoteDetail;
  const debouncedSave = (fields) => {
    clearTimeout(saveTimer);
    document.getElementById("sheetSaveState").textContent = "Saving…";
    saveTimer = setTimeout(async () => {
      try {
        openQuoteDetail = await api(`/quotes/${q.id}`, { method: "PATCH", body: fields });
        await refreshQuotes();
        // Accepting a quote (or other status changes) can move the customer's
        // stage server-side (see routes/quotes.js) — keep the cached list in sync.
        if (Object.prototype.hasOwnProperty.call(fields, "status")) await refreshCustomers();
        document.getElementById("sheetSaveState").textContent = "Saved";
      } catch (err) { toast(err.message); document.getElementById("sheetSaveState").textContent = "Error"; }
    }, 500);
  };
  document.getElementById("fQStatus").addEventListener("change", (e) => debouncedSave({ status: e.target.value }));
  document.getElementById("fQValidUntil").addEventListener("change", (e) => debouncedSave({ valid_until: e.target.value }));
  document.getElementById("fQPaymentTerms").addEventListener("input", (e) => debouncedSave({ payment_terms: e.target.value }));
  document.getElementById("fQSiteNotes").addEventListener("input", (e) => debouncedSave({ site_notes: e.target.value }));
  document.getElementById("fQCalloutFee").addEventListener("input", (e) => debouncedSave({ callout_fee: e.target.value || 0 }));
  document.getElementById("fQVat").addEventListener("input", (e) => debouncedSave({ vat_pct: e.target.value }));

  document.getElementById("tDelete").onclick = async () => {
    if (!confirm("Delete this quote?")) return;
    try {
      await api(`/quotes/${q.id}`, { method: "DELETE" });
      await refreshQuotes();
      closeSheet();
      render();
      toast("Quote deleted.");
    } catch (err) { toast(err.message); }
  };
  document.getElementById("sheetClose").onclick = () => { closeSheet(); render(); };

  const serviceSelect = document.getElementById("newItemService");
  serviceSelect.addEventListener("change", () => {
    const opt = serviceSelect.selectedOptions[0];
    if (opt && opt.dataset.rate !== undefined) {
      document.getElementById("newItemRate").value = opt.dataset.rate;
      document.getElementById("newItemName").value = "";
    }
  });

  document.getElementById("addItemBtn").onclick = async () => {
    const opt = serviceSelect.selectedOptions[0];
    const customName = document.getElementById("newItemName").value.trim();
    const serviceName = customName || (opt && opt.dataset.name) || "";
    const rate = document.getElementById("newItemRate").value;
    if (!serviceName || rate === "") return toast("Choose a service (or type one) and enter a rate.");
    try {
      openQuoteDetail = await api(`/quotes/${q.id}/items`, {
        method: "POST",
        body: {
          service_id: serviceSelect.value || null,
          service_name: serviceName,
          frequency: document.getElementById("newItemFrequency").value,
          quantity: document.getElementById("newItemQty").value || 1,
          rate,
        },
      });
      await refreshQuotes();
      renderQuoteSheet();
    } catch (err) { toast(err.message); }
  };

  document.querySelectorAll("[data-delete-item]").forEach((el) => el.addEventListener("click", async () => {
    try {
      openQuoteDetail = await api(`/quotes/${q.id}/items/${el.dataset.deleteItem}`, { method: "DELETE" });
      await refreshQuotes();
      renderQuoteSheet();
    } catch (err) { toast(err.message); }
  }));
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function openModalRaw(html) {
  document.getElementById("modalBody").innerHTML = html;
  document.getElementById("modalScrim").classList.add("open");
}
function closeModal() {
  document.getElementById("modalScrim").classList.remove("open");
  document.getElementById("modalBody").innerHTML = "";
}

function openNewCustomerModal(presetStage) {
  openModalRaw(`
    <h3>New customer</h3>
    <div class="field"><label>Name</label><input id="mName" autofocus></div>
    <div class="row2">
      <div class="field"><label>Industry</label><select id="mIndustry">${industrySelectOptions("")}</select></div>
      <div class="field"><label>Source</label><select id="mSource">${SOURCES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join("")}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label>Country</label><input id="mCountry" value="South Africa"></div>
      <div class="field"><label>Location</label><input id="mLocation"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Phone</label><input id="mPhone"></div>
      <div class="field"><label>Email</label><input id="mEmail"></div>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px;">
      <button class="btn secondary" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Add customer</button>
    </div>
  `);
  document.getElementById("mCancel").onclick = closeModal;
  document.getElementById("mSave").onclick = async () => {
    const name = document.getElementById("mName").value.trim();
    if (!name) return toast("A name is required.");
    try {
      const created = await api("/customers", {
        method: "POST",
        body: {
          name,
          industry: document.getElementById("mIndustry").value || null,
          source: document.getElementById("mSource").value,
          stage: presetStage || "new",
          country: document.getElementById("mCountry").value || null,
          location: document.getElementById("mLocation").value || null,
          phone: document.getElementById("mPhone").value || null,
          email: document.getElementById("mEmail").value || null,
        },
      });
      await refreshCustomers();
      closeModal();
      render();
      toast("Customer added.");
      openCustomer(created.id);
    } catch (err) { toast(err.message); }
  };
}

function openModal(kind, customerId) {
  if (kind === "contact") return openContactModal(customerId);
  if (kind === "deal") return openDealModal(customerId);
  if (kind === "contract") return openContractModal(customerId);
  if (kind === "job") return openJobModal(customerId);
  if (kind === "activity") return openActivityModal(customerId);
}

function openContactModal(customerId) {
  openModalRaw(`
    <h3>Add contact</h3>
    <div class="field"><label>Name</label><input id="mName" autofocus></div>
    <div class="row2">
      <div class="field"><label>Role</label><input id="mRole"></div>
      <div class="field"><label>Phone</label><input id="mPhone"></div>
    </div>
    <div class="field"><label>Email</label><input id="mEmail"></div>
    <div class="chk-item"><input type="checkbox" id="mPrimary"><label for="mPrimary" style="margin:0;">Primary contact</label></div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:12px;">
      <button class="btn secondary" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Add contact</button>
    </div>
  `);
  document.getElementById("mCancel").onclick = closeModal;
  document.getElementById("mSave").onclick = async () => {
    const name = document.getElementById("mName").value.trim();
    if (!name) return toast("A name is required.");
    try {
      openCustomerDetail = await api(`/customers/${customerId}/contacts`, {
        method: "POST",
        body: { name, role: document.getElementById("mRole").value, phone: document.getElementById("mPhone").value, email: document.getElementById("mEmail").value, is_primary: document.getElementById("mPrimary").checked },
      });
      closeModal();
      renderCustomerSheet();
      toast("Contact added.");
    } catch (err) { toast(err.message); }
  };
}

function openDealModal(customerId) {
  openModalRaw(`
    <h3>Add deal</h3>
    <div class="field"><label>Title</label><input id="mTitle" autofocus></div>
    <div class="row2">
      <div class="field"><label>Stage</label><select id="mStage">${DEAL_STAGES.map((s) => `<option value="${s}">${esc(s)}</option>`).join("")}</select></div>
      <div class="field"><label>Value (R)</label><input type="number" step="0.01" id="mValue"></div>
    </div>
    <div class="field"><label>Expected close date</label><input type="date" id="mCloseDate"></div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px;">
      <button class="btn secondary" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Add deal</button>
    </div>
  `);
  document.getElementById("mCancel").onclick = closeModal;
  document.getElementById("mSave").onclick = async () => {
    const title = document.getElementById("mTitle").value.trim();
    if (!title) return toast("A title is required.");
    try {
      openCustomerDetail = await api(`/customers/${customerId}/deals`, {
        method: "POST",
        body: { title, stage: document.getElementById("mStage").value, value: document.getElementById("mValue").value || null, expected_close_date: document.getElementById("mCloseDate").value || null },
      });
      closeModal();
      renderCustomerSheet();
      toast("Deal added.");
    } catch (err) { toast(err.message); }
  };
}

function openContractModal(customerId) {
  openModalRaw(`
    <h3>Add contract</h3>
    <div class="field"><label>Title</label><input id="mTitle" placeholder="e.g. Monthly office cleaning agreement" autofocus></div>
    <div class="row2">
      <div class="field"><label>Start date</label><input type="date" id="mStart"></div>
      <div class="field"><label>End date</label><input type="date" id="mEnd"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Value (R)</label><input type="number" step="0.01" id="mValue"></div>
      <div class="field"><label>Billing frequency</label><select id="mBilling"><option value="">—</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></div>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px;">
      <button class="btn secondary" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Add contract</button>
    </div>
  `);
  document.getElementById("mCancel").onclick = closeModal;
  document.getElementById("mSave").onclick = async () => {
    const title = document.getElementById("mTitle").value.trim();
    if (!title) return toast("A title is required.");
    try {
      openCustomerDetail = await api(`/customers/${customerId}/contracts`, {
        method: "POST",
        body: { title, start_date: document.getElementById("mStart").value || null, end_date: document.getElementById("mEnd").value || null, value: document.getElementById("mValue").value || null, billing_frequency: document.getElementById("mBilling").value || null },
      });
      await refreshContracts();
      closeModal();
      renderCustomerSheet();
      toast("Contract added.");
    } catch (err) { toast(err.message); }
  };
}

function openJobModal(customerId) {
  openModalRaw(`
    <h3>Add job</h3>
    <div class="field"><label>Description</label><input id="mDesc" placeholder="e.g. Fumigation visit" autofocus></div>
    <div class="row2">
      <div class="field"><label>Amount (R)</label><input type="number" step="0.01" id="mAmount"></div>
      <div class="field"><label>Job date</label><input type="date" id="mDate"></div>
    </div>
    <div class="field"><label>Status</label><select id="mStatus"><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px;">
      <button class="btn secondary" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Add job</button>
    </div>
  `);
  document.getElementById("mCancel").onclick = closeModal;
  document.getElementById("mSave").onclick = async () => {
    const description = document.getElementById("mDesc").value.trim();
    if (!description) return toast("A description is required.");
    try {
      openCustomerDetail = await api(`/customers/${customerId}/jobs`, {
        method: "POST",
        body: { description, amount: document.getElementById("mAmount").value || 0, job_date: document.getElementById("mDate").value || null, status: document.getElementById("mStatus").value },
      });
      closeModal();
      renderCustomerSheet();
      toast("Job added.");
    } catch (err) { toast(err.message); }
  };
}

function openActivityModal(customerId) {
  openModalRaw(`
    <h3>Log activity</h3>
    <div class="field"><label>Type</label><select id="mType">${ACTIVITY_TYPES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join("")}</select></div>
    <div class="field"><label>Summary</label><textarea id="mSummary" autofocus></textarea></div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px;">
      <button class="btn secondary" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Log it</button>
    </div>
  `);
  document.getElementById("mCancel").onclick = closeModal;
  document.getElementById("mSave").onclick = async () => {
    const summary = document.getElementById("mSummary").value.trim();
    if (!summary) return toast("A summary is required.");
    try {
      openCustomerDetail = await api(`/customers/${customerId}/activities`, {
        method: "POST",
        body: { type: document.getElementById("mType").value, summary },
      });
      await refreshCustomers();
      closeModal();
      renderCustomerSheet();
      toast("Activity logged.");
    } catch (err) { toast(err.message); }
  };
}

function openNewQuoteModal(presetCustomerId) {
  openModalRaw(`
    <h3>New quote</h3>
    <div class="field"><label>Customer</label>
      <select id="mCustomer" autofocus>
        <option value="">Choose a customer…</option>
        ${customers.map((c) => `<option value="${c.id}" ${presetCustomerId == c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>Payment terms</label><input id="mTerms" placeholder="e.g. 30 days from invoice"></div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px;">
      <button class="btn secondary" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Create quote</button>
    </div>
  `);
  document.getElementById("mCancel").onclick = closeModal;
  document.getElementById("mSave").onclick = async () => {
    const customerId = document.getElementById("mCustomer").value;
    if (!customerId) return toast("Choose a customer.");
    try {
      const created = await api("/quotes", { method: "POST", body: { customer_id: customerId, payment_terms: document.getElementById("mTerms").value || null } });
      await refreshQuotes();
      await refreshCustomers();
      closeModal();
      render();
      toast("Quote created — add line items.");
      openQuote(created.id);
    } catch (err) { toast(err.message); }
  };
}

function openNewServiceModal() {
  openModalRaw(`
    <h3>New service</h3>
    <div class="field"><label>Name</label><input id="mName" autofocus></div>
    <div class="row2">
      <div class="field"><label>Industry</label><select id="mIndustry">${INDUSTRIES.map((i) => `<option value="${i.id}">${esc(i.label)}</option>`).join("")}</select></div>
      <div class="field"><label>Unit</label><input id="mUnit" placeholder="e.g. per clean, per month"></div>
    </div>
    <div class="field"><label>Default rate (R)</label><input type="number" step="0.01" id="mRate" value="0"></div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px;">
      <button class="btn secondary" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Add service</button>
    </div>
  `);
  document.getElementById("mCancel").onclick = closeModal;
  document.getElementById("mSave").onclick = async () => {
    const name = document.getElementById("mName").value.trim();
    if (!name) return toast("A name is required.");
    try {
      await api("/services", { method: "POST", body: { name, industry: document.getElementById("mIndustry").value, unit: document.getElementById("mUnit").value || "service", default_rate: document.getElementById("mRate").value || 0 } });
      await refreshServices();
      closeModal();
      render();
      toast("Service added.");
    } catch (err) { toast(err.message); }
  };
}

function openUploadLibraryModal() {
  openModalRaw(`
    <h3>Upload document</h3>
    <div class="field"><label>Category</label>
      <select id="mCategory">${LIBRARY_CATEGORIES.filter((c) => c.id !== "all").map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select>
    </div>
    <div class="field"><label>Title (optional — defaults to filename)</label><input id="mTitle"></div>
    <div class="field"><label>File</label><input type="file" id="mFile"></div>
    <div class="field"><label>Expiry date (optional — for certificates/licenses)</label><input type="date" id="mExpiry"></div>
    <div class="field"><label>Notes</label><textarea id="mNotes"></textarea></div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px;">
      <button class="btn secondary" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Upload</button>
    </div>
  `);
  document.getElementById("mCancel").onclick = closeModal;
  document.getElementById("mSave").onclick = async () => {
    const fileInput = document.getElementById("mFile");
    if (!fileInput.files[0]) return toast("Choose a file.");
    const fd = new FormData();
    fd.append("file", fileInput.files[0]);
    fd.append("category", document.getElementById("mCategory").value);
    fd.append("title", document.getElementById("mTitle").value);
    fd.append("notes", document.getElementById("mNotes").value);
    fd.append("expiryDate", document.getElementById("mExpiry").value);
    try {
      const res = await fetch("/api/library", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      await refreshLibrary();
      closeModal();
      render();
      toast("Document uploaded.");
    } catch (err) { toast(err.message); }
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.getElementById("railNav").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  view = btn.dataset.view;
  // Dashboard numbers (follow-ups, contract renewals, expiring documents) are
  // only as fresh as the last fetch — re-pull them every time someone opens
  // this tab instead of showing whatever was cached at login.
  if (view === "dashboard") {
    try { await refreshDashboard(); } catch (err) { toast(err.message); }
  }
  render();
});
document.getElementById("sheetClose").addEventListener("click", () => { closeSheet(); render(); });
document.getElementById("scrim").addEventListener("click", () => { closeSheet(); render(); });
document.getElementById("modalScrim").addEventListener("click", (e) => { if (e.target.id === "modalScrim") closeModal(); });
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" });
  window.location.href = "/login";
});

const THEME_KEY = "imani-theme";
function applyTheme(t) {
  if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
}
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  applyTheme(saved);
})();
document.getElementById("themeToggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
});

(async function init() {
  try {
    await loadAll();
    render();
  } catch (err) {
    if (err.message === "Not signed in." || err.message.includes("session expired")) {
      window.location.href = "/login";
    } else {
      toast(err.message);
    }
  }
})();

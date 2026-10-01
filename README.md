# Imani Business Enterprise — Business Suite

Pricing & Quotation, Sales & Marketing, and a CRM — combined into **one app**,
for Imani Business Enterprise's four service lines: **Cleaning**, **Hygiene**,
**Pest Control**, and **Security**.

This is a brand-new, fully independent application — a completely separate
company from any other business this toolkit was previously built for, with
its own database, its own login, and its own deployment. Nothing here is
shared with anything else.

Plain Node.js + Express + PostgreSQL. No build step, no framework lock-in —
one small server, a handful of SQL tables, and a static front end. Anyone who
knows basic JavaScript can read the whole thing in an afternoon.

## Why one app, not three

The old approach (used for a previous client) was three separate apps —
Pricing & Quotation, Sales & Marketing, and a CRM — that happened to share a
database and quietly read each other's tables. That meant three logins, three
things to deploy, and prospects that had to be manually "imported" from one
system into another once they were won.

This is the opposite: **one login, one sidebar, one `customers` table.** A
lead starts in the pipeline, gets a quote, and — the moment that quote is
marked accepted — automatically becomes an active, invoiced customer, all as
the same record. Nothing to import, nothing to keep in sync.

## What's in here

```
db/
  schema.sql      the tables this app uses
  migrate.js      creates/updates them (safe to run more than once — also
                   called automatically every time the app starts, see below)
  seed.js         creates your first login and pre-loads a starter service
                   catalog across all four industries (also runs
                   automatically on every start)
src/
  server.js       the Express app (routes, static files, auth wiring,
                   self-migration on boot)
  auth.js         login / logout / session cookie handling
  db.js           the Postgres connection pool
  pdf.js          renders the branded quotation PDF
  routes/
    customers.js    customers, contacts, deals, contracts, jobs, activity —
                     everything about one customer lives under this router
    services.js     the service catalog quotes are built from
    quotes.js       quotes + service/frequency/rate line items + PDF export
    contracts.js    a read-only, cross-customer view for the Contracts tab
    library.js      Document Library: upload, list, download, delete
    dashboard.js    the numbers behind the Dashboard tab
public/           the front end (plain HTML/CSS/JS, no build step)
  brand/
    imani-leaf.png  the Imani leaf mark, cleaned up for crisp display at
                     icon size (see "About the logo" below)
  vendor/
    chart.umd.min.js  Chart.js, vendored locally (no external CDN call at
                       runtime — one less thing that can break in production)
```

## Running it locally

You'll need Node.js 18+ and a Postgres database (a free one from
[Neon](https://neon.tech) or [Supabase](https://supabase.com) takes about two
minutes to set up if you don't already have Postgres installed — just copy
the connection string it gives you).

```bash
npm install
cp .env.example .env
# edit .env: paste your DATABASE_URL, set a real JWT_SECRET,
# and choose your ADMIN_USERNAME / ADMIN_PASSWORD

npm start             # or `npm run dev` for auto-restart while editing
```

The app brings the database schema up to date and creates your login
automatically the moment it starts (see "Self-migrating on boot" below) — you
don't need to run `db:migrate` or `db:seed` by hand unless you want to.

Open `http://localhost:3000`, sign in with the username/password you put in
`.env`, and you're in.

## Self-migrating on boot

Every time this app starts, it checks the database schema is up to date and
creates the login if it doesn't exist yet — automatically, before it starts
accepting requests. Every statement involved is safe to run repeatedly
(`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO UPDATE`), so restarting or
redeploying never duplicates data or breaks anything. This matters because
Render's free tier has no shell access to run one-off commands — so this is
what makes it possible to deploy just by pushing code, with no separate
manual step. `db:migrate` and `db:seed` still work standalone too, if you
ever want to run them by hand.

## Deploying it (brand new — its own everything)

Because this is a new, separate company, it needs its **own** GitHub
repository, its **own** Postgres database, and its **own** Render (or
Railway/Heroku) web service — nothing here is shared with any other app.

1. **Create a new GitHub repository** (e.g. `imani-suite`) and push this
   folder to it. If you're using GitHub Desktop: File → New Repository,
   point it at this exact folder (don't create a subfolder first — picking
   a fresh, empty location and then dragging these files in is the most
   common way this goes wrong), then Publish.
2. **Create a new Postgres database.** Neon, Supabase, or Render's own
   Postgres add-on all work — copy the connection string it gives you. This
   must be a **new** database, not one already used for anything else.
3. **Create a new "Web Service"** on Render (or your platform of choice)
   from that GitHub repository, and set these environment variables in the
   platform's dashboard (same names as `.env`): `DATABASE_URL`,
   `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `NODE_ENV=production`.
4. Set the build command to `npm install` and the start command to
   `npm start`.
5. That's it — no separate migrate/seed step. The app sets itself up on
   first boot (see "Self-migrating on boot" above).

If you're deploying to **Vercel** specifically: Vercel runs Node as
short-lived serverless functions rather than a long-lived server, so this
Express app would need a thin wrapper to run there. Render or Railway are the
simpler fit for this project as-is.

## About the logo

The uploaded Imani logo file is very high-resolution (6052×3906px) but the
artwork itself is soft/blurry at that size — it looks like it was scaled up
from a much smaller original at some point before being uploaded. The leaf
icon has been cropped out, cleaned up, and carefully downsized to the small
sizes this app actually displays it at (sidebar, login page, PDF header,
browser tab icon), which hides most of the softness — it reads cleanly as a
leaf at every size used here. The "Imani Business Enterprise" wordmark itself
is set in real text (not the blurry raster) everywhere in the app, so it's
always sharp.

If a vector version of the logo (an .ai, .eps, or .svg file) or a larger,
sharper source photo/export exists, swapping `public/brand/imani-leaf.png`
for a cleaner crop is a one-file change — nothing else needs to change.

## How the data is organized

Eleven tables, defined in `db/schema.sql`:

- **`users`** — just enough for login: a username and a hashed password.
- **`customers`** — one row per company or person Imani has a relationship
  with, at any stage from a fresh lead to a long-standing client. `stage`
  is the single funnel: `new` → `contacted` → `in_conversation` →
  `quoted` → `won` (an active client), with `on_hold`, `lost`, and
  `inactive` as the side exits. `industry` tags which of the four service
  lines they're in.
- **`contacts`** — the people at a customer (site manager, procurement,
  accounts), each with their own details.
- **`services`** — the catalog quote line items are drawn from: a named
  service (e.g. "Office deep clean"), which industry it belongs to, a unit,
  and a default rate.
- **`deals`** — the opportunity pipeline for a customer: new → qualifying →
  quoted → negotiating → won/lost.
- **`quotes`** / **`quote_items`** — a quote belongs to one customer; each
  line item is **service + frequency + rate** (e.g. "Security guard, 12hr
  shift" / Monthly / R8,000, quantity 2 guards) rather than a generic
  product/quantity model, so it fits all four service lines without
  forcing a fuel-style "litres" shape onto a cleaning or security quote.
- **`contracts`** — recurring service agreements, with a renewal date so
  nothing lapses by surprise.
- **`service_jobs`** — actual completed/scheduled work (a clean that
  happened, a fumigation visit, a guard shift), feeding the revenue
  numbers on the Dashboard.
- **`activities`** — the shared timeline: calls, emails, WhatsApp, meetings,
  site visits and notes, covering both cold-outreach logging and ongoing
  account management on the same customer record.
- **`library_documents`** — the Document Library: company profiles,
  compliance certificates (e.g. PSIRA registration for Security, health
  permits for Hygiene/Cleaning), financials, legal/contracts, and
  templates — stored as bytes right in the database (not on disk —
  Render's free-tier disk doesn't survive a restart, the database does),
  with an optional expiry date so a lapsing certificate doesn't sneak up.

Every foreign key here is a **real** foreign key — unlike a multi-app setup
sharing one database, there's no need for "no FK on purpose, this table
belongs to a different app" workarounds, since everything lives in one
schema.

## The tabs

- **Dashboard** — active customers, open prospects, open deal value, and
  revenue (last 30 days), plus three charts (deals by stage, customers by
  industry, quotes by status), a short list of rule-based recommendations,
  a "needs attention" panel (follow-ups due, contracts renewing soon), and
  a recent activity feed.
- **Customers** — every prospect and client, filterable by industry and
  stage, searchable by name/country/location. Click through to a detail
  panel with contacts, deals, contracts, jobs, activity, and any quotes for
  that customer, all editable in place (autosaves as you type).
- **Pipeline** — the same customers as a kanban board across the five main
  stages, filterable by industry, with a quick "+ Add customer" per column.
- **Quotes** — every quote, its status, and its total. "+ New quote" picks
  a customer and opens a line-item editor: choose a service (which fills
  in its default rate) or type a custom one, pick a frequency, set
  quantity and rate. Marking a quote **Accepted** automatically moves its
  customer to the Won stage. "Download PDF" produces a branded quotation.
- **Services** — the catalog, grouped by industry, with inline rate/unit
  editing and an active/inactive toggle (so retiring a service doesn't
  break the history of quotes that already used it — those keep their own
  snapshotted name and rate).
- **Contracts** — every recurring agreement across every customer, sorted
  by renewal date. Contracts themselves are added from a customer's detail
  panel; this view is for seeing all of them at a glance.
- **Document Library** — company profiles, compliance documents,
  financials, legal/contracts, and templates, each downloadable, with an
  optional expiry date for anything that needs renewing.

## Security notes for whoever hosts this

- Passwords are hashed with bcrypt — the plain password is never stored.
- Login sessions are a signed, `httpOnly` cookie (a JWT) — not readable by
  page scripts, and it can't be forged without `JWT_SECRET`. **Generate a
  real random value for `JWT_SECRET`** before deploying (see `.env.example`
  for the one-line command to generate one) — don't leave the placeholder.
- The login endpoint has a basic brute-force guard (10 attempts per 15
  minutes per IP, reset on server restart). That's adequate for a small
  internal tool; if this ever needs to withstand serious, sustained abuse,
  put a proper rate limiter or a login-attempt table in front of it
  instead.
- Every `/api/*` route except `/api/auth/login` requires a valid session —
  there's no way to read or write any data without signing in first.
- This ships with a single shared login. Everything one signed-in person
  does, everyone with that login can see and edit — there's no per-user
  ownership or permission levels yet. If several people need separate
  accounts (so you can tell who changed what), that's a natural next step:
  add a `created_by` column referencing `users.id` on `customers`, and
  check `req.user.sub` in the routes.

## Extending it

A few natural next steps, none of which require restructuring anything:

- **Per-user logins and permissions**, as noted above.
- **AI-assisted drafting** of proposals/cover letters/follow-up emails,
  the same way it was added to a previous client's app — it's an
  independent feature that bolts onto this schema cleanly (a `drafts`
  table, a route that calls Anthropic's API, a tab in the sidebar) if it's
  ever wanted here too.
- **Recurring job generation from contracts** — right now a contract and
  its jobs are entered separately; a contract could auto-generate its
  upcoming scheduled jobs based on its billing frequency.
- **SMS/WhatsApp reminders** for follow-ups and contract renewals, using
  the `next_action_date` and contract `end_date` fields that already exist.

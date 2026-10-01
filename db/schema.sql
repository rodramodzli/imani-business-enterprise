-- Imani Business Enterprise — unified schema. Safe to run more than once.
--
-- This is ONE app serving three functions that used to be three separate
-- Bovua systems (Pricing & Quotation, Sales & Marketing, CRM) — so unlike
-- those apps, there is no table-name prefixing and no "no FK on purpose"
-- soft links. A customer is a customer everywhere: the same row carries a
-- prospect from first contact through to an active, invoiced client.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per company or individual Imani has a relationship with, at any
-- stage — a fresh lead, someone mid-conversation, or a long-standing
-- client with active contracts. "stage" is the single funnel that replaces
-- SMP's prospect pipeline and CRM's separate active/inactive split:
-- new -> contacted -> in_conversation -> quoted -> won (an active client)
-- -> inactive (a client that's lapsed), with lost/on_hold as side exits.
CREATE TABLE IF NOT EXISTS customers (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  industry          TEXT CHECK (industry IN ('cleaning', 'hygiene', 'pest_control', 'security', 'other') OR industry IS NULL),
  country           TEXT,
  location          TEXT,
  address           TEXT,
  phone             TEXT,
  email             TEXT,
  website           TEXT,
  notes             TEXT,
  source            TEXT NOT NULL DEFAULT 'direct' CHECK (source IN ('referral', 'inbound', 'cold_outreach', 'direct', 'other')),
  stage             TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'in_conversation', 'quoted', 'won', 'on_hold', 'lost', 'inactive')),
  next_action_date  DATE,
  next_action_note  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_industry ON customers (industry);
CREATE INDEX IF NOT EXISTS idx_customers_stage    ON customers (stage);
CREATE INDEX IF NOT EXISTS idx_customers_country  ON customers (country);
CREATE INDEX IF NOT EXISTS idx_customers_next_action ON customers (next_action_date);

-- A customer can have several people — site manager, procurement, accounts.
CREATE TABLE IF NOT EXISTS contacts (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT,
  email       TEXT,
  phone       TEXT,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_customer ON contacts (customer_id);

-- The service catalog — replaces the old litres-of-fuel price list with
-- something that fits cleaning/hygiene/pest control/security: a named
-- service, which industry it belongs to, a unit of billing, and a default
-- rate that a quote line item can start from and then override.
CREATE TABLE IF NOT EXISTS services (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  industry      TEXT NOT NULL CHECK (industry IN ('cleaning', 'hygiene', 'pest_control', 'security', 'other')),
  unit          TEXT NOT NULL DEFAULT 'service',
  default_rate  NUMERIC NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_services_industry ON services (industry);

-- The deal/opportunity pipeline — generic stages since a deal can start
-- from a cold lead, a referral, or a direct enquiry.
CREATE TABLE IF NOT EXISTS deals (
  id                   SERIAL PRIMARY KEY,
  customer_id          INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  stage                TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'qualifying', 'quoted', 'negotiating', 'won', 'lost')),
  value                NUMERIC,
  expected_close_date  DATE,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deals_customer ON deals (customer_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage    ON deals (stage);

CREATE TABLE IF NOT EXISTS quotes (
  id              SERIAL PRIMARY KEY,
  quote_number    TEXT UNIQUE,
  customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  deal_id         INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  valid_until     DATE,
  payment_terms   TEXT,
  site_notes      TEXT,
  callout_fee     NUMERIC NOT NULL DEFAULT 0,
  vat_pct         NUMERIC, -- null = no VAT line on this quote
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes (customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status   ON quotes (status);

-- Line items are service + frequency + rate, not litres-of-fuel: e.g.
-- "Office deep clean" / once-off / R2,500, or "Security guard, 12hr shift"
-- / monthly contract / R8,000 per guard, quantity 4 guards.
CREATE TABLE IF NOT EXISTS quote_items (
  id            SERIAL PRIMARY KEY,
  quote_id      INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  service_id    INTEGER REFERENCES services(id) ON DELETE SET NULL,
  -- Snapshotted at the time the line was added, so a quote stays accurate
  -- even if the service catalog changes later.
  service_name  TEXT NOT NULL,
  frequency     TEXT NOT NULL DEFAULT 'once_off' CHECK (frequency IN ('once_off', 'weekly', 'monthly', 'quarterly', 'annual')),
  quantity      NUMERIC NOT NULL DEFAULT 1,
  rate          NUMERIC NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items (quote_id);

-- Supply/service agreements — the recurring-revenue record, important for
-- cleaning/security contracts especially, so renewal dates don't sneak up.
CREATE TABLE IF NOT EXISTS contracts (
  id                 SERIAL PRIMARY KEY,
  customer_id        INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  start_date         DATE,
  end_date           DATE,
  value              NUMERIC,
  billing_frequency  TEXT CHECK (billing_frequency IN ('weekly', 'monthly', 'quarterly', 'annual') OR billing_frequency IS NULL),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts (customer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts (end_date);

-- Actual jobs/deliveries — a once-off clean that happened, a fumigation
-- visit, a guard shift roster entry. Optionally tied to the deal or
-- contract that produced it.
CREATE TABLE IF NOT EXISTS service_jobs (
  id            SERIAL PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  deal_id       INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  contract_id   INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  description   TEXT NOT NULL,
  amount        NUMERIC NOT NULL DEFAULT 0,
  job_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_jobs_customer ON service_jobs (customer_id);
CREATE INDEX IF NOT EXISTS idx_service_jobs_status   ON service_jobs (status);

-- The activity timeline — covers both cold-outreach logging (SMP's job)
-- and ongoing account management (CRM's job), since it's the same
-- customer record now. Optionally linked to a specific contact or deal.
CREATE TABLE IF NOT EXISTS activities (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contact_id   INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id      INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  type         TEXT NOT NULL CHECK (type IN ('call', 'email', 'whatsapp', 'meeting', 'site_visit', 'note')),
  summary      TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_customer ON activities (customer_id);

-- Document Library — compliance certificates (PSIRA registration for
-- Security, health/hygiene permits, pest control chemical handling
-- licences, COIDA, insurance), company profiles, financials, contracts
-- and templates, all in one place and downloadable. Stored as bytes right
-- in the database (not on disk — Render's free-tier disk doesn't survive a
-- restart, the database does).
CREATE TABLE IF NOT EXISTS library_documents (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL CHECK (category IN ('company_profiles', 'compliance', 'financials', 'legal_contracts', 'templates')),
  title       TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  file_size   INTEGER NOT NULL,
  file_data   BYTEA NOT NULL,
  notes       TEXT,
  expiry_date DATE, -- optional — lets a compliance certificate flag its own renewal date
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_documents_category ON library_documents (category);

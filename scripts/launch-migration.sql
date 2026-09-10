-- ============================================================
-- LAUNCH MIGRATION — run once in Supabase SQL Editor
-- ============================================================

-- 1. Extend leads_cache with UTM fields (additive, safe)
ALTER TABLE leads_cache
  ADD COLUMN IF NOT EXISTS utm_source   TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium   TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_content  TEXT,
  ADD COLUMN IF NOT EXISTS utm_term     TEXT;

-- 2. Closers for the launch
CREATE TABLE IF NOT EXISTS launch_closers (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  activa        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Meetings synced from the reuniones sheet
CREATE TABLE IF NOT EXISTS launch_meetings (
  id             SERIAL PRIMARY KEY,
  external_id    TEXT UNIQUE,
  lead_email     TEXT,
  lead_phone     TEXT,
  coldcaller_id  INT REFERENCES cold_callers(id) ON DELETE SET NULL,
  meeting_date   TEXT,
  estado         TEXT,
  closer_name    TEXT,
  agendado_por   TEXT,
  nombre_cliente TEXT,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Sales registered by closers
CREATE TABLE IF NOT EXISTS launch_sales (
  id              SERIAL PRIMARY KEY,
  fecha           DATE NOT NULL,
  nombre          TEXT,
  apellido        TEXT,
  telefono        TEXT,
  email           TEXT,
  plataforma      TEXT,
  valor           NUMERIC(12,2),
  tipo_pago       TEXT,
  cash_collected  NUMERIC(12,2),
  closer_id       INT REFERENCES launch_closers(id) ON DELETE SET NULL,
  coldcaller_id   INT REFERENCES cold_callers(id) ON DELETE SET NULL,
  lead_email      TEXT,
  afiliado_email  TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  utm_content     TEXT,
  utm_term        TEXT,
  sheet_row       INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_launch_sales_closer     ON launch_sales(closer_id);
CREATE INDEX IF NOT EXISTS idx_launch_sales_coldcaller ON launch_sales(coldcaller_id);
CREATE INDEX IF NOT EXISTS idx_launch_sales_lead_email ON launch_sales(lead_email);
CREATE INDEX IF NOT EXISTS idx_launch_meetings_cc      ON launch_meetings(coldcaller_id);

-- 5. Setter column on sales (the person who set the meeting; cobrador stays in coldcaller_id)
ALTER TABLE launch_sales
  ADD COLUMN IF NOT EXISTS setter_id INT REFERENCES cold_callers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_launch_sales_setter ON launch_sales(setter_id);

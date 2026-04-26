-- School teacher roster (persistent across sessions)
CREATE TABLE IF NOT EXISTS school_roster (
  id           TEXT PRIMARY KEY,
  school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, email)
);
CREATE INDEX IF NOT EXISTS idx_school_roster_school ON school_roster(school_id);

-- Payment transactions (FedaPay)
CREATE TABLE IF NOT EXISTS payment_transactions (
  id             BIGSERIAL PRIMARY KEY,
  school_id      UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL UNIQUE,
  plan_code      TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  is_annual      BOOLEAN NOT NULL DEFAULT FALSE,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_school ON payment_transactions(school_id);

-- Slot exchange requests
CREATE TABLE IF NOT EXISTS slot_exchange_requests (
  id              BIGSERIAL PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  slot_id         UUID NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  requester_id    UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  holder_id       UUID REFERENCES teachers(id) ON DELETE SET NULL,
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  director_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_exchange_requests_session ON slot_exchange_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_exchange_requests_slot    ON slot_exchange_requests(slot_id);

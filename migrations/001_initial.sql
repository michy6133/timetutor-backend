-- ============================================================
-- TimeTutor — Migration initiale PostgreSQL
-- Schema sécurisé et scalable
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Fonction trigger updated_at ───────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── SCHOOLS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schools (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                      VARCHAR(255) NOT NULL,
  slug                      VARCHAR(100) UNIQUE NOT NULL,
  subscription_plan         VARCHAR(50)  NOT NULL DEFAULT 'trial'
                              CHECK (subscription_plan IN ('trial','starter','pro','enterprise')),
  subscription_expires_at   TIMESTAMPTZ,
  max_sessions              INTEGER NOT NULL DEFAULT 3,
  max_teachers_per_session  INTEGER NOT NULL DEFAULT 50,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER schools_updated_at
  BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── USERS (directors + super admins) ──────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID REFERENCES schools(id) ON DELETE CASCADE,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  full_name       VARCHAR(255) NOT NULL,
  role            VARCHAR(50)  NOT NULL DEFAULT 'director'
                    CHECK (role IN ('super_admin','director')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  email_verified  BOOLEAN NOT NULL DEFAULT false,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── SESSIONS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES users(id),
  name          VARCHAR(255) NOT NULL,
  academic_year VARCHAR(20)  NOT NULL,
  status        VARCHAR(50)  NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','open','closed','published')),
  deadline      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_school_id ON sessions(school_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status   ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_by ON sessions(created_by);

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── SESSION RULES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_rules (
  id                           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id                   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  min_slots_per_teacher        INTEGER NOT NULL DEFAULT 1,
  max_slots_per_teacher        INTEGER NOT NULL DEFAULT 20,
  allow_contact_request        BOOLEAN NOT NULL DEFAULT true,
  notify_director_on_selection BOOLEAN NOT NULL DEFAULT true,
  notify_director_on_contact   BOOLEAN NOT NULL DEFAULT true,
  auto_remind_after_days       INTEGER NOT NULL DEFAULT 3,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id)
);

CREATE TRIGGER session_rules_updated_at
  BEFORE UPDATE ON session_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── SUBJECTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subjects (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  color      VARCHAR(7) NOT NULL DEFAULT '#2563ff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, name)
);

CREATE INDEX IF NOT EXISTS idx_subjects_school_id ON subjects(school_id);

-- ─── TIME SLOTS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_slots (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  subject_id  UUID REFERENCES subjects(id) ON DELETE SET NULL,
  day_of_week VARCHAR(20) NOT NULL
                CHECK (day_of_week IN ('Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi')),
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  room        VARCHAR(100),
  status      VARCHAR(50) NOT NULL DEFAULT 'free'
                CHECK (status IN ('free','taken','validated')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_time_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_time_slots_session_id  ON time_slots(session_id);
CREATE INDEX IF NOT EXISTS idx_time_slots_status       ON time_slots(status);
CREATE INDEX IF NOT EXISTS idx_time_slots_subject_id   ON time_slots(subject_id);

CREATE TRIGGER time_slots_updated_at
  BEFORE UPDATE ON time_slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── TEACHERS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teachers (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id         UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  full_name          VARCHAR(255) NOT NULL,
  email              VARCHAR(255) NOT NULL,
  phone              VARCHAR(50),
  subject_ids        UUID[] NOT NULL DEFAULT '{}',
  invitation_sent_at TIMESTAMPTZ,
  last_seen_at       TIMESTAMPTZ,
  status             VARCHAR(50) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','done')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, email)
);

CREATE INDEX IF NOT EXISTS idx_teachers_session_id ON teachers(session_id);
CREATE INDEX IF NOT EXISTS idx_teachers_email      ON teachers(email);
CREATE INDEX IF NOT EXISTS idx_teachers_status     ON teachers(status);

CREATE TRIGGER teachers_updated_at
  BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── MAGIC TOKENS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS magic_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token       VARCHAR(255) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_magic_tokens_token      ON magic_tokens(token);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_teacher_id ON magic_tokens(teacher_id);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_expires_at ON magic_tokens(expires_at);

-- Auto-cleanup: expired tokens (run via pg_cron or scheduled job)
-- DELETE FROM magic_tokens WHERE expires_at < NOW() - INTERVAL '7 days';

-- ─── SLOT SELECTIONS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS slot_selections (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id      UUID NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  teacher_id   UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  selected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at TIMESTAMPTZ,
  validated_by UUID REFERENCES users(id),
  UNIQUE(slot_id)
);

CREATE INDEX IF NOT EXISTS idx_slot_selections_session_id  ON slot_selections(session_id);
CREATE INDEX IF NOT EXISTS idx_slot_selections_teacher_id  ON slot_selections(teacher_id);
CREATE INDEX IF NOT EXISTS idx_slot_selections_slot_id     ON slot_selections(slot_id);

-- ─── CONTACT REQUESTS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_requests (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id               UUID NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  requester_teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  target_teacher_id     UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  session_id            UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message               TEXT,
  status                VARCHAR(50) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_requests_slot_id   ON contact_requests(slot_id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_session_id ON contact_requests(session_id);

CREATE TRIGGER contact_requests_updated_at
  BEFORE UPDATE ON contact_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── NOTIFICATIONS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  type       VARCHAR(100) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  body       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read    ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ─── AUDIT LOG ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_type  VARCHAR(50) NOT NULL CHECK (actor_type IN ('user','teacher','system')),
  actor_id    UUID,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100),
  entity_id   UUID,
  metadata    JSONB NOT NULL DEFAULT '{}',
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id  ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id ON audit_log(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- ─── VIEWS ─────────────────────────────────────────────────

-- Session progress view
CREATE OR REPLACE VIEW v_session_progress AS
SELECT
  s.id AS session_id,
  s.name,
  s.status,
  s.deadline,
  s.school_id,
  COUNT(DISTINCT ts.id)                                              AS total_slots,
  COUNT(DISTINCT ts.id) FILTER (WHERE ts.status != 'free')          AS taken_slots,
  COUNT(DISTINCT ts.id) FILTER (WHERE ts.status = 'validated')      AS validated_slots,
  COUNT(DISTINCT t.id)                                               AS total_teachers,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status != 'pending')         AS responded_teachers,
  CASE WHEN COUNT(DISTINCT ts.id) = 0 THEN 0
    ELSE ROUND(
      100.0 * COUNT(DISTINCT ts.id) FILTER (WHERE ts.status != 'free')
      / COUNT(DISTINCT ts.id)
    )
  END AS coverage_pct
FROM sessions s
LEFT JOIN time_slots ts ON ts.session_id = s.id
LEFT JOIN teachers t ON t.session_id = s.id
GROUP BY s.id, s.name, s.status, s.deadline, s.school_id;

-- ─── SEED DATA (dev only) ──────────────────────────────────
-- Uncomment to seed a super admin for development
-- INSERT INTO users (email, password_hash, full_name, role)
-- VALUES ('admin@timetutor.app', crypt('admin1234', gen_salt('bf')), 'Super Admin', 'super_admin')
-- ON CONFLICT (email) DO NOTHING;

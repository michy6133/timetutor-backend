CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS plan_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  limits_json JSONB NOT NULL DEFAULT '{}',
  features_json JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER plan_definitions_updated_at
  BEFORE UPDATE ON plan_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS school_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
  plan_code VARCHAR(32) NOT NULL REFERENCES plan_definitions(code),
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('trial','active','past_due','canceled','expired')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  limits_override_json JSONB NOT NULL DEFAULT '{}',
  provider VARCHAR(32) DEFAULT 'manual',
  provider_subscription_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_subscriptions_status_end ON school_subscriptions(status, current_period_end);

CREATE TRIGGER school_subscriptions_updated_at
  BEFORE UPDATE ON school_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_school_created ON subscription_events(school_id, created_at DESC);

INSERT INTO plan_definitions (code, display_name, limits_json, features_json)
VALUES
  ('standard', 'Standard', '{"maxSchools":1,"maxSessionsPerSchool":5}', '{"pdfExport":false,"whatsappNotifications":false}'),
  ('pro', 'Pro', '{"maxSchools":3,"maxSessionsPerSchool":50}', '{"pdfExport":true,"whatsappNotifications":true}'),
  ('premium', 'Premium', '{"maxSchools":10,"maxSessionsPerSchool":500}', '{"pdfExport":true,"whatsappNotifications":true}')
ON CONFLICT (code) DO NOTHING;

INSERT INTO school_subscriptions (school_id, plan_code, status, current_period_end, limits_override_json)
SELECT
  s.id,
  CASE
    WHEN s.subscription_plan IN ('trial','starter') THEN 'standard'
    WHEN s.subscription_plan = 'pro' THEN 'pro'
    ELSE 'premium'
  END AS plan_code,
  CASE WHEN s.is_active THEN 'active' ELSE 'canceled' END AS status,
  s.subscription_expires_at,
  jsonb_build_object(
    'maxSessionsPerSchool', s.max_sessions,
    'maxTeachersPerSession', s.max_teachers_per_session
  )
FROM schools s
ON CONFLICT (school_id) DO NOTHING;

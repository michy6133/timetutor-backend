-- Multi-prof slot negotiation thread (one thread per contested slot)

ALTER TABLE time_slots DROP CONSTRAINT IF EXISTS time_slots_status_check;
ALTER TABLE time_slots
  ADD CONSTRAINT time_slots_status_check
  CHECK (status IN ('free', 'taken', 'locked', 'validated'));

CREATE TABLE IF NOT EXISTS slot_negotiations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_slot_id UUID NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'locked', 'cancelled')),
  locked_at TIMESTAMPTZ,
  created_by_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target_slot_id, status)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE IF NOT EXISTS slot_negotiation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id UUID NOT NULL REFERENCES slot_negotiations(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL DEFAULT 'requester'
    CHECK (role IN ('owner', 'requester')),
  desired_slot_id UUID REFERENCES time_slots(id) ON DELETE SET NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (negotiation_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_slot_negotiations_session ON slot_negotiations(session_id);
CREATE INDEX IF NOT EXISTS idx_slot_negotiations_status ON slot_negotiations(status);
CREATE INDEX IF NOT EXISTS idx_slot_negotiation_participants_negotiation ON slot_negotiation_participants(negotiation_id);
CREATE INDEX IF NOT EXISTS idx_slot_negotiation_participants_teacher ON slot_negotiation_participants(teacher_id);

CREATE TRIGGER slot_negotiations_updated_at
  BEFORE UPDATE ON slot_negotiations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

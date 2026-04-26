-- Subjects pre-registered per school + seed function + trigger

CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4F46E5',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system_template BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, name)
);

CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects(school_id);

-- Add missing columns if they don't exist (in case table was created without them)
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS is_system_template BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Seed function (same pattern as school_classes)
CREATE OR REPLACE FUNCTION seed_default_subjects(p_school_id UUID)
RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM subjects WHERE school_id = p_school_id LIMIT 1) THEN RETURN; END IF;
  INSERT INTO subjects (school_id, name, color, is_system_template, is_active)
  SELECT p_school_id, v.name, v.color, TRUE, TRUE
  FROM (VALUES
    ('Mathématiques','#4F46E5'),('Français','#22C55E'),('Anglais','#F59E0B'),
    ('SVT','#06B6D4'),('PCT','#8B5CF6'),('Histoire-Géographie','#EF4444'),
    ('Philosophie','#EC4899'),('EPS','#F97316'),('Informatique','#0EA5E9'),
    ('Économie','#84CC16'),('Espagnol','#6B7280')
  ) AS v(name, color);
END;
$$ LANGUAGE plpgsql;

-- Trigger on schools
CREATE OR REPLACE FUNCTION trg_schools_seed_subjects()
RETURNS TRIGGER AS $$
BEGIN PERFORM seed_default_subjects(NEW.id); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_schools_seed_subjects ON schools;
CREATE TRIGGER trg_schools_seed_subjects
  AFTER INSERT ON schools
  FOR EACH ROW
  EXECUTE PROCEDURE trg_schools_seed_subjects();

-- Seed for existing schools that have no subjects yet
INSERT INTO subjects (school_id, name, color, is_system_template, is_active)
SELECT s.id, v.name, v.color, TRUE, TRUE
FROM schools s
CROSS JOIN (VALUES
  ('Mathématiques','#4F46E5'),('Français','#22C55E'),('Anglais','#F59E0B'),
  ('SVT','#06B6D4'),('PCT','#8B5CF6'),('Histoire-Géographie','#EF4444'),
  ('Philosophie','#EC4899'),('EPS','#F97316'),('Informatique','#0EA5E9'),
  ('Économie','#84CC16'),('Espagnol','#6B7280')
) AS v(name, color)
WHERE NOT EXISTS (SELECT 1 FROM subjects sc WHERE sc.school_id = s.id)
ON CONFLICT (school_id, name) DO NOTHING;

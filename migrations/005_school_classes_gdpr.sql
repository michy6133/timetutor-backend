-- Classes par école (secondaire Bénin par défaut) + session liée + RGPD minimal

ALTER TABLE users ADD COLUMN IF NOT EXISTS gdpr_consent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS policy_ack_version VARCHAR(32);

CREATE TABLE IF NOT EXISTS school_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system_template BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, name)
);

CREATE INDEX IF NOT EXISTS idx_school_classes_school ON school_classes(school_id);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS school_class_id UUID REFERENCES school_classes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_school_class ON sessions(school_class_id);

-- Liste officielle secondaire (Bénin) — ordre d'affichage
CREATE OR REPLACE FUNCTION seed_default_school_classes(p_school_id UUID)
RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM school_classes WHERE school_id = p_school_id LIMIT 1) THEN
    RETURN;
  END IF;
  INSERT INTO school_classes (school_id, name, sort_order, is_system_template, is_active)
  SELECT p_school_id, v.name, v.ord, TRUE, TRUE
  FROM (VALUES
    ('6ème',1), ('5ème',2), ('4ème',3), ('3ème',4), ('Seconde',5),
    ('Première A',6), ('Première B',7), ('Première C',8), ('Première D',9), ('Première E',10),
    ('Première F1',11), ('Première F2',12), ('Première F3',13), ('Première F4',14),
    ('Première G1',15), ('Première G2',16), ('Première G3',17),
    ('Terminale A',18), ('Terminale B',19), ('Terminale C',20), ('Terminale D',21), ('Terminale E',22),
    ('Terminale F1',23), ('Terminale F2',24), ('Terminale F3',25), ('Terminale F4',26),
    ('Terminale G1',27), ('Terminale G2',28), ('Terminale G3',29)
  ) AS v(name, ord);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_schools_seed_classes()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_default_school_classes(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_schools_seed_classes ON schools;
CREATE TRIGGER trg_schools_seed_classes
  AFTER INSERT ON schools
  FOR EACH ROW
  EXECUTE PROCEDURE trg_schools_seed_classes();

-- Écoles existantes sans aucune classe
INSERT INTO school_classes (school_id, name, sort_order, is_system_template, is_active)
SELECT s.id, v.name, v.ord, TRUE, TRUE
FROM schools s
CROSS JOIN (VALUES
  ('6ème',1), ('5ème',2), ('4ème',3), ('3ème',4), ('Seconde',5),
  ('Première A',6), ('Première B',7), ('Première C',8), ('Première D',9), ('Première E',10),
  ('Première F1',11), ('Première F2',12), ('Première F3',13), ('Première F4',14),
  ('Première G1',15), ('Première G2',16), ('Première G3',17),
  ('Terminale A',18), ('Terminale B',19), ('Terminale C',20), ('Terminale D',21), ('Terminale E',22),
  ('Terminale F1',23), ('Terminale F2',24), ('Terminale F3',25), ('Terminale F4',26),
  ('Terminale G1',27), ('Terminale G2',28), ('Terminale G3',29)
) AS v(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM school_classes sc WHERE sc.school_id = s.id)
ON CONFLICT (school_id, name) DO NOTHING;

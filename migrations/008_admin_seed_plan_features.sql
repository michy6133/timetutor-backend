-- Add validity_days to plan_definitions if missing
ALTER TABLE plan_definitions ADD COLUMN IF NOT EXISTS validity_days INT NOT NULL DEFAULT 30;

-- Update plan_definitions with comprehensive features_json
UPDATE plan_definitions SET
  features_json = '{"pdfExport":true,"jpgExport":false,"csvImport":true,"slotGenerator":false,"gridDuplicate":true,"slotNegotiations":false,"whatsappNotifications":false}',
  validity_days = 30
WHERE code = 'standard';

UPDATE plan_definitions SET
  features_json = '{"pdfExport":true,"jpgExport":true,"csvImport":true,"slotGenerator":true,"gridDuplicate":true,"slotNegotiations":true,"whatsappNotifications":true}',
  validity_days = 30
WHERE code = 'pro';

UPDATE plan_definitions SET
  features_json = '{"pdfExport":true,"jpgExport":true,"csvImport":true,"slotGenerator":true,"gridDuplicate":true,"slotNegotiations":true,"whatsappNotifications":true}',
  validity_days = 365
WHERE code = 'premium';

-- Seed default super_admin user (password: Admin@TimeTutor2025)
INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified)
VALUES (
  'admin@timetutor.app',
  crypt('Admin@TimeTutor2025', gen_salt('bf', 12)),
  'Super Admin',
  'super_admin',
  true,
  true
)
ON CONFLICT (email) DO NOTHING;

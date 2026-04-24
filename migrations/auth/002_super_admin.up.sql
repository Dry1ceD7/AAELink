-- AAELink Auth Service — Super Admin role + identity flag
-- Migration: 002_super_admin
--
-- Adds a dedicated `super_admin` role, an `is_super_admin` boolean column on
-- users, and grants the new role every permission so it cannot accidentally
-- lose oversight when permission grants change. Both the role and the flag
-- are checked by the data isolation layer in downstream services so the
-- account always retains absolute, cross-departmental visibility.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_super_admin
  ON users (is_super_admin)
  WHERE is_super_admin = true AND deleted_at IS NULL;

INSERT INTO roles (name, display_name, description, is_system) VALUES
  ('super_admin',
   '{"en":"Super Admin","th":"ผู้ดูแลระบบสูงสุด","de":"Super-Administrator"}',
   'Absolute, cross-departmental oversight. Bypasses every data isolation rule.',
   true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

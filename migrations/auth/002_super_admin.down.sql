DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE name = 'super_admin');

DELETE FROM user_roles
WHERE role_id IN (SELECT id FROM roles WHERE name = 'super_admin');

DELETE FROM roles WHERE name = 'super_admin';

DROP INDEX IF EXISTS idx_users_super_admin;
ALTER TABLE users DROP COLUMN IF EXISTS is_super_admin;

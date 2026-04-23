-- AAELink Auth Service — Initial Schema
-- Migration: 001_init

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Departments ──────────────────────────────────────────────
CREATE TABLE departments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       JSONB NOT NULL,
  -- e.g. {"en":"IT Department","th":"แผนกไอที","de":"IT-Abteilung"}
  slug       VARCHAR(100) UNIQUE NOT NULL,
  is_it_dept BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            VARCHAR(255) UNIQUE NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  display_name     VARCHAR(255) NOT NULL,
  avatar_url       VARCHAR(500),
  department_id    UUID REFERENCES departments(id),
  preferred_locale VARCHAR(10) NOT NULL DEFAULT 'en',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_department ON users(department_id) WHERE deleted_at IS NULL;

-- ── Roles (extensible RBAC) ──────────────────────────────────
CREATE TABLE roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(50) UNIQUE NOT NULL,
  display_name JSONB NOT NULL,
  -- e.g. {"en":"IT Admin","th":"ผู้ดูแลระบบไอที","de":"IT-Admin"}
  description  TEXT,
  is_system    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource    VARCHAR(100) NOT NULL,
  action      VARCHAR(50)  NOT NULL,
  description TEXT,
  UNIQUE (resource, action)
);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id),
  assigned_by   UUID REFERENCES users(id),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

-- ── Sessions ─────────────────────────────────────────────────
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address  INET,
  user_agent  TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ── Seed: Roles ──────────────────────────────────────────────
INSERT INTO roles (name, display_name, description, is_system) VALUES
  ('it_admin',
   '{"en":"IT Admin","th":"ผู้ดูแลระบบไอที","de":"IT-Administrator"}',
   'Full system access — manages users, departments, system configuration',
   true),
  ('it_employee',
   '{"en":"IT Employee","th":"พนักงานไอที","de":"IT-Mitarbeiter"}',
   'IT department staff — receives and resolves tickets',
   true),
  ('employee',
   '{"en":"Employee","th":"พนักงาน","de":"Mitarbeiter"}',
   'Staff from any department — submits IT support tickets',
   true);

-- ── Seed: Permissions ────────────────────────────────────────
INSERT INTO permissions (resource, action, description) VALUES
  ('users',       'create',   'Create new user accounts'),
  ('users',       'read',     'View user information'),
  ('users',       'update',   'Update user accounts'),
  ('users',       'delete',   'Deactivate user accounts'),
  ('roles',       'manage',   'Create, update, delete roles'),
  ('departments', 'manage',   'Create, update departments'),
  ('tickets',     'create',   'Submit a new ticket'),
  ('tickets',     'read_own', 'View own tickets'),
  ('tickets',     'read_all', 'View all tickets'),
  ('tickets',     'assign',   'Assign tickets to IT staff'),
  ('tickets',     'update',   'Update ticket status and comments'),
  ('tickets',     'close',    'Close and archive tickets'),
  ('reports',     'view',     'View reports and analytics');

-- ── Seed: Role-Permission mappings ───────────────────────────
-- it_admin: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'it_admin';

-- it_employee: ticket read/update/close, own user read
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'it_employee'
  AND (p.resource, p.action) IN (
    ('tickets', 'read_all'),
    ('tickets', 'update'),
    ('tickets', 'assign'),
    ('tickets', 'close'),
    ('users',   'read')
  );

-- employee: create tickets, read own tickets
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'employee'
  AND (p.resource, p.action) IN (
    ('tickets', 'create'),
    ('tickets', 'read_own')
  );

-- ── Seed: IT Department ──────────────────────────────────────
INSERT INTO departments (name, slug, is_it_dept) VALUES
  ('{"en":"IT Department","th":"แผนกไอที","de":"IT-Abteilung"}',
   'it-department', true),
  ('{"en":"Production","th":"แผนกการผลิต","de":"Produktion"}',
   'production', false),
  ('{"en":"Quality Assurance","th":"แผนกควบคุมคุณภาพ","de":"Qualitätssicherung"}',
   'quality-assurance', false),
  ('{"en":"Human Resources","th":"แผนกทรัพยากรบุคคล","de":"Personalwesen"}',
   'human-resources', false),
  ('{"en":"Logistics","th":"แผนกโลจิสติกส์","de":"Logistik"}',
   'logistics', false),
  ('{"en":"Engineering","th":"แผนกวิศวกรรม","de":"Engineering"}',
   'engineering', false);

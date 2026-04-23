-- AAELink Ticket Service — Initial Schema
-- Migration: 001_init

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Categories ───────────────────────────────────────────────
CREATE TABLE ticket_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       JSONB NOT NULL,
  slug       VARCHAR(100) UNIQUE NOT NULL,
  icon       VARCHAR(50),
  sort_order INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true
);

-- ── Ticket Status & Priority ─────────────────────────────────
CREATE TYPE ticket_status AS ENUM (
  'open',
  'in_progress',
  'pending_employee',
  'resolved',
  'closed',
  'cancelled'
);

CREATE TYPE ticket_priority AS ENUM (
  'low',
  'medium',
  'high',
  'urgent'
);

-- ── Tickets ──────────────────────────────────────────────────
CREATE SEQUENCE ticket_number_seq START 1;

CREATE TABLE tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number        INT UNIQUE NOT NULL DEFAULT nextval('ticket_number_seq'),
  title         VARCHAR(500) NOT NULL,
  description   TEXT NOT NULL,
  status        ticket_status NOT NULL DEFAULT 'open',
  priority      ticket_priority NOT NULL DEFAULT 'medium',
  category_id   UUID REFERENCES ticket_categories(id),
  created_by    UUID NOT NULL,
  assigned_to   UUID,
  department_id UUID,
  resolved_at   TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ,
  auto_close_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_tickets_status     ON tickets(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tickets_created_by ON tickets(created_by) WHERE deleted_at IS NULL;
CREATE INDEX idx_tickets_assigned   ON tickets(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX idx_tickets_created_at ON tickets(created_at DESC) WHERE deleted_at IS NULL;

-- ── Comments ─────────────────────────────────────────────────
CREATE TABLE ticket_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  content     TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_comments_ticket ON ticket_comments(ticket_id);

-- ── File Attachments ─────────────────────────────────────────
CREATE TABLE ticket_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename    VARCHAR(500) NOT NULL,
  storage_key VARCHAR(500) UNIQUE NOT NULL,
  mime_type   VARCHAR(200),
  file_size   BIGINT,
  uploaded_by UUID NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_files_ticket ON ticket_files(ticket_id);

-- ── Audit Log ────────────────────────────────────────────────
CREATE TABLE ticket_audit_log (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL,
  action    VARCHAR(100) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_ticket    ON ticket_audit_log(ticket_id);
CREATE INDEX idx_audit_created   ON ticket_audit_log(created_at DESC);

-- ── Seed: Categories ─────────────────────────────────────────
INSERT INTO ticket_categories (name, slug, icon, sort_order) VALUES
  ('{"en":"Hardware","th":"ฮาร์ดแวร์","de":"Hardware"}',
   'hardware', 'monitor', 1),
  ('{"en":"Software","th":"ซอฟต์แวร์","de":"Software"}',
   'software', 'code', 2),
  ('{"en":"Network","th":"เครือข่าย","de":"Netzwerk"}',
   'network', 'wifi', 3),
  ('{"en":"Access & Permissions","th":"การเข้าถึงและสิทธิ์","de":"Zugriff & Berechtigungen"}',
   'access', 'lock', 4),
  ('{"en":"Telephone","th":"โทรศัพท์","de":"Telefon"}',
   'telephone', 'phone', 5),
  ('{"en":"Printer / Scanner","th":"เครื่องพิมพ์ / สแกนเนอร์","de":"Drucker / Scanner"}',
   'printer', 'printer', 6),
  ('{"en":"Other","th":"อื่นๆ","de":"Sonstiges"}',
   'other', 'help-circle', 7);

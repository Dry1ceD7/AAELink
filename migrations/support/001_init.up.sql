CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE support_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester       VARCHAR(255) NOT NULL,
  subject         VARCHAR(180) NOT NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'queued',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ
);

CREATE INDEX idx_support_requests_status_created
  ON support_requests (status, created_at DESC);

CREATE TABLE support_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  sender_kind  VARCHAR(32) NOT NULL,
  sender_label VARCHAR(255) NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_messages_request_created
  ON support_messages (request_id, created_at ASC);

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL,
  filename       VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(120) NOT NULL DEFAULT 'application/pdf',
  file_size      BIGINT NOT NULL DEFAULT 0,
  storage_key    TEXT NOT NULL,
  status         VARCHAR(32) NOT NULL DEFAULT 'uploaded',
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_owner_created ON documents (owner_id, created_at DESC);
CREATE INDEX idx_documents_status_created ON documents (status, created_at DESC);

CREATE TABLE document_operations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  operation      VARCHAR(64) NOT NULL,
  status         VARCHAR(32) NOT NULL DEFAULT 'queued',
  parameters     JSONB NOT NULL DEFAULT '{}',
  result_key     TEXT,
  error_message  TEXT,
  created_by     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_document_operations_document_created
  ON document_operations (document_id, created_at DESC);
CREATE INDEX idx_document_operations_status_created
  ON document_operations (status, created_at ASC);

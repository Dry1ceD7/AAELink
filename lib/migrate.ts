import { getPool } from './db'

let migrateOnce: Promise<void> | null = null

export function ensureSchema(): Promise<void> {
  if (!migrateOnce) {
    migrateOnce = run()
  }
  return migrateOnce
}

async function run() {
  const pool = getPool()
  if (!pool) return
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS aaelink;
    CREATE TABLE IF NOT EXISTS aaelink.tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS aaelink.documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size BIGINT NOT NULL,
      bucket_key TEXT NOT NULL UNIQUE,
      created_at BIGINT NOT NULL
    );
  `)
}

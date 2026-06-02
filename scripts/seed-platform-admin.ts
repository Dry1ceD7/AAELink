/**
 * One-shot bootstrap: platform super-admin user + default workspace when none exist.
 *
 * Usage (from repo root, with Postgres running and .env containing DATABASE_URL):
 *   AAELINK_SEED_ADMIN_PASSWORD='your-secure-password' npx tsx scripts/seed-platform-admin.ts
 *
 * Optional env:
 *   AAELINK_SEED_ADMIN_EMAIL (default adminaaelink@aae.co.th)
 *   AAELINK_SEED_ADMIN_USERNAME (default adminaaelink)
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getPool } from '../lib/infra/db'
import { ensureSchema } from '../lib/infra/migrate'
import { hashPassword } from '../lib/auth/password'
import { slugifySegment } from '../lib/ui/slug'

function applyEnvFile(envPath: string) {
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    process.env[k] = v
  }
}

/** Match Next: `.env` then `.env.local` (local overrides). */
function loadDotenv() {
  applyEnvFile(resolve(process.cwd(), '.env'))
  applyEnvFile(resolve(process.cwd(), '.env.local'))
}

async function main() {
  loadDotenv()
  const password = String(process.env.AAELINK_SEED_ADMIN_PASSWORD || '').trim()
  if (password.length < 8) {
    console.error('Set AAELINK_SEED_ADMIN_PASSWORD (min 8 characters) and run again.')
    process.exit(1)
  }
  const email = String(process.env.AAELINK_SEED_ADMIN_EMAIL || 'adminaaelink@aae.co.th').trim()
  const username = String(process.env.AAELINK_SEED_ADMIN_USERNAME || 'adminaaelink').trim()
  if (!email.includes('@') || username.length < 2) {
    console.error('Invalid AAELINK_SEED_ADMIN_EMAIL or AAELINK_SEED_ADMIN_USERNAME')
    process.exit(1)
  }

  await ensureSchema()
  const pool = getPool()
  if (!pool) {
    console.error('DATABASE_URL is not set or database is not configured.')
    process.exit(1)
  }

  const id = randomUUID()
  const now = Date.now()
  const password_hash = hashPassword(password)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: upserted } = await client.query<{ id: string }>(
      `INSERT INTO aaelink.users (
         id, username, email, password_hash, first_name, last_name, nickname, created_at, last_seen_at, platform_role
       ) VALUES ($1, $2, $3, $4, 'Admin', 'AAELink', '', $5, 0, 'super_admin')
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         platform_role = EXCLUDED.platform_role,
         username = EXCLUDED.username
       RETURNING id`,
      [id, username, email, password_hash, now]
    )
    const userId = upserted[0]?.id
    if (!userId) throw new Error('upsert returned no id')

    const { rows: mc } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM aaelink.workspace_members WHERE user_id = $1`,
      [userId]
    )
    const memberCount = Number(mc[0]?.n || 0)
    if (memberCount === 0) {
      const wid = randomUUID()
      const cid = randomUUID()
      const wsName = slugifySegment(`aae-ops-${randomUUID().slice(0, 10)}`, 'workspace')
      await client.query(
        `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [wid, wsName, 'AAELink', userId, now]
      )
      await client.query(
        `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [wid, userId]
      )
      await client.query(
        `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at)
         VALUES ($1, $2, 'all-aaelink', 'All AAELink', 'O', $3)`,
        [cid, wid, now]
      )
    }

    await client.query('COMMIT')
    console.log(JSON.stringify({ ok: true, user_id: userId, email, username }, null, 2))
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { })
    console.error(e)
    process.exit(1)
  } finally {
    client.release()
    await pool.end().catch(() => { })
  }
}

void main()

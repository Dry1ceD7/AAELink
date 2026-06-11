/**
 * D7 Developer platform — app manifest ingestion.
 *
 * An app manifest declaratively describes an app: its identity, an optional bot
 * user, requested OAuth scopes, and redirect URLs. Ingesting a manifest creates
 * the app record plus (when a bot is declared) a bot user with credentials and
 * the granted scopes — the Slack "create app from manifest" flow.
 *
 * Validation is a pure function so the route stays thin; ingestion runs in a
 * transaction so an app and its bot are created atomically.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

export interface AppManifest {
  name?: string
  description?: string
  icon_url?: string
  bot?: { name?: string; description?: string; avatar_url?: string }
  scopes?: string[]
  redirect_urls?: string[]
}

export type ManifestViolation = { field: string; message: string }

/** Validate a manifest's shape. Returns the first violation, or null when valid. */
export function validateManifest(m: AppManifest): ManifestViolation | null {
  if (!m || typeof m !== 'object') return { field: 'manifest', message: 'must_be_object' }
  if (typeof m.name !== 'string' || !m.name.trim()) return { field: 'name', message: 'required' }
  if (m.name.trim().length > 200) return { field: 'name', message: 'too_long (max 200)' }
  if (m.scopes !== undefined) {
    if (!Array.isArray(m.scopes) || m.scopes.some(s => typeof s !== 'string')) {
      return { field: 'scopes', message: 'must_be_string_array' }
    }
  }
  if (m.redirect_urls !== undefined) {
    if (!Array.isArray(m.redirect_urls) || m.redirect_urls.some(u => typeof u !== 'string')) {
      return { field: 'redirect_urls', message: 'must_be_string_array' }
    }
  }
  if (m.bot !== undefined && (typeof m.bot !== 'object' || m.bot === null)) {
    return { field: 'bot', message: 'must_be_object' }
  }
  return null
}

export interface IngestedApp {
  app_id: string
  bot_id: string | null
  client_id: string | null
  /** The bot API token — returned once, at creation. */
  api_token: string | null
  scopes: string[]
}

export type IngestManifestResult =
  | { ok: true; app: IngestedApp }
  | { ok: false; code: 'invalid_manifest'; detail: ManifestViolation }

/**
 * Create an app (and, if declared, its bot user) from a manifest. The caller's
 * authority and the workspace are validated by the route. Atomic.
 */
export async function ingestManifest(
  pool: Pool,
  params: { workspaceId: string; createdBy: string; manifest: AppManifest }
): Promise<IngestManifestResult> {
  const violation = validateManifest(params.manifest)
  if (violation) return { ok: false, code: 'invalid_manifest', detail: violation }

  const m = params.manifest
  const scopes = (m.scopes ?? []).map(s => s.trim()).filter(Boolean)
  const redirectUrls = (m.redirect_urls ?? []).map(u => u.trim()).filter(Boolean)
  const now = Date.now()
  const appId = randomUUID()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO aaelink.apps (id, workspace_id, name, description, icon_url, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [appId, params.workspaceId, m.name!.trim(), m.description ?? '', m.icon_url ?? '', params.createdBy, now]
    )

    let botId: string | null = null
    let clientId: string | null = null
    let apiToken: string | null = null
    if (m.bot) {
      botId = randomUUID()
      clientId = `client_${randomUUID().replace(/-/g, '')}`
      apiToken = `xoxb-${randomUUID().replace(/-/g, '')}`
      await client.query(
        `INSERT INTO aaelink.bot_users
           (id, kind, name, description, avatar_url, scopes, status, client_id, client_secret,
            api_token, redirect_uris, workspace_id, created_by, created_at)
         VALUES ($1, 'bot', $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $11, $12)`,
        [
          botId,
          m.bot.name?.trim() || m.name!.trim(),
          m.bot.description ?? '',
          m.bot.avatar_url ?? '',
          JSON.stringify(scopes),
          clientId,
          `secret_${randomUUID().replace(/-/g, '')}`,
          apiToken,
          JSON.stringify(redirectUrls),
          params.workspaceId,
          params.createdBy,
          now,
        ]
      )
    }

    await client.query('COMMIT')
    return { ok: true, app: { app_id: appId, bot_id: botId, client_id: clientId, api_token: apiToken, scopes } }
  } catch (e) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    throw e
  } finally {
    client.release()
  }
}

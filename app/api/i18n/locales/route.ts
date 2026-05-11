import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Internationalization API — locale management and translation support.
 *
 * GET /api/i18n/locales — list available locales + user's current locale
 * PUT /api/i18n/locales — set user's preferred locale
 *
 * GET /api/i18n/locales?admin=true — admin: manage platform locales
 * POST /api/i18n/locales — admin: add a new locale
 *
 * Supported locales ship with the platform; admin can enable/disable.
 * User preferences are stored per-user and sent in API responses via Accept-Language.
 */

const BUILTIN_LOCALES = [
  { code: 'en', name: 'English', native_name: 'English', direction: 'ltr', coverage: 100 },
  { code: 'th', name: 'Thai', native_name: 'ไทย', direction: 'ltr', coverage: 95 },
  { code: 'zh', name: 'Chinese (Simplified)', native_name: '简体中文', direction: 'ltr', coverage: 90 },
  { code: 'ja', name: 'Japanese', native_name: '日本語', direction: 'ltr', coverage: 85 },
  { code: 'ko', name: 'Korean', native_name: '한국어', direction: 'ltr', coverage: 80 },
  { code: 'es', name: 'Spanish', native_name: 'Español', direction: 'ltr', coverage: 88 },
  { code: 'fr', name: 'French', native_name: 'Français', direction: 'ltr', coverage: 88 },
  { code: 'de', name: 'German', native_name: 'Deutsch', direction: 'ltr', coverage: 85 },
  { code: 'pt', name: 'Portuguese', native_name: 'Português', direction: 'ltr', coverage: 82 },
  { code: 'ar', name: 'Arabic', native_name: 'العربية', direction: 'rtl', coverage: 75 },
  { code: 'hi', name: 'Hindi', native_name: 'हिन्दी', direction: 'ltr', coverage: 70 },
  { code: 'ru', name: 'Russian', native_name: 'Русский', direction: 'ltr', coverage: 78 },
  { code: 'vi', name: 'Vietnamese', native_name: 'Tiếng Việt', direction: 'ltr', coverage: 72 },
  { code: 'id', name: 'Indonesian', native_name: 'Bahasa Indonesia', direction: 'ltr', coverage: 68 },
  { code: 'tr', name: 'Turkish', native_name: 'Türkçe', direction: 'ltr', coverage: 65 },
  { code: 'it', name: 'Italian', native_name: 'Italiano', direction: 'ltr', coverage: 70 },
  { code: 'nl', name: 'Dutch', native_name: 'Nederlands', direction: 'ltr', coverage: 65 },
  { code: 'pl', name: 'Polish', native_name: 'Polski', direction: 'ltr', coverage: 62 },
]

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Get platform locale config
  const { rows: cfgRows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'i18n_config'`
  )

  const defaultConfig = {
    default_locale: 'en',
    enabled_locales: ['en', 'th', 'zh'],
    fallback_locale: 'en',
    auto_detect: true,
  }

  let config = defaultConfig
  if (cfgRows[0]?.value) {
    try { config = { ...defaultConfig, ...JSON.parse(cfgRows[0].value) } } catch { /**/ }
  }

  // Get user's current locale preference
  const { rows: userRows } = await pool.query<{ locale: string }>(
    `SELECT COALESCE(locale, 'en') AS locale FROM aaelink.users WHERE id = $1`, [uid]
  )

  const enabledSet = new Set(config.enabled_locales)
  const availableLocales = BUILTIN_LOCALES
    .filter(l => enabledSet.has(l.code))
    .map(l => ({ ...l, is_current: l.code === (userRows[0]?.locale || 'en') }))

  const isAdmin = req.nextUrl.searchParams.get('admin') === 'true'

  return NextResponse.json({
    current_locale: userRows[0]?.locale || 'en',
    available_locales: availableLocales,
    ...(isAdmin ? {
      config,
      all_locales: BUILTIN_LOCALES,
    } : {}),
  })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { locale?: string }
  const locale = String(body.locale || '').trim()

  const validCodes = new Set(BUILTIN_LOCALES.map(l => l.code))
  if (!locale || !validCodes.has(locale)) {
    return NextResponse.json({ error: 'invalid_locale', valid: Array.from(validCodes) }, { status: 400 })
  }

  await pool.query(
    `UPDATE aaelink.users SET locale = $1 WHERE id = $2`, [locale, uid]
  )

  return NextResponse.json({ locale, updated: true })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    default_locale?: string; enabled_locales?: string[]
    auto_detect?: boolean
  }

  const { rows: existing } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'i18n_config'`
  )
  let current: Record<string, unknown> = {}
  if (existing[0]?.value) { try { current = JSON.parse(existing[0].value) } catch { /**/ } }

  const updated = { ...current, ...body }
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ('i18n_config', $1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2
  `, [JSON.stringify(updated), now])

  return NextResponse.json({ config: updated, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/i18n/locales', _GET)
export const POST   = tracedRoute('POST', '/api/i18n/locales', _POST)
export const PUT    = tracedRoute('PUT', '/api/i18n/locales', _PUT)

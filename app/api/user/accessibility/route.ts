// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Accessibility Preferences API — per-user a11y settings.
 *
 * GET  /api/user/accessibility — get current user's accessibility prefs
 * PUT  /api/user/accessibility — update accessibility prefs
 *
 * Covers Slack-parity a11y features:
 *   - Keyboard navigation mode
 *   - Screen reader optimizations
 *   - Reduced motion
 *   - High contrast mode
 *   - Font size scaling
 *   - Link underlines (always visible)
 *   - Focus indicators
 *   - Color-blind mode
 */

const DEFAULT_A11Y = {
  keyboard_navigation: true,
  screen_reader_mode: false,
  reduced_motion: false,
  high_contrast: false,
  font_scale: 1.0, // 0.8 to 2.0
  link_underlines: true,
  focus_indicators: true,
  color_blind_mode: 'none' as string, // 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia'
  message_spacing: 'default' as string, // 'compact' | 'default' | 'comfortable'
  sidebar_width: 'default' as string, // 'narrow' | 'default' | 'wide'
  emoji_style: 'native' as string, // 'native' | 'twemoji' | 'text'
  animation_speed: 1.0, // 0 = disabled, 0.5 = slow, 1.0 = normal, 2.0 = fast
  auto_play_media: true,
  captions_default: false,
}

async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query<{ accessibility_prefs: string }>(
    `SELECT COALESCE(accessibility_prefs, '{}') AS accessibility_prefs
     FROM aaelink.users WHERE id = $1`, [uid]
  )

  let prefs = { ...DEFAULT_A11Y }
  if (rows[0]?.accessibility_prefs) {
    try { prefs = { ...prefs, ...JSON.parse(rows[0].accessibility_prefs) } } catch { /**/ }
  }

  return NextResponse.json({ preferences: prefs })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Partial<typeof DEFAULT_A11Y>

  // Validate ranges
  if (body.font_scale !== undefined && (body.font_scale < 0.8 || body.font_scale > 2.0)) {
    return NextResponse.json({ error: 'font_scale_range (0.8-2.0)' }, { status: 400 })
  }
  if (body.animation_speed !== undefined && (body.animation_speed < 0 || body.animation_speed > 3)) {
    return NextResponse.json({ error: 'animation_speed_range (0-3)' }, { status: 400 })
  }
  if (body.color_blind_mode !== undefined &&
    !['none', 'protanopia', 'deuteranopia', 'tritanopia'].includes(body.color_blind_mode)) {
    return NextResponse.json({ error: 'invalid_color_blind_mode' }, { status: 400 })
  }
  if (body.message_spacing !== undefined &&
    !['compact', 'default', 'comfortable'].includes(body.message_spacing)) {
    return NextResponse.json({ error: 'invalid_message_spacing' }, { status: 400 })
  }

  // Merge with existing
  const { rows: existing } = await pool.query<{ accessibility_prefs: string }>(
    `SELECT COALESCE(accessibility_prefs, '{}') AS accessibility_prefs
     FROM aaelink.users WHERE id = $1`, [uid]
  )
  let current = { ...DEFAULT_A11Y }
  if (existing[0]?.accessibility_prefs) {
    try { current = { ...current, ...JSON.parse(existing[0].accessibility_prefs) } } catch { /**/ }
  }

  const updated = { ...current, ...body }

  await pool.query(
    `UPDATE aaelink.users SET accessibility_prefs = $1 WHERE id = $2`,
    [JSON.stringify(updated), uid]
  )

  return NextResponse.json({ preferences: updated })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/user/accessibility', _GET)
export const PUT    = tracedRoute('PUT', '/api/user/accessibility', _PUT)

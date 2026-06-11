/**
 * AAELink IP Allowlist Enforcement Gate (Admin parity §31)
 *
 * The admin/ip-access route stores an IpAccessConfig, but until now NOTHING
 * enforced it — middleware.ts only used the client IP for rate-limiting. This
 * module is the enforcement half: a gate that loads the persisted, enabled
 * allowlist config and blocks requests whose client IP is not on it.
 *
 * Layering choice (architecturally honest):
 *   Next.js middleware runs on the EDGE runtime. `pg` is in
 *   next.config `serverExternalPackages` and getPool() is Node-only, so
 *   middleware CANNOT read the DB-backed config. Therefore enforcement lives
 *   at the Node-runtime chokepoint instead — tracedRoute(), which already wraps
 *   every app+API handler and already holds a getPool() handle. See
 *   lib/api/tracedRoute.ts and the comment in middleware.ts.
 *
 * Caching: tracedRoute runs hot (every request), so the config is held in a
 * module-level TTL cache (mirrors the lazy-cache pattern lib/auth/csrf.ts uses
 * for its secret) and only re-read from system_config every CACHE_TTL_MS.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import {
  DEFAULT_IP_CONFIG,
  IpAccessController,
  extractClientIp,
  type IpAccessConfig,
} from '@/lib/auth/ipAccess'

/** system_config key the admin/ip-access route persists the config under. */
export const IP_ACCESS_CONFIG_KEY = 'ip_access_config'

/** How long a loaded config is trusted before re-reading from the DB. */
const CACHE_TTL_MS = 30_000

interface CacheEntry {
  config: IpAccessConfig
  loadedAt: number
}

let cache: CacheEntry | null = null

/** Invalidate the module-level cache (the admin route calls this on update). */
export function invalidateIpAccessCache(): void {
  cache = null
}

/**
 * Load the persisted IP-access config from system_config, merged over defaults.
 * Returns null when there is no pool (caller then fails open — see gate).
 */
export async function loadIpAccessConfig(): Promise<IpAccessConfig | null> {
  const now = Date.now()
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.config

  const pool = getPool()
  if (!pool) return null

  let config: IpAccessConfig = { ...DEFAULT_IP_CONFIG }
  try {
    const { rows } = await pool.query<{ value: string }>(
      `SELECT value FROM aaelink.system_config WHERE key = $1`,
      [IP_ACCESS_CONFIG_KEY]
    )
    if (rows[0]?.value) {
      const parsed = JSON.parse(rows[0].value) as Partial<IpAccessConfig>
      config = { ...DEFAULT_IP_CONFIG, ...parsed }
    }
  } catch {
    // Malformed/absent config → fall back to defaults (allowlist disabled).
  }

  cache = { config, loadedAt: now }
  return config
}

/**
 * Enforce the IP allowlist for an incoming request.
 *
 * Returns:
 *   - null when the request is allowed (list disabled/empty, IP matches, a
 *     bypass path, a private IP when permitted, or config/db unavailable).
 *   - a 403 { error: 'ip_not_allowed' } NextResponse when the client IP is
 *     blocked by an enabled allowlist/denylist.
 *
 * `routePath` is the canonical route (e.g. '/api/messages') used for bypass
 * matching; it defaults to the request URL pathname.
 */
export async function enforceIpAllowlist(
  req: NextRequest,
  routePath?: string
): Promise<NextResponse | null> {
  const config = await loadIpAccessConfig()
  // Fail open if config cannot be loaded — never lock the platform out on a
  // transient DB blip. An enabled allowlist is a hard gate only when readable.
  if (!config) return null
  if (!config.allowlistEnabled && !config.denylistEnabled) return null

  const headers: Record<string, string | undefined> = {
    'x-forwarded-for': req.headers.get('x-forwarded-for') ?? undefined,
    'x-real-ip': req.headers.get('x-real-ip') ?? undefined,
  }
  const ip = extractClientIp(headers)
  const path = routePath || (() => { try { return new URL(req.url).pathname } catch { return '/' } })()

  const result = new IpAccessController(config).check(ip, path)
  if (result.allowed) return null

  return NextResponse.json({ error: 'ip_not_allowed' }, { status: 403 })
}

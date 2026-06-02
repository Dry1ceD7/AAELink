/**
 * AAELink IP Access Control
 *
 * Network-level access control middleware:
 *   - IP allowlist (whitelist) — only listed IPs/CIDRs can access
 *   - IP denylist (blacklist) — block specific IPs/CIDRs
 *   - CIDR range support (e.g. 10.0.0.0/8, 192.168.1.0/24)
 *   - Private network detection
 *   - Admin-configurable at runtime
 *   - Bypass for health check endpoints
 */

// ── Types ────────────────────────────────────────────────────────────

export interface IpAccessConfig {
  /** When true, only allowlisted IPs can access */
  allowlistEnabled: boolean
  /** When true, denylisted IPs are blocked */
  denylistEnabled: boolean
  /** Allowed IP addresses or CIDRs */
  allowlist: string[]
  /** Blocked IP addresses or CIDRs */
  denylist: string[]
  /** Paths that bypass IP checks (e.g. /api/health) */
  bypassPaths: string[]
  /** Whether to allow all private/internal IPs */
  allowPrivateNetworks: boolean
}

export interface IpCheckResult {
  allowed: boolean
  reason: string
  matchedRule?: string
}

// ── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_IP_CONFIG: IpAccessConfig = {
  allowlistEnabled: false,
  denylistEnabled: false,
  allowlist: [],
  denylist: [],
  bypassPaths: ['/api/health', '/api/ping', '/_next'],
  allowPrivateNetworks: true,
}

// ── IP Parsing ───────────────────────────────────────────────────────

/** Parse an IPv4 address into a 32-bit integer */
export function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return -1
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

/** Check if an IP matches a CIDR range */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  // Direct match
  if (ip === cidr) return true

  // CIDR notation
  const parts = cidr.split('/')
  if (parts.length !== 2) return false

  const baseIp = ipv4ToInt(parts[0])
  const targetIp = ipv4ToInt(ip)
  if (baseIp === -1 || targetIp === -1) return false

  const prefixLen = parseInt(parts[1], 10)
  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) return false

  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0
  return (baseIp & mask) === (targetIp & mask)
}

/** Check if an IP is in a private network range */
export function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') return true

  const PRIVATE_RANGES = [
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '169.254.0.0/16',  // link-local
  ]

  return PRIVATE_RANGES.some(range => ipMatchesCidr(ip, range))
}

/** Extract client IP from request headers (respects X-Forwarded-For, X-Real-IP) */
export function extractClientIp(headers: Record<string, string | string[] | undefined>): string {
  // X-Forwarded-For: client, proxy1, proxy2
  const xff = headers['x-forwarded-for']
  if (xff) {
    const first = (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim()
    if (first) return first
  }

  const xri = headers['x-real-ip']
  if (xri) {
    return (Array.isArray(xri) ? xri[0] : xri).trim()
  }

  return '127.0.0.1'
}

// ── Access Controller ────────────────────────────────────────────────

export class IpAccessController {
  private config: IpAccessConfig

  constructor(config: Partial<IpAccessConfig> = {}) {
    this.config = { ...DEFAULT_IP_CONFIG, ...config }
  }

  /** Check if an IP is allowed to access a given path */
  check(ip: string, path: string = '/'): IpCheckResult {
    // Bypass paths always allowed
    if (this.config.bypassPaths.some(bp => path.startsWith(bp))) {
      return { allowed: true, reason: 'bypass_path' }
    }

    // Allow private networks if configured
    if (this.config.allowPrivateNetworks && isPrivateIp(ip)) {
      return { allowed: true, reason: 'private_network' }
    }

    // Check denylist first (deny takes priority)
    if (this.config.denylistEnabled && this.config.denylist.length > 0) {
      for (const rule of this.config.denylist) {
        if (ip === rule || ipMatchesCidr(ip, rule)) {
          return { allowed: false, reason: 'denylisted', matchedRule: rule }
        }
      }
    }

    // Check allowlist (if enabled, only allowlisted IPs pass)
    if (this.config.allowlistEnabled) {
      if (this.config.allowlist.length === 0) {
        return { allowed: false, reason: 'allowlist_empty' }
      }

      for (const rule of this.config.allowlist) {
        if (ip === rule || ipMatchesCidr(ip, rule)) {
          return { allowed: true, reason: 'allowlisted', matchedRule: rule }
        }
      }

      return { allowed: false, reason: 'not_in_allowlist' }
    }

    // Neither list is active — allow all
    return { allowed: true, reason: 'no_restrictions' }
  }

  /** Get current config */
  getConfig(): IpAccessConfig {
    return { ...this.config }
  }

  /** Update config at runtime */
  updateConfig(updates: Partial<IpAccessConfig>): void {
    this.config = { ...this.config, ...updates }
  }

  /** Add IP/CIDR to allowlist */
  addToAllowlist(rule: string): void {
    if (!this.config.allowlist.includes(rule)) {
      this.config.allowlist.push(rule)
    }
  }

  /** Remove IP/CIDR from allowlist */
  removeFromAllowlist(rule: string): void {
    this.config.allowlist = this.config.allowlist.filter(r => r !== rule)
  }

  /** Add IP/CIDR to denylist */
  addToDenylist(rule: string): void {
    if (!this.config.denylist.includes(rule)) {
      this.config.denylist.push(rule)
    }
  }

  /** Remove IP/CIDR from denylist */
  removeFromDenylist(rule: string): void {
    this.config.denylist = this.config.denylist.filter(r => r !== rule)
  }
}

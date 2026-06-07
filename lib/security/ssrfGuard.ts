/**
 * SSRF guard — shared utilities for rejecting callback / endpoint URLs that
 * target private / loopback / link-local address space or non-HTTPS schemes.
 *
 * Extracted from app/api/slash-commands/route.ts so both slash-commands and
 * the Events API url_verification handshake share one implementation.
 */
import { promises as dns } from 'dns'
import { ipMatchesCidr, isPrivateIp } from '@/lib/auth/ipAccess'

/**
 * SSRF-specific blocked IPv4 ranges that isPrivateIp (allowlist-oriented, used
 * elsewhere) does NOT cover. On Linux the whole 127.0.0.0/8 is loopback, so
 * 127.0.0.2 etc. must be rejected — not just the literal 127.0.0.1.
 */
const SSRF_BLOCKED_V4_RANGES = [
  '127.0.0.0/8', // entire loopback block
  '0.0.0.0/8', // "this host" / wildcard
  '100.64.0.0/10', // CGNAT (RFC 6598)
]

/**
 * Reject a dotted-IPv4 host for SSRF purposes: the allowlist-oriented
 * isPrivateIp ranges (10/8, 172.16/12, 192.168/16, 169.254/16, literal
 * 127.0.0.1) PLUS the SSRF-specific blocked ranges above.
 */
export function isBlockedIpv4(ip: string): boolean {
  if (isPrivateIp(ip)) return true
  return SSRF_BLOCKED_V4_RANGES.some(range => ipMatchesCidr(ip, range))
}

/**
 * Normalize a URL hostname into a comparable host string.
 *   - new URL('https://[::1]/').hostname returns '[::1]' WITH brackets for IPv6
 *     literals — strip them so we can compare bare addresses.
 */
export function normalizeHostname(hostname: string): string {
  let h = hostname.trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1)
  }
  return h
}

/**
 * Reject an IPv6 literal that targets loopback / unique-local / link-local /
 * v4-mapped-private ranges. Operates on a bracket-stripped, lowercased host.
 */
export function isBlockedIpv6(host: string): boolean {
  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:7f00:1) — extract the v4 tail
  const mapped = host.match(/^::ffff:(.+)$/)
  if (mapped) {
    const tail = mapped[1]
    // Dotted v4 form
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) {
      return isBlockedIpv4(tail)
    }
    // Hex form ::ffff:7f00:1 → reconstruct the v4 dotted address
    const hexParts = tail.split(':')
    if (hexParts.length === 2 && hexParts.every(p => /^[0-9a-f]{1,4}$/.test(p))) {
      const hi = parseInt(hexParts[0], 16)
      const lo = parseInt(hexParts[1], 16)
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
      return isBlockedIpv4(v4)
    }
    return true // unparseable mapped form — reject conservatively
  }
  if (host === '::1') return true // loopback
  if (host === '::') return true // unspecified
  // fc00::/7 — unique-local (first byte 0xfc or 0xfd)
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true
  // fe80::/10 — link-local (fe8, fe9, fea, feb)
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true
  return false
}

/**
 * Reject a purely-numeric / non-dotted IPv4 host. new URL() accepts integer,
 * octal, and hex forms (https://2130706433/, https://0x7f000001/) that bypass
 * a dotted-quad private-range check by resolving to 127.0.0.1 / private space.
 * We reject any non-dotted all-numeric or 0x-prefixed host outright.
 */
export function isNumericNonDottedHost(host: string): boolean {
  if (host.includes('.') || host.includes(':')) return false
  // Hex (0x...) or octal/decimal integer forms with no dots
  return /^0x[0-9a-f]+$/.test(host) || /^\d+$/.test(host)
}

/**
 * Reject callback URLs that could be used for SSRF:
 *   - non-https schemes
 *   - loopback / private / link-local IPv4 targets (dotted)
 *   - non-dotted numeric IPv4 (integer / octal / hex) targets
 *   - loopback / unique-local / link-local / v4-mapped IPv6 literals
 */
export function assertSafeCallbackUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'invalid_callback_url' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'callback_url_must_be_https' }
  }
  const host = normalizeHostname(url.hostname)
  // Non-dotted numeric IPv4 (https://2130706433/, https://0x7f000001/) — reject
  // outright; these decode to loopback/private space and bypass dotted checks.
  if (isNumericNonDottedHost(host)) {
    return { ok: false, error: 'callback_url_private_ip_not_allowed' }
  }
  // IPv6 literal targets (host contains ':')
  if (host.includes(':')) {
    if (isBlockedIpv6(host)) {
      return { ok: false, error: 'callback_url_private_ip_not_allowed' }
    }
    return { ok: true, url }
  }
  // Dotted IPv4 / private/loopback/link-local / CGNAT / 0.0.0.0 ranges
  if (isBlockedIpv4(host)) {
    return { ok: false, error: 'callback_url_private_ip_not_allowed' }
  }
  return { ok: true, url }
}

/**
 * DNS-resolve a callback host at dispatch time and reject if ANY resolved
 * address is private / loopback / link-local / cloud-metadata (169.254.169.254).
 *
 * Residual TOCTOU gap: this resolves the name, then a separate fetch() resolves
 * it AGAIN — a DNS-rebinding attacker can return a public IP here and a private
 * IP to fetch(). Full mitigation requires pinning the resolved IP into the
 * socket (custom agent/lookup), which is out of scope; this check raises the
 * bar against the common case of a hostname that simply maps to private space.
 */
export async function assertCallbackHostResolvesPublic(
  host: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Literal IPs are already validated by assertSafeCallbackUrl; skip lookup.
  if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return { ok: true }
  }
  let addrs: { address: string; family: number }[]
  try {
    addrs = await dns.lookup(host, { all: true })
  } catch {
    return { ok: false, error: 'callback_url_dns_resolution_failed' }
  }
  for (const { address } of addrs) {
    const bare = normalizeHostname(address)
    if (bare === '169.254.169.254') {
      return { ok: false, error: 'callback_url_private_ip_not_allowed' }
    }
    if (bare.includes(':')) {
      if (isBlockedIpv6(bare)) {
        return { ok: false, error: 'callback_url_private_ip_not_allowed' }
      }
    } else if (isBlockedIpv4(bare)) {
      return { ok: false, error: 'callback_url_private_ip_not_allowed' }
    }
  }
  return { ok: true }
}

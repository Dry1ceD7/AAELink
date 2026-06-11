/**
 * AAELink — SSRF guard unit tests
 *
 * Directly exercises the ssrfGuard module that gates outbound callback /
 * endpoint URLs (slash-command dispatch + Events API url_verification):
 *   - isBlockedIpv6 branches (loopback, unspecified, ULA, link-local,
 *     IPv4-mapped dotted + hex, unparseable-mapped)
 *   - isBlockedIpv4 SSRF-specific ranges (127/8, 0/8, 100.64/10 CGNAT) plus
 *     the still-blocked private ranges and allowed public space
 *   - assertCallbackHostResolvesPublic with the dns resolver stubbed:
 *     hostname -> metadata/loopback rejected, -> public allowed, DNS failure
 *     rejected
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { promises as dns } from 'dns'
import {
  isBlockedIpv6,
  isBlockedIpv4,
  assertCallbackHostResolvesPublic,
} from '@/lib/security/ssrfGuard'

afterEach(() => {
  vi.restoreAllMocks()
})

// ── isBlockedIpv6 ─────────────────────────────────────────────────────

describe('SSRF guard — isBlockedIpv6', () => {
  it('blocks ::1 loopback', () => {
    expect(isBlockedIpv6('::1')).toBe(true)
  })

  it('blocks :: unspecified', () => {
    expect(isBlockedIpv6('::')).toBe(true)
  })

  it('blocks fc00::/7 unique-local (fd00::1)', () => {
    expect(isBlockedIpv6('fd00::1')).toBe(true)
    expect(isBlockedIpv6('fc00::1')).toBe(true)
  })

  it('blocks fe80::/10 link-local (fe80::1)', () => {
    expect(isBlockedIpv6('fe80::1')).toBe(true)
  })

  it('blocks IPv4-mapped dotted private (::ffff:10.0.0.1)', () => {
    expect(isBlockedIpv6('::ffff:10.0.0.1')).toBe(true)
  })

  it('blocks IPv4-mapped hex private (::ffff:a00:1 -> 10.0.0.1)', () => {
    expect(isBlockedIpv6('::ffff:a00:1')).toBe(true)
  })

  it('blocks IPv4-mapped hex loopback (::ffff:7f00:1 -> 127.0.0.1)', () => {
    expect(isBlockedIpv6('::ffff:7f00:1')).toBe(true)
  })

  it('blocks an unparseable mapped form conservatively', () => {
    expect(isBlockedIpv6('::ffff:zzzz')).toBe(true)
  })

  it('allows a public IPv4-mapped address (::ffff:93.184.216.34)', () => {
    expect(isBlockedIpv6('::ffff:93.184.216.34')).toBe(false)
  })

  it('allows a public IPv6 literal', () => {
    expect(isBlockedIpv6('2606:2800:220:1:248:1893:25c8:1946')).toBe(false)
  })
})

// ── isBlockedIpv4 ─────────────────────────────────────────────────────

describe('SSRF guard — isBlockedIpv4 new ranges', () => {
  it('blocks all of 127.0.0.0/8, not just 127.0.0.1', () => {
    expect(isBlockedIpv4('127.0.0.2')).toBe(true)
    expect(isBlockedIpv4('127.1.1.1')).toBe(true)
    expect(isBlockedIpv4('127.0.0.1')).toBe(true)
  })

  it('blocks 0.0.0.0/8', () => {
    expect(isBlockedIpv4('0.0.0.0')).toBe(true)
    expect(isBlockedIpv4('0.1.2.3')).toBe(true)
  })

  it('blocks 100.64.0.0/10 CGNAT', () => {
    expect(isBlockedIpv4('100.64.0.1')).toBe(true)
    expect(isBlockedIpv4('100.127.255.255')).toBe(true)
  })

  it('still blocks the established private ranges', () => {
    expect(isBlockedIpv4('10.0.0.1')).toBe(true)
    expect(isBlockedIpv4('172.16.0.1')).toBe(true)
    expect(isBlockedIpv4('192.168.1.1')).toBe(true)
    expect(isBlockedIpv4('169.254.169.254')).toBe(true)
  })

  it('allows public IPv4', () => {
    expect(isBlockedIpv4('93.184.216.34')).toBe(false)
    expect(isBlockedIpv4('8.8.8.8')).toBe(false)
    // 100.63/100.128 are just outside the CGNAT /10 block
    expect(isBlockedIpv4('100.63.255.255')).toBe(false)
    expect(isBlockedIpv4('100.128.0.0')).toBe(false)
  })
})

// ── assertCallbackHostResolvesPublic (mocked DNS) ─────────────────────

describe('SSRF guard — assertCallbackHostResolvesPublic', () => {
  it('rejects a hostname resolving to cloud-metadata 169.254.169.254', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue(
      [{ address: '169.254.169.254', family: 4 }] as never
    )
    const res = await assertCallbackHostResolvesPublic('metadata.evil.test')
    expect(res.ok).toBe(false)
    expect(res).toMatchObject({ error: 'callback_url_private_ip_not_allowed' })
  })

  it('rejects a hostname resolving to loopback 127.0.0.2', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue(
      [{ address: '127.0.0.2', family: 4 }] as never
    )
    const res = await assertCallbackHostResolvesPublic('rebind.evil.test')
    expect(res.ok).toBe(false)
    expect(res).toMatchObject({ error: 'callback_url_private_ip_not_allowed' })
  })

  it('allows a hostname resolving to a public IP', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue(
      [{ address: '93.184.216.34', family: 4 }] as never
    )
    const res = await assertCallbackHostResolvesPublic('example.test')
    expect(res.ok).toBe(true)
  })

  it('rejects when DNS resolution fails', async () => {
    vi.spyOn(dns, 'lookup').mockRejectedValue(new Error('ENOTFOUND'))
    const res = await assertCallbackHostResolvesPublic('nxdomain.evil.test')
    expect(res.ok).toBe(false)
    expect(res).toMatchObject({ error: 'callback_url_dns_resolution_failed' })
  })
})

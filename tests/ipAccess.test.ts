/**
 * AAELink — IP Access Control Tests
 *
 * Validates CIDR matching, private network detection, allowlist/denylist,
 * bypass paths, and runtime config updates.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ipv4ToInt,
  ipMatchesCidr,
  isPrivateIp,
  extractClientIp,
  IpAccessController,
} from '@/lib/ipAccess'

// ── IP Parsing ───────────────────────────────────────────────────────

describe('IP Access — Parsing', () => {
  it('converts IPv4 to integer', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0)
    expect(ipv4ToInt('255.255.255.255')).toBe(4294967295)
    expect(ipv4ToInt('192.168.1.1')).toBe(3232235777)
    expect(ipv4ToInt('10.0.0.1')).toBe(167772161)
  })

  it('rejects invalid IPs', () => {
    expect(ipv4ToInt('invalid')).toBe(-1)
    expect(ipv4ToInt('256.1.1.1')).toBe(-1)
    expect(ipv4ToInt('1.2.3')).toBe(-1)
  })

  it('matches exact IPs', () => {
    expect(ipMatchesCidr('192.168.1.1', '192.168.1.1')).toBe(true)
    expect(ipMatchesCidr('192.168.1.1', '192.168.1.2')).toBe(false)
  })

  it('matches CIDR ranges', () => {
    expect(ipMatchesCidr('10.0.0.1', '10.0.0.0/8')).toBe(true)
    expect(ipMatchesCidr('10.255.255.255', '10.0.0.0/8')).toBe(true)
    expect(ipMatchesCidr('11.0.0.1', '10.0.0.0/8')).toBe(false)

    expect(ipMatchesCidr('192.168.1.100', '192.168.1.0/24')).toBe(true)
    expect(ipMatchesCidr('192.168.2.1', '192.168.1.0/24')).toBe(false)

    expect(ipMatchesCidr('172.16.5.10', '172.16.0.0/12')).toBe(true)
    expect(ipMatchesCidr('172.32.0.1', '172.16.0.0/12')).toBe(false)
  })
})

// ── Private IP Detection ─────────────────────────────────────────────

describe('IP Access — Private Networks', () => {
  it('detects private IPs', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true)
    expect(isPrivateIp('::1')).toBe(true)
    expect(isPrivateIp('localhost')).toBe(true)
    expect(isPrivateIp('10.0.0.1')).toBe(true)
    expect(isPrivateIp('172.16.0.1')).toBe(true)
    expect(isPrivateIp('192.168.1.1')).toBe(true)
  })

  it('rejects public IPs', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false)
    expect(isPrivateIp('1.1.1.1')).toBe(false)
    expect(isPrivateIp('203.0.113.1')).toBe(false)
  })
})

// ── Header Extraction ────────────────────────────────────────────────

describe('IP Access — Header Extraction', () => {
  it('extracts from X-Forwarded-For', () => {
    expect(extractClientIp({ 'x-forwarded-for': '203.0.113.50, 70.41.3.18' })).toBe('203.0.113.50')
  })

  it('extracts from X-Real-IP', () => {
    expect(extractClientIp({ 'x-real-ip': '203.0.113.50' })).toBe('203.0.113.50')
  })

  it('falls back to 127.0.0.1', () => {
    expect(extractClientIp({})).toBe('127.0.0.1')
  })
})

// ── Access Controller ────────────────────────────────────────────────

describe('IP Access — Controller', () => {
  let ctrl: IpAccessController

  beforeEach(() => {
    ctrl = new IpAccessController()
  })

  it('allows all by default (no restrictions)', () => {
    expect(ctrl.check('8.8.8.8').allowed).toBe(true)
    expect(ctrl.check('8.8.8.8').reason).toBe('no_restrictions')
  })

  it('allows bypass paths always', () => {
    ctrl.updateConfig({ denylistEnabled: true, denylist: ['0.0.0.0/0'] })
    expect(ctrl.check('8.8.8.8', '/api/health').allowed).toBe(true)
    expect(ctrl.check('8.8.8.8', '/api/health').reason).toBe('bypass_path')
  })

  it('allows private networks by default', () => {
    ctrl.updateConfig({ allowlistEnabled: true, allowlist: ['203.0.113.0/24'] })
    expect(ctrl.check('192.168.1.1').allowed).toBe(true)
    expect(ctrl.check('192.168.1.1').reason).toBe('private_network')
  })

  it('blocks denylisted IPs', () => {
    ctrl.updateConfig({ denylistEnabled: true, denylist: ['203.0.113.50'] })
    const result = ctrl.check('203.0.113.50')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('denylisted')
    expect(result.matchedRule).toBe('203.0.113.50')
  })

  it('blocks denylisted CIDR ranges', () => {
    ctrl.updateConfig({ denylistEnabled: true, denylist: ['203.0.113.0/24'] })
    expect(ctrl.check('203.0.113.50').allowed).toBe(false)
    expect(ctrl.check('203.0.114.1').allowed).toBe(true)
  })

  it('enforces allowlist when enabled', () => {
    ctrl.updateConfig({
      allowlistEnabled: true,
      allowlist: ['203.0.113.0/24'],
      allowPrivateNetworks: false,
    })
    expect(ctrl.check('203.0.113.50').allowed).toBe(true)
    expect(ctrl.check('203.0.113.50').reason).toBe('allowlisted')
    expect(ctrl.check('1.2.3.4').allowed).toBe(false)
    expect(ctrl.check('1.2.3.4').reason).toBe('not_in_allowlist')
  })

  it('returns allowlist_empty when no IPs configured', () => {
    ctrl.updateConfig({ allowlistEnabled: true, allowlist: [], allowPrivateNetworks: false })
    expect(ctrl.check('8.8.8.8').reason).toBe('allowlist_empty')
  })

  it('denylist takes priority over allowlist', () => {
    ctrl.updateConfig({
      allowlistEnabled: true,
      allowlist: ['203.0.113.0/24'],
      denylistEnabled: true,
      denylist: ['203.0.113.50'],
      allowPrivateNetworks: false,
    })
    expect(ctrl.check('203.0.113.50').allowed).toBe(false)
    expect(ctrl.check('203.0.113.51').allowed).toBe(true)
  })

  it('adds and removes from lists', () => {
    ctrl.addToAllowlist('1.2.3.4')
    expect(ctrl.getConfig().allowlist).toContain('1.2.3.4')
    ctrl.removeFromAllowlist('1.2.3.4')
    expect(ctrl.getConfig().allowlist).not.toContain('1.2.3.4')

    ctrl.addToDenylist('5.6.7.8')
    expect(ctrl.getConfig().denylist).toContain('5.6.7.8')
    ctrl.removeFromDenylist('5.6.7.8')
    expect(ctrl.getConfig().denylist).not.toContain('5.6.7.8')
  })

  it('does not add duplicates', () => {
    ctrl.addToAllowlist('1.2.3.4')
    ctrl.addToAllowlist('1.2.3.4')
    expect(ctrl.getConfig().allowlist.filter(r => r === '1.2.3.4')).toHaveLength(1)
  })
})

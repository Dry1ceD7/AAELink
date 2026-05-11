/**
 * AAELink — Feature Flags Tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FEATURE_FLAGS,
  isFeatureEnabledSync,
  invalidateFeatureFlagCache,
} from '@/lib/featureFlags'
import {
  parseSlashCommand as _parse,
  getSlashCommands as _getCommands,
} from '@/lib/slashCommands'

// ── Feature Flag Definitions ─────────────────────────────────────────

describe('FeatureFlags — Definitions', () => {
  it('exports a non-empty flag set', () => {
    const keys = Object.keys(FEATURE_FLAGS)
    expect(keys.length).toBeGreaterThan(10)
  })

  it('all flags are boolean values', () => {
    for (const [key, value] of Object.entries(FEATURE_FLAGS)) {
      expect(typeof value).toBe('boolean')
    }
  })

  it('includes core feature flags', () => {
    expect('HUDDLES' in FEATURE_FLAGS).toBe(true)
    expect('AI_SUMMARY' in FEATURE_FLAGS).toBe(true)
    expect('WORKFLOWS' in FEATURE_FLAGS).toBe(true)
    expect('TICKETS' in FEATURE_FLAGS).toBe(true)
    expect('RATE_LIMITING' in FEATURE_FLAGS).toBe(true)
  })

  it('enterprise flags default to false', () => {
    expect(FEATURE_FLAGS.DLP).toBe(false)
    expect(FEATURE_FLAGS.EKM).toBe(false)
    expect(FEATURE_FLAGS.LEGAL_HOLD).toBe(false)
    expect(FEATURE_FLAGS.INFO_BARRIERS).toBe(false)
    expect(FEATURE_FLAGS.SCIM).toBe(false)
    expect(FEATURE_FLAGS.WEBRTC_CALLS).toBe(false)
  })

  it('consumer flags default to true', () => {
    expect(FEATURE_FLAGS.AUDIO_VIDEO_CLIPS).toBe(true)
    expect(FEATURE_FLAGS.CANVAS_EDITOR).toBe(true)
    expect(FEATURE_FLAGS.MARKETPLACE).toBe(true)
    expect(FEATURE_FLAGS.LINK_PREVIEWS).toBe(true)
    expect(FEATURE_FLAGS.SCHEDULED_MESSAGES).toBe(true)
  })
})

// ── Sync Check ───────────────────────────────────────────────────────

describe('FeatureFlags — isFeatureEnabledSync', () => {
  const origEnv = { ...process.env }

  afterEach(() => {
    // Restore env
    process.env = { ...origEnv }
  })

  it('returns default when no env override', () => {
    expect(isFeatureEnabledSync('HUDDLES')).toBe(true)
    expect(isFeatureEnabledSync('WEBRTC_CALLS')).toBe(false)
  })

  it('respects FEATURE_ env var = true', () => {
    process.env.FEATURE_WEBRTC_CALLS = 'true'
    expect(isFeatureEnabledSync('WEBRTC_CALLS')).toBe(true)
  })

  it('respects FEATURE_ env var = false', () => {
    process.env.FEATURE_HUDDLES = 'false'
    expect(isFeatureEnabledSync('HUDDLES')).toBe(false)
  })

  it('respects FEATURE_ env var = 1', () => {
    process.env.FEATURE_DLP = '1'
    expect(isFeatureEnabledSync('DLP')).toBe(true)
  })

  it('respects FEATURE_ env var = 0', () => {
    process.env.FEATURE_TICKETS = '0'
    expect(isFeatureEnabledSync('TICKETS')).toBe(false)
  })

  it('is case-insensitive for env values', () => {
    process.env.FEATURE_SCIM = 'TRUE'
    expect(isFeatureEnabledSync('SCIM')).toBe(true)
  })

  it('falls through to default for non-boolean env', () => {
    process.env.FEATURE_HUDDLES = 'maybe'
    // Should fall through to default
    expect(isFeatureEnabledSync('HUDDLES')).toBe(true)
  })
})

// ── Cache Invalidation ───────────────────────────────────────────────

describe('FeatureFlags — Cache', () => {
  it('invalidateFeatureFlagCache does not throw', () => {
    expect(() => invalidateFeatureFlagCache()).not.toThrow()
  })
})

// ── Slash Command Parser ─────────────────────────────────────────────

describe('SlashCommands — parseSlashCommand', () => {
  it('parses command without args', () => {
    const result = _parse('/help')
    expect(result).toEqual({ name: 'help', args: '' })
  })

  it('parses command with args', () => {
    const result = _parse('/remind 30 Review PR')
    expect(result).toEqual({ name: 'remind', args: '30 Review PR' })
  })

  it('returns null for non-command', () => {
    expect(_parse('hello world')).toBeNull()
    expect(_parse('')).toBeNull()
  })

  it('lowercases command name', () => {
    const result = _parse('/SHRUG test')
    expect(result?.name).toBe('shrug')
  })

  it('handles leading/trailing whitespace', () => {
    const result = _parse('  /status :smile: working  ')
    expect(result?.name).toBe('status')
    // Parser trims input; args is everything after first space in trimmed string
    expect(result?.args).toBe(':smile: working')
  })

  it('returns null for slash only', () => {
    // A lone '/' becomes name = '' which should be null
    expect(_parse('/')).toBeNull()
  })
})

// ── Slash Command Registry ───────────────────────────────────────────

describe('SlashCommands — Registry', () => {
  it('returns all registered commands', () => {
    const cmds = _getCommands()
    expect(cmds.length).toBeGreaterThan(10)
  })

  it('all commands have required fields', () => {
    const cmds = _getCommands()
    for (const cmd of cmds) {
      expect(cmd.name).toBeTruthy()
      expect(cmd.description).toBeTruthy()
      expect(cmd.usage).toBeTruthy()
      expect(cmd.usage.startsWith('/')).toBe(true)
    }
  })

  it('includes key Slack-parity commands', () => {
    const cmds = _getCommands()
    const names = cmds.map(c => c.name)
    expect(names).toContain('shrug')
    expect(names).toContain('me')
    expect(names).toContain('status')
    expect(names).toContain('dnd')
    expect(names).toContain('mute')
    expect(names).toContain('remind')
    expect(names).toContain('help')
    expect(names).toContain('topic')
    expect(names).toContain('join')
    expect(names).toContain('invite')
    expect(names).toContain('archive')
    expect(names).toContain('rename')
    expect(names).toContain('who')
  })

  it('command names are unique', () => {
    const cmds = _getCommands()
    const names = cmds.map(c => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

/**
 * AAELink — Data Retention Engine Tests
 *
 * Validates policy management, cutoff calculation, preview,
 * and execution logic.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { RetentionEngine, DEFAULT_RETENTION_POLICIES, type RetentionEntity } from '@/lib/enterprise/retention'

describe('Data Retention Engine', () => {
  let engine: RetentionEngine

  beforeEach(() => {
    engine = new RetentionEngine()
  })

  it('loads default policies', () => {
    const policies = engine.getPolicies()
    expect(policies.length).toBe(DEFAULT_RETENTION_POLICIES.length)
    expect(policies.length).toBe(9) // read_state policy dropped in 04299563 (read-state unification)
  })

  it('gets specific policy by entity', () => {
    const p = engine.getPolicy('messages')
    expect(p).toBeDefined()
    expect(p!.entity).toBe('messages')
    expect(p!.retentionDays).toBe(0) // keep forever
  })

  it('updates policy', () => {
    engine.updatePolicy('messages', { retentionDays: 365, enabled: true })
    const p = engine.getPolicy('messages')!
    expect(p.retentionDays).toBe(365)
    expect(p.enabled).toBe(true)
  })

  it('calculates cutoff timestamp for 90-day policy', () => {
    const p = engine.getPolicy('sessions')!
    const cutoff = engine.getCutoffTimestamp(p)
    const expectedMs = 90 * 86400000
    const now = Date.now()
    expect(cutoff).toBeGreaterThan(now - expectedMs - 1000)
    expect(cutoff).toBeLessThan(now - expectedMs + 1000)
  })

  it('returns 0 cutoff for keep-forever policy', () => {
    const p = engine.getPolicy('messages')!
    expect(engine.getCutoffTimestamp(p)).toBe(0)
  })

  it('preview returns dry-run result', async () => {
    engine.updatePolicy('sessions', { retentionDays: 90 })
    const result = await engine.preview('sessions', async () => ({ rowCount: 0, rows: [{ count: 42 }] }))
    expect(result.dryRun).toBe(true)
    expect(result.deleted).toBe(42)
    expect(result.entity).toBe('sessions')
  })

  it('preview returns keep_forever for 0-day policy', async () => {
    const result = await engine.preview('messages', async () => ({ rowCount: 0, rows: [{ count: 0 }] }))
    expect(result.cutoffDate).toBe('keep_forever')
    expect(result.deleted).toBe(0)
  })

  it('execute skips disabled policies', async () => {
    const result = await engine.execute('messages', async () => ({ rowCount: 0, rows: [{ count: 0 }] }))
    expect(result.cutoffDate).toBe('disabled')
    expect(result.deleted).toBe(0)
  })

  it('execute skips keep-forever policies', async () => {
    engine.updatePolicy('messages', { enabled: true, retentionDays: 0 })
    const result = await engine.execute('messages', async () => ({ rowCount: 0, rows: [{ count: 0 }] }))
    expect(result.cutoffDate).toBe('keep_forever')
    expect(result.deleted).toBe(0)
  })

  it('executeAll processes only enabled policies', async () => {
    const results = await engine.executeAll(async () => ({ rowCount: 0, rows: [{ count: 0 }] }), true)
    const enabledCount = engine.getPolicies().filter(p => p.enabled).length
    expect(results.length).toBe(enabledCount)
    results.forEach(r => expect(r.dryRun).toBe(true))
  })

  it('accepts custom policy overrides', () => {
    const custom = new RetentionEngine([
      { entity: 'messages', retentionDays: 180, enabled: true },
    ])
    const p = custom.getPolicy('messages')!
    expect(p.retentionDays).toBe(180)
    expect(p.enabled).toBe(true)
  })

  it('handles unknown entity gracefully in preview', async () => {
    // Intentionally pass an entity name not in the RetentionEntity union
    // to verify the engine returns a safe empty result without crashing.
    const result = await engine.preview(
      'nonexistent' as RetentionEntity,
      async () => ({ rowCount: 0, rows: [{ count: 0 }] })
    )
    expect(result.deleted).toBe(0)
  })
})

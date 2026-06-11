/**
 * Unit tests for the pure interactivity signature/verification logic.
 *
 * DB-backed dispatch (event_deliver job queued) lives in
 * __tests__/api/interactivity-ingress.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  signInteractivity,
  verifyInteractivity,
  claimInteractivityNonce,
  __resetInteractivityNoncesForTests,
  MAX_SKEW_MS,
  type ActiveSubscription,
} from '@/lib/integrations/interactivity'

const SECRET = 'whsec_abc123'
const subs: ActiveSubscription[] = [
  { id: 'sub-1', bot_id: 'bot-1', workspace_id: 'ws-1', signing_secret: SECRET },
  { id: 'sub-2', bot_id: null, workspace_id: null, signing_secret: 'whsec_other' },
]

const body = JSON.stringify({ type: 'block_actions', actions: [{ action_id: 'x' }] })

describe('verifyInteractivity', () => {
  const now = 1_700_000_000_000

  it('accepts a valid signature and resolves the signing app', () => {
    const sig = signInteractivity(SECRET, now, body)
    const out = verifyInteractivity({ subscriptions: subs, signatureHeader: sig, timestampHeader: String(now), rawBody: body, now })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.subscriptionId).toBe('sub-1')
      expect(out.botId).toBe('bot-1')
      expect(out.workspaceId).toBe('ws-1')
    }
  })

  it('rejects a bad signature with 401 invalid_signature', () => {
    const out = verifyInteractivity({ subscriptions: subs, signatureHeader: 'sha256=bad', timestampHeader: String(now), rawBody: body, now })
    expect(out).toMatchObject({ ok: false, status: 401, error: 'invalid_signature' })
  })

  it('rejects a tampered body (signature no longer matches)', () => {
    const sig = signInteractivity(SECRET, now, body)
    const out = verifyInteractivity({ subscriptions: subs, signatureHeader: sig, timestampHeader: String(now), rawBody: body + 'x', now })
    expect(out).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a stale timestamp with 401 stale_timestamp', () => {
    const staleTs = now - (MAX_SKEW_MS + 1000)
    const sig = signInteractivity(SECRET, staleTs, body)
    const out = verifyInteractivity({ subscriptions: subs, signatureHeader: sig, timestampHeader: String(staleTs), rawBody: body, now })
    expect(out).toMatchObject({ ok: false, status: 401, error: 'stale_timestamp' })
  })

  it('rejects a future timestamp beyond the skew window', () => {
    const futureTs = now + (MAX_SKEW_MS + 1000)
    const sig = signInteractivity(SECRET, futureTs, body)
    const out = verifyInteractivity({ subscriptions: subs, signatureHeader: sig, timestampHeader: String(futureTs), rawBody: body, now })
    expect(out).toMatchObject({ ok: false, status: 401, error: 'stale_timestamp' })
  })

  it('400s on a missing signature or timestamp', () => {
    expect(verifyInteractivity({ subscriptions: subs, signatureHeader: null, timestampHeader: String(now), rawBody: body, now }))
      .toMatchObject({ ok: false, status: 400, error: 'missing_signature' })
    const sig = signInteractivity(SECRET, now, body)
    expect(verifyInteractivity({ subscriptions: subs, signatureHeader: sig, timestampHeader: null, rawBody: body, now }))
      .toMatchObject({ ok: false, status: 400, error: 'missing_timestamp' })
    expect(verifyInteractivity({ subscriptions: subs, signatureHeader: sig, timestampHeader: 'notanumber', rawBody: body, now }))
      .toMatchObject({ ok: false, status: 400, error: 'bad_timestamp' })
  })

  it('404s when there are no registered apps', () => {
    const sig = signInteractivity(SECRET, now, body)
    const out = verifyInteractivity({ subscriptions: [], signatureHeader: sig, timestampHeader: String(now), rawBody: body, now })
    expect(out).toMatchObject({ ok: false, status: 404, error: 'unknown_app' })
  })
})

describe('claimInteractivityNonce (in-process)', () => {
  beforeEach(() => __resetInteractivityNoncesForTests())

  it('accepts a signature once, rejects the same signature as a replay', async () => {
    const sig = 'sha256=deadbeefcafe'
    const t = 2_000_000_000_000
    expect(await claimInteractivityNonce(sig, t)).toBe(true)   // first use
    expect(await claimInteractivityNonce(sig, t)).toBe(false)  // replay within window
  })

  it('lets the same signature through again once its TTL has elapsed', async () => {
    const sig = 'sha256=feedface'
    const t = 2_000_000_000_000
    expect(await claimInteractivityNonce(sig, t, 1000)).toBe(true)
    // Re-evaluate well past the 1s TTL — entry has expired, so it is fresh again.
    expect(await claimInteractivityNonce(sig, t + 5000, 1000)).toBe(true)
  })

  it('treats distinct signatures independently', async () => {
    const t = 2_000_000_000_000
    expect(await claimInteractivityNonce('sha256=aaa', t)).toBe(true)
    expect(await claimInteractivityNonce('sha256=bbb', t)).toBe(true)
  })
})

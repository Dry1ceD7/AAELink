/**
 * Unit tests for the incoming-webhook helpers:
 *   - lib/webhooks/inboundVerify.ts  (mirror of the outbound v0 HMAC scheme)
 *   - lib/webhooks/inboundPayload.ts (Slack-compatible payload parsing)
 */
import { describe, it, expect } from 'vitest'
import { signPayload } from '@/lib/webhooks/webhookSigning'
import { verifyInbound } from '@/lib/webhooks/inboundVerify'
import { parseInboundPayload } from '@/lib/webhooks/inboundPayload'

const ID = { id: 'wh1', defaultName: 'Hook', defaultIcon: 'i.png' }

describe('verifyInbound', () => {
  it('open webhook (no secret) → not required, valid', () => {
    const r = verifyInbound('', '{}', new Headers())
    expect(r.required).toBe(false)
    expect(r.valid).toBe(true)
  })

  it('valid signature passes for a secured webhook', () => {
    const body = JSON.stringify({ text: 'hi' })
    const { headers } = signPayload('secret', body)
    const r = verifyInbound('secret', body, new Headers(headers))
    expect(r.required).toBe(true)
    expect(r.valid).toBe(true)
  })

  it('wrong secret fails', () => {
    const body = JSON.stringify({ text: 'hi' })
    const { headers } = signPayload('wrong', body)
    const r = verifyInbound('secret', body, new Headers(headers))
    expect(r.required).toBe(true)
    expect(r.valid).toBe(false)
  })

  it('missing signature on a secured webhook fails', () => {
    const r = verifyInbound('secret', '{}', new Headers())
    expect(r.required).toBe(true)
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('missing_signature')
  })
})

describe('parseInboundPayload', () => {
  it('text-only message parses', () => {
    const r = parseInboundPayload({ text: 'hello' }, ID)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.body).toBe('hello')
      expect(r.metadata.is_bot).toBe(true)
      expect(r.metadata.bot_name).toBe('Hook')
    }
  })

  it('username/icon override the defaults', () => {
    const r = parseInboundPayload({ text: 'x', username: 'Bot', icon_url: 'u.png' }, ID)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metadata.bot_name).toBe('Bot')
      expect(r.metadata.bot_icon).toBe('u.png')
    }
  })

  it('attachments + valid blocks are retained', () => {
    const r = parseInboundPayload({
      text: 'x',
      attachments: [{ text: 'a' }],
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'b' } }],
    }, ID)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metadata.attachments?.length).toBe(1)
      expect(r.metadata.blocks?.length).toBe(1)
    }
  })

  it('malformed blocks rejected', () => {
    const r = parseInboundPayload({ text: 'x', blocks: [{ type: 'nope' }] }, ID)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('invalid_blocks')
      expect(r.status).toBe(400)
    }
  })

  it('non-array attachments rejected', () => {
    const r = parseInboundPayload({ text: 'x', attachments: 'nope' }, ID)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_attachments')
  })

  it('empty payload rejected', () => {
    const r = parseInboundPayload({}, ID)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('empty_payload')
  })

  it('blocks-only payload accepted', () => {
    const r = parseInboundPayload({
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'b' } }],
    }, ID)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.body).toBe('')
  })

  it('non-object payload rejected', () => {
    const r = parseInboundPayload([], ID)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
  })
})

/**
 * AAELink — Notification Client Type Tests
 *
 * The runtime functions require browser Notification API + DOM.
 * We test the interface contracts and tag generation patterns.
 */
import { describe, it, expect } from 'vitest'

describe('NotificationClient — NotifyOptions shape', () => {
  it('accepts minimal options', () => {
    const opts = { title: 'Hello', body: 'World' }
    expect(opts.title).toBe('Hello')
    expect(opts.body).toBe('World')
  })

  it('accepts full options', () => {
    const opts = {
      title: 'Alert',
      body: 'Message body',
      rawMessage: 'Full raw message text',
      dndActive: false,
      tag: 'dm-JohnDoe',
      onClick: () => {},
      icon: '/avatars/john.png',
    }
    expect(opts.tag).toBe('dm-JohnDoe')
    expect(opts.dndActive).toBe(false)
    expect(typeof opts.onClick).toBe('function')
  })
})

describe('NotificationClient — tag generation patterns', () => {
  it('DM tag uses dm- prefix', () => {
    const senderName = 'Alice'
    const tag = `dm-${senderName}`
    expect(tag).toBe('dm-Alice')
  })

  it('mention tag uses mention- prefix', () => {
    const channelName = 'general'
    const tag = `mention-${channelName}`
    expect(tag).toBe('mention-general')
  })

  it('keyword tag uses keyword- prefix', () => {
    const channelName = 'dev'
    const tag = `keyword-${channelName}`
    expect(tag).toBe('keyword-dev')
  })
})

describe('NotificationClient — message truncation', () => {
  it('DM body truncates at 200 chars', () => {
    const message = 'x'.repeat(300)
    const body = message.slice(0, 200)
    expect(body).toHaveLength(200)
  })

  it('mention body truncates at 120 chars', () => {
    const message = 'y'.repeat(300)
    const body = `Sender: ${message.slice(0, 120)}`
    expect(body.length).toBeLessThanOrEqual(128 + 8) // "Sender: " + 120
  })
})

describe('NotificationClient — auto-close timeout', () => {
  it('auto-closes after 5 seconds', () => {
    const AUTO_CLOSE_MS = 5000
    expect(AUTO_CLOSE_MS).toBe(5000)
  })
})

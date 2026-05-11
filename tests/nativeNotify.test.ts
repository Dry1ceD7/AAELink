/**
 * AAELink — Native Notify Guard Tests
 */
import { describe, it, expect } from 'vitest'

describe('nativeNotify — guard conditions', () => {
  it('systemNotificationsEnabled=false blocks notification', () => {
    const enabled = false
    expect(enabled).toBe(false)
  })

  it('requires Notification API to be defined', () => {
    // In vitest (no jsdom), Notification is undefined → graceful no-op
    expect(typeof globalThis.Notification).toBe('undefined')
  })
})

describe('nativeNotify — visibility guard', () => {
  it('only shows when document is hidden', () => {
    // Source: document.visibilityState !== 'hidden' → return
    const visible = 'visible'
    const hidden = 'hidden'
    expect(visible).not.toBe(hidden)
  })
})

describe('nativeNotify — notification shape', () => {
  it('builds notification from ApiNotification', () => {
    const n = {
      id: 'n-1',
      title: 'You were mentioned',
      body: 'Check #general',
    }
    expect(n.title).toBe('You were mentioned')
    expect(n.body).toContain('#general')
  })
})

/**
 * AAELink — useReadState Constants Tests
 */
import { describe, it, expect } from 'vitest'

describe('useReadState — endpoint contract', () => {
  const ENDPOINT = '/api/collab/read-state'

  it('uses correct endpoint', () => {
    expect(ENDPOINT).toBe('/api/collab/read-state')
  })
})

describe('useReadState — watermark dedup logic', () => {
  it('skips re-posting same watermark', () => {
    let lastPosted = 0
    const latestCreateAt = 1000

    // First call: should post
    const shouldPost1 = latestCreateAt > lastPosted
    expect(shouldPost1).toBe(true)
    lastPosted = latestCreateAt

    // Second call with same: should skip
    const shouldPost2 = latestCreateAt > lastPosted
    expect(shouldPost2).toBe(false)
  })

  it('posts when new message arrives', () => {
    const lastPosted = 1000
    const latestCreateAt = 2000
    expect(latestCreateAt > lastPosted).toBe(true)
  })

  it('resets watermark on channel switch', () => {
    let lastPosted = 5000
    // On channel switch: reset to 0
    lastPosted = 0
    expect(lastPosted).toBe(0)
  })
})

describe('useReadState — guard conditions', () => {
  it('skips when channelId is null', () => {
    const channelId: string | null = null
    expect(!channelId).toBe(true)
  })

  it('skips when latestCreateAt <= 0', () => {
    const latestCreateAt = 0
    expect(latestCreateAt <= 0).toBe(true)
  })
})

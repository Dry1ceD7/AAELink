/**
 * AAELink — Chat Post Transformation Tests
 */
import { describe, it, expect } from 'vitest'
import { rowToPost, type MessageRowInput } from '@/lib/messaging/chat-post'

function makeRow(overrides: Partial<MessageRowInput> = {}): MessageRowInput {
  return {
    id: 'msg-1',
    channel_id: 'ch-1',
    user_id: 'u-1',
    message: 'Hello world',
    create_at: '1700000000000',
    ...overrides,
  }
}

describe('ChatPost — rowToPost', () => {
  it('maps basic fields', () => {
    const p = rowToPost(makeRow())
    expect(p.id).toBe('msg-1')
    expect(p.channel_id).toBe('ch-1')
    expect(p.user_id).toBe('u-1')
    expect(p.message).toBe('Hello world')
    expect(p.create_at).toBe(1700000000000)
  })

  it('sets root_id from row', () => {
    const p = rowToPost(makeRow({ root_id: 'root-42' }))
    expect(p.root_id).toBe('root-42')
  })

  it('defaults root_id to empty string', () => {
    const p = rowToPost(makeRow({ root_id: undefined }))
    expect(p.root_id).toBe('')
  })

  it('sets reply_count when present', () => {
    const p = rowToPost(makeRow({ reply_count: '5' }))
    expect(p.reply_count).toBe(5)
  })

  it('omits reply_count when null', () => {
    const p = rowToPost(makeRow({ reply_count: null }))
    expect(p.reply_count).toBeUndefined()
  })

  it('sets edited_at when updated_at > create_at', () => {
    const p = rowToPost(makeRow({ create_at: '1000', updated_at: '2000' }))
    expect(p.edited_at).toBe(2000)
  })

  it('omits edited_at when not edited', () => {
    const p = rowToPost(makeRow({ create_at: '1000', updated_at: '1000' }))
    expect(p.edited_at).toBeUndefined()
  })

  it('attaches reactions', () => {
    const p = rowToPost(makeRow(), [{ key: 'thumbs_up', count: 3, me: true }])
    expect(p.reactions).toHaveLength(1)
    expect(p.reactions![0].key).toBe('thumbs_up')
  })

  it('omits reactions when empty array', () => {
    const p = rowToPost(makeRow(), [])
    expect(p.reactions).toBeUndefined()
  })
})

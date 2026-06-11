/**
 * AAELink — eDiscovery export artifact generation tests.
 *
 * Verifies the JSON/CSV artifact builder produces valid, escaped output and
 * reports correct counts/content-types for the worker to store in S3.
 */
import { describe, it, expect } from 'vitest'
import {
  buildArtifact, csvField, messagesToCsv,
  type ExportMessage, type ExportAudit,
} from '@/lib/enterprise/complianceExport'

const messages: ExportMessage[] = [
  { id: 'm1', channel_id: 'c1', user_id: 'u1', body: 'hello world', root_id: '', created_at: 100 },
  { id: 'm2', channel_id: 'c1', user_id: 'u2', body: 'with, comma and "quote"', root_id: 'm1', created_at: 200 },
]
const audit: ExportAudit[] = [
  { id: 'a1', actor_id: 'u1', action: 'message.create', resource_kind: 'message', resource_id: 'm1', created_at: 100 },
]

describe('Compliance Export — csvField', () => {
  it('leaves plain values unquoted', () => {
    expect(csvField('plain')).toBe('plain')
  })
  it('quotes and escapes commas, quotes, newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })
  it('renders null/undefined as empty', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })
})

describe('Compliance Export — messagesToCsv', () => {
  it('emits a header and one row per message', () => {
    const csv = messagesToCsv(messages)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('id,channel_id,user_id,root_id,created_at,body')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('"with, comma and ""quote"""')
  })
})

describe('Compliance Export — buildArtifact', () => {
  it('builds JSON with message + audit payload and counts', () => {
    const art = buildArtifact('json', messages, audit)
    expect(art.contentType).toBe('application/json')
    expect(art.extension).toBe('json')
    expect(art.messageCount).toBe(2)
    expect(art.auditCount).toBe(1)
    const parsed = JSON.parse(art.body.toString('utf8'))
    expect(parsed.messages).toHaveLength(2)
    expect(parsed.audit_log).toHaveLength(1)
    expect(parsed.message_count).toBe(2)
  })

  it('builds CSV when format is csv', () => {
    const art = buildArtifact('csv', messages, audit)
    expect(art.contentType).toBe('text/csv')
    expect(art.extension).toBe('csv')
    expect(art.body.toString('utf8')).toContain('hello world')
  })

  it('defaults to JSON for unknown formats', () => {
    const art = buildArtifact('xml', messages, audit)
    expect(art.contentType).toBe('application/json')
  })

  it('handles an empty range', () => {
    const art = buildArtifact('json', [], [])
    expect(art.messageCount).toBe(0)
    const parsed = JSON.parse(art.body.toString('utf8'))
    expect(parsed.messages).toEqual([])
  })
})

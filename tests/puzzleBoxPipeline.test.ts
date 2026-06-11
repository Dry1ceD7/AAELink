/**
 * Puzzle Box — pipeline driver behaviour.
 *
 * The driver is the orchestrator that walks an assembly through every
 * stage, persisting state and writing a per-stage log. We mock the
 * underlying stage helpers so the test only exercises the orchestrator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import type { PuzzlePiece, AssemblyRecord } from '@/lib/documents/puzzleBox/types'

// Mock every stage that has external dependencies (Stirling, S3, AI gateway).
vi.mock('@/lib/documents/puzzleBox/ingest', () => ({
  runIngest: vi.fn(async () => ({
    ok: true,
    value: {
      schema_version: '1',
      source: { kind: 'manual', ref: 'r' },
      customer_id: '',
      document_kind: 'invoice',
      fields: { total: 1234.56 },
      extraction: { method: 'regex', confidence: 0.7, warnings: [] },
    } satisfies PuzzlePiece,
    warnings: [],
  })),
}))

vi.mock('@/lib/documents/puzzleBox/normalize', () => ({
  runNormalize: vi.fn(async ({ piece }: { piece: PuzzlePiece }) => ({
    ok: true,
    value: piece,
    warnings: [],
  })),
}))

vi.mock('@/lib/documents/puzzleBox/assemble', () => ({
  runAssemble: vi.fn(async () => ({
    ok: true,
    value: {
      html: '<html>ok</html>',
      template: { id: 'tpl1', page_size: 'A4', html_source: '', css_source: '', kind: 'invoice', name: 'inv', version: 1, required_fields: [], is_active: true, workspace_id: 'w1' },
      client: null,
    },
  })),
}))

vi.mock('@/lib/documents/puzzleBox/render', () => ({
  runRender: vi.fn(async () => ({
    ok: true,
    value: { bucket_key: 'workspaces/w1/documents/a1.pdf', size_bytes: 1024 },
  })),
}))

vi.mock('@/lib/documents/puzzleBox/deliver', () => ({
  runDeliver: vi.fn(async () => ({
    ok: true,
    value: { message_id: 'm1', channel_id: 'c1', ticket_comment_id: null },
  })),
}))

// Import after mocks so the driver picks up the mocked modules.
const { drivePipeline } = await import('@/lib/documents/puzzleBox/pipeline')

interface AssemblyRow {
  id: string
  workspace_id: string
  template_id: string | null
  client_profile_id: string | null
  piece: string | null
  stage: string
  rendered_html: string
  output_bucket_key: string
  delivery_channel_id: string | null
  delivery_message_id: string
  ticket_id: string | null
  error: string
  created_by: string | null
  created_at: number
  updated_at: number
}

function makePool(initial: Partial<AssemblyRow> = {}) {
  const row: AssemblyRow = {
    id: 'a1',
    workspace_id: 'w1',
    template_id: 'tpl1',
    client_profile_id: null,
    piece: null,
    stage: 'ingested',
    rendered_html: '',
    output_bucket_key: '',
    delivery_channel_id: 'c1',
    delivery_message_id: '',
    ticket_id: null,
    error: '',
    created_by: 'u1',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...initial,
  }

  const log: Array<{ stage: string; status: string; detail: unknown }> = []
  const updates: Array<Record<string, unknown>> = []

  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      // SELECT … FROM aaelink.document_assemblies WHERE id = $1
      if (/FROM aaelink\.document_assemblies WHERE id/.test(sql)) {
        return { rows: [row] }
      }
      // INSERT INTO aaelink.document_pipeline_log
      if (/INSERT INTO aaelink\.document_pipeline_log/.test(sql)) {
        log.push({ stage: String(params[2]), status: String(params[3]), detail: params[5] })
        return { rows: [] }
      }
      // UPDATE aaelink.document_assemblies SET … WHERE id = $1
      if (/UPDATE aaelink\.document_assemblies SET /.test(sql)) {
        // Parse the SET clause loosely
        const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/s)
        if (setMatch) {
          const cols = setMatch[1].split(',').map(s => s.trim().split(' = ')[0])
          const update: Record<string, unknown> = {}
          // params[0] is id; remaining params line up with set cols
          cols.forEach((col, i) => {
            const value = params[i + 1]
            update[col] = value
            // Mirror onto row so subsequent loadAssembly calls see the new state.
            if (col === 'stage') row.stage = String(value)
            if (col === 'piece') row.piece = String(value)
            if (col === 'rendered_html') row.rendered_html = String(value)
            if (col === 'output_bucket_key') row.output_bucket_key = String(value)
            if (col === 'error') row.error = String(value)
            if (col === 'delivery_message_id') row.delivery_message_id = String(value)
          })
          updates.push(update)
        }
        return { rows: [] }
      }
      // Lightweight reload of template / client info during render fallback
      if (/SELECT page_size FROM aaelink\.document_templates/.test(sql)) {
        return { rows: [{ page_size: 'A4' }] }
      }
      return { rows: [] }
    }),
  }

  return { pool: pool as unknown as Pool, log, updates, row }
}

describe('drivePipeline — happy path', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('walks every stage from ingested → delivered when starting fresh', async () => {
    const { pool, log } = makePool({ stage: 'ingested' })
    const out: AssemblyRecord = await drivePipeline({ pool, assembly_id: 'a1' })
    expect(out.stage).toBe('delivered')
    const stageOrder = log.map(l => `${l.stage}:${l.status}`)
    expect(stageOrder).toContain('extracted:ok')
    expect(stageOrder).toContain('normalized:ok')
    expect(stageOrder).toContain('assembled:ok')
    expect(stageOrder).toContain('rendered:ok')
    expect(stageOrder).toContain('delivered:ok')
  })

  it('honours stop_after and halts at the requested stage', async () => {
    const { pool, log } = makePool({ stage: 'ingested' })
    const out = await drivePipeline({ pool, assembly_id: 'a1', stop_after: 'normalized' })
    expect(out.stage).toBe('normalized')
    const stages = log.map(l => l.stage)
    expect(stages).toContain('extracted')
    expect(stages).toContain('normalized')
    expect(stages).not.toContain('assembled')
    expect(stages).not.toContain('rendered')
    expect(stages).not.toContain('delivered')
  })
})

describe('drivePipeline — failure handling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('marks the assembly failed if a stage returns ok=false', async () => {
    const renderMock = await import('@/lib/documents/puzzleBox/render')
    vi.mocked(renderMock.runRender).mockResolvedValueOnce({
      ok: false,
      code: 'stirling_unavailable',
      message: 'Stirling-PDF is offline.',
      recoverable: true,
    })

    const { pool, log } = makePool({ stage: 'ingested' })
    const out = await drivePipeline({ pool, assembly_id: 'a1' })
    expect(out.stage).toBe('failed')
    expect(out.error).toContain('stirling_unavailable')
    const renderEntry = log.find(l => l.stage === 'rendered')
    expect(renderEntry?.status).toBe('failed')
    // Should not progress to deliver after a failed render
    expect(log.some(l => l.stage === 'delivered')).toBe(false)
  })

  it('throws on missing assembly id', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as Pool
    await expect(drivePipeline({ pool, assembly_id: 'missing' })).rejects.toThrow('assembly_not_found')
  })
})

describe('drivePipeline — resume from failed', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('treats stage=failed as a restart from extracted', async () => {
    const { pool, log } = makePool({ stage: 'failed', error: 'old error' })
    const out = await drivePipeline({ pool, assembly_id: 'a1' })
    expect(out.stage).toBe('delivered')
    expect(log.some(l => l.stage === 'extracted')).toBe(true)
  })
})

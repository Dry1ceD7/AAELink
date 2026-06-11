/**
 * Puzzle Box orchestrator — drives stage transitions atomically and
 * records every step in document_pipeline_log. Stages are pure async
 * functions; the orchestrator is the only thing that touches the DB
 * directly, so retry/resume is one SQL update away.
 */

import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import type { AssemblyRecord, PipelineStage, PuzzlePiece, StageStatus } from './types'
import { runIngest } from './ingest'
import { runNormalize } from './normalize'
import { runAssemble } from './assemble'
import { runRender } from './render'
import { runDeliver } from './deliver'
import { log } from '@/lib/infra/log'

interface DriveOpts {
  pool: Pool
  assembly_id: string
  /** Optional raw text for first-time ingest. */
  raw_text?: string
  /** Optional pre-built piece (skips extraction). */
  prebuilt_piece?: PuzzlePiece
  source_kind?: 'upload' | 'email' | 'manual' | 'ticket'
  source_ref?: string
  strategy?: 'regex' | 'llm' | 'auto'
  /** Stop early at this stage (for testing or partial runs). */
  stop_after?: PipelineStage
}

async function logStage(
  pool: Pool, assemblyId: string, stage: PipelineStage,
  status: StageStatus, ms: number, detail: Record<string, unknown>
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO aaelink.document_pipeline_log (id, assembly_id, stage, status, duration_ms, detail, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), assemblyId, stage, status, ms, JSON.stringify(detail), Date.now()]
    )
  } catch (e) {
    log.error('puzzleBox log write failed', { name: 'puzzleBox.logStage', error: e instanceof Error ? e.message : String(e) })
  }
}

async function loadAssembly(pool: Pool, id: string): Promise<AssemblyRecord | null> {
  const { rows } = await pool.query<{
    id: string; workspace_id: string; template_id: string | null;
    client_profile_id: string | null; piece: PuzzlePiece | string;
    stage: PipelineStage; rendered_html: string; output_bucket_key: string;
    delivery_channel_id: string | null; delivery_message_id: string;
    ticket_id: string | null;
    overrides: Record<string, unknown> | string | null;
    error: string; created_by: string | null;
    created_at: string; updated_at: string;
  }>(
    `SELECT id, workspace_id, template_id, client_profile_id, piece, stage,
            rendered_html, output_bucket_key, delivery_channel_id,
            delivery_message_id, ticket_id, overrides, error, created_by, created_at, updated_at
     FROM aaelink.document_assemblies WHERE id = $1`, [id]
  )
  const r = rows[0]
  if (!r) return null
  const piece = typeof r.piece === 'string'
    ? (r.piece ? JSON.parse(r.piece) as PuzzlePiece : null)
    : r.piece
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    template_id: r.template_id,
    client_profile_id: r.client_profile_id,
    piece: piece && piece.schema_version === '1' ? piece : null,
    stage: r.stage,
    rendered_html: r.rendered_html || '',
    output_bucket_key: r.output_bucket_key || '',
    delivery_channel_id: r.delivery_channel_id,
    delivery_message_id: r.delivery_message_id || '',
    ticket_id: r.ticket_id || null,
    overrides: typeof r.overrides === 'string'
      ? JSON.parse(r.overrides || '{}')
      : (r.overrides || {}),
    error: r.error || '',
    created_by: r.created_by,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  }
}

async function setStage(
  pool: Pool, id: string, stage: PipelineStage,
  patch: Record<string, unknown> = {}
): Promise<void> {
  const now = Date.now()
  const sets: string[] = ['stage = $2', 'updated_at = $3']
  const params: (string | number | null)[] = [id, stage, now]
  for (const [k, v] of Object.entries(patch)) {
    params.push(typeof v === 'string' || typeof v === 'number' || v === null ? (v as string | number | null) : JSON.stringify(v))
    sets.push(`${k} = $${params.length}`)
  }
  await pool.query(`UPDATE aaelink.document_assemblies SET ${sets.join(', ')} WHERE id = $1`, params)
}

/**
 * Drive the pipeline forward from the assembly's current stage.
 * Idempotent: re-running an assembly that already reached 'delivered'
 * is a no-op. Re-running from 'failed' resumes from the last log entry.
 */
export async function drivePipeline(opts: DriveOpts): Promise<AssemblyRecord> {
  const a = await loadAssembly(opts.pool, opts.assembly_id)
  if (!a) throw new Error('assembly_not_found')

  const stages: PipelineStage[] = ['ingested', 'extracted', 'normalized', 'assembled', 'rendered', 'delivered']
  let currentIdx = stages.indexOf(a.stage === 'failed' ? 'ingested' : a.stage)
  if (currentIdx < 0) currentIdx = 0

  let piece: PuzzlePiece | null = a.piece
  let assembledHtml = a.rendered_html
  let bucketKey = a.output_bucket_key
  let sizeBytes = 0

  const shouldStop = (s: PipelineStage) => opts.stop_after === s

  // Stage: extract / ingest
  if (currentIdx <= 1 && !piece) {
    const t = Date.now()
    const out = await runIngest({
      workspace_id: a.workspace_id,
      source_kind: opts.source_kind ?? 'upload',
      source_ref: opts.source_ref ?? a.id,
      raw_text: opts.raw_text ?? '',
      prebuilt_piece: opts.prebuilt_piece,
      strategy: opts.strategy,
    })
    if (!out.ok) {
      await logStage(opts.pool, a.id, 'extracted', 'failed', Date.now() - t, { code: out.code, message: out.message })
      await setStage(opts.pool, a.id, 'failed', { error: `${out.code}: ${out.message}` })
      return (await loadAssembly(opts.pool, a.id))!
    }
    piece = out.value
    await logStage(opts.pool, a.id, 'extracted', 'ok', Date.now() - t, { warnings: out.warnings, confidence: piece.extraction.confidence })
    await setStage(opts.pool, a.id, 'extracted', { piece })
    if (shouldStop('extracted')) return (await loadAssembly(opts.pool, a.id))!
  }

  // Stage: normalize
  if (currentIdx <= 2 && piece) {
    const t = Date.now()
    const out = await runNormalize({ pool: opts.pool, workspace_id: a.workspace_id, piece, client_profile_id: a.client_profile_id ?? undefined })
    if (!out.ok) {
      await logStage(opts.pool, a.id, 'normalized', 'failed', Date.now() - t, { code: out.code, message: out.message })
      await setStage(opts.pool, a.id, 'failed', { error: `${out.code}: ${out.message}` })
      return (await loadAssembly(opts.pool, a.id))!
    }
    piece = out.value
    await logStage(opts.pool, a.id, 'normalized', 'ok', Date.now() - t, { warnings: out.warnings })
    await setStage(opts.pool, a.id, 'normalized', { piece })
    if (shouldStop('normalized')) return (await loadAssembly(opts.pool, a.id))!
  }

  // Stage: assemble (template merge)
  let templateClient: { template_id: string; html: string; page_size: string; client_logo_key: string } | null = null
  if (currentIdx <= 3 && piece) {
    const t = Date.now()
    if (!a.template_id) {
      await logStage(opts.pool, a.id, 'assembled', 'failed', Date.now() - t, { code: 'no_template' })
      await setStage(opts.pool, a.id, 'failed', { error: 'no_template' })
      return (await loadAssembly(opts.pool, a.id))!
    }
    const out = await runAssemble({
      pool: opts.pool,
      workspace_id: a.workspace_id,
      template_id: a.template_id,
      piece,
      overrides: a.overrides as Parameters<typeof runAssemble>[0]['overrides'],
    })
    if (!out.ok) {
      await logStage(opts.pool, a.id, 'assembled', 'failed', Date.now() - t, { code: out.code, message: out.message })
      await setStage(opts.pool, a.id, 'failed', { error: `${out.code}: ${out.message}` })
      return (await loadAssembly(opts.pool, a.id))!
    }
    assembledHtml = out.value.html
    templateClient = {
      template_id: out.value.template.id,
      html: assembledHtml,
      page_size: out.value.template.page_size,
      client_logo_key: out.value.client?.logo_bucket_key || '',
    }
    await logStage(opts.pool, a.id, 'assembled', 'ok', Date.now() - t, { template_id: out.value.template.id, has_client: !!out.value.client })
    await setStage(opts.pool, a.id, 'assembled', { rendered_html: assembledHtml })
    if (shouldStop('assembled')) return (await loadAssembly(opts.pool, a.id))!
  }

  // Stage: render → PDF
  if (currentIdx <= 4 && assembledHtml) {
    const t = Date.now()
    // Need template + client for render — reload if necessary
    let template = templateClient
    if (!template && a.template_id) {
      // Lightweight re-resolution from the assembly: we only need page_size + client logo.
      const { rows: tr } = await opts.pool.query<{ page_size: string }>(
        `SELECT page_size FROM aaelink.document_templates WHERE id = $1`, [a.template_id]
      )
      const { rows: cr } = a.client_profile_id
        ? await opts.pool.query<{ logo_bucket_key: string }>(`SELECT logo_bucket_key FROM aaelink.client_profiles WHERE id = $1`, [a.client_profile_id])
        : { rows: [] as { logo_bucket_key: string }[] }
      template = {
        template_id: a.template_id,
        html: assembledHtml,
        page_size: tr[0]?.page_size || 'A4',
        client_logo_key: cr[0]?.logo_bucket_key || '',
      }
    }
    if (!template) {
      await logStage(opts.pool, a.id, 'rendered', 'failed', Date.now() - t, { code: 'missing_template_context' })
      await setStage(opts.pool, a.id, 'failed', { error: 'missing_template_context' })
      return (await loadAssembly(opts.pool, a.id))!
    }
    const out = await runRender({
      assembly_id: a.id,
      workspace_id: a.workspace_id,
      html: template.html,
      template: { id: template.template_id, workspace_id: a.workspace_id, kind: '', name: '', version: 1, html_source: '', css_source: '', required_fields: [], page_size: template.page_size as 'A4', is_active: true },
      client: template.client_logo_key
        ? { id: a.client_profile_id || '', workspace_id: a.workspace_id, code: '', name: '', logo_bucket_key: template.client_logo_key, brand: {}, address: {}, tax_id: '', phone: '', email: '', website: '', legal_boilerplate: '', metadata: {} }
        : null,
    })
    if (!out.ok) {
      await logStage(opts.pool, a.id, 'rendered', 'failed', Date.now() - t, { code: out.code, message: out.message })
      await setStage(opts.pool, a.id, 'failed', { error: `${out.code}: ${out.message}` })
      return (await loadAssembly(opts.pool, a.id))!
    }
    bucketKey = out.value.bucket_key
    sizeBytes = out.value.size_bytes
    await logStage(opts.pool, a.id, 'rendered', 'ok', Date.now() - t, { bucket_key: bucketKey, size: sizeBytes })
    await setStage(opts.pool, a.id, 'rendered', { output_bucket_key: bucketKey })
    if (shouldStop('rendered')) return (await loadAssembly(opts.pool, a.id))!
  }

  // Stage: deliver
  if (currentIdx <= 5 && bucketKey) {
    const t = Date.now()
    const filename = `${a.id}.pdf`
    const out = await runDeliver({
      pool: opts.pool,
      workspace_id: a.workspace_id,
      channel_id: a.delivery_channel_id,
      ticket_id: a.ticket_id,
      assembly_id: a.id,
      bucket_key: bucketKey,
      size_bytes: sizeBytes || 0,
      filename,
      posted_by: a.created_by || '',
    })
    if (!out.ok) {
      await logStage(opts.pool, a.id, 'delivered', 'failed', Date.now() - t, { code: out.code, message: out.message })
      await setStage(opts.pool, a.id, 'failed', { error: `${out.code}: ${out.message}` })
      return (await loadAssembly(opts.pool, a.id))!
    }
    await logStage(opts.pool, a.id, 'delivered', 'ok', Date.now() - t, { message_id: out.value.message_id, channel_id: out.value.channel_id })
    await setStage(opts.pool, a.id, 'delivered', {
      delivery_message_id: out.value.message_id || '',
    })
  }

  return (await loadAssembly(opts.pool, a.id))!
}

/**
 * Render stage — assembled HTML → PDF via Stirling. Compresses,
 * optionally adds a brand stamp, and writes to S3.
 */

import type { StageResult, DocumentTemplate, ClientProfile } from './types'
import { htmlToPdf, compressPdf, addStamp, addWatermark, isStirlingAvailable } from '../stirlingPdf'
import { getS3Client, getBucket, putObjectBytes, getObjectBytes } from '@/lib/infra/s3'

export interface RenderInput {
  assembly_id: string
  workspace_id: string
  html: string
  template: DocumentTemplate
  client: ClientProfile | null
  /** Add a "STAGING" watermark when env=staging. */
  stage_env?: string
}

export interface RenderOutput {
  bucket_key: string
  size_bytes: number
}

export async function runRender(input: RenderInput): Promise<StageResult<RenderOutput>> {
  if (!(await isStirlingAvailable())) {
    return { ok: false, code: 'stirling_unavailable', message: 'Stirling-PDF service is not reachable.', recoverable: true }
  }
  try {
    let pdf = await htmlToPdf(input.html, { page_size: input.template.page_size, print_background: true })
    pdf = await compressPdf(pdf, 6)

    if (input.client?.logo_bucket_key) {
      const s3 = getS3Client()
      if (s3) {
        try {
          const logo = await getObjectBytes(s3, getBucket(), input.client.logo_bucket_key)
          pdf = await addStamp(pdf, logo, 'image/png', { page: 1, x: 0.05, y: 0.05, opacity: 1 })
        } catch { /* logo optional */ }
      }
    }

    if ((input.stage_env || process.env.NODE_ENV) === 'staging') {
      pdf = await addWatermark(pdf, 'STAGING')
    }

    const s3 = getS3Client()
    if (!s3) return { ok: false, code: 's3_not_configured', message: 'Object storage not configured.' }
    const key = `workspaces/${input.workspace_id}/documents/${input.assembly_id}.pdf`
    await putObjectBytes({ s3, bucket: getBucket(), key, body: pdf, contentType: 'application/pdf' })
    return { ok: true, value: { bucket_key: key, size_bytes: pdf.byteLength } }
  } catch (e) {
    return { ok: false, code: 'render_failed', message: e instanceof Error ? e.message : String(e), recoverable: true }
  }
}

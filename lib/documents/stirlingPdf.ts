/**
 * Stirling PDF API wrapper — communicates with the self-hosted Stirling-PDF
 * service for server-side PDF operations: merge, split, rotate, OCR,
 * convert (docx/xlsx → pdf), redaction, and form filling.
 *
 * Requires env: STIRLING_URL (e.g. http://stirling-pdf:8080)
 */

function getBaseUrl(): string {
  return (process.env.STIRLING_URL || '').replace(/\/+$/, '')
}

function assertUrl(url: string) {
  if (!url) throw new Error('STIRLING_URL not configured')
}

/** Convert Buffer to a clean ArrayBuffer for Blob compatibility. */
function toAB(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

// ── Generic multipart helper ────────────────────────────────────────────────

async function stirlingPost(
  path: string,
  form: FormData,
  timeout = 120_000
): Promise<Buffer> {
  const url = getBaseUrl()
  assertUrl(url)

  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(timeout),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Stirling ${path} failed: ${res.status} ${text.slice(0, 200)}`)
  }

  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

// ── PDF Merge ───────────────────────────────────────────────────────────────

/** Merge multiple PDFs into one. */
export async function mergePdfs(files: Buffer[]): Promise<Buffer> {
  const form = new FormData()
  files.forEach((buf, i) => {
    form.append('fileInput', new Blob([toAB(buf)], { type: 'application/pdf' }), `file_${i}.pdf`)
  })
  return stirlingPost('/api/v1/general/merge-pdfs', form)
}

// ── PDF Split ───────────────────────────────────────────────────────────────

/**
 * Split a PDF by page ranges.
 * @param pages — comma-separated page ranges, e.g. "1-3,5,8-10"
 */
export async function splitPdf(file: Buffer, pages: string): Promise<Buffer> {
  const form = new FormData()
  form.append('fileInput', new Blob([toAB(file)], { type: 'application/pdf' }), 'input.pdf')
  form.append('pageNumbers', pages)
  return stirlingPost('/api/v1/general/split-pages', form)
}

// ── PDF Rotate ──────────────────────────────────────────────────────────────

/** Rotate all pages in a PDF. angle: 90, 180, 270. */
export async function rotatePdf(file: Buffer, angle: number): Promise<Buffer> {
  const form = new FormData()
  form.append('fileInput', new Blob([toAB(file)], { type: 'application/pdf' }), 'input.pdf')
  form.append('angle', String(angle))
  return stirlingPost('/api/v1/general/rotate-pdf', form)
}

// ── OCR ─────────────────────────────────────────────────────────────────────

/** Run OCR on a scanned PDF to make it searchable. */
export async function ocrPdf(file: Buffer, languages: string[] = ['eng']): Promise<Buffer> {
  const form = new FormData()
  form.append('fileInput', new Blob([toAB(file)], { type: 'application/pdf' }), 'input.pdf')
  form.append('languages', languages.join(','))
  form.append('sidecar', 'false')
  form.append('deskew', 'true')
  form.append('clean', 'true')
  form.append('cleanFinal', 'true')
  form.append('ocrType', 'skip-text')
  return stirlingPost('/api/v1/misc/ocr-pdf', form, 300_000) // OCR can take longer
}

// ── File Conversion → PDF ───────────────────────────────────────────────────

/** Convert office documents (docx, xlsx, pptx, etc.) to PDF. */
export async function convertToPdf(
  file: Buffer,
  filename: string,
  contentType: string
): Promise<Buffer> {
  const form = new FormData()
  form.append('fileInput', new Blob([toAB(file)], { type: contentType }), filename)
  return stirlingPost('/api/v1/convert/file/pdf', form, 180_000)
}

// ── Image to PDF ────────────────────────────────────────────────────────────

/** Convert image(s) to PDF. */
export async function imageToPdf(images: { buf: Buffer; name: string; type: string }[]): Promise<Buffer> {
  const form = new FormData()
  images.forEach(img => {
    form.append('fileInput', new Blob([toAB(img.buf)], { type: img.type }), img.name)
  })
  form.append('fitOption', 'fillPage')
  form.append('colorType', 'color')
  form.append('autoRotate', 'true')
  return stirlingPost('/api/v1/convert/img/pdf', form)
}

// ── Page Extraction ─────────────────────────────────────────────────────────

/** Extract specific pages from a PDF. Returns a single PDF with selected pages. */
export async function extractPages(file: Buffer, pages: string): Promise<Buffer> {
  // Uses the same split endpoint but returns only selected pages
  return splitPdf(file, pages)
}

// ── PDF to Image ────────────────────────────────────────────────────────────

/** Convert PDF pages to images (for preview rendering). */
export async function pdfToImages(
  file: Buffer,
  format: 'png' | 'jpeg' = 'png',
  dpi = 150
): Promise<Buffer> {
  const form = new FormData()
  form.append('fileInput', new Blob([toAB(file)], { type: 'application/pdf' }), 'input.pdf')
  form.append('imageFormat', format)
  form.append('singleOrMultiple', 'multiple')
  form.append('colorType', 'color')
  form.append('dpi', String(dpi))
  return stirlingPost('/api/v1/convert/pdf/img', form)
}

// ── Redaction ───────────────────────────────────────────────────────────────

/**
 * Redact text from a PDF (permanent removal, not just visual overlay).
 * @param searchText — text to find and redact
 */
export async function redactPdf(file: Buffer, searchText: string): Promise<Buffer> {
  const form = new FormData()
  form.append('fileInput', new Blob([toAB(file)], { type: 'application/pdf' }), 'input.pdf')
  form.append('listOfText', searchText)
  form.append('useRegex', 'false')
  form.append('wholeWordSearch', 'true')
  form.append('redactColor', '#000000')
  form.append('customPadding', '0')
  form.append('convertPDFToImage', 'false')
  return stirlingPost('/api/v1/security/auto-redact', form)
}

// ── Add Watermark ───────────────────────────────────────────────────────────

export async function addWatermark(file: Buffer, text: string): Promise<Buffer> {
  const form = new FormData()
  form.append('fileInput', new Blob([toAB(file)], { type: 'application/pdf' }), 'input.pdf')
  form.append('watermarkText', text)
  form.append('fontSize', '30')
  form.append('rotation', '45')
  form.append('opacity', '0.3')
  form.append('widthSpacer', '100')
  form.append('heightSpacer', '100')
  form.append('watermarkType', 'text')
  return stirlingPost('/api/v1/security/add-watermark', form)
}

// ── HTML → PDF (v0.1.0 — Puzzle Box render stage) ───────────────────────────

export interface HtmlToPdfOptions {
  page_size?: 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5'
  margin_mm?: number
  landscape?: boolean
  print_background?: boolean
}

/** Convert an HTML string to a PDF via Stirling. */
export async function htmlToPdf(html: string, opts: HtmlToPdfOptions = {}): Promise<Buffer> {
  const form = new FormData()
  const blob = new Blob([html], { type: 'text/html' })
  form.append('fileInput', blob, 'input.html')
  form.append('pageSize', opts.page_size || 'A4')
  form.append('pageMargin', String(opts.margin_mm ?? 15))
  form.append('landscape', String(!!opts.landscape))
  form.append('printBackground', String(opts.print_background ?? true))
  return stirlingPost('/api/v1/convert/html/pdf', form, 180_000)
}

// ── Compress PDF ────────────────────────────────────────────────────────────

/** Compress a PDF. level: 1 (light) .. 9 (max). */
export async function compressPdf(file: Buffer, level: number = 5): Promise<Buffer> {
  const form = new FormData()
  form.append('fileInput', new Blob([toAB(file)], { type: 'application/pdf' }), 'input.pdf')
  form.append('optimizeLevel', String(Math.min(9, Math.max(1, Math.floor(level)))))
  form.append('expectedOutputSize', '')
  return stirlingPost('/api/v1/misc/compress-pdf', form, 120_000)
}

// ── Add Image Stamp (brand logo, signatures) ────────────────────────────────

export interface StampOptions {
  /** 1-based page index, or 'all'. */
  page?: number | 'all'
  /** 0..1 fractional position from top-left. */
  x?: number
  y?: number
  width_px?: number
  rotation?: number
  opacity?: number
}

/** Stamp an image onto a PDF (used for brand logo / signature placement). */
export async function addStamp(file: Buffer, image: Buffer, mime: string, opts: StampOptions = {}): Promise<Buffer> {
  const form = new FormData()
  form.append('fileInput', new Blob([toAB(file)], { type: 'application/pdf' }), 'input.pdf')
  form.append('stampFile', new Blob([toAB(image)], { type: mime }), 'stamp')
  form.append('stampType', 'image')
  form.append('pageNumbers', opts.page === 'all' || opts.page == null ? 'all' : String(opts.page))
  form.append('position', '7') // top-left default; Stirling 1..9 grid
  form.append('overrideX', String(opts.x ?? 0.05))
  form.append('overrideY', String(opts.y ?? 0.05))
  form.append('rotation', String(opts.rotation ?? 0))
  form.append('opacity', String(opts.opacity ?? 1))
  form.append('fontSize', String(opts.width_px ?? 120))
  return stirlingPost('/api/v1/security/add-stamp', form, 120_000)
}

// ── Health Check ────────────────────────────────────────────────────────────

export async function isStirlingAvailable(): Promise<boolean> {
  const url = getBaseUrl()
  if (!url) return false
  try {
    const res = await fetch(`${url}/api/v1/general/alive`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

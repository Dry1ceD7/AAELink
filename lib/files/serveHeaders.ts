/**
 * Safe byte-serving headers for file downloads.
 *
 * Uploaded content_type is attacker-controlled (it comes straight from the
 * multipart `file.type` at upload with no allowlist), so a file uploaded as
 * `text/html` or `image/svg+xml` would otherwise render as active content on the
 * application's own origin (same-origin phishing, SVG <foreignObject>, etc.) —
 * worst on the unauthenticated public-link path.
 *
 * Policy:
 *   - Only content types on an inline-safe allowlist (images, audio, video, PDF)
 *     are served with their declared type and `inline` disposition so previews
 *     keep working.
 *   - Everything else (notably text/html and image/svg+xml) is served as
 *     `application/octet-stream` with `attachment` disposition, forcing a
 *     download instead of rendering.
 *   - `X-Content-Type-Options: nosniff` is always set on the response directly
 *     (not relying solely on middleware).
 */

/** Content types safe to render inline in the browser. SVG is deliberately out. */
const INLINE_SAFE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'application/pdf',
])

/** Inline-safe MIME prefixes (audio/video of any subtype). */
const INLINE_SAFE_PREFIXES = ['audio/', 'video/']

function isInlineSafe(contentType: string): boolean {
  const ct = String(contentType || '').toLowerCase().split(';')[0].trim()
  if (INLINE_SAFE_TYPES.has(ct)) return true
  return INLINE_SAFE_PREFIXES.some(p => ct.startsWith(p))
}

/**
 * Build response headers for serving file bytes. Neutralizes active-content
 * types (text/html, SVG, etc.) by forcing an attachment download with a generic
 * Content-Type; inline-safe media keeps its declared type + inline disposition.
 */
export function buildServeHeaders(params: {
  contentType: string
  filename: string
  size: number
  cacheControl: string
}): Record<string, string> {
  const safeName = params.filename.replace(/"/g, '_')
  const inline = isInlineSafe(params.contentType)
  const servedType = inline ? params.contentType : 'application/octet-stream'
  const disposition = inline ? 'inline' : 'attachment'
  return {
    'Content-Type': servedType,
    'Content-Disposition': `${disposition}; filename="${safeName}"`,
    'Content-Length': String(params.size),
    'Cache-Control': params.cacheControl,
    'X-Content-Type-Options': 'nosniff',
  }
}

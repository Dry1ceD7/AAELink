/**
 * Pure-JS image metadata extraction — dimensions + EXIF orientation.
 *
 * Files parity follow-up: file_attachments has width/height/duration_ms
 * columns (migration 033) that nothing populates. This module reads image
 * dimensions straight from container headers — no native deps (Hard Rule #7) —
 * so the worker can backfill them without sharp/imagemagick.
 *
 * Supported: PNG, JPEG (incl. EXIF orientation), GIF, WebP (VP8/VP8L/VP8X),
 * BMP. Returns null for anything else (caller leaves columns null).
 *
 * EXIF orientation matters because a JPEG stored sideways reports its encoded
 * dimensions; orientations 5-8 are 90°/270° rotations, so display width/height
 * are swapped. We return the DISPLAY dimensions (post-rotation) since that is
 * what layout cares about.
 */

export interface ImageMeta {
  width: number
  height: number
  /** EXIF orientation 1-8 when present (JPEG only); 0 = none/unknown. */
  orientation: number
}

/** Read a big-endian uint at offset. */
function beUint(buf: Buffer, offset: number, bytes: number): number {
  let v = 0
  for (let i = 0; i < bytes; i++) v = v * 256 + buf[offset + i]
  return v
}

/** Read a little-endian uint at offset. */
function leUint(buf: Buffer, offset: number, bytes: number): number {
  let v = 0
  for (let i = bytes - 1; i >= 0; i--) v = v * 256 + buf[offset + i]
  return v
}

// ── PNG ──────────────────────────────────────────────────────────────
// Signature 89 50 4E 47 0D 0A 1A 0A, then IHDR chunk: width/height at 16/20.
function parsePng(buf: Buffer): ImageMeta | null {
  if (buf.length < 24) return null
  if (beUint(buf, 0, 4) !== 0x89504e47 || beUint(buf, 4, 4) !== 0x0d0a1a0a) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: beUint(buf, 16, 4), height: beUint(buf, 20, 4), orientation: 0 }
}

// ── GIF ──────────────────────────────────────────────────────────────
// 'GIF87a'/'GIF89a', logical screen width/height LE uint16 at 6/8.
function parseGif(buf: Buffer): ImageMeta | null {
  if (buf.length < 10) return null
  const sig = buf.toString('ascii', 0, 6)
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null
  return { width: leUint(buf, 6, 2), height: leUint(buf, 8, 2), orientation: 0 }
}

// ── BMP ──────────────────────────────────────────────────────────────
// 'BM', BITMAPINFOHEADER: width int32 LE at 18, height int32 LE at 22 (can be
// negative for top-down rows — take abs).
function parseBmp(buf: Buffer): ImageMeta | null {
  if (buf.length < 26) return null
  if (buf.toString('ascii', 0, 2) !== 'BM') return null
  const w = buf.readInt32LE(18)
  const h = buf.readInt32LE(22)
  if (w <= 0 || h === 0) return null
  return { width: w, height: Math.abs(h), orientation: 0 }
}

// ── WebP ─────────────────────────────────────────────────────────────
// RIFF....WEBP, then VP8 (lossy) / VP8L (lossless) / VP8X (extended) chunk.
function parseWebp(buf: Buffer): ImageMeta | null {
  if (buf.length < 30) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const fourcc = buf.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') {
    // 24-bit canvas width/height minus one at 24/27.
    return {
      width: 1 + leUint(buf, 24, 3),
      height: 1 + leUint(buf, 27, 3),
      orientation: 0,
    }
  }
  if (fourcc === 'VP8 ') {
    // Lossy: frame tag at 20; sync code 9d 01 2a at 23; 14-bit dims at 26/28.
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null
    return {
      width: leUint(buf, 26, 2) & 0x3fff,
      height: leUint(buf, 28, 2) & 0x3fff,
      orientation: 0,
    }
  }
  if (fourcc === 'VP8L') {
    // Lossless: signature 0x2f at 20, then 14-bit width-1 / height-1 packed.
    if (buf[20] !== 0x2f) return null
    const bits = leUint(buf, 21, 4)
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
      orientation: 0,
    }
  }
  return null
}

// ── JPEG ─────────────────────────────────────────────────────────────
// Walk segment markers to SOFn for dimensions; parse APP1/EXIF for orientation.

/** Parse EXIF orientation (tag 0x0112) out of an APP1 payload. 0 if absent. */
function parseExifOrientation(buf: Buffer, start: number, length: number): number {
  // 'Exif\0\0' header then TIFF block.
  if (length < 14 || buf.toString('ascii', start, start + 4) !== 'Exif') return 0
  const tiff = start + 6
  const endian = buf.toString('ascii', tiff, tiff + 2)
  const le = endian === 'II'
  if (!le && endian !== 'MM') return 0
  const u16 = (o: number) => (le ? leUint(buf, o, 2) : beUint(buf, o, 2))
  const u32 = (o: number) => (le ? leUint(buf, o, 4) : beUint(buf, o, 4))
  if (u16(tiff + 2) !== 0x002a) return 0
  const ifdOffset = u32(tiff + 4)
  const ifd = tiff + ifdOffset
  if (ifd + 2 > start + length) return 0
  const entries = u16(ifd)
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > start + length) break
    if (u16(entry) === 0x0112) {
      const v = u16(entry + 8)
      return v >= 1 && v <= 8 ? v : 0
    }
  }
  return 0
}

function parseJpeg(buf: Buffer): ImageMeta | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let offset = 2
  let orientation = 0
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null
    // The JPEG spec permits any number of 0xFF fill bytes before a marker.
    // Skip the run so a marker preceded by fill bytes (buf[offset+1] === 0xff)
    // is read correctly instead of desyncing the segment walk.
    while (buf[offset + 1] === 0xff && offset + 4 <= buf.length) offset += 1
    if (offset + 4 > buf.length) return null
    const marker = buf[offset + 1]
    // Standalone markers without length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2
      continue
    }
    const segLen = beUint(buf, offset + 2, 2)
    if (segLen < 2) return null
    // APP1 → EXIF orientation.
    if (marker === 0xe1) {
      orientation = parseExifOrientation(buf, offset + 4, segLen - 2) || orientation
    }
    // SOF0-SOF15 (except DHT 0xc4, JPG 0xc8, DAC 0xcc) carry dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > buf.length) return null
      const height = beUint(buf, offset + 5, 2)
      const width = beUint(buf, offset + 7, 2)
      // Orientations 5-8 are 90°/270° — display dims are swapped.
      const swapped = orientation >= 5 && orientation <= 8
      return {
        width: swapped ? height : width,
        height: swapped ? width : height,
        orientation,
      }
    }
    offset += 2 + segLen
  }
  return null
}

/**
 * Largest dimension that fits a signed 32-bit (int4) Postgres column —
 * file_attachments.width/height are INT (migration 033). PNG IHDR declares
 * width/height as 32-bit UNSIGNED, so a crafted/corrupt header (e.g. 0xFFFFFFFF)
 * yields a value beyond int4; persisting it would raise 'integer out of range'
 * and burn worker retries. We treat such sizes as a non-sane header → null.
 */
const MAX_IMAGE_DIMENSION = 2_147_483_647

/** True when both dims are sane positive integers that fit an int4 column. */
function dimsFitInt4(meta: ImageMeta): boolean {
  return (
    Number.isInteger(meta.width) &&
    Number.isInteger(meta.height) &&
    meta.width > 0 &&
    meta.height > 0 &&
    meta.width <= MAX_IMAGE_DIMENSION &&
    meta.height <= MAX_IMAGE_DIMENSION
  )
}

/**
 * Extract display dimensions (+ EXIF orientation) from image bytes.
 * Sniffs the container from magic bytes — the caller's content_type is
 * advisory only (user-supplied, possibly wrong). Returns null when the format
 * is unsupported, the header is malformed, or the declared dimensions are
 * non-positive / exceed an int4 column (so a non-sane header is a clean no-op
 * instead of a failing DB write downstream).
 */
export function extractImageMeta(buf: Buffer): ImageMeta | null {
  if (!buf || buf.length < 10) return null
  const meta =
    parsePng(buf) ??
    parseGif(buf) ??
    parseBmp(buf) ??
    parseWebp(buf) ??
    parseJpeg(buf)
  if (!meta || !dimsFitInt4(meta)) return null
  return meta
}

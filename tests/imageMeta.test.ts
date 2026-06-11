/**
 * Unit tests for lib/files/imageMeta.ts — pure-JS image dimension + EXIF
 * orientation extraction.
 *
 * Every fixture is a minimal valid (or deliberately malformed) container header
 * crafted in-test with Buffer.from / Buffer.alloc — no native deps, no fixture
 * files on disk. We assert the parser reads dimensions from the right offsets,
 * applies EXIF orientation swapping for 90°/270° rotations, and returns null for
 * truncated / garbage / unsupported input.
 */
import { describe, it, expect } from 'vitest'
import { extractImageMeta } from '@/lib/files/imageMeta'

// ── helpers ──────────────────────────────────────────────────────────
function beU16(n: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n, 0)
  return b
}
function beU32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
}
function leU16(n: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n, 0)
  return b
}
function leU24(n: number): Buffer {
  const b = Buffer.alloc(3)
  b.writeUIntLE(n, 0, 3)
  return b
}
function leI32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeInt32LE(n, 0)
  return b
}

// ── PNG ──────────────────────────────────────────────────────────────
function makePng(width: number, height: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    beU32(13), // IHDR length
    Buffer.from('IHDR', 'ascii'),
    beU32(width),
    beU32(height),
    Buffer.from([8, 2, 0, 0, 0]), // bit depth, color type, etc.
  ])
}

// ── GIF ──────────────────────────────────────────────────────────────
function makeGif(sig: 'GIF87a' | 'GIF89a', width: number, height: number): Buffer {
  return Buffer.concat([
    Buffer.from(sig, 'ascii'),
    leU16(width),
    leU16(height),
    Buffer.from([0, 0, 0]), // packed fields + bg + aspect
  ])
}

// ── BMP ──────────────────────────────────────────────────────────────
function makeBmp(width: number, height: number): Buffer {
  const header = Buffer.alloc(26)
  header.write('BM', 0, 'ascii')
  // bytes 2-13 file header fields left zero
  header.writeUInt32LE(40, 14) // BITMAPINFOHEADER size
  leI32(width).copy(header, 18)
  leI32(height).copy(header, 22)
  return header
}

// ── WebP ─────────────────────────────────────────────────────────────
function webpRiff(chunk: Buffer): Buffer {
  const size = 4 + chunk.length // 'WEBP' + chunk
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(size, 0); return b })(),
    Buffer.from('WEBP', 'ascii'),
    chunk,
  ])
}
function makeWebpVp8x(width: number, height: number): Buffer {
  // VP8X chunk: fourcc + size(10) + 1 flags + 3 reserved + 3 (w-1) + 3 (h-1)
  const payload = Buffer.concat([
    Buffer.from([0]),       // flags
    Buffer.from([0, 0, 0]), // reserved
    leU24(width - 1),
    leU24(height - 1),
  ])
  return webpRiff(Buffer.concat([
    Buffer.from('VP8X', 'ascii'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(payload.length, 0); return b })(),
    payload,
  ]))
}
function makeWebpVp8(width: number, height: number): Buffer {
  // VP8 (lossy): 3-byte frame tag, sync 9d 01 2a, 14-bit LE width, 14-bit LE height.
  const payload = Buffer.concat([
    Buffer.from([0, 0, 0]),        // frame tag
    Buffer.from([0x9d, 0x01, 0x2a]), // sync code
    leU16(width & 0x3fff),
    leU16(height & 0x3fff),
    Buffer.alloc(8),               // padding so overall len >= 30
  ])
  return webpRiff(Buffer.concat([
    Buffer.from('VP8 ', 'ascii'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(payload.length, 0); return b })(),
    payload,
  ]))
}
function makeWebpVp8l(width: number, height: number): Buffer {
  // VP8L (lossless): 0x2f signature byte, then 14-bit (w-1) | 14-bit (h-1) packed LE.
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  const packed = Buffer.alloc(4)
  packed.writeUInt32LE(bits >>> 0, 0)
  const payload = Buffer.concat([
    Buffer.from([0x2f]),
    packed,
    Buffer.alloc(8), // padding so overall len >= 30
  ])
  return webpRiff(Buffer.concat([
    Buffer.from('VP8L', 'ascii'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(payload.length, 0); return b })(),
    payload,
  ]))
}

// ── JPEG ─────────────────────────────────────────────────────────────
/** APP1/EXIF segment payload (without the FFE1 marker + length). */
function exifApp1(orientation: number, little: boolean): Buffer {
  const order = little ? Buffer.from('II', 'ascii') : Buffer.from('MM', 'ascii')
  const u16 = little ? leU16 : beU16
  const u32 = little ? ((n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b }) : beU32
  // TIFF header: byte order(2) + 0x002A(2) + IFD offset(4) = 8 bytes from tiff start.
  const tiff = Buffer.concat([
    order,
    u16(0x002a),
    u32(8), // IFD starts immediately after the 8-byte TIFF header
  ])
  // One IFD entry: tag 0x0112 (orientation), type SHORT(3), count 1, value.
  const entryCount = u16(1)
  const entry = Buffer.concat([
    u16(0x0112), // tag
    u16(3),      // type SHORT
    u32(1),      // count
    u16(orientation), // value (SHORT occupies first 2 of the 4 value bytes)
    Buffer.from([0, 0]), // value padding
  ])
  const nextIfd = u32(0)
  const tiffBlock = Buffer.concat([tiff, entryCount, entry, nextIfd])
  return Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiffBlock])
}

/** SOF0 segment payload (without FFC0 marker + length). precision + h + w + comps. */
function sof0(width: number, height: number): Buffer {
  return Buffer.concat([
    Buffer.from([8]), // sample precision
    beU16(height),
    beU16(width),
    Buffer.from([1, 1, 0x11, 0]), // 1 component
  ])
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, marker]),
    beU16(payload.length + 2), // length includes the 2 length bytes
    payload,
  ])
}

function makeJpeg(opts: { width: number; height: number; orientation?: number; little?: boolean }): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])] // SOI
  if (opts.orientation !== undefined) {
    parts.push(jpegSegment(0xe1, exifApp1(opts.orientation, opts.little ?? true)))
  }
  parts.push(jpegSegment(0xc0, sof0(opts.width, opts.height))) // SOF0
  return Buffer.concat(parts)
}

/** JPEG whose SOF0 marker is preceded by N extra 0xFF fill bytes (spec-legal). */
function makeJpegWithFillBytes(width: number, height: number, fill: number): Buffer {
  const sof = jpegSegment(0xc0, sof0(width, height)) // 0xff 0xc0 <len> <payload>
  // Insert `fill` extra 0xff bytes between the leading 0xff and the 0xc0 marker.
  const padded = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.alloc(fill, 0xff),
    sof.subarray(1), // marker byte (0xc0) + length + payload
  ])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), padded]) // SOI + padded SOF0
}

// ── tests ────────────────────────────────────────────────────────────
describe('extractImageMeta — PNG', () => {
  it('reads IHDR width/height', () => {
    expect(extractImageMeta(makePng(640, 480))).toEqual({ width: 640, height: 480, orientation: 0 })
  })
  it('rejects a bad signature', () => {
    const b = makePng(10, 10)
    b[1] = 0x00
    expect(extractImageMeta(b)).toBeNull()
  })
  it('rejects a truncated PNG (< 24 bytes)', () => {
    expect(extractImageMeta(makePng(10, 10).subarray(0, 20))).toBeNull()
  })
})

describe('extractImageMeta — GIF', () => {
  it('reads GIF87a logical screen size (LE)', () => {
    expect(extractImageMeta(makeGif('GIF87a', 300, 200))).toEqual({ width: 300, height: 200, orientation: 0 })
  })
  it('reads GIF89a logical screen size (LE)', () => {
    expect(extractImageMeta(makeGif('GIF89a', 1, 1))).toEqual({ width: 1, height: 1, orientation: 0 })
  })
})

describe('extractImageMeta — BMP', () => {
  it('reads positive width/height', () => {
    expect(extractImageMeta(makeBmp(128, 96))).toEqual({ width: 128, height: 96, orientation: 0 })
  })
  it('takes abs() of a negative (top-down) height', () => {
    expect(extractImageMeta(makeBmp(64, -64))).toEqual({ width: 64, height: 64, orientation: 0 })
  })
  it('rejects non-positive width', () => {
    expect(extractImageMeta(makeBmp(0, 10))).toBeNull()
  })
})

describe('extractImageMeta — WebP', () => {
  it('reads VP8X extended canvas size', () => {
    expect(extractImageMeta(makeWebpVp8x(2000, 1500))).toEqual({ width: 2000, height: 1500, orientation: 0 })
  })
  it('reads VP8 lossy 14-bit dimensions', () => {
    expect(extractImageMeta(makeWebpVp8(800, 600))).toEqual({ width: 800, height: 600, orientation: 0 })
  })
  it('reads VP8L lossless packed dimensions', () => {
    expect(extractImageMeta(makeWebpVp8l(1024, 768))).toEqual({ width: 1024, height: 768, orientation: 0 })
  })
  it('rejects a VP8 chunk with a wrong sync code', () => {
    const b = makeWebpVp8(10, 10)
    b[23] = 0x00 // corrupt sync code
    expect(extractImageMeta(b)).toBeNull()
  })
  it('rejects a VP8L chunk with a wrong signature byte', () => {
    const b = makeWebpVp8l(10, 10)
    b[20] = 0x00 // corrupt 0x2f signature
    expect(extractImageMeta(b)).toBeNull()
  })
})

describe('extractImageMeta — JPEG', () => {
  it('reads SOF0 dimensions with no EXIF', () => {
    expect(extractImageMeta(makeJpeg({ width: 1920, height: 1080 }))).toEqual({
      width: 1920, height: 1080, orientation: 0,
    })
  })
  it('reads EXIF orientation from a little-endian (II) APP1', () => {
    const m = extractImageMeta(makeJpeg({ width: 1920, height: 1080, orientation: 1, little: true }))
    expect(m).toEqual({ width: 1920, height: 1080, orientation: 1 })
  })
  it('reads EXIF orientation from a big-endian (MM) APP1', () => {
    const m = extractImageMeta(makeJpeg({ width: 1920, height: 1080, orientation: 3, little: false }))
    expect(m).toEqual({ width: 1920, height: 1080, orientation: 3 })
  })
  it('swaps display dimensions for orientation 6 (90° rotation)', () => {
    const m = extractImageMeta(makeJpeg({ width: 4000, height: 3000, orientation: 6, little: true }))
    expect(m).toEqual({ width: 3000, height: 4000, orientation: 6 })
  })
  it('swaps display dimensions for orientation 8 (270° rotation, BE)', () => {
    const m = extractImageMeta(makeJpeg({ width: 4000, height: 3000, orientation: 8, little: false }))
    expect(m).toEqual({ width: 3000, height: 4000, orientation: 8 })
  })
  it('does not swap for orientation 2 (mirror, no rotation)', () => {
    const m = extractImageMeta(makeJpeg({ width: 4000, height: 3000, orientation: 2, little: true }))
    expect(m).toEqual({ width: 4000, height: 3000, orientation: 2 })
  })
  it('skips 0xFF fill bytes before the SOF marker (single fill byte)', () => {
    expect(extractImageMeta(makeJpegWithFillBytes(1280, 720, 1))).toEqual({
      width: 1280, height: 720, orientation: 0,
    })
  })
  it('skips a run of 0xFF fill bytes before the SOF marker', () => {
    expect(extractImageMeta(makeJpegWithFillBytes(800, 600, 4))).toEqual({
      width: 800, height: 600, orientation: 0,
    })
  })
})

describe('extractImageMeta — out-of-range / non-sane dimensions', () => {
  it('rejects a PNG declaring width > int4 max (decompression-bomb header)', () => {
    // 0xFFFFFFFF as an unsigned IHDR width is 4,294,967,295 — beyond int4.
    expect(extractImageMeta(makePng(0xffffffff, 100))).toBeNull()
  })
  it('rejects a PNG declaring height > int4 max', () => {
    expect(extractImageMeta(makePng(100, 0xffffffff))).toBeNull()
  })
  it('rejects a PNG declaring zero width', () => {
    expect(extractImageMeta(makePng(0, 100))).toBeNull()
  })
  it('accepts a PNG exactly at the int4 ceiling', () => {
    expect(extractImageMeta(makePng(2147483647, 1))).toEqual({
      width: 2147483647, height: 1, orientation: 0,
    })
  })
})

describe('extractImageMeta — negatives', () => {
  it('returns null for an empty buffer', () => {
    expect(extractImageMeta(Buffer.alloc(0))).toBeNull()
  })
  it('returns null for tiny garbage (< 10 bytes)', () => {
    expect(extractImageMeta(Buffer.from([1, 2, 3]))).toBeNull()
  })
  it('returns null for unrecognized magic bytes', () => {
    expect(extractImageMeta(Buffer.from('not an image at all, just text bytes here', 'ascii'))).toBeNull()
  })
  it('returns null for a RIFF container that is not WEBP', () => {
    const notWebp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WAVE', 'ascii'),
      Buffer.alloc(20),
    ])
    expect(extractImageMeta(notWebp)).toBeNull()
  })
})

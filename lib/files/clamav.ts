/**
 * Minimal ClamAV clamd client over a raw TCP socket (no npm deps).
 *
 * Uses the INSTREAM command: the file bytes are streamed in length-prefixed
 * chunks, terminated by a zero-length chunk. clamd replies with either
 *   "stream: OK\0"                 → clean
 *   "stream: <Name> FOUND\0"       → infected (threat name extracted)
 *   "... ERROR\0"                  → scan error
 *
 * If clamd is unreachable the caller receives verdict 'unknown' — never
 * silently 'clean' — so the D12 download gate can apply strict policy.
 */
import net from 'net'

export type ClamVerdict = 'clean' | 'infected' | 'unknown'

export interface ClamResult {
  verdict: ClamVerdict
  threatName: string
  /** Raw clamd reply or error message, for logging. */
  detail: string
}

const CHUNK_SIZE = 64 * 1024

export function getClamdHost(): string {
  return process.env.CLAMD_HOST?.trim() || 'localhost'
}

export function getClamdPort(): number {
  return Number(process.env.CLAMD_PORT) || 3310
}

/**
 * Parse a raw clamd INSTREAM reply into a verdict.
 * Pure — exported for unit testing.
 */
export function parseClamResponse(raw: string): ClamResult {
  const reply = raw.replace(/\0/g, '').trim()
  if (/\bOK$/.test(reply) && !/FOUND$/.test(reply)) {
    return { verdict: 'clean', threatName: '', detail: reply }
  }
  const found = reply.match(/^stream:\s*(.+?)\s+FOUND$/i)
  if (found) {
    return { verdict: 'infected', threatName: found[1].trim(), detail: reply }
  }
  if (/ERROR$/i.test(reply)) {
    return { verdict: 'unknown', threatName: '', detail: reply || 'clamd_error' }
  }
  // Unrecognized reply — do NOT assume clean.
  return { verdict: 'unknown', threatName: '', detail: reply || 'empty_reply' }
}

/** Length-prefix a chunk per the INSTREAM wire format (4-byte big-endian size). */
function frameChunk(chunk: Buffer): Buffer {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(chunk.length, 0)
  return Buffer.concat([size, chunk])
}

/**
 * Stream a buffer to clamd and return the verdict. Resolves to 'unknown' on
 * any connection/timeout failure (never throws into the caller's happy path).
 */
export function scanBuffer(
  data: Buffer,
  opts: { host?: string; port?: number; timeoutMs?: number } = {}
): Promise<ClamResult> {
  const host = opts.host || getClamdHost()
  const port = opts.port || getClamdPort()
  const timeoutMs = opts.timeoutMs ?? 30_000

  return new Promise((resolve) => {
    let settled = false
    const finish = (r: ClamResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(r)
    }

    const socket = net.createConnection({ host, port })
    const reply: Buffer[] = []

    socket.setTimeout(timeoutMs)
    socket.on('timeout', () => finish({ verdict: 'unknown', threatName: '', detail: 'clamd_timeout' }))
    socket.on('error', (err) =>
      finish({ verdict: 'unknown', threatName: '', detail: `clamd_unreachable: ${err.message}` }))
    socket.on('data', (b: Buffer) => reply.push(b))
    socket.on('end', () => finish(parseClamResponse(Buffer.concat(reply).toString('utf8'))))

    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      for (let off = 0; off < data.length; off += CHUNK_SIZE) {
        socket.write(frameChunk(data.subarray(off, off + CHUNK_SIZE)))
      }
      // Zero-length chunk terminates the stream.
      socket.write(Buffer.from([0, 0, 0, 0]))
    })
  })
}

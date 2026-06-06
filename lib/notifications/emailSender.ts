/**
 * AAELink — SMTP email sender (graceful-fallback convention).
 *
 * Mirrors the S3 client pattern (lib/infra/s3.ts getS3Client() → null when
 * unconfigured): when SMTP is not configured the sender is a logged no-op so
 * tests and unconfigured deployments never need a real mail server. When
 * SMTP_HOST is set it speaks minimal SMTP over node:net / node:tls — no new
 * top-level dependency (Hard Rule #7); nodemailer is intentionally NOT added.
 *
 * Scope: plain-text (and optional HTML) single-recipient transactional mail used
 * by the email queue worker and the digest job. This is deliberately small —
 * AUTH LOGIN, STARTTLS-or-implicit-TLS, one RCPT — not a general MTA.
 *
 * Env:
 *   SMTP_HOST            host (unset ⇒ no-op)
 *   SMTP_PORT            default 587
 *   SMTP_USER/SMTP_PASS  optional AUTH LOGIN credentials
 *   SMTP_FROM            envelope/From address (default no-reply@aaelink.local)
 *   SMTP_SECURE          '1' ⇒ implicit TLS (e.g. port 465); else STARTTLS when offered
 */

import net from 'node:net'
import tls from 'node:tls'
import { log } from '@/lib/infra/log'

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface SmtpConfig {
  host: string
  port: number
  user?: string
  pass?: string
  from: string
  secure: boolean
}

/** Resolve SMTP config from env, or null when unconfigured (graceful no-op). */
export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim()
  if (!host) return null
  return {
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASS?.trim() || undefined,
    from: process.env.SMTP_FROM?.trim() || 'no-reply@aaelink.local',
    secure: process.env.SMTP_SECURE === '1',
  }
}

/** Whether email can actually be delivered (SMTP configured). */
export function isEmailConfigured(): boolean {
  return getSmtpConfig() !== null
}

export type SendResult =
  | { ok: true; delivered: boolean; reason?: 'smtp_unconfigured' }
  | { ok: false; error: string }

/**
 * Reject any value destined for an SMTP header or command line that contains a
 * CR/LF or other control character — the classic header/envelope injection vector
 * (RFC 5322 §2.2: header field bodies are CRLF-delimited). The recipient address
 * is user-controlled (self-service registration, SCIM, bulk import) so an interior
 * "\r\nBcc: attacker@evil.com" would otherwise inject extra recipients/headers at
 * send time. Subject is system-generated but guarded too (belt-and-suspenders).
 */
function assertNoHeaderInjection(field: string, value: string): void {
  // C0 controls (incl. CR/LF), DEL — none are legal in a header value / command.
  if (/[\x00-\x1F\x7F]/.test(value)) {
    throw new Error(`smtp_header_injection:${field}`)
  }
}

/**
 * Send one email. When SMTP is unconfigured this logs and returns
 * { ok:true, delivered:false } so callers (queue worker, digest job) treat it as
 * a successful no-op rather than an error — exactly the S3-null convention.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  // Guard recipient / subject before any branch: a CRLF in `to` must never reach
  // the To: header or the RCPT TO command, even on the unconfigured no-op path.
  try {
    assertNoHeaderInjection('to', msg.to)
    assertNoHeaderInjection('subject', msg.subject)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error('[emailSender] rejected message with control chars in header', { name: 'emailSender.send', error })
    return { ok: false, error }
  }

  const cfg = getSmtpConfig()
  if (!cfg) {
    log.info(`📧 [emailSender] SMTP unconfigured — skipping send to ${maskEmail(msg.to)} (subject: ${msg.subject})`)
    return { ok: true, delivered: false, reason: 'smtp_unconfigured' }
  }
  try {
    assertNoHeaderInjection('from', cfg.from)
    await smtpDeliver(cfg, msg)
    log.info(`📧 [emailSender] delivered to ${maskEmail(msg.to)} (subject: ${msg.subject})`)
    return { ok: true, delivered: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error('[emailSender] delivery failed', { name: 'emailSender.send', error })
    return { ok: false, error }
  }
}

function maskEmail(email: string): string {
  return String(email || '').replace(/(.{2}).+(@.+)/, '$1***$2')
}

// ── Minimal SMTP client (no deps) ────────────────────────────────────

interface SmtpSocket {
  write(data: string): void
  read(): Promise<string>
  upgradeTls(host: string): Promise<void>
  end(): void
}

function buildMime(cfg: SmtpConfig, msg: EmailMessage): string {
  const boundary = `aae_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  const headers = [
    `From: ${cfg.from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `MIME-Version: 1.0`,
    `Date: ${new Date().toUTCString()}`,
  ]
  let bodyPart: string
  if (msg.html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    bodyPart =
      `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${msg.text}\r\n` +
      `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${msg.html}\r\n` +
      `--${boundary}--\r\n`
  } else {
    headers.push(`Content-Type: text/plain; charset=utf-8`)
    bodyPart = `${msg.text}\r\n`
  }
  // Dot-stuff lines beginning with '.' per RFC 5321 §4.5.2.
  const stuffed = bodyPart.replace(/\r\n\./g, '\r\n..')
  return `${headers.join('\r\n')}\r\n\r\n${stuffed}`
}

function encodeHeader(value: string): string {
  // RFC 2047 encoded-word for non-ASCII subjects; pass ASCII through.
  if (/^[\x20-\x7E]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

async function smtpDeliver(cfg: SmtpConfig, msg: EmailMessage): Promise<void> {
  const sock = await connect(cfg)
  try {
    await expect(sock, 220)
    await cmd(sock, `EHLO aaelink`, 250)

    if (!cfg.secure) {
      // Opportunistic STARTTLS (best-effort; many providers require it for AUTH).
      try {
        await cmd(sock, `STARTTLS`, 220)
        await sock.upgradeTls(cfg.host)
        await cmd(sock, `EHLO aaelink`, 250)
      } catch {
        // Server did not offer STARTTLS; continue on the plain channel.
      }
    }

    if (cfg.user && cfg.pass) {
      await cmd(sock, `AUTH LOGIN`, 334)
      await cmd(sock, Buffer.from(cfg.user).toString('base64'), 334)
      await cmd(sock, Buffer.from(cfg.pass).toString('base64'), 235)
    }

    await cmd(sock, `MAIL FROM:<${cfg.from}>`, 250)
    await cmd(sock, `RCPT TO:<${msg.to}>`, 250)
    await cmd(sock, `DATA`, 354)
    sock.write(`${buildMime(cfg, msg)}\r\n.\r\n`)
    await expect(sock, 250)
    try { await cmd(sock, `QUIT`, 221) } catch { /* QUIT is best-effort */ }
  } finally {
    sock.end()
  }
}

function connect(cfg: SmtpConfig): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => reject(e)
    let socket: net.Socket = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.connect({ host: cfg.host, port: cfg.port })

    let buffer = ''
    let waiter: ((line: string) => void) | null = null

    const attach = (s: net.Socket) => {
      s.setEncoding('utf8')
      s.on('data', (chunk: string) => {
        buffer += chunk
        // An SMTP reply ends with "<code> <text>\r\n" (space, not hyphen, after code).
        const m = buffer.match(/(^|\r\n)(\d{3}) [^\r\n]*\r\n$/)
        if (m && waiter) {
          const out = buffer
          buffer = ''
          const w = waiter
          waiter = null
          w(out)
        }
      })
      s.on('error', onError)
    }
    attach(socket)

    const api: SmtpSocket = {
      write: (data: string) => socket.write(data),
      read: () =>
        new Promise<string>((res) => {
          waiter = res
        }),
      upgradeTls: (host: string) =>
        new Promise<void>((res, rej) => {
          const secure = tls.connect({ socket, servername: host }, () => {
            socket = secure
            attach(secure)
            res()
          })
          secure.on('error', rej)
        }),
      end: () => { try { socket.end() } catch { /* ignore */ } },
    }

    socket.once('connect', () => resolve(api))
    if (cfg.secure) socket.once('secureConnect', () => resolve(api))
  })
}

async function expect(sock: SmtpSocket, code: number): Promise<string> {
  const line = await sock.read()
  const got = Number(line.trim().slice(0, 3))
  if (got !== code) throw new Error(`expected SMTP ${code}, got: ${line.trim().slice(0, 120)}`)
  return line
}

async function cmd(sock: SmtpSocket, command: string, code: number): Promise<string> {
  sock.write(`${command}\r\n`)
  return expect(sock, code)
}

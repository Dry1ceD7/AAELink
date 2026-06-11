/**
 * Shared upload-policy enforcement (extension blocking + size cap).
 *
 * The single-shot upload route (app/api/files/upload) and the two-phase /
 * resumable upload-session flow (app/api/files/upload-sessions) MUST apply the
 * SAME org scan policy at the same point — BEFORE any bytes are accepted — so a
 * caller cannot bypass blocked extensions or the size cap by choosing one path
 * over the other. Both routes import these helpers rather than re-implementing
 * the checks.
 *
 * The extension check defends against extname() edge cases that slip a dangerous
 * extension past an exact equality check while the OS/client later normalizes
 * the name back to the dangerous form:
 *   - NUL injection ('evil.exe\0.txt') — native consumers truncate at NUL.
 *   - trailing dot ('evil.exe.')        — Windows/macOS strip it on save.
 *   - trailing whitespace ('evil.exe ') — stripped on Windows.
 *   - double extension ('report.exe.pdf') — every dot-delimited segment tested.
 */
import path from 'path'
import type { ScanPolicy } from './scanGate'

/** Single-shot upload default cap when policy.max_file_size_mb = 0 (50 MB). */
export const SINGLE_SHOT_MAX_BYTES = 50 * 1024 * 1024

/** Two-phase / resumable hard ceiling when policy.max_file_size_mb = 0 (5 GB). */
export const MULTIPART_MAX_BYTES = 5 * 1024 * 1024 * 1024

/**
 * Resolve the effective byte cap for an upload. A policy cap (max_file_size_mb
 * > 0) REPLACES the built-in default; otherwise the supplied default applies.
 */
export function resolveMaxBytes(policy: ScanPolicy, defaultMaxBytes: number): number {
  return policy.max_file_size_mb > 0
    ? policy.max_file_size_mb * 1024 * 1024
    : defaultMaxBytes
}

/**
 * Decide whether a filename's extension is blocked by the policy. Returns the
 * matched blocked extension (e.g. '.exe') or null when allowed. Pure — no I/O.
 */
export function blockedExtensionFor(filename: string, policy: ScanPolicy): string | null {
  if (!policy.blocked_extensions.length) return null
  // Normalize the filename before extracting the extension, mirroring
  // storage.ts safeName() + defending against extname() edge cases.
  const cleanName = String(filename).replace(/\0/g, '').replace(/[.\s]+$/, '')
  const uploadExt = (path.extname(cleanName) || '').toLowerCase()
  const blocked = policy.blocked_extensions
  // Candidate extensions to test: the final extname plus every dot-delimited
  // segment (so a double-extension like 'report.exe.pdf' is caught too).
  const segments = cleanName.toLowerCase().split('.').slice(1).map((s) => `.${s.trim()}`)
  const candidates = uploadExt ? [uploadExt, ...segments] : segments
  return candidates.find((c) => blocked.includes(c)) ?? null
}

/** Structured outcome of the policy precheck. ok=true means accept. */
export type UploadPolicyCheck =
  | { ok: true }
  | { ok: false; error: 'file_too_large'; status: 413; max: number }
  | { ok: false; error: 'extension_blocked'; status: 415; extension: string }

/**
 * Run BOTH policy checks (size cap, then blocked extension) for an upload of a
 * known declared size. `defaultMaxBytes` is the per-flow built-in cap used only
 * when the policy sets no cap (single-shot 50 MB, multipart 5 GB).
 */
export function checkUploadPolicy(
  params: { filename: string; size: number; defaultMaxBytes: number },
  policy: ScanPolicy
): UploadPolicyCheck {
  const maxBytes = resolveMaxBytes(policy, params.defaultMaxBytes)
  if (params.size > maxBytes) {
    return { ok: false, error: 'file_too_large', status: 413, max: maxBytes }
  }
  const matched = blockedExtensionFor(params.filename, policy)
  if (matched) {
    return { ok: false, error: 'extension_blocked', status: 415, extension: matched }
  }
  return { ok: true }
}

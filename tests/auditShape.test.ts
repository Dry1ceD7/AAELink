/**
 * UPG-010 audit-shape golden-file lint (audit-2026-05-26).
 *
 * Future audits emit `docs/audit-YYYY-MM-DD.md` (or in-chat). When the
 * deliverable lands on disk, this test enforces the structural shape
 * defined in `.kiro/specs/comprehensive-project-audit/design.md` so
 * the next audit run cannot silently drop a pillar or duplicate an ID.
 *
 * Skipped when no audit file from the last 30 days is present (so the
 * suite is not held hostage to historical audits).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'

const REPO_ROOT = resolve(__dirname, '..')

function listAuditFiles(): string[] {
  const out = execSync(
    `/usr/bin/find docs -maxdepth 1 -name 'audit-*.md' -type f`,
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  return out
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    // Only the canonical deliverable files (audit-YYYY-MM-DD.md and the
    // collision-suffix forms audit-YYYY-MM-DD-N.md). Companions like
    // `audit-YYYY-MM-DD-changelog.md` and `audit-YYYY-MM-DD-workflow.md`
    // are not deliverables; their headers don't follow the audit shape.
    .filter(p => /\/audit-\d{4}-\d{2}-\d{2}(?:-\d+)?\.md$/.test(p))
}

function pickRecent(files: string[]): string | null {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  let best: { path: string; mtime: number } | null = null
  for (const rel of files) {
    const m = statSync(resolve(REPO_ROOT, rel)).mtimeMs
    if (m < cutoff) continue
    if (!best || m > best.mtime) best = { path: rel, mtime: m }
  }
  return best ? best.path : null
}

const REQUIRED_PILLAR_HEADERS = [
  '🔴 Critical Issues',
  '🟠 Required Changes',
  '🟡 Recommended Upgrades',
  '🗑️ Deletions',
  '✅ Improvements',
  '⚖️ Slack Parity Gaps',
  '🎯 Goal Drift Flags',
  'Verification Confirmation',
] as const

const FINDING_ID_RE = /\b(CRIT|CHG|UPG|DEL|IMP|PARITY|DRIFT)-\d{3,}\b/g

describe('docs/audit-YYYY-MM-DD.md — golden-file shape (UPG-010)', () => {
  const files = listAuditFiles()
  const target = pickRecent(files)

  it.skipIf(target === null)('contains all required pillar headers in order', () => {
    if (!target) return
    const src = readFileSync(resolve(REPO_ROOT, target), 'utf8')
    let cursor = 0
    for (const header of REQUIRED_PILLAR_HEADERS) {
      const idx = src.indexOf(header, cursor)
      expect(idx, `pillar header "${header}" missing or out of order in ${target}`).toBeGreaterThan(-1)
      cursor = idx
    }
  })

  it.skipIf(target === null)('has no duplicate Finding IDs', () => {
    if (!target) return
    const src = readFileSync(resolve(REPO_ROOT, target), 'utf8')
    const matches = src.match(FINDING_ID_RE) ?? []
    // Each ID may legitimately appear more than once (heading + body cite +
    // changelog row). The contract is that the FIRST occurrence per ID is the
    // canonical Finding declaration; we only fail when an ID is declared
    // twice in section-header position. Detect by counting bold-header form
    // `**CRIT-001**` or `### CRIT-001 — ...` (audit-spec form) which appears
    // once per Finding.
    const seenInHeader = new Set<string>()
    const dupes: string[] = []
    const headerRe = /(?:^|\n)(?:###\s+|\*\*)([A-Z]+-\d{3,})(?:\b|\*)/g
    let m: RegExpExecArray | null
    while ((m = headerRe.exec(src)) !== null) {
      const id = m[1]
      if (seenInHeader.has(id)) dupes.push(id)
      else seenInHeader.add(id)
    }
    expect(dupes, `duplicate Finding IDs in section headers: ${dupes.join(', ')}`).toEqual([])
    // Sanity floor: a real audit cites at least 4 distinct Findings.
    expect(matches.length, `no Finding IDs found in ${target}`).toBeGreaterThanOrEqual(4)
  })

  it.skipIf(target === null)('Slack parity matrix has at least 14 rows', () => {
    if (!target) return
    const src = readFileSync(resolve(REPO_ROOT, target), 'utf8')
    const parityIdx = src.indexOf('⚖️ Slack Parity Gaps')
    expect(parityIdx).toBeGreaterThan(-1)
    // Slice from the parity header to the next pillar header.
    const goalIdx = src.indexOf('🎯 Goal Drift Flags', parityIdx)
    const slice = goalIdx > 0 ? src.slice(parityIdx, goalIdx) : src.slice(parityIdx)
    // Markdown table rows: `|` at column 1 and at least one other `|`.
    const tableRows = slice.split('\n').filter(line => /^\|.*\|/.test(line))
    // Subtract the header row + separator. Audit uses one big table or
    // multiple per-category sub-tables; either way the data-row count
    // covers every category at least once.
    const dataRows = tableRows.filter(line => !/^\|\s*-+\s*\|/.test(line))
    expect(
      dataRows.length,
      `parity matrix has ${dataRows.length} rows; spec requires ≥ 14 (one per category)`,
    ).toBeGreaterThanOrEqual(14)
  })
})

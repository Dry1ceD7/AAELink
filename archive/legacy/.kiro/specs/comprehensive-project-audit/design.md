# Design Document

## Overview

The comprehensive project audit is a **process / methodology spec**, not a runtime
software feature. There is no daemon, no API route, no React component to ship.
The deliverable of every audit run is a single Markdown file at
`docs/audit-YYYY-MM-DD.md`, plus a set of triaged remediation artifacts under
`.kiro/stories/` and inline in the audit document itself.

The Audit_Engine described in this document is therefore not application code
inside `app/` or `lib/`. It is an **agent-executed pipeline** that runs inside a
single Kiro / Claude session: an ordered chain of `.claude/skills/` invocations
followed by a verification protocol followed by a disk emit step. The
"architecture" being designed is the procedure the auditor agent follows, the
data shapes it manipulates in memory, the file artifacts it writes to disk, and
the structural invariants those artifacts must satisfy.

This design fixes:

1. The procedure (skill chain, verification protocol, idempotency, determinism).
2. The data shapes (Finding, Slack parity row, Story_Stub front matter).
3. The on-disk emit format (section order, templates, file paths).
4. The structural invariants the emitted document must satisfy.
5. The stack-context guardrails the auditor uses to self-reject bad drafts.
6. The test strategy (lint of the emitted document + golden-file shape check +
   parity-matrix invariant test).

The TypeScript interfaces below are **specification artifacts**, not modules to
import. They describe the in-memory shape the auditor builds before emitting
Markdown. If the audit pipeline is ever re-implemented as actual code (a CLI
under `scripts/audit/`, for example), these are the canonical shapes it must
preserve.

## Architecture

### Audit_Engine as a sequenced pipeline

```mermaid
flowchart TD
  Start([Audit run starts at UTC date D])
  ExtractGoals[Phase A — Extract Blueprint_Goals<br/>parse docs/BLUEPRINT.md headings + bullets]
  Skill1[aaelink-blueprint]
  Skill2[aaelink-feature-parity]
  Skill3[aaelink-rbac-audit]
  Skill4[/aae-security-audit]
  Skill5[/aae-perf-audit]
  Skill6[/aae-test-gap]
  Skill7[aaelink-compliance]
  Skill8[aaelink-realtime]
  RebuildParity[Phase B — Rebuild Slack parity matrix<br/>walk 14 categories in fixed order]
  CrossValidate[Phase C — Cross-validate matrix<br/>diff vs parity-slack-mattermost-aaelink-full-map.md<br/>+ parity-reference-matrix.md]
  Triage[Phase D — Triage Findings into pillars<br/>route 🔴/🟠/🟡/🗑️ to remediation channels]
  Verify[Phase E — Verification_Protocol<br/>contradiction detection, CRIT re-verification,<br/>goal coverage, parity coverage]
  Guardrails[Phase F — Stack-context guardrails<br/>self-reject bad recommendations]
  Emit[Phase G — Disk emit<br/>atomic write Audit_Document<br/>upsert Story_Stubs]
  End([Done])

  Start --> ExtractGoals
  ExtractGoals --> Skill1
  Skill1 --> Skill2
  Skill2 --> Skill3
  Skill3 --> Skill4
  Skill4 --> Skill5
  Skill5 --> Skill6
  Skill6 --> Skill7
  Skill7 --> Skill8
  Skill8 --> RebuildParity
  RebuildParity --> CrossValidate
  CrossValidate --> Triage
  Triage --> Verify
  Verify --> Guardrails
  Guardrails --> Emit
  Emit --> End
```

Phases A–F are **purely in-memory**. The disk is only touched in phase G. This
is what makes the audit safe to interrupt: an interrupted run has no
Audit_Document on disk and therefore cannot leave the project in a half-audited
state (Requirement 10.4).

### Phase responsibilities

| Phase | Responsibility | Inputs | Outputs (in memory) |
|------|----------------|--------|---------------------|
| A | Extract Blueprint_Goals | `docs/BLUEPRINT.md` | `BlueprintGoal[]` |
| Chain | Run Audit_Skill_Chain in fixed order | Stack_Context, repo state, Reference_Documents | `Finding[]` per skill, attributed to skill name(s) |
| B | Rebuild Slack parity matrix | Repo state, Slack_Parity_Categories | 14-row `ParityRow[]` |
| C | Cross-validate parity matrix | Rebuilt matrix + two Parity_Reference_Sources | `ParityRow[]` annotated; extra `⚖️` Findings on disagreement |
| D | Triage Findings | All `Finding[]` | Pillar-keyed map + remediation routes |
| E | Verification_Protocol | Pillar-keyed map, BlueprintGoal[], 14 categories, evidence resolver | Verbatim `FinalVerificationSummary` text + possibly mutated `Finding[]` (CRIT downgrades only) |
| F | Stack-context guardrails | Triaged Findings | Filtered Findings with self-rejected drafts replaced or removed |
| G | Disk emit | Final Findings, summary text, story stub data | `docs/audit-YYYY-MM-DD.md` + `.kiro/stories/<slug>.md` files |

### Inputs / outputs / side effects

| Kind | Path | Direction | Notes |
|------|------|-----------|-------|
| Input (north star) | `docs/BLUEPRINT.md` | Read | Sole source for Blueprint_Goals (Req 2.1). |
| Input (reference) | `docs/ENTERPRISE-BLUEPRINT.md` | Read | Context only (Req 2.2). |
| Input (reference) | `docs/NORTH-STAR-A.md` | Read | Context only (Req 2.2). |
| Input (reference) | `docs/ROADMAP.yaml` | Read | Context only (Req 2.2). |
| Input (parity) | `docs/parity-slack-mattermost-aaelink-full-map.md` | Read | Cross-validation (Req 4.4). |
| Input (parity) | `docs/parity-reference-matrix.md` | Read | Cross-validation (Req 4.4). |
| Input (template) | `.kiro/stories/STORY_TEMPLATE.md` | Read | Story_Stub body source (Req 6.5). |
| Input (cadence) | `docs/audit-2026-05-19.md` | Read | Golden-file structural reference (Req 1.5). |
| Input (skills) | `.claude/skills/aaelink-blueprint/SKILL.md` and the 7 other Audit_Skill_Chain entries | Read | Skill chain (Req 5.1). |
| Output | `docs/audit-YYYY-MM-DD.md` | Atomic write | One per run (Req 1.1, 1.2, 10.4). |
| Output | `docs/audit-YYYY-MM-DD-N.md` (N ≥ 2) | Atomic write | Collision-suffix path (Req 1.3, 10.1). |
| Output | `.kiro/stories/<finding-slug>.md` | Upsert | One per 🟠 / 🟡 Finding (Req 6.2, 6.3, 6.7, 10.2). |
| Side effect | none | — | No DB writes, no network calls, no git commits. |

The audit explicitly does **not** mutate `docs/BLUEPRINT.md`, the
Reference_Documents, the Parity_Reference_Sources, or any application source
file. It is read-only against the project and append-only against
`docs/` + `.kiro/stories/`.

## Data shapes

All shapes are TypeScript-style interfaces describing the auditor's in-memory
representation. They are not runtime modules.

### Finding object

```ts
type Pillar =
  | "🔴 Critical Issues"
  | "🟠 Changes Required"
  | "🟡 Upgrades Recommended"
  | "🗑️ Deletions"
  | "✅ Improvements"
  | "⚖️ Slack Parity Gaps"
  | "🎯 Goal Drift Flags";

type IdPrefix = "CRIT" | "CHG" | "UPG" | "DEL" | "IMP" | "PARITY" | "DRIFT";

interface EvidenceCitation {
  /** Exactly one of pathLineRange, commandOutput, or docQuote MUST be set. */
  pathLineRange?: string;     // e.g. "app/api/messages/route.ts:42-58"
  commandOutput?: string;     // e.g. "$ npm run lint\n  17 problems"
  docQuote?: {
    docPath: string;          // e.g. "docs/BLUEPRINT.md"
    headingOrAnchor: string;  // stable id from the doc
    quote: string;            // verbatim slice
  };
}

interface Finding {
  id: `${IdPrefix}-${string}`;          // e.g. "CRIT-001". NNN is zero-padded ≥3 digits.
  title: string;                         // ≤ 80 chars, imperative voice
  pillar: Pillar;                        // exactly one (Req 3.5, 8.7)
  evidence: EvidenceCitation;            // one of three forms (Req 3.4)
  severityRationale: string;             // why this severity, not another
  recommendation: string;                // what to do, in stack-correct terms (Req 9)
  sourceSkills: string[];                // non-empty, members of Audit_Skill_Chain (Req 5.4)
  /** Only present for ⚖️ Findings emitted by cross-validation disagreement. */
  disagreement?: {
    referenceSource:
      | "docs/parity-slack-mattermost-aaelink-full-map.md"
      | "docs/parity-reference-matrix.md";
  };
  /** Set by Verification_Protocol when a CRIT is downgraded (Req 7.8). */
  downgradedFrom?: "🔴 Critical Issues";
}
```

The `id` shape is enforced by the regex `/^(CRIT|CHG|UPG|DEL|IMP|PARITY|DRIFT)-\d{3,}$/`.
Numbering restarts at `001` per pillar prefix per run, ascending. This makes
ordering stable (Determinism design below).

### Slack parity row

```ts
type ParityStatus = "covered" | "partial" | "missing";
type ReferenceAgreement =
  | "agree"
  | `disagree-with-${"docs/parity-slack-mattermost-aaelink-full-map.md" | "docs/parity-reference-matrix.md"}`;

interface ParityRow {
  category: typeof SLACK_PARITY_CATEGORIES[number]; // 1 of 14, in fixed order
  slackCapability: string;                          // e.g. "Threaded replies in DMs"
  aaelinkStatus: ParityStatus;
  evidence: EvidenceCitation;
  referenceAgreement: ReferenceAgreement;
}

const SLACK_PARITY_CATEGORIES = [
  "Messaging (direct, group, channels, threads)",
  "File sharing and previews",
  "Notifications and alerts",
  "Search functionality",
  "User roles and permissions",
  "App/integration support",
  "Voice and video conferencing",
  "Security and compliance",
  "Mobile and desktop experience",
  "API and webhook support",
  "Emoji reactions and message formatting",
  "Pinned messages and bookmarks",
  "Audit logs and admin controls",
  "Onboarding and user management",
] as const;
```

A `ParityRow` whose `referenceAgreement` is not `"agree"` MUST also produce a
matching `⚖️` `Finding` with `disagreement.referenceSource` set (Req 4.5).

### Story_Stub front matter

Story stubs are written to `.kiro/stories/<finding-slug>.md`. The body is the
exact contents of `.kiro/stories/STORY_TEMPLATE.md` with the front matter
prepended:

```yaml
---
source_finding: CHG-007              # Finding.id (Req 6.6)
pillar: "🟠 Changes Required"        # Finding.pillar
severity: P1                          # P0 for CRIT downgraded → CHG, P1 for CHG, P2 for UPG
slug: chg-007-realtime-presence-debounce
created_at: 2026-05-25                # UTC date of the run that first created the stub
---
```

`<finding-slug>` is `lower-kebab(${Finding.id})-${lower-kebab-of-first-6-words-of-title)}`,
truncated to 80 chars. Slugs MUST be deterministic given the title (Determinism
design below).

## On-disk emit format

### Audit_Document section emit order

Sections appear in fixed order in `docs/audit-YYYY-MM-DD.md` (Req 1.4):

1. Title
2. Executive Summary
3. 🔴 Critical Issues
4. 🟠 Changes Required
5. 🟡 Upgrades Recommended
6. 🗑️ Deletions
7. ✅ Improvements
8. ⚖️ Slack Parity Gaps
9. 🎯 Goal Drift Flags
10. 📋 Final Verification Summary

Section 10 is required but is not itself a pillar.

### Templates

#### Title block

```markdown
# AAELink — Comprehensive Audit ({YYYY-MM-DD})

**Audit lead:** {agent identity}
**Version under review:** {git describe or package.json version}
**Prior audit:** {relative path to most recent prior docs/audit-*.md, or "none"}
**This audit's purpose:** single-pass seven-pillar audit + Slack parity rebuild + verification protocol.

---
```

#### Executive Summary

```markdown
## Executive Summary

### Audit_Skill_Chain run log

| # | Skill | Started (UTC) | Ended (UTC) | Findings emitted |
|---|-------|---------------|-------------|------------------|
| 1 | aaelink-blueprint     | … | … | … |
| 2 | aaelink-feature-parity | … | … | … |
| 3 | aaelink-rbac-audit    | … | … | … |
| 4 | /aae-security-audit   | … | … | … |
| 5 | /aae-perf-audit       | … | … | … |
| 6 | /aae-test-gap         | … | … | … |
| 7 | aaelink-compliance    | … | … | … |
| 8 | aaelink-realtime      | … | … | … |

### Blueprint_Goal coverage

| Goal | Status |
|------|--------|
| {heading or stable id from BLUEPRINT.md} | ✅ satisfied / 🎯 see DRIFT-NNN |
…
```

The Audit_Skill_Chain run log records start and end of every chain step (Req
5.2). The Blueprint_Goal coverage table satisfies Req 8.1.

#### Pillar section template

Every pillar header is rendered. If the pillar is empty, the body is the
literal `_No findings._` (Req 3.2):

```markdown
## 🔴 Critical Issues

_No findings._
```

When non-empty, each Finding is emitted as:

```markdown
### CRIT-001 — {title}

- **Pillar:** 🔴 Critical Issues
- **Source skill(s):** aaelink-rbac-audit, /aae-security-audit
- **Evidence:** `app/api/admin/users/route.ts:42-58`
- **Severity rationale:** {one paragraph}
- **Recommendation:** {one paragraph, stack-correct}

#### Inline_Fix_Task

- [ ] {concrete edit, with file path and the exact change to apply}
- [ ] Re-run four gates (`tsc --noEmit`, `eslint .`, `vitest run`, `next build`).
```

For 🟠 / 🟡 Findings the Inline_Fix_Task block is replaced by:

```markdown
#### Story stub

- [`.kiro/stories/chg-007-realtime-presence-debounce.md`](../.kiro/stories/chg-007-realtime-presence-debounce.md)
```

For 🗑️ Findings the Inline_Fix_Task block is replaced by:

```markdown
#### Deletion_Task

- **Target:** `app/api/legacy/messages/route.ts` (route)
- **Reason:** {one short paragraph}
- **Verification after delete:** four gates pass.
```

For ⚖️ Findings the metadata block also includes:

```markdown
- **Reference Agreement:** disagree-with-docs/parity-reference-matrix.md
```

#### ⚖️ Slack Parity Gaps section

In addition to the per-disagreement Findings, this pillar also embeds the full
rebuilt 14-row matrix as a Markdown table with the columns
`Category | Slack Capability | AAELink Status | Evidence | Reference Agreement`
(Req 4.6).

#### 📋 Final Verification Summary

The body of this section is the verbatim text returned by Phase E. The auditor
must NOT paraphrase or trim it (Req 7.9). The summary template:

```markdown
## 📋 Final Verification Summary

### Goal coverage cross-check
{one line per Blueprint_Goal: covered, drift, or missing}

### Slack parity coverage cross-check
{one line per Slack_Parity_Category: row count, status counts}

### Contradiction detector
{one block per detected contradiction, citing both Finding ids verbatim}

### Critical_Finding re-verification
{one line per CRIT: passed, or downgraded-to-🟠 with reason}
```

## Audit_Skill_Chain pipeline

The chain is invoked in fixed order (Req 5.1):

```mermaid
flowchart LR
  S1[aaelink-blueprint]
  S2[aaelink-feature-parity]
  S3[aaelink-rbac-audit]
  S4[/aae-security-audit]
  S5[/aae-perf-audit]
  S6[/aae-test-gap]
  S7[aaelink-compliance]
  S8[aaelink-realtime]
  V[Verification_Protocol]
  E[Disk Emit]

  S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7 --> S8 --> V --> E
```

Each skill is given the same `Stack_Context` payload, unmodified
(Req 5.5):

```ts
interface StackContext {
  framework: "Next.js 16";
  ui: "React 19";
  language: "TypeScript";
  postgres: { client: "pg"; pool: "lib/db.ts#getPool()" };
  migrations: "lib/migrate.ts";
  test: { unit: "Vitest"; e2e: "Playwright" };
  editor: "Tiptap";
  storage: "AWS S3";
  desktop: "desktop/ Electron client";
  apiRouteCount: "~80 route groups";
  fourGates: ["tsc --noEmit", "eslint .", "vitest run", "next build"];
}
```

Each skill returns `Finding[]` with `sourceSkills` populated. The chain
enforces:

- A skill that emits zero `Finding[]` is allowed; that means "I looked and
  found nothing".
- A skill that **fails to run at all** (no output stream, exception, missing
  skill file) generates a synthetic `🔴 Critical Issues` Finding identifying
  the failed step, and the chain continues with the next skill (Req 5.3, see
  Failure modes below).

## Verification_Protocol algorithm

The protocol runs after the skill chain and before disk emit (Req 7.1, 8.8).

```text
function verificationProtocol(
  findings: Finding[],
  blueprintGoals: BlueprintGoal[],
  parityCategories: typeof SLACK_PARITY_CATEGORIES,
  evidenceResolver: (e: EvidenceCitation) => boolean,
): { findings: Finding[], summary: string }

  step 1 — re-read every Finding
    for each f in findings:
      assert(typeof f.id === "string" && idPattern.test(f.id))
      assert(typeof f.title === "string" && f.title.length > 0)
      assert(typeof f.severityRationale === "string" && f.severityRationale.length > 0)
      assert(typeof f.recommendation === "string" && f.recommendation.length > 0)
      assert(f.evidence has exactly one of {pathLineRange, commandOutput, docQuote})

  step 2 — build {finding-id → pillar → evidence} map
    let byId = new Map<Finding.id, { pillar, evidence }>()
    for each f in findings: byId.set(f.id, { pillar: f.pillar, evidence: f.evidence })
    assert(byId.size === findings.length)   // collision check (Req 8.6)

  step 3 — Blueprint_Goal cross-check
    for each g in blueprintGoals:
      hasFinding = findings.some(f => citesGoal(f, g))
      hasSatisfiedMarker = executiveSummary.satisfiedGoals.includes(g.id)
      if !hasFinding && !hasSatisfiedMarker:
        emit DRIFT-NNN finding "Blueprint_Goal {g.id} unaccounted for"

  step 4 — Slack_Parity_Categories cross-check
    parityFindings = findings.filter(f => f.pillar === "⚖️ Slack Parity Gaps")
    for each cat in parityCategories:
      assert(parityFindings.some(f => f.title.startsWith(cat) || f.evidence.docQuote?.headingOrAnchor === cat))

  step 5 — pairwise contradiction detector
    for each (a, b) in pairs(findings):
      if recommendationsConflict(a.recommendation, b.recommendation):
        record contradiction(a.id, b.id) in summary
        // do NOT remove either Finding (Req 7.6)

  step 6 — Critical_Finding re-verification
    for each f in findings where f.pillar === "🔴 Critical Issues":
      ok = evidenceResolver(f.evidence)   // re-reads the cited file/line, command output, or doc quote
      if !ok:
        f.pillar = "🟠 Changes Required"
        f.downgradedFrom = "🔴 Critical Issues"
        f.id = renumberAsCHG(f.id)        // CRIT-NNN -> CHG-NNN, fresh number per Req 8.6
        record downgrade(originalId, newId, reason) in summary

  step 7 — emit summary verbatim into 📋 section (Req 7.9)
    return { findings, summary: render(summary) }
```

`recommendationsConflict` is a heuristic over the recommendation text: the
pair is flagged when one recommendation contains a phrase like
"add / introduce / enable {X}" while the other contains
"remove / drop / disable {X}" for an overlapping `{X}` token. False positives
are acceptable; the protocol records contradictions, it does not auto-resolve
them.

`evidenceResolver`:

- For `pathLineRange`, re-reads the file and confirms the line range exists and
  is non-empty.
- For `commandOutput`, re-runs the cited command (read-only commands only:
  `tsc --noEmit`, `eslint . --max-warnings 0 --no-fix`, `npm ls`, `git log -n 1`,
  etc.) and confirms the cited substring is present in the output.
- For `docQuote`, re-reads the cited document and confirms the quoted slice
  appears under the cited heading or anchor.

If the resolver returns false, the Critical_Finding is downgraded (Req 7.8).
Downgrades are recorded in the summary; the original CRIT-NNN id and the new
CHG-NNN id are both cited.

## Idempotency design

### Collision-suffix path resolver

```text
function resolveAuditPath(date: ISODate, existing: Set<Path>): Path
  let base = `docs/audit-${date}.md`
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`docs/audit-${date}-${n}.md`)) n++
  return `docs/audit-${date}-${n}.md`
```

This satisfies Req 1.3 and Req 10.1. It never overwrites an existing audit
document. The first collision yields `-2`, the second `-3`, and so on.

### Story_Stub upsert by source_finding ID

```text
function upsertStoryStub(finding: Finding, runDate: ISODate)
  let path = `.kiro/stories/${slug(finding)}.md`
  let body = render(STORY_TEMPLATE.md, finding)
  if (exists(path)):
    // update in place; preserve created_at, refresh body
    let existingFrontMatter = parseFrontMatter(read(path))
    body = mergeFrontMatter(body, { created_at: existingFrontMatter.created_at })
  atomicWrite(path, body)
```

This satisfies Req 6.7 and Req 10.2. There is at most one Story_Stub file per
Finding identifier across the lifetime of the project. Re-running on the same
day refreshes the body but preserves `created_at`.

### Atomic write

```text
function atomicWrite(target: Path, content: string)
  let tmp = `${target}.tmp.${process.pid}.${randomHex(6)}`
  writeFileSync(tmp, content)
  fsyncSync(tmp)
  renameSync(tmp, target)   // atomic on POSIX same-fs
```

This satisfies Req 10.4. An interrupted run leaves at most a `.tmp.*` file,
never a partial `Audit_Document` or partial `Story_Stub`. The cleanup pass at
the start of every run removes any `.tmp.*` files older than 1 hour.

## Determinism design

Determinism (Req 10.3) is enforced by removing every source of nondeterminism
from the emit step:

- **Stable Finding ordering.** Findings are sorted by `(pillarOrder,
  prefixOrder, NNN ascending)` where `pillarOrder` is the fixed section order
  above and `prefixOrder` is the fixed `CRIT < CHG < UPG < DEL < IMP < PARITY <
  DRIFT` sequence. Within a pillar the NNN counter increments in the order the
  Findings were appended, but because the skill chain is deterministic and the
  inputs are fixed, the order is reproducible.
- **Stable parity row ordering.** Rows iterate the 14 categories in the fixed
  `SLACK_PARITY_CATEGORIES` constant order. Within a category, capability rows
  are sorted alphabetically by `slackCapability`.
- **No time-of-day in Finding bodies.** Only the run start UTC date appears in
  the document. The skill chain run log records start and end times, but those
  are the only timestamp fields and they live in the Executive Summary table,
  not inside Findings. Two runs against an identical workspace state on the
  same UTC date produce byte-identical Findings (Req 10.3).
- **Deterministic slugs.** `<finding-slug>` is a pure function of `Finding.id`
  and `Finding.title`. No random component, no clock.

## Cross-validation design

After the rebuilt 14-row parity matrix is in memory, the auditor cross-checks
each row against both Parity_Reference_Sources (Req 4.4):

```text
function crossValidate(rebuilt: ParityRow[]): { rows: ParityRow[], extraFindings: Finding[] }
  let mapA = parseParityMap("docs/parity-slack-mattermost-aaelink-full-map.md")
  let mapB = parseParityMap("docs/parity-reference-matrix.md")
  let extra: Finding[] = []
  for each row of rebuilt:
    let cellA = lookupCell(mapA, row.category, row.slackCapability)
    let cellB = lookupCell(mapB, row.category, row.slackCapability)
    if (cellA && cellA.status !== row.aaelinkStatus):
      row.referenceAgreement = "disagree-with-docs/parity-slack-mattermost-aaelink-full-map.md"
      extra.push(makeParityFinding(row, "docs/parity-slack-mattermost-aaelink-full-map.md"))
    else if (cellB && cellB.status !== row.aaelinkStatus):
      row.referenceAgreement = "disagree-with-docs/parity-reference-matrix.md"
      extra.push(makeParityFinding(row, "docs/parity-reference-matrix.md"))
    else:
      row.referenceAgreement = "agree"
  return { rows: rebuilt, extraFindings: extra }
```

Disagreements never overwrite the rebuilt value (Req 4.5). The rebuilt matrix
is authoritative; the references are only consulted to flag drift in the
references themselves.

## Blueprint_Goal extraction

```text
function extractBlueprintGoals(blueprintMd: string): BlueprintGoal[]
  let ast = parseMarkdown(blueprintMd)
  let goals: BlueprintGoal[] = []
  for each heading H in ast (level 2 or 3):
    if H.text matches /^(Goal|Requirement|Objective|Capability)/i:
      goals.push({ id: stableAnchor(H), heading: H.text, source: "docs/BLUEPRINT.md" })
    for each bullet B directly under H:
      if B.text matches /^MUST|^SHALL|^Provide|^Support/i:
        goals.push({ id: `${stableAnchor(H)}#${index(B)}`, heading: H.text, bullet: B.text, source: "docs/BLUEPRINT.md" })
  return goals
```

Reference_Documents are read only to enrich Finding context; their goal-like
statements never enter the `BlueprintGoal[]` list (Req 2.2). When a
Reference_Document conflicts with the North_Star_Document, the conflict is
itself emitted as a `🎯 DRIFT-NNN` Finding against the Reference_Document
(Req 2.3).

## Stack-context guardrails

Before disk emit, every Finding's `recommendation` is run through a guardrail
filter. Drafts that fail any rule are **self-rejected** by the auditor and
re-drafted before the document is finalized.

| Rule | Trigger phrase / pattern | Required replacement |
|------|--------------------------|----------------------|
| G1 | `new pg.Pool` or `new Pool(` outside `lib/db.ts` | Replace with `getPool()` (Req 9.1). |
| G2 | Raw `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX` etc. embedded in route or feature recommendation | Route through `lib/migrate.ts` (Req 9.2). |
| G3 | Words `shipped`, `done`, `complete`, `release-ready` not adjacent to a citation of all four gates | Either cite all four gates (`tsc --noEmit`, `eslint .`, `vitest run`, `next build`) or rewrite the claim (Req 9.3). |
| G4 | Desktop-client recommendation that does not mention `desktop/` | Re-scope to the `desktop/` Electron client (Req 9.4). |
| G5 | API-route recommendation without a route path of the form `app/api/.../route.ts` | Add the route path within the ~80 API route groups (Req 9.5). |

The guardrails run as a final pre-emit pass. Any recommendation matched by a
trigger and not matching the required replacement is rewritten or, if rewriting
is impossible, the Finding is dropped and a synthetic `🔴 Critical Issues`
Finding is emitted naming the original draft and the guardrail it violated.

## Failure modes

| Failure | Detection | Response |
|---------|-----------|----------|
| Skill in chain produces no output (exception, missing file, empty stream) | Phase Chain catches exception or empty result | Emit synthetic `🔴 Critical Issues` Finding "Audit_Skill_Chain step `<skill>` produced no output" with `evidence.commandOutput` capturing the failure trace. Continue with the next skill (Req 5.3). |
| Verification_Protocol interrupted (process killed mid-Phase E) | `atomicWrite` never called for the Audit_Document | Abort the run. No `Audit_Document` is written. Any `.tmp.*` files are cleaned up at the start of the next run (Req 10.4). |
| Missing `docs/BLUEPRINT.md` | Phase A read fails | Abort the run. The audit cannot proceed without the sole north star (Req 2.1). |
| Missing `STORY_TEMPLATE.md` | Phase G upsert read fails | Abort the run for affected pillars; emit `🔴 Critical Issues` Finding pointing at the missing template. |
| Missing one Parity_Reference_Source | Phase C read fails for that source | Continue cross-validation with the remaining source; emit a `🎯` Finding flagging the missing source as goal drift. |
| Stack-context guardrail self-rejects a draft and rewrite is impossible | Phase F | Drop the offending Finding; emit `🔴 Critical Issues` Finding citing the offending draft and the violated guardrail rule. |

## Test strategy

Two complementary harnesses validate every emitted `Audit_Document`. Both run
under Vitest and live alongside the project test suite. They do not run as
part of the four gates, but they MUST pass before any `docs/audit-*.md` is
considered final.

### Harness 1 — Structural lint of Audit_Document

`tests/audit/structural-lint.test.ts` parses the most recent
`docs/audit-*.md` and asserts:

- All seven pillar headers are present in the fixed section order plus
  `📋 Final Verification Summary`.
- Every Finding has `id`, `title`, `evidence`, `severityRationale`,
  `recommendation`, `sourceSkills`, `pillar`. Missing fields fail the test.
- Every `🔴 Critical Issues` Finding has an `Inline_Fix_Task` block
  immediately following it.
- Every `🟠 Changes Required` and `🟡 Upgrades Recommended` Finding has a
  `Story stub` link that resolves to an existing file under
  `.kiro/stories/`.
- Every `🗑️ Deletions` Finding has a `Deletion_Task` block whose
  `Target` field is a non-empty path / route / dependency / feature flag.
- No two Findings share an id (uniqueness, Req 8.6).
- The `⚖️ Slack Parity Gaps` section contains a 14-row table with the
  fixed columns and at least one row per Slack_Parity_Category.

### Harness 2 — Golden-file shape comparison

`tests/audit/golden-shape.test.ts` parses `docs/audit-2026-05-19.md` and
extracts its heading sequence as a canonical schema. It then parses the most
recent `docs/audit-*.md` and asserts the heading sequence conforms to the
schema (allowing additional Finding-level subheadings, but not allowing the
top-level pillar headers to drift).

### Harness 3 — Parity matrix invariant

`tests/audit/parity-invariant.test.ts` parses the `⚖️ Slack Parity Gaps`
table and asserts:

- 14 distinct categories appear, in the fixed `SLACK_PARITY_CATEGORIES`
  order.
- Every row's `Reference Agreement` field is one of `agree`,
  `disagree-with-docs/parity-slack-mattermost-aaelink-full-map.md`,
  `disagree-with-docs/parity-reference-matrix.md`.
- Every row whose `Reference Agreement` is a `disagree-*` value has a
  matching `⚖️` Finding in the same document with `disagreement.referenceSource`
  set to that source.

### Property-based tests

Where the lint harnesses test the emitted file, the property-based tests
(`tests/audit/properties.test.ts`) test the **pure helpers** that produce the
file: the path resolver, the slug generator, the contradiction detector, the
guardrail filter. These run with at least 100 iterations each (Vitest +
fast-check) and are tagged so a failing run cites the design property number:

> `Feature: comprehensive-project-audit, Property {n}: {property text}`

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Audit_Document path is deterministic from run-start UTC date

For any run-start UTC date `D` and any non-colliding output directory state,
the resolved Audit_Document path equals `docs/audit-${D}.md`.

**Validates: Requirements 1.1**

### Property 2: Exactly one Audit_Document is written per run

For any successful audit run, exactly one file matching the pattern
`docs/audit-YYYY-MM-DD(-N)?.md` is written to disk.

**Validates: Requirements 1.2**

### Property 3: Collision-suffix resolver never overwrites and is monotonic

For any set of pre-existing audit document paths and any target date, the
resolver returns a path that is not in the set and whose numeric suffix is the
smallest unused integer ≥ 2 (or no suffix if the base path is unused).

**Validates: Requirements 1.3, 10.1**

### Property 4: Section emit order is fixed regardless of Finding distribution

For any rendered Audit_Document, the top-level section headers appear in the
fixed canonical order: Title, Executive Summary, 🔴, 🟠, 🟡, 🗑️, ✅, ⚖️, 🎯,
📋. Empty pillars contribute the literal placeholder `_No findings._` and do
not change the order.

**Validates: Requirements 1.4, 3.1, 3.2**

### Property 5: Goal drift findings cite only the North_Star_Document

For any 🎯 Goal Drift Flag Finding, the cited goal source path equals
`docs/BLUEPRINT.md`, and Reference_Documents never contribute to the
`BlueprintGoal[]` list extracted in Phase A.

**Validates: Requirements 2.1, 2.2, 2.4, 2.5**

### Property 6: Reference_Document conflicts emit a 🎯 against the Reference_Document

For any pair `(blueprintGoal, referenceStatement)` where the Reference_Document
contradicts the North_Star_Document, the engine emits a 🎯 Finding whose
evidence cites the Reference_Document path and whose recommendation does not
mutate the North_Star_Document.

**Validates: Requirements 2.3**

### Property 7: Finding identifiers are unique and well-shaped

For any Finding emitted in a run, its `id` matches
`/^(CRIT|CHG|UPG|DEL|IMP|PARITY|DRIFT)-\d{3,}$/`, and within a run no two
Findings share an `id`.

**Validates: Requirements 3.3, 8.6**

### Property 8: Every Finding has all required fields

For any Finding emitted in a run, the fields `id`, `title`, `evidence`,
`severityRationale`, `recommendation`, `sourceSkills`, and `pillar` are
non-empty, and `evidence` carries exactly one of `pathLineRange`,
`commandOutput`, or `docQuote`.

**Validates: Requirements 3.4**

### Property 9: Every Finding belongs to exactly one pillar

For any Finding emitted in a run, its `pillar` is a singleton value from the
seven-pillar enum, and the global pillar map is a partition of the Finding set
(no Finding appears in two pillars).

**Validates: Requirements 3.5, 8.7**

### Property 10: Slack parity matrix walks 14 categories in fixed order

For any rebuilt parity matrix, the rows enumerate the 14 entries of
`SLACK_PARITY_CATEGORIES` in canonical order, and every category contributes at
least one row.

**Validates: Requirements 4.1, 4.2, 8.2**

### Property 11: Covered parity categories emit a `covered` row with evidence

For any Slack_Parity_Category whose AAELink coverage is full, the rebuilt
matrix contains at least one row with `aaelinkStatus = "covered"` and a
non-empty evidence citation pointing at the AAELink implementation.

**Validates: Requirements 4.3**

### Property 12: Parity disagreements are recorded, not silently overwritten

For any cross-validation run, every cell where the rebuilt matrix and a
Parity_Reference_Source disagree produces a ⚖️ Finding annotated with
`disagreement.referenceSource`, and the rebuilt cell value is preserved
unchanged in the matrix.

**Validates: Requirements 4.4, 4.5**

### Property 13: Parity matrix renders with fixed columns

For any rendered Audit_Document, the ⚖️ Slack Parity Gaps section contains a
Markdown table with column headers `Category | Slack Capability | AAELink
Status | Evidence | Reference Agreement` and a row count ≥ 14.

**Validates: Requirements 4.6**

### Property 14: Audit_Skill_Chain runs in fixed order with Stack_Context unmodified

For any audit run, the eight skills are invoked in the fixed sequence
`aaelink-blueprint → aaelink-feature-parity → aaelink-rbac-audit →
/aae-security-audit → /aae-perf-audit → /aae-test-gap → aaelink-compliance →
aaelink-realtime`, each receiving the same `StackContext` object (deep-equal
across calls).

**Validates: Requirements 5.1, 5.5**

### Property 15: Skill chain run log records start and end of every skill

For any audit run, the Executive Summary contains a row for each Audit_Skill_Chain
step with a non-null `Started (UTC)` and `Ended (UTC)` value.

**Validates: Requirements 5.2**

### Property 16: Skill failure produces a CRIT Finding and the chain continues

For any chain step that fails to produce output, the engine emits a 🔴 Critical
Issues Finding identifying the failed step, and every subsequent step in the
chain still runs.

**Validates: Requirements 5.3**

### Property 17: Every Finding is attributed to its source skill(s)

For any Finding emitted in a run, `sourceSkills` is a non-empty subset of the
canonical Audit_Skill_Chain.

**Validates: Requirements 5.4**

### Property 18: Critical Findings carry an Inline_Fix_Task

For any 🔴 Critical Issues Finding emitted in a run, the rendered Audit_Document
contains an `Inline_Fix_Task` block immediately under the Finding, and the
Finding has no Story_Stub on disk.

**Validates: Requirements 6.1, 8.3**

### Property 19: 🟠 / 🟡 Findings have a Story_Stub on disk and a link in the document

For any 🟠 Changes Required or 🟡 Upgrades Recommended Finding emitted in a
run, a file at `.kiro/stories/<finding-slug>.md` exists, its body matches the
shape of `STORY_TEMPLATE.md`, its front matter has `source_finding === Finding.id`,
and the rendered Audit_Document contains a relative-path link to the stub from
under the Finding.

**Validates: Requirements 6.2, 6.3, 6.5, 6.6, 8.4**

### Property 20: 🗑️ Findings carry a Deletion_Task naming a concrete target

For any 🗑️ Deletions Finding emitted in a run, the rendered Audit_Document
contains a `Deletion_Task` block whose `Target` field is a non-empty
path / route / dependency / feature-flag identifier.

**Validates: Requirements 6.4, 8.5**

### Property 21: Story_Stub upsert is idempotent by source_finding ID

For any audit run, no two Story_Stub files share a `source_finding` value, and
re-running on the same input set updates the existing stub in place (preserving
`created_at`) rather than creating a duplicate.

**Validates: Requirements 6.7, 10.2**

### Property 22: Verification_Protocol runs after pillars are populated and before disk write

For any audit run, the Verification_Protocol completes before any
`docs/audit-*.md` or `.kiro/stories/*.md` file is written to disk.

**Validates: Requirements 7.1, 8.8**

### Property 23: Verification re-reads every Finding and consults Blueprint_Goals

For any audit run, the Verification_Protocol invokes its Finding-validation
step exactly once per Finding and consults the extracted Blueprint_Goal map at
least once per Finding that cites a goal.

**Validates: Requirements 7.2, 7.3**

### Property 24: ⚖️ Findings are cross-checked against the 14 Slack_Parity_Categories

For any ⚖️ Slack Parity Gaps Finding emitted in a run, its category field maps
to exactly one of the 14 entries of `SLACK_PARITY_CATEGORIES`.

**Validates: Requirements 7.4**

### Property 25: Contradictions are detected and recorded without removing either Finding

For any pair of Findings whose recommendations cannot both be satisfied, the
contradiction detector flags the pair, records both ids in the Final
Verification Summary, and leaves both Findings present in their pillars.

**Validates: Requirements 7.5, 7.6**

### Property 26: Critical_Findings are re-verified by re-reading evidence; failures downgrade to 🟠

For any 🔴 Critical Issues Finding emitted in a run, the evidence resolver is
invoked on its `evidence` field. If the resolver returns false, the Finding's
pillar is mutated to `🟠 Changes Required`, its id is renumbered to the
`CHG-NNN` range, and the downgrade is noted in the Final Verification Summary.

**Validates: Requirements 7.7, 7.8**

### Property 27: Final_Verification_Summary is the verbatim verifier output

For any audit run, the `📋 Final Verification Summary` section body equals the
text returned by the Verification_Protocol byte-for-byte.

**Validates: Requirements 7.9**

### Property 28: Every Blueprint_Goal is either satisfied or flagged as drift

For any Blueprint_Goal extracted in Phase A, the rendered Audit_Document either
lists it in the Executive Summary `Blueprint_Goal coverage` table with
`✅ satisfied` or contains a `🎯 DRIFT-NNN` Finding citing it.

**Validates: Requirements 8.1**

### Property 29: Stack-context guardrails reject DB / migration / release / desktop / API drafts

For any Finding emitted in a run, the `recommendation` field satisfies all of
the following:

- If it touches a database query, it cites `getPool()` and does not contain
  `new pg.Pool` or `new Pool(`.
- If it touches a schema change, it cites `lib/migrate.ts` and does not
  contain raw `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` outside that
  path.
- If it claims release readiness or "shipped" / "done", it cites all four
  gates (`tsc --noEmit`, `eslint .`, `vitest run`, `next build`).
- If it touches the desktop client, it cites the `desktop/` Electron client.
- If it touches an API route, it cites a route path of the form
  `app/api/.../route.ts`.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

### Property 30: Same input produces a byte-equal Audit_Document modulo timestamps

For any two audit runs against an identical workspace state, identical
North_Star_Document, identical Reference_Documents, identical
Parity_Reference_Sources, and the same UTC start date, the rendered
Audit_Document bytes are equal after stripping the `Started (UTC)` and `Ended
(UTC)` columns of the skill-chain run-log table.

**Validates: Requirements 10.3**

### Property 31: Interrupted run before Verification_Protocol completes leaves no Audit_Document

For any audit run interrupted before Phase E completes, no
`docs/audit-YYYY-MM-DD(-N)?.md` file exists on disk after the interrupt, and
any `.tmp.*` files left behind are cleaned up at the start of the next run.

**Validates: Requirements 10.4**

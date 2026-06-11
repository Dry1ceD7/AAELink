# Requirements Document

## Introduction

This spec defines the requirements for a single-pass comprehensive audit of the AAELink project. The audit produces one dated deliverable, `docs/audit-YYYY-MM-DD.md`, that combines a seven-pillar findings report (🔴 Critical, 🟠 Changes Required, 🟡 Upgrades Recommended, 🗑️ Deletions, ✅ Improvements, ⚖️ Slack Parity Gaps, 🎯 Goal Drift Flags) with a 📋 Final Verification Summary. The audit reads `docs/BLUEPRINT.md` as the sole north star, treats `docs/ENTERPRISE-BLUEPRINT.md`, `docs/NORTH-STAR-A.md`, and `docs/ROADMAP.yaml` as reference-only inputs, and rebuilds a Slack parity matrix from scratch across fourteen named categories before cross-validating against `docs/parity-slack-mattermost-aaelink-full-map.md` and `docs/parity-reference-matrix.md`.

The audit produces a dual outcome: the audit document itself, and a triaged remediation queue (inline fix tasks for 🔴 findings, `.kiro/stories/` story stubs for 🟠 and 🟡 findings, deletion tasks for 🗑️ findings). A dedicated late-stage verification protocol runs before the report is finalized and the protocol's output becomes the 📋 Final Verification Summary section.

## Glossary

- **Audit_Engine**: The system component that orchestrates the seven-pillar audit, the Slack parity rebuild, the verification protocol, and the deliverable assembly.
- **Audit_Document**: The single Markdown file produced at `docs/audit-YYYY-MM-DD.md`, where `YYYY-MM-DD` matches the run date and the filename matches the cadence of `docs/audit-2026-05-14.md` through `docs/audit-2026-05-19.md`.
- **Seven_Pillars**: The seven finding categories produced by the audit, in fixed order: 🔴 Critical Issues, 🟠 Changes Required, 🟡 Upgrades Recommended, 🗑️ Deletions, ✅ Improvements, ⚖️ Slack Parity Gaps, 🎯 Goal Drift Flags. The 📋 Final Verification Summary is a required eighth section but is not itself a pillar.
- **North_Star_Document**: `docs/BLUEPRINT.md`. The sole authoritative goal source for 🎯 Goal Drift Flags.
- **Reference_Documents**: `docs/ENTERPRISE-BLUEPRINT.md`, `docs/NORTH-STAR-A.md`, and `docs/ROADMAP.yaml`. These supply context only and are never used to override or replace North_Star_Document.
- **Blueprint_Goal**: A discrete, named objective, requirement, or capability statement extracted from the North_Star_Document.
- **Slack_Parity_Categories**: The fourteen fixed categories used to rebuild the parity matrix:
  1. Messaging (direct, group, channels, threads)
  2. File sharing and previews
  3. Notifications and alerts
  4. Search functionality
  5. User roles and permissions
  6. App/integration support
  7. Voice and video conferencing
  8. Security and compliance
  9. Mobile and desktop experience
  10. API and webhook support
  11. Emoji reactions and message formatting
  12. Pinned messages and bookmarks
  13. Audit logs and admin controls
  14. Onboarding and user management
- **Parity_Reference_Sources**: `docs/parity-slack-mattermost-aaelink-full-map.md` and `docs/parity-reference-matrix.md`. Used only to cross-validate the rebuilt matrix.
- **Parity_Disagreement**: A row where the rebuilt matrix and a Parity_Reference_Source disagree on whether a Slack capability is present, partial, or missing in AAELink.
- **Audit_Skill_Chain**: The fixed ordered sequence of `.claude/skills/` invoked by Audit_Engine: `aaelink-blueprint` → `aaelink-feature-parity` → `aaelink-rbac-audit` → `/aae-security-audit` → `/aae-perf-audit` → `/aae-test-gap` → `aaelink-compliance` → `aaelink-realtime`.
- **Finding**: A single audit observation belonging to exactly one of the Seven_Pillars, with a unique identifier, a short title, evidence, and a recommendation.
- **Critical_Finding**: A Finding classified as 🔴 Critical Issues.
- **Inline_Fix_Task**: A remediation task embedded directly in the Audit_Document next to a Critical_Finding. Inline_Fix_Tasks are not externalized to `.kiro/stories/`.
- **Story_Stub**: A Markdown file created at `.kiro/stories/<finding-slug>.md` that follows `STORY_TEMPLATE.md` and links back to its source Finding by identifier.
- **Deletion_Task**: A remediation task associated with a 🗑️ Finding, embedded in the Audit_Document, that names the file, directory, route, dependency, or feature flag to remove.
- **Verification_Protocol**: A late-stage Audit_Engine procedure that re-reads all Findings, cross-checks them against Blueprint_Goals and Slack_Parity_Categories, detects internal contradictions, and re-verifies every Critical_Finding before the Audit_Document is finalized.
- **Final_Verification_Summary**: The 📋 section of the Audit_Document populated from the Verification_Protocol output.
- **Stack_Context**: Next.js 16, React 19, TypeScript, Postgres via `pg` with `getPool()`, `lib/migrate.ts` migrations, Vitest + Playwright, Tiptap editor, AWS S3, ~80 API route groups, `desktop/` Electron client, and the four gates `tsc --noEmit`, `eslint .`, `vitest run`, `next build`.

## Requirements

### Requirement 1: Single Dated Deliverable

**User Story:** As the auditor, I want the audit to produce exactly one dated Markdown file at a predictable path, so that the maintainer can find it next to the existing audit cadence.

#### Acceptance Criteria

1. THE Audit_Engine SHALL write the Audit_Document to `docs/audit-YYYY-MM-DD.md` where `YYYY-MM-DD` is the UTC date on which the audit run starts.
2. THE Audit_Engine SHALL produce exactly one Audit_Document per run.
3. IF a file already exists at the target path, THEN THE Audit_Engine SHALL preserve the existing content by appending a numeric suffix `-N` (starting at `-2`) to the filename until an unused path is found.
4. THE Audit_Document SHALL contain, in fixed order, the sections: Title, Executive Summary, 🔴 Critical Issues, 🟠 Changes Required, 🟡 Upgrades Recommended, 🗑️ Deletions, ✅ Improvements, ⚖️ Slack Parity Gaps, 🎯 Goal Drift Flags, 📋 Final Verification Summary.
5. THE Audit_Document SHALL match the structural conventions present in `docs/audit-2026-05-14.md` through `docs/audit-2026-05-19.md`, including front-matter style and heading hierarchy.

### Requirement 2: North Star Source Discipline

**User Story:** As the project maintainer, I want goal-drift findings to be traceable to a single document, so that disagreements between competing planning documents do not silently re-enter the audit.

#### Acceptance Criteria

1. THE Audit_Engine SHALL treat `docs/BLUEPRINT.md` as the sole North_Star_Document for all 🎯 Goal Drift Flags.
2. THE Audit_Engine SHALL treat `docs/ENTERPRISE-BLUEPRINT.md`, `docs/NORTH-STAR-A.md`, and `docs/ROADMAP.yaml` as Reference_Documents.
3. WHEN a Reference_Document conflicts with the North_Star_Document, THE Audit_Engine SHALL record the conflict as a 🎯 Goal Drift Flag against the Reference_Document and SHALL NOT amend the North_Star_Document.
4. THE Audit_Engine SHALL extract a list of Blueprint_Goals from the North_Star_Document before generating any 🎯 Goal Drift Flag.
5. WHERE a Blueprint_Goal is referenced in a Finding, THE Audit_Engine SHALL cite the goal by its heading or stable identifier from the North_Star_Document.

### Requirement 3: Seven-Pillar Coverage

**User Story:** As the auditor, I want every pillar populated with at least an explicit "no findings" marker, so that an empty section cannot be confused with a skipped section.

#### Acceptance Criteria

1. THE Audit_Engine SHALL produce a section header for each of the Seven_Pillars in the Audit_Document.
2. WHEN a pillar has zero Findings, THE Audit_Engine SHALL write the literal line `_No findings._` under that pillar's header.
3. THE Audit_Engine SHALL assign every Finding a unique identifier of the form `<pillar-prefix>-NNN` where the prefix is one of `CRIT`, `CHG`, `UPG`, `DEL`, `IMP`, `PARITY`, `DRIFT`.
4. THE Audit_Engine SHALL include for every Finding: identifier, short title, evidence (file path, line range, command output, or document quote), severity rationale, and recommendation.
5. THE Audit_Engine SHALL ensure every Finding belongs to exactly one pillar.

### Requirement 4: Slack Parity Matrix Rebuild

**User Story:** As the auditor, I want the Slack parity matrix rebuilt from scratch each run, so that stale parity data in reference matrices cannot mask regressions.

#### Acceptance Criteria

1. THE Audit_Engine SHALL rebuild the Slack parity matrix from scratch by walking the fourteen Slack_Parity_Categories in fixed order.
2. THE Audit_Engine SHALL produce at least one ⚖️ Slack Parity Gaps row for each of the fourteen Slack_Parity_Categories.
3. WHEN a Slack_Parity_Category has full coverage in AAELink, THE Audit_Engine SHALL emit a single ⚖️ row marked `status: covered` with evidence linking to the AAELink implementation.
4. WHEN the rebuilt matrix is complete, THE Audit_Engine SHALL cross-validate every row against `docs/parity-slack-mattermost-aaelink-full-map.md` and `docs/parity-reference-matrix.md`.
5. IF a Parity_Disagreement is detected, THEN THE Audit_Engine SHALL record the disagreement as a ⚖️ Finding annotated with `disagreement: <reference-source>` and SHALL NOT silently overwrite the rebuilt value.
6. THE Audit_Engine SHALL render the rebuilt matrix as a Markdown table with columns: Category, Slack Capability, AAELink Status, Evidence, Reference Agreement.

### Requirement 5: Audit Skill Chain Execution

**User Story:** As the auditor, I want the audit to run a fixed chain of skills in a fixed order, so that the audit is reproducible and reviewable.

#### Acceptance Criteria

1. THE Audit_Engine SHALL invoke the Audit_Skill_Chain in fixed order: `aaelink-blueprint`, `aaelink-feature-parity`, `aaelink-rbac-audit`, `/aae-security-audit`, `/aae-perf-audit`, `/aae-test-gap`, `aaelink-compliance`, `aaelink-realtime`.
2. THE Audit_Engine SHALL record the start and end of each skill invocation in the Executive Summary section of the Audit_Document.
3. IF an Audit_Skill_Chain step fails to produce output, THEN THE Audit_Engine SHALL record a 🔴 Critical_Finding identifying the failed step and SHALL continue with the remaining steps.
4. THE Audit_Engine SHALL attribute every Finding to the skill or skills that produced it.
5. WHERE a skill in the chain depends on Stack_Context (for example `getPool()`, `lib/migrate.ts`, the four gates), THE Audit_Engine SHALL pass the Stack_Context to that skill without modification.

### Requirement 6: Triaged Remediation Queue

**User Story:** As the project maintainer, I want every Finding pre-routed to the right remediation channel, so that I do not have to re-classify the audit by hand before acting on it.

#### Acceptance Criteria

1. WHEN a Finding is classified as 🔴 Critical, THE Audit_Engine SHALL write an Inline_Fix_Task directly under the Finding in the Audit_Document.
2. WHEN a Finding is classified as 🟠 Changes Required, THE Audit_Engine SHALL create a Story_Stub at `.kiro/stories/<finding-slug>.md` and link the stub from the Finding.
3. WHEN a Finding is classified as 🟡 Upgrades Recommended, THE Audit_Engine SHALL create a Story_Stub at `.kiro/stories/<finding-slug>.md` and link the stub from the Finding.
4. WHEN a Finding is classified as 🗑️ Deletions, THE Audit_Engine SHALL write a Deletion_Task directly under the Finding naming the exact path, route, dependency, or feature flag to remove.
5. THE Audit_Engine SHALL use `.kiro/stories/STORY_TEMPLATE.md` as the template for every Story_Stub.
6. THE Audit_Engine SHALL set the Finding identifier as the `source_finding` field in every Story_Stub front matter.
7. IF a Story_Stub already exists for a Finding identifier, THEN THE Audit_Engine SHALL update the existing stub instead of creating a duplicate.

### Requirement 7: Verification Protocol

**User Story:** As the auditor, I want a verification pass to run before the report is finalized, so that contradictions and unverified critical findings cannot reach the maintainer.

#### Acceptance Criteria

1. THE Audit_Engine SHALL run the Verification_Protocol after all Seven_Pillars are populated and before the Audit_Document is written to disk.
2. THE Verification_Protocol SHALL re-read every Finding produced by the run.
3. THE Verification_Protocol SHALL cross-check every Finding against the Blueprint_Goals extracted from the North_Star_Document.
4. THE Verification_Protocol SHALL cross-check every ⚖️ Finding against the Slack_Parity_Categories.
5. THE Verification_Protocol SHALL detect internal contradictions, defined as two Findings whose recommendations cannot both be satisfied.
6. IF an internal contradiction is detected, THEN THE Verification_Protocol SHALL record the contradiction in the Final_Verification_Summary and SHALL NOT remove either Finding.
7. THE Verification_Protocol SHALL re-verify every Critical_Finding by re-reading its cited evidence (file path, line range, command output, or document quote).
8. IF a Critical_Finding's cited evidence cannot be re-verified, THEN THE Verification_Protocol SHALL downgrade the Finding to 🟠 Changes Required and SHALL note the downgrade in the Final_Verification_Summary.
9. THE Audit_Engine SHALL write the Verification_Protocol output verbatim into the Final_Verification_Summary section.

### Requirement 8: Correctness Properties of the Audit Process

**User Story:** As the project maintainer, I want a small set of structural invariants on the audit output, so that an audit run can be programmatically rejected when it violates them.

#### Acceptance Criteria

1. THE Audit_Engine SHALL ensure every Blueprint_Goal extracted from the North_Star_Document produces either a satisfied marker in the Executive Summary or a 🎯 Goal Drift Flag.
2. THE Audit_Engine SHALL ensure every Slack_Parity_Category produces at least one ⚖️ Slack Parity Gaps row.
3. THE Audit_Engine SHALL ensure every Critical_Finding has an Inline_Fix_Task in the Audit_Document.
4. THE Audit_Engine SHALL ensure every 🟠 Changes Required Finding and every 🟡 Upgrades Recommended Finding has a corresponding Story_Stub on disk.
5. THE Audit_Engine SHALL ensure every 🗑️ Deletions Finding has a Deletion_Task naming a concrete path, route, dependency, or feature flag.
6. THE Audit_Engine SHALL ensure no Finding identifier collides with another Finding identifier within the same run.
7. THE Audit_Engine SHALL ensure no Finding belongs to more than one pillar.
8. THE Audit_Engine SHALL run the Verification_Protocol before the Audit_Document is finalized on disk.

### Requirement 9: Stack-Context Fidelity

**User Story:** As the project maintainer, I want the audit's Stack_Context findings to use the project's real primitives, so that recommendations are immediately actionable.

#### Acceptance Criteria

1. WHEN a Finding involves a database query, THE Audit_Engine SHALL recommend `getPool()` and SHALL NOT recommend instantiating a new `pg.Pool` in route code.
2. WHEN a Finding involves a schema change, THE Audit_Engine SHALL route the change through `lib/migrate.ts` and SHALL NOT recommend ad-hoc SQL outside that path.
3. WHEN a Finding involves a verification or release readiness claim, THE Audit_Engine SHALL cite the four gates (`tsc --noEmit`, `eslint .`, `vitest run`, `next build`) as the proof obligation.
4. WHEN a Finding involves a desktop client concern, THE Audit_Engine SHALL scope the Finding to the `desktop/` Electron client.
5. WHERE a Finding touches an API route, THE Audit_Engine SHALL identify the route by its path within the ~80 API route groups.

### Requirement 10: Rerun and Idempotency

**User Story:** As the auditor, I want a same-day rerun to be safe, so that re-running the audit cannot corrupt the previous deliverable or duplicate stories.

#### Acceptance Criteria

1. WHEN the audit is rerun on the same UTC date, THE Audit_Engine SHALL apply the numeric-suffix rule from Requirement 1 and SHALL NOT overwrite the previous Audit_Document.
2. WHEN the audit is rerun and a Story_Stub already exists at the target path, THE Audit_Engine SHALL update the stub in place per Requirement 6.
3. THE Audit_Engine SHALL be deterministic given identical inputs (workspace state, North_Star_Document, Reference_Documents, Parity_Reference_Sources), producing Audit_Documents whose Findings differ only in timestamps.
4. IF an audit run is interrupted before the Verification_Protocol completes, THEN THE Audit_Engine SHALL NOT write the Audit_Document to disk.

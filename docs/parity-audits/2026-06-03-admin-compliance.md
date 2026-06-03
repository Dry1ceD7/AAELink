# Parity Audit — Admin & Compliance
Date: 2026-06-03
Auditor: Claude

Scope: user/role management, workspaces/orgs, retention, DLP, audit logs,
eDiscovery export, data residency, legal holds, encryption-at-rest, compliance
modes (HIPAA/FINRA), channel management, guest/external controls.

Reference: Slack Enterprise Grid admin surface (`admin.users.*`,
`admin.conversations.*`, `admin.teams.*`, Audit Logs API, Discovery/Discovery
Enterprise API, SCIM v2), with Mattermost (compliance export, data-retention
jobs, custom roles) as secondary reference. Code was trusted over README/matrix;
the reference matrix (`docs/parity-reference-matrix.md`) over-states several rows
as "Shipped" that are config-only or unenforced (see notes).

## Summary
- Coverage: 34 / 35 behaviors have *some* AAELink surface
- Full (✅): 12 | Partial (🟡): 11 | Stub/config-only (🟠): 8 | Missing (🔴): 4
  (counts are over the 35 enumerated behaviors; one Slack behavior — IDP-group
  role mapping — has no surface at all)

Headline: the execution-engine commit (`09a816cd`) made retention, DLP scanning,
and eDiscovery export *real* (DB deletes honoring legal holds, rule matching →
`dlp_violations`, JSON/CSV artifact to S3 via worker). But three things keep this
below Slack Enterprise Grid parity: (1) **information barriers are stored and
unit-tested but never enforced** at runtime; (2) **DLP is post-hoc only** — no
synchronous block/redact on the send path; (3) a **role-name bug** locks
`it_admin` out of every compliance route. Encryption-at-rest and data-residency
remain UI/metadata only. No HIPAA/FINRA compliance *modes* exist.

## Behavior Matrix

| # | Behavior | Slack | Mattermost | AAELink Route | Test | Level | Notes |
|---|---|---|---|---|---|---|---|
| 1 | List users | `admin.users.list` | `GET /users` | `app/api/admin/users/route.ts:14` `_GET` | — | ✅ | LIMIT 500, no pagination/cursor. |
| 2 | Create user | `admin.users` (invite) | `POST /users` | `app/api/admin/users/route.ts:27` `_POST` | — | ✅ | Audited, role-gated, auto-joins default channels. |
| 3 | Update user / set role | `admin.users.setAdmin/setOwner/setRegular` | `PUT /users/{id}/roles` | `app/api/admin/users/route.ts:94` `_PATCH` | — | ✅ | Role escalation guarded; self-demote blocked. Audited. |
| 4 | Deactivate / suspend user | `admin.users.remove` / `setInactive` | `DELETE /users/{id}` (deactivate) | SCIM only: `app/api/scim/v2/Users/route.ts:471` (DELETE=deactivate) | `__tests__/api/scim-org-scope.test.ts` | 🟡 | No admin-UI deactivate endpoint; only SCIM soft-delete + `status='deactivated'`. No reactivate route. |
| 5 | Custom roles / RBAC | Enterprise role grants (`admin.roles.*`) | `POST /roles` custom roles | `app/api/admin/roles/route.ts` + `lib/auth/customRoles.ts` | `tests/customRoles.test.ts` | 🟡 | CRUD + permissions array exist; not enforced as ReBAC across routes (BLUEPRINT §4.3 OpenFGA = Gap). |
| 6 | Role assignments | `admin.roles.addAssignments` | — | `app/api/admin/roles/assignments/route.ts` | — | 🟡 | Assignment CRUD present; runtime authorization still keyed off `platform_role`, not custom roles. |
| 7 | List orgs / teams | `admin.teams.list` | `GET /teams` | `app/api/admin/org/route.ts` + `org/[orgId]/route.ts` | `tests/orgAdmin.test.ts` | ✅ | Org CRUD, members, policies, domains, workspaces subroutes. |
| 8 | Org workspaces management | `admin.teams.create` / settings | team scheme | `app/api/admin/org/[orgId]/workspaces/route.ts` | `tests/orgAdmin.test.ts` | ✅ | Workspace listing/attach under org. |
| 9 | Org domains / claiming | approved email domains | — | `app/api/admin/org/[orgId]/domains/route.ts` + `lib/enterprise/domainClaiming.ts` | — | 🟡 | Domain allowlist stored; no DNS/TXT verification flow. |
| 10 | Org identity / SSO binding | per-org IdP | SAML/LDAP | `app/api/admin/org/[orgId]/identity/route.ts` | — | 🟡 | Stores identity config; inbound SSO engine lives in `auth/sso/*` (real, per `09a816cd`/ADR-0014). |
| 11 | Shared / connected channels | Slack Connect, `admin.conversations.ext*` | shared channels | `app/api/admin/org/[orgId]/shared-channels/route.ts` + `connect-allowlist` + `lib/enterprise/connectAllowlist.ts` | — | 🟡 | Allowlist + records; no external-org handshake/federation transport. |
| 12 | Custom profile fields | org custom fields | — | `app/api/admin/org/[orgId]/profile-fields/route.ts` + `lib/enterprise/customProfileFields.ts` | — | ✅ | Real (commit 333d587a, D11). |
| 13 | Channel management (admin) | `admin.conversations.*` | channel admin | `app/api/admin/channel-archival/route.ts` | `tests/channelArchival.test.ts` | 🟡 | Inactivity-based archival engine (preview/execute) is real. No admin rename/convert/setTeams/bulk-move parity with `admin.conversations.*`. |
| 14 | Set channel retention | `admin.conversations.setCustomRetention` | per-channel policy | scope-level only: `app/api/admin/retention/route.ts` (`channel` scope) | `tests/retention.test.ts` | 🟠 | Retention is per-*scope* (workspace/channel/dm/file), NOT per-individual-channel. No `getCustomRetention`/`removeCustomRetention` equivalent. |
| 15 | Retention policy CRUD | workspace retention | data retention policy | `app/api/admin/retention/route.ts` `_GET/_PUT` | `tests/retention.test.ts` | ✅ | 4 scopes, enabled flag, delete_files. Audited. |
| 16 | Retention enforcement (delete) | message/file deletion job | retention job | `app/api/admin/retention/enforce/route.ts` + worker `retention_enforce` → `lib/enterprise/retentionJob.ts` + `retentionEnforcer.ts` | `tests/retentionEnforcer.test.ts` | ✅ | Real DELETEs; **honors active legal holds** via `buildHoldExclusion`. Two paths exist: route does naive delete (no hold exclusion), worker/job does hold-aware delete — see Gap 6. |
| 17 | Legal hold create/list/release | n/a (Discovery API + manual) | n/a | `app/api/compliance/legal-holds/route.ts` | (covered indirectly by retentionEnforcer.test) | ✅ | Full lifecycle (active/released/delete), audited. Hold overrides retention (engine-side). |
| 18 | DLP rules CRUD | DLP via Discovery + 3rd-party | n/a (3rd-party) | `app/api/compliance/dlp/route.ts` | `tests/dlpMatch.test.ts`, `__tests__/api/compliance-dlp.test.ts` | ✅ | Rule types pattern/keyword/file/domain/pii; severity, priority, scope_channels. |
| 19 | DLP enforcement on send | (via Discovery tombstone) | n/a | `lib/enterprise/dlpInterceptor.ts` (matchDlpRules/enforceDlpAction) + worker `dlp_scan` → `dlpScanJob.ts` | `tests/dlpMatch.test.ts` | 🟠 | Matching engine is real and logs `dlp_violations`, but **NOT wired into the message-send path** — no synchronous block/redact. `scanMessageContent`/`enforceDlpAction` have zero callers in `app/`. Post-hoc only. |
| 20 | Information barriers / ethical walls | Slack barriers (Enterprise) | n/a | `app/api/compliance/barriers/route.ts` + `lib/enterprise/barrierGuard.ts` | `tests/barrierGuard.test.ts` | 🟠 | `barrierGuard.checkBarrier/isBlocked` are unit-tested but **imported by NOTHING in `app/`**. DM/channel-join/user-search routes never call them. Config-only; barriers do not block anything. |
| 21 | eDiscovery export create/list | Discovery API (`discovery.*`) | compliance export | `app/api/compliance/ediscovery/route.ts` + worker `compliance_export` → `lib/enterprise/complianceExport.ts` + `complianceExportJob.ts` | `tests/complianceExport.test.ts` | ✅ | Real JSON/CSV artifact (messages + audit_log) to S3 via job. |
| 22 | eDiscovery MBOX / native format | Discovery delivers native JSON | global-relay / Actiance | format accepted (`json/csv/mbox`) but builder only emits json/csv (`complianceExport.ts:61`) | `tests/complianceExport.test.ts` | 🟡 | `mbox` requested → silently falls through to JSON. No EML/MBOX, no file-content bundling in export artifact. |
| 23 | eDiscovery scoped by custodian/keyword | Discovery filters | export filters | scope captured in `ediscovery_exports.scope` JSON | — | 🟡 | Scope (custodians/keywords/legal_hold_id/include_files) is *stored* but `complianceExportJob` exports by date+channel only; custodian/keyword/file filters not applied in artifact build. |
| 24 | Audit log read/search | Audit Logs API (`/audit/v1/logs`) | compliance/audit | `app/api/admin/audit-log/route.ts` | — | ✅ | Filter by action/actor/date, paginated. Backed by `lib/enterprise/auditLog.ts` + `tracedRoute()` chokepoint. |
| 25 | Audit log streaming/export | Audit Logs API streaming | — | `app/api/admin/audit-log/export/route.ts` + `audit-log/stream/route.ts` + `audit-streams/route.ts` + `lib/enterprise/auditStream.ts` | — | 🟡 | JSON/CSV dump + SSE stream + external-stream config (SIEM-style). No Slack-grade per-event-type schema or guaranteed delivery/replay. |
| 26 | Data residency / region pinning | Enterprise data residency | n/a | `app/api/admin/data-residency/route.ts` | — | 🟠 | Stores region config in `system_config`; **purely metadata** — no storage layer actually pins data by region. |
| 27 | Encryption at rest config | Slack EKM | DB/disk encryption | `app/api/admin/encryption/route.ts` | — | 🟠 | Config + fake key inventory (`key_material_hash: sha256:<random>`); **no real KMS/crypto** — rotate/create just write rows. `compliance` block is computed cosmetics. |
| 28 | Field-level / message encryption | Slack EKM key revoke | n/a | `field_level_encryption` array in encryption config | — | 🔴 | Declared in config only; no encryption applied to message/file content. |
| 29 | Guest / external user accounts | `admin.users.invite` (guest) multi-channel/restricted | guest accounts | `app/api/admin/guests/route.ts` + `guest_channel_access` | — | 🟡 | Create/list/revoke + per-channel access + expiry field. No scheduled guest-expiry enforcement (job `guest_expire` referenced in `jobs/route.ts` comment but not implemented in worker). No single/multi-channel guest distinction. |
| 30 | SCIM v2 provisioning | SCIM (Users+Groups) | SCIM | `app/api/scim/v2/Users/route.ts` + `Groups/route.ts` + `lib/auth/scim.ts` | `__tests__/api/scim-org-scope.test.ts` | ✅ | Create/update/deactivate + sync log. Org-scoped. |
| 31 | IP allowlist / access control | IP allowlisting (Enterprise) | — | `app/api/admin/ip-access/route.ts` + `lib/security/ipAccess.ts` | — | 🟡 | Stored + checked in middleware; not validated under tests here. |
| 32 | Session policy / forced logout | session duration, `admin.users.session.*` | session length | `app/api/admin/session-policy/route.ts` + `admin/sessions/route.ts` | — | 🟡 | Policy + session list/revoke present. |
| 33 | Device management / remote wipe | EMM, `admin.users.session.reset` | — | `app/api/admin/devices/route.ts` + `devices/[id]/wipe/route.ts` + `emm-policy/route.ts` | — | 🟡 | Device list + wipe-flag + EMM policy config; wipe is a flag, no MDM push. |
| 34 | HIPAA / FINRA compliance mode | n/a (controls, not a "mode") | n/a | none — only cosmetic flags in `encryption/route.ts:66-71` | — | 🔴 | No compliance-*mode* toggle that changes retention/export/encryption behavior. HIPAA/FINRA/SOC2/FedRAMP appear only as computed booleans for display. FINRA/SEC 17a-4 WORM immutability absent. |
| 35 | IDP group → role mapping | SCIM group → role / IdP role sync | LDAP group sync | none (SCIM Groups create groups, not role grants) | — | 🔴 | No mapping from IdP/SCIM groups to platform/custom roles. |

## Critical Gaps (severity-ordered)

1. **Compliance routes reject `it_admin` due to a role-name bug (authorization defect).**
   `dlp`, `legal-holds`, `ediscovery`, `barriers`, `data-residency` gate on
   `['super_admin', 'platform_admin']` (e.g. `compliance/dlp/route.ts:38`,
   `legal-holds/route.ts:32`, `ediscovery/route.ts:34`, `barriers/route.ts:36`,
   `data-residency/route.ts:33`). But the actual enum in
   `lib/comms/platformRole.ts:2` is `'' | super_admin | it_admin | it_employee |
   employee` — **`platform_admin` does not exist**. Net effect: the intended
   admin tier (`it_admin`) is locked out of every compliance surface; only
   `super_admin` works. Inconsistent with sibling routes (`retention`,
   `audit-log`, `roles`) that correctly use `isPlatformAdmin()`.

2. **Information barriers are completely unenforced.**
   `lib/enterprise/barrierGuard.ts` (`checkBarrier`, `isBlocked`) is unit-tested
   (`tests/barrierGuard.test.ts`) but has **zero importers in `app/`**. DM
   creation (`app/api/channels/dm/route.ts`), channel join, and user search do
   not consult barriers. Creating a barrier blocks nothing — a false compliance
   control. Reference matrix lists this "Shipped".

3. **DLP does not block on the send path (post-hoc only).**
   `dlpInterceptor.scanMessageContent`/`enforceDlpAction` have no callers in
   `app/`. The only real enforcement is the async `dlp_scan` worker job which
   logs `dlp_violations` *after* the message is already delivered. `action:
   block`/`redact` therefore never prevent or alter delivery — they only log.

4. **Encryption-at-rest and field-level encryption are cosmetic.**
   `admin/encryption/route.ts` stores config and a key inventory whose material
   is `sha256:<randomUUID slice>` (lines 115, 137); rotate/create/revoke only
   mutate rows. No KMS integration, no crypto applied. `field_level_encryption`
   (#28) and the HIPAA/FedRAMP `compliance` booleans (#34) are display-only.

5. **No HIPAA/FINRA compliance modes; no WORM/immutability for 17a-4.**
   There is no mode that tightens retention/export/audit behavior. FINRA/SEC
   17a-4 require immutable, non-erasable storage — retention here issues hard
   `DELETE`s and audit_log rows are mutable. (Matrix already marks certs "Gap".)

6. **Two divergent retention-enforcement paths; the synchronous route ignores legal holds.**
   `admin/retention/enforce/route.ts` (`_POST`) issues `DELETE` with only a
   cutoff filter and **no hold exclusion** (lines 65-92), whereas the worker job
   (`retentionJob.ts` via `buildHoldExclusion`) correctly protects held content.
   An admin invoking the enforce endpoint directly can purge content under an
   active legal hold — a spoliation risk. Consolidate on the hold-aware engine.

7. **Data residency is metadata only.** `admin/data-residency/route.ts` records
   region/classification config but no storage routing enforces it; S3 bucket
   selection and DB placement are region-agnostic.

8. **eDiscovery export under-applies its own scope and lacks MBOX/native + files.**
   `complianceExportJob` exports by date+channel; custodian/keyword/legal_hold/
   include_files filters captured in `ediscovery_exports.scope` are not applied
   in artifact construction (`complianceExport.ts`). `mbox` format silently
   degrades to JSON. No file-content bundling.

## Recommended Next Steps
1. Fix the role check: replace `['super_admin','platform_admin']` with
   `isPlatformAdmin(role)` across all `compliance/*` and `encryption`/
   `data-residency` routes (1-line per route; unblocks `it_admin`). Add an
   `__tests__/api/` RBAC test asserting `it_admin` access + `employee` 403.
2. Wire `barrierGuard.isBlocked` into DM-create, channel-join, and user-search
   routes; return `{ error: 'blocked_by_information_barrier' }` 403. Add
   integration test.
3. Call `scanMessageContent` + `enforceDlpAction` synchronously in
   `app/api/messages/route.ts` POST before persist (block/redact actions), keep
   the async job for files. Add send-path block test.
4. Make `retention/enforce` route delegate to the hold-aware engine
   (`runRetentionEnforcement`) instead of its own DELETEs; remove the duplicate
   un-holdaware SQL.
5. Apply eDiscovery scope filters (custodian/keyword/legal_hold) in
   `complianceExportJob`; implement real MBOX/EML or drop `mbox` from accepted
   formats. Bundle file bytes when `include_files`.
6. Decide encryption posture: either integrate a real KMS/crypto provider or
   relabel the route as "planned" so the cosmetic `compliance` booleans stop
   implying HIPAA/FedRAMP coverage.
7. Add admin-UI user deactivate/reactivate endpoints (not just SCIM), and
   implement the `guest_expire` worker job.
8. Add a `compliance_mode` (off/hipaa/finra) that, when set, forces
   encryption-on, disables hard-delete in favor of tombstoning, and makes
   audit_log append-only — to approach WORM/17a-4 semantics.

## Out of Scope
- AI/ML features (per standing directive: AI/ML out of scope).
- Actual certification (SOC 2 Type II / ISO 27001 / HIPAA BAA / FedRAMP /
  FINRA 17a-4) — process/legal, not code; ROADMAP lists only `1.0.0.soc2`.
- OpenFGA/ReBAC and mTLS/SPIFFE service identities (BLUEPRINT §4.3/§5.5 drift,
  tracked elsewhere).
- Native MDM/EMM push for true remote-wipe (no mobile client exists).

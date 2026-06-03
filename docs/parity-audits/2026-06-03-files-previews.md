# Parity Audit — Files & Previews
Date: 2026-06-03
Auditor: Claude

## Summary
- Coverage: 26 / 30 behaviors have *some* implementation surface
- Full (✅): 4 | Partial (🟡): 9 | Stub/Broken (🟠): 9 | Missing (🔴): 8

> Trust-code-over-README note: `docs/parity-reference-matrix.md` and
> `docs/parity-slack-mattermost-aaelink-full-map.md` mark nearly every file
> behavior "Shipped". Reading the routes shows the file subsystem is split
> across **four disjoint storage tables** that do not share a primary key
> space, several routes query tables that **do not exist** in `lib/infra/migrate.ts`,
> uploads write to **local disk** (S3 lib is unused on the chat path), and there
> is **no resumable/multipart upload** despite BLUEPRINT §2.1.3 requiring it. The
> only file area that is genuinely solid + tested is D12 (public links + virus-scan
> access gate).

### The table-fragmentation problem (root cause of most 🟠 below)
A single uploaded chat file has no consistent identity across the API surface:

| Route | Table it reads/writes | Exists in migrate.ts? |
|---|---|---|
| `app/api/files/upload/route.ts` (POST/GET) | `aaelink.file_attachments` | ✅ (migrate.ts:426) |
| `app/api/files/[id]/download/route.ts` | `aaelink.file_attachments` | ✅ |
| `lib/files/publicLinks.ts` + `file_public_links` | `aaelink.file_attachments` | ✅ (mig 018, :2972) |
| `app/api/files/route.ts` (list/info/delete) | `aaelink.files` | ❌ **phantom table** |
| `app/api/files/preview/route.ts` | `aaelink.file_uploads` | ❌ **phantom table** |
| `app/api/messages/attachments/route.ts` | `aaelink.documents` (+ `message_attachments`) | ✅ but wrong table for chat files |
| `app/api/search/files/route.ts` | `aaelink.file_index` | ✅ (:1305) but nothing populates it |
| `app/api/files/remote/route.ts` | `aaelink.files_remote` | ✅ (:2115; route also self-creates) |

Consequence: a file uploaded via `/api/files/upload` lands in `file_attachments`;
it can be downloaded and publicly linked, but it is **invisible** to `/api/files`
(queries `files`), to `/api/files/preview` (queries `file_uploads`), and to
`/api/messages/attachments` (queries `documents`). These routes return
`file_not_found` / empty for every real chat upload.

## Behavior Matrix

| # | Behavior | Slack | Mattermost | AAELink Route | Test | Level | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `files.upload` (legacy single-shot) | ✅ | `POST /files` | `app/api/files/upload/route.ts:17` | none | 🟡 | Works, but writes to local disk (`fs.writeFileSync`, :49), **not S3/MinIO**. Only persists a DB row when `message_id` provided (:54) — orphan otherwise. 50 MB cap (:11). |
| 2 | `getUploadURLExternal` (new flow, pre-signed) | ✅ | n/a | — | — | 🔴 | No pre-signed upload-URL endpoint. S3 lib (`lib/infra/s3.ts`) has `putObjectBytes`/`GetObjectCommand` but no presign. |
| 3 | `completeUploadExternal` (finalize + attach) | ✅ | n/a | — | — | 🔴 | No two-phase upload completion. `messages/attachments` is the closest binding step but reads `documents`, not the upload table. |
| 4 | Resumable / multipart / chunked upload | n/a | chunked via plugins | — | — | 🔴 | BLUEPRINT §2.1.3 mandates "resumable upload" up to 5 GB. Single 50 MB `formData()` read only (`files/upload:24,36`). No chunk/offset/session. |
| 5 | `files.list` (paginated, filtered) | ✅ | `GET /channels/{id}/files` | `app/api/files/route.ts:16` | none | 🟠 | Logic is correct (channel/user/type/date/search filters + paging) but queries phantom `aaelink.files` (:52). Returns nothing for real uploads. |
| 6 | `files.info` (single file) | ✅ | `GET /files/{id}/info` | `app/api/files/route.ts:26` | none | 🟠 | Same phantom-table issue (`aaelink.files`). |
| 7 | `files.delete` | ✅ | `DELETE /files` (limited) | `app/api/files/route.ts:134` | none | 🟠 | Owner/admin RBAC correct (:153). But deletes from phantom `aaelink.files` (:157); **no S3/disk object cleanup**; no audit log on this write (Hard Rule #5 violation). |
| 8 | Download / `url_private` serving | ✅ | `GET /files/{id}` | `app/api/files/[id]/download/route.ts:13` | (gate) | 🟡 | Reads `file_attachments` + local disk (:40). D12 scan gate enforced (:36). No range/streaming, no S3 path, no workspace/channel-membership check (any authed user can fetch any attachment id). |
| 9 | Thumbnails (server-generated) | ✅ | image proxy resizing | — | — | 🔴 | `preview` route returns a `thumbnail_key`/`thumbnail_url` *if a column existed*, but no generation pipeline (no `sharp`/ImageMagick). `media-policy` mentions thumbnail config only. |
| 10 | Image preview / lightbox | ✅ | ✅ | `components/chat/ImageLightbox.tsx`, `components/media/AvatarLightbox.tsx` | none | ✅ | Client lightbox components present and wired (`FilePreviewModal.tsx`). |
| 11 | PDF preview | ✅ (in-app) | proxy | `components/media/FilePreviewModal.tsx` + Stirling-PDF (`lib/documents/stirlingPdf.ts`) | none | 🟡 | PDF viewing exists via documents subsystem/Stirling, but `files/preview` only emits a `can_pdf_viewer` hint (:126); no rendered preview for chat-uploaded PDFs (wrong table). |
| 12 | Office (docx/xlsx/pptx) preview | ✅ | proxy | Stirling-PDF convert (`app/api/documents/[id]/convert/route.ts`) | none | 🟡 | Office→PDF conversion available in *documents* subsystem only; not reachable from chat file uploads. |
| 13 | Code / text preview w/ highlight | ✅ | ✅ | `app/api/files/preview/route.ts:39-41,125` | none | 🟠 | MIME→`code`/`text` mapping + `can_code_highlight` hint exist, but route queries phantom `file_uploads`; no syntax-highlight renderer confirmed. |
| 14 | Video preview / inline player | ✅ | ✅ | `preview:122` (`can_player`) + `app/api/messages/clips/route.ts` | none | 🟡 | Clips subsystem handles video/audio w/ thumbnail + transcription jobs. Generic video preview hint only via (broken) preview route. |
| 15 | Audio preview / player | ✅ | ✅ | `preview:122`; clips | none | 🟡 | Same as #14. |
| 16 | 3D (gltf) / CAD (DWG) preview | n/a | n/a | — | — | 🔴 | BLUEPRINT §2.1.3 lists 3D + CAD. No renderer or MIME mapping. |
| 17 | File metadata (dims, duration, EXIF) | ✅ | ✅ | `preview:106-108` reads `width/height/duration_ms` | none | 🟠 | Schema expects these columns on `file_uploads` (phantom); no extraction pipeline populates them. `media-policy` advertises EXIF stripping but no code strips it. |
| 18 | File comments — list | ✅ (`files.comments.list`, deprecated) | n/a | `app/api/files/comments/route.ts:16` | none | 🟡 | Works against self-created `file_comments` table (:95). Not joined to any canonical file row; no membership/ownership read check. |
| 19 | File comments — add/edit/delete | ✅ (deprecated) | n/a | `files/comments:60,71,81` | none | 🟡 | CRUD present, edit/delete scoped to author or admin (:75,:84). No audit log; table created ad-hoc outside migrate.ts (Hard Rule #3 grey area). |
| 20 | `files.sharedPublicURL` (make public) | ✅ | public link toggle | `app/api/files/[id]/public-link/route.ts:20` + `lib/files/publicLinks.ts:56` | `__tests__/api/file-public-links.test.ts` | ✅ | D12. Uploader-only, reuses active token, CSRF + audit log (:33). Solid. |
| 21 | `files.revokePublicURL` | ✅ | toggle off | `files/[id]/public-link/route.ts:40` + `revokePublicLinks` (:116) | `file-public-links.test.ts:123` | ✅ | Uploader-only revoke-all, audited. Solid. |
| 22 | Public link resolution (no session) | ✅ | public link | `app/api/files/public/[token]/route.ts:12` + `resolvePublicLink` (:93) | `file-public-links.test.ts:100` | 🟡 | Resolves metadata, respects org sharing toggle + scan gate. But **returns metadata only — does not serve the bytes**; no public download of the actual file. |
| 23 | Org-level public-sharing toggle | ✅ (admin) | `EnablePublicLink` | `app/api/admin/file-sharing-policy/route.ts` + `getFileSharingPolicy` | `file-public-links.test.ts:131` | ✅ | Admin policy gate, default enabled, persisted in `system_config`. Solid. |
| 24 | Virus / malware scan (real engine) | job after upload | n/a | `lib/files/clamav.ts` + `lib/files/fileScanJob.ts` | `tests/clamav.test.ts` | 🟡 | Real clamd INSTREAM client; clamd-down → `pending` (never silently clean). Daemon not bundled in compose. Scan is **not auto-enqueued on upload** — `files/upload` never inserts a `file_scans` row, so every upload is `unscanned`. |
| 25 | Scan access gate (block infected) | ✅ | n/a | `lib/files/scanGate.ts:102` (used by download :36 + public link :107) | `__tests__/api/file-scan-gate.test.ts` | ✅ | D12. Infected always blocked; strict mode blocks unscanned. Pure decision tested. Solid. |
| 26 | Scan policy admin / queue view | ✅ | n/a | `app/api/files/scan/route.ts:28,110` | none | 🟡 | Admin GET summary + policy CRUD + manual enqueue work. Two policy shapes coexist (`scan/route.ts` rich policy vs `scanGate.ts` `{block_infected,block_unscanned}`) — divergent. |
| 27 | Retention / auto-delete of files | n/a (Enterprise GDR) | data retention | scan policy `auto_delete_infected_after_days` (`scan/route.ts:85`) | none | 🟠 | Field stored but no job enforces it. No general file retention tied to channel/compliance retention. |
| 28 | File content search (search-inside) | ✅ (`search.files`) | index pipeline | `app/api/search/files/route.ts` | none | 🟠 | pg_tsvector query is correct against `file_index`, but **no indexer populates `file_index`** for chat uploads (upload path never inserts/extracts). Effectively empty index. |
| 29 | External file refs (`files.remote.*`) | ✅ | n/a | `app/api/files/remote/route.ts:20,69` | none | 🟡 | add/update/remove/share implemented against `files_remote`. Route self-creates table w/o `workspace_id` (:158) while migrate.ts version (:2115) has `workspace_id` — schema drift; no workspace scoping/audit. |
| 30 | External storage (S3 / MinIO) | proprietary | ✅ S3 backend | `lib/infra/s3.ts` | none | 🟠 | S3/MinIO client exists and is used by **documents + compliance export only**. Chat file upload/download bypass it entirely (local disk). `file_attachments.storage_key` is a local filename, not an S3 key. |

## Critical Gaps (severity-ordered)

1. **Storage-table fragmentation (data-model defect).** Four tables
   (`file_attachments`, `files`, `file_uploads`, `documents`) for one concept; two
   of them (`files`, `file_uploads`) don't exist in `lib/infra/migrate.ts`, so
   `/api/files` (list/info/delete) and `/api/files/preview` return
   `file_not_found`/empty for every real chat upload. This breaks behaviors
   #5, #6, #7, #11, #13, #17 wholesale. Pick one canonical table
   (`file_attachments`) and repoint all routes, or add a unifying view.

2. **No S3/MinIO on the chat path (BLUEPRINT + parity drift).** `files/upload`
   does `fs.writeFileSync` to `.uploads/` (`upload:49`); download reads the same
   local dir (`download:40`). `storage_key` holds a local filename. The full-map
   claims "S3 SDK + MinIO" — true only for `documents/*`. Wire chat uploads
   through `lib/infra/s3.ts` (`putObjectBytes`/`getObjectBytes`).

3. **No resumable/multipart upload + no new Slack upload flow.** BLUEPRINT
   §2.1.3 requires resumable upload to 5 GB; current cap is a single 50 MB
   `formData()` read (`upload:24,36`). No `getUploadURLExternal`/
   `completeUploadExternal` (#2, #3, #4). Large-file and reliable-upload parity
   is absent.

4. **Scan not auto-enqueued on upload + search index never populated.**
   `files/upload` inserts neither a `file_scans` row nor a `file_index` row, so
   every upload is `unscanned` (gate only bites under strict mode) and
   search-inside-files (#28) is permanently empty despite a correct query layer.

5. **`files.delete` leaks storage + skips audit.** Deletes the (phantom) DB row
   only — no S3/disk object removal, and no `writeAuditLog` on a destructive,
   cross-user write (violates Hard Rule #5).

## Recommended Next Steps
1. Consolidate on `aaelink.file_attachments` as the canonical file row; repoint
   `/api/files`, `/api/files/preview`, `/api/messages/attachments` to it (or add a
   `file_uploads`/`files` view in migrate.ts). Add tests in `__tests__/api/` for
   each repointed route.
2. Route chat upload/download bytes through `lib/infra/s3.ts`; store the S3 key in
   `storage_key`; add object deletion to `files.delete` + audit log.
3. Implement two-phase upload: presign endpoint (`getUploadURLExternal` analog) +
   completion/attach endpoint, with chunked/resumable session support; raise the
   size policy toward the 5 GB BLUEPRINT target.
4. Auto-enqueue a `file_scan` job and a `file_index` extraction job on every
   successful upload (the job machinery + `fileScanJob.ts` already exist).
5. Add a thumbnail/metadata extraction worker (dims, duration, EXIF strip per
   `media-policy`) and persist onto the canonical row.
6. Make public-link resolution actually serve bytes (#22), and add a file
   retention job (#27) tied to compliance retention.
7. Reconcile the two scan-policy shapes (`scan/route.ts` vs `scanGate.ts`).

## Out of Scope
- AI/ML auto-tagging, smart summaries of files (per standing directive: AI/ML out of scope).
- 3D (gltf) / CAD (DWG) interactive viewers — BLUEPRINT aspirational; defer.
- Elasticsearch/OpenSearch index tier (planned v0.3.0-beta per full-map).
- Slack Canvas / Lists file-object specifics (covered by separate audits).

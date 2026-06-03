# Parity Audit — Integrations & Extensibility
Date: 2026-06-03
Auditor: Claude

Scope: incoming/outgoing webhooks, slash commands, bots & bot tokens, OAuth & scopes,
Events API / event subscriptions, interactive components (Block Kit, dialogs/views/modals,
block actions, message shortcuts), socket mode, app manifest, Workflow Builder, custom
functions, app/plugin marketplace.

Method: code over README. Read route handlers under `app/api/**`, supporting libs under
`lib/webhooks/**`, `lib/apps/**`, `lib/comms/slashCommands.ts`, the worker
(`lib/infra/worker.ts`), the schema (`lib/infra/migrate.ts`), and tests under `__tests__/`
+ `tests/`. The decisive question for each surface was not "does an endpoint exist" but
"does the behavior actually run end-to-end".

## Summary
- Coverage: 26 / 30 behaviors have *some* code; only 9 are genuinely end-to-end.
- Full (✅): 9 | Partial (🟡): 8 | Stub (🟠): 7 | Missing (🔴): 6

The single most important finding: AAELink has a complete-looking outgoing-webhook / Events
API stack (`webhooks_v2`, `event_subscriptions`, HMAC signing, retry, DLQ, a worker
`webhook_deliver` handler) **that is never triggered by real platform events**.
`emitWebhookEvent` (`lib/webhooks/webhookEmitter.ts`) and `dispatchWebhookEvent`
(`lib/webhooks/webhookEngine.ts`) have **zero production callers** — verified by grep across
`app/` and `lib/`. Posting a message, creating a channel, adding a reaction, etc. fire
nothing. The delivery machinery only runs if something manually POSTs `action:'deliver'` to
`/api/webhooks/v2`. So outgoing webhooks and the Events API are non-functional in practice
despite extensive plumbing and tests.

Second: the entire interactivity *ingress* path is absent. There is no endpoint that
receives `block_actions`, `view_submission`, `view_closed`, or message-shortcut payloads
from a button click / modal submit (Slack's single Interactivity Request URL). `/api/views`
and `/api/dialog` only *echo back* the view JSON they were handed — no persistence, no push
to a client, no callback on submit. Grep for `block_actions` / `view_submission` /
`message_action` across `app/api` returns nothing.

## Behavior Matrix

| # | Behavior | Slack | Mattermost | AAELink Route | Test | Level | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Incoming webhook — create/manage | Yes | Yes | `app/api/webhooks/route.ts` (v1), `app/api/integrations/webhooks/route.ts` | none (lib only) | 🟡 | Two parallel/overlapping systems: `aaelink.webhooks` (v1) and `aaelink.incoming_webhooks`. v1 has RBAC + audit; `integrations/webhooks` POST/GET have **no RBAC check** (any logged-in user can create on any workspace) and **no audit log** — Hard Rule #1/#5 violation. |
| 2 | Incoming webhook — public receiver (post to channel) | Yes | Yes | `app/api/webhooks/[token]/route.ts` | none | 🟡 | Works: token→channel message insert. But emits realtime by inserting a `notifications` row directly, **not** via `lib/realtime`/`redisPubSub` (Hard Rule #6) — connected clients may not see it. Reads `aaelink.incoming_webhooks` only; v1 `webhooks` table has no public receiver. No payload signature/verification on inbound. |
| 3 | Incoming webhook — Slack-compatible payload (text/attachments/username/icon) | Yes | Yes | `app/api/webhooks/[token]/route.ts:30-63` | none | 🟡 | Accepts `text`, `username`, `icon_url`; `attachments`/blocks ignored. Bot identity carried in message `metadata`, not a real bot user. |
| 4 | Outgoing webhook — subscription CRUD | Yes (legacy) | Yes | `app/api/webhooks/v2/route.ts` (create/list/update) | `tests/webhookEngine.test.ts`, `webhookSigning`, `webhookDlq`, `webhookEmitter` | 🟡 | Full CRUD + secret-once-on-create + event filter. RBAC is creator-or-platform-admin (not workspace-scoped). Solid as a registry. |
| 5 | Outgoing webhook — fire on real events | Yes | Yes | `lib/webhooks/webhookEmitter.ts`, `lib/webhooks/webhookEngine.ts` | emitter/engine unit-tested | 🟠 | **Stub in practice.** `emitWebhookEvent`/`dispatchWebhookEvent` + `emitMessageCreated` etc. have **no callers** anywhere in `app/` or `lib/`. Real platform events never queue a delivery. |
| 6 | Outgoing webhook — HMAC-SHA256 signing | Yes | Yes | `app/api/webhooks/v2/route.ts:52`, `webhookEmitter.ts:36`, worker | `tests/webhookSigning.test.ts` | ✅ | `X-AAELink-Signature-256: sha256=…` correctly implemented; verify helper + `verify-signature` route exist. |
| 7 | Outgoing webhook — retry w/ backoff + timeout | Yes | Yes | worker `webhook_deliver`/`webhook_retry` (`lib/infra/worker.ts:92,195`), `webhookEngine.ts` | `tests/webhookEngine.test.ts` | 🟡 | Worker delivers + throws to retry; 10s timeout. But because #5 never queues jobs from real events, retry only exercises manual deliveries. |
| 8 | Outgoing webhook — dead letter queue | Partial | No | `app/api/admin/webhook-dlq/route.ts`, `lib/webhooks/webhookDlq.ts` | `tests/webhookDlq.test.ts` | ✅ | DLQ admin route + lib + tests present and coherent. |
| 9 | Outgoing webhook — delivery log / debug | Yes | Yes | `app/api/webhooks/v2/route.ts?view=deliveries`, `app/api/webhooks/deliveries/route.ts` | none (route) | ✅ | Request/response bodies, latency, status captured in `webhook_deliveries_v2`. |
| 10 | Outgoing webhook — test/ping | Yes | Yes | `app/api/webhooks/v2` (`action:'test'`), `app/api/webhooks/test/route.ts` | none | ✅ | Sends a signed test event to the URL. |
| 11 | Slash command — registry (custom commands) | Yes | Yes | `app/api/slash-commands/route.ts` (`action:'register'`) | `tests/slashCommands.test.ts`, `tests/composerSlash.test.ts` | 🟡 | Admin-only register into `aaelink.slash_commands` with `callback_url`. Solid registry; conflict detection vs built-ins. |
| 12 | Slash command — built-in commands | Yes | Yes | `app/api/slash-commands/route.ts:180-244`, `lib/comms/slashCommands.ts` | `tests/slashCommands.test.ts` (208 lines) | ✅ | `/shrug /dnd /status /who /topic` execute server-side; client composer engine for `/me /mute /giphy` etc. Well tested. |
| 13 | Slash command — dispatch to external callback_url | Yes | Yes | `app/api/slash-commands/route.ts:253-258` | none | 🟠 | **Stub.** On a registered custom command it returns text "Custom command triggered (callback: …)" — comment line 254: "actual webhook dispatch in future". Never POSTs to the callback, no `response_url`, no signed request. |
| 14 | Slash command — response_url / delayed responses | Yes | Yes | — | — | 🔴 | No `response_url` concept; responses are synchronous JSON only. |
| 15 | Bot users — manage / tokens | Yes | Yes | `app/api/integrations/bots/route.ts` | none (route) | 🟡 | Platform-admin CRUD of `bot_users` with `api_token`, `client_id/secret`, scopes, redirect URIs; audited. Tokens are minted but **no bot-token auth middleware** authenticates inbound API calls as a bot (only socket-open accepts the token). |
| 16 | Bots — bots.info parity | Yes | n/a | `app/api/bots/info/route.ts` | none | 🟡 | Slack-shaped `bots.info`/list, but reads `aaelink.users WHERE platform_role='bot'` — a *different* notion of bot than `bot_users` created in #15. The two bot models are disconnected. |
| 17 | OAuth — app registration | Yes | Yes | via `app/api/integrations/bots` (`kind:'oauth_app'`), `app/api/apps/manifest` | `__tests__/api/app-manifest.test.ts` | 🟡 | OAuth apps stored as `bot_users` rows / `apps` via manifest. No dedicated app console. |
| 18 | OAuth — authorization code → token exchange | Yes | Yes | `app/api/oauth/access/route.ts` (`action:'exchange'`) | none | 🟠 | **Stub/insecure.** No authorize endpoint, no real `code` issuance/validation, no redirect-URI check, no PKCE. Accepts any `code` and "if no match, create a token anyway for dev" (line 83); creates `oauth_tokens` table ad-hoc inside the handler (Hard Rule #3 violation). |
| 19 | OAuth — token introspection / info | Yes | Yes | `app/api/oauth/access` GET, `app/api/oauth/introspect/route.ts` | `__tests__/api/oauth-scopes.test.ts` | 🟡 | Introspection reads `oauth_tokens`. Scope catalog in `lib/api/oauthScopes.ts` is tested, but scopes are not actually enforced on any API call. |
| 20 | OAuth — token revoke / rotate | Yes | Yes | `app/api/oauth/access` (`action:'revoke'`), `app/api/oauth/rotate/route.ts` | none | 🟡 | Revoke deletes the row; rotate route exists. Not wired to a real grant lifecycle. |
| 21 | OAuth scopes — defined catalog + enforcement | Yes | Yes | `lib/api/oauthScopes.ts` | `__tests__/api/oauth-scopes.test.ts` | 🟠 | Catalog + validation tested, but **no route enforces a scope** — no middleware checks bot/OAuth-token scope before an action. Definition only. |
| 22 | Events API — subscription management | Yes | n/a | `app/api/integrations/events/route.ts` | none | 🟡 | Platform-admin CRUD of `event_subscriptions` with HTTPS endpoint + signing secret + event filter. Registry is real. |
| 23 | Events API — actually deliver events on activity | Yes | n/a | (would be `emitWebhookEvent`) | `__tests__/api/event-dedup.test.ts` (dedup lib only) | 🟠 | **Stub.** Same root cause as #5 — nothing emits. `event_subscriptions` rows never receive deliveries. URL-verification challenge handshake also absent. |
| 24 | Socket mode — open connection (ticket + WSS URL) | Yes | n/a | `app/api/apps/connections/open/route.ts`, `lib/apps/socketMode.ts` | none | 🟡 | Bot-token → short-lived ticket + WSS URL, stored in `socket_connections`. Clean implementation of the open step. |
| 25 | Socket mode — gateway validates ticket + streams events | Yes | n/a | `resolveSocketTicket`/`closeSocketConnection` in `lib/apps/socketMode.ts` | none | 🟠 | **Stub.** These functions have **no callers** — the WS gateway (`lib/wsTransport.ts`/realtime) never validates a ticket or streams app events. Ticket is issued into a void. |
| 26 | App manifest — create app/bot from manifest | Yes | n/a | `app/api/apps/manifest/route.ts`, `lib/apps/appManifest.ts` | `__tests__/api/app-manifest.test.ts` | ✅ | CSRF + owner/admin + audit; validates manifest, atomically creates `apps` + optional `bot_users` with credentials. Genuinely end-to-end for provisioning. |
| 27 | Interactive components — Block Kit validation | Yes | (interactive msgs) | `app/api/blockkit/validate/route.ts`, `lib/blockkit/validate.ts` | `__tests__/api/blockkit-validate.test.ts` | ✅ | Validates block arrays; dev tool, no side effects. Works as specified. |
| 28 | Interactive components — views/modals (open/push/update/publish) | Yes | (dialogs) | `app/api/views/route.ts`, `app/api/dialog/route.ts` | none | 🟠 | **Echo-only stub.** Returns a fabricated view object; no persistence, no `trigger_id` validation, no push to a client. Comment line 55: "in production this would be pushed via SSE/WebSocket". |
| 29 | Interactive components — block_actions / view_submission ingress + message shortcuts | Yes | Yes (interactive dialogs) | — | — | 🔴 | **Missing.** No interactivity request endpoint; button clicks / modal submits / shortcuts have nowhere to POST. No `trigger_id` issuance from a real interaction. |
| 30 | Workflow Builder — define multi-step workflows (triggers/steps/functions) | Yes | (no native builder; plugins) | `app/api/workflows/route.ts` (+ `app/api/functions/route.ts`) | none | 🟠 | CRUD-only stub. Tables created **inside the handler** via `ensureWorkflowTables`/`ensureFunctionsTables` (Hard Rule #3 — schema not in `migrate.ts`). `execute` just inserts a `workflow_executions` row with status `running`; **no engine runs steps/triggers** — `step_completed`/`step_failed` must be reported by an external caller that does not exist. |
| 31 | Workflow — approval flows | n/a (Slack) | n/a | `app/api/approvals/workflows/route.ts`, `app/api/approvals/requests/route.ts` | `tests/approvalRequests.test.ts` | ✅ | Real approval workflows: `workflows`/`workflow_steps`/`approval_requests`/`approval_reviews` in `migrate.ts`; review transitions tested. This is the one workflow surface that works. |
| 32 | App/plugin marketplace — publish + install | Apps directory | App marketplace + plugins | `app/api/marketplace/plugins/route.ts`, `marketplace/install`, `marketplace/installed`, `integrations/plugins` | none | 🟡 | Publish/list/install/uninstall against `marketplace_plugins`/`installed_plugins`/`plugins` — registry CRUD works, install bumps download count. |
| 33 | Plugin runtime — sandboxed execution / extension points | No | Yes (Go plugins, server) | `app/api/integrations/plugins/route.ts` | none | 🟠 | **Stub.** Route docstring claims "sandboxed execution / message interceptors / UI extension points", but plugins are never loaded or executed — only stored with a `capabilities` JSON array and a status field. No runtime. |
| 34 | Email-to-channel ingestion | n/a | n/a (Slack: email integration) | `app/api/integrations/email-ingestion/route.ts` | none | 🟡 | Email-route registry present (`email_routes`); not verified end-to-end here. |

## Critical Gaps (severity-ordered)

1. **Outgoing webhooks & Events API never fire (functional dead-end).** Behaviors #5, #23.
   The whole stack — `webhooks_v2`, `event_subscriptions`, signing, retry, DLQ, worker
   `webhook_deliver`, and the convenience emitters (`emitMessageCreated`, `emitChannelCreated`,
   …) — is wired but `emitWebhookEvent`/`dispatchWebhookEvent` have **zero callers** in `app/`
   or `lib/`. Any integration subscribing to events receives nothing. This is the headline
   parity gap: it looks shipped (and is even tested at the unit level) but does nothing in a
   running system. Fix = call the emitter from the message/channel/reaction/file/user/DLP
   write paths.

2. **No interactivity ingress; views/dialogs are echo-only.** Behaviors #28, #29.
   There is no endpoint to receive `block_actions` / `view_submission` / `view_closed` /
   message-shortcut payloads, and `/api/views` + `/api/dialog` merely reflect their input back
   with a fabricated id. Interactive buttons, modals, and Home tabs therefore cannot round-trip.
   This blocks essentially all real Slack-style app UX.

3. **OAuth is not a real authorization flow.** Behaviors #18, #21.
   `/api/oauth/access` has no authorize endpoint, issues a token for any `code` ("create a
   token anyway for dev"), validates no redirect URI, has no PKCE, and creates its
   `oauth_tokens` table ad-hoc inside the handler (Hard Rule #3). Scopes are catalogued and
   tested but enforced nowhere. Not safe to expose to third parties.

4. **Workflow Builder and plugin runtime are registries, not engines.** Behaviors #30, #33.
   Workflows store steps/triggers and an execution row but no engine evaluates triggers or runs
   steps; `functions`/`workflows` tables are created inside handlers rather than `migrate.ts`
   (Hard Rule #3). Plugins are stored but never loaded or sandboxed despite the docstring.

5. **Hard-rule violations on integration write paths.** `app/api/integrations/webhooks`
   (create) has no RBAC and no audit log (#1/#5); `app/api/webhooks/[token]` emits via a raw
   `notifications` insert instead of `lib/realtime` (#6); `oauth/access`, `workflows`,
   `functions` define schema outside `migrate.ts` (#3).

6. **Fragmented data models for the same concept.** Two incoming-webhook tables (`webhooks`
   vs `incoming_webhooks`), two bot notions (`bot_users` vs `users.platform_role='bot'`), and
   v1 vs v2 webhook systems coexist without a bridge — callers must know which subsystem a
   given endpoint targets.

7. **Socket mode opens but never connects.** Behavior #25. Tickets are minted but
   `resolveSocketTicket` is never called by the WS gateway, so app event streaming over socket
   mode does not work.

## Recommended Next Steps
1. Wire `emitWebhookEvent` into the real write paths (messages, channels, reactions, files,
   users, DLP) — this single change activates both outgoing webhooks (#5) and Events API (#23)
   and lights up the existing tests against real traffic. Add the Events API URL-verification
   challenge handshake.
2. Add a single interactivity ingress route (e.g. `POST /api/interactions`) that accepts
   `block_actions` / `view_submission` / shortcut payloads, plus real `trigger_id` issuance,
   and make `/api/views` persist + push views over `lib/realtime`.
3. Move `workflows`/`functions`/`oauth_tokens` DDL into `lib/infra/migrate.ts`; add RBAC +
   audit to `integrations/webhooks`; route `[token]` webhook delivery through `lib/realtime`.
4. Implement a real OAuth authorize endpoint with redirect-URI + PKCE validation and enforce
   scopes via bot/OAuth-token middleware before privileged actions.
5. Consolidate the duplicated webhook and bot data models; document v1→v2 deprecation.
6. Connect `resolveSocketTicket` to the WS gateway so socket-mode apps actually receive events.
7. Update `docs/parity-reference-matrix.md`: Webhooks/OAuth/Slash commands are currently marked
   **Shipped** but should be **Partial** given outgoing events never fire, OAuth has no real
   flow, and custom slash dispatch is a stub.

## Out of Scope
- AI/ML-driven automation (Workflow AI steps, Slack AI apps) — excluded per the standing parity
  directive.
- Native mobile/desktop surfacing of interactive components.
- Third-party first-party connectors (Google Drive, Jira, etc.) — covered under a separate
  integrations-catalog effort, not platform extensibility.
- Mattermost Go-plugin binary hosting model (architecturally divergent from AAELink's JS stack).

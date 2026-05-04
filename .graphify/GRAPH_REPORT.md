# Graph Report - .  (2026-05-04)

## Corpus Check
- 150 files · ~84,877 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 435 nodes · 655 edges · 22 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 150 · Candidates: 180
- Excluded: 69 untracked · 37002 ignored · 2 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.
## God Nodes (most connected - your core abstractions)
1. `openDB()` - 7 edges
2. `PATCH()` - 5 edges
3. `messageFromFailedResponse()` - 4 edges
4. `parseMessageRichText()` - 4 edges
5. `snippet()` - 4 edges
6. `insertNotifications()` - 4 edges
7. `notifyChannelMentions()` - 4 edges
8. `notifyTicketReply()` - 4 edges
9. `openOutboxDB()` - 4 edges
10. `RateLimiter` - 4 edges

## Surprising Connections (you probably didn't know these)
- `POST()` --calls--> `GET()`  [EXTRACTED]
  app/api/collab/users/route.ts → app/api/admin/users/route.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (17): DELETE(), GET(), isPriority(), isStatus(), PATCH(), ensureGlobalWorkspaceAndDepartments(), ensureSchema(), run() (+9 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (13): channelLabelForNotify(), onIncoming(), collabDisplayName(), expandComposerSlash(), notifyDesktopChatMessage(), shouldNotifyWhenUnfocused(), stripMarkdownOneLine(), nextSpecialIndex() (+5 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (6): apply(), focusables(), markRead(), onInv(), onKeyDown(), onPick()

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (8): isItAdmin(), isPlatformAdmin(), isSuperAdmin(), GET(), PATCH(), POST(), DELETE(), GET()

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (3): applyUiDensity(), persistUiDensity(), readUiDensity()

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (10): insertNotifications(), notifyChannelMentions(), notifySupportEmergencyStaff(), notifyTicketReply(), resolveMentionTargets(), snippet(), authorLabel(), deletionsSince() (+2 more)

### Community 6 - "Community 6"
Cohesion: 0.15
Nodes (8): createTicket(), focusables(), messageFromFailedResponse(), onKeyDown(), onPageShow(), onVisible(), sendReply(), updateTicket()

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (2): focusables(), onKeyDown()

### Community 8 - "Community 8"
Cohesion: 0.19
Nodes (10): GET(), initialThreadReplyWatermark(), initialWatermark(), userCanPostToChannel(), userCanReadChannel(), PATCH(), unreadCountForUser(), assertThreadRoot() (+2 more)

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (10): computeStartUrl(), createWindow(), defaultUnpackagedDevUrl(), detectPreferredIPv4(), dispatchDeepLink(), focusMainWindow(), isPrivateOrLocalHost(), resolveStartUrl() (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.2
Nodes (7): contactOtpDeliveryStatus(), resendConfigured(), sendContactOtpSms(), twilioConfigured(), maskEmail(), normalizeE164(), POST()

### Community 11 - "Community 11"
Cohesion: 0.24
Nodes (7): assertWorkspaceMember(), GET(), peerDisplayName(), POST(), applyEnvFile(), loadDotenv(), main()

### Community 12 - "Community 12"
Cohesion: 0.24
Nodes (5): GET(), POST(), safeFilename(), ensureBucket(), putObjectBytes()

### Community 13 - "Community 13"
Cohesion: 0.22
Nodes (2): focusables(), onKeyDown()

### Community 14 - "Community 14"
Cohesion: 0.31
Nodes (5): canViewTicket(), getMemberDepartmentId(), userIsItForWorkspace(), isPriority(), POST()

### Community 15 - "Community 15"
Cohesion: 0.36
Nodes (5): dequeueMessage(), enqueueMessage(), flushOutbox(), openOutboxDB(), readQueue()

### Community 16 - "Community 16"
Cohesion: 0.46
Nodes (7): cachePosts(), getChannelMeta(), openDB(), pruneChannel(), readCachedPosts(), removeCachedPosts(), setChannelMeta()

### Community 17 - "Community 17"
Cohesion: 0.33
Nodes (2): focusables(), onKeyDown()

### Community 18 - "Community 18"
Cohesion: 0.33
Nodes (1): RateLimiter

### Community 19 - "Community 19"
Cohesion: 0.5
Nodes (2): focusables(), onKey()

### Community 22 - "Community 22"
Cohesion: 0.83
Nodes (3): applyComposerFormat(), applyComposerLink(), replaceRange()

### Community 23 - "Community 23"
Cohesion: 1
Nodes (2): openRegistration(), POST()

## Knowledge Gaps
- **Thin community `Community 7`** (2 nodes): `focusables()`, `onKeyDown()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (2 nodes): `focusables()`, `onKeyDown()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `focusables()`, `onKeyDown()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (1 nodes): `RateLimiter`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `focusables()`, `onKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `openRegistration()`, `POST()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 7` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
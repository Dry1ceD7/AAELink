#!/bin/bash
set -euo pipefail

cd /Users/d7y1ce/AAE/AAELink

echo "=== Phase 1: Create target directories ==="
mkdir -p lib/auth lib/api lib/messaging lib/realtime lib/notifications lib/channels lib/workspace lib/enterprise lib/webhooks lib/documents lib/infra lib/ui lib/comms
echo "Created 13 domain directories"

echo ""
echo "=== Phase 2: Move files ==="

# auth/
mv lib/adminAuth.ts lib/auth/
mv lib/password.ts lib/auth/
mv lib/session.ts lib/auth/
mv lib/sessionSecurity.ts lib/auth/
mv lib/csrf.ts lib/auth/
mv lib/csrfClient.ts lib/auth/
mv lib/csp.ts lib/auth/
mv lib/ipAccess.ts lib/auth/
mv lib/supportSession.ts lib/auth/
mv lib/supportOtpRateLimit.ts lib/auth/
mv lib/sendContactOtp.ts lib/auth/
echo "  auth: 11 files"

# api/
mv lib/apiClient.ts lib/api/
mv lib/apiKeys.ts lib/api/
mv lib/tracedRoute.ts lib/api/
mv lib/rateLimiter.ts lib/api/
mv lib/rateLimitStore.ts lib/api/
mv lib/rateLimitMetrics.ts lib/api/
echo "  api: 6 files"

# messaging/
mv lib/chat-post.ts lib/messaging/
mv lib/messageCache.ts lib/messaging/
mv lib/messageDrafts.ts lib/messaging/
mv lib/messageRich.tsx lib/messaging/
mv lib/composerMarkdown.ts lib/messaging/
mv lib/composerSlash.ts lib/messaging/
mv lib/mentionCursor.ts lib/messaging/
mv lib/mentionParse.ts lib/messaging/
mv lib/reactions.ts lib/messaging/
mv lib/findReplace.ts lib/messaging/
mv lib/searchFilters.ts lib/messaging/
echo "  messaging: 11 files"

# realtime/
mv lib/realtime.ts lib/realtime/
mv lib/realtimeEventBus.ts lib/realtime/
mv lib/wsClient.ts lib/realtime/
mv lib/wsTransport.ts lib/realtime/
mv lib/sseResilience.ts lib/realtime/
mv lib/redisPubSub.ts lib/realtime/
mv lib/redisClientFactory.ts lib/realtime/
mv lib/wsGateway lib/realtime/wsGateway
echo "  realtime: 7 files + wsGateway/"

# notifications/
mv lib/notificationClient.ts lib/notifications/
mv lib/notificationHref.ts lib/notifications/
mv lib/notificationInvalidate.ts lib/notifications/
mv lib/notificationPrefs.ts lib/notifications/
mv lib/notificationSchedule.ts lib/notifications/
mv lib/notificationSound.ts lib/notifications/
mv lib/notificationStream.ts lib/notifications/
mv lib/notificationTypes.ts lib/notifications/
mv lib/notificationsServer.ts lib/notifications/
mv lib/desktopNotify.ts lib/notifications/
mv lib/nativeNotify.ts lib/notifications/
echo "  notifications: 11 files"

# channels/
mv lib/channelArchival.ts lib/channels/
mv lib/channelMute.ts lib/channels/
mv lib/channelStars.ts lib/channels/
mv lib/defaultChannel.ts lib/channels/
mv lib/recentChannels.ts lib/channels/
mv lib/sidebarOrder.ts lib/channels/
mv lib/sidebarSections.ts lib/channels/
echo "  channels: 7 files"

# workspace/
mv lib/workspaceAccess.ts lib/workspace/
mv lib/workspaceNav.ts lib/workspace/
echo "  workspace: 2 files"

# enterprise/
mv lib/auditLog.ts lib/enterprise/
mv lib/auditStream.ts lib/enterprise/
mv lib/bulkProvision.ts lib/enterprise/
mv lib/retention.ts lib/enterprise/
mv lib/featureFlags.ts lib/enterprise/
mv lib/collab-access.ts lib/enterprise/
mv lib/ticketAccess.ts lib/enterprise/
mv lib/ticketRouter.ts lib/enterprise/
mv lib/ticketStateMachine.ts lib/enterprise/
mv lib/slaEngine.ts lib/enterprise/
echo "  enterprise: 10 files"

# webhooks/
mv lib/webhookDlq.ts lib/webhooks/
mv lib/webhookEmitter.ts lib/webhooks/
mv lib/webhookEngine.ts lib/webhooks/
mv lib/webhookSigning.ts lib/webhooks/
echo "  webhooks: 4 files"

# documents/
mv lib/stirlingPdf.ts lib/documents/
mv lib/puzzleBox lib/documents/puzzleBox
echo "  documents: 1 file + puzzleBox/"

# infra/
mv lib/db.ts lib/infra/
mv lib/migrate.ts lib/infra/
mv lib/migrationRunner.ts lib/infra/
mv lib/s3.ts lib/infra/
mv lib/outboxQueue.ts lib/infra/
mv lib/scheduledMessageProcessor.ts lib/infra/
mv lib/worker.ts lib/infra/
mv lib/metrics.ts lib/infra/
mv lib/otelExport.ts lib/infra/
mv lib/tracing.ts lib/infra/
mv lib/log.ts lib/infra/
mv lib/logger.ts lib/infra/
echo "  infra: 12 files"

# ui/
mv lib/theme.ts lib/ui/
mv lib/themePalette.ts lib/ui/
mv lib/uiDensity.ts lib/ui/
mv lib/slug.ts lib/ui/
mv lib/accountRequestId.ts lib/ui/
mv lib/userPreferences.ts lib/ui/
mv lib/useAutoAway.ts lib/ui/
mv lib/useMediaQuery.ts lib/ui/
mv lib/useMenuNav.ts lib/ui/
mv lib/useStatusExpiry.ts lib/ui/
mv lib/useWorkspaceSlashCommands.ts lib/ui/
echo "  ui: 11 files"

# comms/
mv lib/emailTemplates.ts lib/comms/
mv lib/slashCommands.ts lib/comms/
mv lib/dndSchedule.ts lib/comms/
mv lib/platformRole.ts lib/comms/
echo "  comms: 4 files"

# MIGRATIONS.md
mv lib/MIGRATIONS.md lib/infra/
echo "  moved MIGRATIONS.md to infra/"

echo ""
echo "=== Phase 2 complete: 97 files + 2 subdirs moved ==="

echo ""
echo "=== Phase 3: Remap absolute imports (@/lib/...) ==="

# Build the list of all TS/TSX files to process
SEARCH_DIRS="app lib tests __tests__ e2e"
EXTRA_FILES="middleware.ts instrumentation.ts"

# auth domain
echo "  Remapping auth imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/adminAuth'|from '@/lib/auth/adminAuth'|g" \
    -e "s|from '@/lib/password'|from '@/lib/auth/password'|g" \
    -e "s|from '@/lib/session'|from '@/lib/auth/session'|g" \
    -e "s|from '@/lib/sessionSecurity'|from '@/lib/auth/sessionSecurity'|g" \
    -e "s|from '@/lib/csrf'|from '@/lib/auth/csrf'|g" \
    -e "s|from '@/lib/csrfClient'|from '@/lib/auth/csrfClient'|g" \
    -e "s|from '@/lib/csp'|from '@/lib/auth/csp'|g" \
    -e "s|from '@/lib/ipAccess'|from '@/lib/auth/ipAccess'|g" \
    -e "s|from '@/lib/supportSession'|from '@/lib/auth/supportSession'|g" \
    -e "s|from '@/lib/supportOtpRateLimit'|from '@/lib/auth/supportOtpRateLimit'|g" \
    -e "s|from '@/lib/sendContactOtp'|from '@/lib/auth/sendContactOtp'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/adminAuth'|from '@/lib/auth/adminAuth'|g" \
    -e "s|from '@/lib/password'|from '@/lib/auth/password'|g" \
    -e "s|from '@/lib/session'|from '@/lib/auth/session'|g" \
    -e "s|from '@/lib/sessionSecurity'|from '@/lib/auth/sessionSecurity'|g" \
    -e "s|from '@/lib/csrf'|from '@/lib/auth/csrf'|g" \
    -e "s|from '@/lib/csrfClient'|from '@/lib/auth/csrfClient'|g" \
    -e "s|from '@/lib/csp'|from '@/lib/auth/csp'|g" \
    -e "s|from '@/lib/ipAccess'|from '@/lib/auth/ipAccess'|g" \
    -e "s|from '@/lib/supportSession'|from '@/lib/auth/supportSession'|g" \
    -e "s|from '@/lib/supportOtpRateLimit'|from '@/lib/auth/supportOtpRateLimit'|g" \
    -e "s|from '@/lib/sendContactOtp'|from '@/lib/auth/sendContactOtp'|g" \
    "$f"; done

# api domain
echo "  Remapping api imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/apiClient'|from '@/lib/api/apiClient'|g" \
    -e "s|from '@/lib/apiKeys'|from '@/lib/api/apiKeys'|g" \
    -e "s|from '@/lib/tracedRoute'|from '@/lib/api/tracedRoute'|g" \
    -e "s|from '@/lib/rateLimiter'|from '@/lib/api/rateLimiter'|g" \
    -e "s|from '@/lib/rateLimitStore'|from '@/lib/api/rateLimitStore'|g" \
    -e "s|from '@/lib/rateLimitMetrics'|from '@/lib/api/rateLimitMetrics'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/apiClient'|from '@/lib/api/apiClient'|g" \
    -e "s|from '@/lib/apiKeys'|from '@/lib/api/apiKeys'|g" \
    -e "s|from '@/lib/tracedRoute'|from '@/lib/api/tracedRoute'|g" \
    -e "s|from '@/lib/rateLimiter'|from '@/lib/api/rateLimiter'|g" \
    -e "s|from '@/lib/rateLimitStore'|from '@/lib/api/rateLimitStore'|g" \
    -e "s|from '@/lib/rateLimitMetrics'|from '@/lib/api/rateLimitMetrics'|g" \
    "$f"; done

# messaging domain
echo "  Remapping messaging imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/chat-post'|from '@/lib/messaging/chat-post'|g" \
    -e "s|from '@/lib/messageCache'|from '@/lib/messaging/messageCache'|g" \
    -e "s|from '@/lib/messageDrafts'|from '@/lib/messaging/messageDrafts'|g" \
    -e "s|from '@/lib/messageRich'|from '@/lib/messaging/messageRich'|g" \
    -e "s|from '@/lib/composerMarkdown'|from '@/lib/messaging/composerMarkdown'|g" \
    -e "s|from '@/lib/composerSlash'|from '@/lib/messaging/composerSlash'|g" \
    -e "s|from '@/lib/mentionCursor'|from '@/lib/messaging/mentionCursor'|g" \
    -e "s|from '@/lib/mentionParse'|from '@/lib/messaging/mentionParse'|g" \
    -e "s|from '@/lib/reactions'|from '@/lib/messaging/reactions'|g" \
    -e "s|from '@/lib/findReplace'|from '@/lib/messaging/findReplace'|g" \
    -e "s|from '@/lib/searchFilters'|from '@/lib/messaging/searchFilters'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/chat-post'|from '@/lib/messaging/chat-post'|g" \
    -e "s|from '@/lib/messageCache'|from '@/lib/messaging/messageCache'|g" \
    -e "s|from '@/lib/messageDrafts'|from '@/lib/messaging/messageDrafts'|g" \
    -e "s|from '@/lib/messageRich'|from '@/lib/messaging/messageRich'|g" \
    -e "s|from '@/lib/composerMarkdown'|from '@/lib/messaging/composerMarkdown'|g" \
    -e "s|from '@/lib/composerSlash'|from '@/lib/messaging/composerSlash'|g" \
    -e "s|from '@/lib/mentionCursor'|from '@/lib/messaging/mentionCursor'|g" \
    -e "s|from '@/lib/mentionParse'|from '@/lib/messaging/mentionParse'|g" \
    -e "s|from '@/lib/reactions'|from '@/lib/messaging/reactions'|g" \
    -e "s|from '@/lib/findReplace'|from '@/lib/messaging/findReplace'|g" \
    -e "s|from '@/lib/searchFilters'|from '@/lib/messaging/searchFilters'|g" \
    "$f"; done

# realtime domain (individual files)
echo "  Remapping realtime imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/realtime'|from '@/lib/realtime/realtime'|g" \
    -e "s|from '@/lib/realtimeEventBus'|from '@/lib/realtime/realtimeEventBus'|g" \
    -e "s|from '@/lib/wsClient'|from '@/lib/realtime/wsClient'|g" \
    -e "s|from '@/lib/wsTransport'|from '@/lib/realtime/wsTransport'|g" \
    -e "s|from '@/lib/sseResilience'|from '@/lib/realtime/sseResilience'|g" \
    -e "s|from '@/lib/redisPubSub'|from '@/lib/realtime/redisPubSub'|g" \
    -e "s|from '@/lib/redisClientFactory'|from '@/lib/realtime/redisClientFactory'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/realtime'|from '@/lib/realtime/realtime'|g" \
    -e "s|from '@/lib/realtimeEventBus'|from '@/lib/realtime/realtimeEventBus'|g" \
    -e "s|from '@/lib/wsClient'|from '@/lib/realtime/wsClient'|g" \
    -e "s|from '@/lib/wsTransport'|from '@/lib/realtime/wsTransport'|g" \
    -e "s|from '@/lib/sseResilience'|from '@/lib/realtime/sseResilience'|g" \
    -e "s|from '@/lib/redisPubSub'|from '@/lib/realtime/redisPubSub'|g" \
    -e "s|from '@/lib/redisClientFactory'|from '@/lib/realtime/redisClientFactory'|g" \
    "$f"; done

# wsGateway subdir: @/lib/wsGateway/X -> @/lib/realtime/wsGateway/X
echo "  Remapping wsGateway imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/wsGateway/|from '@/lib/realtime/wsGateway/|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/wsGateway/|from '@/lib/realtime/wsGateway/|g" \
    "$f"; done

# notifications domain
echo "  Remapping notifications imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/notificationClient'|from '@/lib/notifications/notificationClient'|g" \
    -e "s|from '@/lib/notificationHref'|from '@/lib/notifications/notificationHref'|g" \
    -e "s|from '@/lib/notificationInvalidate'|from '@/lib/notifications/notificationInvalidate'|g" \
    -e "s|from '@/lib/notificationPrefs'|from '@/lib/notifications/notificationPrefs'|g" \
    -e "s|from '@/lib/notificationSchedule'|from '@/lib/notifications/notificationSchedule'|g" \
    -e "s|from '@/lib/notificationSound'|from '@/lib/notifications/notificationSound'|g" \
    -e "s|from '@/lib/notificationStream'|from '@/lib/notifications/notificationStream'|g" \
    -e "s|from '@/lib/notificationTypes'|from '@/lib/notifications/notificationTypes'|g" \
    -e "s|from '@/lib/notificationsServer'|from '@/lib/notifications/notificationsServer'|g" \
    -e "s|from '@/lib/desktopNotify'|from '@/lib/notifications/desktopNotify'|g" \
    -e "s|from '@/lib/nativeNotify'|from '@/lib/notifications/nativeNotify'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/notificationClient'|from '@/lib/notifications/notificationClient'|g" \
    -e "s|from '@/lib/notificationHref'|from '@/lib/notifications/notificationHref'|g" \
    -e "s|from '@/lib/notificationInvalidate'|from '@/lib/notifications/notificationInvalidate'|g" \
    -e "s|from '@/lib/notificationPrefs'|from '@/lib/notifications/notificationPrefs'|g" \
    -e "s|from '@/lib/notificationSchedule'|from '@/lib/notifications/notificationSchedule'|g" \
    -e "s|from '@/lib/notificationSound'|from '@/lib/notifications/notificationSound'|g" \
    -e "s|from '@/lib/notificationStream'|from '@/lib/notifications/notificationStream'|g" \
    -e "s|from '@/lib/notificationTypes'|from '@/lib/notifications/notificationTypes'|g" \
    -e "s|from '@/lib/notificationsServer'|from '@/lib/notifications/notificationsServer'|g" \
    -e "s|from '@/lib/desktopNotify'|from '@/lib/notifications/desktopNotify'|g" \
    -e "s|from '@/lib/nativeNotify'|from '@/lib/notifications/nativeNotify'|g" \
    "$f"; done

# channels domain
echo "  Remapping channels imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/channelArchival'|from '@/lib/channels/channelArchival'|g" \
    -e "s|from '@/lib/channelMute'|from '@/lib/channels/channelMute'|g" \
    -e "s|from '@/lib/channelStars'|from '@/lib/channels/channelStars'|g" \
    -e "s|from '@/lib/defaultChannel'|from '@/lib/channels/defaultChannel'|g" \
    -e "s|from '@/lib/recentChannels'|from '@/lib/channels/recentChannels'|g" \
    -e "s|from '@/lib/sidebarOrder'|from '@/lib/channels/sidebarOrder'|g" \
    -e "s|from '@/lib/sidebarSections'|from '@/lib/channels/sidebarSections'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/channelArchival'|from '@/lib/channels/channelArchival'|g" \
    -e "s|from '@/lib/channelMute'|from '@/lib/channels/channelMute'|g" \
    -e "s|from '@/lib/channelStars'|from '@/lib/channels/channelStars'|g" \
    -e "s|from '@/lib/defaultChannel'|from '@/lib/channels/defaultChannel'|g" \
    -e "s|from '@/lib/recentChannels'|from '@/lib/channels/recentChannels'|g" \
    -e "s|from '@/lib/sidebarOrder'|from '@/lib/channels/sidebarOrder'|g" \
    -e "s|from '@/lib/sidebarSections'|from '@/lib/channels/sidebarSections'|g" \
    "$f"; done

# workspace domain
echo "  Remapping workspace imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/workspaceAccess'|from '@/lib/workspace/workspaceAccess'|g" \
    -e "s|from '@/lib/workspaceNav'|from '@/lib/workspace/workspaceNav'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/workspaceAccess'|from '@/lib/workspace/workspaceAccess'|g" \
    -e "s|from '@/lib/workspaceNav'|from '@/lib/workspace/workspaceNav'|g" \
    "$f"; done

# enterprise domain
echo "  Remapping enterprise imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/auditLog'|from '@/lib/enterprise/auditLog'|g" \
    -e "s|from '@/lib/auditStream'|from '@/lib/enterprise/auditStream'|g" \
    -e "s|from '@/lib/bulkProvision'|from '@/lib/enterprise/bulkProvision'|g" \
    -e "s|from '@/lib/retention'|from '@/lib/enterprise/retention'|g" \
    -e "s|from '@/lib/featureFlags'|from '@/lib/enterprise/featureFlags'|g" \
    -e "s|from '@/lib/collab-access'|from '@/lib/enterprise/collab-access'|g" \
    -e "s|from '@/lib/ticketAccess'|from '@/lib/enterprise/ticketAccess'|g" \
    -e "s|from '@/lib/ticketRouter'|from '@/lib/enterprise/ticketRouter'|g" \
    -e "s|from '@/lib/ticketStateMachine'|from '@/lib/enterprise/ticketStateMachine'|g" \
    -e "s|from '@/lib/slaEngine'|from '@/lib/enterprise/slaEngine'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/auditLog'|from '@/lib/enterprise/auditLog'|g" \
    -e "s|from '@/lib/auditStream'|from '@/lib/enterprise/auditStream'|g" \
    -e "s|from '@/lib/bulkProvision'|from '@/lib/enterprise/bulkProvision'|g" \
    -e "s|from '@/lib/retention'|from '@/lib/enterprise/retention'|g" \
    -e "s|from '@/lib/featureFlags'|from '@/lib/enterprise/featureFlags'|g" \
    -e "s|from '@/lib/collab-access'|from '@/lib/enterprise/collab-access'|g" \
    -e "s|from '@/lib/ticketAccess'|from '@/lib/enterprise/ticketAccess'|g" \
    -e "s|from '@/lib/ticketRouter'|from '@/lib/enterprise/ticketRouter'|g" \
    -e "s|from '@/lib/ticketStateMachine'|from '@/lib/enterprise/ticketStateMachine'|g" \
    -e "s|from '@/lib/slaEngine'|from '@/lib/enterprise/slaEngine'|g" \
    "$f"; done

# webhooks domain
echo "  Remapping webhooks imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/webhookDlq'|from '@/lib/webhooks/webhookDlq'|g" \
    -e "s|from '@/lib/webhookEmitter'|from '@/lib/webhooks/webhookEmitter'|g" \
    -e "s|from '@/lib/webhookEngine'|from '@/lib/webhooks/webhookEngine'|g" \
    -e "s|from '@/lib/webhookSigning'|from '@/lib/webhooks/webhookSigning'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/webhookDlq'|from '@/lib/webhooks/webhookDlq'|g" \
    -e "s|from '@/lib/webhookEmitter'|from '@/lib/webhooks/webhookEmitter'|g" \
    -e "s|from '@/lib/webhookEngine'|from '@/lib/webhooks/webhookEngine'|g" \
    -e "s|from '@/lib/webhookSigning'|from '@/lib/webhooks/webhookSigning'|g" \
    "$f"; done

# documents domain
echo "  Remapping documents imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/stirlingPdf'|from '@/lib/documents/stirlingPdf'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/stirlingPdf'|from '@/lib/documents/stirlingPdf'|g" \
    "$f"; done

# puzzleBox subdir: @/lib/puzzleBox/X -> @/lib/documents/puzzleBox/X
echo "  Remapping puzzleBox imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/puzzleBox/|from '@/lib/documents/puzzleBox/|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/puzzleBox/|from '@/lib/documents/puzzleBox/|g" \
    "$f"; done

# infra domain
echo "  Remapping infra imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/db'|from '@/lib/infra/db'|g" \
    -e "s|from '@/lib/migrate'|from '@/lib/infra/migrate'|g" \
    -e "s|from '@/lib/migrationRunner'|from '@/lib/infra/migrationRunner'|g" \
    -e "s|from '@/lib/s3'|from '@/lib/infra/s3'|g" \
    -e "s|from '@/lib/outboxQueue'|from '@/lib/infra/outboxQueue'|g" \
    -e "s|from '@/lib/scheduledMessageProcessor'|from '@/lib/infra/scheduledMessageProcessor'|g" \
    -e "s|from '@/lib/worker'|from '@/lib/infra/worker'|g" \
    -e "s|from '@/lib/metrics'|from '@/lib/infra/metrics'|g" \
    -e "s|from '@/lib/otelExport'|from '@/lib/infra/otelExport'|g" \
    -e "s|from '@/lib/tracing'|from '@/lib/infra/tracing'|g" \
    -e "s|from '@/lib/log'|from '@/lib/infra/log'|g" \
    -e "s|from '@/lib/logger'|from '@/lib/infra/logger'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/db'|from '@/lib/infra/db'|g" \
    -e "s|from '@/lib/migrate'|from '@/lib/infra/migrate'|g" \
    -e "s|from '@/lib/migrationRunner'|from '@/lib/infra/migrationRunner'|g" \
    -e "s|from '@/lib/s3'|from '@/lib/infra/s3'|g" \
    -e "s|from '@/lib/outboxQueue'|from '@/lib/infra/outboxQueue'|g" \
    -e "s|from '@/lib/scheduledMessageProcessor'|from '@/lib/infra/scheduledMessageProcessor'|g" \
    -e "s|from '@/lib/worker'|from '@/lib/infra/worker'|g" \
    -e "s|from '@/lib/metrics'|from '@/lib/infra/metrics'|g" \
    -e "s|from '@/lib/otelExport'|from '@/lib/infra/otelExport'|g" \
    -e "s|from '@/lib/tracing'|from '@/lib/infra/tracing'|g" \
    -e "s|from '@/lib/log'|from '@/lib/infra/log'|g" \
    -e "s|from '@/lib/logger'|from '@/lib/infra/logger'|g" \
    "$f"; done

# ui domain
echo "  Remapping ui imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/theme'|from '@/lib/ui/theme'|g" \
    -e "s|from '@/lib/themePalette'|from '@/lib/ui/themePalette'|g" \
    -e "s|from '@/lib/uiDensity'|from '@/lib/ui/uiDensity'|g" \
    -e "s|from '@/lib/slug'|from '@/lib/ui/slug'|g" \
    -e "s|from '@/lib/accountRequestId'|from '@/lib/ui/accountRequestId'|g" \
    -e "s|from '@/lib/userPreferences'|from '@/lib/ui/userPreferences'|g" \
    -e "s|from '@/lib/useAutoAway'|from '@/lib/ui/useAutoAway'|g" \
    -e "s|from '@/lib/useMediaQuery'|from '@/lib/ui/useMediaQuery'|g" \
    -e "s|from '@/lib/useMenuNav'|from '@/lib/ui/useMenuNav'|g" \
    -e "s|from '@/lib/useStatusExpiry'|from '@/lib/ui/useStatusExpiry'|g" \
    -e "s|from '@/lib/useWorkspaceSlashCommands'|from '@/lib/ui/useWorkspaceSlashCommands'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/theme'|from '@/lib/ui/theme'|g" \
    -e "s|from '@/lib/themePalette'|from '@/lib/ui/themePalette'|g" \
    -e "s|from '@/lib/uiDensity'|from '@/lib/ui/uiDensity'|g" \
    -e "s|from '@/lib/slug'|from '@/lib/ui/slug'|g" \
    -e "s|from '@/lib/accountRequestId'|from '@/lib/ui/accountRequestId'|g" \
    -e "s|from '@/lib/userPreferences'|from '@/lib/ui/userPreferences'|g" \
    -e "s|from '@/lib/useAutoAway'|from '@/lib/ui/useAutoAway'|g" \
    -e "s|from '@/lib/useMediaQuery'|from '@/lib/ui/useMediaQuery'|g" \
    -e "s|from '@/lib/useMenuNav'|from '@/lib/ui/useMenuNav'|g" \
    -e "s|from '@/lib/useStatusExpiry'|from '@/lib/ui/useStatusExpiry'|g" \
    -e "s|from '@/lib/useWorkspaceSlashCommands'|from '@/lib/ui/useWorkspaceSlashCommands'|g" \
    "$f"; done

# comms domain
echo "  Remapping comms imports..."
find $SEARCH_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) -exec \
  sed -i '' \
    -e "s|from '@/lib/emailTemplates'|from '@/lib/comms/emailTemplates'|g" \
    -e "s|from '@/lib/slashCommands'|from '@/lib/comms/slashCommands'|g" \
    -e "s|from '@/lib/dndSchedule'|from '@/lib/comms/dndSchedule'|g" \
    -e "s|from '@/lib/platformRole'|from '@/lib/comms/platformRole'|g" \
    {} +
for f in $EXTRA_FILES; do [ -f "$f" ] && sed -i '' \
    -e "s|from '@/lib/emailTemplates'|from '@/lib/comms/emailTemplates'|g" \
    -e "s|from '@/lib/slashCommands'|from '@/lib/comms/slashCommands'|g" \
    -e "s|from '@/lib/dndSchedule'|from '@/lib/comms/dndSchedule'|g" \
    -e "s|from '@/lib/platformRole'|from '@/lib/comms/platformRole'|g" \
    "$f"; done

echo ""
echo "=== Phase 3 complete: Absolute imports remapped ==="

echo ""
echo "=== Phase 4: Fix cross-domain RELATIVE imports within lib/ ==="

# channelMute.ts (channels/) imports ./apiClient (now in api/)
sed -i '' "s|from './apiClient'|from '@/lib/api/apiClient'|g" lib/channels/channelMute.ts

# channelStars.ts (channels/) imports ./apiClient (now in api/)
sed -i '' "s|from './apiClient'|from '@/lib/api/apiClient'|g" lib/channels/channelStars.ts

# sidebarSections.ts (channels/) imports ./apiClient (now in api/)
sed -i '' "s|from './apiClient'|from '@/lib/api/apiClient'|g" lib/channels/sidebarSections.ts

# migrate.ts (infra/) imports ./db (same dir - OK), ./constants (lib root), ./migrationRunner (same dir - OK)
# Only ./constants needs fixing - it stays at lib root
sed -i '' "s|from './constants'|from '@/lib/constants'|g" lib/infra/migrate.ts

# notificationClient.ts (notifications/) imports:
#   ./notificationSchedule (same dir - OK)
#   ./userPreferences (now in ui/)
#   ./notificationSound (same dir - OK)
sed -i '' "s|from './userPreferences'|from '@/lib/ui/userPreferences'|g" lib/notifications/notificationClient.ts

# notificationSchedule.ts (notifications/) imports ./userPreferences (now in ui/)
sed -i '' "s|from './userPreferences'|from '@/lib/ui/userPreferences'|g" lib/notifications/notificationSchedule.ts

# tracedRoute.ts (api/) imports:
#   ./tracing (now in infra/)
#   ./csrf (now in auth/)
#   ./auditLog (now in enterprise/)
#   ./db (now in infra/)
sed -i '' \
  -e "s|from './tracing'|from '@/lib/infra/tracing'|g" \
  -e "s|from './csrf'|from '@/lib/auth/csrf'|g" \
  -e "s|from './auditLog'|from '@/lib/enterprise/auditLog'|g" \
  -e "s|from './db'|from '@/lib/infra/db'|g" \
  lib/api/tracedRoute.ts

echo "  Fixed 8 cross-domain relative imports"

echo ""
echo "=== Phase 4 complete ==="

echo ""
echo "=== Phase 5: Verify - check for stale imports ==="
STALE=$(grep -rn "from '@/lib/[a-zA-Z]*'" --include='*.ts' --include='*.tsx' app/ lib/ tests/ __tests__/ e2e/ middleware.ts instrumentation.ts 2>/dev/null | grep -v "from '@/lib/constants'" | grep -v "from '@/lib/auth/" | grep -v "from '@/lib/api/" | grep -v "from '@/lib/messaging/" | grep -v "from '@/lib/realtime/" | grep -v "from '@/lib/notifications/" | grep -v "from '@/lib/channels/" | grep -v "from '@/lib/workspace/" | grep -v "from '@/lib/enterprise/" | grep -v "from '@/lib/webhooks/" | grep -v "from '@/lib/documents/" | grep -v "from '@/lib/infra/" | grep -v "from '@/lib/ui/" | grep -v "from '@/lib/comms/" || true)

if [ -n "$STALE" ]; then
  echo "WARNING: Found stale imports that were NOT remapped:"
  echo "$STALE"
  echo ""
  echo "These need manual fixing!"
else
  echo "  No stale imports found. All imports remapped correctly."
fi

echo ""
echo "=== Running TypeScript check ==="
npx tsc --noEmit 2>&1 | head -80

echo ""
echo "=== DONE ==="

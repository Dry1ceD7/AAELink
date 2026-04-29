'use client'

declare global {
  interface Window {
    aaelinkDesktop?: {
      notifyMessage?: (payload: {
        title: string
        body: string
        /** Workspace id for /home?team=… when the user clicks the notification (desktop only). */
        workspace_id?: string
        /** Message id for …&focus_msg=… on notification click (desktop only). */
        focus_message_id?: string
      }) => Promise<unknown>
      /** Desktop only: main process sends when user clicks a chat notification with deep link fields. */
      subscribeNavigateHome?: (
        fn: (payload: { workspace_id?: string; focus_message_id?: string }) => void
      ) => () => void
      /** Desktop only: deep-link protocol handler. */
      subscribeDeepLink?: (
        fn: (payload: { url: string }) => void
      ) => () => void
      /** Desktop only: native file picker via main process (`dialog.showOpenDialog`). */
      openFileDialog?: (options?: {
        properties?: Array<'openFile' | 'multiSelections' | 'openDirectory'>
        filters?: { name: string; extensions: string[] }[]
      }) => Promise<{ canceled: boolean; filePaths: string[] }>
      /** Desktop only: read file bytes from disk as base64 (for chat file uploads). */
      readFileBytes?: (filePath: string) => Promise<{
        ok: boolean
        base64?: string
        size?: number
        error?: string
      }>
      /** Desktop only: set dock/taskbar badge count. */
      setBadgeCount?: (count: number) => Promise<{ ok: boolean }>
    }
  }
}

function stripMarkdownOneLine(s: string, max: number): string {
  let t = s.replace(/\r\n/g, '\n').split('\n')[0] ?? ''
  t = t.replace(/[*_`#>[\]()]/g, '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

function shouldNotifyWhenUnfocused(): boolean {
  if (typeof document === 'undefined') return false
  if (document.visibilityState === 'hidden') return true
  try {
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return true
  } catch {
    /* ignore */
  }
  return false
}

export function notifyDesktopChatMessage(opts: {
  channelTitle: string
  authorLabel: string
  message: string
  extraCount: number
  workspaceId?: string
  focusMessageId?: string
}): void {
  if (!shouldNotifyWhenUnfocused()) return
  const { channelTitle, authorLabel, message, extraCount, workspaceId, focusMessageId } = opts
  const preview = stripMarkdownOneLine(message || '', 180)
  let body = `${authorLabel}: ${preview}`
  if (extraCount > 0) body = `${body} (+${extraCount} more)`
  const title = (channelTitle || 'Messages').slice(0, 120)
  if (typeof window === 'undefined') return
  const bridge = window.aaelinkDesktop?.notifyMessage
  if (typeof bridge === 'function') {
    const ws = (workspaceId || '').trim()
    const fm = (focusMessageId || '').trim()
    void bridge({
      title,
      body: body.slice(0, 500),
      ...(ws && fm ? { workspace_id: ws, focus_message_id: fm } : {})
    })
  }
}

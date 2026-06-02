'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw, CheckCircle2, AlertTriangle, X } from 'lucide-react'

interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error' | 'dev-mode'
  version?: string
  progress?: number
  error?: string
}

/** Electron desktop bridge methods used by UpdateBanner */
interface UpdateDesktopBridge {
  subscribeUpdateStatus?: (cb: (data: UpdateStatus) => void) => (() => void)
  getUpdateStatus?: () => Promise<UpdateStatus>
  checkForUpdate?: () => Promise<void>
  installUpdate?: () => void
}

/**
 * Desktop Update Banner — displays at the top of the workspace when a new
 * version is available, downloading, or ready to install.
 * 
 * Communicates with the Electron main process via the `window.aaelinkDesktop`
 * preload bridge (IPC channels: aaelink:get-update-status, aaelink:check-for-update,
 * aaelink:install-update).
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Only run in desktop shell
    const bridge: UpdateDesktopBridge | undefined = window.aaelinkDesktop as unknown as UpdateDesktopBridge | undefined
    if (!bridge) return

    let unsubscribe: (() => void) | undefined

    // Subscribe to live update events via preload bridge
    if (bridge.subscribeUpdateStatus) {
      unsubscribe = bridge.subscribeUpdateStatus((data: UpdateStatus) => {
        setStatus(data)
        // Un-dismiss when a new update is found or ready
        if (data.status === 'available' || data.status === 'ready') {
          setDismissed(false)
        }
      })
    }

    // Also check current status on mount
    if (bridge.getUpdateStatus) {
      bridge.getUpdateStatus().then((s: UpdateStatus) => {
        if (s) setStatus(s)
      }).catch(() => {})
    }

    return () => {
      unsubscribe?.()
    }
  }, [])

  const checkNow = useCallback(async () => {
    const bridge: UpdateDesktopBridge | undefined = window.aaelinkDesktop as unknown as UpdateDesktopBridge | undefined
    if (bridge?.checkForUpdate) {
      await bridge.checkForUpdate()
    }
  }, [])

  const installNow = useCallback(() => {
    const bridge: UpdateDesktopBridge | undefined = window.aaelinkDesktop as unknown as UpdateDesktopBridge | undefined
    if (bridge?.installUpdate) {
      bridge.installUpdate()
    }
  }, [])

  // Don't render in non-desktop or irrelevant states
  if (!['available', 'downloading', 'ready', 'error'].includes(status.status)) return null
  if (dismissed) return null

  return (
    <div className={`update-banner update-banner--${status.status}`} role="status">
      <div className="update-banner-content">
        {status.status === 'available' && (
          <>
            <Download size={15} />
            <span>A new version of AAELink is available: <strong>v{status.version}</strong></span>
            <span className="update-banner-hint">Downloading automatically…</span>
          </>
        )}

        {status.status === 'downloading' && (
          <>
            <RefreshCw size={15} className="spin" />
            <span>Downloading update… {status.progress != null ? `${status.progress}%` : ''}</span>
            {status.progress != null && (
              <div className="update-banner-progress">
                <div className="update-banner-progress-bar" style={{ width: `${status.progress}%` }} />
              </div>
            )}
          </>
        )}

        {status.status === 'ready' && (
          <>
            <CheckCircle2 size={15} />
            <span>Update <strong>v{status.version}</strong> is ready.</span>
            <button type="button" className="update-banner-btn" onClick={installNow}>
              Restart & Install
            </button>
          </>
        )}

        {status.status === 'error' && (
          <>
            <AlertTriangle size={15} />
            <span>Update check failed{status.error ? `: ${status.error}` : '.'}</span>
            <button type="button" className="update-banner-btn update-banner-btn--ghost" onClick={() => void checkNow()}>
              Retry
            </button>
          </>
        )}
      </div>

      <button type="button" className="update-banner-dismiss" onClick={() => setDismissed(true)} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}

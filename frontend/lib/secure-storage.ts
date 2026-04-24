'use client'

// Persistent storage for the AAELink desktop client.
//
// When running inside the AAELink desktop wrapper, sensitive values like the
// long-lived refresh token are persisted via the OS keychain (Electron
// `safeStorage`). On the browser we fall back to `localStorage`, which is
// still scoped to the user profile but unencrypted. The interface is async
// to keep the desktop path possible.

const REFRESH_KEY = 'aae_refresh_token'
const REMEMBER_KEY = 'aae_remember_me'

interface DesktopBridge {
  isDesktop: boolean
  secure: {
    available: () => Promise<boolean>
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<boolean>
    del: (key: string) => Promise<boolean>
  }
}

function bridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { aaelink?: DesktopBridge }
  return w.aaelink && w.aaelink.isDesktop ? w.aaelink : null
}

export const persistent = {
  async getRefresh(): Promise<string | null> {
    const b = bridge()
    if (b) {
      try {
        return await b.secure.get(REFRESH_KEY)
      } catch {
        return null
      }
    }
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(REFRESH_KEY)
  },

  async setRefresh(value: string): Promise<void> {
    const b = bridge()
    if (b) {
      try { await b.secure.set(REFRESH_KEY, value); return } catch { /* fall through */ }
    }
    if (typeof window === 'undefined') return
    window.localStorage.setItem(REFRESH_KEY, value)
  },

  async clearRefresh(): Promise<void> {
    const b = bridge()
    if (b) {
      try { await b.secure.del(REFRESH_KEY) } catch { /* ignore */ }
    }
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(REFRESH_KEY)
  },

  getRememberMe(): boolean {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(REMEMBER_KEY) === '1'
  },

  setRememberMe(value: boolean): void {
    if (typeof window === 'undefined') return
    if (value) window.localStorage.setItem(REMEMBER_KEY, '1')
    else window.localStorage.removeItem(REMEMBER_KEY)
  },
}

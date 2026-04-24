'use client'

import { create } from 'zustand'
import { authApi, tokenStorage } from './api'
import { persistent } from './secure-storage'
import type { User } from './types'

interface AuthState {
  user: User | null
  isHydrated: boolean
  hydrate: () => Promise<void>
  login: (email: string, password: string, remember?: boolean) => Promise<User>
  logout: () => Promise<void>
  setUser: (u: User | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isHydrated: false,

  hydrate: async () => {
    const cached = tokenStorage.getUser()
    if (cached) set({ user: cached })

    const access = tokenStorage.getAccess()
    if (access) {
      try {
        const me = await authApi.me()
        tokenStorage.setUser(me)
        set({ user: me })
        set({ isHydrated: true })
        return
      } catch {
        tokenStorage.clear()
      }
    }

    if (persistent.getRememberMe()) {
      const rt = await persistent.getRefresh()
      if (rt) {
        try {
          const res = await authApi.refresh(rt)
          tokenStorage.set(res.tokens.access_token, res.tokens.refresh_token)
          tokenStorage.setUser(res.user)
          await persistent.setRefresh(res.tokens.refresh_token)
          set({ user: res.user })
        } catch {
          await persistent.clearRefresh()
          persistent.setRememberMe(false)
          tokenStorage.clear()
          set({ user: null })
        }
      }
    }

    set({ isHydrated: true })
  },

  login: async (email, password, remember = false) => {
    const res = await authApi.login(email, password)
    tokenStorage.set(res.tokens.access_token, res.tokens.refresh_token)
    tokenStorage.setUser(res.user)
    persistent.setRememberMe(remember)
    if (remember) {
      await persistent.setRefresh(res.tokens.refresh_token)
    } else {
      await persistent.clearRefresh()
    }
    set({ user: res.user })
    return res.user
  },

  logout: async () => {
    const rt = tokenStorage.getRefresh()
    if (rt) {
      try {
        await authApi.logout(rt)
      } catch {
        // ignore
      }
    }
    await persistent.clearRefresh()
    persistent.setRememberMe(false)
    tokenStorage.clear()
    set({ user: null })
  },

  setUser: (u) => set({ user: u }),
}))

export function hasRole(user: User | null, ...roles: string[]): boolean {
  if (!user || !user.roles) return false
  return user.roles.some((r) => roles.includes(r))
}

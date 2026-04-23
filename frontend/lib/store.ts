'use client'

import { create } from 'zustand'
import { authApi, tokenStorage } from './api'
import type { User } from './types'

interface AuthState {
  user: User | null
  isHydrated: boolean
  hydrate: () => Promise<void>
  login: (email: string, password: string) => Promise<User>
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
      } catch {
        tokenStorage.clear()
        set({ user: null })
      }
    }
    set({ isHydrated: true })
  },

  login: async (email, password) => {
    const res = await authApi.login(email, password)
    tokenStorage.set(res.tokens.access_token, res.tokens.refresh_token)
    tokenStorage.setUser(res.user)
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
    tokenStorage.clear()
    set({ user: null })
  },

  setUser: (u) => set({ user: u }),
}))

export function hasRole(user: User | null, ...roles: string[]): boolean {
  if (!user || !user.roles) return false
  return user.roles.some((r) => roles.includes(r))
}

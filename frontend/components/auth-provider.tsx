'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/lib/store'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    useAuthStore.getState().hydrate()
  }, [])
  return <>{children}</>
}

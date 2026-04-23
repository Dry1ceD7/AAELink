'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuthStore } from '@/lib/store'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isHydrated } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (isHydrated && !user) {
      router.replace('/login')
    }
  }, [isHydrated, user, router])

  if (!isHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[color:var(--muted)] text-sm">
        Loading…
      </div>
    )
  }

  if (!user) return null

  return <>{children}</>
}

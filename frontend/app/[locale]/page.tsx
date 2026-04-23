'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Logo } from '@/components/brand/logo'
import { useAuthStore } from '@/lib/store'

export default function HomePage() {
  const router = useRouter()
  const { user, isHydrated } = useAuthStore()

  useEffect(() => {
    if (!isHydrated) return
    router.replace(user ? '/dashboard' : '/login')
  }, [user, isHydrated, router])

  return (
    <main className="flex min-h-screen items-center justify-center">
      <Logo size={64} />
    </main>
  )
}

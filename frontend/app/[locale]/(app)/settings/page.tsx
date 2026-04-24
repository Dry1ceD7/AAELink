'use client'

import { useEffect } from 'react'

import { useRouter } from '@/i18n/navigation'
import { useUIStore } from '@/lib/ui-store'

// Settings now live in a global tabbed drawer launched from the user menu.
// Any direct visit to /settings (old bookmark, deep-link from another
// surface) re-opens that drawer over the dashboard.
export default function SettingsRedirect() {
  const router = useRouter()
  const openSettings = useUIStore((s) => s.openSettings)

  useEffect(() => {
    router.replace('/dashboard')
    openSettings()
  }, [router, openSettings])

  return null
}

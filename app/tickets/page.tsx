'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { buildHomePathForTeam, readRememberedWorkspaceTeam } from '@/lib/workspace/workspaceNav'

/** Tickets live inside the home shell; this route keeps old links working. */
export default function TicketsRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    const team = readRememberedWorkspaceTeam()
    router.replace(team ? buildHomePathForTeam(team, 'tickets') : '/home?module=tickets')
  }, [router])
  return (
    <main
      className="mm-app-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="tickets-redirect-status"
    >
      <p id="tickets-redirect-status" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Loader2 size={20} className="spin" aria-hidden="true" />
        Opening tickets
      </p>
    </main>
  )
}

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { buildHomePathForTeam, readRememberedWorkspaceTeam } from '@/lib/workspace/workspaceNav'

/** Documents live inside the home shell; this route keeps old links working. */
export default function DocumentsRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    const team = readRememberedWorkspaceTeam()
    router.replace(team ? buildHomePathForTeam(team, 'documents') : '/home?module=documents')
  }, [router])
  return (
    <main
      className="mm-app-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="documents-redirect-status"
    >
      <p id="documents-redirect-status" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Loader2 size={20} className="spin" aria-hidden="true" />
        Opening documents
      </p>
    </main>
  )
}

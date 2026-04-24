'use client'

import { useEffect } from 'react'

import { useRouter } from '@/i18n/navigation'
import { useUIStore } from '@/lib/ui-store'

// Backwards-compatible redirect for any bookmarks that still point at the
// old standalone /tickets/new page. The "Create Ticket" experience is now
// a global slide-over so users keep their context.
export default function NewTicketRedirect() {
  const router = useRouter()
  const openNewTicket = useUIStore((s) => s.openNewTicket)

  useEffect(() => {
    router.replace('/tickets')
    openNewTicket()
  }, [router, openNewTicket])

  return null
}

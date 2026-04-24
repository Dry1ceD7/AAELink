'use client'

import { NewTicketDrawer } from '@/components/dashboard/new-ticket-drawer'
import { SettingsDrawer } from '@/components/dashboard/settings-drawer'

// One-stop mount point for app-shell-level overlays. Keeps DashboardHeader
// and Sidebar lean and ensures z-index ordering stays predictable because
// every overlay lives in the same parent.
export function GlobalOverlays() {
  return (
    <>
      <NewTicketDrawer />
      <SettingsDrawer />
    </>
  )
}

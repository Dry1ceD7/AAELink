import { AuthGuard } from '@/components/auth-guard'
import { DashboardHeader } from '@/components/dashboard/header'
import { Sidebar } from '@/components/dashboard/sidebar'
import { GlobalOverlays } from '@/components/dashboard/global-overlays'
import { NotificationsListener } from '@/components/notifications-listener'
import { PreferencesApplier } from '@/components/preferences-applier'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      {/* App shell is locked to the viewport. Only the inner <main>
          scrolls — every other surface stays fixed so the desktop client
          feels native. */}
      <PreferencesApplier />
      <NotificationsListener />
      <div
        data-aae-shell="true"
        className="fixed inset-0 flex flex-col bg-[color:var(--bg)] overflow-hidden"
      >
        <DashboardHeader />
        <div className="flex-1 min-h-0 flex">
          <Sidebar />
          <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
              {children}
            </div>
          </main>
        </div>
        <GlobalOverlays />
      </div>
    </AuthGuard>
  )
}

import { AuthGuard } from '@/components/auth-guard'
import { DashboardHeader } from '@/components/dashboard/header'
import { Sidebar } from '@/components/dashboard/sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen flex flex-col">
        <DashboardHeader />
        <div className="flex-1 flex">
          <Sidebar />
          <main className="flex-1 min-w-0 px-6 py-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  )
}

'use client'

import Link from 'next/link'
import { SettingsShell } from '../components/SettingsShell'

export default function SettingsPage() {
  return (
    <main className="aae-auth-page">
      <div className="aae-auth-card aae-auth-card--wide" style={{ margin: '0 auto' }}>
        <div className="slack-card mm-settings-page-card">
          <p className="mm-settings-page-back">
            <Link href="/home" className="link-button">
              Back to app
            </Link>
          </p>
          <SettingsShell variant="page" />
        </div>
      </div>
    </main>
  )
}

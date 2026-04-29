'use client'

import { RequestAccessFlow } from '../components/RequestAccessFlow'

export default function RegisterPage() {
  return (
    <main className="aae-auth-page">
      <div className="aae-auth-card aae-auth-card--wide">
        <div className="slack-card mm-auth-form" style={{ padding: 'clamp(18px, 4vw, 28px) clamp(14px, 4vw, 32px)' }}>
          <RequestAccessFlow layout="page" />
        </div>
      </div>
    </main>
  )
}

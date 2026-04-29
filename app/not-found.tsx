import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="aae-auth-page">
      <div className="aae-auth-card">
        <div className="slack-card mm-auth-form" style={{ padding: '28px 28px' }}>
          <h1 className="aae-auth-title">Page not found</h1>
          <p className="aae-auth-lead" style={{ marginBottom: 16 }}>
            The address may be mistyped or the page was removed. Open the app or sign in again.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Link href="/home" className="slack-button" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Open app
            </Link>
            <Link href="/login" className="ghost-button" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

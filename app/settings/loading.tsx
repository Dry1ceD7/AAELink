/** Settings route loading: split rail + content (matches SettingsShell page layout). */
export default function SettingsLoading() {
  return (
    <main
      className="aae-auth-page"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="settings-route-loading-title"
    >
      <div className="aae-auth-card aae-auth-card--wide" style={{ margin: '0 auto' }}>
        <h1 id="settings-route-loading-title" className="visually-hidden">
          Loading settings
        </h1>
        <div className="slack-card mm-settings-page-card">
          <p className="mm-settings-page-back">
            <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 112, height: 18, borderRadius: 8 }} />
          </p>
          <div className="mm-settings-page-split">
            <nav className="mm-settings-rail mm-settings-nav" aria-hidden>
              {[72, 110, 100, 52].map((w, i) => (
                <span key={i} className="mm-home-loading-shimmer" style={{ width: '100%', height: 36, borderRadius: 8 }} />
              ))}
            </nav>
            <div className="mm-settings-content">
              <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 'min(200px, 55%)', height: 24, marginBottom: 14 }} />
              <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', maxWidth: 480, height: 12, marginBottom: 8 }} />
              <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '92%', maxWidth: 520, height: 12, marginBottom: 18 }} />
              <div style={{ display: 'flex', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--mm-sidebar-border)' }}>
                <span className="mm-home-loading-shimmer" style={{ width: 64, height: 64, borderRadius: 8, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, paddingTop: 6 }}>
                  <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '70%', height: 18, marginBottom: 8 }} />
                  <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 120, height: 14 }} />
                </div>
              </div>
              {[1, 2, 3].map(i => (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(100px, 140px) 1fr',
                    gap: 8,
                    padding: '12px 0',
                    borderBottom: '1px solid var(--mm-border-subtle, rgba(61, 60, 64, 0.14))'
                  }}
                >
                  <span className="mm-home-loading-shimmer" style={{ height: 10, width: 72 }} />
                  <span className="mm-home-loading-shimmer" style={{ height: 14, width: `${60 + i * 10}%` }} />
                </div>
              ))}
              <div style={{ marginTop: 'auto', paddingTop: 18, borderTop: '1px solid var(--mm-sidebar-border)', display: 'flex', gap: 10 }}>
                <span className="mm-home-loading-shimmer" style={{ width: 108, height: 40, borderRadius: 8 }} />
                <span className="mm-home-loading-shimmer" style={{ width: 88, height: 40, borderRadius: 8 }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

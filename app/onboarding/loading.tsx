/** Onboarding create-workspace route loading. */
export default function OnboardingLoading() {
  return (
    <main
      className="aae-auth-page"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="onboarding-route-loading-title"
    >
      <div className="aae-auth-card aae-auth-card--wide">
        <h1 id="onboarding-route-loading-title" className="visually-hidden">
          Loading workspace setup
        </h1>
        <div className="slack-card mm-auth-form" style={{ padding: '28px 32px' }}>
          <div className="aae-auth-brand" style={{ marginBottom: 16 }}>
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 'min(120px, 40vw)', height: 72, margin: '0 auto', borderRadius: 8 }} />
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 220, height: 10, margin: '12px auto 0' }} />
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 72, height: 10, margin: '8px auto 0' }} />
          </div>
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 200, height: 24, marginBottom: 10 }} />
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', maxWidth: 480, height: 12, marginBottom: 18 }} />
          <div style={{ marginBottom: 4 }}>
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 120, height: 10, marginBottom: 6 }} />
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 40, borderRadius: 8 }} />
          </div>
          <div style={{ marginBottom: 4 }}>
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 100, height: 10, marginBottom: 6 }} />
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 40, borderRadius: 8 }} />
          </div>
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 44, borderRadius: 8, marginTop: 12 }} />
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 40, borderRadius: 8, marginTop: 10 }} />
        </div>
      </div>
    </main>
  )
}

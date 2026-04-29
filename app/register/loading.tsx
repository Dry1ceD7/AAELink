/** Register / request access route loading (auth card + form skeleton). */
export default function RegisterLoading() {
  return (
    <main
      className="aae-auth-page"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="register-route-loading-title"
    >
      <div className="aae-auth-card aae-auth-card--wide">
        <h1 id="register-route-loading-title" className="visually-hidden">
          Loading request access
        </h1>
        <div className="slack-card mm-auth-form" style={{ padding: '28px 32px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <span className="mm-home-loading-shimmer" style={{ width: 'min(120px, 36vw)', height: 72, borderRadius: 8 }} />
            <span className="mm-home-loading-shimmer" style={{ width: 200, height: 10 }} />
            <span className="mm-home-loading-shimmer" style={{ width: 80, height: 10 }} />
          </div>
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 'min(280px, 85%)', height: 24, marginBottom: 10 }} />
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', maxWidth: 520, height: 12, marginBottom: 18 }} />
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ marginBottom: 4 }}>
              <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 96, height: 10, marginBottom: 6 }} />
              <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 40, borderRadius: 8 }} />
            </div>
          ))}
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 44, borderRadius: 8, marginTop: 12 }} />
        </div>
      </div>
    </main>
  )
}

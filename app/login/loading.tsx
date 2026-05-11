/** Login route loading: matches the new Mattermost-style split-screen layout. */
export default function LoginLoading() {
  return (
    <main
      className="mm-login-shell mm-login-shell--ready"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="login-route-loading-title"
    >
      <h1 id="login-route-loading-title" className="visually-hidden">
        Loading sign in
      </h1>

      {/* Brand panel skeleton */}
      <div className="mm-login-brand" aria-hidden="true">
        <div className="mm-login-brand-inner">
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 140, height: 140, borderRadius: 8, margin: '0 auto' }} />
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 140, height: 22, margin: '24px auto 0', borderRadius: 8 }} />
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 220, height: 10, margin: '10px auto 0', borderRadius: 8, opacity: 0.3 }} />
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 200, height: 10, margin: '20px auto 0', borderRadius: 8, opacity: 0.2 }} />
        </div>
      </div>

      {/* Form panel skeleton */}
      <div className="mm-login-form-panel">
        <div className="mm-login-form-scroll">
          <div className="mm-login-form-wrap">
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 240, height: 24, borderRadius: 8, marginBottom: 10 }} />
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 320, height: 12, borderRadius: 8, marginBottom: 24 }} />
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 56, borderRadius: 8, marginBottom: 14, background: 'rgba(0,61,110,0.04)' }} />
            {/* Email label + input */}
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 120, height: 10, borderRadius: 8, marginBottom: 6 }} />
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 44, borderRadius: 8, marginBottom: 16 }} />
            {/* Password label + input */}
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 80, height: 10, borderRadius: 8, marginBottom: 6 }} />
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 44, borderRadius: 8, marginBottom: 20 }} />
            {/* Submit button */}
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 46, borderRadius: 8 }} />
          </div>
        </div>
      </div>
    </main>
  )
}

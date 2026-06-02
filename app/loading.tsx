/** Route-level loading UI — branded Mattermost-style splash (Next.js App Router). */
export default function Loading() {
  return (
    <main
      className="mm-splash"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="splash-label"
    >
      <div className="mm-splash-inner">
        <img
          src="/brand/aae-logo.png"
          alt=""
          className="mm-splash-logo"
          width={120}
          height={120}
        />
        <h1 className="mm-splash-name">AAELink</h1>
        <p className="mm-splash-company">Advanced ID Asia Engineering</p>
        <div className="mm-splash-spinner" aria-hidden="true">
          <span className="mm-splash-spinner-dot" />
          <span className="mm-splash-spinner-dot" />
          <span className="mm-splash-spinner-dot" />
        </div>
        <span id="splash-label" className="mm-splash-text">Loading workspace…</span>
      </div>
    </main>
  )
}

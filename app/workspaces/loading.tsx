/** Workspaces route loading: branded splash while workspace list loads. */
export default function WorkspacesLoading() {
  return (
    <main
      className="mm-splash"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="ws-loading-label"
    >
      <div className="mm-splash-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
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
        <span id="ws-loading-label" className="mm-splash-text">Loading workspaces…</span>
      </div>
    </main>
  )
}

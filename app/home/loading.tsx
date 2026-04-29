/** Home route loading: mirrors `mm-app` shell until the chat page hydrates. */
export default function HomeLoading() {
  const sidebarLines = [86, 72, 78, 64, 80, 70, 76]
  const mainLines = [92, 88, 95, 72, 90, 68, 85, 60, 78]

  return (
    <main className="mm-app mm-home-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading workspace">
      <nav className="mm-team-sidebar" aria-hidden="true">
        <div className="mm-home-loading-team">
          <span className="mm-home-loading-shimmer mm-home-loading-team-dot" />
          <span className="mm-home-loading-shimmer mm-home-loading-team-dot" />
        </div>
      </nav>

      <aside className="mm-channel-sidebar" aria-hidden="true">
        <div className="mm-sidebar-header">
          <span className="mm-home-loading-shimmer" style={{ width: 'min(140px, 55%)', height: 14 }} />
        </div>
        <div className="mm-channel-search">
          <div className="mm-channel-search-inner" style={{ opacity: 0.65 }} aria-hidden />
        </div>
        <div className="mm-sidebar-scroll mm-home-loading-channel-rows">
          {sidebarLines.map((w, i) => (
            <span key={i} className="mm-home-loading-shimmer mm-home-loading-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      </aside>

      <section className="mm-main" aria-hidden="true">
        <header className="mm-channel-header" style={{ minHeight: 56 }}>
          <span className="mm-home-loading-shimmer" style={{ width: 220, height: 18 }} />
        </header>
        <div className="mm-home-loading-main-mid">
          {mainLines.map((w, i) => (
            <span key={i} className="mm-home-loading-shimmer mm-home-loading-line" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="mm-home-loading-compose">
          <span className="mm-home-loading-shimmer" style={{ flex: 1, height: 44 }} />
        </div>
      </section>

      <aside className="mm-rhs mm-rhs--members-only" aria-hidden="true">
        <div className="mm-rhs-head">Members</div>
        <div className="mm-rhs-body mm-home-loading-channel-rows">
          {[1, 2, 3, 4, 5].map(i => (
            <span key={i} className="mm-home-loading-shimmer mm-home-loading-line" style={{ width: `${78 - i * 4}%` }} />
          ))}
        </div>
      </aside>
    </main>
  )
}

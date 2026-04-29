/** Legacy /documents URL: brief load before client redirect to home documents. */
export default function DocumentsLoading() {
  return (
    <main
      className="mm-app-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="documents-route-loading-label"
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div className="mm-route-loading" aria-hidden="true">
          <span className="mm-route-loading-bar" />
          <span className="mm-route-loading-bar mm-route-loading-bar--mid" />
          <span className="mm-route-loading-bar mm-route-loading-bar--short" />
        </div>
        <p id="documents-route-loading-label" style={{ margin: 0, fontWeight: 600, color: 'var(--aae-navy-deep)' }}>
          Opening documents
        </p>
      </div>
    </main>
  )
}

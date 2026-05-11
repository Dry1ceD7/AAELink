/** Admin route loading: matches wide auth card, sections, and tables. */
function TableSkeleton({ rows }: { rows: number }) {
  const th = { padding: '8px 6px', textAlign: 'left' as const, borderBottom: '1px solid rgba(0,0,0,0.08)' }
  const td = { padding: '8px 6px', borderBottom: '1px solid rgba(0,0,0,0.06)' }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            <th style={th}>
              <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 48, height: 10 }} />
            </th>
            <th style={th}>
              <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 44, height: 10 }} />
            </th>
            <th style={th}>
              <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 72, height: 10 }} />
            </th>
            <th style={th}>
              <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 52, height: 10 }} />
            </th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td style={td}>
                <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 120, height: 12 }} />
              </td>
              <td style={td}>
                <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: `${90 + (i % 3) * 12}%`, maxWidth: 160, height: 12 }} />
              </td>
              <td style={td}>
                <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: `${85 + (i % 2) * 8}%`, maxWidth: 200, height: 12 }} />
              </td>
              <td style={td}>
                <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 56, height: 12 }} />
              </td>
              <td style={td}>
                <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 72, height: 28, borderRadius: 8 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AccountsTableSkeleton() {
  const th = { padding: '6px', textAlign: 'left' as const, borderBottom: '1px solid rgba(0,0,0,0.08)' }
  const td = { padding: '6px', borderBottom: '1px solid rgba(0,0,0,0.05)' }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {['72px', '88px', '44px'].map((w, i) => (
              <th key={i} style={th}>
                <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: w, height: 10 }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4].map(i => (
            <tr key={i}>
              <td style={td}>
                <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 100, height: 12 }} />
              </td>
              <td style={td}>
                <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 88, height: 12 }} />
                <br />
                <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 140, height: 10, marginTop: 4 }} />
              </td>
              <td style={td}>
                <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: `${70 + i * 6}%`, maxWidth: 280, height: 12 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AdminLoading() {
  return (
    <main
      className="aae-auth-page"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="admin-route-loading-title"
    >
      <div className="aae-auth-card aae-auth-card--wide" style={{ margin: '0 auto' }}>
        <h1 id="admin-route-loading-title" className="visually-hidden">
          Loading admin
        </h1>
        <p style={{ margin: '0 0 12px' }}>
          <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 112, height: 18, borderRadius: 8 }} />
        </p>
        <div className="slack-card mm-auth-form" style={{ padding: '28px 28px' }}>
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 'min(280px, 70%)', height: 28, marginBottom: 10 }} />
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', maxWidth: 640, height: 12, marginBottom: 6 }} />
          <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '85%', maxWidth: 520, height: 12, marginBottom: 20 }} />

          <section style={{ marginBottom: 24 }}>
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 160, height: 18, marginBottom: 12 }} />
            <TableSkeleton rows={3} />
          </section>

          <section style={{ marginBottom: 24 }}>
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 140, height: 18, marginBottom: 10 }} />
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', maxWidth: 480, height: 12, marginBottom: 14 }} />
            <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} aria-hidden>
                  <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 72 + (i % 3) * 16, height: 10, marginBottom: 6 }} />
                  <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', height: 40, borderRadius: 8 }} />
                </div>
              ))}
              <span className="mm-home-loading-shimmer" style={{ width: 120, height: 36, borderRadius: 8 }} />
            </div>
          </section>

          <section style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 180, height: 18, marginBottom: 10 }} />
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: '100%', maxWidth: 560, height: 12, marginBottom: 12 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="mm-home-loading-shimmer" style={{ width: 64, height: 16 }} />
              <span className="mm-home-loading-shimmer" style={{ width: 96, height: 32, borderRadius: 8 }} />
            </div>
          </section>

          <section style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 200, height: 18, marginBottom: 12 }} />
            <AccountsTableSkeleton />
          </section>

          <section style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <span className="mm-home-loading-shimmer" style={{ display: 'block', width: 160, height: 18, marginBottom: 12 }} />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                    {['88px', '120px', '48px'].map((w, i) => (
                      <th key={i} style={{ padding: '6px', textAlign: 'left' }}>
                        <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: w, height: 10 }} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map(i => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '6px' }}>
                        <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 100 + (i % 4) * 8, height: 12 }} />
                      </td>
                      <td style={{ padding: '6px' }}>
                        <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: `${75 + (i % 3) * 8}%`, maxWidth: 220, height: 12 }} />
                      </td>
                      <td style={{ padding: '6px' }}>
                        <span className="mm-home-loading-shimmer" style={{ display: 'inline-block', width: 72, height: 12 }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

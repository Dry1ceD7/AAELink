'use client'

interface MemberListPanelProps {
  open: boolean
  members: { id: string; username?: string; first_name?: string; last_name?: string; nickname?: string }[]
  getStatus: (userId: string) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  displayName: (user: any) => string
  onOpenDm: (userId: string) => void
  onClose: () => void
}

export function MemberListPanel({ open, members, getStatus, displayName, onOpenDm, onClose }: MemberListPanelProps) {
  if (!open) return null

  return (
    <aside className="member-list-panel">
      <header className="member-list-header">
        <h2>Members</h2>
        <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close member list">
          <span aria-hidden>✕</span>
        </button>
      </header>
      <div className="member-list-body">
        {members.length === 0 ? (
          <p className="member-list-empty">No members to display.</p>
        ) : (
          members.map(u => {
            const status = getStatus(u.id)
            const name = displayName(u)
            return (
              <button key={u.id} type="button" className="member-list-item" onClick={() => { onOpenDm(u.id); onClose() }}>
                <div className="member-list-avatar">
                  {(u.username || name).slice(0, 1).toUpperCase()}
                  <span className={`member-list-presence presence--${status}`} />
                </div>
                <div className="member-list-info">
                  <strong>{name}</strong>
                  <span>@{u.username}</span>
                </div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}

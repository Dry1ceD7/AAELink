/** Session key for last-opened workspace (sidebar + deep links). */
export const WORKSPACE_LAST_TEAM_KEY = 'aaelink_last_team'

export function rememberWorkspaceTeam(id: string) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(WORKSPACE_LAST_TEAM_KEY, id)
  } catch {
    /* ignore */
  }
}

export function readRememberedWorkspaceTeam(): string {
  if (typeof window === 'undefined') return ''
  try {
    return sessionStorage.getItem(WORKSPACE_LAST_TEAM_KEY) || ''
  } catch {
    return ''
  }
}

export function clearRememberedWorkspaceTeam() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(WORKSPACE_LAST_TEAM_KEY)
  } catch {
    /* ignore */
  }
}

/** Path to the main shell for a workspace, preserving optional module. */
export function buildHomePathForTeam(teamId: string, module?: 'tickets' | 'documents') {
  const p = new URLSearchParams()
  p.set('team', teamId)
  if (module === 'tickets' || module === 'documents') p.set('module', module)
  const qs = p.toString()
  return `/home?${qs}`
}

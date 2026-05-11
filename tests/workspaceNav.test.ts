/**
 * AAELink — Workspace Navigation Tests
 */
import { describe, it, expect } from 'vitest'
import { buildHomePathForTeam, WORKSPACE_LAST_TEAM_KEY } from '@/lib/workspaceNav'

describe('WorkspaceNav — buildHomePathForTeam', () => {
  it('builds basic path', () => {
    expect(buildHomePathForTeam('ws-1')).toBe('/home?team=ws-1')
  })

  it('includes tickets module', () => {
    const p = buildHomePathForTeam('ws-1', 'tickets')
    expect(p).toBe('/home?team=ws-1&module=tickets')
  })

  it('includes documents module', () => {
    const p = buildHomePathForTeam('ws-1', 'documents')
    expect(p).toBe('/home?team=ws-1&module=documents')
  })

  it('ignores undefined module', () => {
    const p = buildHomePathForTeam('ws-1', undefined)
    expect(p).toBe('/home?team=ws-1')
  })

  it('encodes special chars in team ID', () => {
    const p = buildHomePathForTeam('team with spaces')
    expect(p).toContain('team=team+with+spaces')
  })
})

describe('WorkspaceNav — Constants', () => {
  it('storage key is defined', () => {
    expect(WORKSPACE_LAST_TEAM_KEY).toBe('aaelink_last_team')
  })
})

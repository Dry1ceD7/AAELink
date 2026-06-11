/**
 * AAELink — SSO JIT provisioning / linking / session establishment tests.
 *
 * A scripted in-memory fake pool models the few queries loginViaSso runs:
 * identity-link lookup, user-by-email lookup, user insert, workspace insert,
 * session insert, and the counter updates. sessionPolicy is mocked so we avoid
 * its DB lookup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Pool } from 'pg'

vi.mock('@/lib/auth/sessionPolicy', () => ({
  getSessionPolicy: vi.fn(async () => ({})),
  sessionTtlMs: vi.fn(() => 86_400_000),
}))

import { loginViaSso } from '@/lib/auth/ssoProvision'
import type { SsoProviderConfig } from '@/lib/auth/ssoProvider'
import type { MappedIdentity } from '@/lib/auth/ssoClaims'

interface State {
  links: Array<{ provider_id: string; subject: string; user_id: string }>
  users: Array<{ id: string; email: string; username: string }>
  workspaces: string[]
  members: Array<{ workspace_id: string; user_id: string; role: string }>
  sessions: Array<{ id: string; user_id: string; mfa_pending?: boolean }>
}

function fakePool(s: State): Pool {
  return {
    query: async (text: string, params: unknown[] = []) => {
      if (text.includes('FROM aaelink.sso_identity_links WHERE provider_id')) {
        const m = s.links.find(l => l.provider_id === params[0] && l.subject === params[1])
        return { rows: m ? [{ user_id: m.user_id }] : [] }
      }
      if (text.includes('FROM aaelink.users WHERE lower(email)')) {
        const u = s.users.find(x => x.email.toLowerCase() === String(params[0]).toLowerCase())
        return { rows: u ? [{ id: u.id }] : [] }
      }
      if (text.includes('FROM aaelink.users WHERE lower(username)')) {
        const u = s.users.find(x => x.username.toLowerCase() === String(params[0]).toLowerCase())
        return { rows: u ? [{ ok: 1 }] : [] }
      }
      if (text.includes('INSERT INTO aaelink.users')) {
        s.users.push({ id: params[0] as string, username: params[1] as string, email: params[2] as string })
        return { rows: [] }
      }
      if (text.includes('FROM aaelink.workspaces WHERE id')) {
        return { rows: s.workspaces.includes(params[0] as string) ? [{ ok: 1 }] : [] }
      }
      if (text.includes('INSERT INTO aaelink.workspace_members')) {
        s.members.push({ workspace_id: params[0] as string, user_id: params[1] as string, role: params[2] as string })
        return { rows: [] }
      }
      if (text.includes('INSERT INTO aaelink.sso_identity_links')) {
        s.links.push({ provider_id: params[0] as string, subject: params[1] as string, user_id: params[2] as string })
        return { rows: [] }
      }
      if (text.includes('INSERT INTO aaelink.sessions')) {
        s.sessions.push({ id: params[0] as string, user_id: params[1] as string, mfa_pending: params[6] as boolean })
        return { rows: [] }
      }
      return { rows: [] }
    },
  } as unknown as Pool
}

const cfg = (over: Partial<SsoProviderConfig> = {}): SsoProviderConfig => ({
  id: 'prov-1', name: 'Okta', type: 'oidc', issuer: 'https://idp', discoveryUrl: '',
  clientId: 'cid', scopes: 'openid', jitProvisioning: true, defaultRole: 'member',
  defaultWorkspaceId: 'ws-1', attributeMapping: {}, groupRoleMapping: {},
  samlEntryPoint: '', samlIdpCert: '', samlIdpCerts: [], samlAudience: '', isActive: true,
  enforceMfa: false, clientSecret: '',
  ...over,
})

const identity: MappedIdentity = {
  subject: 'okta|1', email: 'new@corp.com', firstName: 'New', lastName: 'User',
  displayName: 'New User', groups: [],
}
const meta = { ip: '1.2.3.4', userAgent: 'ua' }

describe('ssoProvision — loginViaSso', () => {
  let s: State
  beforeEach(() => {
    s = { links: [], users: [], workspaces: ['ws-1'], members: [], sessions: [] }
  })

  it('JIT-provisions a new user and adds workspace membership', async () => {
    const res = await loginViaSso(fakePool(s), cfg(), identity, meta)
    expect(res).not.toBeNull()
    expect(res!.provisioned).toBe(true)
    expect(s.users).toHaveLength(1)
    expect(s.sessions).toHaveLength(1)
    expect(s.members[0]).toMatchObject({ workspace_id: 'ws-1', role: 'member' })
    expect(s.links).toHaveLength(1)
  })

  it('links to an existing user by email instead of creating one', async () => {
    s.users.push({ id: 'existing-id', email: 'new@corp.com', username: 'existing' })
    const res = await loginViaSso(fakePool(s), cfg(), identity, meta)
    expect(res!.provisioned).toBe(false)
    expect(res!.userId).toBe('existing-id')
    expect(s.users).toHaveLength(1) // no new user
  })

  it('resolves a previously linked subject directly', async () => {
    s.users.push({ id: 'u-linked', email: 'old@corp.com', username: 'linked' })
    s.links.push({ provider_id: 'prov-1', subject: 'okta|1', user_id: 'u-linked' })
    const res = await loginViaSso(fakePool(s), cfg(), identity, meta)
    expect(res!.userId).toBe('u-linked')
    expect(res!.provisioned).toBe(false)
  })

  it('refuses to provision when JIT is disabled and no user exists', async () => {
    const res = await loginViaSso(fakePool(s), cfg({ jitProvisioning: false }), identity, meta)
    expect(res).toBeNull()
    expect(s.users).toHaveLength(0)
    expect(s.sessions).toHaveLength(0)
  })

  it('does not add membership when default workspace does not exist', async () => {
    s.workspaces = []
    const res = await loginViaSso(fakePool(s), cfg(), identity, meta)
    expect(res!.provisioned).toBe(true)
    expect(s.members).toHaveLength(0)
  })

  it('marks the session mfa_pending when the provider enforces MFA', async () => {
    const res = await loginViaSso(fakePool(s), cfg({ enforceMfa: true }), identity, meta)
    expect(res!.mfaPending).toBe(true)
    expect(s.sessions[0].mfa_pending).toBe(true)
  })

  it('does not gate the session when the provider does not enforce MFA', async () => {
    const res = await loginViaSso(fakePool(s), cfg(), identity, meta)
    expect(res!.mfaPending).toBe(false)
    expect(s.sessions[0].mfa_pending).toBe(false)
  })

  it('maps an IdP group to a guest workspace role (no escalation)', async () => {
    const guestIdentity = { ...identity, groups: ['contractors'] }
    const c = cfg({ groupRoleMapping: { contractors: 'guest', admins: 'admin' } })
    await loginViaSso(fakePool(s), c, guestIdentity, meta)
    expect(s.members[0].role).toBe('guest')
  })
})

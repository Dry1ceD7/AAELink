/**
 * AAELink — SAML assertion validation tests.
 *
 * Exercises the REAL @node-saml validation path against assertions signed by a
 * test IdP key (tests/helpers/samlFixtures): a valid assertion must pass and
 * yield mapped claims; tampered, expired, and wrong-audience assertions must be
 * rejected (signature / NotOnOrAfter / audience restriction).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { makeSamlFixture, type SamlFixture } from '@/tests/helpers/samlFixtures'
import { validateSamlResponse } from '@/lib/auth/ssoSamlClient'
import type { SsoProviderConfig } from '@/lib/auth/ssoProvider'

const CB = 'http://localhost:3000/api/auth/sso/saml/acs?provider=p1'
const AUD = 'sp-entity'

let fx: SamlFixture
beforeAll(() => { fx = makeSamlFixture() })

function cfg(): SsoProviderConfig {
  return {
    id: 'p1', name: 'SAML IdP', type: 'saml', issuer: '', discoveryUrl: '',
    clientId: '', scopes: '', jitProvisioning: true, defaultRole: 'member',
    defaultWorkspaceId: null, attributeMapping: {}, groupRoleMapping: {},
    samlEntryPoint: 'http://idp.test/sso', samlIdpCert: fx.idpCertPem, samlAudience: AUD,
    isActive: true, clientSecret: '',
  }
}

describe('ssoSamlClient — validateSamlResponse', () => {
  it('accepts a valid signed assertion and returns mapped claims', async () => {
    const resp = fx.signedResponseB64({ email: 'jane@corp.com', audience: AUD, recipient: CB })
    const out = await validateSamlResponse(cfg(), CB, resp)
    expect(out.claims.email).toBe('jane@corp.com')
    expect(out.claims.nameID).toBe('jane@corp.com')
  })

  it('rejects a tampered assertion (broken signature)', async () => {
    const resp = fx.signedResponseB64({ email: 'jane@corp.com', audience: AUD, recipient: CB, tamper: true })
    await expect(validateSamlResponse(cfg(), CB, resp)).rejects.toThrow()
  })

  it('rejects an expired assertion (NotOnOrAfter in the past)', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const resp = fx.signedResponseB64({
      email: 'jane@corp.com', audience: AUD, recipient: CB,
      notBefore: new Date(Date.now() - 2 * 60 * 60 * 1000), notOnOrAfter: past,
    })
    await expect(validateSamlResponse(cfg(), CB, resp)).rejects.toThrow()
  })

  it('rejects a wrong-audience assertion', async () => {
    const resp = fx.signedResponseB64({ email: 'jane@corp.com', audience: 'someone-else', recipient: CB })
    await expect(validateSamlResponse(cfg(), CB, resp)).rejects.toThrow()
  })

  it('surfaces InResponseTo for replay binding at the route layer', async () => {
    const resp = fx.signedResponseB64({ email: 'jane@corp.com', audience: AUD, recipient: CB, inResponseTo: 'req-123' })
    const out = await validateSamlResponse(cfg(), CB, resp)
    expect(out.inResponseTo).toBe('req-123')
  })
})

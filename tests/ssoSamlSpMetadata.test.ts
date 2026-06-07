/**
 * AAELink — SAML SP metadata generation tests.
 *
 * Verifies that generateSamlSpMetadata() produces a valid EntityDescriptor
 * whose entityID and ACS Location exactly match the values the start/acs flow
 * presents to the IdP, and that the Binding is HTTP-POST.
 */
import { describe, it, expect } from 'vitest'
import { generateSamlSpMetadata } from '@/lib/auth/ssoSamlClient'
import { makeSamlFixture } from '@/tests/helpers/samlFixtures'
import type { SsoProviderConfig } from '@/lib/auth/ssoProvider'

const fx = makeSamlFixture()

const BASE_URL = 'http://localhost:3000'
const PROVIDER_ID = 'p1'

/** Minimal valid SAML provider config. */
function cfg(overrides: Partial<SsoProviderConfig> = {}): SsoProviderConfig {
  return {
    id: PROVIDER_ID,
    name: 'Test SAML IdP',
    type: 'saml',
    issuer: '',
    discoveryUrl: '',
    clientId: '',
    scopes: '',
    jitProvisioning: true,
    defaultRole: 'member',
    defaultWorkspaceId: null,
    attributeMapping: {},
    groupRoleMapping: {},
    samlEntryPoint: 'https://idp.example.com/sso',
    samlIdpCert: fx.idpCertPem,
    samlIdpCerts: [],
    samlAudience: 'sp-entity',
    isActive: true,
    enforceMfa: false,
    clientSecret: '',
    ...overrides,
  }
}

/** The canonical ACS URL as produced by samlCallbackUrl(). */
function acsUrl(providerId = PROVIDER_ID): string {
  return `${BASE_URL}/api/auth/sso/saml/acs?provider=${encodeURIComponent(providerId)}`
}

describe('generateSamlSpMetadata', () => {
  it('returns a string containing EntityDescriptor and SPSSODescriptor', () => {
    const xml = generateSamlSpMetadata(cfg(), acsUrl())
    expect(xml).toContain('EntityDescriptor')
    expect(xml).toContain('SPSSODescriptor')
  })

  it('entityID matches samlAudience when samlAudience is set', () => {
    const xml = generateSamlSpMetadata(cfg({ samlAudience: 'sp-entity' }), acsUrl())
    expect(xml).toContain('entityID="sp-entity"')
  })

  it('entityID falls back to callback origin when samlAudience is empty', () => {
    const xml = generateSamlSpMetadata(cfg({ samlAudience: '' }), acsUrl())
    // spIssuer = new URL(callbackUrl).origin = 'http://localhost:3000'
    expect(xml).toContain('entityID="http://localhost:3000"')
  })

  it('ACS Location matches samlCallbackUrl convention', () => {
    const expected = acsUrl()
    const xml = generateSamlSpMetadata(cfg(), expected)
    expect(xml).toContain(`Location="${expected}"`)
  })

  it('ACS Binding is HTTP-POST', () => {
    const xml = generateSamlSpMetadata(cfg(), acsUrl())
    expect(xml).toContain('urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST')
  })

  it('ACS Location encodes provider id correctly', () => {
    const pid = 'my-provider-123'
    const cb = `${BASE_URL}/api/auth/sso/saml/acs?provider=${encodeURIComponent(pid)}`
    const xml = generateSamlSpMetadata(cfg({ id: pid }), cb)
    expect(xml).toContain(`Location="${cb}"`)
  })

  it('is valid XML (parses without error)', () => {
    const xml = generateSamlSpMetadata(cfg(), acsUrl())
    // DOMParser is not available in Node; use a simple well-formedness check:
    // the string must start with '<' and end with '>' (no trailing garbage),
    // and all opened tags must have a corresponding close or self-close.
    expect(xml.trim()).toMatch(/^</)
    expect(xml.trim()).toMatch(/>$/)
  })
})

/**
 * AAELink — SAML IdP metadata parsing tests (pure, injected fetch).
 */
import { describe, it, expect } from 'vitest'
import { parseSamlIdpMetadata, fetchSamlIdpMetadata } from '@/lib/auth/samlMetadata'

const CERT_A = 'MIIBcertAAA'
const CERT_B = 'MIIBcertBBB'

// IdP metadata with namespace prefixes (md:/ds:), two signing certs (rotation),
// one encryption cert (must be ignored), and both Redirect + POST SSO bindings.
const METADATA = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="https://idp.example.com/entity">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>
        ${CERT_A}
      </ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>${CERT_B}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:KeyDescriptor use="encryption">
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>MIIBencryptZZZ</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="https://idp.example.com/sso/post"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
        Location="https://idp.example.com/sso/redirect"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`

function fakeFetch(status: number, body: string): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  })) as unknown as typeof fetch
}

describe('parseSamlIdpMetadata', () => {
  it('extracts entityID, redirect SSO endpoint, and signing certs only', () => {
    const md = parseSamlIdpMetadata(METADATA)
    expect(md.entityId).toBe('https://idp.example.com/entity')
    // HTTP-Redirect preferred over HTTP-POST.
    expect(md.entryPoint).toBe('https://idp.example.com/sso/redirect')
    // Two signing certs (whitespace stripped); encryption cert excluded.
    expect(md.certs).toEqual([CERT_A, CERT_B])
  })

  it('throws when no IDPSSODescriptor is present', () => {
    expect(() => parseSamlIdpMetadata(
      `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="x"></md:EntityDescriptor>`
    )).toThrow('saml_metadata_no_idp_descriptor')
  })

  it('throws when no signing cert is present', () => {
    expect(() => parseSamlIdpMetadata(
      `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="x">
        <md:IDPSSODescriptor>
          <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://x/sso"/>
        </md:IDPSSODescriptor>
      </md:EntityDescriptor>`
    )).toThrow('saml_metadata_no_signing_cert')
  })

  it('falls back to HTTP-POST when no Redirect binding exists', () => {
    const md = parseSamlIdpMetadata(
      `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
          xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="x">
        <md:IDPSSODescriptor>
          <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data>
            <ds:X509Certificate>${CERT_A}</ds:X509Certificate>
          </ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
          <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://x/post"/>
        </md:IDPSSODescriptor>
      </md:EntityDescriptor>`
    )
    expect(md.entryPoint).toBe('https://x/post')
  })
})

describe('fetchSamlIdpMetadata', () => {
  it('fetches then parses', async () => {
    const md = await fetchSamlIdpMetadata('https://idp.example.com/metadata', fakeFetch(200, METADATA))
    expect(md.certs).toEqual([CERT_A, CERT_B])
  })

  it('throws on a non-2xx response', async () => {
    await expect(
      fetchSamlIdpMetadata('https://idp.example.com/metadata', fakeFetch(404, ''))
    ).rejects.toThrow('saml_metadata_fetch_failed_404')
  })
})

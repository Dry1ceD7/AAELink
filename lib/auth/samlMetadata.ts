import { XMLParser } from 'fast-xml-parser'

/**
 * SAML 2.0 IdP metadata parsing + fetch.
 *
 * @node-saml/node-saml ships an SP-metadata *generator* but no IdP-metadata
 * *parser*, so we parse the EntityDescriptor ourselves with fast-xml-parser
 * (ADR 0015). We extract the entityID, the SingleSignOnService endpoint
 * (preferring HTTP-Redirect), and ALL `use="signing"` X509 certificates — the
 * full set lets node-saml validate across an IdP key rollover (cert rotation).
 */

const BINDING_REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect'
const BINDING_POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST'

export interface SamlIdpMetadata {
  /** IdP entityID (used as the expected SAML issuer). */
  entityId: string
  /** IdP SingleSignOnService Location the SP redirects to. */
  entryPoint: string
  /** All signing X509 certificates (base64 bodies, deduped). */
  certs: string[]
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

/** Strip PEM armor + all whitespace, leaving the bare base64 body. */
function normalizeCert(raw: unknown): string {
  return String(raw ?? '')
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
    .trim()
}

/** Collect signing certs from one or many KeyDescriptor nodes (use="signing" or unspecified). */
function collectSigningCerts(keyDescriptors: unknown): string[] {
  const out: string[] = []
  for (const kd of asArray(keyDescriptors) as Array<Record<string, unknown>>) {
    const use = String(kd?.['@_use'] ?? '')
    // Per spec, a KeyDescriptor with no `use` is valid for both signing+encryption.
    if (use && use !== 'signing') continue
    const keyInfo = kd?.KeyInfo as Record<string, unknown> | undefined
    const x509Data = keyInfo?.X509Data as Record<string, unknown> | undefined
    for (const cert of asArray(x509Data?.X509Certificate)) {
      const norm = normalizeCert(cert)
      if (norm && !out.includes(norm)) out.push(norm)
    }
  }
  return out
}

/** Pick the SSO endpoint, preferring HTTP-Redirect, then HTTP-POST, then any. */
function pickSsoLocation(ssoServices: unknown): string {
  const services = asArray(ssoServices) as Array<Record<string, unknown>>
  const byBinding = (b: string) =>
    services.find(s => String(s?.['@_Binding'] ?? '') === b)
  const chosen = byBinding(BINDING_REDIRECT) || byBinding(BINDING_POST) || services[0]
  return String(chosen?.['@_Location'] ?? '')
}

/**
 * Parse a SAML IdP metadata XML document. Throws a specific error code when a
 * required piece (EntityDescriptor, IDPSSODescriptor, signing cert, SSO
 * endpoint) is missing so callers can surface a precise failure.
 */
export function parseSamlIdpMetadata(xml: string): SamlIdpMetadata {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  })
  const doc = parser.parse(xml) as Record<string, unknown>

  // An EntitiesDescriptor (federation) wraps one or more EntityDescriptors.
  const entities = doc.EntitiesDescriptor as Record<string, unknown> | undefined
  const ed = (entities?.EntityDescriptor ?? doc.EntityDescriptor) as
    | Record<string, unknown>
    | Array<Record<string, unknown>>
    | undefined
  const entity = (asArray(ed).find(e => (e as Record<string, unknown>).IDPSSODescriptor) ??
    asArray(ed)[0]) as Record<string, unknown> | undefined
  if (!entity) throw new Error('saml_metadata_no_entity_descriptor')

  const idp = entity.IDPSSODescriptor as Record<string, unknown> | undefined
  if (!idp) throw new Error('saml_metadata_no_idp_descriptor')

  const certs = collectSigningCerts(idp.KeyDescriptor)
  if (certs.length === 0) throw new Error('saml_metadata_no_signing_cert')

  const entryPoint = pickSsoLocation(idp.SingleSignOnService)
  if (!entryPoint) throw new Error('saml_metadata_no_sso_endpoint')

  return { entityId: String(entity['@_entityID'] ?? ''), entryPoint, certs }
}

/**
 * Fetch an IdP metadata URL and parse it. `fetchImpl` is injectable for tests.
 * Throws `saml_metadata_fetch_failed_<status>` on a non-2xx response.
 */
export async function fetchSamlIdpMetadata(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SamlIdpMetadata> {
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/samlmetadata+xml, application/xml, text/xml' },
  })
  if (!res.ok) throw new Error(`saml_metadata_fetch_failed_${res.status}`)
  return parseSamlIdpMetadata(await res.text())
}

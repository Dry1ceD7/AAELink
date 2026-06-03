import { generateKeyPairSync, createSign, randomUUID, type KeyObject } from 'crypto'
import { SignedXml } from 'xml-crypto'

/**
 * Test-only SAML fixture generator.
 *
 * Produces a self-signed IdP key/cert and signs a SAML Response assertion with
 * it, so tests can exercise the REAL @node-saml signature/audience/timing
 * validation path (no mocking of the security core). Lets us assert that a valid
 * assertion passes and that tampered / expired ones are rejected.
 */

export interface SamlFixture {
  idpCertPem: string // base64 body only (node-saml accepts cert string)
  signedResponseB64: (opts: BuildOpts) => string
}

interface BuildOpts {
  email: string
  nameId?: string
  audience: string
  recipient: string // ACS URL
  notBefore?: Date
  notOnOrAfter?: Date
  tamper?: boolean
  inResponseTo?: string
}

function selfSignedCert(): { privateKey: string; certB64: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pubDer = publicKey.export({ type: 'spki', format: 'der' })
  // Minimal X.509 self-sign: build a TBS-less placeholder is non-trivial, so we
  // instead emit a real cert via a tiny DER assembly using the public key only.
  // node-saml only needs the cert's public key to verify, so we wrap the SPKI
  // public key in a PEM CERTIFICATE block produced by a quick self-sign.
  const cert = makeCert(privateKey, pubDer)
  return { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, certB64: cert }
}

// Build a minimal but valid self-signed X.509 cert (DER) and return base64 body.
function makeCert(privateKey: KeyObject, spkiDer: Buffer): string {
  // Construct TBSCertificate manually is heavy; instead use a fixed template.
  // We assemble: SEQUENCE { tbs, sigAlg, sigBitString }. tbs embeds the SPKI.
  const serial = Buffer.from([0x02, 0x01, 0x01])
  const sigAlg = der(0x30, Buffer.concat([oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00])]))
  const validity = der(0x30, Buffer.concat([
    utcTime('20200101000000Z'), utcTime('20400101000000Z'),
  ]))
  const name = der(0x30, der(0x31, der(0x30, Buffer.concat([
    oid('2.5.4.3'), der(0x13, Buffer.from('AAELink Test IdP')),
  ]))))
  const version = der(0xa0, der(0x02, Buffer.from([0x02])))
  const tbs = der(0x30, Buffer.concat([version, serial, sigAlg, name, validity, name, spkiDer]))
  const signer = createSign('RSA-SHA256')
  signer.update(tbs)
  const sig = signer.sign(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string)
  const sigBits = der(0x03, Buffer.concat([Buffer.from([0x00]), sig]))
  const cert = der(0x30, Buffer.concat([tbs, sigAlg, sigBits]))
  return cert.toString('base64')
}

function der(tag: number, content: Buffer): Buffer {
  const len = content.length
  let lenBuf: Buffer
  if (len < 0x80) lenBuf = Buffer.from([len])
  else {
    const bytes: number[] = []
    let n = len
    while (n > 0) { bytes.unshift(n & 0xff); n >>= 8 }
    lenBuf = Buffer.from([0x80 | bytes.length, ...bytes])
  }
  return Buffer.concat([Buffer.from([tag]), lenBuf, content])
}
function oid(s: string): Buffer {
  const parts = s.split('.').map(Number)
  const first = 40 * parts[0] + parts[1]
  const bytes: number[] = [first]
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i]
    const stack: number[] = [v & 0x7f]
    v >>= 7
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>= 7 }
    bytes.push(...stack)
  }
  return der(0x06, Buffer.from(bytes))
}
function utcTime(s: string): Buffer { return der(0x17, Buffer.from(s)) }

function iso(d: Date): string { return d.toISOString().replace(/\.\d+Z$/, 'Z') }

export function makeSamlFixture(): SamlFixture {
  const { privateKey, certB64 } = selfSignedCert()
  return {
    idpCertPem: certB64,
    signedResponseB64(opts: BuildOpts): string {
      const now = new Date()
      const nb = iso(opts.notBefore ?? new Date(now.getTime() - 60_000))
      const noa = iso(opts.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000))
      const assertionId = `_${randomUUID()}`
      const respId = `_${randomUUID()}`
      const nameId = opts.nameId ?? opts.email
      const irt = opts.inResponseTo ? ` InResponseTo="${opts.inResponseTo}"` : ''
      const assertion =
        `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${iso(now)}">` +
        `<saml:Issuer>http://idp.test</saml:Issuer>` +
        `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${nameId}</saml:NameID>` +
        `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
        `<saml:SubjectConfirmationData${irt} NotOnOrAfter="${noa}" Recipient="${opts.recipient}"/></saml:SubjectConfirmation></saml:Subject>` +
        `<saml:Conditions NotBefore="${nb}" NotOnOrAfter="${noa}">` +
        `<saml:AudienceRestriction><saml:Audience>${opts.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
        `<saml:AttributeStatement>` +
        `<saml:Attribute Name="email"><saml:AttributeValue>${opts.email}</saml:AttributeValue></saml:Attribute>` +
        `</saml:AttributeStatement></saml:Assertion>`

      const sig = new SignedXml({ privateKey })
      sig.addReference({
        xpath: `//*[local-name(.)='Assertion']`,
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        transforms: [
          'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
          'http://www.w3.org/2001/10/xml-exc-c14n#',
        ],
      })
      sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
      sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#'
      sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`
      sig.computeSignature(assertion, {
        location: { reference: `//*[local-name(.)='Issuer']`, action: 'after' },
      })
      let signedAssertion = sig.getSignedXml()
      if (opts.tamper) {
        signedAssertion = signedAssertion.replace(opts.email, `attacker@evil.com`)
      }

      const response =
        `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${respId}"${irt} Version="2.0" IssueInstant="${iso(now)}" Destination="${opts.recipient}">` +
        `<saml:Issuer>http://idp.test</saml:Issuer>` +
        `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
        signedAssertion + `</samlp:Response>`
      return Buffer.from(response, 'utf8').toString('base64')
    },
  }
}

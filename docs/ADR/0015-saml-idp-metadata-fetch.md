# 0015. SAML IdP metadata fetch + signing-cert rotation

- Status: Accepted
- Date: 2026-06-03
- Deciders: Platform / Identity

## Context

Inbound SAML (ADR [0014](0014-inbound-sso-relying-party.md)) required an admin to
paste the IdP's `saml_entry_point` and a single `saml_idp_cert` by hand. The
`sso_providers.metadata_url` column existed and the admin route's validation
comment already promised "configure EITHER via an IdP metadata_url
(auto-discovers the entry point + signing cert) OR via the explicit pair" — but
no code ever fetched or parsed metadata.

Two real-world gaps followed:
1. **No metadata discovery.** Every IdP (Okta, Entra ID, ADFS, OneLogin)
   publishes a standard SAML 2.0 metadata XML document at a URL. Manual entry is
   error-prone and drifts.
2. **No cert rotation.** IdPs routinely publish *multiple* signing certificates
   during a key rollover. A single `saml_idp_cert` string cannot represent that,
   so a rotation breaks every login until an admin re-pastes the new cert.

## Decision

1. **Add `fast-xml-parser` as a direct dependency** (already present transitively
   via `@node-saml/node-saml`; pinned `^5.7.2`). `@node-saml/node-saml` exposes
   only an SP-metadata *generator*, not an IdP-metadata *parser*, so we need a
   small XML parser. `fast-xml-parser` is dependency-free, non-DOM, and already
   resolved in the tree. A hand-rolled regex parser was rejected as fragile.

2. **`lib/auth/samlMetadata.ts`** — `parseSamlIdpMetadata(xml)` extracts the
   entityID, the HTTP-Redirect (fallback HTTP-POST) SingleSignOnService Location,
   and **all** `use="signing"` X509 certificates. `fetchSamlIdpMetadata(url)`
   fetches then parses (fetch impl injectable for tests).

3. **Migration 026** adds `sso_providers.saml_idp_certs JSONB DEFAULT '[]'` — the
   full signing-cert set. The legacy single `saml_idp_cert` is retained (first
   cert) for back-compat and display. `node-saml`'s `idpCert` accepts an array,
   so `buildSaml` passes the whole set: a token signed by *any* current IdP
   signing key validates. This is the rotation mechanism.

4. **Admin POST** auto-populates entry point + certs from `metadata_url` when
   given. **New `POST /api/auth/sso/saml/refresh`** re-fetches a provider's
   metadata to pick up rotated certs without re-creating the provider.

## Consequences

- An admin can configure SAML with only a name + metadata_url.
- A mid-rollover IdP that advertises old+new signing certs keeps working; an
  admin hits refresh to drop the retired key.
- New direct dep `fast-xml-parser` — already in the lockfile transitively, so no
  new install surface; the daily `bun update --latest` keeps it current.
- Metadata fetch is outbound HTTP from the server; failures surface as a
  `saml_metadata_fetch_failed` 400 rather than silently saving a half-config.

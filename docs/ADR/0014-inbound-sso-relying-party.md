# ADR 0014 — Inbound SSO (Relying Party): openid-client + @node-saml/node-saml

- Status: Accepted
- Date: 2026-06-03
- Context: Enterprise parity gap #2 — users could not log in via an external IdP.

## Context

Prior to this change, `app/api/auth/sso/route.ts` only persisted IdP *config*
rows, and `app/api/auth/openid/route.ts` made AAELink an OpenID *provider*
(issuing tokens to clients), not a relying party. There was no way for a user to
sign in to AAELink using Okta / Azure AD / Google / a generic OIDC or SAML IdP.
The legacy `app/api/auth/entra/route.ts` did a hand-rolled OAuth2 code exchange
with **no** state validation, **no** id_token signature verification, **no**
nonce, and **no** workspace assignment — unsafe to generalize.

This ADR adds a real inbound SSO Relying Party for both OIDC and SAML.

## Decision

Two new top-level dependencies (per project rule #7, recorded here):

### 1. `openid-client@6` — OIDC Relying Party

- **Why:** It is the de-facto standard, actively maintained, certified OpenID
  Connect RP library for Node. It performs the security-critical steps we must
  not hand-roll: discovery, PKCE, and id_token verification against the IdP
  **JWKS** including issuer / audience / expiry / nonce / state checks.
- **Alternatives considered:**
  - Hand-rolled fetch + `jose` (what `entra/route.ts` approximates): rejected —
    re-implementing JWKS rotation, PKCE, and the full set of OIDC response
    checks is exactly the class of code where auth bugs hide.
  - `passport` + `passport-openidconnect`: rejected — Passport's session/strategy
    model doesn't fit Next.js App Router route handlers, and the underlying lib
    is the same `openid-client`. We use its functional API directly.
- **Security considerations:** v6's functional API verifies the id_token
  signature against the discovered JWKS; we pass `expectedState`,
  `expectedNonce`, and the `pkceCodeVerifier` so state/nonce/PKCE are all
  enforced inside the library. Discovered `Configuration` objects are cached per
  issuer (1h) to avoid per-request metadata/JWKS fetches.

### 2. `@node-saml/node-saml@5` — SAML SP / ACS

- **Why:** Maintained successor to `node-saml`/`passport-saml`'s core. It
  validates the assertion's XML signature against the IdP certificate, the
  audience restriction, and the `NotBefore`/`NotOnOrAfter` conditions — the
  security core of SAML that must not be hand-implemented.
- **Alternatives considered:**
  - `samlify`: rejected — heavier, and historically more signature-validation
    CVEs/foot-guns around canonicalization.
  - Hand-rolled XML-DSig: rejected outright — SAML signature wrapping attacks are
    notoriously easy to get wrong.
- **Security considerations:** We set `wantAssertionsSigned: true` and a fixed
  `audience`. We disable node-saml's own `validateInResponseTo` cache
  (`'never'`) because our `aaelink.sso_auth_requests` table is the cross-process
  source of truth for outstanding request IDs; the ACS route enforces
  `InResponseTo === our request id` explicitly, plus single-use RelayState
  redemption for replay protection.

## Secret storage

The existing `sso_providers` table stored only a truncated, non-recoverable
`client_secret_hash`, which cannot perform the OIDC code exchange. We add a
recoverable `client_secret_enc` column holding an **AES-256-GCM** ciphertext
(`lib/auth/ssoSecretCrypto.ts`), keyed by `AAELINK_SSO_SECRET_KEY` (falling back
to `AAELINK_SESSION_SECRET`). Plaintext secrets are never stored or logged. The
config route refuses to save an OIDC provider when no key is configured.

## Consequences

- New env var: `AAELINK_SSO_SECRET_KEY` (optional; falls back to the session
  secret). Must be set in prod for OIDC providers.
- New schema (migration `022_inbound_sso`): recoverable secret + discovery/SAML
  columns on `sso_providers`, plus `sso_auth_requests` (in-flight state) and
  `sso_identity_links` (IdP subject → user) tables.
- JIT-provisioned users get `platform_role = 'employee'` (never admin) and a
  clamped `member`/`guest` workspace role; group→role mapping cannot escalate.

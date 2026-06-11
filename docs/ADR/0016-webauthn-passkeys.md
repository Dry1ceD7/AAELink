# 0016. WebAuthn / passkeys as an MFA factor

- Status: Accepted
- Date: 2026-06-03
- Deciders: Platform / Identity

## Context

MFA was TOTP-only (ADR [0015](0015-saml-idp-metadata-fetch.md) context, D2
Identity). Slack/Okta-grade parity expects phishing-resistant **passkeys**
(WebAuthn / FIDO2) as a first-class second factor. Implementing the WebAuthn
ceremonies (attestation/assertion parsing, COSE key handling, signature
verification, replay-counter checks) by hand is infeasible and unsafe.

## Decision

1. **Add `@simplewebauthn/server` (^13.3.1) as a direct dependency.** It is the
   de-facto WebAuthn RP library for Node, actively maintained, dependency-light,
   and does the security-critical verification. Hand-rolling was rejected.

2. **Two tables (migration 027):**
   - `webauthn_credentials` — one row per registered passkey: `credential_id`
     (base64url, unique), `public_key` (base64), `counter`, `transports`,
     `device_type`, `backed_up`, `name`, timestamps.
   - `webauthn_challenges` — short-lived per-user challenge bound by
     `(user_id, kind)`; issued on `begin`, consumed on `finish`. The session
     identifies the user, so no challenge cookie is needed.

3. **`lib/auth/webauthn.ts`** wraps the four library calls + challenge/credential
   storage. RP config (`rpID`, `rpName`, `origin`) derives from
   `NEXT_PUBLIC_APP_URL`.

4. **Routes:**
   - `POST /api/auth/webauthn/register` (`begin`/`finish`, + `GET` list,
     `DELETE`) — enrol a passkey; requires a fully-authenticated session.
   - `POST /api/auth/webauthn/authenticate` (`begin`/`finish`) — passkey
     **MFA step-up**: requires an `mfa_pending` session (ADR 0015), clears it on
     a verified assertion. Passkeys thus join TOTP as a step-up factor.

## Consequences

- Users can register passkeys and use them to satisfy MFA step-up after SSO.
- The cryptographic verification is library-trusted; our tests cover the wiring
  (challenge issue/consume, credential persistence, counter update, route
  guards) with the library mocked, since fabricating a real authenticator
  attestation in a unit test is impractical.
- New direct dep `@simplewebauthn/server`; the daily `bun update --latest` keeps
  it current.
- Passwordless **discoverable-credential login** (no prior session) is out of
  scope here — this ADR covers enrolment + step-up only.

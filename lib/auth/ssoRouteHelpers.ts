import { NextResponse } from 'next/server'

/**
 * Shared helpers for the inbound SSO routes: client metadata extraction,
 * the canonical callback/login URLs, and a generic failure redirect.
 *
 * Security note: all auth failures funnel through `ssoFailure`, which emits the
 * SAME generic `/login?error=sso_failed` redirect regardless of cause (unknown
 * provider, bad state, bad signature, expired assertion). This avoids handing an
 * attacker an oracle that distinguishes failure modes.
 */

export function clientMeta(req: Request): { ip: string; userAgent: string } {
  const h = (n: string) => req.headers.get(n)?.split(',')[0]?.trim() || ''
  return {
    ip: h('x-forwarded-for') || h('x-real-ip') || '127.0.0.1',
    userAgent: req.headers.get('user-agent') || '',
  }
}

export function appOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  return new URL(req.url).origin
}

export function oidcCallbackUrl(req: Request, providerId: string): string {
  return `${appOrigin(req)}/api/auth/sso/oidc/callback?provider=${encodeURIComponent(providerId)}`
}

export function samlCallbackUrl(req: Request, providerId: string): string {
  return `${appOrigin(req)}/api/auth/sso/saml/acs?provider=${encodeURIComponent(providerId)}`
}

/** Generic, cause-agnostic failure redirect. */
export function ssoFailure(req: Request): NextResponse {
  return NextResponse.redirect(new URL('/login?error=sso_failed', appOrigin(req)))
}

export function ssoSuccess(req: Request): NextResponse {
  return NextResponse.redirect(new URL('/home', appOrigin(req)))
}

/**
 * Redirect for a login that succeeded but whose provider enforces MFA: the
 * session cookie is set but `mfa_pending`, so the user lands on the step-up
 * challenge rather than /home.
 */
export function ssoStepUp(req: Request): NextResponse {
  return NextResponse.redirect(new URL('/login?mfa=stepup', appOrigin(req)))
}

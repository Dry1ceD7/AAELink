/**
 * Branded HTML Email Template Engine for AAELink.
 *
 * Provides pre-built templates for all transactional email types.
 * Uses inline CSS for maximum email client compatibility.
 *
 * Usage:
 *   import { renderEmail } from '@/lib/comms/emailTemplates'
 *   const html = renderEmail('welcome', { username: 'Alice', loginUrl: '...' })
 */

// ── Brand Constants ──────────────────────────────────────────────────

const BRAND = {
  name: 'AAELink',
  company: 'Advanced ID Asia Engineering Co.,Ltd',
  color: '#1e63b3',
  darkColor: '#0a2342',
  accentColor: '#00d4aa',
  textColor: '#1a1a2e',
  mutedColor: '#6b7280',
  bgColor: '#f3f4f6',
  cardBg: '#ffffff',
  logoUrl: '', // Set via env or use text fallback
  supportEmail: 'it@aae.co.th',
}

// ── Base Layout ──────────────────────────────────────────────────────

function baseLayout(title: string, body: string, preheader: string = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bgColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escHtml(preheader)}</div>` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:${BRAND.bgColor};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding:0 0 32px;">
              <div style="font-size:28px;font-weight:700;color:${BRAND.color};letter-spacing:-0.5px;">
                ◆ ${BRAND.name}
              </div>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background:${BRAND.cardBg};border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);padding:40px 32px;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding:32px 0 0;">
              <p style="margin:0;font-size:12px;color:${BRAND.mutedColor};line-height:1.6;">
                ${BRAND.company}<br>
                This email was sent by ${BRAND.name}. If you didn't expect this email, please contact
                <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.color};text-decoration:none;">${BRAND.supportEmail}</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── Helpers ───────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buttonHtml(text: string, url: string, color = BRAND.color): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
    <tr>
      <td align="center" style="background:${color};border-radius:8px;">
        <a href="${escHtml(url)}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;letter-spacing:0.3px;">${escHtml(text)}</a>
      </td>
    </tr>
  </table>`
}

function headingHtml(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:${BRAND.textColor};line-height:1.3;">${escHtml(text)}</h1>`
}

function paragraphHtml(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:${BRAND.textColor};line-height:1.6;">${text}</p>`
}

function codeBlockHtml(code: string): string {
  return `<div style="background:#f0f0f5;border-radius:8px;padding:16px 20px;margin:16px 0;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:24px;letter-spacing:6px;text-align:center;color:${BRAND.darkColor};font-weight:700;">${escHtml(code)}</div>`
}

function dividerHtml(): string {
  return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">`
}

// ── Template Definitions ─────────────────────────────────────────────

interface TemplateVars {
  [key: string]: string | number | boolean | undefined
}

const templates: Record<string, (vars: TemplateVars) => { subject: string; html: string }> = {

  // ── Welcome ────────────────────────────────────────────────────────
  welcome: (vars) => {
    const { username, loginUrl } = vars as { username: string; loginUrl: string }
    return {
      subject: `Welcome to ${BRAND.name}!`,
      html: baseLayout(`Welcome to ${BRAND.name}`, [
        headingHtml(`Welcome to ${BRAND.name}! 🎉`),
        paragraphHtml(`Hi <strong>${escHtml(String(username))}</strong>, your account has been created and is ready to use.`),
        paragraphHtml(`${BRAND.name} is your team's enterprise communication platform — messaging, channels, files, and more, all in one place.`),
        buttonHtml('Sign In to AAELink', String(loginUrl)),
        dividerHtml(),
        paragraphHtml(`<span style="color:${BRAND.mutedColor};font-size:13px;">If you have questions, reach out to your IT administrator or reply to this email.</span>`),
      ].join(''), 'Your AAELink account is ready'),
    }
  },

  // ── MFA Enrollment ─────────────────────────────────────────────────
  mfa_enrolled: (vars) => {
    const { username, method } = vars as { username: string; method: string }
    return {
      subject: `MFA Enabled on ${BRAND.name}`,
      html: baseLayout('MFA Enabled', [
        headingHtml('Two-Factor Authentication Enabled 🔐'),
        paragraphHtml(`Hi <strong>${escHtml(String(username))}</strong>, multi-factor authentication (<strong>${escHtml(String(method).toUpperCase())}</strong>) has been successfully enabled on your account.`),
        paragraphHtml('From now on, you\'ll need to provide a verification code when signing in. This adds an extra layer of security to your account.'),
        dividerHtml(),
        paragraphHtml(`<span style="color:${BRAND.mutedColor};font-size:13px;">⚠️ If you did not enable MFA, please contact IT immediately at <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.color};">${BRAND.supportEmail}</a>.</span>`),
      ].join('')),
    }
  },

  // ── Password Reset ─────────────────────────────────────────────────
  password_reset: (vars) => {
    const { username, resetUrl, expiresIn } = vars as { username: string; resetUrl: string; expiresIn: string }
    return {
      subject: `Reset your ${BRAND.name} password`,
      html: baseLayout('Password Reset', [
        headingHtml('Password Reset Request'),
        paragraphHtml(`Hi <strong>${escHtml(String(username))}</strong>, we received a request to reset your password.`),
        buttonHtml('Reset Password', String(resetUrl)),
        paragraphHtml(`This link will expire in <strong>${escHtml(String(expiresIn || '1 hour'))}</strong>. If you didn't request this, you can safely ignore this email.`),
        dividerHtml(),
        paragraphHtml(`<span style="color:${BRAND.mutedColor};font-size:13px;">For security, this request was received from your account. If you didn't make this request, please secure your account immediately.</span>`),
      ].join(''), 'Reset your AAELink password'),
    }
  },

  // ── Workspace Invite ───────────────────────────────────────────────
  invite: (vars) => {
    const { inviterName, workspaceName, inviteUrl } = vars as {
      inviterName: string; workspaceName: string; inviteUrl: string
    }
    return {
      subject: `${inviterName} invited you to ${workspaceName} on ${BRAND.name}`,
      html: baseLayout('Workspace Invitation', [
        headingHtml(`You've been invited! 🤝`),
        paragraphHtml(`<strong>${escHtml(String(inviterName))}</strong> has invited you to join <strong>${escHtml(String(workspaceName))}</strong> on ${BRAND.name}.`),
        paragraphHtml(`Join your team to start messaging, collaborating, and getting work done together.`),
        buttonHtml('Accept Invitation', String(inviteUrl), BRAND.accentColor),
        dividerHtml(),
        paragraphHtml(`<span style="color:${BRAND.mutedColor};font-size:13px;">This invitation link expires in 7 days.</span>`),
      ].join(''), `Join ${workspaceName} on AAELink`),
    }
  },

  // ── Notification Digest ────────────────────────────────────────────
  digest: (vars) => {
    const { username, unreadChannels, unreadDMs, mentionCount, loginUrl } = vars as {
      username: string; unreadChannels: number; unreadDMs: number; mentionCount: number; loginUrl: string
    }
    return {
      subject: `Your ${BRAND.name} digest — ${mentionCount} mention${Number(mentionCount) !== 1 ? 's' : ''}`,
      html: baseLayout('Notification Digest', [
        headingHtml(`Here's what you missed 📬`),
        paragraphHtml(`Hi <strong>${escHtml(String(username))}</strong>, here's your activity summary:`),
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0;">
          <tr>
            <td style="padding:12px 16px;background:#f0f7ff;border-radius:8px 8px 0 0;border-bottom:1px solid #e5e7eb;">
              <strong style="color:${BRAND.color};">${unreadChannels}</strong>
              <span style="color:${BRAND.textColor};font-size:14px;margin-left:8px;">unread channel${Number(unreadChannels) !== 1 ? 's' : ''}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 16px;background:#f0f7ff;border-bottom:1px solid #e5e7eb;">
              <strong style="color:${BRAND.color};">${unreadDMs}</strong>
              <span style="color:${BRAND.textColor};font-size:14px;margin-left:8px;">direct message${Number(unreadDMs) !== 1 ? 's' : ''}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 16px;background:#f0f7ff;border-radius:0 0 8px 8px;">
              <strong style="color:${BRAND.color};">${mentionCount}</strong>
              <span style="color:${BRAND.textColor};font-size:14px;margin-left:8px;">mention${Number(mentionCount) !== 1 ? 's' : ''}</span>
            </td>
          </tr>
        </table>`,
        buttonHtml('Open AAELink', String(loginUrl)),
      ].join('')),
    }
  },

  // ── Legal Hold Notice ──────────────────────────────────────────────
  legal_hold: (vars) => {
    const { username, holdName, startDate } = vars as { username: string; holdName: string; startDate: string }
    return {
      subject: `[Legal Hold] You have been placed on a hold — ${BRAND.name}`,
      html: baseLayout('Legal Hold Notice', [
        headingHtml('Legal Hold Notice ⚖️'),
        paragraphHtml(`Dear <strong>${escHtml(String(username))}</strong>,`),
        paragraphHtml(`You have been placed on a legal hold: <strong>${escHtml(String(holdName))}</strong>, effective ${escHtml(String(startDate))}.`),
        `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;border-radius:0 8px 8px 0;margin:16px 0;">
          <p style="margin:0;font-size:14px;color:#92400e;font-weight:600;">Important: Do not delete any messages, files, or data.</p>
          <p style="margin:8px 0 0;font-size:13px;color:#92400e;">All your communications are being preserved per legal requirements. Continue using ${BRAND.name} normally, but do not attempt to delete or modify historical content.</p>
        </div>`,
        dividerHtml(),
        paragraphHtml(`<span style="color:${BRAND.mutedColor};font-size:13px;">If you have questions about this hold, please contact your legal department.</span>`),
      ].join('')),
    }
  },

  // ── OTP / Verification Code ────────────────────────────────────────
  otp: (vars) => {
    const { username, code, expiresIn } = vars as { username: string; code: string; expiresIn: string }
    return {
      subject: `Your ${BRAND.name} verification code`,
      html: baseLayout('Verification Code', [
        headingHtml('Your Verification Code'),
        paragraphHtml(`Hi <strong>${escHtml(String(username))}</strong>, use the code below to verify your identity:`),
        codeBlockHtml(String(code)),
        paragraphHtml(`This code expires in <strong>${escHtml(String(expiresIn || '10 minutes'))}</strong>. Do not share this code with anyone.`),
        dividerHtml(),
        paragraphHtml(`<span style="color:${BRAND.mutedColor};font-size:13px;">If you didn't request this code, your account may be at risk. Contact IT immediately.</span>`),
      ].join(''), `Your code: ${code}`),
    }
  },

  // ── Device Login Alert ─────────────────────────────────────────────
  new_device_login: (vars) => {
    const { username, deviceName, ipAddress, location, loginTime } = vars as {
      username: string; deviceName: string; ipAddress: string; location: string; loginTime: string
    }
    return {
      subject: `New sign-in to ${BRAND.name} from ${deviceName}`,
      html: baseLayout('New Device Login', [
        headingHtml('New Sign-In Detected 🔔'),
        paragraphHtml(`Hi <strong>${escHtml(String(username))}</strong>, a new sign-in to your account was detected:`),
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0;background:#f8fafc;border-radius:8px;padding:16px;">
          <tr><td style="padding:8px 16px;font-size:14px;"><strong>Device:</strong> ${escHtml(String(deviceName))}</td></tr>
          <tr><td style="padding:8px 16px;font-size:14px;"><strong>IP Address:</strong> ${escHtml(String(ipAddress))}</td></tr>
          <tr><td style="padding:8px 16px;font-size:14px;"><strong>Location:</strong> ${escHtml(String(location || 'Unknown'))}</td></tr>
          <tr><td style="padding:8px 16px;font-size:14px;"><strong>Time:</strong> ${escHtml(String(loginTime))}</td></tr>
        </table>`,
        paragraphHtml(`If this was you, no action is needed. If you don't recognize this sign-in, please secure your account immediately.`),
      ].join(''), `New sign-in from ${deviceName}`),
    }
  },
}

// ── Public API ────────────────────────────────────────────────────────

export type EmailTemplate = keyof typeof templates

/**
 * Render a branded HTML email from a template.
 *
 * @param template - Template name (welcome, mfa_enrolled, password_reset, etc.)
 * @param vars - Template variables
 * @returns { subject, html } ready for sending
 */
export function renderEmail(
  template: EmailTemplate,
  vars: TemplateVars
): { subject: string; html: string } {
  const fn = templates[template]
  if (!fn) throw new Error(`Unknown email template: ${template}`)
  return fn(vars)
}

/** List all available template names */
export function listEmailTemplates(): EmailTemplate[] {
  return Object.keys(templates) as EmailTemplate[]
}

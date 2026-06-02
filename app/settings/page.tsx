import { redirect } from 'next/navigation'

/**
 * Legacy `/settings` route.
 *
 * AAELink consolidated to a single Preferences modal in v0.0.23 to match
 * Slack's UX. This route now redirects to `/home?prefs=1` which auto-opens
 * the modal on the home page.
 */
export default function SettingsRedirect() {
  redirect('/home?prefs=1')
}

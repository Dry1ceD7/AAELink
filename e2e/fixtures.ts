/* eslint-disable react-hooks/rules-of-hooks -- `use(page)` here is a Playwright fixture continuation, not React's use() hook */
import { test as base, type Page } from '@playwright/test'

/* ─────────────────────────────────────────────────────────────────────
   E2E Test Fixtures for AAELink
   • Provides authenticated page contexts
   • Handles login flow automatically
   • Injects workspace/channel helpers
   ───────────────────────────────────────────────────────────────────── */

interface AAELinkFixtures {
  /** A page already logged in as the default test user */
  authedPage: Page
}

export const test = base.extend<AAELinkFixtures>({
  authedPage: async ({ page }, use) => {
    const username = process.env.E2E_USERNAME || 'admin'
    const password = process.env.E2E_PASSWORD || 'admin'

    // Navigate to login
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    // Fill credentials
    await page.fill('input[name="username"], input[type="text"]', username)
    await page.fill('input[name="password"], input[type="password"]', password)
    await page.click('button[type="submit"]')

    // Wait for redirect to home
    await page.waitForURL(/\/home/, { timeout: 15_000 })
    await page.waitForLoadState('networkidle')

    await use(page)
  },
})

export { expect } from '@playwright/test'

/* ── Helper utilities ──────────────────────────────────────────────── */

/** Navigate to a specific module via sidebar */
export async function navigateToModule(page: Page, module: string) {
  const moreButton = page.locator('button:has-text("More")')
  if (await moreButton.isVisible()) {
    await moreButton.click()
  }
  // Find and click the module link
  const moduleLink = page.locator(`a[href*="module=${module}"], button:has-text("${module}")`)
  await moduleLink.first().click()
  await page.waitForLoadState('networkidle')
}

/** Wait for the chat timeline to be loaded */
export async function waitForTimeline(page: Page) {
  await page.waitForSelector('.timeline, [class*="timeline"]', { timeout: 10_000 })
}

/** Get the current workspace ID from the URL */
export function getWorkspaceId(page: Page): string {
  const url = new URL(page.url())
  return url.searchParams.get('team') || ''
}

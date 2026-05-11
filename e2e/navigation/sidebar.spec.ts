import { test, expect } from '../fixtures'

/**
 * Sidebar Navigation E2E Tests
 *
 * Validates that all sidebar items load their corresponding panels correctly.
 */

test.describe('Sidebar Navigation', () => {
  test('should display sidebar with top navigation items', async ({ authedPage }) => {
    const page = authedPage

    // Core navigation items should be visible
    await expect(page.locator('button:has-text("Home")')).toBeVisible()
    await expect(page.locator('button:has-text("DMs")')).toBeVisible()
    await expect(page.locator('button:has-text("Activity")')).toBeVisible()
    await expect(page.locator('button:has-text("Later")')).toBeVisible()
    await expect(page.locator('button:has-text("More")')).toBeVisible()
  })

  test('should expand "More" menu with all module links', async ({ authedPage }) => {
    const page = authedPage

    await page.click('button:has-text("More")')
    await page.waitForTimeout(300) // animation

    // Key module items should be in the More flyout
    const expectedModules = [
      'Threads', 'Drafts', 'Files', 'People',
      'Apps', 'Canvases', 'Huddles', 'Automations',
      'Lists', 'AAELink AI', 'AAELink Connect',
      'Marketplace', 'Accessibility', 'System Status',
      'HR & Attendance'
    ]

    for (const mod of expectedModules) {
      const el = page.locator(`button:has-text("${mod}")`)
      await expect(el).toBeVisible({ timeout: 3000 })
    }
  })

  test('should navigate to HR & Attendance module', async ({ authedPage }) => {
    const page = authedPage

    await page.click('button:has-text("More")')
    await page.waitForTimeout(200)
    await page.click('button:has-text("HR & Attendance")')
    await page.waitForLoadState('networkidle')

    // HR panel should be visible
    await expect(page.locator('text=HR & Attendance')).toBeVisible({ timeout: 5000 })
  })

  test('should navigate to Lists module', async ({ authedPage }) => {
    const page = authedPage

    await page.click('button:has-text("More")')
    await page.waitForTimeout(200)
    await page.click('button:has-text("Lists")')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('text=Lists')).toBeVisible({ timeout: 5000 })
  })

  test('should navigate to AAELink AI module', async ({ authedPage }) => {
    const page = authedPage

    await page.click('button:has-text("More")')
    await page.waitForTimeout(200)
    await page.click('button:has-text("AAELink AI")')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('text=AAELink AI')).toBeVisible({ timeout: 5000 })
  })

  test('should display channel list in sidebar', async ({ authedPage }) => {
    const page = authedPage

    // Channels section should exist
    const channelSection = page.locator('details:has(p:text("Channels"))')
    await expect(channelSection).toBeVisible({ timeout: 5000 })
  })
})

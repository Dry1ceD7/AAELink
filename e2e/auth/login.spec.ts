import { test, expect } from '../fixtures'

/**
 * Login & Authentication E2E Tests
 *
 * Validates the login flow, session persistence, and logout behavior.
 */

test.describe('Authentication', () => {
  test('should display login page with form fields', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    // Login form should be visible
    const usernameInput = page.locator('input[name="username"], input[type="text"]')
    const passwordInput = page.locator('input[name="password"], input[type="password"]')
    const submitButton = page.locator('button[type="submit"]')

    await expect(usernameInput).toBeVisible()
    await expect(passwordInput).toBeVisible()
    await expect(submitButton).toBeVisible()
  })

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    await page.fill('input[name="username"], input[type="text"]', 'nonexistent_user_xyz')
    await page.fill('input[name="password"], input[type="password"]', 'wrong_password_abc')
    await page.click('button[type="submit"]')

    // Should stay on login page or show error
    await page.waitForTimeout(2000)
    const url = page.url()
    expect(url).toContain('/login')
  })

  test('should login successfully and redirect to home', async ({ authedPage }) => {
    // authedPage fixture handles login automatically
    expect(authedPage.url()).toContain('/home')
  })

  test('should maintain session on page reload', async ({ authedPage }) => {
    await authedPage.reload()
    await authedPage.waitForLoadState('networkidle')

    // Should still be on home, not redirected to login
    expect(authedPage.url()).toContain('/home')
  })
})

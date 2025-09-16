/**
 * AAELink E2E Authentication Tests
 * Full user journey testing with Playwright
 */

import { expect, test } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  test('should display login page', async ({ page }) => {
    // Check login page elements
    await expect(page).toHaveTitle(/AAELink/);
    await expect(page.locator('h1')).toContainText('AAELink');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should show registration form when needed', async ({ page }) => {
    // Enter email
    await page.fill('input[type="email"]', 'newuser@example.com');

    // Click sign in
    await page.click('button[type="submit"]');

    // Should show registration fields
    await page.waitForSelector('input[id="displayName"]', { timeout: 5000 });
    await expect(page.locator('input[id="displayName"]')).toBeVisible();
  });

  test('should validate email format', async ({ page }) => {
    // Enter invalid email
    await page.fill('input[type="email"]', 'invalid-email');
    await page.click('button[type="submit"]');

    // Should show error
    await expect(page.locator('.text-red-500')).toBeVisible();
  });

  test('should handle WebAuthn registration', async ({ page, context }) => {
    // Mock WebAuthn API
    await context.addInitScript(() => {
      (window as any).PublicKeyCredential = class {
        static isUserVerifyingPlatformAuthenticatorAvailable() {
          return Promise.resolve(true);
        }
      };

      (navigator as any).credentials = {
        create: () => Promise.resolve({
          id: 'mock-credential-id',
          rawId: new ArrayBuffer(32),
          response: {
            attestationObject: new ArrayBuffer(128),
            clientDataJSON: new ArrayBuffer(64),
          },
          type: 'public-key',
        }),
        get: () => Promise.resolve({
          id: 'mock-credential-id',
          rawId: new ArrayBuffer(32),
          response: {
            authenticatorData: new ArrayBuffer(64),
            clientDataJSON: new ArrayBuffer(64),
            signature: new ArrayBuffer(64),
            userHandle: new ArrayBuffer(16),
          },
          type: 'public-key',
        }),
      };
    });

    // Fill registration form
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Register")');
    await page.fill('input[id="displayName"]', 'Test User');

    // Submit registration
    await page.click('button[type="submit"]');

    // Should redirect to workspace
    await page.waitForURL('**/channels', { timeout: 10000 });
  });

  test('should toggle between light and dark theme', async ({ page }) => {
    // Find theme toggle button
    const themeToggle = page.locator('[aria-label="Toggle theme"]');
    await expect(themeToggle).toBeVisible();

    // Check initial theme
    const htmlElement = page.locator('html');
    const initialTheme = await htmlElement.getAttribute('class');

    // Toggle theme
    await themeToggle.click();

    // Check theme changed
    const newTheme = await htmlElement.getAttribute('class');
    expect(newTheme).not.toBe(initialTheme);
  });

  test('should change language', async ({ page }) => {
    // Find language selector
    const languageSelector = page.locator('[aria-label="Language selector"]');
    await expect(languageSelector).toBeVisible();

    // Click language selector
    await languageSelector.click();

    // Select Thai
    await page.click('button:has-text("ไทย")');

    // Check text changed
    await expect(page.locator('button[type="submit"]')).not.toContainText('Sign in');
  });
});

test.describe('Authenticated User Flow', () => {
  test.use({
    storageState: 'tests/e2e/auth.json', // Pre-authenticated state
  });

  test('should access workspace after login', async ({ page }) => {
    await page.goto('http://localhost:3000/channels');

    // Should see workspace layout
    await expect(page.locator('[data-testid="channel-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="message-area"]')).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    await page.goto('http://localhost:3000/settings');

    // Click logout button
    await page.click('button:has-text("Logout")');

    // Should redirect to login
    await page.waitForURL('**/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});

test.describe('Accessibility', () => {
  test('should be keyboard navigable', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Tab through elements
    await page.keyboard.press('Tab');
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeDefined();

    // Tab to email input
    await page.keyboard.press('Tab');
    await page.keyboard.type('test@example.com');

    // Tab to submit button
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    // Should trigger form submission
    await page.waitForTimeout(1000);
  });

  test('should have proper ARIA labels', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Check ARIA labels
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toHaveAttribute('aria-label', 'Email');

    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toHaveAttribute('aria-busy', 'false');
  });

  test('should support screen reader', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Check for screen reader only content
    const srOnly = page.locator('.sr-only');
    const count = await srOnly.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Performance', () => {
  test('should load login page quickly', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('http://localhost:3000');
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(3000); // Should load in under 3 seconds
  });

  test('should have good Core Web Vitals', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Measure LCP
    const lcp = await page.evaluate(() => {
      return new Promise((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          resolve(lastEntry.renderTime || lastEntry.loadTime);
        }).observe({ entryTypes: ['largest-contentful-paint'] });
      });
    });

    expect(Number(lcp)).toBeLessThan(2500); // LCP should be under 2.5s
  });
});

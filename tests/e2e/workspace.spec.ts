/**
 * E2E Tests for AAELink Workspace
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5174';

test.describe('AAELink Workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test.describe('Authentication Flow', () => {
    test('should display login page initially', async ({ page }) => {
      await expect(page.locator('h1')).toContainText('AAELink');
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    test('should login with valid credentials', async ({ page }) => {
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button[type="submit"]');

      // Wait for redirect to workspace
      await page.waitForURL('**/');
      await expect(page.locator('text=AAELink Workspace')).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', 'wrongpassword');
      await page.click('button[type="submit"]');

      // Should show error message
      await expect(page.locator('text=Login failed')).toBeVisible();
    });

    test('should support WebAuthn authentication', async ({ page }) => {
      // Click on WebAuthn toggle
      await page.click('text=Use passkey authentication instead');
      
      // Should show WebAuthn interface
      await expect(page.locator('text=Passkey Authentication')).toBeVisible();
      await expect(page.locator('text=Sign in with Passkey')).toBeVisible();
    });
  });

  test.describe('Workspace Navigation', () => {
    test.beforeEach(async ({ page }) => {
      // Login first
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/');
    });

    test('should display workspace interface', async ({ page }) => {
      await expect(page.locator('text=AAELink Workspace')).toBeVisible();
      await expect(page.locator('text=Channels')).toBeVisible();
      await expect(page.locator('text=Chat')).toBeVisible();
      await expect(page.locator('text=Calendar')).toBeVisible();
      await expect(page.locator('text=Admin')).toBeVisible();
    });

    test('should switch between tabs', async ({ page }) => {
      // Switch to Calendar tab
      await page.click('text=📅 Calendar');
      await expect(page.locator('text=Calendar')).toBeVisible();
      
      // Switch to Admin tab
      await page.click('text=⚙️ Admin');
      await expect(page.locator('text=Admin Dashboard')).toBeVisible();
      
      // Switch back to Chat
      await page.click('text=💬 Chat');
      await expect(page.locator('text=Channels')).toBeVisible();
    });
  });

  test.describe('Chat Functionality', () => {
    test.beforeEach(async ({ page }) => {
      // Login and navigate to chat
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/');
    });

    test('should display channel list', async ({ page }) => {
      await expect(page.locator('text=#general')).toBeVisible();
      await expect(page.locator('text=#announcements')).toBeVisible();
    });

    test('should send messages', async ({ page }) => {
      const messageInput = page.locator('input[placeholder*="message"]');
      await messageInput.fill('Hello, this is a test message!');
      await page.click('button[type="submit"]');

      // Message should appear in the chat
      await expect(page.locator('text=Hello, this is a test message!')).toBeVisible();
    });

    test('should upload files', async ({ page }) => {
      // Create a test file
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles({
        name: 'test.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Test file content')
      });

      // File should be uploaded
      await expect(page.locator('text=File uploaded successfully')).toBeVisible();
    });
  });

  test.describe('Calendar Functionality', () => {
    test.beforeEach(async ({ page }) => {
      // Login and navigate to calendar
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/');
      await page.click('text=📅 Calendar');
    });

    test('should display calendar interface', async ({ page }) => {
      await expect(page.locator('text=Calendar')).toBeVisible();
      await expect(page.locator('text=Today')).toBeVisible();
      await expect(page.locator('text=Create Event')).toBeVisible();
    });

    test('should switch calendar views', async ({ page }) => {
      // Switch to week view
      await page.click('text=week');
      await expect(page.locator('text=week')).toHaveClass(/bg-blue-600/);
      
      // Switch to day view
      await page.click('text=day');
      await expect(page.locator('text=day')).toHaveClass(/bg-blue-600/);
      
      // Switch back to month view
      await page.click('text=month');
      await expect(page.locator('text=month')).toHaveClass(/bg-blue-600/);
    });

    test('should display events', async ({ page }) => {
      // Should show mock events
      await expect(page.locator('text=Team Standup')).toBeVisible();
    });
  });

  test.describe('Admin Console', () => {
    test.beforeEach(async ({ page }) => {
      // Login and navigate to admin
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/');
      await page.click('text=⚙️ Admin');
    });

    test('should display admin dashboard', async ({ page }) => {
      await expect(page.locator('text=Admin Dashboard')).toBeVisible();
      await expect(page.locator('text=Overview')).toBeVisible();
      await expect(page.locator('text=User Management')).toBeVisible();
      await expect(page.locator('text=ERP Integration')).toBeVisible();
    });

    test('should show system statistics', async ({ page }) => {
      await expect(page.locator('text=Total Users')).toBeVisible();
      await expect(page.locator('text=Messages')).toBeVisible();
      await expect(page.locator('text=Files')).toBeVisible();
      await expect(page.locator('text=Organizations')).toBeVisible();
    });

    test('should handle ERP sync', async ({ page }) => {
      // Click on ERP tab
      await page.click('text=ERP Integration');
      
      // Should show ERP status
      await expect(page.locator('text=ERP Integration Status')).toBeVisible();
      
      // Test sync buttons
      await page.click('text=Sync Users');
      await expect(page.locator('text=Sync Users')).toBeVisible();
    });
  });

  test.describe('Search Functionality', () => {
    test.beforeEach(async ({ page }) => {
      // Login first
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/');
    });

    test('should open search modal', async ({ page }) => {
      const searchInput = page.locator('input[placeholder*="search"]');
      await searchInput.fill('test');
      await searchInput.press('Enter');

      // Should open advanced search modal
      await expect(page.locator('text=Search AAELink')).toBeVisible();
    });

    test('should perform search', async ({ page }) => {
      const searchInput = page.locator('input[placeholder*="search"]');
      await searchInput.fill('welcome');
      await searchInput.press('Enter');

      // Should show search results
      await expect(page.locator('text=Search AAELink')).toBeVisible();
      await expect(page.locator('text=results')).toBeVisible();
    });
  });

  test.describe('Theme and Language', () => {
    test.beforeEach(async ({ page }) => {
      // Login first
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/');
    });

    test('should toggle theme', async ({ page }) => {
      const themeButton = page.locator('button[title*="theme"]');
      await themeButton.click();

      // Should change theme (check for dark mode classes)
      await expect(page.locator('html')).toHaveClass(/dark/);
    });

    test('should change language', async ({ page }) => {
      // Go back to login page to test language selector
      await page.goto(BASE_URL);
      
      const languageSelector = page.locator('select');
      await languageSelector.selectOption('th');
      
      // Should show Thai text
      await expect(page.locator('text=เข้าสู่ระบบ')).toBeVisible();
    });
  });

  test.describe('Responsive Design', () => {
    test('should work on mobile devices', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/');

      // Should still be functional on mobile
      await expect(page.locator('text=AAELink Workspace')).toBeVisible();
    });

    test('should work on tablet devices', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', '12345678');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/');

      // Should be functional on tablet
      await expect(page.locator('text=AAELink Workspace')).toBeVisible();
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper ARIA labels', async ({ page }) => {
      await page.goto(BASE_URL);
      
      // Check for ARIA labels on form elements
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toHaveAttribute('aria-label');
      
      const passwordInput = page.locator('input[type="password"]');
      await expect(passwordInput).toHaveAttribute('aria-label');
    });

    test('should support keyboard navigation', async ({ page }) => {
      await page.goto(BASE_URL);
      
      // Tab through form elements
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      
      // Should be able to submit with Enter
      await page.fill('input[type="email"]', 'admin@aae.co.th');
      await page.fill('input[type="password"]', '12345678');
      await page.keyboard.press('Enter');
      
      await page.waitForURL('**/');
      await expect(page.locator('text=AAELink Workspace')).toBeVisible();
    });
  });
});

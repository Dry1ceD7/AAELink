import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
  });

  test('should display login form', async ({ page }) => {
    await expect(page.getByText('Sign in to AAELink')).toBeVisible();
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('should login with valid credentials', async ({ page }) => {
    await page.fill('input[placeholder="Email"]', 'admin@aae.co.th');
    await page.fill('input[placeholder="Password"]', '12345678');
    await page.click('button[type="submit"]');
    
    // Should redirect to workspace
    await expect(page).toHaveURL(/.*workspace/);
    await expect(page.getByText('Welcome to AAELink')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.fill('input[placeholder="Email"]', 'wrong@example.com');
    await page.fill('input[placeholder="Password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    // Should show error message
    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
  });

  test('should toggle theme', async ({ page }) => {
    const themeToggle = page.getByRole('button', { name: /theme/i });
    await expect(themeToggle).toBeVisible();
    
    await themeToggle.click();
    // Check if theme class is applied
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('should switch language', async ({ page }) => {
    const languageSelector = page.getByRole('button', { name: /language/i });
    await expect(languageSelector).toBeVisible();
    
    await languageSelector.click();
    await page.click('text=ไทย');
    
    // Check if Thai text is displayed
    await expect(page.getByText('เข้าสู่ระบบ AAELink')).toBeVisible();
  });

  test('should be accessible', async ({ page }) => {
    // Check for proper heading structure
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    
    // Check for proper form labels
    const emailInput = page.getByPlaceholder('Email');
    const passwordInput = page.getByPlaceholder('Password');
    
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(passwordInput).toHaveAttribute('type', 'password');
    
    // Check keyboard navigation
    await page.keyboard.press('Tab');
    await expect(emailInput).toBeFocused();
    
    await page.keyboard.press('Tab');
    await expect(passwordInput).toBeFocused();
  });
});
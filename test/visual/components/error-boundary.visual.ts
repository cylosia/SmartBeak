import { test, expect } from '@playwright/test';

/**
 * Visual Regression: Error Boundary & Error Pages
 *
 * Captures screenshots of error states to prevent visual regressions
 * in error handling UI.
 */

test.describe('Error Pages', () => {
  test('should render the custom error page', async ({ page }) => {
    // Navigate to a non-existent page to trigger error/404 handling
    await page.goto('/this-page-does-not-exist-404');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('error-404.png', {
      fullPage: true,
    });
  });

  test('should render the login page', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('login-page.png', {
      fullPage: true,
    });
  });

  test('should render the register page', async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('register-page.png', {
      fullPage: true,
    });
  });

  test('should render the help page', async ({ page }) => {
    await page.goto('/help');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('help-page.png', {
      fullPage: true,
    });
  });
});

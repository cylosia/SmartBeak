import { test, expect } from '@playwright/test';

/**
 * Visual Regression: Settings Pages
 *
 * Captures screenshots of account and organization settings.
 */

test.describe('Settings Pages', () => {
  test('should render the account settings page', async ({ page }) => {
    await page.goto('/settings/account');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('settings-account.png', {
      fullPage: true,
    });
  });

  test('should render the integrations settings page', async ({ page }) => {
    await page.goto('/settings/integrations');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('settings-integrations.png', {
      fullPage: true,
    });
  });

  test('should render the user management page', async ({ page }) => {
    await page.goto('/settings/users');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('settings-users.png', {
      fullPage: true,
    });
  });

  test('should render the roles settings page', async ({ page }) => {
    await page.goto('/settings/roles');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('settings-roles.png', {
      fullPage: true,
    });
  });
});

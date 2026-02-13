import { test, expect } from '@playwright/test';

/**
 * Visual Regression: Dashboard Page
 *
 * Captures screenshots of the main dashboard in empty and populated states
 * across desktop and mobile viewports.
 */

test.describe('Dashboard Page', () => {
  test('should render the portfolio/dashboard page', async ({ page }) => {
    await page.goto('/portfolio');
    // Wait for main content to stabilize
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('dashboard-default.png', {
      fullPage: true,
    });
  });

  test('should render the domains list page', async ({ page }) => {
    await page.goto('/domains');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('domains-list.png', {
      fullPage: true,
    });
  });

  test('should render the activity page', async ({ page }) => {
    await page.goto('/activity');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('activity-page.png', {
      fullPage: true,
    });
  });
});

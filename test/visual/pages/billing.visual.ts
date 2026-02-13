import { test, expect } from '@playwright/test';

/**
 * Visual Regression: Billing Pages
 *
 * Captures screenshots of billing and pricing pages.
 */

test.describe('Billing Pages', () => {
  test('should render the billing page', async ({ page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('billing-page.png', {
      fullPage: true,
    });
  });

  test('should render the pricing page', async ({ page }) => {
    await page.goto('/pricing');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('pricing-page.png', {
      fullPage: true,
    });
  });

  test('should render the billing upgrade page', async ({ page }) => {
    await page.goto('/billing/upgrade');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('billing-upgrade.png', {
      fullPage: true,
    });
  });
});

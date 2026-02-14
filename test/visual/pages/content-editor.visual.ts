import { test, expect } from '@playwright/test';

/**
 * Visual Regression: Content Editor
 *
 * Captures screenshots of the TipTap rich text editor in various states.
 */

test.describe('Content Editor Page', () => {
  test('should render the new content editor page', async ({ page }) => {
    // Navigate to create new content for a domain
    await page.goto('/domains/test-domain/content/new');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('content-editor-new.png', {
      fullPage: true,
    });
  });

  test('should render the content list page', async ({ page }) => {
    await page.goto('/domains/test-domain/content');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('content-list.png', {
      fullPage: true,
    });
  });
});

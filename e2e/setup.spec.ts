// e2e/setup.spec.ts
import { test, expect } from '@playwright/test';

test.describe('First-run setup', () => {
	test('redirects to /setup when no users exist', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/setup/);
	});

	test('creates admin account and redirects to admin services', async ({ page }) => {
		await page.goto('/setup');

		await page.fill('input[name="username"]', 'testadmin');
		await page.fill('input[name="displayName"]', 'Test Admin');
		await page.fill('input[name="password"]', 'TestPassword123!');
		await page.fill('input[name="confirm"]', 'TestPassword123!');
		await page.click('button[type="submit"]');

		// Should redirect to /admin/services after setup
		await expect(page).toHaveURL(/\/admin\/services/, { timeout: 10_000 });
	});
});

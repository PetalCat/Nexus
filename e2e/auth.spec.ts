// e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
	test('redirects unauthenticated users to /login', async ({ page }) => {
		await page.goto('/settings');
		await expect(page).toHaveURL(/\/login\?next=/);
	});

	test('login with valid credentials', async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[name="username"]', 'testadmin');
		await page.fill('input[name="password"]', 'TestPassword123!');
		await page.click('button[type="submit"]');
		await expect(page).toHaveURL('/', { timeout: 10_000 });
	});

	test('login with invalid credentials shows error', async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[name="username"]', 'testadmin');
		await page.fill('input[name="password"]', 'wrongpassword');
		await page.click('button[type="submit"]');
		await expect(page.locator('[data-testid="error"], .error, [role="alert"]')).toBeVisible();
	});

	test('logout returns to login page', async ({ page }) => {
		// Login first
		await page.goto('/login');
		await page.fill('input[name="username"]', 'testadmin');
		await page.fill('input[name="password"]', 'TestPassword123!');
		await page.click('button[type="submit"]');
		await expect(page).toHaveURL('/', { timeout: 10_000 });

		// Find and click logout
		await page.goto('/api/auth/logout');
		await expect(page).toHaveURL(/\/login/);
	});
});

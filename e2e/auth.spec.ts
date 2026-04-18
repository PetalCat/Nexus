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
		// Post-login destination depends on welcomeCompletedAt — the seeded
		// admin hasn't completed the wizard so they land on /welcome; a
		// fully-onboarded user would land on /. Either means "successfully
		// authenticated and no longer on /login", which is what this tests.
		await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
	});

	test('login with invalid credentials shows error', async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[name="username"]', 'testadmin');
		await page.fill('input[name="password"]', 'wrongpassword');
		await page.click('button[type="submit"]');
		// The login page renders the failure message inline as plain text —
		// not an [role="alert"] element — so match the string directly.
		await expect(page.getByText(/Invalid username or password/i)).toBeVisible();
	});

	test('logout returns to login page', async ({ page }) => {
		// Login first — see "login with valid credentials" above; we
		// just need to be authenticated, not on any specific page.
		await page.goto('/login');
		await page.fill('input[name="username"]', 'testadmin');
		await page.fill('input[name="password"]', 'TestPassword123!');
		await page.click('button[type="submit"]');
		await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

		// /api/auth/logout is POST-only. Issue the POST via fetch rather
		// than a navigation, then reload to observe the redirect to /login.
		await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
		await page.goto('/settings');
		await expect(page).toHaveURL(/\/login/);
	});
});

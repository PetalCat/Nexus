// e2e/setup.spec.ts
// Fresh-install admin creation lives on /welcome since #24 — the route
// doubles as admin-create (userCount===0) and per-user wizard (logged in).
// NOTE: per CLAUDE.md these e2e tests are known-broken; they assume a
// fresh DB and need a CI-fixture overhaul. Kept in sync with the unified
// /welcome flow so they're not also structurally out-of-date.
import { test, expect } from '@playwright/test';

test.describe('First-run setup', () => {
	test('redirects to /welcome when no users exist', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/welcome/);
	});

	test('creates admin account and reloads into the welcome wizard', async ({ page }) => {
		await page.goto('/welcome');

		await page.fill('input[name="username"]', 'testadmin');
		await page.fill('input[name="displayName"]', 'Test Admin');
		await page.fill('input[name="password"]', 'TestPassword123!');
		await page.fill('input[name="confirm"]', 'TestPassword123!');
		await page.click('button[type="submit"]');

		// After admin creation we stay on /welcome; the page reloads into the
		// per-user wizard (the admin form is gone, the wizard phases show).
		await expect(page).toHaveURL(/\/welcome/, { timeout: 10_000 });
	});
});

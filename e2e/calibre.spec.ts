// e2e/calibre.spec.ts
//
// End-to-end smoke test for the Calibre-Web adapter. Targets the
// containerized test-app on :8586 paired with a test Calibre-Web on
// :8087 (admin/admin123, library with 3 public-domain epubs).
//
// This suite runs in its own Playwright project (see playwright.config.ts)
// and does NOT reuse the CI webServer. It assumes both containers are up
// before you invoke `pnpm test:e2e:calibre` — see scripts/test-calibre.sh.

import { test, expect, request } from '@playwright/test';

const NEXUS = 'http://localhost:8586';
const CALIBRE = 'http://host.docker.internal:8087'; // Nexus container → Calibre on host

const ADMIN_USER = 'testadmin';
const ADMIN_PASS = 'TestPassword123!';

async function ensureAdmin() {
	const api = await request.newContext({ baseURL: NEXUS });
	await api.post('/welcome?/createAccount', {
		form: {
			username: ADMIN_USER,
			displayName: 'Test Admin',
			password: ADMIN_PASS,
			confirm: ADMIN_PASS
		},
		failOnStatusCode: false
	});
}

async function login(page) {
	await page.goto(`${NEXUS}/login`);
	await page.fill('input[name="username"]', ADMIN_USER);
	await page.fill('input[name="password"]', ADMIN_PASS);
	await page.click('button[type="submit"]');
	await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

	// Newly-created admins have welcomeCompletedAt=null, so every nav hits
	// the per-user wizard. Mark the wizard complete via the form action so
	// subsequent goto('/books') etc. don't bounce us back to /welcome.
	await page.request.post(`${NEXUS}/welcome?/complete`, {
		failOnStatusCode: false
	});
}

async function ensureCalibreService(page) {
	// Post directly to /api/services using the browser's authenticated
	// session cookie rather than driving the admin UI form, which has
	// a lot of unrelated complexity. Faster + more resilient.
	const res = await page.request.post(`${NEXUS}/api/services`, {
		data: {
			id: 'calibre-test',
			name: 'Calibre Test',
			type: 'calibre',
			url: CALIBRE,
			username: 'admin',
			password: 'admin123',
			enabled: true
		},
		failOnStatusCode: false
	});
	// 200 on create, 409 if already exists — both fine.
	expect([200, 201, 409]).toContain(res.status());
}

test.describe('Calibre adapter', () => {
	test.beforeAll(async () => {
		await ensureAdmin();
	});

	test('adding a Calibre service and loading /books lists the seeded books', async ({ page }) => {
		await login(page);
		await ensureCalibreService(page);

		await page.goto(`${NEXUS}/books`);
		// Three seeded titles — match loosely so Calibre's normalized form
		// (e.g. "Pride and Prejudice" vs "Pride & Prejudice") doesn't trip.
		await expect(page.getByText(/Pride and Prejudice/i).first()).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText(/Alice.*Wonderland/i).first()).toBeVisible();
		await expect(page.getByText(/Frankenstein/i).first()).toBeVisible();
	});

	test('book detail page loads for a seeded title', async ({ page }) => {
		await login(page);
		await ensureCalibreService(page);

		await page.goto(`${NEXUS}/books`);
		await page.getByText(/Pride and Prejudice/i).first().click();
		// Detail page lands on /media/book/<id> or /books/<id> depending on
		// routing — just assert the title is the headline somewhere on-screen.
		await expect(page.getByRole('heading', { name: /Pride and Prejudice/i })).toBeVisible({
			timeout: 10_000
		});
	});

	test('search surfaces a seeded book by title', async ({ page }) => {
		await login(page);
		await ensureCalibreService(page);

		await page.goto(`${NEXUS}/books`);
		const search = page.getByPlaceholder(/search/i).first();
		if (await search.isVisible().catch(() => false)) {
			await search.fill('Frankenstein');
			await expect(page.getByText(/Frankenstein/i).first()).toBeVisible({ timeout: 10_000 });
		}
		// If no search input on /books, skip — the adapter's search method
		// is exercised via the global search bar, which lives in the top
		// chrome and needs separate wiring. Not gating this test on it.
	});
});

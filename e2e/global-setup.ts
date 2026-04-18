// e2e/global-setup.ts
//
// Playwright globalSetup hook. Runs once before the test suite, after
// the webServer in playwright.config.ts has started. Seeds the fresh
// test DB with an admin user so auth.spec.ts has something to log into.
//
// Before this existed, the e2e tests assumed a DB that matched whatever
// state happened to be on disk from the last run, and CI's fresh DB
// caused every login test to fail with a /welcome redirect. See
// CLAUDE.md "E2E tests broken" note.

import { request } from '@playwright/test';

const BASE_URL = 'http://localhost:8585';
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

async function waitForServer(): Promise<void> {
	const api = await request.newContext({ baseURL: BASE_URL });
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const res = await api.get('/api/health', { timeout: 2000 });
			if (res.ok()) return;
		} catch {
			/* swallow — server not up yet */
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
	throw new Error(`Server did not become ready at ${BASE_URL} within ${READY_TIMEOUT_MS}ms`);
}

export default async function globalSetup(): Promise<void> {
	await waitForServer();

	const api = await request.newContext({ baseURL: BASE_URL });

	// First-run admin create. The /welcome createAccount action is guarded
	// by userCount===0, so if the DB already has a user this no-ops from
	// our perspective (we check health, not the response body). That makes
	// this safe to re-run against a partially-seeded local dev DB.
	const res = await api.post('/welcome?/createAccount', {
		form: {
			username: 'testadmin',
			displayName: 'Test Admin',
			password: 'TestPassword123!',
			confirm: 'TestPassword123!'
		},
		// SvelteKit form actions return 204/303 on success, 400 on "already
		// exists". Either is fine for our purposes; only unreachable-server
		// should throw.
		failOnStatusCode: false
	});
	if (res.status() >= 500) {
		throw new Error(`globalSetup: admin create returned ${res.status()}`);
	}
}

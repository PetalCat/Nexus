// playwright.calibre.config.ts
//
// Dedicated Playwright config for the Calibre E2E smoke test. Targets
// the containerized test-app on :8586 + a live Calibre-Web on :8087.
// Both must be running before invocation (see scripts/test-calibre.sh).
// We intentionally skip the default webServer here — this is an
// integration test against a live stack, not the hermetic CI run.

import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	testMatch: ['**/calibre.spec.ts'],
	timeout: 60_000,
	retries: 0,
	use: {
		baseURL: 'http://localhost:8586',
		screenshot: 'only-on-failure'
	}
	// No webServer — the containers are owned by the invoker.
});

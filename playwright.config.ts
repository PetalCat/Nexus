// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	// Ignore the globalSetup module — it's not a spec.
	testIgnore: ['**/global-setup.ts'],
	timeout: 30_000,
	retries: 0,
	// Seeds an admin user via the /welcome createAccount action before any
	// test runs. Without this CI hits a fresh DB and every auth test
	// redirects to /welcome instead of logging in.
	globalSetup: './e2e/global-setup.ts',
	use: {
		baseURL: 'http://localhost:8585',
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: 'node build/index.js',
		port: 8585,
		reuseExistingServer: !process.env.CI,
		env: {
			PORT: '8585',
			DATABASE_URL: './data/test-e2e.db',
			ORIGIN: 'http://localhost:8585',
			// Boot hard-fails without this since the 2026-04-17 security
			// cluster; CI is ephemeral so a fixed all-zeros key is fine.
			NEXUS_ENCRYPTION_KEY:
				process.env.NEXUS_ENCRYPTION_KEY ??
				'0000000000000000000000000000000000000000000000000000000000000000',
			// E2E runs many auth POSTs in quick succession; the 10/min auth
			// bucket blocks them after the third login attempt. Disable in
			// test env — hooks.server.ts honors this flag.
			NEXUS_DISABLE_RATE_LIMIT: '1'
		}
	}
});

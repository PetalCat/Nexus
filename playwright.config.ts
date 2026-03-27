// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	retries: 0,
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
			ORIGIN: 'http://localhost:8585'
		}
	}
});

// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	test: {
		include: ['src/**/__tests__/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['src/test-setup/localstorage-shim.ts'],
		globals: false,
		alias: {
			'$lib': resolve('./src/lib'),
			'$lib/db': resolve('./src/lib/db'),
			'$lib/server': resolve('./src/lib/server')
		}
	}
});

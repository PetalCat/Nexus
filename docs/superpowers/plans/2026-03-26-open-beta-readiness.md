# Open Beta Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare Nexus for self-hosted open source beta release with Docker packaging, testing, CI/CD, application hardening, and documentation.

**Architecture:** Two parallel tracks (Deployment + Testing/CI) followed by sequential application hardening and documentation. All server-side additions follow existing patterns — singleton modules with start/stop lifecycle, `withCache()` caching, adapter registry.

**Tech Stack:** SvelteKit 2 / Svelte 5 / Node adapter, Vitest, Playwright, GitHub Actions, Docker (multi-stage, alpine), ghcr.io

**IMPORTANT:** Do NOT modify any files in `src/routes/books/`, `src/lib/components/books/`, or book-related adapters — another agent is working on the books section.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/routes/api/health/+server.ts` | Health check endpoint |
| `src/lib/server/logger.ts` | Structured logging (JSON prod, pretty dev) |
| `src/lib/server/rate-limit.ts` | In-memory sliding window rate limiter |
| `src/lib/server/shutdown.ts` | Graceful shutdown orchestration |
| `Dockerfile` | Multi-stage production image |
| `docker-compose.yml` | Single-service compose for self-hosters |
| `.dockerignore` | Build context exclusions |
| `vitest.config.ts` | Vitest configuration |
| `src/lib/server/__tests__/auth.test.ts` | Auth unit tests |
| `src/lib/server/__tests__/cache.test.ts` | Cache unit tests |
| `src/lib/server/__tests__/rate-limit.test.ts` | Rate limiter unit tests |
| `src/lib/server/__tests__/health.test.ts` | Health endpoint test |
| `playwright.config.ts` | Playwright configuration |
| `e2e/setup.spec.ts` | First-run setup e2e test |
| `e2e/auth.spec.ts` | Login/logout e2e test |
| `.github/workflows/ci.yml` | CI pipeline (lint, test, build, e2e) |
| `.github/workflows/release.yml` | Release pipeline (build + push Docker image) |
| `CONTRIBUTING.md` | Contributor guide |

### Modified Files

| File | Change |
|------|--------|
| `src/hooks.server.ts` | Add rate limiting, register shutdown handler |
| `src/lib/db/index.ts` | Export `closeDb()` for shutdown |
| `package.json` | Add test scripts, vitest/playwright deps, bump version |
| `.env.example` | Add PORT, ORIGIN, comments |
| `README.md` | Full overhaul with Docker quick start |
| `src/routes/setup/+page.svelte` | Post-setup guidance to add first service |

---

## Track A: Deployment

### Task 1: Health Check Endpoint

**Files:**
- Create: `src/routes/api/health/+server.ts`
- Create: `src/lib/server/__tests__/health.test.ts`

- [ ] **Step 1: Create the health endpoint**

```typescript
// src/routes/api/health/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRawDb } from '$lib/db';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let _version: string | null = null;

function getVersion(): string {
	if (!_version) {
		try {
			const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'));
			_version = pkg.version ?? 'unknown';
		} catch {
			_version = 'unknown';
		}
	}
	return _version;
}

export const GET: RequestHandler = async () => {
	try {
		const db = getRawDb();
		db.prepare('SELECT 1').get();
		return json({ status: 'ok', version: getVersion() });
	} catch (err) {
		return json(
			{ status: 'error', message: 'Database unreachable' },
			{ status: 503 }
		);
	}
};
```

- [ ] **Step 2: Verify it works manually**

Run: `curl http://localhost:5173/api/health`
Expected: `{"status":"ok","version":"0.0.1"}`

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/health/+server.ts
git commit -m "feat: add /api/health endpoint for Docker healthcheck"
```

---

### Task 2: Database Close Export

**Files:**
- Modify: `src/lib/db/index.ts`

- [ ] **Step 1: Add closeDb export**

Add after the existing `getRawDb()` function in `src/lib/db/index.ts`:

```typescript
export function closeDb(): void {
	if (_sqlite) {
		_sqlite.close();
		_sqlite = null;
		_db = null;
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/db/index.ts
git commit -m "feat: export closeDb() for graceful shutdown"
```

---

### Task 3: Graceful Shutdown Handler

**Files:**
- Create: `src/lib/server/shutdown.ts`
- Modify: `src/hooks.server.ts`

- [ ] **Step 1: Create the shutdown module**

```typescript
// src/lib/server/shutdown.ts
import { closeDb } from '$lib/db';
import { stopSessionPoller } from './session-poller';
import { stopStatsScheduler } from './stats-scheduler';
import { stopRecScheduler } from './rec-scheduler';
import { stopVideoNotificationPoller } from './video-notifications';
import { stopHealthWatchdog } from './health-watchdog';

let shuttingDown = false;

export function isShuttingDown(): boolean {
	return shuttingDown;
}

export function registerShutdownHandler(): void {
	const shutdown = (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`[shutdown] Received ${signal}, shutting down gracefully...`);

		try { stopSessionPoller(); } catch { /* already stopped */ }
		try { stopStatsScheduler(); } catch { /* already stopped */ }
		try { stopRecScheduler(); } catch { /* already stopped */ }
		try { stopVideoNotificationPoller(); } catch { /* already stopped */ }
		try { stopHealthWatchdog(); } catch { /* already stopped */ }
		try { closeDb(); } catch { /* already closed */ }

		console.log('[shutdown] Cleanup complete, exiting.');
		process.exit(0);
	};

	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}
```

- [ ] **Step 2: Register in hooks.server.ts**

Add to the top-level startup section of `src/hooks.server.ts` (after the existing `start*()` calls around line 35):

```typescript
import { registerShutdownHandler } from '$lib/server/shutdown';

// Add after existing start*() calls:
registerShutdownHandler();
```

- [ ] **Step 3: Test manually**

Run: `pnpm dev` then press Ctrl+C
Expected: See `[shutdown] Received SIGINT, shutting down gracefully...` then `[shutdown] Cleanup complete, exiting.`

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/shutdown.ts src/hooks.server.ts
git commit -m "feat: graceful shutdown on SIGTERM/SIGINT"
```

---

### Task 4: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```dockerignore
# .dockerignore
node_modules
.svelte-kit
build
.git
*.db
*.db-wal
*.db-shm
docs
e2e
.github
.env
.env.*
!.env.example
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
# Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
ENV PORT=8585
ENV DATABASE_URL=./data/nexus.db

RUN mkdir -p /app/data

EXPOSE 8585

CMD ["node", "build/index.js"]
```

- [ ] **Step 3: Build and test the image locally**

Run:
```bash
docker build -t nexus:local .
docker run --rm -p 8585:8585 -v nexus-test:/app/data nexus:local
```

In another terminal:
```bash
curl http://localhost:8585/api/health
```
Expected: `{"status":"ok","version":"0.0.1"}`

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: multi-stage Dockerfile for production deployment"
```

---

### Task 5: docker-compose.yml and .env.example

**Files:**
- Create: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
# docker-compose.yml
services:
  nexus:
    image: ghcr.io/parkerbugg/nexus:latest
    build: .
    ports:
      - "${PORT:-8585}:${PORT:-8585}"
    volumes:
      - nexus-data:/app/data
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:${PORT:-8585}/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  nexus-data:
```

- [ ] **Step 2: Update .env.example**

```env
# .env.example

# ── Database ──────────────────────────────────────────────
# Path to SQLite database file.
# In Docker: relative to /app (default puts it in the mounted volume)
# Without Docker: relative to project root or absolute path
DATABASE_URL=./data/nexus.db

# ── Server ────────────────────────────────────────────────
# Port Nexus listens on
PORT=8585

# Public URL of your Nexus instance (used for CORS, OAuth callbacks, etc.)
# Change this to your domain when deploying behind a reverse proxy
ORIGIN=http://localhost:8585
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat: docker-compose.yml and documented .env.example"
```

---

## Track B: Testing & CI

### Task 6: Vitest Setup

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

```bash
pnpm add -D vitest
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	test: {
		include: ['src/**/__tests__/**/*.test.ts'],
		environment: 'node',
		globals: false,
		alias: {
			'$lib': resolve('./src/lib'),
			'$lib/db': resolve('./src/lib/db'),
			'$lib/server': resolve('./src/lib/server')
		}
	}
});
```

- [ ] **Step 3: Add test scripts to package.json**

Add to the `"scripts"` section of `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

Run: `pnpm test`
Expected: `No test files found` (clean exit, no errors)

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml
git commit -m "chore: vitest setup and test scripts"
```

---

### Task 7: Cache Unit Tests

**Files:**
- Create: `src/lib/server/__tests__/cache.test.ts`
- Read: `src/lib/server/cache.ts`

- [ ] **Step 1: Write cache tests**

Read `src/lib/server/cache.ts` to understand the exact API: `withCache(key, ttlMs, fn)`, `invalidate(key)`, `invalidatePrefix(prefix)`.

```typescript
// src/lib/server/__tests__/cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { withCache, invalidate, invalidatePrefix } from '../cache';

describe('withCache', () => {
	beforeEach(() => {
		// Clear all cache entries used in tests
		invalidatePrefix('test:');
	});

	it('caches the result of fn for the TTL duration', async () => {
		let callCount = 0;
		const fn = async () => {
			callCount++;
			return 'value';
		};

		const first = await withCache('test:a', 5000, fn);
		const second = await withCache('test:a', 5000, fn);

		expect(first).toBe('value');
		expect(second).toBe('value');
		expect(callCount).toBe(1);
	});

	it('re-fetches after invalidation', async () => {
		let callCount = 0;
		const fn = async () => {
			callCount++;
			return `call-${callCount}`;
		};

		await withCache('test:b', 5000, fn);
		invalidate('test:b');
		const result = await withCache('test:b', 5000, fn);

		expect(result).toBe('call-2');
		expect(callCount).toBe(2);
	});

	it('invalidatePrefix clears all matching keys', async () => {
		let countA = 0, countB = 0;
		await withCache('test:x:1', 5000, async () => ++countA);
		await withCache('test:x:2', 5000, async () => ++countB);

		invalidatePrefix('test:x:');

		await withCache('test:x:1', 5000, async () => ++countA);
		await withCache('test:x:2', 5000, async () => ++countB);

		expect(countA).toBe(2);
		expect(countB).toBe(2);
	});
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test -- src/lib/server/__tests__/cache.test.ts`
Expected: 3 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/__tests__/cache.test.ts
git commit -m "test: cache withCache/invalidate/invalidatePrefix unit tests"
```

---

### Task 8: Rate Limiter

**Files:**
- Create: `src/lib/server/rate-limit.ts`
- Create: `src/lib/server/__tests__/rate-limit.test.ts`
- Modify: `src/hooks.server.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/server/__tests__/rate-limit.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, resetRateLimiter } from '../rate-limit';

describe('checkRateLimit', () => {
	beforeEach(() => {
		resetRateLimiter();
	});

	it('allows requests under the limit', () => {
		for (let i = 0; i < 10; i++) {
			expect(checkRateLimit('1.2.3.4', 10, 60000)).toBe(true);
		}
	});

	it('blocks requests over the limit', () => {
		for (let i = 0; i < 10; i++) {
			checkRateLimit('1.2.3.5', 10, 60000);
		}
		expect(checkRateLimit('1.2.3.5', 10, 60000)).toBe(false);
	});

	it('tracks IPs independently', () => {
		for (let i = 0; i < 10; i++) {
			checkRateLimit('1.1.1.1', 10, 60000);
		}
		expect(checkRateLimit('1.1.1.1', 10, 60000)).toBe(false);
		expect(checkRateLimit('2.2.2.2', 10, 60000)).toBe(true);
	});

	it('resets after window expires', () => {
		const shortWindow = 50; // 50ms
		for (let i = 0; i < 5; i++) {
			checkRateLimit('3.3.3.3', 5, shortWindow);
		}
		expect(checkRateLimit('3.3.3.3', 5, shortWindow)).toBe(false);

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(checkRateLimit('3.3.3.3', 5, shortWindow)).toBe(true);
				resolve();
			}, 60);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/server/__tests__/rate-limit.test.ts`
Expected: FAIL — cannot resolve `../rate-limit`

- [ ] **Step 3: Implement the rate limiter**

```typescript
// src/lib/server/rate-limit.ts
interface RateLimitEntry {
	timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
	if (cleanupInterval) return;
	cleanupInterval = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of store) {
			entry.timestamps = entry.timestamps.filter((t) => now - t < 120_000);
			if (entry.timestamps.length === 0) store.delete(key);
		}
	}, 60_000);
	// Don't keep process alive for cleanup
	if (cleanupInterval.unref) cleanupInterval.unref();
}

/**
 * Returns true if the request is allowed, false if rate-limited.
 */
export function checkRateLimit(ip: string, maxRequests: number, windowMs: number): boolean {
	ensureCleanup();
	const now = Date.now();
	let entry = store.get(ip);
	if (!entry) {
		entry = { timestamps: [] };
		store.set(ip, entry);
	}

	// Remove timestamps outside the window
	entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

	if (entry.timestamps.length >= maxRequests) {
		return false;
	}

	entry.timestamps.push(now);
	return true;
}

export function resetRateLimiter(): void {
	store.clear();
	if (cleanupInterval) {
		clearInterval(cleanupInterval);
		cleanupInterval = null;
	}
}

/**
 * Resolve client IP, respecting X-Forwarded-For when behind a reverse proxy.
 */
export function getClientIp(request: Request): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) {
		return forwarded.split(',')[0].trim();
	}
	// SvelteKit doesn't expose remoteAddress directly; fallback
	return '127.0.0.1';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/lib/server/__tests__/rate-limit.test.ts`
Expected: 4 tests pass

- [ ] **Step 5: Integrate rate limiter into hooks.server.ts**

Add to `src/hooks.server.ts`. Import at the top:

```typescript
import { checkRateLimit, getClientIp } from '$lib/server/rate-limit';
```

Add rate limiting logic early in the `handle` function, before auth checks (after the `noAuthPaths` definition):

```typescript
// Rate limiting
const clientIp = getClientIp(event.request);
const isAuthEndpoint = ['/login', '/setup', '/register', '/api/auth'].some(
	(p) => event.url.pathname.startsWith(p)
);
const limit = isAuthEndpoint ? 10 : 60;
const window = 60_000; // 1 minute

if (!checkRateLimit(clientIp, limit, window)) {
	return new Response(JSON.stringify({ error: 'Too many requests' }), {
		status: 429,
		headers: { 'Content-Type': 'application/json', 'Retry-After': '60' }
	});
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/rate-limit.ts src/lib/server/__tests__/rate-limit.test.ts src/hooks.server.ts
git commit -m "feat: in-memory rate limiting with X-Forwarded-For support"
```

---

### Task 9: Structured Logger

**Files:**
- Create: `src/lib/server/logger.ts`

- [ ] **Step 1: Create the logger module**

```typescript
// src/lib/server/logger.ts
const isDev = process.env.NODE_ENV !== 'production';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
	level: LogLevel;
	msg: string;
	ts: string;
	[key: string]: unknown;
}

function formatDev(entry: LogEntry): string {
	const colors: Record<LogLevel, string> = {
		info: '\x1b[36m',  // cyan
		warn: '\x1b[33m',  // yellow
		error: '\x1b[31m'  // red
	};
	const reset = '\x1b[0m';
	const extra = Object.entries(entry)
		.filter(([k]) => !['level', 'msg', 'ts'].includes(k))
		.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
		.join(' ');
	return `${colors[entry.level]}[${entry.level.toUpperCase()}]${reset} ${entry.msg}${extra ? ' ' + extra : ''}`;
}

function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
	const entry: LogEntry = {
		level,
		msg,
		ts: new Date().toISOString(),
		...data
	};

	const output = isDev ? formatDev(entry) : JSON.stringify(entry);
	const stream = level === 'error' ? process.stderr : process.stdout;
	stream.write(output + '\n');
}

export const logger = {
	info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
	warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
	error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data)
};
```

- [ ] **Step 2: Replace console calls in shutdown.ts**

Update `src/lib/server/shutdown.ts` to use the logger:

```typescript
import { logger } from './logger';
```

Replace `console.log` calls:
- `console.log(`[shutdown] Received ${signal}...`)` → `logger.info('Graceful shutdown initiated', { signal })`
- `console.log('[shutdown] Cleanup complete...')` → `logger.info('Shutdown cleanup complete, exiting')`

- [ ] **Step 3: Replace console calls in session-poller.ts**

Update `src/lib/server/session-poller.ts`:
- Add `import { logger } from './logger';`
- Replace `console.log('[session-poller]...')` with `logger.info(...)` equivalents
- Replace `console.error(...)` with `logger.error(...)` equivalents

**Skip this file if the books agent has modified it. Check `git status` first.**

- [ ] **Step 4: Replace console calls in stats-scheduler.ts**

Update `src/lib/server/stats-scheduler.ts`:
- Add `import { logger } from './logger';`
- Replace `console.log` → `logger.info`, `console.error` → `logger.error`

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/logger.ts src/lib/server/shutdown.ts src/lib/server/session-poller.ts src/lib/server/stats-scheduler.ts
git commit -m "feat: structured logger with JSON production output"
```

---

### Task 10: Playwright Setup

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/setup.spec.ts`
- Create: `e2e/auth.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create playwright.config.ts**

```typescript
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
```

- [ ] **Step 3: Create setup e2e test**

```typescript
// e2e/setup.spec.ts
import { test, expect } from '@playwright/test';

test.describe('First-run setup', () => {
	test('redirects to /setup when no users exist', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/setup/);
	});

	test('creates admin account and redirects to home', async ({ page }) => {
		await page.goto('/setup');

		await page.fill('input[name="username"]', 'testadmin');
		await page.fill('input[name="displayName"]', 'Test Admin');
		await page.fill('input[name="password"]', 'TestPassword123!');
		await page.fill('input[name="confirmPassword"]', 'TestPassword123!');
		await page.click('button[type="submit"]');

		// Should redirect to home after setup
		await expect(page).toHaveURL('/', { timeout: 10_000 });
	});
});
```

- [ ] **Step 4: Create auth e2e test**

```typescript
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
```

- [ ] **Step 5: Add e2e scripts to package.json**

Add to `"scripts"`:

```json
"test:e2e": "playwright test",
"test:all": "vitest run && playwright test"
```

- [ ] **Step 6: Build and run e2e tests locally**

```bash
pnpm build
pnpm test:e2e
```

Expected: Tests should pass (setup creates admin, auth tests use that admin)

Note: The e2e tests run in order — `setup.spec.ts` creates the admin user, `auth.spec.ts` depends on it. Playwright runs files in alphabetical order, so the naming ensures correct execution.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e/ package.json pnpm-lock.yaml
git commit -m "test: Playwright e2e tests for setup and auth flows"
```

---

### Task 11: GitHub Actions — CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm check

      - name: Unit tests
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Install Playwright
        run: npx playwright install chromium --with-deps

      - name: E2E tests
        run: pnpm test:e2e
        env:
          PORT: 8585
          DATABASE_URL: ./data/test-ci.db
          ORIGIN: http://localhost:8585
```

- [ ] **Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/ci.yml
git commit -m "ci: GitHub Actions CI pipeline with typecheck, test, build, e2e"
```

---

### Task 12: GitHub Actions — Release

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create release workflow**

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write
  packages: write

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  release:
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to ghcr.io
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          platforms: linux/amd64,linux/arm64
          tags: |
            ghcr.io/${{ github.repository }}:latest
            ghcr.io/${{ github.repository }}:${{ steps.version.outputs.VERSION }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: release workflow — Docker build + push to ghcr.io on tag"
```

---

## Sequential: Documentation & Polish

### Task 13: README Overhaul

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README.md**

Read the full file to understand what's there.

- [ ] **Step 2: Rewrite README.md**

Replace the full content. The new README should contain:

1. **Header** — Project name, one-line description, badges (CI status, ghcr.io, license)
2. **Screenshots** — placeholder for a screenshot (`<!-- TODO: add screenshot -->`)
3. **Features** — condensed list (Dashboard, Books, Games, Video, Social, Analytics)
4. **Quick Start — Docker** (recommended):
   ```bash
   mkdir nexus && cd nexus
   curl -O https://raw.githubusercontent.com/<owner>/nexus/main/.env.example
   cp .env.example .env
   curl -O https://raw.githubusercontent.com/<owner>/nexus/main/docker-compose.yml
   docker compose up -d
   ```
   Then visit `http://localhost:8585` and create admin account.

5. **Quick Start — From Source:**
   ```bash
   git clone https://github.com/<owner>/nexus.git && cd nexus
   cp .env.example .env
   pnpm install
   pnpm build
   PORT=8585 node build/index.js
   ```

6. **Supported Services** — table: Service, Type, Required/Optional, Notes
7. **Configuration** — all via Settings UI after first-run setup, env vars for port/db/origin
8. **Contributing** — link to CONTRIBUTING.md
9. **License** — whatever the project's license is

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README overhaul with Docker quick start"
```

---

### Task 14: CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create CONTRIBUTING.md**

```markdown
# Contributing to Nexus

## Dev Setup

**Prerequisites:** Node.js 22+, pnpm

```bash
git clone https://github.com/<owner>/nexus.git && cd nexus
cp .env.example .env
pnpm install
pnpm dev
```

Visit `http://localhost:5173` — the setup page will guide you through creating an admin account.

**Note (Node v25+):** If `better-sqlite3` fails to load, rebuild it:

```bash
cd node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3
npm run build-release
cd -
```

### Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (port 5173) |
| `pnpm build` | Production build |
| `pnpm check` | TypeScript + Svelte type checking |
| `pnpm test` | Run unit tests (vitest) |
| `pnpm test:e2e` | Run end-to-end tests (Playwright) |
| `pnpm db:studio` | Open Drizzle Studio (visual DB editor) |

## Project Structure

```
src/
├── lib/
│   ├── adapters/      # Service adapters (jellyfin, radarr, etc.)
│   ├── components/    # Shared Svelte components
│   ├── db/            # Drizzle ORM schema + initialization
│   ├── server/        # Server-side logic (auth, cache, analytics)
│   ├── stores/        # Svelte stores (client-side state)
│   └── types/         # TypeScript types
├── routes/
│   ├── api/           # REST API endpoints
│   ├── admin/         # Admin dashboard
│   ├── settings/      # User settings
│   └── ...            # Page routes (movies, shows, games, etc.)
└── hooks.server.ts    # Auth middleware, security headers, startup
```

See [BACKEND.md](docs/BACKEND.md) for detailed architecture docs.

## Adding a Service Adapter

Service adapters live in `src/lib/adapters/`. Each adapter:

1. Exports a default object implementing the adapter interface
2. Provides `ping(config)` for health checks
3. Provides browsing methods (`getLibrary`, `search`, `getItem`, etc.)
4. Is registered in `src/lib/adapters/index.ts`

Look at `src/lib/adapters/jellyfin.ts` as a reference implementation.

## Pull Request Guidelines

- Branch from `main`
- `pnpm check` passes (no type errors)
- `pnpm test` passes (no test failures)
- One feature or fix per PR — keep PRs focused
- Follow existing code patterns and naming conventions
- Prettier handles formatting (`pnpm format` if needed)
```

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: CONTRIBUTING.md with dev setup and PR guidelines"
```

---

### Task 15: Setup Flow Polish

**Files:**
- Modify: `src/routes/setup/+page.svelte`

- [ ] **Step 1: Read the current setup page**

Read `src/routes/setup/+page.svelte` to understand the current post-setup behavior.

- [ ] **Step 2: Add post-setup guidance**

After admin account creation succeeds, instead of immediately redirecting to `/`, redirect to `/admin` (or show an inline message) with guidance:

The approach depends on what the current setup page does. Options:
- If it redirects via `goto('/')`, change to `goto('/admin')` so the admin lands on the service management page
- Or add a success state that shows: "Account created! Next: add your Jellyfin server in Settings → Services" with a button linking to `/admin`

The exact implementation depends on the current page structure — read it first, then make the minimal change that guides the user to configure their first service.

- [ ] **Step 3: Commit**

```bash
git add src/routes/setup/+page.svelte
git commit -m "feat: guide new admin to add first service after setup"
```

---

### Task 16: Version Bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version to 0.1.0-beta.1**

In `package.json`, change `"version": "0.0.1"` to `"version": "0.1.0-beta.1"`.

- [ ] **Step 2: Commit and tag**

```bash
git add package.json
git commit -m "chore: bump version to 0.1.0-beta.1"
```

Do NOT tag yet — tagging triggers the release workflow. Tag after the PR is merged to main.

---

## Execution Order

Tasks 1–5 (Track A: Deployment) and Tasks 6–12 (Track B: Testing/CI) can run in parallel. Tasks 8 and 9 depend on Task 6 (vitest setup).

Tasks 13–16 (Documentation & Polish) run sequentially after both tracks complete.

```
Track A: 1 → 2 → 3 → 4 → 5
Track B: 6 → 7 → 8 → 9 → 10 → 11 → 12
                                         \
                                          → 13 → 14 → 15 → 16
                                         /
Track A ─────────────────────────────────
```

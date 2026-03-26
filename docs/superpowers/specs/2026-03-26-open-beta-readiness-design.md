# Open Beta Readiness — Design Spec

**Date:** 2026-03-26
**Goal:** Prepare Nexus for self-hosted open source beta release, targeting technical self-hosters (Docker-comfortable media stack users) and developer contributors.

---

## 1. Docker & Deployment

### Dockerfile (multi-stage)

1. **Stage 1 — deps:** `node:22-alpine`. Install pnpm, copy `package.json` + `pnpm-lock.yaml`, run `pnpm install --frozen-lockfile`. This rebuilds `better-sqlite3` natively against the container's architecture, eliminating ABI mismatch issues.
2. **Stage 2 — build:** Copy source, run `pnpm build` (SvelteKit node adapter outputs to `build/`).
3. **Stage 3 — runtime:** Clean alpine image. Copy `build/`, production `node_modules`, `package.json`, `drizzle/`. Expose port 8585. Run `node build/index.js`.

### docker-compose.yml

```yaml
services:
  nexus:
    image: ghcr.io/<owner>/nexus:latest
    ports: ["8585:8585"]
    volumes:
      - nexus-data:/app/data
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8585/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
volumes:
  nexus-data:
```

Port 8585 follows the *arr stack repeating-pair convention (Sonarr 8989, Radarr 7878, etc.).

### Health endpoint

`GET /api/health` returns `{ status: "ok", version: "<pkg version>" }` with 200. Runs a simple DB read query to verify connectivity. Used by Docker healthcheck and load balancers.

### .env.example

```env
# Database path (relative to /app/data in Docker, or absolute)
DATABASE_URL=./data/nexus.db

# Server
PORT=8585
ORIGIN=http://localhost:8585
```

### Database path

`DATABASE_URL` defaults to `./data/nexus.db`. The `data/` directory is auto-created if it doesn't exist. This path lives inside the Docker volume mount, so the database persists across container restarts.

---

## 2. Testing

### Vitest — unit/integration tests

Test against real SQLite (in-memory or temp file), no mocking.

- `src/lib/server/__tests__/auth.test.ts` — session creation, password hashing (scrypt), invite code validation, session expiry
- `src/lib/server/__tests__/cache.test.ts` — TTL behavior, invalidation, prefix invalidation
- `src/lib/server/__tests__/services.test.ts` — health check timeouts, adapter resolution, `resolveUserCred`
- `src/lib/db/__tests__/schema.test.ts` — table creation, migration safety, index presence

### Playwright — e2e critical flows

- `e2e/setup.spec.ts` — first-run: create admin account at `/setup`, verify redirect to homepage
- `e2e/auth.spec.ts` — login, logout, session expiry redirect, `/login?next=` preservation
- `e2e/services.spec.ts` — admin adds a service, verify it appears in settings, health check runs
- `e2e/browse.spec.ts` — homepage loads, navigate to a media category page

### Package.json scripts

```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test",
"test:all": "vitest run && playwright test"
```

---

## 3. CI/CD — GitHub Actions

### ci.yml — runs on push and PR to main

1. **Lint & typecheck** — `pnpm check`
2. **Unit tests** — `pnpm test`
3. **Build** — `pnpm build`
4. **E2e tests** — `pnpm test:e2e` (Playwright against the built app)

### release.yml — runs on tag push (v*)

1. Run the full CI pipeline
2. Build multi-platform Docker image (`linux/amd64`, `linux/arm64`)
3. Push to `ghcr.io/<owner>/nexus:latest` and `ghcr.io/<owner>/nexus:<version>`
4. Create GitHub Release

### Branch protection (manual setup)

Require CI to pass before merging to `main`. Configured in GitHub repo settings, not automated.

---

## 4. Application Readiness

### Pre-requisite: merge feat/account-linking-redesign

The account linking, watchlist, collections, and library features must land on `main` before cutting the beta.

### Rate limiting

In-memory rate limiter in `hooks.server.ts`:
- API endpoints: 60 requests/minute per IP
- Auth endpoints (login, register, setup): 10 requests/minute per IP
- Sliding window Map with periodic cleanup (every 60s, evict entries older than window)
- Respects `X-Forwarded-For` header when behind a reverse proxy (common in Docker setups)
- No external dependencies (no Redis)

### Structured logging

`src/lib/server/logger.ts` — thin wrapper, no external dependencies:
- Levels: `info`, `warn`, `error`
- Production: structured JSON to stdout (parseable by Loki, Datadog, etc.)
- Development: pretty-printed with colors
- Replace scattered `console.log`/`console.error` calls across server code

### Graceful shutdown

Handle `SIGTERM` and `SIGINT`:
1. Stop accepting new HTTP connections
2. Stop session poller (`clearInterval`)
3. Stop stats scheduler (`clearInterval`)
4. Close WebSocket connections
5. Close SQLite database connection
6. Exit process

Prevents database corruption on `docker stop`.

### Database path flexibility

- `DATABASE_URL` accepts relative and absolute paths
- Default: `./data/nexus.db`
- Auto-create `data/` directory if missing

### Setup flow polish

After admin account creation at `/setup`, guide the user to add their first service (Jellyfin). The post-setup state should make it obvious what to do next rather than landing on an empty homepage.

---

## 5. Documentation

### README.md overhaul

- Quick start with Docker: pull image, create `.env` from example, `docker-compose up`
- Quick start without Docker: clone, `pnpm install`, `pnpm build`, `PORT=8585 node build`
- Supported services table with version requirements
- Feature overview with screenshots
- Link to CONTRIBUTING.md

### CONTRIBUTING.md

- **Dev setup:** Prerequisites (Node 22+, pnpm), clone, install, `better-sqlite3` rebuild note, `pnpm dev`
- **Project structure:** Brief map of adapters, server, routes, components. Points to BACKEND.md for architecture.
- **Adding a service adapter:** The most likely contribution — brief guide on the adapter pattern, what to implement, how to register.
- **Running tests:** `pnpm test`, `pnpm test:e2e`, `pnpm check`
- **PR guidelines:** Branch from main, tests pass, typecheck clean, one feature/fix per PR. No special commit format. Follow existing patterns, Prettier handles formatting.

### .env.example

All variables documented with inline comments.

---

## Implementation Order

Two parallel tracks, then sequential follow-up:

**Track A — Deployment:**
1. Health endpoint (`/api/health`)
2. Dockerfile (multi-stage)
3. docker-compose.yml
4. `.env.example`

**Track B — Testing & CI:**
1. Vitest setup + server tests
2. Playwright setup + e2e tests
3. GitHub Actions ci.yml
4. GitHub Actions release.yml (build + push to ghcr.io)

**Sequential (after both tracks):**
1. Rate limiting in hooks.server.ts
2. Structured logger + replace console calls
3. Graceful shutdown handler
4. Setup flow polish
5. README overhaul
6. CONTRIBUTING.md

**Pre-requisite (before all):**
- Merge `feat/account-linking-redesign` into `main`

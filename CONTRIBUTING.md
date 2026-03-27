# Contributing to Nexus

## Dev Setup

**Prerequisites:** Node.js 22+, pnpm

```bash
git clone https://github.com/parkerbugg/nexus.git && cd nexus
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

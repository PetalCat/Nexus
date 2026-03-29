# Contributing

Welcome, and thanks for your interest in contributing!

This project was built with heavy AI assistance and is actively evolving. Contributions are welcome, but the primary focus is working behavior, reliability, and clear testing.

There are many ways to contribute beyond writing code. This document provides a high-level overview of how to get involved.

---

## Asking Questions

If you have a question about the project, feel free to open a discussion or issue.

Clear, well-structured questions help both maintainers and future contributors.

---

## Providing Feedback

Feedback is always welcome.

If something feels off, confusing, or broken in real usage, that is valuable information. This project prioritizes real-world behavior, so user experience feedback matters.

---

## Reporting Issues

Found a bug or have a feature request? Please open an issue.

**Before creating an issue:**
- Check existing issues to avoid duplicates
- Try to reproduce the problem consistently

**Writing good bug reports — please include:**
- Your environment (OS, browser, etc. if relevant)
- Clear reproduction steps (1, 2, 3...)
- What you expected to happen
- What actually happened
- Screenshots or recordings if helpful

**If we cannot reproduce it, we cannot fix it.**

---

## Contributing Changes

### Core Principle

If it works reliably and doesn't break existing behavior, it's good.

### What Matters Most

- Your change must work in real usage
- Your change must not break existing features
- You must test what you submit
- You must be able to explain your change

You are not expected to understand the entire codebase — only your contribution.

### Pull Request Guidelines

Keep PRs:
- Small and focused
- Easy to review
- Limited to one clear change

**Every PR must include:**

- **What does this change do?** Explain in plain English.
- **Why is this needed?** What problem does it solve?
- **What did you test?** Describe what you actually did.
- **How can this be tested?** Step-by-step instructions.
- **What could this affect?** Call out possible side effects.

---

## Testing Requirements

Testing is the most important part of contributing.

**Acceptable testing:**
- Manual testing (preferred)
- Real usage scenarios
- Edge cases if relevant

**Not acceptable:**
- "It should work"
- No testing performed
- Blind AI-generated code

---

## Performance Expectations

Performance is not the primary focus of this project, but contributions should avoid noticeable slowdowns or regressions.

**Guidelines:**
- Do not introduce significant delays in normal usage
- Avoid unnecessary heavy operations (e.g. excessive loops, repeated network calls)
- Keep performance roughly consistent with existing behavior

**When performance matters** — if your change affects rendering speed, load times, API response time, or frequently executed logic, include a brief note on performance impact and any observed before/after differences (informal is fine).

**Simple rule:** If a user would notice it being slower, it needs justification.

---

## AI Usage

AI tools (like Claude Code, Copilot, ChatGPT) are allowed.

However:
- You must test all AI-generated code
- You must understand the behavior of what you submit
- Do not submit large, unverified AI-generated changes

---

## What Will Likely Be Rejected

- Untested changes
- Changes that break existing behavior
- Large PRs with unclear purpose
- Code that cannot be explained

---

## Project State

This codebase is still being actively understood and refined.

Because of that:
- Simplicity is preferred over cleverness
- Clear behavior is preferred over complex implementations
- Incremental improvements are preferred over large rewrites

---

## Follow-Up

After submitting a PR:
- Be responsive to feedback
- Be open to making changes
- Help verify fixes if requested

---

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

Service adapters live in `src/lib/adapters/`. Nexus uses a plugin-like adapter system — the adapter handles all service-specific logic, Nexus handles everything else.

**What the adapter provides:**
- Connection details (ping, API calls, auth headers)
- Data normalization (service-specific format → `UnifiedMedia`)
- Capability declaration (`isLibrary`, `isSearchable`, `mediaTypes`, etc.)

**What Nexus provides automatically once registered:**
- Service management UI (add/edit/remove in admin panel)
- Health monitoring and recovery detection
- Per-user credential storage and account linking
- Dashboard, search, and media detail pages
- Image proxying and optimization
- Caching, rate limiting, and timeouts
- Analytics and recommendation engine

### Minimal adapter example

```typescript
import type { ServiceAdapter } from './base';

export const myAdapter: ServiceAdapter = {
  id: 'my-service',
  displayName: 'My Service',
  defaultPort: 8080,
  color: '#ff6600',
  abbreviation: 'MS',
  mediaTypes: ['movie', 'show'],
  isLibrary: true,
  isSearchable: true,
  searchPriority: 1,

  async ping(config) {
    const res = await fetch(`${config.url}/api/health`);
    return {
      serviceId: config.id, name: config.name,
      type: 'my-service', online: res.ok
    };
  },

  async search(config, query) {
    // Call your service's API, return { items: UnifiedMedia[], total, source }
  },

  async getLibrary(config, opts) {
    // Paginated library browsing → { items: UnifiedMedia[], total }
  },
};
```

Register in `src/lib/adapters/registry.ts`:
```typescript
import { myAdapter } from './my-service';
registry.register(myAdapter);
```

That's it — no other files to touch. See `src/lib/adapters/base.ts` for the full interface with all optional methods. Look at `src/lib/adapters/jellyfin.ts` as a comprehensive reference implementation.

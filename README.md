# Nexus

Your unified, self-hosted media platform. One interface for all your media servers.

Nexus aggregates content from your self-hosted services — Jellyfin, Calibre-Web, RomM, Invidious, and more — into a single, polished dashboard with social features, in-browser playback, and personalized recommendations.

## Features

**Media**
- Unified dashboard with continue watching, recently added, and personalized recommendations
- Browse and search across movies, shows, music, books, games, and videos
- Rich detail pages with metadata, ratings, and related content
- Media requesting via Overseerr integration
- Live TV from Jellyfin

**Books**
- In-browser EPUB reader (epub.js) with highlights, bookmarks, and notes
- Skeuomorphic bookshelf view, series browsing, author pages
- Reading statistics, goals, and session tracking
- Notes & highlights hub with Markdown/JSON export

**Games**
- In-browser retro game emulation via EmulatorJS
- Save state management (upload, download, sync to RomM)
- RetroAchievements + HowLongToBeat metadata display
- Collections, advanced filtering, platform pages

**Video**
- YouTube alternative frontend via Invidious
- Subscriptions, playlists, watch history
- Video streaming with HLS support

**Social**
- Friend system with presence (online/away/DND)
- Watch parties, listen parties, co-op gaming sessions
- Activity feed and shared items

**Other**
- Invite-based registration with admin approval
- Command palette (Cmd/Ctrl+K) for quick navigation
- Real-time WebSocket notifications
- Background analytics and recommendation engine
- Responsive dark theme with warm color palette

## Integrations

| Service | Type | Features |
|---|---|---|
| Jellyfin | Media server | Movies, shows, music, live TV, streaming, auth |
| Overseerr | Requests | Discover, request, approve/deny media |
| Sonarr | TV management | Library, queue, calendar |
| Radarr | Movie management | Library, queue, calendar |
| Lidarr | Music management | Artists, albums, queue |
| Prowlarr | Indexers | Indexer stats (admin) |
| Bazarr | Subtitles | Subtitle status for Sonarr/Radarr |
| Calibre-Web | Books | Library, reading, OPDS |
| Invidious | Videos | YouTube browsing, subscriptions, playlists |
| RomM | Games | ROM library, emulation, saves |
| StreamyStats | Analytics | Personalized recommendations |

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

On first visit, you'll be redirected to `/setup` to create the admin account. Then configure your services via Settings.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `./nexus.db` | Path to the SQLite database file |

All service connections (URLs, API keys, credentials) are configured through the Settings UI and stored in the database.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build |
| `pnpm preview` | Preview production build |
| `pnpm check` | Type-check with svelte-check |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm format` | Format with Prettier |

## Tech Stack

- **SvelteKit** (v2) + **Svelte 5** — Framework
- **TypeScript** — Language
- **Tailwind CSS** v4 — Styling
- **SQLite** + **Drizzle ORM** — Database
- **WebSockets** (ws) — Real-time
- **epub.js** — Book reader
- **hls.js** — Video streaming
- **EmulatorJS** (CDN) — Game emulation

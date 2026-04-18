# Nexus

**One interface for your entire self-hosted media library** — movies, shows, music, books, games, and videos, across all your existing services. Nexus doesn't replace Jellyfin / Plex / Calibre / whatever you already run — it sits on top and gives you one homepage, one search, one player, one set of stats.

[![CI](https://github.com/PetalCat/Nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/PetalCat/Nexus/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/tag/PetalCat/Nexus?label=latest&sort=semver)](https://github.com/PetalCat/Nexus/releases)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

> **Status: public beta.** The playback path for Jellyfin + Plex + Invidious works, and the core browse/search/discovery surface is solid. Expect rough edges around Calibre UI polish, some settings pages, and the Collections/Watchlist feature which isn't merged yet. File a bug with `Cmd+Alt+B` from any page — it opens a prefilled GitHub issue. See [What's not ready yet](#whats-not-ready-yet) below.

## What Nexus Does

Nexus connects to your existing media services and brings them together into a single interface. It doesn't replace your media server, download manager, or library tools — it sits on top of them and gives you one place to browse, play, discover, and manage everything.

**You configure your services. Nexus handles the rest.**

## Who Is This For

Self-hosters running multiple media services who want:

- One login, one interface, one search bar across everything
- A real homepage — not a list of links to separate apps
- Cross-service features that no individual app can do alone (unified calendar, franchise pages, quality dashboards, wrapped stats)
- A player that works for movies, shows, music, books, games, and videos

## Highlights

**Unified media experience** — Browse and play movies, shows, music, books, games (via in-browser emulation), live TV, and privacy-respecting video all from the same interface.

**Smart discovery** — Personalized recommendations, trending content, upcoming releases calendar, genre/network browsing, and cross-media franchise pages. Discover content you didn't know was in your library.

**Cross-service intelligence** — Continue watching across all media types. Quality dashboards. Subtitle management. Annual wrapped stats. Features that only work because Nexus sees everything.

**Per-user accounts** — Each user links their own service credentials. Your library, your recommendations, your stats. Admin controls for provisioning and management.

**Adapter architecture** — Adding support for a new service is one file and one line of code. The adapter handles all service-specific logic; Nexus handles everything else.

## Supported Services

| Service | Status | What it provides |
|---------|--------|-----------------|
| **Jellyfin** | ✅ stable | Media server — movies, shows, music, live TV |
| **Plex** | ✅ beta | Media server — movies, shows, music (playback path stabilized in v0.1.0-beta.2) |
| **Invidious** | ✅ stable | Privacy-respecting YouTube alternative (transcode pipe via Rust stream-proxy) |
| **Calibre-Web** | ✅ beta | Book library — OPDS browse, search, formats, in-browser reader. UI polish ongoing |
| **RomM** | ✅ stable | Retro game ROM management with in-browser emulation |
| **Overseerr / Seerr** | ✅ stable | Media requests and TMDB-powered discovery |
| **Radarr / Sonarr / Lidarr** | ✅ stable | Calendar, queue, quality profiles |
| **Bazarr** | ✅ stable | Subtitle management, sync, translation |
| **Prowlarr** | ✅ stable | Indexer management and stats |
| **StreamyStats** | ✅ stable | ML-powered recommendations and analytics |

New adapters can be added by contributors without modifying any existing code. See [CONTRIBUTING.md](CONTRIBUTING.md) for the adapter development guide.

## Quick Start — Docker

```bash
mkdir nexus && cd nexus
wget https://raw.githubusercontent.com/PetalCat/Nexus/main/docker-compose.yml
wget https://raw.githubusercontent.com/PetalCat/Nexus/main/.env.example -O .env
docker compose up -d
```

Visit `http://localhost:8585`, create your admin account on the `/welcome` wizard, and add your services through Settings → Services.

On first boot Nexus auto-generates an AES-256 key at `/app/data/.nexus-encryption-key` (inside the volume) to encrypt stored service passwords. **Back up the `nexus-data` volume** — losing the key invalidates every linked credential. For env-var-managed key rotation set `NEXUS_ENCRYPTION_KEY` explicitly in `.env` (run `openssl rand -hex 32`).

## Quick Start — From Source

```bash
git clone https://github.com/PetalCat/Nexus.git && cd nexus
cp .env.example .env
pnpm install
pnpm build
PORT=8585 node build/index.js
```

## Configuration

All service connections are configured through the web UI after first-run setup.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `./data/nexus.db` | Path to SQLite database |
| `PORT` | `8585` | HTTP port |
| `ORIGIN` | `http://localhost:8585` | Public URL (required behind a reverse proxy) |
| `NEXUS_ENCRYPTION_KEY` | auto-generated | 32-byte key (64 hex or base64) for service credential encryption |
| `NEXUS_TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy to honor `X-Forwarded-For` |
| `NEXUS_TELEMETRY_DISABLED` | unset | Set to `1` to disable server-side storage of client crash reports |

See [`.env.example`](.env.example) for the full list including rate-limiting, subtitle size caps, and cache tuning.

## What's not ready yet

Honest list so you know what to expect before installing:

- **Calibre books UI** — Adapter + data flow work, but the `/books` UI is getting a rewrite. Books render and open, detail pages work; layout will improve.
- **Collections & Watchlist** — Feature branch exists with the data model and UI (~20 commits) but is unmerged; rebase scheduled before the public launch.
- **arm64 image** — Added in v0.1.0-beta.3. Earlier beta images were amd64-only.
- **Documentation** — This README is the documentation. No separate docs site yet; `/welcome` wizard plus the adapter walkthroughs in [CONTRIBUTING.md](CONTRIBUTING.md) are it for now.
- **Error telemetry** — Server logs client-side crashes (opt out with `NEXUS_TELEMETRY_DISABLED=1`). No Sentry/Glitchtip wiring yet; planned for post-beta.

## Reporting bugs

From any page in Nexus: `Cmd+Alt+B` (or `Ctrl+Alt+B`) opens a bug report dialog. It auto-fills the URL, your browser, the build version, and any JS errors caught in the last minute, then opens a prefilled GitHub issue in a new tab — you review + click Submit.

You can also file issues directly: <https://github.com/PetalCat/Nexus/issues/new>. For open-ended questions or feature ideas, use [Discussions](https://github.com/PetalCat/Nexus/discussions) instead.

## Project status

Active development, public beta. Current release: see the badge above. Releases are tagged `vX.Y.Z-beta.N` and published to [ghcr.io/petalcat/nexus](https://github.com/PetalCat/Nexus/pkgs/container/nexus) for both `linux/amd64` and `linux/arm64`.

See [ROADMAP.md](docs/ROADMAP.md) for milestone tracking.

## Development Note

This project is built with heavy AI assistance (Claude Code). All code is reviewed, tested, and maintained by humans. See [CONTRIBUTING.md](CONTRIBUTING.md) for AI usage policy and contribution guidelines.

## Tech Stack

- **SvelteKit** + **Svelte 5** — fullstack framework
- **Tailwind CSS 4** — styling
- **SQLite** + **Drizzle ORM** — database
- **better-sqlite3** — native SQLite driver

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, adapter guide, and contribution guidelines.

## License

AGPL-3.0 — see [LICENSE](LICENSE).

This project is built with AI assistance (Claude Code, Codex). Copyright applies to human-authored and human-directed portions under current law. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

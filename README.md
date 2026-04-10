# Nexus

One interface for your entire media library — movies, shows, music, books, games, and videos — across all your self-hosted services.

![CI](https://github.com/PetalCat/Nexus/actions/workflows/ci.yml/badge.svg)

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

| Service | What it provides |
|---------|-----------------|
| Jellyfin | Media server — movies, shows, music, live TV |
| Plex | Media server — movies, shows, music |
| Overseerr / Seerr | Media requests and TMDB-powered discovery |
| Radarr | Movie management, calendar, quality profiles |
| Sonarr | TV show management, calendar, quality profiles |
| Lidarr | Music management, calendar, quality profiles |
| Bazarr | Subtitle management, sync, translation |
| Prowlarr | Indexer management and stats |
| Calibre-Web | Book library with in-browser EPUB/PDF reader |
| RomM | Retro game ROM management with in-browser emulation |
| Invidious | Privacy-respecting YouTube alternative |
| StreamyStats | ML-powered recommendations and analytics |

New adapters can be added by contributors without modifying any existing code. See [CONTRIBUTING.md](CONTRIBUTING.md) for the adapter development guide.

## Quick Start — Docker

```bash
mkdir nexus && cd nexus
wget https://raw.githubusercontent.com/PetalCat/Nexus/main/docker-compose.yml
wget https://raw.githubusercontent.com/PetalCat/Nexus/main/.env.example
cp .env.example .env
docker compose up -d
```

Visit `http://localhost:8585` and create your admin account. Add your services through Settings.

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
| `DATABASE_URL` | `./nexus.db` | Path to SQLite database |
| `PORT` | `3000` | HTTP port |
| `ORIGIN` | — | Public URL (required for production) |

See `.env.example` for the full list.

## Project Status

Nexus is in active development approaching open beta. The core platform is functional with the services listed above. New features, adapters, and improvements ship frequently.

See [ROADMAP.md](docs/ROADMAP.md) for the full development roadmap and milestone tracking.

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

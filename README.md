# Nexus

A unified self-hosted media platform.

![CI](https://github.com/parkerbugg/nexus/actions/workflows/ci.yml/badge.svg)


<!-- TODO: add screenshot -->

## Features

- **Dashboard** — Continue watching, recently added, personalized recommendations
- **Movies & Shows** — Browse and stream via Jellyfin
- **Books** — In-browser EPUB and PDF reader
- **Games** — In-browser retro emulation via EmulatorJS (RomM)
- **Video** — YouTube alternative frontend via Invidious
- **Music** — Browse and stream via Jellyfin
- **Social** — Friends, watch parties, presence
- **Analytics** — Play history, stats, yearly wrapped
- **Requests** — Overseerr integration for media requests
- **Search** — Unified cross-service search

## Quick Start — Docker (recommended)

```bash
mkdir nexus && cd nexus
wget https://raw.githubusercontent.com/parkerbugg/nexus/main/docker-compose.yml
wget https://raw.githubusercontent.com/parkerbugg/nexus/main/.env.example
cp .env.example .env
docker compose up -d
```

Visit `http://localhost:8585` and create your admin account.

## Quick Start — From Source

```bash
git clone https://github.com/parkerbugg/nexus.git && cd nexus
cp .env.example .env
pnpm install
pnpm build
PORT=8585 node build/index.js
```

## Supported Services

| Service | Type | Required | Notes |
|---------|------|----------|-------|
| Jellyfin | Media Server | Yes | Core media source |
| Overseerr | Requests | No | Media requests |
| Sonarr | TV Management | No | Show metadata |
| Radarr | Movie Management | No | Movie metadata |
| Lidarr | Music Management | No | Music metadata |
| Bazarr | Subtitles | No | Subtitle enrichment |
| Prowlarr | Indexer | No | Search indexers |
| RomM | Games | No | ROM management |
| StreamyStats | Analytics | No | Recommendations |
| Calibre-Web | Books | No | Book library — or use built-in reader |

## Configuration

All service connections are configured through the web UI after first-run setup.

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `./nexus.db` | Path to the SQLite database file |
| `PORT` | `3000` | HTTP port |
| `ORIGIN` | — | Public URL (required for production) |

See `.env.example` for the full list.

## Tech Stack

- **SvelteKit 2** + **Svelte 5**
- **Tailwind CSS 4**
- **SQLite** + **Drizzle ORM**
- **better-sqlite3**

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

All rights reserved. Copyright 2026.

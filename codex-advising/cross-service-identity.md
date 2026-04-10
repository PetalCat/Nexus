# Cross-Service Identity Research

## Goal

Capture the current state of cross-service identity in Nexus and explain why it matters for:

- franchise pages
- recommendations
- wrapped
- unified calendar
- continue watching

This is advisory research, not a design mandate.

## Current Data Model Reality

`UnifiedMedia` is intentionally generic:

- `sourceId`
- `serviceId`
- `serviceType`
- optional `metadata`

This is flexible, but it means cross-service identity depends heavily on:

- optional provider metadata
- service-specific IDs stored in `metadata`
- best-effort matching logic

## What Local Code Shows

Examples of identity-bearing metadata in adapters:

- Radarr:
  - `tmdbId`
  - `collectionId`
- Sonarr:
  - show/series metadata with TV-related IDs
- Jellyfin:
  - `ProviderIds?.Tmdb`
  - episode `seriesId`
- Overseerr:
  - TMDB-backed IDs and media info
- Bazarr:
  - `tmdbId`, `radarrId`, `sonarrId`, `seriesId`
- Lidarr:
  - `foreignAlbumId`
- RomM / games:
  - local service IDs dominate
- Calibre:
  - mostly local IDs and book metadata

## Current Franchise Logic

`src/lib/server/franchise.ts` currently:

- searches every enabled service by franchise name
- groups results by media type
- deduplicates using `sourceId + serviceId`

This means the current local approach is:

- name-based
- best-effort
- per-service dedup only

It is not yet a true cross-service identity graph.

## Practical Consequence

Features that sound cross-service-intelligent may currently depend on:

- title/name search
- partial metadata overlap
- TMDB where available

rather than a stable universal identity layer.

## Why This Matters

### Franchise pages

Need more than name search if they are meant to be precise.

### Wrapped / recommendations

Cross-service aggregation benefits from stable IDs or at least repeatable matching rules.

### Unified calendar

Less strict identity is needed here, but dedup and linking still benefit from strong metadata.

### Universal Continue

May need looser aggregation than franchise pages, but still benefits from consistent identifiers.

## Advisory Research Direction

Claude should think about identity in layers, not as one all-or-nothing system:

### Layer 1: service-local identity

- `sourceId + serviceId`

### Layer 2: provider-linked identity

- TMDB
- TVDB
- music provider IDs
- other upstream identifiers where available

### Layer 3: fallback heuristic identity

- normalized titles
- release year
- media type
- creator/series/franchise names

## Advisory Questions for Claude

- Which cross-service features require strict matching vs “good enough” grouping?
- Where can TMDB serve as the real join key?
- Which media domains lack strong shared IDs today?
- Should franchise pages explicitly be labeled as best-effort if matching remains fuzzy?

## Best Use of This Research

Use it when reviewing `#41`, `#42`, `#43`, `#46`, and `#48`, or when touching `src/lib/server/franchise.ts`.

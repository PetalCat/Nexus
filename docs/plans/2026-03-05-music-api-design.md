# Music API Layer — Design

## Overview

Add a first-class music API layer to Nexus, wrapping the existing Jellyfin adapter for playback/browse and extending the Lidarr adapter for metadata enrichment. Playlists, liked tracks, and recently-played are persisted in the Nexus DB.

## Architecture

```
Frontend (musicStore.svelte.ts)
  → /api/music/* endpoints
    → Jellyfin adapter  (albums, tracks, artists, streaming)
    → Lidarr adapter    (enrichment: monitored, availability, wanted)
    → Nexus DB          (liked tracks, playlists, recently played via media_events)
```

Client-side player state (queue, current track, progress, volume, shuffle, repeat) stays ephemeral in the Svelte store — no backend persistence needed.

## Jellyfin Adapter Extensions

New functions in `jellyfin.ts`:

| Function | Jellyfin Endpoint | Returns |
|----------|------------------|---------|
| `getAlbums(config, userCred, opts)` | `GET /Users/{id}/Items?IncludeItemTypes=MusicAlbum` | Albums with artist, year, track count |
| `getAlbumTracks(config, userCred, albumId)` | `GET /Users/{id}/Items?ParentId={albumId}&IncludeItemTypes=Audio&SortBy=ParentIndexNumber,IndexNumber` | Ordered tracks |
| `getArtists(config, userCred, opts)` | `GET /Artists?userId={id}` | Artist list with album count, image |
| `getArtistAlbums(config, userCred, artistId)` | `GET /Users/{id}/Items?ArtistIds={id}&IncludeItemTypes=MusicAlbum` | Albums by artist |
| `getInstantMix(config, userCred, itemId)` | `GET /Items/{id}/InstantMix?userId={id}` | Jellyfin's recommendation engine |

### Normalize Enhancement

Add to music/album items in `normalize()`:
- `metadata.artist` — `item.AlbumArtist ?? item.Artists?.[0]`
- `metadata.artistId` — `item.ArtistItems?.[0]?.Id`
- `metadata.albumId` — `item.AlbumId` (for tracks)
- `metadata.albumName` — `item.Album` (for tracks)
- `metadata.trackNumber` — `item.IndexNumber`
- `metadata.discNumber` — `item.ParentIndexNumber`

## Lidarr Adapter Extensions

Role: read-only metadata enrichment (admin API key, no per-user accounts). Mirrors the Bazarr enrichment pattern.

New functions in `lidarr.ts`:

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `getAllArtists(config)` | `GET /api/v1/artist` | All monitored artists |
| `getArtist(config, id)` | `GET /api/v1/artist/{id}` | Artist detail with overview, images |
| `getArtistAlbums(config, artistId)` | `GET /api/v1/album?artistId={id}` | Albums with availability % |
| `getWantedAlbums(config, opts)` | `GET /api/v1/wanted/missing` | Missing/wanted albums |
| `getQueue(config)` | `GET /api/v1/queue` | Currently downloading |

### Enrichment

When music API serves albums/artists and a Lidarr service is configured, match by name and inject:
- `metadata.lidarr.monitored` (boolean)
- `metadata.lidarr.percentAvailable` (0-100)
- `metadata.lidarr.missing` (missing track count)

Cached with `withCache()`, 2-min TTL. Graceful no-op if Lidarr not configured.

## API Endpoints

### Browse (Jellyfin-backed)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/music/albums` | GET | List albums. Query: `genre`, `artistId`, `sort`, `limit`, `offset`, `serviceId` |
| `/api/music/albums/[id]` | GET | Album detail + track listing |
| `/api/music/artists` | GET | List artists. Query: `sort`, `limit`, `offset`, `serviceId` |
| `/api/music/artists/[id]` | GET | Artist detail + albums |
| `/api/music/instant-mix/[id]` | GET | Recommendation tracks based on item |

### User Data (Nexus DB)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/music/liked` | GET | Liked tracks list |
| `/api/music/liked` | POST | Like a track `{ trackId, serviceId }` |
| `/api/music/liked` | DELETE | Unlike `?trackId=&serviceId=` |
| `/api/music/playlists` | GET | User's playlists |
| `/api/music/playlists` | POST | Create playlist `{ name }` |
| `/api/music/playlists/[id]` | GET | Playlist detail + tracks |
| `/api/music/playlists/[id]` | PUT | Rename/update `{ name }` |
| `/api/music/playlists/[id]` | DELETE | Delete playlist |
| `/api/music/playlists/[id]/tracks` | POST | Add track `{ trackId, serviceId }` |
| `/api/music/playlists/[id]/tracks` | DELETE | Remove track `?trackId=` |
| `/api/music/recently-played` | GET | Recent tracks from media_events |

### Lidarr Admin

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/music/wanted` | GET | Missing/wanted albums (Lidarr) |
| `/api/music/queue` | GET | Download queue (Lidarr) |

## DB Tables

### `music_liked_tracks`
```sql
id TEXT PK,
user_id TEXT NOT NULL,
track_id TEXT NOT NULL,    -- Jellyfin sourceId
service_id TEXT NOT NULL,
created_at INTEGER NOT NULL
UNIQUE(user_id, track_id, service_id)
```

### `music_playlists`
```sql
id TEXT PK,
user_id TEXT NOT NULL,
name TEXT NOT NULL,
description TEXT,
created_at INTEGER NOT NULL,
updated_at INTEGER NOT NULL
```

### `music_playlist_tracks`
```sql
id TEXT PK,
playlist_id TEXT NOT NULL,
track_id TEXT NOT NULL,    -- Jellyfin sourceId
service_id TEXT NOT NULL,
position INTEGER NOT NULL DEFAULT 0,
added_at INTEGER NOT NULL
```

## Recently Played

No new table. Query `media_events` where `media_type = 'music'` and `event_type IN ('play_start', 'play_resume')`, ordered by timestamp desc, deduplicated by mediaId. Limit 50.

## What We Skip (YAGNI)

- Queue persistence (stays client-side)
- Gapless/crossfade playback
- Scrobbling (Last.fm etc.)
- Lyrics
- Smart playlists / auto-playlists

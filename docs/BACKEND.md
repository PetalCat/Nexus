# Nexus Backend Documentation

> Unified media platform — SvelteKit + Drizzle ORM + better-sqlite3

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Database](#database)
- [Authentication & Sessions](#authentication--sessions)
- [Service Adapters](#service-adapters)
- [API Endpoints](#api-endpoints)
- [Analytics Engine](#analytics-engine)
- [Background Services](#background-services)
- [Caching](#caching)
- [Page Server Loaders](#page-server-loaders)

---

## Architecture Overview

```
Browser (SvelteKit SSR + Client)
    |
    v
hooks.server.ts ── session validation, auth gating, background service boot
    |
    +-- API Routes (/api/*) ── REST endpoints
    |       |
    |       +-- services.ts ── aggregation layer (dashboard, library, search)
    |       |       |
    |       |       +-- Adapter Registry ── per-service adapters (jellyfin, romm, overseerr, ...)
    |       |       |       |
    |       |       |       +-- External APIs (Jellyfin, Overseerr, RomM, *arr, etc.)
    |       |       |
    |       |       +-- auth.ts ── user/session/credential management
    |       |
    |       +-- analytics.ts ── event ingestion + query
    |       +-- stats-engine.ts ── rollup computation
    |
    +-- Page Loaders (+page.server.ts) ── SSR data fetching
    |
    +-- Background Services (started at boot)
            +-- session-poller.ts ── Jellyfin 10s / RomM 60s polling
            +-- stats-scheduler.ts ── stats rebuild every 5min
```

### Data Flow

1. **Auth** — `hooks.server.ts` validates session cookies, populates `event.locals.user`
2. **Services** — `services.ts` aggregates dashboard/library/search from configured adapters
3. **Analytics** — Session poller + webhooks + client collector emit events to append-only tables
4. **Stats** — Stats engine computes rollups from raw events; scheduler rebuilds on a 5min loop
5. **Cache** — `cache.ts` memoizes expensive queries with configurable TTL

### Concurrency & Safety

- SQLite WAL mode for concurrent readers
- Foreign keys enforced
- Timing-safe password comparison (scrypt)
- Fire-and-forget event ingestion (errors swallowed to avoid blocking)
- `Promise.allSettled` in aggregation (one service failure doesn't block others)
- 5s hard timeout per service health check via `Promise.race`
- 8s `AbortSignal.timeout` on all adapter fetch calls

---

## Database

**File:** `src/lib/db/schema.ts` (Drizzle ORM definitions), `src/lib/db/index.ts` (init + connection)

**Engine:** better-sqlite3 with WAL mode
**Path:** `process.env.DATABASE_URL || './nexus.db'`
**ORM:** Drizzle

### Tables

#### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random 16-byte hex |
| username | text UNIQUE | |
| displayName | text | |
| passwordHash | text | scrypt with random salt |
| isAdmin | integer | 0 or 1 |
| authProvider | text | 'local' or 'jellyfin' |
| externalId | text | External service user ID |
| createdAt | integer | Unix ms |

#### `sessions`
| Column | Type | Notes |
|--------|------|-------|
| token | text PK | Random 32-byte hex |
| userId | text FK | References users.id |
| expiresAt | integer | Unix ms, 30-day TTL |
| createdAt | integer | Unix ms |

#### `services`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | User-defined identifier |
| name | text | Display name |
| type | text | Adapter type (jellyfin, overseerr, etc.) |
| url | text | Base URL |
| apiKey | text | Admin API key |
| username | text | Service-specific (Overseerr: Jellyfin URL, StreamyStats: Jellyfin URL) |
| password | text | Service-specific |
| enabled | integer | 0 or 1 |
| createdAt | integer | Unix ms |
| updatedAt | integer | Unix ms |

#### `userServiceCredentials`
| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | Auto-increment |
| userId | text | Nexus user ID |
| serviceId | text | References services.id |
| accessToken | text | Per-user token/password |
| externalUserId | text | User ID on external service |
| externalUsername | text | Username on external service |
| linkedAt | integer | Unix ms |

**Unique constraint:** `(userId, serviceId)`

#### `inviteLinks`
| Column | Type | Notes |
|--------|------|-------|
| code | text PK | base64url random code |
| createdBy | text | Admin user ID |
| maxUses | integer | Default 1 |
| uses | integer | Current usage count |
| expiresAt | integer | Unix ms, nullable |
| createdAt | integer | Unix ms |

#### `mediaEvents` (analytics — append-only)
| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | Auto-increment |
| userId | text | Nexus user ID |
| serviceId | text | Source service |
| serviceType | text | 'jellyfin', 'romm', etc. |
| eventType | text | 'play_start', 'play_stop', 'progress', etc. |
| mediaId | text | Item ID on source service |
| mediaType | text | 'movie', 'show', 'episode', 'game', etc. |
| mediaTitle | text | |
| mediaYear | integer | |
| mediaGenres | text | JSON array |
| parentId | text | Series/parent ID |
| parentTitle | text | Series name |
| positionTicks | integer | Current position |
| durationTicks | integer | Total duration |
| playDurationMs | integer | Wall-clock play time |
| deviceName | text | |
| clientName | text | |
| metadata | text | JSON blob (resolution, codecs, HDR, etc.) |
| timestamp | integer | Unix ms |
| ingestedAt | integer | Unix ms |

**Indexes:**
- `(user_id, timestamp)`
- `(user_id, media_type, timestamp)`
- `(user_id, event_type, timestamp)`
- `(user_id, media_id)`
- `(service_id, media_id, timestamp)`
- `(timestamp)`

#### `interactionEvents` (analytics — append-only)
| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | Auto-increment |
| userId | text | Nullable (anonymous ok) |
| sessionToken | text | Client-side session ID |
| eventType | text | 'page_view', 'click', 'search', etc. |
| page | text | URL path |
| target | text | Clicked element identifier |
| targetTitle | text | |
| referrer | text | Previous page |
| searchQuery | text | |
| position | text | JSON (scroll depth, etc.) |
| durationMs | integer | Time on page/action |
| metadata | text | JSON blob |
| timestamp | integer | Unix ms |

**Indexes:**
- `(user_id, timestamp)`
- `(user_id, event_type, timestamp)`
- `(page, timestamp)`
- `(target, timestamp)`
- `(session_token, timestamp)`

#### `userStatsCache` (pre-computed rollups)
| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | Auto-increment |
| userId | text | |
| period | text | 'day:2026-03-04', 'week:2026-W10', 'month:2026-03', 'year:2026', 'alltime' |
| mediaType | text | 'all', 'movie', 'show', 'game', etc. |
| stats | text | JSON blob (ComputedStats) |
| computedAt | integer | Unix ms |

**Unique index:** `(user_id, period, media_type)`

#### Other Tables
- **`mediaItems`** — Cached unified media items (sourceId, serviceId, type, title, poster, etc.)
- **`activity`** — Legacy watch progress (deprecated in favor of mediaEvents)
- **`requests`** — Overseerr request sync

### Initialization

`getDb()` returns a singleton Drizzle instance. On first call:
1. Opens better-sqlite3 connection
2. Enables WAL mode + foreign keys
3. Runs `CREATE TABLE IF NOT EXISTS` for all tables
4. Creates all indexes
5. Runs safe ALTER TABLE migrations for schema evolution

---

## Authentication & Sessions

**File:** `src/lib/server/auth.ts`

### Password Hashing
- Algorithm: scrypt (64-byte output, 16-byte random salt)
- Storage format: `{salt_hex}:{hash_hex}`
- Verification: timing-safe comparison via `crypto.timingSafeEqual`

### Session Flow
1. User logs in via `/login` (POST) — `verifyPassword()` checks credentials
2. `createSession(userId)` generates random 32-byte token, stores with 30-day expiry
3. Token set as `nexus_session` httpOnly cookie (lax sameSite, 30-day maxAge)
4. Every request: `hooks.server.ts` calls `validateSession(token)` — checks expiry, returns user or null
5. Expired sessions auto-deleted on validation attempt

### Invite System
- Admin creates invite via `createInviteLink(createdBy, {maxUses?, expiresInHours?})`
- User registers via `/invite?code=xxx` — validates code, creates user, consumes invite
- New users auto-provisioned on all user-linkable services via `provisionUserOnServices()`

### Per-User Service Credentials

Every user-linkable service stores per-user auth credentials:

| Service | Auth Method | accessToken stores | Notes |
|---------|-----------|-------------------|-------|
| Jellyfin | MediaBrowser header | Jellyfin auth token | User token preferred over admin API key |
| Kavita | Bearer token | Kavita API token | |
| Overseerr | Session cookie | connect.sid cookie | Auto-linked via Jellyfin |
| RomM | HTTP Basic | Plain password | Username stored in externalUsername |
| StreamyStats | Jellyfin token | (copies from Jellyfin) | No own auth — borrows Jellyfin credential |

**Universal rule:** All user-facing data access uses per-user credentials. Admin credentials are only for provisioning and admin pages. Exception: read-only *arr services (Radarr, Sonarr, Lidarr) use admin API keys for data enrichment.

### Key Functions

```typescript
// User lifecycle
createUser(username, displayName, password, isAdmin, opts?) → string (userId)
deleteUser(id) → void  // cascade: sessions + credentials + user
updateUser(id, {displayName?, isAdmin?}) → void
getUserByUsername(username) → User | undefined
getUserById(id) → User | undefined
getAllUsers() → User[]
getUserCount() → number

// Sessions
createSession(userId) → string (token)
validateSession(token?) → User | null
deleteSession(token) → void
purgeExpiredSessions() → void

// Invites
createInviteLink(createdBy, {maxUses?, expiresInHours?}) → string (code)
getInviteLinks() → InviteLink[]
validateInviteCode(code) → InviteLink | null
consumeInviteCode(code) → void
deleteInviteLink(code) → void

// Per-user credentials
getUserCredentials(userId) → UserServiceCredential[]
getUserCredentialForService(userId, serviceId) → UserCredential | null
upsertUserCredential(userId, serviceId, {accessToken?, externalUserId?, externalUsername?}) → void
deleteUserCredential(userId, serviceId) → void
```

---

## Service Adapters

**Files:** `src/lib/adapters/*.ts`

### Adapter Interface

Every adapter implements `ServiceAdapter` from `src/lib/adapters/base.ts`:

```typescript
interface ServiceAdapter {
  id: string;
  displayName: string;
  defaultPort: number;
  icon?: string;
  mediaTypes?: string[];
  userLinkable?: boolean;
  authUsernameLabel?: string;

  // Required
  ping(config: ServiceConfig): Promise<ServiceHealth>;

  // Optional — implemented per service
  getContinueWatching?(config, userCred?): Promise<UnifiedMedia[]>;
  getRecentlyAdded?(config, userCred?): Promise<UnifiedMedia[]>;
  getTrending?(config, userCred?): Promise<UnifiedMedia[]>;
  search?(config, query, userCred?): Promise<UnifiedSearchResult>;
  getItem?(config, sourceId, userCred?): Promise<UnifiedMedia | null>;
  getLibrary?(config, opts?, userCred?): Promise<{items, total}>;
  getSimilar?(config, sourceId, userCred?): Promise<UnifiedMedia[]>;
  getSeasonEpisodes?(config, seriesId, season, userCred?): Promise<UnifiedMedia[]>;
  getLiveChannels?(config, userCred?): Promise<UnifiedMedia[]>;
  getQueue?(config): Promise<UnifiedMedia[]>;
  requestMedia?(config, tmdbId, type, userCred?): Promise<boolean>;
  discover?(config, category, page, userCred?): Promise<{items, hasMore}>;
  getRequests?(config, opts?, userCred?): Promise<NexusRequest[]>;
  getPendingCount?(config, userCred?): Promise<number>;
  approveRequest?(config, requestId): Promise<void>;
  denyRequest?(config, requestId): Promise<void>;
  authenticateUser?(config, username, password): Promise<{accessToken, externalUserId, externalUsername}>;
  createUser?(config, username, password): Promise<{accessToken, externalUserId, externalUsername}>;
  getUsers?(config): Promise<ExternalUser[]>;
}
```

### Registry

All adapters registered in `src/lib/adapters/registry.ts`:

```typescript
import { registry } from '$lib/adapters/registry';
const adapter = registry.get('jellyfin'); // ServiceAdapter | undefined
```

### Adapter Details

#### Jellyfin
| Property | Value |
|----------|-------|
| **Type** | `jellyfin` |
| **Port** | 8096 |
| **Media** | movie, show, music, live |
| **User Linkable** | Yes |
| **Auth** | `Authorization: MediaBrowser Client="Nexus", ..., Token="{apiKey}"` + `X-Emby-Token` |

**Methods:** ping, getContinueWatching, getRecentlyAdded, getTrending (NextUp + Suggestions), search, getItem, getLibrary, getSimilar, getSeasonEpisodes, getLiveChannels, authenticateUser, createUser, getUsers

**Key behaviors:**
- userId resolved lazily via `GET /Users/Me`, cached per service in `userIdCache` Map
- User token takes priority over admin API key when both available
- Image URLs are public (no auth): `/Items/{id}/Images/Primary`
- Stream URLs proxied: `/api/stream/{serviceId}/{itemId}`
- Episode titles formatted as "SeriesName S01E02"

**Exported helpers:**
- `getSeasons(config, seriesId, userCred?)` — returns `JellyfinSeason[]`

---

#### Overseerr
| Property | Value |
|----------|-------|
| **Type** | `overseerr` |
| **Port** | 5055 |
| **Media** | movie, show |
| **User Linkable** | Yes |
| **Auth Label** | Email |
| **Auth** | Admin: `X-Api-Key`; User: session cookie |

**Methods:** ping, getRecentlyAdded, getTrending, search, getItem, getSimilar, requestMedia, discover, getRequests, getPendingCount, approveRequest, denyRequest, authenticateUser, getUsers

**Key behaviors:**
- `authenticateUser` supports two modes via `config.username`:
  - Empty → local email+password auth (`POST /api/v1/auth/local`)
  - Has value (Jellyfin URL) → delegated Jellyfin auth (`POST /api/v1/auth/jellyfin`)
- `getItem` sourceId format: `"movie:123"` or `"tv:456"` (type prefix)
- Request enrichment: batch-fetches TMDB details in parallel for all requests
- Status mapping: 2=approved, 3=declined, 4=available, else=pending
- Images from TMDB CDN: `https://image.tmdb.org/t/p/{size}`

**Exported helpers:**
- `importJellyfinUser(config, jellyfinUserId)` — imports Jellyfin user into Overseerr

---

#### RomM
| Property | Value |
|----------|-------|
| **Type** | `romm` |
| **Port** | 8080 |
| **Media** | game |
| **User Linkable** | Yes |
| **Auth** | HTTP Basic (priority: user > apiKey > config creds) |

**Methods:** ping, getRecentlyAdded, search, getItem, getLibrary, authenticateUser, createUser, getUsers

**Key behaviors:**
- API base: `/api` (not `/api/v3`)
- Pagination: `?limit=&offset=&order_by=&order_dir=`
- `getLibrary` supports `platformId` filter
- `authenticateUser` verifies via `GET /api/users/me` with Basic auth
- accessToken stores the user's password (for Basic auth reconstruction)
- Rating normalized: divide by 10 if > 10

**Exported helpers:**
- `getPlatforms(config, userCred?)` — cached 5min, returns `RommPlatform[]`
- `getCollections(config, userCred?)` — cached 5min, returns `RommCollection[]`

**Metadata fields:** platform, platformSlug, platformId, fileSize, regions, userStatus, lastPlayed, retroAchievements, hltb, fileName, tags

---

#### StreamyStats
| Property | Value |
|----------|-------|
| **Type** | `streamystats` |
| **Port** | 3000 |
| **Media** | movie, show |
| **User Linkable** | No (uses Jellyfin token) |
| **Auth** | Jellyfin MediaBrowser token (no own API key) |

**Methods:** ping, getTrending (recommendations), search

**Key behaviors:**
- Config convention: `url` = StreamyStats instance, `username` = Jellyfin server URL
- Ping accepts 401/403 as valid (no server API key available)
- Recommendations: `GET /api/recommendations?serverUrl=...&type=...&limit=...&includeReasons=true`
- Response: `{ data: [{ item, reason, similarity, basedOn }] }`

**Exported helpers:**
- `getStreamyStatsRecommendations(config, type, userCred, limit?)` — personalized recommendations

---

#### Bazarr
| Property | Value |
|----------|-------|
| **Type** | `bazarr` |
| **Port** | 6767 |
| **Media** | (none — subtitle companion) |
| **User Linkable** | No |
| **Auth** | `X-API-KEY` header |

**Methods:** ping only (adapter-level)

**Exported functions (non-adapter):**
- `getSubtitleStatus(config, tmdbId?, opts?)` — available/missing/wanted language counts
- `getSeasonSubtitleStatus(config, sonarrSeriesId, seasonNumber)` — per-episode subtitle status
- `getItemSubtitleHistory(config, tmdbId?, opts?)` — download/upgrade/fail events
- `getProviderStatus(config)` — provider health (active/throttled/error/disabled)
- `getLanguageProfiles(config)` — language profiles with codes and constraints
- `getSystemHistory(config, opts?)` — paginated system-wide subtitle events

---

#### Radarr
| Property | Value |
|----------|-------|
| **Type** | `radarr` |
| **Port** | 7878 |
| **Media** | movie |
| **User Linkable** | No |
| **Auth** | `?apikey=` query param |

**Methods:** ping, getRecentlyAdded, getQueue, search

**Metadata:** radarrId, tmdbId, hasFile, sizeOnDisk, monitored

---

#### Sonarr
| Property | Value |
|----------|-------|
| **Type** | `sonarr` |
| **Port** | 8989 |
| **Media** | show |
| **User Linkable** | No |
| **Auth** | `?apikey=` query param |

**Methods:** ping, getRecentlyAdded, getQueue, search

**Metadata:** sonarrId, tvdbId, totalEpisodeCount, episodeFileCount, monitored, status

---

#### Lidarr
| Property | Value |
|----------|-------|
| **Type** | `lidarr` |
| **Port** | 8686 |
| **Media** | music, album |
| **User Linkable** | No |
| **Auth** | `?apikey=` query param |

**Methods:** ping, getRecentlyAdded, search

---

#### Kavita
| Property | Value |
|----------|-------|
| **Type** | `kavita` |
| **Port** | 5000 |
| **Media** | book |
| **User Linkable** | Yes |
| **Auth** | `Bearer` token |

**Methods:** ping, getRecentlyAdded, getContinueWatching, search, getItem, authenticateUser

---

#### Prowlarr
| Property | Value |
|----------|-------|
| **Type** | `prowlarr` |
| **Port** | 9696 |
| **Media** | other |
| **User Linkable** | No |
| **Auth** | `?apikey=` query param |

**Methods:** ping only (indexer management — no media operations)

---

## API Endpoints

All endpoints live under `src/routes/api/`. Auth is enforced by `hooks.server.ts` — API routes check `locals.user` themselves and return 401 JSON.

### Authentication

#### `POST /api/auth/logout`
Logs out current user. Deletes session token, clears cookie, redirects to `/login`.

**Auth:** Session required

---

### Admin — Users

#### `GET /api/admin/users`
Lists all registered users.

**Auth:** Admin only
**Response:** `User[]`

#### `POST /api/admin/users`
Creates a new user.

**Auth:** Admin only
**Body:** `{ username, displayName, password, isAdmin? }`
**Response:** `{ id, username, displayName, isAdmin }`
**Errors:** 409 duplicate username

#### `PATCH /api/admin/users`
Updates user properties.

**Auth:** Admin only
**Body:** `{ id, displayName?, isAdmin? }`

#### `DELETE /api/admin/users?id={userId}`
Deletes a user (cascade: sessions + credentials).

**Auth:** Admin only
**Errors:** 400 if self-deletion attempted

---

### Admin — Invites

#### `GET /api/admin/invites`
Lists all active invite links.

**Auth:** Admin only

#### `POST /api/admin/invites`
Creates a new invite link.

**Auth:** Admin only
**Body:** `{ maxUses?, expiresInHours? }`
**Response:** `{ code, maxUses, expiresInHours }`

#### `DELETE /api/admin/invites?code={code}`
Deletes an invite link.

**Auth:** Admin only

---

### Admin — Migration

#### `GET /api/admin/migrate/jellyfin`
Preview: lists all Jellyfin users available for import.

**Auth:** Admin only
**Response:** Array of Jellyfin users with externalId, username, serviceId

#### `POST /api/admin/migrate/jellyfin`
Imports Jellyfin users into Nexus. Creates accounts or links credentials.

**Auth:** Admin only
**Body:** `{ users?: [{externalId, username, serviceId}] }` — omit to import all
**Response:** `[{ username, status: 'created'|'linked'|'error', error? }]`

---

### Admin — Provisioning

#### `POST /api/admin/provision`
Provisions a user on all user-linkable backend services.

**Auth:** Admin only
**Body:** `{ userId, password }`
**Response:** `[{ serviceId, serviceName, serviceType, status, externalUsername?, error? }]`

---

### Admin — Stats

#### `GET /api/admin/stats?period={period}`
Server-wide aggregate statistics across all users.

**Auth:** Admin only
**Query:** `period` — e.g. `alltime`, `month:2026-03`, `year:2026` (default: `alltime`)
**Response:**
```json
{
  "period": "alltime",
  "activeUsers": 5,
  "totalPlayTimeMs": 123456789,
  "totalSessions": 450,
  "totalItems": 200,
  "totalPageViews": 3000,
  "topGenres": [{"genre": "Action", "playTimeMs": 50000}],
  "topDevices": [{"name": "Living Room TV", "playTimeMs": 80000}]
}
```

---

### Admin — Subtitles

#### `GET /api/admin/subtitles?section={section}&page={n}&limit={n}`
Bazarr subtitle management dashboard.

**Auth:** Admin only
**Query:**
- `section` — `providers`, `profiles`, `history`, or omit for all
- `page` — pagination for history (default 1)
- `limit` — items per page (default 50)

**Response:** Provider status, language profiles, and/or system history depending on section

---

### Services

#### `GET /api/services?health=true`
Lists all configured services with optional health check.

**Auth:** Admin only
**Query:** `health=true` to include ping results
**Response:** `{ services: ServiceConfig[], available: AdapterInfo[], health?: ServiceHealth[] }`

#### `POST /api/services`
Adds or updates a service configuration.

**Auth:** Admin only
**Body:** `{ id, name, type, url, apiKey?, username?, password?, enabled? }`
**Side effect:** Invalidates health, recently-added, trending, discover, library, live-channels, queue caches

#### `DELETE /api/services?id={serviceId}`
Deletes a service configuration.

**Auth:** Admin only

#### `GET /api/services/ping?id={serviceId}`
Pings a saved service by ID.

**Auth:** Any authenticated user
**Response:** `ServiceHealth`

#### `POST /api/services/ping`
Pings an unsaved service configuration (for testing before save).

**Auth:** Admin only
**Body:** Full `ServiceConfig` object
**Response:** `ServiceHealth`

---

### User Credentials

#### `GET /api/user/credentials`
Lists current user's linked service accounts. Does NOT expose raw tokens.

**Auth:** Session required
**Response:** `[{ serviceId, externalUserId, externalUsername, linkedAt }]`

#### `POST /api/user/credentials`
Links a service account. Two modes:

**Manual link:**
```json
{ "serviceId": "...", "username": "...", "password": "..." }
```

**Auto-link (Jellyfin-based services):**
```json
{ "serviceId": "...", "autoLink": true }
```

**Auth:** Session required
**Response:** `{ serviceId, externalUserId, externalUsername }`

**Auto-link behavior:**
- StreamyStats: copies Jellyfin token directly
- Overseerr: matches by jellyfinUserId, imports if no match found
- Others: matches by externalUserId across credentials

#### `DELETE /api/user/credentials?serviceId={serviceId}`
Unlinks a service account.

**Auth:** Session required

---

### Dashboard

#### `GET /api/dashboard`
Returns personalized dashboard content rows.

**Auth:** Optional (anonymous gets non-personalized rows)
**Response:** `DashboardRow[]` — each row has `{ id, title, subtitle?, items: UnifiedMedia[] }`

Row types: continue-watching (30s cache), personalized recommendations (5min cache), new-in-library (60s cache), trending (2min cache)

---

### Search

#### `GET /api/search?q={query}&type={mediaType}`
Unified search across all enabled services.

**Auth:** Optional
**Query:**
- `q` — search term (min 2 chars)
- `type` — optional filter (movie, show, book, game, music)

**Response:** `{ items: UnifiedMedia[], total: number }`
**Cache:** 60s

---

### Discover

#### `GET /api/discover?page={n}&category={category}`
Browse discoverable content from Overseerr.

**Auth:** Session required
**Query:**
- `page` — page number (default 1)
- `category` — `trending`, `movies`, `tv` (default: `trending`)

**Response:** `{ items: UnifiedMedia[], hasMore: boolean, page: number }`
**Cache:** 120s per category+page+user

---

### Media

#### `GET /api/media?serviceId={id}&sourceId={id}`
Fetch a single media item.

**Auth:** Optional
**Response:** `UnifiedMedia`
**Cache:** 60s

---

### Requests

#### `GET /api/requests?filter={filter}`
Lists media requests. Admin sees all; users see own.

**Auth:** Session required
**Query:** `filter` — `all`, `pending`, `approved`, `declined`, `available` (default: `all`)
**Response:** `NexusRequest[]`
**Cache:** 30s

#### `POST /api/requests`
Creates a new media request via Overseerr.

**Auth:** Session required
**Body:** `{ serviceId, tmdbId, type: 'movie'|'tv' }`
**Response:** `{ ok: boolean }`

#### `PATCH /api/requests`
Batch approve/deny requests.

**Auth:** Admin only
**Body:** `{ action: 'approve'|'deny', ids: ['serviceId:sourceId', ...] }`
**Response:** `{ succeeded: number, failed: number }`

---

### Streaming

#### `GET /api/stream/{serviceId}/{itemId}/master.m3u8`
HLS adaptive playlist proxy. Also handles variant playlists, segments, and direct streams.

**Auth:** Session required
**Supported patterns:**
- `/{itemId}/master.m3u8` — HLS adaptive playlist
- `/{itemId}/main.m3u8` — HLS variant playlist
- `/{itemId}/*.ts` — HLS segments
- `/{itemId}/stream` — Direct progressive stream
- `/audio/{itemId}/universal` — Audio universal endpoint

**Behavior:**
- Keeps Jellyfin API keys server-side (never exposed to client)
- Rewrites m3u8 manifests to keep requests flowing through proxy
- Retries segment requests on 5xx with exponential backoff
- Injects HLS parameters (codecs, bitrate limits, subtitles)

#### `GET /api/stream/{serviceId}/subtitles?itemId={id}`
Returns subtitle streams for a Jellyfin item.

**Auth:** Session required
**Response:** Array of `{ id, name, language, isExternal, url }` — proxied VTT URLs

#### `POST /api/stream/{serviceId}/progress`
Reports playback progress to Jellyfin + emits analytics events.

**Auth:** Session required
**Body:**
```json
{
  "itemId": "...",
  "positionTicks": 123456,
  "isPaused": false,
  "isStopped": false,
  "isStart": false,
  "mediaType": "movie",
  "mediaTitle": "...",
  "durationTicks": 999999,
  "deviceName": "...",
  "clientName": "..."
}
```

**Side effects:** Emits `play_start`, `progress`, or `play_stop` analytics events. Invalidates continue-watching and activity caches on stop.

#### `GET /api/stream/{serviceId}/test`
Diagnostic endpoint for stream proxy connectivity.

**Auth:** Session required
**Response:** Diagnostic info (service config, auth status, connectivity test, user list)

---

### Analytics Ingestion

#### `POST /api/ingest/interactions`
Receives batched interaction events from client-side collector.

**Auth:** Optional (uses `locals.user.id` if available)
**Body:**
```json
{
  "events": [
    {
      "eventType": "page_view",
      "page": "/movies",
      "durationMs": 5000,
      "timestamp": 1709568000000
    }
  ]
}
```

**Limits:** Max 500 events per batch
**Response:** `{ ok: true, ingested: number }`

#### `POST /api/ingest/webhook/{serviceType}`
Webhook receiver for external service events. Routes to registered handlers.

**Auth:** None (external webhooks)
**Currently registered:** `jellyfin`

**Jellyfin webhook payload mapping:**
| Notification Type | Event Type |
|------------------|------------|
| PlaybackStart | play_start |
| PlaybackStop | play_stop |
| PlaybackProgress | progress |
| ItemAdded | add_to_library |
| UserDataSaved | mark_watched |
| ItemRated | rate |

Extracts: video stream (resolution, codec, HDR), audio stream (codec, channels, language), subtitle stream (language, format), transcoding info (bitrate, reason), device/client names.

**Response:** `{ ok, event? }` or `{ ok, skipped }` or `{ error }`

---

### User Stats

#### `GET /api/user/stats?period={period}&type={mediaType}`
Returns user's computed stats for a period.

**Auth:** Session required
**Query:**
- `period` — `alltime`, `day:2026-03-04`, `week:2026-W10`, `month:2026-03`, `year:2026`
- `type` — `all`, `movie`, `show`, `book`, `game`, `music` (default: `all`)

**Response:**
```json
{
  "totalPlayTimeMs": 123456,
  "totalSessions": 50,
  "totalItems": 30,
  "topGenres": [{"genre": "Action", "playTimeMs": 5000}],
  "topItems": [{"title": "Movie", "mediaId": "...", "playTimeMs": 3000, "sessions": 2}],
  "topDevices": [{"name": "Apple TV", "playTimeMs": 8000}],
  "topClients": [{"name": "Infuse", "playTimeMs": 8000}],
  "totalPageViews": 100,
  "resolutionBreakdown": {"4K": 30, "1080p": 15},
  "hdrBreakdown": {"dolby-vision": 10, "sdr": 20},
  "transcodeRate": 0.15,
  "subtitleUsage": 0.4,
  "hourlyDistribution": [0, 0, 0, ..., 5000, 8000, ...],
  "weekdayDistribution": [1000, 2000, 3000, 4000, 5000, 8000, 3000],
  "streaks": {"current": 5, "longest": 12},
  "avgCompletionRate": 0.85
}
```

#### `GET /api/user/stats/live`
Real-time stats for today (always fresh, never cached).

**Auth:** Session required
**Response:** Same shape as `/api/user/stats`

#### `GET /api/user/stats/timeline?from={date}&to={date}&granularity={g}&type={t}`
Time-series stats over a date range.

**Auth:** Session required
**Query:**
- `from` — start date (YYYY-MM-DD or YYYY-MM)
- `to` — end date
- `granularity` — `day` or `month` (default: `day`)
- `type` — media type filter (default: `all`)

**Limits:** Max 366 days or 120 months
**Response:** `[{ period, totalPlayTimeMs, totalSessions, totalItems }]`

#### `GET /api/user/stats/top?category={cat}&period={p}&limit={n}`
Top items in a category.

**Auth:** Session required
**Query:**
- `category` — `genres`, `items`, `devices`, `clients` (default: `items`)
- `period` — period string (default: `alltime`)
- `type` — media type filter (default: `all`)
- `limit` — max results, capped at 100 (default: 20)

**Response:** Array of top entries sorted by play time

#### `GET /api/user/stats/wrapped?year={year}`
Full year-in-review (Wrapped-style).

**Auth:** Session required
**Query:** `year` — defaults to previous year
**Response:**
```json
{
  "year": 2025,
  "overall": { /* ComputedStats */ },
  "byType": {
    "movies": { /* ComputedStats */ },
    "shows": { /* ComputedStats */ },
    "books": { /* ComputedStats */ },
    "games": { /* ComputedStats */ },
    "music": { /* ComputedStats */ }
  },
  "monthly": [
    { "month": "2025-01", "stats": { /* ComputedStats */ } }
  ]
}
```

#### `GET /api/user/stats/events?type={t}&event={e}&from={ts}&to={ts}&limit={n}&offset={n}`
Raw media events with pagination.

**Auth:** Session required
**Query:**
- `type` — media type filter
- `event` — event type filter (play_stop, play_start, etc.)
- `from` / `to` — unix ms timestamps
- `limit` — max 500 (default: 50)
- `offset` — pagination offset (default: 0)

**Response:** `{ events: MediaEvent[], total: number, limit, offset }`

---

## Analytics Engine

### Overview

Event-sourced architecture: two append-only tables (`mediaEvents`, `interactionEvents`) + pre-computed rollups (`userStatsCache`).

**File:** `src/lib/server/analytics.ts`

### Event Type Constants

```typescript
// Media consumption events
MEDIA_EVENTS = {
  PLAY_START, PLAY_STOP, PLAY_PAUSE, PLAY_RESUME, PROGRESS, COMPLETE,
  LIKE, UNLIKE, RATE, FAVORITE, UNFAVORITE,
  ADD_TO_WATCHLIST, REMOVE_FROM_WATCHLIST, ADD_TO_COLLECTION, REMOVE_FROM_COLLECTION,
  ADD_TO_LIBRARY, REMOVE_FROM_LIBRARY,
  MARK_WATCHED, MARK_UNWATCHED, SHARE,
  REQUEST, DETAIL_VIEW,
  READ_START, READ_STOP, READ_PROGRESS, READ_COMPLETE, CHAPTER_COMPLETE,
  DOWNLOAD_START, DOWNLOAD_COMPLETE, DOWNLOAD_FAILED, IMPORT
}

// UI interaction events
INTERACTION_EVENTS = {
  PAGE_VIEW, CLICK, SEARCH, SCROLL_DEPTH, CARD_HOVER, CARD_CLICK,
  ROW_SCROLL, FILTER_CHANGE, SORT_CHANGE, DETAIL_VIEW,
  REQUEST_SUBMIT, SETTING_CHANGE, LOGIN, LOGOUT,
  LIKE_BUTTON, RATE_BUTTON, FAVORITE_BUTTON, SHARE_BUTTON,
  PLAYER_ACTION, NOTIFICATION_CLICK, RECOMMENDATION_CLICK
}

// Media types
MEDIA_TYPES = {
  MOVIE, SHOW, EPISODE, BOOK, COMIC, MANGA, GAME,
  MUSIC, ALBUM, TRACK, PODCAST, LIVE, AUDIOBOOK
}

// Service types
SERVICE_TYPES = {
  JELLYFIN, KAVITA, ROMM, OVERSEERR, STREAMYSTATS,
  RADARR, SONARR, LIDARR, PROWLARR, BAZARR
}
```

### Plugin Registries

```typescript
// Webhook handlers — extensible per service type
registerWebhookHandler(serviceType: string, handler: WebhookHandler): void
getWebhookHandler(serviceType: string): WebhookHandler | undefined

// Background pollers — extensible per service type
registerPoller(name: string, fn: PollerFn, intervalTicks?: number): void
getPollerPlugins(): Map<string, {fn, intervalTicks}>
```

### Ingestion Functions

```typescript
// Single event — fire and forget, never throws
emitMediaEvent(input: MediaEventInput): void
emitInteractionEvent(input: InteractionEventInput): void

// Batch — returns count inserted, 0 on error
emitMediaEventsBatch(events: MediaEventInput[]): number
emitInteractionEventsBatch(events: InteractionEventInput[]): number
```

### Query Functions

```typescript
queryMediaEvents(opts: EventQueryOpts): MediaEvent[]  // newest-first, limit 1000
countMediaEvents(opts): number
```

### Helpers

```typescript
resolveNexusUserId(externalUserId: string): string | null
getCredsForService(serviceId: string): UserServiceCredential[]
heightToResolution(height: number): string   // 2160→"4K", 1080→"1080p", etc.
channelsToLabel(channels: number): string    // >6→"7.1", >2→"5.1", else "stereo"
```

### PlaybackMetadata Interface

```typescript
interface PlaybackMetadata {
  resolution?: string;          // "4K", "1080p", "720p", "480p"
  videoCodec?: string;          // "hevc", "h264", "av1"
  audioCodec?: string;          // "truehd-atmos", "eac3", "aac", "flac"
  audioChannels?: string;       // "7.1", "5.1", "stereo"
  audioTrackLanguage?: string;
  hdr?: string;                 // "dolby-vision", "hdr10", "hdr10+", "sdr"
  bitrate?: number;
  isTranscoding?: boolean;
  transcodeReason?: string;
  streamType?: string;          // "direct-play", "direct-stream", "transcode"
  subtitleLanguage?: string;
  subtitleFormat?: string;      // "srt", "ass", "pgs"
  closedCaptions?: boolean;
  // Reading (future)
  pageNumber?: number;
  totalPages?: number;
  chapterNumber?: number;
  totalChapters?: number;
  readingDevice?: string;
  // Games
  platform?: string;
  platformSlug?: string;
  userStatus?: string;
  lastPlayed?: string;
  [key: string]: unknown;
}
```

### Stats Engine

**File:** `src/lib/server/stats-engine.ts`

```typescript
// Core computation — reads play_stop events, aggregates everything
computeStats(userId, from, to, mediaType?): ComputedStats

// Cache-aware — checks userStatsCache, recomputes if stale
getOrComputeStats(userId, period, mediaType?, maxAgeMs?): ComputedStats

// Write to cache
buildAndCacheStats(userId, granularity, mediaType?): void

// Full rebuild: 7 media types x 5 granularities = 35 cache entries
rebuildStatsForUser(userId): void

// Period helpers
currentPeriod(granularity, date?): { from, to, period }
parsePeriod(period): { from, to }

// Active users
getActiveUserIds(): string[]
```

**ComputedStats shape:**
- `totalPlayTimeMs`, `totalItems`, `totalSessions`, `completions`
- `avgSessionLengthMs`, `longestSessionMs`
- `topItems[]` (title, mediaId, playTimeMs, sessions)
- `topGenres[]` (genre, playTimeMs)
- `topDevices[]`, `topClients[]` (name, playTimeMs)
- `resolutionBreakdown` ({"4K": n, "1080p": n, ...})
- `hdrBreakdown` ({"dolby-vision": n, "sdr": n, ...})
- `transcodeRate` (0.0-1.0)
- `subtitleUsage` (0.0-1.0)
- `hourlyDistribution[24]` — play time per hour of day
- `weekdayDistribution[7]` — play time per day of week
- `streaks` — {current, longest} consecutive active days
- `avgCompletionRate` — completions / unique started items
- `totalPageViews`, `totalTimeInAppMs`, `mostVisitedPages[]`
- `totalLikes`, `totalRatings`, `totalFavorites`

---

## Background Services

Started at server boot in `src/hooks.server.ts`:

### Session Poller (`src/lib/server/session-poller.ts`)

**Jellyfin — every 10s:**
1. `GET /Sessions` from all enabled Jellyfin services
2. Tracks active sessions in memory Map
3. Detects state transitions:
   - New session → `play_start` event
   - Media changed → `play_stop` + `play_start`
   - Paused/resumed → `play_pause` / `play_resume`
   - Session disappeared → `play_stop`
4. Extracts full playback metadata (resolution, codec, HDR, audio, subtitles, transcoding)

**RomM — every 60s:**
1. Fetches `/api/roms?limit=50&order_by=updated_at` per user credential
2. Tracks game statuses in memory Map
3. Detects status transitions:
   - `playing` → `play_start`
   - `finished`/`completed` → `complete`
   - `retired` → `mark_watched`
   - `wishlist` → `add_to_watchlist`
4. Skips first-load events to avoid flooding

### Stats Scheduler (`src/lib/server/stats-scheduler.ts`)

5-minute tick interval:

| Tick | Rebuilds |
|------|----------|
| Every tick (5min) | Current day |
| Every 6th (30min) | Current week |
| Every 24th (2hr) | Current month |
| Every 72nd (6hr) | Current year |
| Every 144th (12hr) | Full rebuild (all periods x all types) |

First rebuild runs 30s after startup.

### Client-Side Collector (`src/lib/stores/analytics.ts`)

Svelte store that batches interaction events client-side:
- Tracks page views (with duration), clicks (`data-track` attribute), searches
- Flushes every 5s via `navigator.sendBeacon` to `POST /api/ingest/interactions`
- Also flushes on `beforeunload`
- Wired in `+layout.svelte` via `onMount`/`onDestroy`/`afterNavigate`

---

## Caching

**File:** `src/lib/server/cache.ts`

Simple in-process TTL cache backed by a `Map<string, {data, expires}>`.

```typescript
withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>
invalidate(key: string): void
invalidatePrefix(prefix: string): void
```

### Cache Keys & TTLs

| Key Pattern | TTL | Data |
|------------|-----|------|
| `cw:{userId}` | 30s | Continue watching |
| `ss-recs-{type}:{userId}:{configId}` | 5min | StreamyStats recommendations |
| `recently-added:{configId}` | 60s | New in library |
| `trending:{configId}` | 2min | Trending items |
| `health` | 30s | Service health checks |
| `admin-sessions` | 10s | Active Jellyfin sessions |
| `admin-requests` | 30s | Pending Overseerr requests |
| `library:{type}:{offset}:{limit}:{sort}` | 60s | Library pages |
| `live-channels` | 60s | Live TV channels |
| `queue` | 15s | Download queue |
| `search:{query}` | 60s | Search results |
| `discover:{cat}:{page}:{userId}` | 120s | Overseerr discovery |
| `pending:{configId}` | 30s | Pending request count |
| `my-requests:{userId}:{filter}` | 30s | User's requests |
| `admin-requests:{filter}` | 30s | Admin request list |
| `media:{serviceId}:{sourceId}` | 60s | Single media item |
| `romm-platforms:{configId}` | 5min | RomM platforms |
| `romm-collections:{configId}` | 5min | RomM collections |

---

## Page Server Loaders

SSR data fetching via `+page.server.ts` files. Summary:

| Route | Auth | Key Params | Data |
|-------|------|-----------|------|
| `/` (layout) | None | — | user, pendingRequests |
| `/` (home) | None | — | dashboard rows, hero item |
| `/login` | Not logged in | `next` | — (POST: authenticate) |
| `/setup` | No users exist | — | — (POST: create admin) |
| `/invite` | Not logged in | `code` | valid, error (POST: register) |
| `/settings` | None | — | services, health, users, credentials, linkable |
| `/admin` | Admin | — | sessions, requests, health, queue |
| `/search` | None | `q`, `type` | items, total |
| `/movies` | None | `sort` | library, popular, trending |
| `/shows` | None | `sort` | library, popular, trending |
| `/music` | None | `sort` | items, total |
| `/books` | None | `sort` | items, total |
| `/games` | None | `sort`, `platform` | items, platforms, collections |
| `/requests` | Session | — | myRequests, allRequests, discover |
| `/media/[type]/[id]` | None | `service`, `season` | item, similar, episodes, seasons |
| `/live` | None | — | channels |
| `/activity` | None | — | continueWatching |

### Notable Side Effects
- `/login` POST: auto-links Overseerr services after successful login
- `/invite` POST: provisions user on all backend services
- `/settings` load: auto-links Jellyfin services, pings all services
- `/media/[type]/[id]` load: emits `detail_view` analytics event, enriches with Bazarr subtitles

---

## Social Features (Planned)

### Overview

Social layer adding friends, presence, watch parties, sharing, collaborative playlists, and real-time communication. Built on two WebSocket channels (presence + sessions) and ~30 REST endpoints.

### Database Tables (New)

#### `friendships`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random ID |
| userId | text FK | Requesting user |
| friendId | text FK | Target user |
| status | text | `pending`, `accepted`, `blocked` |
| createdAt | integer | Unix ms |
| acceptedAt | integer | Unix ms, nullable |

**Unique constraint:** `(userId, friendId)`

#### `user_presence`
| Column | Type | Notes |
|--------|------|-------|
| userId | text PK FK | References users.id |
| status | text | `online`, `away`, `dnd`, `offline` |
| customStatus | text | Free-text status message |
| ghostMode | integer | 0 or 1 — hides all activity from friends |
| currentActivity | text | JSON: `{type, mediaId, mediaTitle, mediaType, startedAt}` |
| lastSeen | integer | Unix ms |

#### `shared_items`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random ID |
| fromUserId | text FK | Sender |
| toUserId | text FK | Recipient |
| mediaId | text | Source media ID |
| serviceId | text | Source service |
| mediaType | text | movie, show, game, etc. |
| mediaTitle | text | |
| mediaPoster | text | Poster URL |
| message | text | Optional note |
| seen | integer | 0 or 1 |
| seenAt | integer | Unix ms, nullable |
| createdAt | integer | Unix ms |

#### `watch_sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random ID |
| hostId | text FK | Session creator |
| type | text | `watch_party`, `netplay`, `listen_along` |
| mediaId | text | |
| serviceId | text | |
| mediaTitle | text | |
| mediaType | text | |
| status | text | `waiting`, `playing`, `paused`, `ended` |
| maxParticipants | integer | 0 = unlimited |
| createdAt | integer | Unix ms |
| endedAt | integer | Unix ms, nullable |

#### `session_participants`
| Column | Type | Notes |
|--------|------|-------|
| sessionId | text FK | References watch_sessions.id |
| userId | text FK | References users.id |
| joinedAt | integer | Unix ms |
| leftAt | integer | Unix ms, nullable |
| role | text | `host`, `participant` |

**Unique constraint:** `(sessionId, userId)`

#### `session_messages`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random ID |
| sessionId | text FK | References watch_sessions.id |
| userId | text FK | Sender |
| content | text | Message text |
| type | text | `text`, `system`, `reaction` |
| createdAt | integer | Unix ms |

#### `collab_playlists`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random ID |
| name | text | |
| description | text | |
| creatorId | text FK | References users.id |
| visibility | text | `private`, `friends`, `public` |
| createdAt | integer | Unix ms |
| updatedAt | integer | Unix ms |

#### `collab_playlist_items`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random ID |
| playlistId | text FK | References collab_playlists.id |
| mediaId | text | Source media ID |
| serviceId | text | Source service |
| mediaType | text | |
| mediaTitle | text | |
| mediaPoster | text | |
| addedBy | text FK | User who added it |
| position | integer | Sort order |
| createdAt | integer | Unix ms |

#### `collab_playlist_members`
| Column | Type | Notes |
|--------|------|-------|
| playlistId | text FK | References collab_playlists.id |
| userId | text FK | References users.id |
| role | text | `owner`, `editor`, `viewer` |
| addedAt | integer | Unix ms |

**Unique constraint:** `(playlistId, userId)`

---

### API Endpoints — Social

All social endpoints require session auth unless noted.

#### Current User Profile & Presence

##### `GET /api/auth/me`
Returns current user's full profile including social preferences.

**Response:**
```json
{
  "id": "abc123",
  "username": "parker",
  "displayName": "Parker",
  "isAdmin": true,
  "presence": {
    "status": "online",
    "customStatus": "Watching movies",
    "ghostMode": false,
    "currentActivity": {
      "type": "watching",
      "mediaId": "xyz",
      "mediaTitle": "Interstellar",
      "mediaType": "movie",
      "startedAt": 1709568000000
    }
  }
}
```

##### `PUT /api/auth/me/status`
Update presence status or custom status message.

**Body:** `{ status?: 'online'|'away'|'dnd', customStatus?: string }`
**Side effect:** Broadcasts `presence:updated` to all online friends via WebSocket

##### `PUT /api/auth/me/ghost`
Toggle ghost mode (hides all activity from friends).

**Body:** `{ enabled: boolean }`
**Side effect:** When enabled, broadcasts `presence:updated` with `offline` to friends. Current activity hidden.

---

#### Friends

##### `GET /api/friends`
List all accepted friends with presence and current activity.

**Response:**
```json
[
  {
    "id": "friend123",
    "username": "alex",
    "displayName": "Alex",
    "presence": {
      "status": "online",
      "customStatus": "Game night",
      "currentActivity": {
        "type": "playing",
        "mediaTitle": "Zelda: TOTK",
        "mediaType": "game",
        "startedAt": 1709568000000
      }
    },
    "friendSince": 1709000000000
  }
]
```

Friends in ghost mode appear as `offline` with no activity.

##### `GET /api/friends/:id`
Single friend's profile with full activity info.

**Response:** Same shape as friends list item, plus `mutualFriends: number`

##### `GET /api/friends/:id/activity`
Paginated activity history for one friend.

**Query:** `limit` (default 50), `offset` (default 0), `type` (media type filter)
**Response:**
```json
{
  "items": [
    {
      "eventType": "play_stop",
      "mediaTitle": "Dune: Part Two",
      "mediaType": "movie",
      "playDurationMs": 9480000,
      "timestamp": 1709568000000,
      "metadata": { "resolution": "4K", "hdr": "dolby-vision" }
    }
  ],
  "total": 150
}
```

Only shows events where the friend's privacy settings allow visibility. Ghost mode users return empty.

##### `GET /api/friends/online`
Online and away friends only (for sidebar badge/widget).

**Response:** Subset of `GET /api/friends` filtered to `status !== 'offline'`

##### `POST /api/friends/requests`
Send a friend request.

**Body:** `{ userId: string }` — target user ID
**Response:** `{ id, status: 'pending' }`
**Errors:** 409 if already friends or request exists, 404 if user not found

##### `PUT /api/friends/requests/:id`
Accept or decline a friend request.

**Body:** `{ action: 'accept' | 'decline' }`
**Side effects:**
- On accept: creates bidirectional friendship, broadcasts `presence:friends_status` to both
- On decline: deletes the request

##### `DELETE /api/friends/:id`
Remove a friend. Deletes bidirectional friendship.

**Side effect:** Broadcasts `presence:updated` (now invisible to each other)

---

#### Activity Feed

##### `GET /api/activity`
Global friend activity feed — recent events from all friends, paginated.

**Query:**
- `limit` (default 30, max 100)
- `offset` (default 0)
- `mediaId` — filter to a specific media item
- `mediaType` — filter by type
- `userId` — filter to specific friend

**Response:**
```json
{
  "items": [
    {
      "user": { "id": "...", "username": "alex", "displayName": "Alex" },
      "eventType": "complete",
      "mediaId": "abc",
      "mediaTitle": "Breaking Bad",
      "mediaType": "show",
      "timestamp": 1709568000000,
      "metadata": {}
    }
  ],
  "total": 500
}
```

Excludes: ghost mode users, users who aren't friends, raw `progress` events (too noisy). Shows: `play_start`, `play_stop`, `complete`, `rate`, `favorite`, `add_to_watchlist`, `request`, `mark_watched`.

##### `GET /api/media/:id/friends`
Friends who have interacted with a specific media item.

**Query:** `serviceId` (required)
**Response:**
```json
{
  "watched": [
    { "id": "...", "username": "alex", "displayName": "Alex", "completedAt": 1709568000000, "rating": 8.5 }
  ],
  "watching": [
    { "id": "...", "username": "jordan", "displayName": "Jordan", "progress": 0.45 }
  ],
  "watchlisted": [
    { "id": "...", "username": "sam", "displayName": "Sam" }
  ]
}
```

---

#### Watch Sessions (Watch Parties / Net-Play)

##### `GET /api/sessions`
List active sessions visible to current user (friends' sessions + own).

**Response:**
```json
[
  {
    "id": "session123",
    "host": { "id": "...", "username": "parker", "displayName": "Parker" },
    "type": "watch_party",
    "mediaTitle": "Interstellar",
    "mediaType": "movie",
    "status": "playing",
    "participants": 3,
    "maxParticipants": 8,
    "createdAt": 1709568000000
  }
]
```

##### `GET /api/sessions/:id`
Full session detail with participant list.

**Response:**
```json
{
  "id": "session123",
  "host": { "id": "...", "username": "parker" },
  "type": "watch_party",
  "mediaId": "xyz",
  "serviceId": "jellyfin-1",
  "mediaTitle": "Interstellar",
  "mediaType": "movie",
  "status": "playing",
  "maxParticipants": 8,
  "participants": [
    { "userId": "...", "username": "parker", "role": "host", "joinedAt": 1709568000000 },
    { "userId": "...", "username": "alex", "role": "participant", "joinedAt": 1709568100000 }
  ],
  "createdAt": 1709568000000
}
```

##### `POST /api/sessions`
Create a new session.

**Body:**
```json
{
  "type": "watch_party",
  "mediaId": "xyz",
  "serviceId": "jellyfin-1",
  "mediaTitle": "Interstellar",
  "mediaType": "movie",
  "maxParticipants": 8
}
```

**Response:** Full session object
**Side effect:** Creator automatically joins as host

##### `PUT /api/sessions/:id`
Update session status (host only).

**Body:** `{ status: 'playing' | 'paused' | 'waiting' }`
**Side effect:** Broadcasts `session:status_changed` to all participants via WebSocket

##### `DELETE /api/sessions/:id`
End session (host only). Sets status to `ended`, sets `endedAt`.

**Side effect:** Broadcasts `session:status_changed` with `ended` status, disconnects all participants

##### `POST /api/sessions/:id/join`
Join a session.

**Errors:** 403 if session full, 404 if not found or ended
**Side effect:** Broadcasts `session:participant_joined` to all participants

##### `POST /api/sessions/:id/leave`
Leave a session. If host leaves, session ends.

**Side effect:** Broadcasts `session:participant_left`. If host, broadcasts `session:status_changed` with `ended`.

##### `POST /api/sessions/:id/invite`
Invite friends to a session.

**Body:** `{ userIds: string[] }`
**Side effect:** Sends real-time notification to invited users via presence WebSocket

##### `GET /api/sessions/:id/messages?limit=50&before={timestamp}`
Paginated chat history for a session.

**Response:**
```json
{
  "messages": [
    {
      "id": "msg123",
      "user": { "id": "...", "username": "alex" },
      "content": "This scene is amazing",
      "type": "text",
      "createdAt": 1709568000000
    }
  ],
  "hasMore": true
}
```

##### `POST /api/sessions/:id/messages`
Send a chat message in a session.

**Body:** `{ content: string, type?: 'text' | 'reaction' }`
**Side effect:** Broadcasts `session:message` to all participants via WebSocket

##### `GET /api/media/:id/session`
Check if there's an active session for a specific media item (friends' sessions).

**Query:** `serviceId` (required)
**Response:** Session object or `null`

---

#### Sharing

##### `GET /api/shared?limit=20&offset=0`
Items shared with the current user, newest first.

**Response:**
```json
{
  "items": [
    {
      "id": "share123",
      "from": { "id": "...", "username": "alex", "displayName": "Alex" },
      "mediaId": "xyz",
      "serviceId": "jellyfin-1",
      "mediaType": "movie",
      "mediaTitle": "Arrival",
      "mediaPoster": "https://...",
      "message": "You'd love this!",
      "seen": false,
      "createdAt": 1709568000000
    }
  ],
  "total": 15
}
```

##### `POST /api/shared`
Share a media item with one or more friends.

**Body:**
```json
{
  "toUserIds": ["friend1", "friend2"],
  "mediaId": "xyz",
  "serviceId": "jellyfin-1",
  "mediaType": "movie",
  "mediaTitle": "Arrival",
  "mediaPoster": "https://...",
  "message": "You'd love this!"
}
```

**Response:** `{ shared: number }` — count of shares created
**Errors:** 400 if any target is not a friend
**Side effect:** Sends real-time notification to recipients via presence WebSocket

##### `PUT /api/shared/:id/seen`
Mark a shared item as seen.

**Response:** `{ ok: true }`

##### `GET /api/shared/unseen/count`
Count of unseen shared items (for badge/notification).

**Response:** `{ count: number }`

---

#### Collaborative Playlists

##### `GET /api/playlists/collab`
List collaborative playlists the user is part of (as owner, editor, or viewer).

**Response:**
```json
[
  {
    "id": "pl123",
    "name": "Movie Night Picks",
    "description": "Our watch list",
    "creator": { "id": "...", "username": "parker" },
    "visibility": "friends",
    "itemCount": 12,
    "memberCount": 3,
    "myRole": "owner",
    "updatedAt": 1709568000000
  }
]
```

##### `GET /api/playlists/collab/:id`
Full playlist with items and members.

**Response:**
```json
{
  "id": "pl123",
  "name": "Movie Night Picks",
  "description": "Our watch list",
  "creator": { "id": "...", "username": "parker" },
  "visibility": "friends",
  "members": [
    { "userId": "...", "username": "parker", "role": "owner" },
    { "userId": "...", "username": "alex", "role": "editor" }
  ],
  "items": [
    {
      "id": "item1",
      "mediaId": "xyz",
      "serviceId": "jellyfin-1",
      "mediaType": "movie",
      "mediaTitle": "Arrival",
      "mediaPoster": "https://...",
      "addedBy": { "id": "...", "username": "alex" },
      "position": 0,
      "createdAt": 1709568000000
    }
  ],
  "createdAt": 1709568000000,
  "updatedAt": 1709568000000
}
```

##### `POST /api/playlists/collab`
Create a new collaborative playlist.

**Body:** `{ name, description?, visibility?: 'private'|'friends'|'public' }`
**Response:** Full playlist object (creator auto-added as owner)

##### `PUT /api/playlists/collab/:id`
Update playlist metadata.

**Auth:** Owner or editor
**Body:** `{ name?, description?, visibility? }`

##### `DELETE /api/playlists/collab/:id`
Delete playlist and all items/members.

**Auth:** Owner only

##### `POST /api/playlists/collab/:id/items`
Add media to a playlist.

**Auth:** Owner or editor
**Body:**
```json
{
  "mediaId": "xyz",
  "serviceId": "jellyfin-1",
  "mediaType": "movie",
  "mediaTitle": "Arrival",
  "mediaPoster": "https://..."
}
```

**Response:** Created item object with `position` set to end of list

##### `DELETE /api/playlists/collab/:id/items/:mediaId`
Remove media from a playlist.

**Auth:** Owner or editor (editors can only remove items they added, owners can remove any)

##### `POST /api/playlists/collab/:id/collaborators`
Add a collaborator to a playlist.

**Auth:** Owner only
**Body:** `{ userId, role: 'editor' | 'viewer' }`
**Errors:** 400 if not a friend, 409 if already a member

##### `DELETE /api/playlists/collab/:id/collaborators/:userId`
Remove a collaborator. User can also remove themselves.

**Auth:** Owner, or self-removal

---

### WebSocket Channels

Two persistent WebSocket connections handle all real-time communication.

#### Presence WebSocket — `ws://.../ws/presence`

Maintains online status, broadcasts friend activity changes, delivers notifications.

**Authentication:** Session token sent as query param or first message: `{ type: 'auth', token: '...' }`

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `presence:heartbeat` | client→server | `{}` | Keep-alive, sent every 30s. Server marks user offline after 90s without heartbeat. |
| `presence:friends_status` | server→client | `{ friends: [{userId, status, customStatus, currentActivity}] }` | Bulk status dump on initial connect |
| `presence:updated` | server→client | `{ userId, status, customStatus, currentActivity? }` | Single friend status change (online/away/offline, activity start/stop) |
| `presence:activity_started` | server→client | `{ userId, activity: {type, mediaId, mediaTitle, mediaType, startedAt} }` | Friend started watching/playing/reading |
| `presence:activity_stopped` | server→client | `{ userId }` | Friend stopped their activity |
| `presence:notification` | server→client | `{ type, data }` | Push notification (share received, session invite, friend request) |

**Server-side state:** In-memory `Map<userId, {ws, lastHeartbeat, status}>`. On disconnect or heartbeat timeout, broadcasts `offline` to friends.

**Integration with session poller:** When the Jellyfin session poller detects a user playing media, it updates `user_presence.currentActivity` and broadcasts `presence:activity_started` to online friends.

#### Session WebSocket — `ws://.../ws/session/:sessionId`

Real-time communication within a watch party / game session.

**Authentication:** Same as presence — token in query param or first message.

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `session:message` | bidirectional | `{ userId?, content, type: 'text'|'reaction' }` | Chat message. Server adds userId, persists to session_messages, broadcasts. |
| `session:participant_joined` | server→client | `{ userId, username, displayName }` | Someone joined the session |
| `session:participant_left` | server→client | `{ userId }` | Someone left |
| `session:status_changed` | server→client | `{ status: 'playing'|'paused'|'waiting'|'ended' }` | Host changed session state |
| `session:sync` | server→client | `{ positionTicks, timestamp, status }` | Playback sync pulse (for watch parties — keeps participants in sync) |
| `session:voice_toggle` | bidirectional | `{ userId?, active: boolean }` | Voice chat active/muted state (WebRTC signaling handled separately) |
| `session:invite` | server→client | `{ fromUserId, sessionId, mediaTitle }` | Session invite notification (delivered via presence WS to invited user) |

**Sync mechanism (watch parties):**
- Host periodically sends playback position via the existing `/api/stream/{serviceId}/progress` endpoint
- Server extracts position and broadcasts `session:sync` to participants every 5s
- Participants adjust their local playback to match (client-side drift correction)
- Pause/resume/seek propagated via `session:status_changed`

---

### Privacy & Visibility Rules

| Feature | Ghost Mode | Non-Friend | Friend (Normal) |
|---------|-----------|------------|-----------------|
| Presence status | Always `offline` | Hidden | Visible |
| Current activity | Hidden | Hidden | Visible |
| Activity feed | Excluded | Excluded | Visible |
| Friend activity on media | Excluded | Excluded | Visible |
| Sessions | Hidden | Hidden | Visible (if friends-only) |
| Shared items | Cannot send/receive | Cannot send | Normal |
| Collab playlists | Normal (name visible) | Depends on visibility setting | Normal |

### Analytics Integration

Social events emit to the existing analytics engine:

| Action | Event Type | Notes |
|--------|-----------|-------|
| Send friend request | `friend_request` | metadata: `{toUserId}` |
| Accept friend request | `friend_accept` | metadata: `{fromUserId}` |
| Share media | `share` | metadata: `{toUserIds, mediaId}` |
| Join session | `session_join` | metadata: `{sessionId, sessionType}` |
| Create session | `session_create` | metadata: `{sessionId, sessionType, mediaId}` |
| Send chat message | `session_message` | metadata: `{sessionId}` |
| Add to collab playlist | `playlist_add` | metadata: `{playlistId, mediaId}` |

These use the existing `emitMediaEvent()` / `emitInteractionEvent()` functions.

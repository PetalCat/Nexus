# Invidious Integration Design

## Goal

Full YouTube replacement via self-hosted Invidious — per-user accounts, subscriptions, playlists, watch history, trending, search, video detail with streams. Privacy-focused, no ads.

## Architecture

Invidious acts as a YouTube API proxy. Nexus provisions per-user Invidious accounts (captcha disabled), stores bearer tokens in `user_service_credentials`, and proxies all authenticated requests through the adapter. Unauthenticated endpoints (trending, popular, search, video detail) work without user tokens. Analytics events flow into the existing `media_events` pipeline for stats/wrapped/recommendations.

## Auth Flow

1. Admin adds Invidious service in settings (URL + admin username/password)
2. `ping` calls `GET /api/v1/stats`
3. `createUser(config, username, password)`:
   - POST registration form (captcha disabled) → get SID cookie
   - POST `/api/v1/auth/tokens/register` with SID → get bearer token
   - Return `{ accessToken: token, externalUserId: username, externalUsername: username }`
4. `authenticateUser(config, username, password)`:
   - POST login form → get SID cookie
   - POST `/api/v1/auth/tokens/register` with SID → get bearer token
5. Token stored in `user_service_credentials.access_token`, used as `Authorization: Bearer <token>` on all auth endpoints

**Invidious config requirement:** `captcha_enabled: false` in config.yml.

## Adapter Methods (ServiceAdapter interface)

| Method | Invidious Endpoint | Auth Required |
|---|---|---|
| `ping` | `GET /api/v1/stats` | No |
| `search` | `GET /api/v1/search?q=&type=video` | No |
| `getTrending` | `GET /api/v1/trending` | No |
| `getRecentlyAdded` | `GET /api/v1/popular` | No |
| `getItem` | `GET /api/v1/videos/:id` | No |
| `getLibrary` | `GET /api/v1/auth/feed` | Yes |
| `authenticateUser` | POST login form + token register | No (admin) |
| `createUser` | POST register form + token register | No (admin) |

## Exported Helpers (for dedicated API routes)

- `getSubscriptions(config, userCred)` → `GET /api/v1/auth/subscriptions`
- `subscribe(config, channelId, userCred)` → `POST /api/v1/auth/subscriptions/:ucid`
- `unsubscribe(config, channelId, userCred)` → `DELETE /api/v1/auth/subscriptions/:ucid`
- `getUserPlaylists(config, userCred)` → `GET /api/v1/auth/playlists`
- `createPlaylist(config, title, privacy, userCred)` → `POST /api/v1/auth/playlists`
- `deletePlaylist(config, playlistId, userCred)` → `DELETE /api/v1/auth/playlists/:id`
- `addToPlaylist(config, playlistId, videoId, userCred)` → `POST /api/v1/auth/playlists/:id/videos`
- `removeFromPlaylist(config, playlistId, index, userCred)` → `DELETE /api/v1/auth/playlists/:id/videos/:index`
- `getWatchHistory(config, userCred)` → `GET /api/v1/auth/history`
- `markWatched(config, videoId, userCred)` → `POST /api/v1/auth/history/:id`
- `removeFromHistory(config, videoId, userCred)` → `DELETE /api/v1/auth/history/:id`
- `getChannel(config, channelId)` → `GET /api/v1/channels/:id`
- `getChannelVideos(config, channelId, sort?)` → `GET /api/v1/channels/:id/videos`
- `getComments(config, videoId)` → `GET /api/v1/comments/:id`
- `getSearchSuggestions(config, query)` → `GET /api/v1/search/suggestions?q=`

## Normalization (Video → UnifiedMedia)

```
id:          `${videoId}:${serviceId}`
sourceId:    videoId
serviceId:   config.id
serviceType: 'invidious'
type:        'video'
title:       item.title
description: item.description (truncated for list views)
poster:      videoThumbnails → pick 'medium' quality (320x180)
backdrop:    videoThumbnails → pick 'maxres' quality (1280x720)
year:        new Date(item.published * 1000).getFullYear()
duration:    item.lengthSeconds
rating:      null (YouTube removed public dislikes)
genres:      [item.genre] if present
metadata:
  viewCount:    item.viewCount
  author:       item.author
  authorId:     item.authorId
  authorUrl:    item.authorUrl
  authorVerified: item.authorVerified
  likeCount:    item.likeCount
  publishedText: item.publishedText
  published:    item.published
  isLive:       item.liveNow
  is4k:         item.is4k
  hasCaptions:  item.hasCaptions
  keywords:     item.keywords (detail only)
  recommendedVideos: item.recommendedVideos (detail only)
  adaptiveFormats: item.adaptiveFormats (detail only)
  formatStreams: item.formatStreams (detail only)
  captions:     item.captions (detail only)
```

## API Routes

All under `/api/video/`:

| Route | Method | Description |
|---|---|---|
| `/api/video/trending` | GET | Trending videos, optional `?type=music\|gaming\|movies` |
| `/api/video/popular` | GET | Popular videos |
| `/api/video/subscriptions` | GET | User's subscription feed (`?page=`) |
| `/api/video/subscriptions/:ucid` | POST | Subscribe to channel |
| `/api/video/subscriptions/:ucid` | DELETE | Unsubscribe from channel |
| `/api/video/channels/:id` | GET | Channel detail + latest videos |
| `/api/video/comments/:id` | GET | Video comments |
| `/api/video/playlists` | GET | User's playlists |
| `/api/video/playlists` | POST | Create playlist |
| `/api/video/playlists/:id` | DELETE | Delete playlist |
| `/api/video/playlists/:id/videos` | POST | Add video to playlist |
| `/api/video/playlists/:id/videos/:index` | DELETE | Remove video from playlist |
| `/api/video/history` | GET | Watch history |
| `/api/video/history/:id` | POST | Mark as watched |
| `/api/video/history/:id` | DELETE | Remove from history |
| `/api/video/suggestions` | GET | Search autocomplete (`?q=`) |

## MediaType Addition

Add `'video'` to the `MediaType` union in `src/lib/adapters/types.ts`.

## Files to Create/Modify

1. **Create** `src/lib/adapters/invidious.ts` — adapter + exported helpers
2. **Modify** `src/lib/adapters/registry.ts` — register invidious adapter
3. **Modify** `src/lib/adapters/types.ts` — add `'video'` to MediaType
4. **Modify** `src/lib/server/services.ts` — add `'invidious'` to LIBRARY_TYPES
5. **Modify** `src/routes/settings/+page.svelte` — add invidious to username/password form fields
6. **Create** `src/routes/api/video/trending/+server.ts`
7. **Create** `src/routes/api/video/popular/+server.ts`
8. **Create** `src/routes/api/video/subscriptions/+server.ts`
9. **Create** `src/routes/api/video/subscriptions/[ucid]/+server.ts`
10. **Create** `src/routes/api/video/channels/[id]/+server.ts`
11. **Create** `src/routes/api/video/comments/[id]/+server.ts`
12. **Create** `src/routes/api/video/playlists/+server.ts`
13. **Create** `src/routes/api/video/playlists/[id]/+server.ts`
14. **Create** `src/routes/api/video/playlists/[id]/videos/+server.ts`
15. **Create** `src/routes/api/video/playlists/[id]/videos/[index]/+server.ts`
16. **Create** `src/routes/api/video/history/+server.ts`
17. **Create** `src/routes/api/video/history/[id]/+server.ts`
18. **Create** `src/routes/api/video/suggestions/+server.ts`

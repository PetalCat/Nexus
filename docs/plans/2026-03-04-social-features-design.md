# Social Features Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full social layer to Nexus — friends, real-time presence, activity feed, media sharing, watch parties with chat, and mixed-media collections — all powered by a single multiplexed WebSocket connection that also replaces the analytics HTTP flush.

**Architecture:** Single `ws` WebSocket server attached to the adapter-node HTTP server. One connection per user (multi-tab via `Set<WebSocket>`), authenticated via session token. JSON message protocol with namespaced event types. REST endpoints for CRUD, WebSocket for real-time push and bidirectional session communication. 8 new database tables, ~30 new API endpoints.

**Tech Stack:** SvelteKit, `ws` (zero-dep WebSocket), Drizzle ORM / better-sqlite3, existing analytics engine.

---

## 1. WebSocket Infrastructure

### Server: `src/lib/server/ws.ts`

**New dependency:** `ws` (npm package, zero dependencies)

**Attachment:** Hook into adapter-node's HTTP server via `server.upgrade` event. Single endpoint at `/ws?token={sessionToken}`.

**Connection lifecycle:**
1. Client connects to `/ws?token={sessionToken}`
2. Server validates token via `validateSession(token)` — same auth as HTTP
3. On success: add to `connectedUsers: Map<string, Set<WebSocket>>` (userId → connections)
4. Send initial `presence:friends_status` with all friends' current status
5. Broadcast `presence:updated` (online) to all online friends
6. Client sends `heartbeat` every 30s; server marks `lastSeen`
7. After 90s without heartbeat → mark offline, broadcast to friends
8. On disconnect: remove from set; if no remaining connections → mark offline, broadcast

**Exported API:**
```typescript
attachWebSocketServer(server: http.Server): void
broadcastToUser(userId: string, msg: WsMessage): void
broadcastToFriends(userId: string, msg: WsMessage): void
broadcastToSession(sessionId: string, msg: WsMessage, excludeUserId?: string): void
getOnlineUserIds(): Set<string>
isUserOnline(userId: string): boolean
```

### Message Protocol

All messages are JSON: `{ type: string, data?: object }`

**Client → Server:**
| Type | Data | Purpose |
|------|------|---------|
| `heartbeat` | `{}` | Keep-alive |
| `analytics:events` | `{ events: InteractionEventInput[] }` | Replaces sendBeacon flush |
| `session:message` | `{ sessionId, content, type? }` | Chat in watch session |
| `session:join` | `{ sessionId }` | Join watch session via WS |
| `session:leave` | `{ sessionId }` | Leave watch session |

**Server → Client:**
| Type | Data | Purpose |
|------|------|---------|
| `presence:friends_status` | `{ friends: [{userId, status, customStatus, currentActivity}] }` | Bulk on connect |
| `presence:updated` | `{ userId, status, customStatus?, currentActivity? }` | Single friend change |
| `presence:activity_started` | `{ userId, activity }` | Friend started media |
| `presence:activity_stopped` | `{ userId }` | Friend stopped |
| `presence:notification` | `{ notificationType, data }` | Share received, session invite, friend request |
| `session:message` | `{ sessionId, userId, username, content, type, createdAt }` | Chat message |
| `session:participant_joined` | `{ sessionId, userId, username }` | Join notification |
| `session:participant_left` | `{ sessionId, userId }` | Leave notification |
| `session:status_changed` | `{ sessionId, status }` | Host pause/resume/end |
| `session:sync` | `{ sessionId, positionTicks, timestamp, status }` | Playback sync pulse |
| `session:invite` | `{ sessionId, fromUserId, fromUsername, mediaTitle }` | Invite notification |

### Client: `src/lib/stores/ws.ts`

Svelte store wrapping the WebSocket connection:
- Auto-connects on auth, auto-reconnects with exponential backoff
- Exposes `$wsConnected`, `$onlineFriends`, `$notifications`
- `sendMessage(type, data)` helper
- Routes incoming messages to appropriate stores/handlers
- Analytics events piped through WS when connected, falls back to `sendBeacon`

### Analytics Integration

Update `src/lib/stores/analytics.ts`:
- If WS is connected: send `analytics:events` through WS instead of `sendBeacon`
- `sendBeacon` remains as fallback for: WS disconnected, `beforeunload` (WS may not flush in time)
- Server-side WS handler calls `emitInteractionEventsBatch()` — same ingestion path

---

## 2. Database Tables

All added to `src/lib/db/schema.ts` and `src/lib/db/index.ts`.

### `friendships`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random hex ID |
| userId | text | Requesting user |
| friendId | text | Target user |
| status | text | `pending`, `accepted`, `blocked` |
| createdAt | integer | Unix ms |
| acceptedAt | integer | Unix ms, nullable |

Unique: `(userId, friendId)`
Indexes: `(friendId, status)` for incoming request lookups

### `user_presence`
| Column | Type | Notes |
|--------|------|-------|
| userId | text PK | References users.id |
| status | text | `online`, `away`, `dnd`, `offline` |
| customStatus | text | Free-text |
| ghostMode | integer | 0/1 |
| currentActivity | text | JSON |
| lastSeen | integer | Unix ms |

### `shared_items`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random hex ID |
| fromUserId | text | Sender |
| toUserId | text | Recipient |
| mediaId | text | |
| serviceId | text | |
| mediaType | text | |
| mediaTitle | text | |
| mediaPoster | text | |
| message | text | Optional note |
| seen | integer | 0/1 |
| seenAt | integer | Nullable |
| createdAt | integer | Unix ms |

Indexes: `(toUserId, seen, createdAt)`, `(fromUserId, createdAt)`

### `watch_sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random hex ID |
| hostId | text | Creator |
| type | text | `watch_party`, `netplay`, `listen_along` |
| mediaId | text | |
| serviceId | text | |
| mediaTitle | text | |
| mediaType | text | |
| status | text | `waiting`, `playing`, `paused`, `ended` |
| maxParticipants | integer | 0 = unlimited |
| createdAt | integer | Unix ms |
| endedAt | integer | Nullable |

Index: `(status)` for active session queries

### `session_participants`
| Column | Type | Notes |
|--------|------|-------|
| sessionId | text | FK |
| userId | text | FK |
| joinedAt | integer | Unix ms |
| leftAt | integer | Nullable |
| role | text | `host`, `participant` |

Unique: `(sessionId, userId)`

### `session_messages`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random hex ID |
| sessionId | text | FK |
| userId | text | Sender |
| content | text | |
| type | text | `text`, `system`, `reaction` |
| createdAt | integer | Unix ms |

Index: `(sessionId, createdAt)`

### `collections`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random hex ID |
| name | text | |
| description | text | |
| creatorId | text | FK |
| visibility | text | `private`, `friends`, `public` |
| createdAt | integer | Unix ms |
| updatedAt | integer | Unix ms |

### `collection_items`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Random hex ID |
| collectionId | text | FK |
| mediaId | text | Any media type |
| serviceId | text | |
| mediaType | text | movie, show, episode, game, book, music, album, etc. |
| mediaTitle | text | |
| mediaPoster | text | |
| addedBy | text | FK |
| position | integer | Sort order |
| createdAt | integer | Unix ms |

Index: `(collectionId, position)`

### `collection_members`
| Column | Type | Notes |
|--------|------|-------|
| collectionId | text | FK |
| userId | text | FK |
| role | text | `owner`, `editor`, `viewer` |
| addedAt | integer | Unix ms |

Unique: `(collectionId, userId)`

---

## 3. Server Module: `src/lib/server/social.ts`

Core social logic — friends, presence, sharing queries. Keeps endpoints thin.

**Key functions:**
```typescript
// Friends
getFriends(userId): Friend[]
getFriendIds(userId): string[]
areFriends(a, b): boolean
sendFriendRequest(fromId, toId): void
acceptFriendRequest(requestId): void
declineFriendRequest(requestId): void
removeFriend(userId, friendId): void

// Presence
getPresence(userId): UserPresence
updatePresence(userId, updates): void
updateActivity(userId, activity | null): void
isGhostMode(userId): boolean

// Sharing
getSharedItems(userId, opts): { items, total }
shareItem(fromId, toIds, media): number
markSeen(shareId, userId): void
getUnseenCount(userId): number

// Activity feed
getFriendActivity(userId, opts): { items, total }
getMediaFriendActivity(userId, mediaId, serviceId): { watched, watching, watchlisted }
```

---

## 4. API Endpoints

### Friends — `src/routes/api/friends/`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/friends` | List friends with presence |
| GET | `/api/friends/online` | Online friends only |
| GET | `/api/friends/:id` | Single friend profile |
| GET | `/api/friends/:id/activity` | Friend's activity history |
| POST | `/api/friends/requests` | Send request |
| GET | `/api/friends/requests` | List pending requests (incoming + outgoing) |
| PUT | `/api/friends/requests/:id` | Accept/decline |
| DELETE | `/api/friends/:id` | Remove friend |

### Presence — `src/routes/api/auth/`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/auth/me` | Full profile + presence |
| PUT | `/api/auth/me/status` | Update status/custom status |
| PUT | `/api/auth/me/ghost` | Toggle ghost mode |

### Activity — `src/routes/api/activity/` (rename existing)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/activity` | Friend activity feed |
| GET | `/api/media/:id/friends` | Friends who interacted with media |

### Sharing — `src/routes/api/shared/`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/shared` | Items shared with me |
| POST | `/api/shared` | Share with friend(s) |
| PUT | `/api/shared/:id/seen` | Mark seen |
| GET | `/api/shared/unseen/count` | Badge count |

### Watch Sessions — `src/routes/api/sessions/`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/sessions` | Active sessions (friends) |
| GET | `/api/sessions/:id` | Session detail |
| POST | `/api/sessions` | Create session |
| PUT | `/api/sessions/:id` | Update status (host) |
| DELETE | `/api/sessions/:id` | End session (host) |
| POST | `/api/sessions/:id/join` | Join |
| POST | `/api/sessions/:id/leave` | Leave |
| POST | `/api/sessions/:id/invite` | Invite friends |
| GET | `/api/sessions/:id/messages` | Chat history |
| GET | `/api/media/:id/session` | Active session for media |

Chat messages sent via WebSocket, not REST POST.

### Collections — `src/routes/api/collections/`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/collections` | My collections |
| GET | `/api/collections/:id` | Collection detail + items |
| POST | `/api/collections` | Create |
| PUT | `/api/collections/:id` | Update name/desc/visibility |
| DELETE | `/api/collections/:id` | Delete (owner) |
| POST | `/api/collections/:id/items` | Add media (any type) |
| DELETE | `/api/collections/:id/items/:itemId` | Remove media |
| POST | `/api/collections/:id/members` | Add collaborator |
| DELETE | `/api/collections/:id/members/:userId` | Remove collaborator |

---

## 5. Session Poller Integration

The existing Jellyfin session poller (`session-poller.ts`) already detects play_start/play_stop. Add a hook:

When `play_start` is emitted for a user:
1. Update `user_presence.currentActivity` with media info
2. Call `broadcastToFriends(userId, { type: 'presence:activity_started', data: activity })`

When `play_stop`:
1. Clear `user_presence.currentActivity`
2. Call `broadcastToFriends(userId, { type: 'presence:activity_stopped', data: { userId } })`

Respects ghost mode — check before broadcasting.

---

## 6. Privacy Rules

| Feature | Ghost Mode | Non-Friend | Friend |
|---------|-----------|------------|--------|
| Presence | Always `offline` | Hidden | Visible |
| Activity | Hidden | Hidden | Visible |
| Sessions | Hidden | Hidden | Visible |
| Sharing | Cannot send/receive | Cannot send | Normal |
| Collections | Name visible | Depends on visibility | Normal |
| Media friend activity | Excluded | Excluded | Visible |

---

## 7. Implementation Order

1. **WS infrastructure** — `ws` dep, server module, client store, analytics pipe-through
2. **DB tables** — all 8 tables + indexes in schema.ts / index.ts
3. **Social module** — `src/lib/server/social.ts` core functions
4. **Friends** — endpoints + WS notifications for requests
5. **Presence** — endpoints, WS heartbeat/status, session poller hooks
6. **Activity feed** — friend activity query endpoint
7. **Sharing** — endpoints + WS notifications
8. **Watch sessions** — REST + WS events, chat, sync
9. **Collections** — full CRUD endpoints

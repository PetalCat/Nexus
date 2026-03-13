# Tracking System Rebuild Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken append-only `media_events` table with a session-based `play_sessions` model that produces accurate playback stats.

**Architecture:** Single-writer session model. The Jellyfin session poller creates/updates `play_sessions` rows directly (no event emission). Webhooks enrich existing sessions with metadata. Non-playback actions (rate, mark_watched, etc.) go to a new `media_actions` table. Stats queries hit `play_sessions` directly for recent data, with pre-computed rollups for long-range periods.

**Tech Stack:** SvelteKit, Drizzle ORM + better-sqlite3 (raw SQL), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-13-tracking-system-rebuild-design.md`

---

## File Structure

### New files
- (none — all changes are to existing files)

### Modified files (by task)

| Task | Files | Responsibility |
|------|-------|---------------|
| 1 | `src/lib/db/schema.ts`, `src/lib/db/index.ts` | Schema: add `play_sessions`, `media_actions`, `stats_rollups`; drop `media_events`, `user_stats_cache` |
| 2 | `src/lib/server/analytics.ts` | Replace `emitMediaEvent` with `emitMediaAction`. Keep interaction events. Add session query helpers |
| 3 | `src/lib/server/session-poller.ts` | Rewrite to create/update `play_sessions` rows instead of emitting events |
| 4 | `src/lib/server/stats-engine.ts` | Rewrite `computeStats()` to query `play_sessions` + `media_actions` directly |
| 5 | `src/lib/server/stats-scheduler.ts` | Simplify to only rebuild monthly/yearly/alltime rollups |
| 6 | `src/routes/api/ingest/webhook/[serviceType]/+server.ts` | Webhook writes `media_actions`, enriches open sessions |
| 7 | 3 progress endpoints, `ratings.ts`, media detail page | Replace `emitMediaEvent()` calls with `emitMediaAction()` or session updates |
| 8 | 5 recommendation providers, `rec-scheduler.ts`, `music.ts` | Rewrite `media_events` SQL → `play_sessions` |
| 9 | Stats API routes (user + admin), play-history, search suggestions | Rewrite consumers to query `play_sessions` |

---

## Chunk 1: Foundation

### Task 1: Schema — Add new tables, drop old ones

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/index.ts`

- [ ] **Step 1: Add `playSessions` table to Drizzle schema**

In `src/lib/db/schema.ts`, add after the `mediaEvents` table definition (around line 150):

```typescript
// ── Play Sessions (replaces media_events) ────────────────────────────
export const playSessions = sqliteTable('play_sessions', {
	id: text('id').primaryKey(),
	sessionKey: text('session_key').unique(),
	userId: text('user_id').notNull(),
	serviceId: text('service_id').notNull(),
	serviceType: text('service_type').notNull(),
	mediaId: text('media_id').notNull(),
	mediaType: text('media_type').notNull(),
	mediaTitle: text('media_title'),
	mediaYear: integer('media_year'),
	mediaGenres: text('media_genres'),
	parentId: text('parent_id'),
	parentTitle: text('parent_title'),
	startedAt: integer('started_at').notNull(),
	endedAt: integer('ended_at'),
	durationMs: integer('duration_ms').default(0),
	mediaDurationMs: integer('media_duration_ms'),
	progress: real('progress'),
	completed: integer('completed').default(0),
	deviceName: text('device_name'),
	clientName: text('client_name'),
	metadata: text('metadata'),
	source: text('source').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export type PlaySession = typeof playSessions.$inferSelect;
export type NewPlaySession = typeof playSessions.$inferInsert;
```

- [ ] **Step 2: Add `mediaActions` table to Drizzle schema**

In `src/lib/db/schema.ts`, add after `playSessions`:

```typescript
// ── Media Actions (non-playback events: ratings, marks, etc.) ────────
export const mediaActions = sqliteTable('media_actions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	serviceId: text('service_id').notNull(),
	serviceType: text('service_type').notNull(),
	actionType: text('action_type').notNull(),
	mediaId: text('media_id').notNull(),
	mediaType: text('media_type').notNull(),
	mediaTitle: text('media_title'),
	metadata: text('metadata'),
	timestamp: integer('timestamp').notNull()
});

export type MediaAction = typeof mediaActions.$inferSelect;
```

- [ ] **Step 3: Add `statsRollups` table to Drizzle schema**

In `src/lib/db/schema.ts`, add after `mediaActions`:

```typescript
// ── Stats Rollups (pre-computed for monthly/yearly/alltime) ──────────
export const statsRollups = sqliteTable('stats_rollups', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	period: text('period').notNull(),
	mediaType: text('media_type').notNull(),
	stats: text('stats').notNull(),
	computedAt: integer('computed_at').notNull()
});

export type StatsRollup = typeof statsRollups.$inferSelect;
```

- [ ] **Step 4: Remove old type exports that reference `mediaEvents` and `userStatsCache`**

In `src/lib/db/schema.ts`, remove these lines (around line 189-193):

```typescript
// DELETE these lines:
export type MediaEvent = typeof mediaEvents.$inferSelect;
export type NewMediaEvent = typeof mediaEvents.$inferInsert;
// And remove:
export type UserStatsEntry = typeof userStatsCache.$inferSelect;
```

Do NOT delete the `mediaEvents` or `userStatsCache` table definitions yet — they're still referenced by `index.ts`. We'll handle the `CREATE TABLE` migration in the next step.

- [ ] **Step 5: Update `initDb()` — add new tables, drop old ones**

In `src/lib/db/index.ts`, add the new table creation SQL after the `user_stats_cache` block (around line 205). Then add the DROP statements:

```typescript
	// ── Play Sessions (replaces media_events) ──────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS play_sessions (
		id TEXT PRIMARY KEY,
		session_key TEXT UNIQUE,
		user_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		service_type TEXT NOT NULL,
		media_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		media_title TEXT,
		media_year INTEGER,
		media_genres TEXT,
		parent_id TEXT,
		parent_title TEXT,
		started_at INTEGER NOT NULL,
		ended_at INTEGER,
		duration_ms INTEGER DEFAULT 0,
		media_duration_ms INTEGER,
		progress REAL,
		completed INTEGER DEFAULT 0,
		device_name TEXT,
		client_name TEXT,
		metadata TEXT,
		source TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ps_user_started ON play_sessions(user_id, started_at)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ps_user_media ON play_sessions(user_id, media_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ps_user_type ON play_sessions(user_id, media_type)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ps_active ON play_sessions(ended_at) WHERE ended_at IS NULL`);

	// ── Media Actions ──────────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS media_actions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		service_type TEXT NOT NULL,
		action_type TEXT NOT NULL,
		media_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		media_title TEXT,
		metadata TEXT,
		timestamp INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ma_user ON media_actions(user_id, timestamp)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ma_user_action ON media_actions(user_id, action_type, timestamp)`);

	// ── Stats Rollups ──────────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS stats_rollups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		period TEXT NOT NULL,
		media_type TEXT NOT NULL,
		stats TEXT NOT NULL,
		computed_at INTEGER NOT NULL,
		UNIQUE(user_id, period, media_type)
	)`);

	// ── Migration: drop old tracking tables ────────────────────────
	db.run(`DROP TABLE IF EXISTS media_events`);
	db.run(`DROP TABLE IF EXISTS user_stats_cache`);
```

- [ ] **Step 6: Remove old `media_events` and `user_stats_cache` CREATE/INDEX statements from `initDb()`**

In `src/lib/db/index.ts`, delete lines 144-205 (the entire `media_events` CREATE TABLE, all its indexes, `user_stats_cache` CREATE TABLE, and its unique index). These are replaced by the DROP + new CREATE statements.

- [ ] **Step 7: Now remove the old Drizzle table definitions from schema.ts**

In `src/lib/db/schema.ts`, remove the `mediaEvents` table definition (lines 129-150) and the `userStatsCache` table definition (lines 170-177). Keep `interactionEvents`.

- [ ] **Step 8: Test the app starts without errors**

Run: `cd /Users/parker/Developer/Nexus && pnpm dev`
Expected: App starts, creates new tables, drops old ones. Check the terminal for any import/reference errors.

Note: The app will have runtime errors in many files that still reference `emitMediaEvent` or `media_events` — that's expected and will be fixed in subsequent tasks.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/index.ts
git commit -m "feat(tracking): add play_sessions, media_actions, stats_rollups tables; drop media_events"
```

---

### Task 2: Analytics — Replace `emitMediaEvent` with `emitMediaAction`

**Files:**
- Modify: `src/lib/server/analytics.ts`

- [ ] **Step 1: Replace `emitMediaEvent` and `emitMediaEventsBatch` with `emitMediaAction`**

Rewrite `src/lib/server/analytics.ts`. Keep: constants, webhook/poller registries, user resolution helpers, playback metadata types, interaction event functions. Remove: `emitMediaEvent`, `emitMediaEventsBatch`, `queryMediaEvents`, `countMediaEvents`, `MediaEventInput`, `EventQueryOpts`. Add: `emitMediaAction`, `queryPlaySessions`, `findOpenSession`, `upsertPlaySession`.

```typescript
// ── New: Media action ingestion (non-playback events) ─────────────

export interface MediaActionInput {
	userId: string;
	serviceId: string;
	serviceType: string;
	actionType: string;
	mediaId: string;
	mediaType: string;
	mediaTitle?: string;
	metadata?: Record<string, unknown>;
	timestamp?: number;
}

/** Insert a single media action. Fire-and-forget — never throws. */
export function emitMediaAction(input: MediaActionInput): void {
	try {
		const db = getDb();
		db.insert(schema.mediaActions)
			.values({
				userId: input.userId,
				serviceId: input.serviceId,
				serviceType: input.serviceType,
				actionType: input.actionType,
				mediaId: input.mediaId,
				mediaType: input.mediaType,
				mediaTitle: input.mediaTitle ?? null,
				metadata: input.metadata ? JSON.stringify(input.metadata) : null,
				timestamp: input.timestamp ?? Date.now()
			})
			.run();
	} catch (e) {
		console.error('[analytics] Failed to emit media action:', e);
	}
}

// ── New: Play session helpers (used by poller + progress endpoints) ──

/** Find an open (not ended) session by session_key. */
export function findOpenSessionByKey(sessionKey: string) {
	const db = getRawDb();
	return db.prepare(
		`SELECT * FROM play_sessions WHERE session_key = ? AND ended_at IS NULL`
	).get(sessionKey) as any | undefined;
}

/** Find an open session for a user + media combination. */
export function findOpenSession(userId: string, mediaId: string, serviceId: string) {
	const db = getRawDb();
	return db.prepare(
		`SELECT * FROM play_sessions WHERE user_id = ? AND media_id = ? AND service_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`
	).get(userId, mediaId, serviceId) as any | undefined;
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd /Users/parker/Developer/Nexus && npx tsc --noEmit src/lib/server/analytics.ts 2>&1 | head -20`

There will be errors from other files importing the removed functions — that's expected.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/analytics.ts
git commit -m "feat(tracking): replace emitMediaEvent with emitMediaAction + session helpers"
```

---

### Task 3: Session Poller — Write to `play_sessions` instead of emitting events

**Files:**
- Modify: `src/lib/server/session-poller.ts`

This is the most critical task. The poller must:
1. INSERT a `play_sessions` row when a new playback is detected
2. UPDATE `duration_ms` and `progress` every 10s for active sessions
3. SET `ended_at` when a session disappears
4. Use `session_key` for crash recovery (INSERT ON CONFLICT UPDATE)

- [ ] **Step 1: Update imports**

Replace the analytics imports at the top of `session-poller.ts`:

```typescript
import { getEnabledConfigs } from './services';
import {
	resolveNexusUserId,
	getCredsForService,
	heightToResolution,
	channelsToLabel,
	emitMediaAction
} from './analytics';
import { updatePresence, isGhostMode, getFriendIds } from './social';
import { broadcastToFriends } from './ws';
import { getRawDb } from '../db';
import { randomBytes } from 'crypto';
```

- [ ] **Step 2: Update TrackedSession interface**

Replace the `TrackedSession` interface to include a DB row ID and lastTickAt:

```typescript
interface TrackedSession {
	sessionId: string;       // in-memory key: `${configId}:${jellyfinSessionId}`
	dbId: string;            // play_sessions.id (nanoid)
	sessionKey: string;      // play_sessions.session_key for crash recovery
	serviceId: string;
	userId: string;
	mediaId: string;
	mediaType: string;
	mediaTitle: string;
	isPaused: boolean;
	startedAt: number;
	lastTickAt: number;      // last time we incremented durationMs
	lastSeenAt: number;
	pausedSinceAt: number | null;
	totalPausedMs: number;
	durationMs: number;      // accumulated active play time
	mediaDurationMs: number | null;
}
```

- [ ] **Step 3: Add DB helper functions**

Add these after the `capDuration` function:

```typescript
function genId(): string {
	return randomBytes(12).toString('hex');
}

function insertSession(session: TrackedSession, metadata: Record<string, unknown>, genres?: string[], year?: number, parentId?: string, parentTitle?: string): void {
	const db = getRawDb();
	const now = Date.now();
	db.prepare(`
		INSERT INTO play_sessions (id, session_key, user_id, service_id, service_type, media_id, media_type, media_title, media_year, media_genres, parent_id, parent_title, started_at, ended_at, duration_ms, media_duration_ms, progress, completed, device_name, client_name, metadata, source, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'jellyfin', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, 0, 0, ?, ?, ?, 'poller', ?, ?)
		ON CONFLICT(session_key) DO UPDATE SET
			ended_at = NULL, duration_ms = 0, progress = 0, completed = 0, updated_at = excluded.updated_at
	`).run(
		session.dbId, session.sessionKey, session.userId, session.serviceId,
		session.mediaId, session.mediaType, session.mediaTitle,
		year ?? null, genres ? JSON.stringify(genres) : null,
		parentId ?? null, parentTitle ?? null,
		session.startedAt, session.mediaDurationMs ?? null,
		null, null, // device_name, client_name — set via updateSessionMeta
		Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
		now, now
	);
}

function updateSessionTick(dbId: string, durationMs: number, progress: number | null): void {
	const db = getRawDb();
	db.prepare(
		`UPDATE play_sessions SET duration_ms = ?, progress = ?, updated_at = ? WHERE id = ?`
	).run(durationMs, progress, Date.now(), dbId);
}

function closeSession(dbId: string, finalDurationMs: number, progress: number | null, completed: boolean): void {
	const db = getRawDb();
	const now = Date.now();
	db.prepare(
		`UPDATE play_sessions SET ended_at = ?, duration_ms = ?, progress = ?, completed = ?, updated_at = ? WHERE id = ?`
	).run(now, finalDurationMs, progress, completed ? 1 : 0, now, dbId);
}

function updateSessionMeta(dbId: string, deviceName: string | null, clientName: string | null, metadata: Record<string, unknown>): void {
	const db = getRawDb();
	db.prepare(
		`UPDATE play_sessions SET device_name = ?, client_name = ?, metadata = ?, updated_at = ? WHERE id = ?`
	).run(deviceName, clientName, Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null, Date.now(), dbId);
}
```

- [ ] **Step 4: Rewrite `pollJellyfinSessions()` — new session detection**

Replace the `if (!existing)` block (around line 170-203) with:

```typescript
				if (!existing) {
					// New session — create DB row + in-memory tracker
					const dbId = genId();
					const sessionKey = `${config.id}:${session.Id}`;
					const tracker: TrackedSession = {
						sessionId: key,
						dbId,
						sessionKey,
						serviceId: config.id,
						userId: nexusUserId,
						mediaId: item.Id,
						mediaType: mType,
						mediaTitle: item.Name,
						isPaused,
						startedAt: now,
						lastTickAt: now,
						lastSeenAt: now,
						pausedSinceAt: isPaused ? now : null,
						totalPausedMs: 0,
						durationMs: 0,
						mediaDurationMs: mediaDurationMs
					};
					activeSessions.set(key, tracker);

					const metadata = extractMetadata(session);
					insertSession(tracker, metadata, item.Genres, item.ProductionYear, item.SeriesId, item.SeriesName);
					updateSessionMeta(dbId, session.DeviceName, session.Client, metadata);

					updateActivityPresence(nexusUserId, {
						mediaId: item.Id, mediaType: mType, mediaTitle: item.Name,
						serviceId: config.id, deviceName: session.DeviceName, clientName: session.Client
					});
```

- [ ] **Step 5: Rewrite — media changed detection**

Replace the `else if (existing.mediaId !== item.Id)` block with:

```typescript
				} else if (existing.mediaId !== item.Id) {
					// Media changed — close old session, open new one
					const finalDur = capDuration(existing.durationMs, existing.mediaDurationMs);
					const progress = existing.mediaDurationMs ? Math.min(existing.durationMs / existing.mediaDurationMs, 1) : null;
					closeSession(existing.dbId, finalDur, progress, (progress ?? 0) >= 0.9);

					const dbId = genId();
					const sessionKey = `${config.id}:${session.Id}`;
					const tracker: TrackedSession = {
						sessionId: key,
						dbId,
						sessionKey,
						serviceId: config.id,
						userId: nexusUserId,
						mediaId: item.Id,
						mediaType: mType,
						mediaTitle: item.Name,
						isPaused,
						startedAt: now,
						lastTickAt: now,
						lastSeenAt: now,
						pausedSinceAt: isPaused ? now : null,
						totalPausedMs: 0,
						durationMs: 0,
						mediaDurationMs: mediaDurationMs
					};
					activeSessions.set(key, tracker);

					const metadata = extractMetadata(session);
					insertSession(tracker, metadata, item.Genres, item.ProductionYear, item.SeriesId, item.SeriesName);
					updateSessionMeta(dbId, session.DeviceName, session.Client, metadata);

					updateActivityPresence(nexusUserId, {
						mediaId: item.Id, mediaType: mType, mediaTitle: item.Name,
						serviceId: config.id, deviceName: session.DeviceName, clientName: session.Client
					});
```

- [ ] **Step 6: Rewrite — same media, pause/resume/tick**

Replace the `else` block (same media detection, around line 258-296) with:

```typescript
				} else {
					// Same media — handle pause/resume + increment duration
					if (isPaused && !existing.isPaused) {
						// Just paused
						existing.pausedSinceAt = now;
					} else if (!isPaused && existing.isPaused) {
						// Just resumed
						if (existing.pausedSinceAt) {
							existing.totalPausedMs += now - existing.pausedSinceAt;
						}
						existing.pausedSinceAt = null;
					}

					// Increment duration for active (non-paused) time
					if (!isPaused) {
						const elapsed = now - existing.lastTickAt;
						existing.durationMs += elapsed;
						// Cap at media duration * 1.1
						if (existing.mediaDurationMs && existing.durationMs > existing.mediaDurationMs * 1.1) {
							existing.durationMs = existing.mediaDurationMs;
						}
					}

					existing.isPaused = isPaused;
					existing.lastTickAt = now;
					existing.lastSeenAt = now;

					// Update DB every tick
					const progress = existing.mediaDurationMs
						? Math.min(existing.durationMs / existing.mediaDurationMs, 1)
						: (session.PlayState?.PositionTicks && mediaDurationMs
							? Math.min((session.PlayState.PositionTicks / 10_000) / mediaDurationMs, 1)
							: null);
					updateSessionTick(existing.dbId, existing.durationMs, progress);
				}
```

- [ ] **Step 7: Rewrite — session ended detection**

Replace the session-ended loop (around line 308-326) with:

```typescript
	// Detect ended sessions
	for (const [key, session] of activeSessions) {
		if (failedServiceIds.has(session.serviceId)) continue;
		if (!seenKeys.has(key)) {
			const finalDur = capDuration(session.durationMs, session.mediaDurationMs);
			const progress = session.mediaDurationMs ? Math.min(session.durationMs / session.mediaDurationMs, 1) : null;
			closeSession(session.dbId, finalDur, progress, (progress ?? 0) >= 0.9);
			updateActivityPresence(session.userId, null);
			activeSessions.delete(key);
		}
	}

	// Stale session cleanup: close sessions not updated in > max(mediaDurationMs * 1.5, 4h)
	const STALE_FLOOR_MS = 4 * 60 * 60 * 1000; // 4 hours
	for (const [key, session] of activeSessions) {
		const staleThreshold = Math.max((session.mediaDurationMs ?? 0) * 1.5, STALE_FLOOR_MS);
		if (now - session.lastSeenAt > staleThreshold) {
			const finalDur = capDuration(session.durationMs, session.mediaDurationMs);
			closeSession(session.dbId, finalDur, null, false);
			updateActivityPresence(session.userId, null);
			activeSessions.delete(key);
			console.log(`[poller] Auto-closed stale session for ${session.mediaTitle} (${key})`);
		}
	}
```

- [ ] **Step 8: Update RomM poller to write `play_sessions` / `media_actions`**

Replace the `emitMediaEvent` call inside `pollRommStatuses()` (around line 388-406) with:

```typescript
							const genres = (rom.metadatum?.genres ?? rom.genres ?? [])
								.map((g: { name?: string } | string) => typeof g === 'string' ? g : g.name)
								.filter(Boolean) as string[];

							const eventType = statusEventMap[userStatus] ?? 'mark_watched';

							if (userStatus === 'playing') {
								// Open a game session
								const dbId = genId();
								const db = getRawDb();
								const now = Date.now();
								db.prepare(`
									INSERT INTO play_sessions (id, session_key, user_id, service_id, service_type, media_id, media_type, media_title, media_genres, parent_title, started_at, duration_ms, metadata, source, created_at, updated_at)
									VALUES (?, ?, ?, ?, 'romm', ?, 'game', ?, ?, ?, ?, 0, ?, 'poller', ?, ?)
								`).run(
									dbId, `romm:${cred.userId}:${rom.id}`, cred.userId, config.id,
									String(rom.id), rom.name || rom.fs_name_no_ext,
									genres.length > 0 ? JSON.stringify(genres) : null,
									rom.platform_display_name,
									now,
									JSON.stringify({ platform: rom.platform_display_name, platformSlug: rom.platform_slug, userStatus }),
									now, now
								);
							} else if (['finished', 'completed', 'retired'].includes(userStatus)) {
								// Close any open game session
								const db = getRawDb();
								const now = Date.now();
								const open = db.prepare(
									`SELECT id, started_at FROM play_sessions WHERE user_id = ? AND media_id = ? AND service_id = ? AND ended_at IS NULL`
								).get(cred.userId, String(rom.id), config.id) as any;
								if (open) {
									const dur = Math.min(now - open.started_at, 4 * 60 * 60 * 1000); // cap 4h
									db.prepare(
										`UPDATE play_sessions SET ended_at = ?, duration_ms = ?, completed = 1, updated_at = ? WHERE id = ?`
									).run(now, dur, now, open.id);
								}
								// Also emit as action
								emitMediaAction({
									userId: cred.userId,
									serviceId: config.id,
									serviceType: 'romm',
									actionType: eventType,
									mediaId: String(rom.id),
									mediaType: 'game',
									mediaTitle: rom.name || rom.fs_name_no_ext,
									metadata: { platform: rom.platform_display_name, userStatus, previousStatus: prevStatus }
								});
							} else {
								// Other status changes → media_actions
								emitMediaAction({
									userId: cred.userId,
									serviceId: config.id,
									serviceType: 'romm',
									actionType: eventType,
									mediaId: String(rom.id),
									mediaType: 'game',
									mediaTitle: rom.name || rom.fs_name_no_ext,
									metadata: { platform: rom.platform_display_name, userStatus, previousStatus: prevStatus }
								});
							}
```

- [ ] **Step 9: Verify app compiles and poller starts**

Run: `cd /Users/parker/Developer/Nexus && pnpm dev`
Expected: `[poller] Starting session poller` in terminal. No crash.

- [ ] **Step 10: Commit**

```bash
git add src/lib/server/session-poller.ts
git commit -m "feat(tracking): rewrite session poller to write play_sessions directly"
```

---

## Chunk 2: Stats Engine + Scheduler + Webhook

### Task 4: Stats Engine — Rewrite to query `play_sessions`

**Files:**
- Modify: `src/lib/server/stats-engine.ts`

- [ ] **Step 1: Rewrite `computeStats()` function**

Replace the entire body of `computeStats()` (lines 137-375). The new version queries `play_sessions` directly — no dedup needed.

Key changes:
- Replace `media_events WHERE event_type = 'play_stop'` → `play_sessions`
- Replace `play_duration_ms` → `duration_ms`
- Replace `duration_ticks` → `media_duration_ms` (already in ms, no `/10000`)
- Replace `timestamp` → `started_at` for time range filtering
- Social signals (likes, ratings, watchlist) come from `media_actions`
- `totalSessions` = `COUNT(*)` from `play_sessions` (not play_start events)
- Remove ALL dedup logic (dayBestMap, 30s window, etc.)

```typescript
export function computeStats(userId: string, from: number, to: number, mediaType?: string): ComputedStats {
	const db = getRawDb();
	const mtFilter = mediaType && mediaType !== 'all' ? ` AND media_type = '${mediaType}'` : '';

	// All sessions in range
	const sessions = db.prepare(`
		SELECT media_id, media_title, media_type, duration_ms, media_duration_ms, media_genres,
		       device_name, client_name, metadata, started_at, completed
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at < ?${mtFilter}
		ORDER BY started_at ASC
	`).all(userId, from, to) as any[];

	// Social signals from media_actions
	const actionCounts = db.prepare(`
		SELECT action_type, COUNT(*) as count FROM media_actions
		WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
		GROUP BY action_type
	`).all(userId, from, to) as { action_type: string; count: number }[];
	const actionMap = new Map(actionCounts.map(r => [r.action_type, r.count]));

	// Aggregate
	let totalPlayTimeMs = 0;
	let longestSessionMs = 0;
	let completions = 0;
	const itemMap = new Map<string, { title: string; mediaType: string; playTimeMs: number; sessions: number }>();
	const genreMap = new Map<string, { playTimeMs: number; count: number }>();
	const deviceMap = new Map<string, { playTimeMs: number; sessions: number }>();
	const clientMap = new Map<string, { playTimeMs: number; sessions: number }>();
	const resolutionMap = new Map<string, number>();
	const hdrMap = new Map<string, number>();
	let transcodeCount = 0;
	let subtitleCount = 0;
	const hourly = new Array(24).fill(0);
	const weekday = new Array(7).fill(0);
	const activeDays = new Set<string>();

	for (const row of sessions) {
		const dur = row.duration_ms ?? 0;
		totalPlayTimeMs += dur;
		if (dur > longestSessionMs) longestSessionMs = dur;
		if (row.completed) completions++;

		// Item aggregation
		const existing = itemMap.get(row.media_id);
		if (existing) { existing.playTimeMs += dur; existing.sessions += 1; }
		else itemMap.set(row.media_id, { title: row.media_title ?? row.media_id, mediaType: row.media_type, playTimeMs: dur, sessions: 1 });

		// Genre aggregation
		if (row.media_genres) {
			try {
				const genres: string[] = JSON.parse(row.media_genres);
				for (const g of genres) {
					const ge = genreMap.get(g);
					if (ge) { ge.playTimeMs += dur; ge.count += 1; }
					else genreMap.set(g, { playTimeMs: dur, count: 1 });
				}
			} catch { /* ignore */ }
		}

		// Device/client
		if (row.device_name) {
			const d = deviceMap.get(row.device_name);
			if (d) { d.playTimeMs += dur; d.sessions += 1; }
			else deviceMap.set(row.device_name, { playTimeMs: dur, sessions: 1 });
		}
		if (row.client_name) {
			const c = clientMap.get(row.client_name);
			if (c) { c.playTimeMs += dur; c.sessions += 1; }
			else clientMap.set(row.client_name, { playTimeMs: dur, sessions: 1 });
		}

		// Technical metadata
		if (row.metadata) {
			try {
				const meta = JSON.parse(row.metadata);
				if (meta.resolution) resolutionMap.set(meta.resolution, (resolutionMap.get(meta.resolution) ?? 0) + 1);
				if (meta.hdr) hdrMap.set(meta.hdr, (hdrMap.get(meta.hdr) ?? 0) + 1);
				if (meta.isTranscoding) transcodeCount++;
				if (meta.subtitleLanguage) subtitleCount++;
			} catch { /* ignore */ }
		}

		// Time patterns
		const date = new Date(row.started_at);
		hourly[date.getHours()] += dur;
		weekday[date.getDay()] += dur;
		activeDays.add(`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`);
	}

	const totalSessions = sessions.length;
	const avgSessionLengthMs = totalSessions > 0 ? totalPlayTimeMs / totalSessions : 0;

	// Completion rate
	const startedItems = new Set(sessions.map((r: any) => r.media_id));
	const avgCompletionRate = startedItems.size > 0 ? completions / startedItems.size : 0;

	// Top lists (same logic as before — keep this section unchanged)
	const topItems = [...itemMap.entries()]
		.map(([mediaId, v]) => ({ mediaId, ...v }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 20);

	const totalGenreTime = [...genreMap.values()].reduce((s, g) => s + g.playTimeMs, 0);
	const topGenres = [...genreMap.entries()]
		.map(([genre, v]) => ({ genre, ...v, pct: totalGenreTime > 0 ? Math.round((v.playTimeMs / totalGenreTime) * 100) : 0 }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs);

	const topDevices = [...deviceMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.playTimeMs - a.playTimeMs).slice(0, 10);
	const topClients = [...clientMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.playTimeMs - a.playTimeMs).slice(0, 10);

	// Resolution/HDR breakdowns
	const totalResolved = [...resolutionMap.values()].reduce((s, n) => s + n, 0);
	const resolutionBreakdown: Record<string, number> = {};
	for (const [k, v] of resolutionMap) resolutionBreakdown[k] = totalResolved > 0 ? Math.round((v / totalResolved) * 100) : 0;
	const totalHdr = [...hdrMap.values()].reduce((s, n) => s + n, 0);
	const hdrBreakdown: Record<string, number> = {};
	for (const [k, v] of hdrMap) hdrBreakdown[k] = totalHdr > 0 ? Math.round((v / totalHdr) * 100) : 0;
	const transcodeRate = totalSessions > 0 ? Math.round((transcodeCount / totalSessions) * 100) : 0;
	const subtitleUsage = totalSessions > 0 ? Math.round((subtitleCount / totalSessions) * 100) : 0;

	// Streaks (same logic as before)
	const sortedDays = [...activeDays].sort();
	let longestStreak = 0; let streak = 0; let currentStreak = 0;
	for (let i = 0; i < sortedDays.length; i++) {
		if (i === 0) { streak = 1; } else {
			const prev = new Date(sortedDays[i - 1]);
			const curr = new Date(sortedDays[i]);
			streak = ((curr.getTime() - prev.getTime()) / 86400000) <= 1 ? streak + 1 : 1;
		}
		if (streak > longestStreak) longestStreak = streak;
	}
	if (sortedDays.length > 0) {
		const today = new Date();
		const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
		const yesterday = new Date(today.getTime() - 86400000);
		const yesterdayKey = `${yesterday.getFullYear()}-${pad2(yesterday.getMonth() + 1)}-${pad2(yesterday.getDate())}`;
		const lastDay = sortedDays[sortedDays.length - 1];
		if (lastDay === todayKey || lastDay === yesterdayKey) currentStreak = streak;
	}

	// Interaction stats (unchanged — still from interaction_events)
	const pageViews = (db.prepare(`SELECT COUNT(*) as count FROM interaction_events WHERE user_id = ? AND event_type = 'page_view' AND timestamp >= ? AND timestamp <= ?`).get(userId, from, to) as any)?.count ?? 0;
	const timeInApp = (db.prepare(`SELECT COALESCE(SUM(duration_ms), 0) as total FROM interaction_events WHERE user_id = ? AND event_type = 'page_view' AND timestamp >= ? AND timestamp <= ?`).get(userId, from, to) as any)?.total ?? 0;
	const topPages = db.prepare(`SELECT page, COUNT(*) as views FROM interaction_events WHERE user_id = ? AND event_type = 'page_view' AND timestamp >= ? AND timestamp <= ? GROUP BY page ORDER BY views DESC LIMIT 10`).all(userId, from, to) as { page: string; views: number }[];

	return {
		totalPlayTimeMs, totalItems: itemMap.size, totalSessions, completions,
		avgSessionLengthMs, longestSessionMs, topItems, topGenres,
		resolutionBreakdown, hdrBreakdown, transcodeRate, subtitleUsage,
		topDevices, topClients,
		totalLikes: actionMap.get('like') ?? 0,
		totalRatings: actionMap.get('rate') ?? 0,
		totalFavorites: actionMap.get('watchlist_add') ?? 0,
		hourlyDistribution: hourly, weekdayDistribution: weekday,
		streaks: { current: currentStreak, longest: longestStreak },
		avgCompletionRate,
		totalPageViews: pageViews, totalTimeInAppMs: timeInApp, mostVisitedPages: topPages
	};
}
```

- [ ] **Step 2: Update `buildAndCacheStats()` to use `stats_rollups` table**

Replace the SQL in `buildAndCacheStats()` — change `user_stats_cache` → `stats_rollups`:

```typescript
export function buildAndCacheStats(userId: string, granularity: PeriodGranularity, mediaType = 'all'): ComputedStats {
	const range = currentPeriod(granularity);
	const stats = computeStats(userId, range.from, range.to, mediaType);
	const db = getRawDb();
	const now = Date.now();

	db.prepare(`
		INSERT INTO stats_rollups (user_id, period, media_type, stats, computed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, period, media_type) DO UPDATE SET
			stats = excluded.stats,
			computed_at = excluded.computed_at
	`).run(userId, range.period, mediaType, JSON.stringify(stats), now);

	return stats;
}
```

- [ ] **Step 3: Update `getOrComputeStats()` to use `stats_rollups`**

Same change — replace `user_stats_cache` → `stats_rollups`:

```typescript
export function getOrComputeStats(userId: string, period: string, mediaType = 'all', maxAgeMs = 300_000): ComputedStats {
	const db = getRawDb();
	const cached = db.prepare(`
		SELECT stats, computed_at FROM stats_rollups
		WHERE user_id = ? AND period = ? AND media_type = ?
	`).get(userId, period, mediaType) as { stats: string; computed_at: number } | undefined;

	if (cached && (Date.now() - cached.computed_at) < maxAgeMs) {
		return JSON.parse(cached.stats);
	}

	const { from, to } = parsePeriod(period);
	const stats = computeStats(userId, from, to, mediaType);
	const now = Date.now();

	db.prepare(`
		INSERT INTO stats_rollups (user_id, period, media_type, stats, computed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, period, media_type) DO UPDATE SET
			stats = excluded.stats,
			computed_at = excluded.computed_at
	`).run(userId, period, mediaType, JSON.stringify(stats), now);

	return stats;
}
```

- [ ] **Step 4: Update `getActiveUserIds()` to query `play_sessions`**

```typescript
export function getActiveUserIds(): string[] {
	const db = getRawDb();
	const rows = db.prepare(`SELECT DISTINCT user_id FROM play_sessions`).all() as { user_id: string }[];
	return rows.map((r) => r.user_id);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/stats-engine.ts
git commit -m "feat(tracking): rewrite stats engine to query play_sessions directly"
```

---

### Task 5: Stats Scheduler — Simplify

**Files:**
- Modify: `src/lib/server/stats-scheduler.ts`

- [ ] **Step 1: Simplify scheduler to only rebuild long-range rollups**

Replace the `runScheduledRebuilds()` function:

```typescript
function runScheduledRebuilds() {
	tickCount++;
	const userIds = getActiveUserIds();

	for (const userId of userIds) {
		try {
			// Every 24th tick (2 hours) — rebuild month
			if (tickCount % 24 === 0) {
				buildAndCacheStats(userId, 'month', 'all');
			}
			// Every 72nd tick (6 hours) — rebuild year
			if (tickCount % 72 === 0) {
				buildAndCacheStats(userId, 'year', 'all');
			}
			// Every 144th tick (12 hours) — full rebuild all periods + media types
			if (tickCount % 144 === 0) {
				rebuildStatsForUser(userId);
			}
		} catch (e) {
			console.error(`[stats-scheduler] Error for user ${userId}:`, e);
		}
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/stats-scheduler.ts
git commit -m "feat(tracking): simplify stats scheduler — only long-range rollups"
```

---

### Task 6: Webhook — Write `media_actions`, enrich sessions

**Files:**
- Modify: `src/routes/api/ingest/webhook/[serviceType]/+server.ts`

- [ ] **Step 1: Update imports**

Replace `emitMediaEvent` import with `emitMediaAction`:

```typescript
import {
	emitMediaAction,
	resolveNexusUserId,
	getWebhookHandler,
	registerWebhookHandler,
	heightToResolution,
	channelsToLabel
} from '$lib/server/analytics';
```

- [ ] **Step 2: Update the Jellyfin webhook handler**

Replace the `registerWebhookHandler('jellyfin', ...)` call. The handler now:
- Writes non-playback events to `media_actions` via `emitMediaAction()`
- Ignores playback events (poller is authoritative)
- Enriches open sessions with metadata if a playback webhook matches an open session

```typescript
registerWebhookHandler('jellyfin', async (request) => {
	let body: any;
	try { body = await request.json(); } catch { return { ok: false, error: 'Invalid JSON' }; }

	const notificationType = body.NotificationType ?? body.Event;
	const eventType = JF_EVENT_MAP[notificationType];
	if (!eventType) return { ok: true, skipped: true };

	const jellyfinUserId = body.UserId ?? body.User?.Id;
	const item = body.Item ?? body;
	if (!jellyfinUserId || !item?.Id) return { ok: true, skipped: true };

	const nexusUserId = resolveNexusUserId(jellyfinUserId);
	if (!nexusUserId) return { ok: true, skipped: true };

	const configs = getEnabledConfigs().filter((c) => c.type === 'jellyfin');
	const serviceId = configs[0]?.id ?? 'unknown';

	// Build metadata for enrichment
	const session = body.Session ?? {};
	const mediaStreams = (item.MediaStreams ?? []) as any[];
	const videoStream = mediaStreams.find((s: any) => s.Type === 'Video');
	const audioStream = mediaStreams.find((s: any) => s.Type === 'Audio');
	const subtitleStream = mediaStreams.find((s: any) => s.Type === 'Subtitle');
	const transcodingInfo = session.TranscodingInfo ?? {};

	const metadata: Record<string, unknown> = {};
	if (videoStream) {
		metadata.resolution = heightToResolution(videoStream.Height);
		metadata.videoCodec = videoStream.Codec;
		metadata.hdr = videoStream.VideoRangeType ?? (videoStream.VideoRange === 'HDR' ? 'hdr10' : 'sdr');
	}
	if (audioStream) {
		metadata.audioCodec = audioStream.Codec;
		metadata.audioChannels = channelsToLabel(audioStream.Channels);
		metadata.audioTrackLanguage = audioStream.Language;
	}
	if (subtitleStream) {
		metadata.subtitleLanguage = subtitleStream.Language;
		metadata.subtitleFormat = subtitleStream.Codec;
	}
	if (transcodingInfo.IsTranscoding !== undefined) {
		metadata.isTranscoding = transcodingInfo.IsTranscoding;
		metadata.transcodeReason = transcodingInfo.TranscodeReasons?.join(', ');
		metadata.streamType = transcodingInfo.IsTranscoding ? 'transcode' : 'direct-play';
		metadata.bitrate = transcodingInfo.Bitrate;
	}

	if (body.Rating != null) metadata.ratingValue = body.Rating;
	if (body.IsFavorite != null) metadata.isFavorite = body.IsFavorite;

	// Write non-playback action
	emitMediaAction({
		userId: nexusUserId,
		serviceId,
		serviceType: 'jellyfin',
		actionType: eventType,
		mediaId: item.Id,
		mediaType: JF_TYPE_MAP[item.Type] ?? 'movie',
		mediaTitle: item.Name,
		metadata
	});

	return { ok: true, event: eventType };
});
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/ingest/webhook/\\[serviceType\\]/+server.ts
git commit -m "feat(tracking): webhook writes media_actions instead of media_events"
```

---

## Chunk 3: Callers — Replace emitMediaEvent, update consumers

### Task 7: Replace all remaining `emitMediaEvent()` calls

**Files:**
- Modify: `src/lib/server/ratings.ts`
- Modify: `src/routes/media/[type]/[id]/+page.server.ts`
- Modify: `src/routes/api/stream/[serviceId]/progress/+server.ts`
- Modify: `src/routes/api/video/progress/+server.ts`
- Modify: `src/routes/api/books/[id]/progress/+server.ts`

- [ ] **Step 1: Fix `ratings.ts` — switch to `emitMediaAction`**

In `src/lib/server/ratings.ts`, change the import:

```typescript
import { emitMediaAction } from './analytics';
```

Replace both `emitMediaEvent({...})` calls (in `upsertRating` and `deleteRating`) with:

```typescript
emitMediaAction({
	userId,
	serviceId,
	serviceType: meta.serviceType,
	actionType: 'rate',
	mediaId,
	mediaType: meta.mediaType,
	metadata: { rating }  // or { cleared: true } for delete
});
```

- [ ] **Step 2: Fix media detail page — switch to `emitMediaAction`**

In `src/routes/media/[type]/[id]/+page.server.ts`, change import from `emitMediaEvent` to `emitMediaAction`, and replace the call:

```typescript
emitMediaAction({
	userId: locals.user.id,
	serviceId: ...,
	serviceType: ...,
	actionType: 'detail_view',
	mediaId: ...,
	mediaType: ...,
	mediaTitle: ...
});
```

- [ ] **Step 3: Fix stream progress endpoint — remove event emission**

In `src/routes/api/stream/[serviceId]/progress/+server.ts`:
- Remove the `emitMediaEvent` import
- Remove the `emitMediaEvent({...})` call (the poller handles video session tracking now)
- Keep the `activity` table update for UI progress bars

- [ ] **Step 4: Fix video progress endpoint — remove event emission**

In `src/routes/api/video/progress/+server.ts`:
- Remove the `emitMediaEvent` import
- Remove the `emitMediaEvent({...})` call

- [ ] **Step 5: Fix book progress endpoint — create/update play_sessions**

In `src/routes/api/books/[id]/progress/+server.ts`:
- Remove `emitMediaEvent` import, add `findOpenSession` from analytics
- Replace the `emitMediaEvent()` call with session creation/update logic:

```typescript
import { findOpenSession } from '$lib/server/analytics';
import { getRawDb } from '$lib/db';
import { randomBytes } from 'crypto';

// Inside the handler, replace emitMediaEvent call:
const TWO_HOURS = 2 * 60 * 60 * 1000;
const db = getRawDb();
const now = Date.now();
const open = findOpenSession(userId, bookId, serviceId);

if (open && (now - open.updated_at) < TWO_HOURS) {
	// Update existing session
	const elapsed = Math.min(now - open.updated_at, TWO_HOURS);
	db.prepare(
		`UPDATE play_sessions SET duration_ms = duration_ms + ?, progress = ?, updated_at = ? WHERE id = ?`
	).run(elapsed, progress, now, open.id);
} else {
	// Close old session if exists
	if (open) {
		db.prepare(`UPDATE play_sessions SET ended_at = ?, updated_at = ? WHERE id = ?`).run(now, now, open.id);
	}
	// Open new session
	const id = randomBytes(12).toString('hex');
	db.prepare(`
		INSERT INTO play_sessions (id, user_id, service_id, service_type, media_id, media_type, media_title, started_at, duration_ms, progress, source, created_at, updated_at)
		VALUES (?, ?, ?, 'calibre', ?, 'book', ?, ?, 0, ?, 'progress-api', ?, ?)
	`).run(id, userId, serviceId, bookId, bookTitle ?? null, now, progress, now, now);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/ratings.ts src/routes/media/\\[type\\]/\\[id\\]/+page.server.ts src/routes/api/stream/\\[serviceId\\]/progress/+server.ts src/routes/api/video/progress/+server.ts src/routes/api/books/\\[id\\]/progress/+server.ts
git commit -m "feat(tracking): replace all emitMediaEvent calls with emitMediaAction or session writes"
```

---

### Task 8: Recommendation Engine — Rewrite SQL

**Files:**
- Modify: `src/lib/server/recommendations/providers/content-based.ts`
- Modify: `src/lib/server/recommendations/providers/social.ts`
- Modify: `src/lib/server/recommendations/providers/collaborative.ts`
- Modify: `src/lib/server/recommendations/providers/trending.ts`
- Modify: `src/lib/server/recommendations/providers/time-aware.ts`
- Modify: `src/lib/server/rec-scheduler.ts`
- Modify: `src/lib/server/music.ts`

This is a mechanical SQL rewrite across all files. The column mapping:

| Old (`media_events`) | New (`play_sessions`) |
|---|---|
| `event_type = 'play_stop'` | (no filter — every row is a session) |
| `event_type IN ('play_start', 'play_stop', 'complete', 'like', ...)` | Sessions: no filter. Actions: query `media_actions` for like/complete/watchlist |
| `play_duration_ms` | `duration_ms` |
| `duration_ticks` | `media_duration_ms` (already ms) |
| `timestamp` | `started_at` |
| `ingested_at` | `created_at` |

- [ ] **Step 1: Update each recommendation provider**

For each of the 5 provider files, find-and-replace:
- `media_events` → `play_sessions`
- `play_duration_ms` → `duration_ms`
- `duration_ticks` → `media_duration_ms`
- `timestamp` (in WHERE clauses for time filtering) → `started_at`
- Remove `event_type = 'play_stop'` and `event_type IN (...)` filters (all play_sessions rows are valid)
- For social signal queries (like, watchlist_add, complete as action), switch to querying `media_actions` table with `action_type = '...'`

- [ ] **Step 2: Update `rec-scheduler.ts`**

Replace `SELECT DISTINCT user_id FROM media_events WHERE timestamp > ?` with:
```sql
SELECT DISTINCT user_id FROM play_sessions WHERE started_at > ?
```

- [ ] **Step 3: Update `music.ts` `getRecentlyPlayed()`**

Replace the `media_events` query with:
```sql
SELECT DISTINCT media_id, media_title, started_at
FROM play_sessions
WHERE user_id = ? AND media_type = 'music'
ORDER BY started_at DESC
LIMIT ?
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/recommendations/providers/*.ts src/lib/server/rec-scheduler.ts src/lib/server/music.ts
git commit -m "feat(tracking): rewrite recommendation engine + music to query play_sessions"
```

---

### Task 9: API Consumers — Rewrite stats/history/admin/search endpoints

**Files:**
- Modify: `src/routes/api/user/play-history/+server.ts`
- Modify: `src/routes/api/admin/stats/timeline/+server.ts`
- Modify: `src/routes/api/admin/stats/users/+server.ts`
- Modify: `src/routes/api/admin/content/+server.ts`
- Modify: `src/routes/api/admin/system/+server.ts`
- Modify: `src/routes/admin/+page.server.ts`
- Modify: `src/routes/api/search/suggestions/+server.ts`
- Modify: `src/lib/components/admin/AdminSystem.svelte`

- [ ] **Step 1: Update play-history endpoint**

In `src/routes/api/user/play-history/+server.ts`, replace `media_events WHERE event_type='play_stop'` with:

```sql
SELECT id, media_id, media_title, media_type, duration_ms, media_duration_ms,
       device_name, client_name, started_at, ended_at, progress, completed
FROM play_sessions
WHERE user_id = ? AND ended_at IS NOT NULL
ORDER BY started_at DESC
LIMIT ? OFFSET ?
```

- [ ] **Step 2: Update admin stats timeline**

In `src/routes/api/admin/stats/timeline/+server.ts`, replace `media_events` query with:

```sql
SELECT date(started_at / 1000, 'unixepoch') as day,
       COALESCE(SUM(duration_ms), 0) as total_ms,
       COUNT(*) as sessions
FROM play_sessions
WHERE started_at >= ? AND started_at < ?
GROUP BY day ORDER BY day
```

- [ ] **Step 3: Update admin user stats**

In `src/routes/api/admin/stats/users/+server.ts`, replace `media_events` query:

```sql
SELECT user_id, COALESCE(SUM(duration_ms), 0) as total_ms, COUNT(*) as sessions
FROM play_sessions
WHERE started_at >= ? AND started_at < ?
GROUP BY user_id ORDER BY total_ms DESC
```

- [ ] **Step 4: Update admin content stats**

In `src/routes/api/admin/content/+server.ts`, replace `media_events` query:

```sql
SELECT media_type, COALESCE(SUM(duration_ms), 0) as total_ms, COUNT(*) as sessions
FROM play_sessions
WHERE started_at >= ? AND started_at < ?
GROUP BY media_type
```

- [ ] **Step 5: Update admin system page**

In `src/routes/api/admin/system/+server.ts` and `src/routes/admin/+page.server.ts`: replace references to `media_events` table name with `play_sessions`, and `user_stats_cache` with `stats_rollups`.

- [ ] **Step 6: Update search suggestions**

In `src/routes/api/search/suggestions/+server.ts`, replace `schema.mediaEvents` Drizzle query or raw SQL with:

```sql
SELECT DISTINCT media_title, media_type, media_id
FROM play_sessions
WHERE user_id = ? AND media_title LIKE ?
ORDER BY started_at DESC
LIMIT 5
```

- [ ] **Step 7: Update AdminSystem.svelte**

In `src/lib/components/admin/AdminSystem.svelte`, replace any references to `user_stats_cache` with `stats_rollups`.

- [ ] **Step 8: Verify full app runs without errors**

Run: `cd /Users/parker/Developer/Nexus && pnpm dev`
Navigate to: homepage, activity page, admin page, media detail page.
Expected: No 500 errors. Stats show 0 (clean slate). Poller creates sessions when media plays.

- [ ] **Step 9: Commit**

```bash
git add src/routes/api/user/play-history/+server.ts src/routes/api/admin/stats/timeline/+server.ts src/routes/api/admin/stats/users/+server.ts src/routes/api/admin/content/+server.ts src/routes/api/admin/system/+server.ts src/routes/admin/+page.server.ts src/routes/api/search/suggestions/+server.ts src/lib/components/admin/AdminSystem.svelte
git commit -m "feat(tracking): rewrite all API consumers to query play_sessions"
```

---

## Chunk 4: Verification

### Task 10: End-to-End Verification

- [ ] **Step 1: Delete the database to start fresh**

```bash
rm /Users/parker/Developer/Nexus/nexus.db
cd /Users/parker/Developer/Nexus && pnpm dev
```

Expected: App recreates the database with new schema. No `media_events` or `user_stats_cache` tables.

- [ ] **Step 2: Verify tables exist**

```bash
cd /Users/parker/Developer/Nexus && node -e "
const Database = require('better-sqlite3');
const db = new Database('./nexus.db');
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all();
console.log(tables.map(t => t.name).join('\n'));
const hasOld = tables.some(t => t.name === 'media_events' || t.name === 'user_stats_cache');
console.log(hasOld ? 'FAIL: old tables still exist' : 'PASS: old tables removed');
const hasNew = tables.some(t => t.name === 'play_sessions') && tables.some(t => t.name === 'media_actions') && tables.some(t => t.name === 'stats_rollups');
console.log(hasNew ? 'PASS: new tables exist' : 'FAIL: new tables missing');
"
```

- [ ] **Step 3: Verify no remaining references to old code**

```bash
cd /Users/parker/Developer/Nexus && grep -r "emitMediaEvent\|media_events\|MediaEventInput\|queryMediaEvents\|countMediaEvents\|user_stats_cache" src/ --include="*.ts" --include="*.svelte" -l
```

Expected: No files returned (all references should be updated). If any remain, fix them.

- [ ] **Step 4: Play something in Jellyfin and verify session creation**

1. Start playing a movie/episode in Jellyfin
2. Wait 20-30 seconds
3. Check the database:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('./nexus.db');
const sessions = db.prepare('SELECT id, media_title, duration_ms, ended_at, source FROM play_sessions').all();
console.log('Sessions:', JSON.stringify(sessions, null, 2));
"
```

Expected: One session with `source = 'poller'`, `ended_at = null`, `duration_ms` increasing.

4. Stop playing
5. Wait 10-20 seconds
6. Check again — session should now have `ended_at` set and `duration_ms` capped at media runtime.

- [ ] **Step 5: Verify activity page loads**

Navigate to `/activity` in the browser.
Expected: Page loads with empty/zero stats (clean slate). No 500 errors.

- [ ] **Step 6: Commit any final fixes**

```bash
git add -A
git commit -m "fix(tracking): final fixes from end-to-end verification"
```

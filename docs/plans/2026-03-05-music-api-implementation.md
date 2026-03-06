# Music API Layer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a complete music API layer: Jellyfin music browsing (albums, tracks, artists), Lidarr enrichment, Nexus DB-backed playlists/liked tracks, and recently-played queries.

**Architecture:** Extend `jellyfin.ts` with 5 new exported functions for music-specific Jellyfin queries. Extend `lidarr.ts` with 4 new functions for enrichment. Add `src/lib/server/music.ts` as the orchestration layer (combines Jellyfin data + Lidarr enrichment + DB queries). Add DB tables for liked tracks and playlists. Expose everything via `/api/music/*` endpoints.

**Tech Stack:** SvelteKit API routes, Drizzle ORM (SQLite), Jellyfin REST API, Lidarr v1 API, in-process cache.

---

## Task 1: DB Schema — music_liked_tracks, music_playlists, music_playlist_tracks

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/index.ts`

**Step 1: Add tables to schema.ts**

Add before the `// ── App Settings` section in `schema.ts`:

```typescript
// ── Music ────────────────────────────────────────────────────────────

export const musicLikedTracks = sqliteTable('music_liked_tracks', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	trackId: text('track_id').notNull(),
	serviceId: text('service_id').notNull(),
	createdAt: integer('created_at').notNull()
});

export const musicPlaylists = sqliteTable('music_playlists', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	name: text('name').notNull(),
	description: text('description'),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export const musicPlaylistTracks = sqliteTable('music_playlist_tracks', {
	id: text('id').primaryKey(),
	playlistId: text('playlist_id').notNull(),
	trackId: text('track_id').notNull(),
	serviceId: text('service_id').notNull(),
	position: integer('position').notNull().default(0),
	addedAt: integer('added_at').notNull()
});

export type MusicLikedTrack = typeof musicLikedTracks.$inferSelect;
export type MusicPlaylist = typeof musicPlaylists.$inferSelect;
export type MusicPlaylistTrack = typeof musicPlaylistTracks.$inferSelect;
```

**Step 2: Add CREATE TABLE + indexes to index.ts**

Add before the `// ── App settings` section in `initDb()`:

```typescript
// ── Music tables ────────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS music_liked_tracks (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	track_id TEXT NOT NULL,
	service_id TEXT NOT NULL,
	created_at INTEGER NOT NULL
)`);
db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_music_liked_unique ON music_liked_tracks(user_id, track_id, service_id)`);

db.run(`CREATE TABLE IF NOT EXISTS music_playlists (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	name TEXT NOT NULL,
	description TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_music_playlists_user ON music_playlists(user_id)`);

db.run(`CREATE TABLE IF NOT EXISTS music_playlist_tracks (
	id TEXT PRIMARY KEY,
	playlist_id TEXT NOT NULL,
	track_id TEXT NOT NULL,
	service_id TEXT NOT NULL,
	position INTEGER NOT NULL DEFAULT 0,
	added_at INTEGER NOT NULL
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_music_playlist_tracks_playlist ON music_playlist_tracks(playlist_id, position)`);
```

**Step 3: Verify build**

Run: `pnpm build 2>&1 | tail -5`
Expected: `✔ done`

**Step 4: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/index.ts
git commit -m "feat(music): add DB tables for liked tracks and playlists"
```

---

## Task 2: Jellyfin Adapter — music normalization enhancement

**Files:**
- Modify: `src/lib/adapters/jellyfin.ts` (the `normalize()` function, ~line 151-236)

**Step 1: Enhance normalize() metadata for music items**

In the `normalize()` function, add music-specific metadata fields to the `metadata` object (after the existing `endDate` field, before the closing `}`):

```typescript
// Music-specific fields
artist: item.AlbumArtist ?? item.Artists?.[0] ?? item.ArtistItems?.[0]?.Name,
artistId: item.ArtistItems?.[0]?.Id,
albumId: item.AlbumId,
albumName: item.Album,
trackNumber: item.IndexNumber,
discNumber: item.ParentIndexNumber,
artistImageUrl: item.ArtistItems?.[0]?.Id
	? `${config.url}/Items/${item.ArtistItems[0].Id}/Images/Primary?quality=90&maxWidth=300`
	: undefined,
```

Note: `trackNumber` and `discNumber` overlap with `episodeNumber`/`seasonNumber` for episodes — that's fine, the episode-specific ones use `item.Type === 'Episode'` gating. For Audio items, `IndexNumber` IS the track number and `ParentIndexNumber` IS the disc number.

**Step 2: Update FIELDS constant to request AlbumArtist data**

At line 117, update FIELDS to include music fields:

```typescript
const FIELDS = 'Overview,Genres,Studios,BackdropImageTags,ImageTags,UserData,ParentId,SeriesId,SeriesName,ParentIndexNumber,IndexNumber,AlbumArtist,Artists,ArtistItems,Album,AlbumId';
```

**Step 3: Verify build**

Run: `pnpm build 2>&1 | tail -5`

**Step 4: Commit**

```bash
git add src/lib/adapters/jellyfin.ts
git commit -m "feat(music): enhance Jellyfin normalize with artist/album/track metadata"
```

---

## Task 3: Jellyfin Adapter — music query functions

**Files:**
- Modify: `src/lib/adapters/jellyfin.ts` (add new exported functions after `getSeasons()`, before `jellyfinAdapter`)

**Step 1: Add getAlbums, getAlbumTracks, getArtists, getArtistAlbums, getInstantMix**

Insert after the `getSeasons()` function (before `export const jellyfinAdapter`):

```typescript
// ---------------------------------------------------------------------------
// Music helpers (exported for use by music API)
// ---------------------------------------------------------------------------

export interface MusicAlbum extends UnifiedMedia {
	metadata: UnifiedMedia['metadata'] & {
		artist?: string;
		artistId?: string;
		trackCount?: number;
	};
}

export async function getAlbums(
	config: ServiceConfig,
	userCred?: UserCredential,
	opts?: { genre?: string; artistId?: string; sort?: string; limit?: number; offset?: number }
): Promise<{ items: UnifiedMedia[]; total: number }> {
	try {
		const userId = await getUserId(config, userCred);
		const params: Record<string, string> = {
			IncludeItemTypes: 'MusicAlbum',
			Recursive: 'true',
			SortBy: opts?.sort === 'year' ? 'ProductionYear' : opts?.sort === 'rating' ? 'CommunityRating' : opts?.sort === 'added' ? 'DateCreated' : 'SortName',
			SortOrder: opts?.sort === 'year' || opts?.sort === 'added' ? 'Descending' : 'Ascending',
			Limit: String(opts?.limit ?? 50),
			StartIndex: String(opts?.offset ?? 0),
			Fields: FIELDS,
			EnableUserData: 'true',
			EnableImages: 'true'
		};
		if (opts?.genre) params.Genres = opts.genre;
		if (opts?.artistId) params.ArtistIds = opts.artistId;

		const data = await jfFetchUser(config, `/Users/${userId}/Items`, params, userCred);
		return {
			items: (data.Items ?? []).map((i: unknown) => normalize(config, i)),
			total: data.TotalRecordCount ?? 0
		};
	} catch {
		return { items: [], total: 0 };
	}
}

export async function getAlbumTracks(
	config: ServiceConfig,
	albumId: string,
	userCred?: UserCredential
): Promise<UnifiedMedia[]> {
	try {
		const userId = await getUserId(config, userCred);
		const data = await jfFetchUser(config, `/Users/${userId}/Items`, {
			ParentId: albumId,
			IncludeItemTypes: 'Audio',
			SortBy: 'ParentIndexNumber,IndexNumber',
			SortOrder: 'Ascending',
			Fields: FIELDS,
			EnableUserData: 'true'
		}, userCred);
		return (data.Items ?? []).map((i: unknown) => normalize(config, i));
	} catch {
		return [];
	}
}

export async function getArtists(
	config: ServiceConfig,
	userCred?: UserCredential,
	opts?: { sort?: string; limit?: number; offset?: number }
): Promise<{ items: Array<{ id: string; name: string; sortName?: string; albumCount: number; imageUrl?: string; genres?: string[]; overview?: string }>; total: number }> {
	try {
		const userId = await getUserId(config, userCred);
		const data = await jfFetchUser(config, '/Artists', {
			userId,
			SortBy: opts?.sort === 'album-count' ? 'AlbumCount' : 'SortName',
			SortOrder: opts?.sort === 'album-count' ? 'Descending' : 'Ascending',
			Limit: String(opts?.limit ?? 50),
			StartIndex: String(opts?.offset ?? 0),
			Fields: 'Overview,Genres,ImageTags',
			EnableImages: 'true'
		}, userCred);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const items = (data.Items ?? []).map((a: any) => ({
			id: a.Id,
			name: a.Name ?? 'Unknown Artist',
			sortName: a.SortName,
			albumCount: a.AlbumCount ?? a.ChildCount ?? 0,
			imageUrl: a.ImageTags?.Primary ? `${config.url}/Items/${a.Id}/Images/Primary?quality=90&maxWidth=300` : undefined,
			backdrop: (a.BackdropImageTags?.length ?? 0) > 0 ? `${config.url}/Items/${a.Id}/Images/Backdrop/0?quality=90&maxWidth=1920` : undefined,
			genres: a.Genres ?? [],
			overview: a.Overview
		}));
		return { items, total: data.TotalRecordCount ?? 0 };
	} catch {
		return { items: [], total: 0 };
	}
}

export async function getArtistAlbums(
	config: ServiceConfig,
	artistId: string,
	userCred?: UserCredential
): Promise<UnifiedMedia[]> {
	try {
		const userId = await getUserId(config, userCred);
		const data = await jfFetchUser(config, `/Users/${userId}/Items`, {
			ArtistIds: artistId,
			IncludeItemTypes: 'MusicAlbum',
			Recursive: 'true',
			SortBy: 'ProductionYear',
			SortOrder: 'Descending',
			Fields: FIELDS,
			EnableUserData: 'true',
			EnableImages: 'true'
		}, userCred);
		return (data.Items ?? []).map((i: unknown) => normalize(config, i));
	} catch {
		return [];
	}
}

export async function getInstantMix(
	config: ServiceConfig,
	itemId: string,
	userCred?: UserCredential,
	limit = 20
): Promise<UnifiedMedia[]> {
	try {
		const userId = await getUserId(config, userCred);
		const data = await jfFetchUser(config, `/Items/${itemId}/InstantMix`, {
			userId,
			Limit: String(limit),
			Fields: FIELDS,
			EnableUserData: 'true'
		}, userCred);
		return (data.Items ?? []).map((i: unknown) => normalize(config, i));
	} catch {
		return [];
	}
}
```

**Step 2: Verify build**

Run: `pnpm build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add src/lib/adapters/jellyfin.ts
git commit -m "feat(music): add Jellyfin music query functions (albums, tracks, artists, instant mix)"
```

---

## Task 4: Lidarr Adapter — enrichment functions

**Files:**
- Modify: `src/lib/adapters/lidarr.ts`

**Step 1: Add enrichment functions after existing adapter**

Add before the `export const lidarrAdapter` block:

```typescript
// ---------------------------------------------------------------------------
// Enrichment helpers (admin API key, no per-user auth)
// ---------------------------------------------------------------------------

export async function getLidarrArtists(config: ServiceConfig): Promise<Array<{
	id: number;
	name: string;
	foreignArtistId: string;
	overview?: string;
	monitored: boolean;
	albumCount: number;
	imageUrl?: string;
}>> {
	try {
		const data = await lidarrFetch(config, '/artist');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (data ?? []).map((a: any) => ({
			id: a.id,
			name: a.artistName,
			foreignArtistId: a.foreignArtistId,
			overview: a.overview,
			monitored: a.monitored ?? false,
			albumCount: a.statistics?.albumCount ?? 0,
			imageUrl: a.images?.find((i: { coverType: string }) => i.coverType === 'poster')?.remoteUrl
		}));
	} catch {
		return [];
	}
}

export async function getLidarrArtist(config: ServiceConfig, artistId: number) {
	try {
		return await lidarrFetch(config, `/artist/${artistId}`);
	} catch {
		return null;
	}
}

export async function getLidarrAlbums(config: ServiceConfig, artistId?: number): Promise<Array<{
	id: number;
	title: string;
	artistName: string;
	foreignAlbumId: string;
	monitored: boolean;
	percentAvailable: number;
	trackCount: number;
	missingTracks: number;
	releaseDate?: string;
}>> {
	try {
		const path = artistId ? `/album?artistId=${artistId}` : '/album';
		const data = await lidarrFetch(config, path);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (data ?? []).map((a: any) => ({
			id: a.id,
			title: a.title,
			artistName: a.artist?.artistName ?? '',
			foreignAlbumId: a.foreignAlbumId,
			monitored: a.monitored ?? false,
			percentAvailable: a.statistics?.percentOfTracks ?? 0,
			trackCount: a.statistics?.totalTrackCount ?? 0,
			missingTracks: (a.statistics?.totalTrackCount ?? 0) - (a.statistics?.trackFileCount ?? 0),
			releaseDate: a.releaseDate
		}));
	} catch {
		return [];
	}
}

export async function getLidarrWanted(config: ServiceConfig, opts?: { limit?: number; offset?: number }): Promise<{
	items: Array<{ albumTitle: string; artistName: string; monitored: boolean; releaseDate?: string }>;
	total: number;
}> {
	try {
		const data = await lidarrFetch(config, `/wanted/missing?page=1&pageSize=${opts?.limit ?? 20}&sortKey=releaseDate&sortDirection=descending`);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const items = (data.records ?? []).map((r: any) => ({
			albumTitle: r.title,
			artistName: r.artist?.artistName ?? '',
			monitored: r.monitored ?? false,
			releaseDate: r.releaseDate
		}));
		return { items, total: data.totalRecords ?? 0 };
	} catch {
		return { items: [], total: 0 };
	}
}

export async function getLidarrQueue(config: ServiceConfig): Promise<Array<{
	albumTitle: string;
	artistName: string;
	status: string;
	progress: number;
}>> {
	try {
		const data = await lidarrFetch(config, '/queue');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (data.records ?? []).map((r: any) => ({
			albumTitle: r.album?.title ?? r.title ?? '',
			artistName: r.artist?.artistName ?? '',
			status: r.status ?? 'unknown',
			progress: r.sizeleft && r.size ? Math.round(((r.size - r.sizeleft) / r.size) * 100) : 0
		}));
	} catch {
		return [];
	}
}
```

**Step 2: Verify build**

Run: `pnpm build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add src/lib/adapters/lidarr.ts
git commit -m "feat(music): add Lidarr enrichment functions (artists, albums, wanted, queue)"
```

---

## Task 5: Music service layer — src/lib/server/music.ts

**Files:**
- Create: `src/lib/server/music.ts`

This is the orchestration layer that combines Jellyfin + Lidarr + Nexus DB.

**Step 1: Create music.ts**

```typescript
import { randomBytes } from 'crypto';
import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { getAlbums, getAlbumTracks, getArtists, getArtistAlbums, getInstantMix } from '../adapters/jellyfin';
import { getLidarrAlbums, getLidarrArtists, getLidarrWanted, getLidarrQueue } from '../adapters/lidarr';
import type { ServiceConfig, UserCredential, UnifiedMedia } from '../adapters/types';
import { getEnabledConfigs } from './services';
import { getUserCredentialForService } from './auth';
import { withCache } from './cache';

function genId(): string {
	return randomBytes(16).toString('hex');
}
function now(): number {
	return Date.now();
}

// ---------------------------------------------------------------------------
// Service resolution helpers
// ---------------------------------------------------------------------------

export function getJellyfinMusicConfigs(): ServiceConfig[] {
	return getEnabledConfigs().filter((c) => c.type === 'jellyfin');
}

export function getLidarrConfig(): ServiceConfig | undefined {
	return getEnabledConfigs().find((c) => c.type === 'lidarr');
}

function resolveJellyfinCred(config: ServiceConfig, userId?: string): UserCredential | undefined {
	if (!userId) return undefined;
	return getUserCredentialForService(userId, config.id) ?? undefined;
}

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

export async function getMusicAlbums(userId: string, opts?: {
	genre?: string; artistId?: string; sort?: string; limit?: number; offset?: number; serviceId?: string;
}) {
	const configs = opts?.serviceId
		? getJellyfinMusicConfigs().filter((c) => c.id === opts.serviceId)
		: getJellyfinMusicConfigs();

	if (configs.length === 0) return { items: [], total: 0 };

	const results = await Promise.allSettled(
		configs.map((config) => {
			const cred = resolveJellyfinCred(config, userId);
			return getAlbums(config, cred, opts);
		})
	);

	const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.items : []));
	const total = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.total : 0), 0);

	// Enrich with Lidarr data if available
	const enriched = await enrichAlbumsWithLidarr(items);

	return { items: enriched, total };
}

export async function getMusicAlbumDetail(userId: string, albumId: string, serviceId: string) {
	const config = getJellyfinMusicConfigs().find((c) => c.id === serviceId);
	if (!config) return null;

	const cred = resolveJellyfinCred(config, userId);
	const tracks = await getAlbumTracks(config, albumId, cred);

	// Also get the album item itself for metadata
	const { items } = await getAlbums(config, cred, { limit: 1 });
	// Search for this specific album by fetching it
	const { jfFetchUser } = await import('../adapters/jellyfin');
	// Actually, we can use getItem from the adapter
	const { registry } = await import('../adapters/registry');
	const adapter = registry.get('jellyfin');
	const albumItem = adapter?.getItem ? await adapter.getItem(config, albumId, cred) : null;

	return { album: albumItem, tracks };
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

export async function getMusicArtists(userId: string, opts?: {
	sort?: string; limit?: number; offset?: number; serviceId?: string;
}) {
	const configs = opts?.serviceId
		? getJellyfinMusicConfigs().filter((c) => c.id === opts.serviceId)
		: getJellyfinMusicConfigs();

	if (configs.length === 0) return { items: [], total: 0 };

	const results = await Promise.allSettled(
		configs.map((config) => {
			const cred = resolveJellyfinCred(config, userId);
			return getArtists(config, cred, opts);
		})
	);

	const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.items : []));
	const total = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.total : 0), 0);

	return { items, total };
}

export async function getMusicArtistDetail(userId: string, artistId: string, serviceId: string) {
	const config = getJellyfinMusicConfigs().find((c) => c.id === serviceId);
	if (!config) return null;

	const cred = resolveJellyfinCred(config, userId);
	const [artistResult, albums] = await Promise.all([
		getArtists(config, cred, { limit: 1 }),
		getArtistAlbums(config, artistId, cred)
	]);

	// Get artist info from Jellyfin
	const { jfFetchUser: jfFetch2 } = await import('../adapters/jellyfin');
	let artistInfo = null;
	try {
		const userId2 = cred?.externalUserId;
		if (userId2) {
			// Fetch artist item directly
			const data = await (await import('../adapters/jellyfin')).default;
		}
	} catch { /* ignore */ }

	// Try Lidarr for richer artist data
	const lidarrConfig = getLidarrConfig();
	let lidarrArtist = null;
	if (lidarrConfig) {
		const lidarrArtists = await withCache(`lidarr:artists`, 120_000, () => getLidarrArtists(lidarrConfig));
		// Name-match (case-insensitive)
		const firstAlbum = albums[0];
		const artistName = (firstAlbum?.metadata?.artist as string) ?? '';
		lidarrArtist = lidarrArtists.find((a) => a.name.toLowerCase() === artistName.toLowerCase()) ?? null;
	}

	return { albums, lidarr: lidarrArtist };
}

// ---------------------------------------------------------------------------
// Instant Mix (recommendations)
// ---------------------------------------------------------------------------

export async function getMusicInstantMix(userId: string, itemId: string, serviceId: string) {
	const config = getJellyfinMusicConfigs().find((c) => c.id === serviceId);
	if (!config) return [];

	const cred = resolveJellyfinCred(config, userId);
	return getInstantMix(config, itemId, cred);
}

// ---------------------------------------------------------------------------
// Lidarr Enrichment
// ---------------------------------------------------------------------------

async function enrichAlbumsWithLidarr(albums: UnifiedMedia[]): Promise<UnifiedMedia[]> {
	const lidarrConfig = getLidarrConfig();
	if (!lidarrConfig || albums.length === 0) return albums;

	try {
		const lidarrAlbums = await withCache('lidarr:all-albums', 120_000, () => getLidarrAlbums(lidarrConfig));

		// Build a name-based lookup (title + artist, lowercased)
		const lidarrMap = new Map<string, (typeof lidarrAlbums)[0]>();
		for (const la of lidarrAlbums) {
			lidarrMap.set(`${la.title.toLowerCase()}::${la.artistName.toLowerCase()}`, la);
		}

		return albums.map((album) => {
			const artist = ((album.metadata?.artist as string) ?? '').toLowerCase();
			const key = `${album.title.toLowerCase()}::${artist}`;
			const match = lidarrMap.get(key);
			if (!match) return album;

			return {
				...album,
				metadata: {
					...album.metadata,
					lidarr: {
						monitored: match.monitored,
						percentAvailable: match.percentAvailable,
						missing: match.missingTracks
					}
				}
			};
		});
	} catch {
		return albums;
	}
}

export async function getMusicWanted(userId: string) {
	const lidarrConfig = getLidarrConfig();
	if (!lidarrConfig) return { items: [], total: 0 };
	return withCache('lidarr:wanted', 60_000, () => getLidarrWanted(lidarrConfig));
}

export async function getMusicQueue() {
	const lidarrConfig = getLidarrConfig();
	if (!lidarrConfig) return [];
	return withCache('lidarr:queue', 30_000, () => getLidarrQueue(lidarrConfig));
}

// ---------------------------------------------------------------------------
// Liked Tracks (Nexus DB)
// ---------------------------------------------------------------------------

export function getLikedTracks(userId: string) {
	const db = getDb();
	return db
		.select()
		.from(schema.musicLikedTracks)
		.where(eq(schema.musicLikedTracks.userId, userId))
		.orderBy(desc(schema.musicLikedTracks.createdAt))
		.all();
}

export function isTrackLiked(userId: string, trackId: string, serviceId: string): boolean {
	const db = getDb();
	return !!db
		.select()
		.from(schema.musicLikedTracks)
		.where(and(
			eq(schema.musicLikedTracks.userId, userId),
			eq(schema.musicLikedTracks.trackId, trackId),
			eq(schema.musicLikedTracks.serviceId, serviceId)
		))
		.get();
}

export function likeTrack(userId: string, trackId: string, serviceId: string): string {
	const db = getDb();
	const existing = db
		.select()
		.from(schema.musicLikedTracks)
		.where(and(
			eq(schema.musicLikedTracks.userId, userId),
			eq(schema.musicLikedTracks.trackId, trackId),
			eq(schema.musicLikedTracks.serviceId, serviceId)
		))
		.get();
	if (existing) return existing.id;

	const id = genId();
	db.insert(schema.musicLikedTracks).values({
		id, userId, trackId, serviceId, createdAt: now()
	}).run();
	return id;
}

export function unlikeTrack(userId: string, trackId: string, serviceId: string): boolean {
	const db = getDb();
	const result = db
		.delete(schema.musicLikedTracks)
		.where(and(
			eq(schema.musicLikedTracks.userId, userId),
			eq(schema.musicLikedTracks.trackId, trackId),
			eq(schema.musicLikedTracks.serviceId, serviceId)
		))
		.run();
	return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Playlists (Nexus DB)
// ---------------------------------------------------------------------------

export function getUserPlaylists(userId: string) {
	const db = getDb();
	const playlists = db
		.select()
		.from(schema.musicPlaylists)
		.where(eq(schema.musicPlaylists.userId, userId))
		.orderBy(desc(schema.musicPlaylists.updatedAt))
		.all();

	return playlists.map((p) => {
		const trackCount = db.get<{ n: number }>(
			sql`SELECT COUNT(*) as n FROM music_playlist_tracks WHERE playlist_id = ${p.id}`
		);
		return { ...p, trackCount: trackCount?.n ?? 0 };
	});
}

export function createPlaylist(userId: string, name: string, description?: string): string {
	const db = getDb();
	const id = genId();
	const ts = now();
	db.insert(schema.musicPlaylists).values({
		id, userId, name, description: description ?? null, createdAt: ts, updatedAt: ts
	}).run();
	return id;
}

export function getPlaylist(playlistId: string, userId: string) {
	const db = getDb();
	const playlist = db.select().from(schema.musicPlaylists)
		.where(and(eq(schema.musicPlaylists.id, playlistId), eq(schema.musicPlaylists.userId, userId)))
		.get();
	if (!playlist) return null;

	const tracks = db.select().from(schema.musicPlaylistTracks)
		.where(eq(schema.musicPlaylistTracks.playlistId, playlistId))
		.orderBy(schema.musicPlaylistTracks.position)
		.all();

	return { ...playlist, tracks };
}

export function updatePlaylist(playlistId: string, userId: string, updates: { name?: string; description?: string }): boolean {
	const db = getDb();
	const playlist = db.select().from(schema.musicPlaylists)
		.where(and(eq(schema.musicPlaylists.id, playlistId), eq(schema.musicPlaylists.userId, userId)))
		.get();
	if (!playlist) return false;

	const data: Record<string, unknown> = { updatedAt: now() };
	if (updates.name !== undefined) data.name = updates.name;
	if (updates.description !== undefined) data.description = updates.description;

	db.update(schema.musicPlaylists).set(data).where(eq(schema.musicPlaylists.id, playlistId)).run();
	return true;
}

export function deletePlaylist(playlistId: string, userId: string): boolean {
	const db = getDb();
	const playlist = db.select().from(schema.musicPlaylists)
		.where(and(eq(schema.musicPlaylists.id, playlistId), eq(schema.musicPlaylists.userId, userId)))
		.get();
	if (!playlist) return false;

	db.delete(schema.musicPlaylistTracks).where(eq(schema.musicPlaylistTracks.playlistId, playlistId)).run();
	db.delete(schema.musicPlaylists).where(eq(schema.musicPlaylists.id, playlistId)).run();
	return true;
}

export function addTrackToPlaylist(playlistId: string, userId: string, trackId: string, serviceId: string): string | null {
	const db = getDb();
	const playlist = db.select().from(schema.musicPlaylists)
		.where(and(eq(schema.musicPlaylists.id, playlistId), eq(schema.musicPlaylists.userId, userId)))
		.get();
	if (!playlist) return null;

	const maxPos = db.get<{ m: number }>(
		sql`SELECT COALESCE(MAX(position), -1) as m FROM music_playlist_tracks WHERE playlist_id = ${playlistId}`
	);

	const id = genId();
	db.insert(schema.musicPlaylistTracks).values({
		id, playlistId, trackId, serviceId, position: (maxPos?.m ?? -1) + 1, addedAt: now()
	}).run();

	db.update(schema.musicPlaylists).set({ updatedAt: now() }).where(eq(schema.musicPlaylists.id, playlistId)).run();
	return id;
}

export function removeTrackFromPlaylist(playlistId: string, userId: string, trackId: string): boolean {
	const db = getDb();
	const playlist = db.select().from(schema.musicPlaylists)
		.where(and(eq(schema.musicPlaylists.id, playlistId), eq(schema.musicPlaylists.userId, userId)))
		.get();
	if (!playlist) return false;

	const result = db
		.delete(schema.musicPlaylistTracks)
		.where(and(
			eq(schema.musicPlaylistTracks.playlistId, playlistId),
			eq(schema.musicPlaylistTracks.trackId, trackId)
		))
		.run();

	if (result.changes > 0) {
		db.update(schema.musicPlaylists).set({ updatedAt: now() }).where(eq(schema.musicPlaylists.id, playlistId)).run();
	}
	return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Recently Played (from media_events)
// ---------------------------------------------------------------------------

export function getRecentlyPlayed(userId: string, limit = 50): Array<{ mediaId: string; mediaTitle: string | null; serviceId: string; timestamp: number }> {
	const db = getDb();
	// Get distinct recent music play events
	const rows = db.all<{ media_id: string; media_title: string | null; service_id: string; timestamp: number }>(
		sql`SELECT media_id, media_title, service_id, MAX(timestamp) as timestamp
			FROM media_events
			WHERE user_id = ${userId}
			  AND media_type = 'music'
			  AND event_type IN ('play_start', 'play_resume')
			GROUP BY media_id, service_id
			ORDER BY timestamp DESC
			LIMIT ${limit}`
	);
	return rows.map((r) => ({
		mediaId: r.media_id,
		mediaTitle: r.media_title,
		serviceId: r.service_id,
		timestamp: r.timestamp
	}));
}
```

**Step 2: Verify build**

Run: `pnpm build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add src/lib/server/music.ts
git commit -m "feat(music): add music service layer (Jellyfin + Lidarr + DB orchestration)"
```

---

## Task 6: API Routes — browse endpoints

**Files:**
- Create: `src/routes/api/music/albums/+server.ts`
- Create: `src/routes/api/music/albums/[id]/+server.ts`
- Create: `src/routes/api/music/artists/+server.ts`
- Create: `src/routes/api/music/artists/[id]/+server.ts`
- Create: `src/routes/api/music/instant-mix/[id]/+server.ts`
- Create: `src/routes/api/music/recently-played/+server.ts`
- Create: `src/routes/api/music/wanted/+server.ts`
- Create: `src/routes/api/music/queue/+server.ts`

**Step 1: Create all browse endpoints**

`src/routes/api/music/albums/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { getMusicAlbums } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const genre = url.searchParams.get('genre') ?? undefined;
	const artistId = url.searchParams.get('artistId') ?? undefined;
	const sort = url.searchParams.get('sort') ?? undefined;
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const serviceId = url.searchParams.get('serviceId') ?? undefined;
	const result = await getMusicAlbums(locals.user.id, { genre, artistId, sort, limit, offset, serviceId });
	return json(result);
};
```

`src/routes/api/music/albums/[id]/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { getMusicAlbumDetail } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');
	const result = await getMusicAlbumDetail(locals.user.id, params.id, serviceId);
	if (!result) throw error(404);
	return json(result);
};
```

`src/routes/api/music/artists/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { getMusicArtists } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const sort = url.searchParams.get('sort') ?? undefined;
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const serviceId = url.searchParams.get('serviceId') ?? undefined;
	const result = await getMusicArtists(locals.user.id, { sort, limit, offset, serviceId });
	return json(result);
};
```

`src/routes/api/music/artists/[id]/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { getMusicArtistDetail } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');
	const result = await getMusicArtistDetail(locals.user.id, params.id, serviceId);
	if (!result) throw error(404);
	return json(result);
};
```

`src/routes/api/music/instant-mix/[id]/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { getMusicInstantMix } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');
	const tracks = await getMusicInstantMix(locals.user.id, params.id, serviceId);
	return json(tracks);
};
```

`src/routes/api/music/recently-played/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { getRecentlyPlayed } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const tracks = getRecentlyPlayed(locals.user.id, limit);
	return json(tracks);
};
```

`src/routes/api/music/wanted/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { getMusicWanted } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const result = await getMusicWanted(locals.user.id);
	return json(result);
};
```

`src/routes/api/music/queue/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { getMusicQueue } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const queue = await getMusicQueue();
	return json(queue);
};
```

**Step 2: Verify build**

Run: `pnpm build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add src/routes/api/music/
git commit -m "feat(music): add browse API endpoints (albums, artists, instant-mix, recently-played, wanted, queue)"
```

---

## Task 7: API Routes — liked tracks endpoints

**Files:**
- Create: `src/routes/api/music/liked/+server.ts`

**Step 1: Create liked tracks CRUD endpoint**

```typescript
import { json, error } from '@sveltejs/kit';
import { getLikedTracks, likeTrack, unlikeTrack } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const tracks = getLikedTracks(locals.user.id);
	return json(tracks);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const { trackId, serviceId } = await request.json();
	if (!trackId || !serviceId) throw error(400, 'trackId and serviceId required');
	const id = likeTrack(locals.user.id, trackId, serviceId);
	return json({ id });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const trackId = url.searchParams.get('trackId');
	const serviceId = url.searchParams.get('serviceId');
	if (!trackId || !serviceId) throw error(400, 'trackId and serviceId required');
	const ok = unlikeTrack(locals.user.id, trackId, serviceId);
	if (!ok) throw error(404);
	return json({ ok: true });
};
```

**Step 2: Verify build**

Run: `pnpm build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add src/routes/api/music/liked/
git commit -m "feat(music): add liked tracks API endpoint"
```

---

## Task 8: API Routes — playlist endpoints

**Files:**
- Create: `src/routes/api/music/playlists/+server.ts`
- Create: `src/routes/api/music/playlists/[id]/+server.ts`
- Create: `src/routes/api/music/playlists/[id]/tracks/+server.ts`

**Step 1: Create playlist CRUD endpoints**

`src/routes/api/music/playlists/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { getUserPlaylists, createPlaylist } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const playlists = getUserPlaylists(locals.user.id);
	return json(playlists);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const { name, description } = await request.json();
	if (!name) throw error(400, 'name required');
	const id = createPlaylist(locals.user.id, name, description);
	return json({ id });
};
```

`src/routes/api/music/playlists/[id]/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { getPlaylist, updatePlaylist, deletePlaylist } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const playlist = getPlaylist(params.id, locals.user.id);
	if (!playlist) throw error(404);
	return json(playlist);
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const { name, description } = await request.json();
	const ok = updatePlaylist(params.id, locals.user.id, { name, description });
	if (!ok) throw error(404);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const ok = deletePlaylist(params.id, locals.user.id);
	if (!ok) throw error(404);
	return json({ ok: true });
};
```

`src/routes/api/music/playlists/[id]/tracks/+server.ts`:
```typescript
import { json, error } from '@sveltejs/kit';
import { addTrackToPlaylist, removeTrackFromPlaylist } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const { trackId, serviceId } = await request.json();
	if (!trackId || !serviceId) throw error(400, 'trackId and serviceId required');
	const id = addTrackToPlaylist(params.id, locals.user.id, trackId, serviceId);
	if (!id) throw error(404, 'Playlist not found');
	return json({ id });
};

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401);
	const trackId = url.searchParams.get('trackId');
	if (!trackId) throw error(400, 'trackId required');
	const ok = removeTrackFromPlaylist(params.id, locals.user.id, trackId);
	if (!ok) throw error(404);
	return json({ ok: true });
};
```

**Step 2: Verify build**

Run: `pnpm build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add src/routes/api/music/playlists/
git commit -m "feat(music): add playlist CRUD API endpoints"
```

---

## Task 9: Fix music.ts — remove broken dynamic imports

**Files:**
- Modify: `src/lib/server/music.ts`

**Step 1: Simplify getMusicAlbumDetail and getMusicArtistDetail**

The initial music.ts has some broken dynamic imports. Replace `getMusicAlbumDetail` with a clean version that uses the static imports already at the top:

```typescript
// Replace the getMusicAlbumDetail function with:
export async function getMusicAlbumDetail(userId: string, albumId: string, serviceId: string) {
	const config = getJellyfinMusicConfigs().find((c) => c.id === serviceId);
	if (!config) return null;

	const cred = resolveJellyfinCred(config, userId);
	const tracks = await getAlbumTracks(config, albumId, cred);
	return { tracks };
}

// Replace the getMusicArtistDetail function with:
export async function getMusicArtistDetail(userId: string, artistId: string, serviceId: string) {
	const config = getJellyfinMusicConfigs().find((c) => c.id === serviceId);
	if (!config) return null;

	const cred = resolveJellyfinCred(config, userId);
	const albums = await getArtistAlbums(config, artistId, cred);

	// Try Lidarr for richer artist data
	const lidarrConfig = getLidarrConfig();
	let lidarrArtist = null;
	if (lidarrConfig && albums.length > 0) {
		const lidarrArtists = await withCache('lidarr:artists', 120_000, () => getLidarrArtists(lidarrConfig));
		const artistName = ((albums[0]?.metadata?.artist as string) ?? '').toLowerCase();
		lidarrArtist = lidarrArtists.find((a) => a.name.toLowerCase() === artistName) ?? null;
	}

	return { albums, lidarr: lidarrArtist };
}
```

**Step 2: Verify build**

Run: `pnpm build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add src/lib/server/music.ts
git commit -m "fix(music): clean up music service layer, remove broken dynamic imports"
```

---

## Task 10: Final build verification and sync

**Step 1: Run svelte-kit sync + build**

Run: `npx svelte-kit sync && pnpm build 2>&1 | tail -10`

**Step 2: Run svelte-check (errors only)**

Run: `npx svelte-check --threshold error 2>&1 | tail -5`

Verify no NEW errors beyond the pre-existing 14 in analytics/stats-engine.

**Step 3: Commit any remaining fixes**

If clean, do a final commit with all files:

```bash
git add -A
git commit -m "feat(music): complete music API layer — Jellyfin browse, Lidarr enrichment, playlists, liked tracks"
```

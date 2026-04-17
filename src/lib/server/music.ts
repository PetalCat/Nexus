import { randomBytes } from 'crypto';
import { and, eq, desc, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { getAlbums, getAlbumTracks, getArtists, getArtistAlbums, getInstantMix, getSongs } from '../adapters/jellyfin';
import { getLidarrAlbums, getLidarrArtists, getLidarrWanted, getLidarrQueue } from '../adapters/lidarr';
import { registry } from '../adapters/registry';
import type { ServiceConfig, UserCredential, UnifiedMedia } from '../adapters/types';
import { getConfigsForMediaType, getEnabledConfigs } from './services';
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
	// Use registry to find all configs whose adapter supports 'music' and is a library
	return getConfigsForMediaType('music').filter((c) => {
		const adapter = registry.get(c.type);
		return adapter?.isLibrary;
	});
}

export function getLidarrConfig(): ServiceConfig | undefined {
	// Find the first enabled config whose adapter supports 'music' but isn't a library
	// (e.g. Lidarr provides music metadata/monitoring but Jellyfin is the library)
	return getConfigsForMediaType('music').find((c) => {
		const adapter = registry.get(c.type);
		return adapter && !adapter.isLibrary;
	});
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

	const enriched = await enrichAlbumsWithLidarr(items);
	return { items: enriched, total };
}

export async function getMusicAlbumDetail(userId: string, albumId: string, serviceId: string) {
	const config = getJellyfinMusicConfigs().find((c) => c.id === serviceId);
	if (!config) return null;

	const cred = resolveJellyfinCred(config, userId);
	const tracks = await getAlbumTracks(config, albumId, cred);
	return { tracks };
}

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

export async function getMusicSongs(userId: string, opts?: {
	sort?: string; limit?: number; offset?: number; search?: string;
}) {
	const configs = getJellyfinMusicConfigs();
	if (configs.length === 0) return { items: [], total: 0 };

	const results = await Promise.allSettled(
		configs.map((config) => {
			const cred = resolveJellyfinCred(config, userId);
			return getSongs(config, cred, opts);
		})
	);

	const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.items : []));
	const total = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.total : 0), 0);

	return { items, total };
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
	const configs = getJellyfinMusicConfigs();
	const config = configs.find((c) => c.id === serviceId) ?? configs[0];
	if (!config) return null;

	const cred = resolveJellyfinCred(config, userId);

	// Fetch artist info and albums in parallel
	const [artistResult, albums] = await Promise.all([
		getArtists(config, cred, { limit: 1 }).then((r) => r.items).catch(() => []),
		getArtistAlbums(config, artistId, cred)
	]);

	// Fetch the specific artist by fetching all and filtering by ID,
	// or use the item endpoint for artist details
	let artist: { id: string; name: string; imageUrl?: string; backdrop?: string; albumCount?: number; overview?: string; genres?: string[]; serviceId?: string } | null = null;

	// Try to get artist info from getArtists with the full list (cached)
	// User-scoped: each user's `cred` may surface different library contents.
	const allArtists = await withCache(`jf:artists:${config.id}:${userId}`, 120_000, () =>
		getArtists(config, cred, { limit: 500 })
	);
	const foundArtist = allArtists.items.find((a) => a.id === artistId);
	if (foundArtist) {
		artist = { ...foundArtist, serviceId: config.id };
	} else if (albums.length > 0) {
		// Fallback: construct from album metadata
		artist = {
			id: artistId,
			name: (albums[0]?.metadata?.artist as string) ?? 'Unknown Artist',
			imageUrl: albums[0]?.metadata?.artistImageUrl as string | undefined,
			albumCount: albums.length,
			serviceId: config.id
		};
	}

	if (!artist) return null;

	// Count total tracks across albums
	const totalTracks = albums.reduce((sum, a) => sum + ((a.metadata?.userData as any)?.UnplayedItemCount ?? 0), 0);
	(artist as any).trackCount = totalTracks;

	// Try Lidarr for richer artist data
	const lidarrConfig = getLidarrConfig();
	let lidarrArtist = null;
	if (lidarrConfig && albums.length > 0) {
		const lidarrArtists = await withCache('lidarr:artists', 120_000, () => getLidarrArtists(lidarrConfig));
		const artistName = ((albums[0]?.metadata?.artist as string) ?? '').toLowerCase();
		lidarrArtist = lidarrArtists.find((a) => a.name.toLowerCase() === artistName) ?? null;
	}

	return { artist, albums, lidarr: lidarrArtist };
}

export async function getArtistTopSongs(userId: string, artistId: string, serviceId: string, limit = 5): Promise<UnifiedMedia[]> {
	const configs = getJellyfinMusicConfigs();
	const config = configs.find((c) => c.id === serviceId) ?? configs[0];
	if (!config) return [];
	const cred = resolveJellyfinCred(config, userId);
	if (!cred) return [];

	try {
		const result = await getSongs(config, cred, {
			artistId,
			sort: 'PlayCount',
			limit
		});
		return result.items;
	} catch (e) {
		console.error('[music] Failed to fetch top songs:', e);
		return [];
	}
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
	// Own playlists + collaborative playlists user has been invited to
	const owned = db
		.select()
		.from(schema.musicPlaylists)
		.where(eq(schema.musicPlaylists.userId, userId))
		.orderBy(desc(schema.musicPlaylists.updatedAt))
		.all();

	const collabRows = db.all<{ playlist_id: string; role: string }>(
		sql`SELECT playlist_id, role FROM playlist_collaborators WHERE user_id = ${userId}`
	);
	const collabIds = collabRows.map((r) => r.playlist_id);
	const collabPlaylists = collabIds.length > 0
		? db.select().from(schema.musicPlaylists)
			.where(sql`${schema.musicPlaylists.id} IN (${sql.join(collabIds.map(id => sql`${id}`), sql`,`)})`)
			.orderBy(desc(schema.musicPlaylists.updatedAt))
			.all()
		: [];

	const all = [...owned, ...collabPlaylists.filter((p) => !owned.some((o) => o.id === p.id))];

	return all.map((p) => {
		const trackCount = db.get<{ n: number }>(
			sql`SELECT COUNT(*) as n FROM music_playlist_tracks WHERE playlist_id = ${p.id}`
		);
		const collaborators = getPlaylistCollaborators(p.id);
		const role = p.userId === userId ? 'owner' : (collabRows.find((r) => r.playlist_id === p.id)?.role ?? 'viewer');
		return { ...p, trackCount: trackCount?.n ?? 0, collaborators, role };
	});
}

export function createPlaylist(userId: string, name: string, description?: string, isCollaborative = false): string {
	const db = getDb();
	const id = genId();
	const ts = now();
	db.insert(schema.musicPlaylists).values({
		id, userId, name, description: description ?? null, isCollaborative: isCollaborative ? 1 : 0, createdAt: ts, updatedAt: ts
	}).run();
	return id;
}

export function getPlaylist(playlistId: string, userId: string) {
	const db = getDb();
	const playlist = db.select().from(schema.musicPlaylists)
		.where(eq(schema.musicPlaylists.id, playlistId))
		.get();
	if (!playlist) return null;

	// Check access: owner, or collaborator
	if (playlist.userId !== userId) {
		const collab = db.select().from(schema.playlistCollaborators)
			.where(and(eq(schema.playlistCollaborators.playlistId, playlistId), eq(schema.playlistCollaborators.userId, userId)))
			.get();
		if (!collab) return null;
	}

	const tracks = db.select().from(schema.musicPlaylistTracks)
		.where(eq(schema.musicPlaylistTracks.playlistId, playlistId))
		.orderBy(schema.musicPlaylistTracks.position)
		.all();

	const collaborators = getPlaylistCollaborators(playlistId);
	const role = playlist.userId === userId ? 'owner' : 'editor';

	return { ...playlist, tracks, collaborators, role };
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
	if (!canEditPlaylist(playlistId, userId)) return null;

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
	if (!canEditPlaylist(playlistId, userId)) return false;

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
// Collaborative playlist helpers
// ---------------------------------------------------------------------------

function canEditPlaylist(playlistId: string, userId: string): boolean {
	const db = getDb();
	const playlist = db.select().from(schema.musicPlaylists)
		.where(eq(schema.musicPlaylists.id, playlistId))
		.get();
	if (!playlist) return false;
	if (playlist.userId === userId) return true;
	const collab = db.select().from(schema.playlistCollaborators)
		.where(and(eq(schema.playlistCollaborators.playlistId, playlistId), eq(schema.playlistCollaborators.userId, userId)))
		.get();
	return collab?.role === 'editor';
}

function getPlaylistCollaborators(playlistId: string) {
	const db = getDb();
	return db.select().from(schema.playlistCollaborators)
		.where(eq(schema.playlistCollaborators.playlistId, playlistId))
		.all()
		.map((c) => ({ userId: c.userId, role: c.role, addedAt: c.addedAt }));
}

export function addCollaborator(playlistId: string, ownerId: string, collaboratorUserId: string, role: 'editor' | 'viewer' = 'editor'): boolean {
	const db = getDb();
	const playlist = db.select().from(schema.musicPlaylists)
		.where(and(eq(schema.musicPlaylists.id, playlistId), eq(schema.musicPlaylists.userId, ownerId)))
		.get();
	if (!playlist) return false;

	// Don't add owner as collaborator
	if (collaboratorUserId === ownerId) return false;

	// Check if already a collaborator
	const existing = db.select().from(schema.playlistCollaborators)
		.where(and(eq(schema.playlistCollaborators.playlistId, playlistId), eq(schema.playlistCollaborators.userId, collaboratorUserId)))
		.get();
	if (existing) return true;

	db.insert(schema.playlistCollaborators).values({
		id: genId(),
		playlistId,
		userId: collaboratorUserId,
		role,
		addedAt: now()
	}).run();

	// Mark playlist as collaborative
	db.update(schema.musicPlaylists).set({ isCollaborative: 1, updatedAt: now() }).where(eq(schema.musicPlaylists.id, playlistId)).run();
	return true;
}

export function removeCollaborator(playlistId: string, ownerId: string, collaboratorUserId: string): boolean {
	const db = getDb();
	const playlist = db.select().from(schema.musicPlaylists)
		.where(and(eq(schema.musicPlaylists.id, playlistId), eq(schema.musicPlaylists.userId, ownerId)))
		.get();
	if (!playlist) return false;

	db.delete(schema.playlistCollaborators)
		.where(and(eq(schema.playlistCollaborators.playlistId, playlistId), eq(schema.playlistCollaborators.userId, collaboratorUserId)))
		.run();

	// If no collaborators left, mark as non-collaborative
	const remaining = db.select().from(schema.playlistCollaborators)
		.where(eq(schema.playlistCollaborators.playlistId, playlistId))
		.all();
	if (remaining.length === 0) {
		db.update(schema.musicPlaylists).set({ isCollaborative: 0, updatedAt: now() }).where(eq(schema.musicPlaylists.id, playlistId)).run();
	}
	return true;
}

// ---------------------------------------------------------------------------
// Recently Played (from play_sessions)
// ---------------------------------------------------------------------------

export function getRecentlyPlayed(userId: string, limit = 50): Array<{ mediaId: string; mediaTitle: string | null; serviceId: string; timestamp: number }> {
	const db = getDb();
	const rows = db.all<{ media_id: string; media_title: string | null; service_id: string; started_at: number }>(
		sql`SELECT DISTINCT media_id, media_title, service_id, MAX(started_at) as started_at
			FROM play_sessions
			WHERE user_id = ${userId}
			  AND media_type = 'music'
			GROUP BY media_id, service_id
			ORDER BY started_at DESC
			LIMIT ${limit}`
	);
	return rows.map((r) => ({
		mediaId: r.media_id,
		mediaTitle: r.media_title,
		serviceId: r.service_id,
		timestamp: r.started_at
	}));
}

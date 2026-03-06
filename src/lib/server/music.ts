import { randomBytes } from 'crypto';
import { and, eq, desc, sql } from 'drizzle-orm';
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

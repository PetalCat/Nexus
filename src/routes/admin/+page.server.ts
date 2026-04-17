import type { PageServerLoad } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';
import { getConnectedUserCount } from '$lib/server/ws';
import { getRawDb } from '$lib/db';

// ---------------------------------------------------------------------------
// Jellyfin session types
// ---------------------------------------------------------------------------

export interface JellyfinSession {
	Id: string;
	UserId?: string;
	UserName?: string;
	Client?: string;
	DeviceName?: string;
	RemoteEndPoint?: string;
	LastActivityDate?: string;
	PlayState?: {
		PositionTicks?: number;
		IsPaused?: boolean;
		PlayMethod?: 'DirectPlay' | 'DirectStream' | 'Transcode' | string;
	};
	NowPlayingItem?: {
		Id: string;
		Name: string;
		Type: string;
		SeriesName?: string;
		SeasonNumber?: number;
		IndexNumber?: number;
		ProductionYear?: number;
		RunTimeTicks?: number;
		ImageTags?: { Primary?: string };
		BackdropImageTags?: string[];
		/** For episodes — use parent series backdrop */
		ParentBackdropItemId?: string;
		ParentBackdropImageTags?: string[];
	};
	/** Added by us — which service this came from */
	_serviceId?: string;
	_serviceUrl?: string;
	_serviceName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJellyfinSessions(config: {
	id: string;
	name: string;
	url: string;
	apiKey?: string;
}): Promise<JellyfinSession[]> {
	const base = config.url.replace(/\/+$/, '');
	const res = await fetch(`${base}/Sessions`, {
		headers: {
			Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0", Token="${config.apiKey ?? ''}"`,
			'X-Emby-Token': config.apiKey ?? '',
			Accept: 'application/json'
		},
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`Jellyfin sessions: ${res.status}`);
	const sessions: JellyfinSession[] = await res.json();
	return sessions.map((s) => ({
		...s,
		_serviceId: config.id,
		_serviceUrl: base,
		_serviceName: config.name
	}));
}

/**
 * Normalise Plex sessions (via adapter.pollSessions → NexusSession) into the
 * JellyfinSession shape the admin UI already knows how to render. Plex reports
 * time in ms and play method via TranscodeSession; we rebuild the fields the
 * UI reads (PlayState.PositionTicks, PlayMethod, NowPlayingItem.*).
 */
async function fetchPlexSessions(config: {
	id: string;
	name: string;
	url: string;
}): Promise<JellyfinSession[]> {
	const full = getEnabledConfigs().find((c) => c.id === config.id);
	if (!full) return [];
	const adapter = registry.get('plex');
	if (!adapter?.pollSessions) return [];
	const base = config.url.replace(/\/+$/, '');
	const sessions = await adapter.pollSessions(full);
	return sessions.map((s): JellyfinSession => {
		const streamType = s.metadata?.streamType as string | undefined;
		const isTranscoding = !!s.metadata?.isTranscoding;
		const playMethod = isTranscoding
			? 'Transcode'
			: streamType === 'direct-stream'
				? 'DirectStream'
				: 'DirectPlay';
		const runtimeMs = s.durationSeconds ? s.durationSeconds * 1000 : undefined;
		const positionMs = s.positionSeconds ? s.positionSeconds * 1000 : undefined;
		// Re-map Nexus media types back to Jellyfin "Type" strings the admin UI expects.
		const typeMap: Record<string, string> = {
			movie: 'Movie',
			show: 'Series',
			episode: 'Episode',
			music: 'Audio',
			album: 'MusicAlbum'
		};
		return {
			Id: s.sessionId,
			UserId: s.userId,
			UserName: s.username,
			Client: s.client,
			DeviceName: s.device,
			PlayState: {
				PositionTicks: positionMs ? positionMs * 10_000 : undefined,
				IsPaused: s.state === 'paused',
				PlayMethod: playMethod
			},
			NowPlayingItem: {
				Id: s.mediaId,
				Name: s.mediaTitle ?? 'Unknown',
				Type: typeMap[s.mediaType] ?? 'Movie',
				SeriesName: s.parentTitle,
				ProductionYear: s.year,
				RunTimeTicks: runtimeMs ? runtimeMs * 10_000 : undefined
				// Backdrops are not carried in NexusSession — admin UI will
				// render a plain tile without a backdrop image for Plex sessions.
			},
			_serviceId: config.id,
			_serviceUrl: base,
			_serviceName: config.name
		};
	});
}

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------

export const load: PageServerLoad = async () => {
	const jellyfinConfigs = getEnabledConfigs()
		.filter((c) => c.type === 'jellyfin')
		.map((c) => ({ id: c.id, name: c.name, url: c.url, apiKey: c.apiKey }));

	const plexConfigs = getEnabledConfigs()
		.filter((c) => c.type === 'plex')
		.map((c) => ({ id: c.id, name: c.name, url: c.url }));

	const overseerrConfigs = getEnabledConfigs().filter((c) => c.type === 'overseerr');

	const [sessionsResult, requestsResult] = await Promise.allSettled([
		// Live sessions from every configured media server (short cache — 10s)
		withCache('admin-sessions', 10_000, async () => {
			const [jfSets, plexSets] = await Promise.all([
				Promise.allSettled(jellyfinConfigs.map(fetchJellyfinSessions)),
				Promise.allSettled(plexConfigs.map(fetchPlexSessions))
			]);
			const all = [
				...jfSets.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
				...plexSets.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
			];
			return all.filter((s) => s.NowPlayingItem);
		}),

		// Recent requests across all Overseerr instances
		withCache('admin-requests', 30_000, () =>
			Promise.all(
				overseerrConfigs.map((config) => {
					const adapter = registry.get('overseerr');
					return (
						adapter?.getRequests?.(config, { filter: 'all', take: 12 }) ?? Promise.resolve([])
					);
				})
			).then((all) => all.flat().slice(0, 20))
		)
	]);

	// ── Overview metrics ─────────────────────────────────────────────────
	const db = getRawDb();
	const onlineUsers = getConnectedUserCount();
	const totalUsers = (db.prepare(`SELECT COUNT(*) as count FROM users`).get() as any)?.count ?? 0;

	// Play time today
	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);
	const playTimeToday = (db.prepare(`
		SELECT COALESCE(SUM(duration_ms), 0) as total
		FROM play_sessions
		WHERE started_at >= ?
	`).get(todayStart.getTime()) as any)?.total ?? 0;

	// Recent play sessions (last 10)
	const recentEvents = db.prepare(`
		SELECT ps.user_id, u.display_name as userName,
		       CASE WHEN ps.ended_at IS NOT NULL THEN 'play_stop' ELSE 'play_start' END as eventType,
		       ps.media_title as mediaTitle, ps.media_type as mediaType, ps.started_at as timestamp,
		       ps.duration_ms as playDurationMs
		FROM play_sessions ps
		LEFT JOIN users u ON u.id = ps.user_id
		ORDER BY ps.started_at DESC
		LIMIT 10
	`).all() as any[];

	return {
		sessions: sessionsResult.status === 'fulfilled' ? sessionsResult.value : [],
		requests: requestsResult.status === 'fulfilled' ? requestsResult.value : [],
		// Map of every configured media-server origin URL, keyed by serviceId.
		// Kept under the legacy `jellyfinUrls` name for UI compat.
		jellyfinUrls: Object.fromEntries(
			[...jellyfinConfigs, ...plexConfigs].map((c) => [c.id, c.url])
		),
		onlineUsers,
		totalUsers,
		playTimeToday,
		recentEvents
	};
};

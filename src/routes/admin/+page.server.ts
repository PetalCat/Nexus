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
		// Live sessions from every configured media server (short cache — 10s).
		// "Live" here means any adapter-polled session carrying a NowPlayingItem,
		// including paused ones. The admin UI splits playing vs paused.
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
	//
	// Two truth sources here — keep them separate:
	//   • `sessions` (above) is adapter-polled; reflects what is happening RIGHT NOW.
	//   • `play_sessions` is a rollup table mutated in place by the session-poller
	//     — one row per session, `ended_at` fills in only once the session stops.
	//
	// Historically these two were conflated; this split is documented in
	// docs/superpowers/specs/2026-04-17-surface-drift-fix-plan.md (#18).
	const db = getRawDb();
	const onlineUsers = getConnectedUserCount();
	const totalUsers = (db.prepare(`SELECT COUNT(*) as count FROM users`).get() as any)?.count ?? 0;

	// Play time today — sum only the portion of each session that actually
	// overlaps today's window, so cross-midnight sessions aren't double-counted
	// against either day.
	const todayStartDate = new Date();
	todayStartDate.setHours(0, 0, 0, 0);
	const todayStart = todayStartDate.getTime();
	const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
	const now = Date.now();
	const playTimeToday = (db.prepare(`
		SELECT COALESCE(SUM(
			MIN(COALESCE(ended_at, ?), ?) - MAX(started_at, ?)
		), 0) AS total
		FROM play_sessions
		WHERE COALESCE(ended_at, ?) >= ? AND started_at < ?
	`).get(now, tomorrowStart, todayStart, now, todayStart, tomorrowStart) as any)?.total ?? 0;

	// Recent sessions rollup — one row per session. `ended_at` is NULL while the
	// session is still in flight, so we use COALESCE(ended_at, updated_at) as the
	// "last we heard from this session" timestamp. Never `started_at` alone, which
	// was the historical bug (completed sessions reported their start time as the
	// stop time).
	const recentEvents = db.prepare(`
		SELECT ps.user_id, u.display_name as userName,
		       CASE WHEN ps.ended_at IS NOT NULL THEN 'play_stop' ELSE 'play_start' END as eventType,
		       ps.media_title as mediaTitle, ps.media_type as mediaType,
		       COALESCE(ps.ended_at, ps.updated_at) as timestamp,
		       ps.duration_ms as playDurationMs
		FROM play_sessions ps
		LEFT JOIN users u ON u.id = ps.user_id
		ORDER BY COALESCE(ps.ended_at, ps.updated_at) DESC
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

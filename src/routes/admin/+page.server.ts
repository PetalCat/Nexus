import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEnabledConfigs, checkAllServices, getQueue } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';
import { getProwlarrIndexers, getProwlarrStats } from '$lib/adapters/prowlarr';
import type { ProwlarrIndexer, ProwlarrStats } from '$lib/adapters/prowlarr';
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

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user?.isAdmin) throw redirect(302, '/');

	const jellyfinConfigs = getEnabledConfigs()
		.filter((c) => c.type === 'jellyfin')
		.map((c) => ({ id: c.id, name: c.name, url: c.url, apiKey: c.apiKey }));

	const overseerrConfigs = getEnabledConfigs().filter((c) => c.type === 'overseerr');

	const prowlarrConfigs = getEnabledConfigs().filter((c) => c.type === 'prowlarr');

	const hasInvidious = getEnabledConfigs().some((c) => c.type === 'invidious');

	const [sessionsResult, requestsResult, healthResult, queueResult, prowlarrResult, proxyResult] = await Promise.allSettled([
		// Live sessions from all Jellyfin instances (short cache — 10s)
		withCache('admin-sessions', 10_000, () =>
			Promise.all(jellyfinConfigs.map(fetchJellyfinSessions)).then((all) =>
				all.flat().filter((s) => s.NowPlayingItem)
			)
		),

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
		),

		// Service health (shared with sidebar badge — cached 30s inside checkAllServices)
		checkAllServices(),

		// Download queue from *arr services
		withCache('admin-queue', 30_000, () => getQueue()),

		// Prowlarr indexer stats
		withCache('admin-prowlarr', 30_000, async () => {
			if (prowlarrConfigs.length === 0) return null;
			const config = prowlarrConfigs[0];
			const [indexers, stats] = await Promise.all([
				getProwlarrIndexers(config),
				getProwlarrStats(config)
			]);
			return { indexers, stats };
		}),

		// Stream proxy stats (Rust sub-server on port 3939)
		withCache('admin-proxy-stats', 10_000, async () => {
			if (!hasInvidious) return null;
			try {
				const res = await fetch('http://localhost:3939/stats', { signal: AbortSignal.timeout(3000) });
				if (!res.ok) return null;
				return await res.json();
			} catch {
				return null;
			}
		})
	]);

	// ── New Overview metrics ─────────────────────────────────────────────
	const db = getRawDb();
	const onlineUsers = getConnectedUserCount();
	const totalUsers = (db.prepare(`SELECT COUNT(*) as count FROM users`).get() as any)?.count ?? 0;

	// Play time today
	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);
	const playTimeToday = (db.prepare(`
		SELECT COALESCE(SUM(play_duration_ms), 0) as total
		FROM media_events
		WHERE event_type = 'play_stop' AND timestamp >= ?
	`).get(todayStart.getTime()) as any)?.total ?? 0;

	// Recent media events (last 10)
	const recentEvents = db.prepare(`
		SELECT me.user_id, u.display_name as userName, me.event_type as eventType,
		       me.media_title as mediaTitle, me.media_type as mediaType, me.timestamp,
		       me.play_duration_ms as playDurationMs
		FROM media_events me
		LEFT JOIN users u ON u.id = me.user_id
		WHERE me.event_type IN ('play_start', 'play_stop', 'complete')
		ORDER BY me.timestamp DESC
		LIMIT 10
	`).all() as any[];

	return {
		sessions: sessionsResult.status === 'fulfilled' ? sessionsResult.value : [],
		requests: requestsResult.status === 'fulfilled' ? requestsResult.value : [],
		health: healthResult.status === 'fulfilled' ? healthResult.value : [],
		queue: queueResult.status === 'fulfilled' ? queueResult.value : [],
		jellyfinUrls: Object.fromEntries(jellyfinConfigs.map((c) => [c.id, c.url])),
		prowlarr: prowlarrResult.status === 'fulfilled' ? prowlarrResult.value : null,
		proxyStats: proxyResult.status === 'fulfilled' ? proxyResult.value : null,
		onlineUsers,
		totalUsers,
		playTimeToday,
		recentEvents
	};
};

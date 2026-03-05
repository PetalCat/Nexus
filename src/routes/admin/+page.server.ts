import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEnabledConfigs, checkAllServices, getQueue } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';

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

	const [sessionsResult, requestsResult, healthResult, queueResult] = await Promise.allSettled([
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
		withCache('admin-queue', 30_000, () => getQueue())
	]);

	return {
		sessions: sessionsResult.status === 'fulfilled' ? sessionsResult.value : [],
		requests: requestsResult.status === 'fulfilled' ? requestsResult.value : [],
		health: healthResult.status === 'fulfilled' ? healthResult.value : [],
		queue: queueResult.status === 'fulfilled' ? queueResult.value : [],
		jellyfinUrls: Object.fromEntries(jellyfinConfigs.map((c) => [c.id, c.url]))
	};
};

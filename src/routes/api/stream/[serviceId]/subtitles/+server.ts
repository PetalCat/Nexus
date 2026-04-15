import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { RequestHandler } from './$types';

/** Cache resolved Jellyfin userIds to avoid extra lookups */
const userIdCache = new Map<string, string>();

/**
 * GET /api/stream/{serviceId}/subtitles?itemId={id}
 *
 * Returns all subtitle streams for a Jellyfin item, including external SRT/ASS files
 * that may not appear in the HLS manifest. Each entry carries a proxied VTT URL
 * that the Player can inject as a <track> element.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const { serviceId } = params;
	const itemId = url.searchParams.get('itemId');
	if (!itemId) return new Response('Missing itemId', { status: 400 });

	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'jellyfin') {
		return new Response('Service not found', { status: 404 });
	}

	const adapter = registry.get(config.type);
	const userCred =
		locals.user?.id && adapter?.userLinkable
			? getUserCredentialForService(locals.user.id, serviceId) ?? undefined
			: undefined;

	const token = userCred?.accessToken ?? config.apiKey ?? '';
	const baseUrl = config.url.replace(/\/+$/, '');

	// Resolve Jellyfin userId — required for /Users/{id}/Items/{id} endpoint
	let jellyfinUserId = userCred?.externalUserId ?? '';
	if (!jellyfinUserId) {
		const cached = userIdCache.get(serviceId);
		if (cached) {
			jellyfinUserId = cached;
		} else if (token) {
			try {
				const meRes = await fetch(`${baseUrl}/Users/Me`, {
					headers: { 'X-Emby-Token': token },
					signal: AbortSignal.timeout(5000)
				});
				if (meRes.ok) {
					const me = await meRes.json();
					jellyfinUserId = me.Id ?? '';
				}
			} catch { /* silent */ }

			if (!jellyfinUserId) {
				try {
					const usersRes = await fetch(`${baseUrl}/Users`, {
						headers: { 'X-Emby-Token': token },
						signal: AbortSignal.timeout(5000)
					});
					if (usersRes.ok) {
						const users = await usersRes.json();
						const list = Array.isArray(users) ? users : (users.Items ?? []);
						const admin = list.find((u: any) => u.Policy?.IsAdministrator);
						jellyfinUserId = (admin ?? list[0])?.Id ?? '';
					}
				} catch { /* silent */ }
			}

			if (jellyfinUserId) userIdCache.set(serviceId, jellyfinUserId);
		}
	}

	// Use /Users/{userId}/Items/{itemId} when we have a userId (avoids "Guid can't be empty" error),
	// fall back to /Items/{itemId} otherwise
	const itemUrl = jellyfinUserId
		? `${baseUrl}/Users/${jellyfinUserId}/Items/${itemId}?Fields=MediaStreams&EnableImages=false`
		: `${baseUrl}/Items/${itemId}?Fields=MediaStreams&EnableImages=false`;

	try {
		const res = await fetch(itemUrl, {
			headers: {
				Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${serviceId}", Version="1.0.0", Token="${token}"`,
				'X-Emby-Token': token
			},
			signal: AbortSignal.timeout(8000)
		});

		if (!res.ok) return new Response('Upstream error', { status: res.status });

		const data = await res.json();
		const streams: any[] = data.MediaStreams ?? [];

		// Image-based subtitle codecs (PGS/DVB/VOBSUB) can't be served as WebVTT —
		// Jellyfin returns 404 for Stream.vtt on these tracks. Filter them out.
		const imageCodecs = new Set(['pgssub', 'pgs', 'dvbsub', 'dvdsub', 'vobsub', 'hdmv_pgs_subtitle']);
		const subtitles = streams
			.filter((s) => s.Type === 'Subtitle')
			.filter((s) => !imageCodecs.has(String(s.Codec ?? '').toLowerCase()))
			.map((s) => ({
				id: s.Index as number,
				name: s.DisplayTitle ?? s.DisplayLanguage ?? s.Language ?? `Subtitle ${s.Index}`,
				lang: (s.Language ?? '') as string,
				isExternal: (s.IsExternal ?? false) as boolean,
				// Jellyfin subtitle endpoint requires {itemId}/{mediaSourceId}/Subtitles/...
				vttUrl: `/api/stream/${serviceId}/${itemId}/${itemId}/Subtitles/${s.Index}/0/Stream.vtt`
			}));

		return new Response(JSON.stringify(subtitles), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		console.error('[subtitles] fetch error', e);
		return new Response('Failed to fetch subtitles', { status: 502 });
	}
};

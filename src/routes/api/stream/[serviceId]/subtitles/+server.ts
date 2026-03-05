import { getServiceConfig } from '$lib/server/services';
import type { RequestHandler } from './$types';

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

	const token = config.apiKey ?? '';
	const baseUrl = config.url.replace(/\/+$/, '');

	try {
		const res = await fetch(
			`${baseUrl}/Items/${itemId}?Fields=MediaStreams&EnableImages=false`,
			{
				headers: {
					Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${serviceId}", Version="1.0.0", Token="${token}"`,
					'X-Emby-Token': token
				},
				signal: AbortSignal.timeout(8000)
			}
		);

		if (!res.ok) return new Response('Upstream error', { status: res.status });

		const data = await res.json();
		const streams: any[] = data.MediaStreams ?? [];

		const subtitles = streams
			.filter((s) => s.Type === 'Subtitle')
			.map((s) => ({
				id: s.Index as number,
				name: s.DisplayTitle ?? s.DisplayLanguage ?? s.Language ?? `Subtitle ${s.Index}`,
				lang: (s.Language ?? '') as string,
				isExternal: (s.IsExternal ?? false) as boolean,
				vttUrl: `/api/stream/${serviceId}/${itemId}/Subtitles/${s.Index}/0/Stream.vtt`
			}));

		return new Response(JSON.stringify(subtitles), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		console.error('[subtitles] fetch error', e);
		return new Response('Failed to fetch subtitles', { status: 502 });
	}
};

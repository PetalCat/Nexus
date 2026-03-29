import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * Proxies caption/subtitle files from Invidious.
 *
 * Query params:
 *   label — caption label to fetch (e.g. "English")
 *   lang  — language code fallback (e.g. "en")
 *   url   — direct caption URL to proxy
 *
 * If `url` is provided, it proxies that URL directly.
 * Otherwise, fetches the video metadata and finds the matching caption track.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const { videoId } = params;
	const directUrl = url.searchParams.get('url');

	const invConfig = getConfigsForMediaType('video')[0];
	if (!invConfig) return new Response('No Invidious service', { status: 404 });

	const userCred = getUserCredentialForService(locals.user.id, invConfig.id) ?? undefined;
	const headers: Record<string, string> = {};
	if (userCred?.accessToken) headers['Cookie'] = `SID=${userCred.accessToken}`;

	let captionUrl: string;

	if (directUrl) {
		// Resolve relative URLs against the Invidious instance
		captionUrl = directUrl.startsWith('http') ? directUrl : `${invConfig.url}${directUrl}`;
	} else {
		// Look up the caption track from video metadata
		const label = url.searchParams.get('label');
		const lang = url.searchParams.get('lang');

		const metaRes = await fetch(
			`${invConfig.url}/api/v1/videos/${encodeURIComponent(videoId)}`,
			{ headers, signal: AbortSignal.timeout(10_000) }
		);
		if (!metaRes.ok) return new Response('Failed to fetch video metadata', { status: metaRes.status });

		const meta = await metaRes.json();
		const captions: any[] = meta.captions ?? [];

		const track = label
			? captions.find((c: any) => c.label === label)
			: lang
				? captions.find((c: any) => c.language_code === lang || c.languageCode === lang)
				: captions[0];

		if (!track) return new Response('Caption track not found', { status: 404 });

		const trackUrl = track.url ?? track.src;
		if (!trackUrl) return new Response('No caption URL', { status: 404 });

		captionUrl = trackUrl.startsWith('http') ? trackUrl : `${invConfig.url}${trackUrl}`;
	}

	// Proxy the caption file
	const captionRes = await fetch(captionUrl, {
		headers,
		signal: AbortSignal.timeout(10_000)
	});

	if (!captionRes.ok) return new Response('Caption fetch failed', { status: captionRes.status });

	const responseHeaders = new Headers();
	const ct = captionRes.headers.get('Content-Type');
	responseHeaders.set('Content-Type', ct ?? 'text/vtt');
	responseHeaders.set('Cache-Control', 'public, max-age=3600');

	return new Response(captionRes.body, {
		status: 200,
		headers: responseHeaders
	});
};

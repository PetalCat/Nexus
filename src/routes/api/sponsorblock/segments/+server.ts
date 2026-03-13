import { json, error } from '@sveltejs/kit';
import { fetchSegments } from '$lib/server/sponsorblock';
import type { RequestHandler } from './$types';

/** GET: Fetch SponsorBlock segments for a video */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401);

	const videoId = url.searchParams.get('videoId');
	if (!videoId) throw error(400, 'videoId required');

	console.log('[SB Server] Fetching segments for videoId:', videoId);
	const segments = await fetchSegments(videoId);
	console.log('[SB Server] Found', segments.length, 'segments');
	return json({ segments });
};

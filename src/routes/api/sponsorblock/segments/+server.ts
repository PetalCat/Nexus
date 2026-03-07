import { json, error } from '@sveltejs/kit';
import { fetchSegments } from '$lib/server/sponsorblock';
import type { RequestHandler } from './$types';

/** GET: Fetch SponsorBlock segments for a video */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401);

	const videoId = url.searchParams.get('videoId');
	if (!videoId) throw error(400, 'videoId required');

	const segments = await fetchSegments(videoId);
	return json({ segments });
};

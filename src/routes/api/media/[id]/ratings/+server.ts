import { json, error } from '@sveltejs/kit';
import { getUserRating, upsertRating, deleteRating, getMediaRatingStats } from '$lib/server/ratings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);
	const service = url.searchParams.get('service');
	if (!service) throw error(400, 'Missing service param');

	const userRating = getUserRating(locals.user.id, params.id, service);
	const stats = await getMediaRatingStats(params.id, service);
	return json({ userRating, stats });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const { service, rating, mediaType, serviceType } = await request.json();
	if (!service || !rating || !mediaType || !serviceType) throw error(400, 'Missing fields');
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw error(400, 'Rating must be 1-5');

	upsertRating(locals.user.id, params.id, service, rating, { mediaType, serviceType });
	const stats = await getMediaRatingStats(params.id, service);
	return json({ userRating: rating, stats });
};

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);
	const service = url.searchParams.get('service');
	const serviceType = url.searchParams.get('serviceType') ?? 'unknown';
	const mediaType = url.searchParams.get('mediaType') ?? 'unknown';
	if (!service) throw error(400, 'Missing service param');

	deleteRating(locals.user.id, params.id, service, { serviceType, mediaType });
	const stats = await getMediaRatingStats(params.id, service);
	return json({ userRating: null, stats });
};

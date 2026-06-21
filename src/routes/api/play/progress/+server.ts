import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertPlaySession, getLatestSession } from '$lib/server/play-sessions';

/**
 * Generic v2 playback-progress reporting → the canonical `play_sessions` store
 * (the same table continue-watching reads). Backend-agnostic: the v2 player
 * reports {backend, itemId, position} as you watch, so "resume where you left
 * off" works across Jellyfin / Invidious / etc.
 *
 * Per the locked account model, progress lives PURELY in Nexus — we do NOT write
 * it back to the backend (the single service cred can't attribute per-user
 * progress). Identity is the Nexus session user.
 *
 * POST { backend, itemId, positionSeconds, durationSeconds?, title?, mediaType?,
 *        isStopped? }
 * GET  ?backend=&itemId=  →  { positionSeconds, progress, completed }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body: {
		backend?: string;
		itemId?: string;
		positionSeconds?: number;
		durationSeconds?: number;
		title?: string;
		mediaType?: string;
		isStopped?: boolean;
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const { backend, itemId } = body;
	if (!backend || !itemId) return json({ error: 'Missing backend or itemId' }, { status: 400 });

	const userId = locals.user.id;
	const pos = body.positionSeconds ?? 0;
	const dur = typeof body.durationSeconds === 'number' && body.durationSeconds > 0 ? body.durationSeconds : null;
	const progress = dur ? Math.min(pos / dur, 1) : null;
	const completed = progress != null && progress >= 0.9;

	upsertPlaySession({
		userId,
		serviceId: backend,
		serviceType: backend,
		mediaId: itemId,
		mediaType: body.mediaType ?? 'video',
		mediaTitle: body.title ?? null,
		// Stable per user×backend×item so successive watches update one row.
		sessionKey: `${backend}:${itemId}:${userId}`,
		progress,
		positionTicks: Math.round(pos * 10_000_000),
		mediaDurationMs: dur ? Math.round(dur * 1000) : null,
		source: 'v2-progress',
		stopped: body.isStopped === true,
		completed
	});

	return json({ ok: true, progress });
};

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const backend = url.searchParams.get('backend');
	const itemId = url.searchParams.get('itemId');
	if (!backend || !itemId) return json({ error: 'Missing backend or itemId' }, { status: 400 });

	const record = getLatestSession(locals.user.id, backend, itemId);
	if (!record) return json({ positionSeconds: 0, progress: 0, completed: false });
	return json({
		positionSeconds: record.position_ticks ? record.position_ticks / 10_000_000 : 0,
		progress: record.progress ?? 0,
		completed: !!record.completed
	});
};

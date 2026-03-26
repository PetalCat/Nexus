import { json } from '@sveltejs/kit';
import { emitInteractionEventsBatch } from '$lib/server/analytics';
import type { RequestHandler } from './$types';

/**
 * POST /api/ingest/interactions
 * Receives batched interaction events from the client-side collector.
 * Body: { events: InteractionEventInput[] }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user?.id;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const events = body.events;
	if (!Array.isArray(events) || events.length === 0) {
		return json({ ok: true, ingested: 0 });
	}

	// Cap batch size to prevent abuse; ignore unauthenticated requests
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const batch = events.slice(0, 500).map((e: any) => ({
		userId,
		sessionToken: e.sessionToken,
		eventType: e.eventType ?? 'unknown',
		page: e.page,
		target: e.target,
		targetTitle: e.targetTitle,
		referrer: e.referrer,
		searchQuery: e.searchQuery,
		position: e.position,
		durationMs: e.durationMs,
		metadata: e.metadata,
		timestamp: e.timestamp
	}));

	const count = emitInteractionEventsBatch(batch);
	return json({ ok: true, ingested: count });
};

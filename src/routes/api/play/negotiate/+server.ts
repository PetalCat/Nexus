import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { BrowserCaps, PlaybackPlan } from '$lib/adapters/playback';
import { registryV2 } from '$lib/adapters/v2';
import { resolveServiceConfig } from '$lib/server/v2-services';

/**
 * POST /api/play/negotiate — adapter-agnostic v2 playback negotiation.
 *
 * Body: { backend, itemId, type?, plan?, caps? }
 *  - looks the adapter up in the v2 registry (by `backend`)
 *  - resolves the single service config for that backend (env shim, Phase-0)
 *  - calls adapter.negotiatePlayback(config, item, plan, caps)
 *  - returns the session JSON (engine, url, mime, mode, levels, subtitleTracks…)
 *
 * The adapter mints a grant and hands back a Nexus-origin `/api/stream-proxy/…`
 * URL — no backend credential ever reaches the browser.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: {
		backend?: string;
		itemId?: string;
		type?: string;
		plan?: PlaybackPlan;
		caps?: BrowserCaps;
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const backend = body.backend;
	const itemId = body.itemId;
	if (!backend || !itemId) {
		return json({ error: 'Missing backend or itemId' }, { status: 400 });
	}

	const adapter = registryV2.get(backend);
	if (!adapter) {
		return json({ error: `Unknown backend "${backend}"` }, { status: 404 });
	}
	if (!adapter.negotiatePlayback) {
		return json({ error: `Backend "${backend}" does not support playback` }, { status: 400 });
	}

	const config = resolveServiceConfig(backend);
	if (!config) {
		return json({ error: `Backend "${backend}" is not configured` }, { status: 404 });
	}

	const plan: PlaybackPlan = body.plan ?? {};
	const caps: BrowserCaps = body.caps ?? {
		videoCodecs: ['avc1.640028'],
		audioCodecs: ['mp4a.40.2'],
		containers: ['mp4', 'ts']
	};

	try {
		const session = await adapter.negotiatePlayback(
			config,
			{ id: itemId, type: body.type ?? 'movie' },
			plan,
			caps,
			{ nexusUserId: locals.user.id }
		);
		// Serialize only the wire-relevant fields (drop changeQuality/close fns).
		return json({
			engine: session.engine,
			kind: session.kind,
			url: session.url,
			mime: session.mime,
			mode: session.mode,
			playSessionId: session.playSessionId,
			mediaSourceId: session.mediaSourceId,
			audioTracks: session.audioTracks,
			subtitleTracks: session.subtitleTracks,
			burnableSubtitleTracks: session.burnableSubtitleTracks,
			activeLevel: session.activeLevel,
			levels: session.levels,
			sourceHeight: session.sourceHeight
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[play/negotiate] error:', msg);
		return json({ error: msg }, { status: 500 });
	}
};

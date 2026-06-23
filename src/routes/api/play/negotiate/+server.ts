import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';
import type { BrowserCaps, PlaybackPlan } from '$lib/adapters/playback';
import { registryV2 } from '$lib/adapters/v2';
import { resolveServiceConfig } from '$lib/server/v2-services';
import { registerSession } from '$lib/server/playback-sessions';

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
	// Coalesce PER FIELD, not just on a missing caps object: a partial caps (e.g.
	// `{}` or one missing videoCodecs) is truthy, so a bare `?? {default}` would
	// pass it straight through and buildDeviceProfile would throw on
	// `caps.videoCodecs.some(...)` (opaque 500). Fill the codec/container arrays
	// the profile builder relies on so the endpoint is robust to partial input.
	const rawCaps = (body.caps ?? {}) as Partial<BrowserCaps>;
	const caps: BrowserCaps = {
		...rawCaps,
		videoCodecs: rawCaps.videoCodecs ?? ['avc1.640028'],
		audioCodecs: rawCaps.audioCodecs ?? ['mp4a.40.2'],
		containers: rawCaps.containers ?? ['mp4', 'ts']
	};

	try {
		const session = await adapter.negotiatePlayback(
			config,
			{ id: itemId, type: body.type ?? 'movie' },
			plan,
			caps,
			{ nexusUserId: locals.user.id }
		);
		// Register a server-side playback session so an abandoned tab gets reaped
		// (the adapter's close handle is captured here — it's dropped from the
		// wire response). The player keepalives this id; silence ⇒ backend stop.
		const playbackSessionId = randomUUID();
		registerSession({
			id: playbackSessionId,
			userId: locals.user.id,
			label: `${backend}:${itemId}`,
			stop: async () => {
				await session.close?.();
			}
		});
		// Serialize only the wire-relevant fields (drop changeQuality/close fns).
		return json({
			playbackSessionId,
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

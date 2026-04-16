import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { negotiate } from '$lib/server/playback';
import type { PlaybackPlan, BrowserCaps } from '$lib/adapters/playback';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: {
		serviceId: string;
		itemId: string;
		plan?: PlaybackPlan;
		caps?: BrowserCaps;
	};

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!body.serviceId || !body.itemId) {
		return json({ error: 'Missing serviceId or itemId' }, { status: 400 });
	}

	const plan: PlaybackPlan = body.plan ?? {};
	const caps: BrowserCaps = body.caps ?? {
		videoCodecs: ['avc1.640028'],
		audioCodecs: ['mp4a.40.2'],
		containers: ['mp4', 'ts'],
	};

	try {
		const session = await negotiate(body.serviceId, body.itemId, plan, caps, locals.user.id);

		return json({
			engine: session.engine,
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
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[play/negotiate] error:', msg);
		return json({ error: msg }, { status: 500 });
	}
};

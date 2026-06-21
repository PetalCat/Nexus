import { json } from '@sveltejs/kit';
import { getServiceConfig } from '$lib/server/services';
import { arrWebhookToken, markRequestsAvailable, verifyArrWebhookToken } from '$lib/server/media-requests';
import { invalidatePrefix } from '$lib/server/cache';
import type { RequestHandler } from './$types';

/**
 * POST /api/webhooks/arr/[serviceId]?token=<hmac>
 *
 * Receives Radarr/Sonarr webhooks (Connect → Webhook). Unauthenticated (the *arr
 * can't send auth headers), so a high-entropy HMAC token in the query/header is
 * the credential — the serviceId alone is NOT secret (it's a short client-chosen
 * id). Get the token from GET /api/webhooks/arr/[serviceId] (admin). On an import
 * event we match the payload's movie.tmdbId / series.tvdbId to a native
 * media_requests row and mark it available (fires a `request_available` notice).
 *
 * Payload shapes vary across Radarr/Sonarr versions and event types, so this is
 * deliberately defensive — it pulls ids from several possible locations.
 */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const serviceId = params.serviceId;
	const config = getServiceConfig(serviceId);
	if (!config) return json({ error: 'Not found' }, { status: 404 });
	if (config.type !== 'radarr' && config.type !== 'sonarr') {
		return json({ error: 'Not an arr service' }, { status: 404 });
	}
	// Require the per-service HMAC token (query param or header). Constant-time.
	const token = url.searchParams.get('token') ?? request.headers.get('x-webhook-token');
	if (!verifyArrWebhookToken(serviceId, token)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let payload: any;
	try {
		payload = await request.json();
	} catch {
		return json({ ok: true, note: 'no JSON body' });
	}

	const eventType: string = payload?.eventType ?? payload?.EventType ?? '';

	// Test pings from the arr "Test" button — acknowledge without acting.
	if (eventType === 'Test' || eventType === 'test') {
		return json({ ok: true, test: true });
	}

	// We act on events that indicate the media is (becoming) available. "Download"
	// is Radarr/Sonarr's import-complete event; "Grab" means a release was sent to
	// the client (treated as in-progress but we still flip to available defensively
	// only on Download/import). Keep the set small + explicit.
	const availableEvents = new Set(['Download', 'MovieFileImported', 'EpisodeFileImported', 'SeriesImport']);
	const isAvailable = availableEvents.has(eventType);

	if (!isAvailable) {
		// Acknowledge other events (Grab, Rename, HealthIssue, etc.) without acting.
		return json({ ok: true, ignored: eventType || 'unknown' });
	}

	const isMovie = config.type === 'radarr';
	const mediaType: 'movie' | 'tv' = isMovie ? 'movie' : 'tv';

	// Defensive id extraction across payload variants.
	const movie = payload?.movie ?? payload?.Movie ?? {};
	const series = payload?.series ?? payload?.Series ?? {};

	const tmdbId: number | null = isMovie
		? toInt(movie.tmdbId ?? movie.tmdbid ?? payload?.remoteMovie?.tmdbId)
		: toInt(series.tmdbId ?? series.tmdbid);
	const tvdbId: number | null = isMovie
		? null
		: toInt(series.tvdbId ?? series.tvdbid ?? payload?.remoteSeries?.tvdbId);
	const arrItemId: number | null = isMovie ? toInt(movie.id) : toInt(series.id);

	const updated = markRequestsAvailable({
		mediaType,
		tmdbId,
		tvdbId,
		arrServiceId: serviceId,
		arrItemId
	});

	if (updated.length > 0) {
		invalidatePrefix('api-requests:');
		invalidatePrefix('requests:');
	}

	return json({ ok: true, matched: updated.length });
};

/**
 * GET /api/webhooks/arr/[serviceId] (admin only) — returns the full webhook URL
 * (with the HMAC token) for the admin to paste into Radarr/Sonarr's Connect →
 * Webhook settings. Never exposed to non-admins (the token is a credential).
 */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });
	const serviceId = params.serviceId;
	const config = getServiceConfig(serviceId);
	if (!config || (config.type !== 'radarr' && config.type !== 'sonarr')) {
		return json({ error: 'Not found' }, { status: 404 });
	}
	const token = arrWebhookToken(serviceId);
	const webhookUrl = `${url.origin}/api/webhooks/arr/${encodeURIComponent(serviceId)}?token=${token}`;
	return json({ serviceId, webhookUrl });
};

function toInt(v: unknown): number | null {
	if (v == null) return null;
	const n = typeof v === 'number' ? v : parseInt(String(v), 10);
	return Number.isFinite(n) ? n : null;
}

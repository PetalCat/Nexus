import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { invalidatePrefix } from '$lib/server/cache';
import { upsertPlaySession } from '$lib/server/play-sessions';
import type { RequestHandler } from './$types';

/**
 * Progress reporting endpoint — syncs playback position back to Jellyfin and
 * records a canonical `play_sessions` row for Nexus-side resume/history.
 *
 * POST /api/stream/{serviceId}/progress
 * Body: { itemId, positionTicks, isPaused, isStopped?, isMuted?, volumeLevel? }
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const { serviceId } = params;
	const config = getServiceConfig(serviceId);
	if (!config) return new Response('Service not found', { status: 404 });

	const adapter = registry.get(config.type);
	const userCred =
		locals.user?.id && adapter?.userLinkable
			? getUserCredentialForService(locals.user.id, serviceId) ?? undefined
			: undefined;

	const token = userCred?.accessToken ?? config.apiKey ?? '';
	if (!token) return new Response('No auth token', { status: 401 });

	let body: any;
	try {
		body = await request.json();
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	const { itemId, positionTicks, isPaused, isStopped, isStart, isMuted, volumeLevel } = body;
	if (!itemId) return new Response('Missing itemId', { status: 400 });

	// Resolve userId
	let externalUserId = userCred?.externalUserId ?? '';
	if (!externalUserId && token) {
		try {
			const meRes = await fetch(`${config.url}/Users/Me`, {
				headers: {
					Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0", Token="${token}"`,
					'X-Emby-Token': token
				},
				signal: AbortSignal.timeout(5000)
			});
			if (meRes.ok) {
				const me = await meRes.json();
				externalUserId = me?.Id ?? '';
			}
		} catch { /* ignore */ }
	}
	if (!externalUserId && config.apiKey) {
		try {
			const usersRes = await fetch(`${config.url}/Users`, {
				headers: { 'X-Emby-Token': config.apiKey },
				signal: AbortSignal.timeout(5000)
			});
			if (usersRes.ok) {
				const users = await usersRes.json();
				const list = Array.isArray(users) ? users : (users.Items ?? []);
				const admin = list.find((u: any) => u.Policy?.IsAdministrator);
				externalUserId = (admin ?? list[0])?.Id ?? '';
			}
		} catch { /* ignore */ }
	}

	const headers: Record<string, string> = {
		Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0", Token="${token}"`,
		'X-Emby-Token': token,
		'Content-Type': 'application/json'
	};

	const jellyfinBody: Record<string, any> = {
		ItemId: itemId,
		MediaSourceId: itemId,
		PositionTicks: positionTicks ?? 0,
		IsPaused: isPaused ?? false,
		IsMuted: isMuted ?? false,
		VolumeLevel: volumeLevel ?? 100,
		PlayMethod: 'Transcode',
		RepeatMode: 'RepeatNone'
	};

	// Media type classification: prefer what the client tells us (the player
	// knows whether it's a movie / episode / video). If absent, fetch the
	// item's Type from Jellyfin and map. Only fall back to 'movie' when we
	// genuinely can't know — avoids poisoning play_sessions with wrong type.
	// Codex-audit followup (P2): was previously hardcoded 'movie'.
	let resolvedMediaType: string = typeof body.mediaType === 'string' ? body.mediaType : '';
	if (!resolvedMediaType && token && externalUserId) {
		try {
			const itemRes = await fetch(
				`${config.url}/Users/${externalUserId}/Items/${itemId}`,
				{ headers, signal: AbortSignal.timeout(3000) }
			);
			if (itemRes.ok) {
				const itemBody = await itemRes.json();
				const jfType = itemBody?.Type;
				const TYPE_MAP: Record<string, string> = {
					Movie: 'movie',
					Episode: 'episode',
					Series: 'show',
					Audio: 'music',
					MusicAlbum: 'album',
					Video: 'video',
					Book: 'book'
				};
				if (jfType && TYPE_MAP[jfType]) resolvedMediaType = TYPE_MAP[jfType];
			}
		} catch { /* ignore — fall through to fallback */ }
	}
	if (!resolvedMediaType) resolvedMediaType = 'movie';

	try {
		// Canonical Nexus-side record for resume/history/insights.
		if (locals.user?.id) {
			const durationTicks = typeof body.durationTicks === 'number' ? body.durationTicks : 0;
			const progress = durationTicks > 0
				? Math.max(0, Math.min((positionTicks ?? 0) / durationTicks, 1))
				: null;
			const mediaDurationMs = durationTicks > 0 ? Math.round(durationTicks / 10_000) : null;
			upsertPlaySession({
				userId: locals.user.id,
				serviceId,
				serviceType: config.type,
				mediaId: String(itemId),
				mediaType: resolvedMediaType,
				sessionKey: `${config.type}:${serviceId}:${itemId}:${locals.user.id}`,
				progress,
				positionTicks: typeof positionTicks === 'number' ? positionTicks : null,
				mediaDurationMs,
				source: config.type === 'plex' ? 'plex-progress' : 'jellyfin-progress',
				stopped: isStopped === true,
				completed: progress != null && progress >= 0.9
			});
		}

		if (isStopped) {
			// Report playback stopped
			await fetch(`${config.url}/Sessions/Playing/Stopped`, {
				method: 'POST',
				headers,
				body: JSON.stringify(jellyfinBody),
				signal: AbortSignal.timeout(5000)
			});
		} else if (isStart) {
			// Report playback start (explicit flag, works for resume too)
			await fetch(`${config.url}/Sessions/Playing`, {
				method: 'POST',
				headers,
				body: JSON.stringify(jellyfinBody),
				signal: AbortSignal.timeout(5000)
			});
		} else {
			// Report progress
			await fetch(`${config.url}/Sessions/Playing/Progress`, {
				method: 'POST',
				headers,
				body: JSON.stringify(jellyfinBody),
				signal: AbortSignal.timeout(5000)
			});
		}

		// Invalidate resume/continue caches whenever progress changes.
		if (locals.user?.id) {
			invalidatePrefix(`cw:${locals.user.id}`);
			invalidatePrefix(`activity:${locals.user.id}`);
		}

		return new Response('OK', { status: 200 });
	} catch (e) {
		console.error('[progress] Failed to report to Jellyfin:', e);
		return new Response('Failed', { status: 502 });
	}
};

import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { invalidatePrefix } from '$lib/server/cache';
import { emitMediaEvent } from '$lib/server/analytics';
import type { RequestHandler } from './$types';

/**
 * Progress reporting endpoint — syncs playback position back to Jellyfin.
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
	let userId = userCred?.externalUserId ?? '';
	if (!userId && config.apiKey) {
		try {
			const usersRes = await fetch(`${config.url}/Users`, {
				headers: { 'X-Emby-Token': config.apiKey },
				signal: AbortSignal.timeout(5000)
			});
			if (usersRes.ok) {
				const users = await usersRes.json();
				const list = Array.isArray(users) ? users : (users.Items ?? []);
				const admin = list.find((u: any) => u.Policy?.IsAdministrator);
				userId = (admin ?? list[0])?.Id ?? '';
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

	try {
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

		// Emit analytics event
		if (locals.user?.id) {
			const eventType = isStopped ? 'play_stop' : isStart ? 'play_start' : 'progress';
			emitMediaEvent({
				userId: locals.user.id,
				serviceId,
				serviceType: config.type,
				eventType,
				mediaId: itemId,
				mediaType: body.mediaType ?? 'movie',
				mediaTitle: body.mediaTitle,
				parentId: body.parentId,
				parentTitle: body.parentTitle,
				positionTicks: positionTicks ?? 0,
				durationTicks: body.durationTicks,
				deviceName: body.deviceName,
				clientName: body.clientName,
				metadata: body.playbackMetadata
			});
		}

		// Invalidate continue-watching caches when playback stops
		if (isStopped && locals.user?.id) {
			invalidatePrefix(`cw:${locals.user.id}`);
			invalidatePrefix(`activity:${locals.user.id}`);
		}

		return new Response('OK', { status: 200 });
	} catch (e) {
		console.error('[progress] Failed to report to Jellyfin:', e);
		return new Response('Failed', { status: 502 });
	}
};

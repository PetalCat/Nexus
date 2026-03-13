import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { invalidatePrefix } from '$lib/server/cache';
import { getDb } from '$lib/db';
import { activity } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
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
	if (!userId && token) {
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
				userId = me?.Id ?? '';
			}
		} catch { /* ignore */ }
	}
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
		// Keep a local activity record as a resume fallback for Nexus.
		if (locals.user?.id) {
			const db = getDb();
			const progress = body.durationTicks && body.durationTicks > 0
				? Math.max(0, Math.min((positionTicks ?? 0) / body.durationTicks, 1))
				: 0;
			const isComplete = progress >= 0.9;
			const existing = db
				.select()
				.from(activity)
				.where(
					and(
						eq(activity.userId, locals.user.id),
						eq(activity.mediaId, itemId),
						eq(activity.serviceId, serviceId)
					)
				)
				.get();

			if (existing) {
				db.update(activity)
					.set({
						progress,
						positionTicks: positionTicks ?? 0,
						completed: isComplete,
						lastActivity: new Date().toISOString()
					})
					.where(eq(activity.id, existing.id))
					.run();
			} else {
				db.insert(activity)
					.values({
						userId: locals.user.id,
						mediaId: itemId,
						serviceId,
						type: 'watch',
						progress,
						positionTicks: positionTicks ?? 0,
						completed: isComplete,
						lastActivity: new Date().toISOString()
					})
					.run();
			}
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

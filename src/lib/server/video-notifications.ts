import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { createNotificationIfEnabled } from './notifications';
import { getEnabledConfigs } from './services';
import { getUserCredentialForService } from './auth';
import { getChannelVideos, normalizeVideo } from '../adapters/invidious';

// ── CRUD ────────────────────────────────────────────────────────

/** Check if a user has notifications enabled for a channel */
export function isChannelNotifyEnabled(userId: string, channelId: string): boolean {
	const db = getDb();
	const row = db
		.select({ enabled: schema.videoSubNotifications.enabled })
		.from(schema.videoSubNotifications)
		.where(and(
			eq(schema.videoSubNotifications.userId, userId),
			eq(schema.videoSubNotifications.channelId, channelId)
		))
		.get();
	return row?.enabled ?? false;
}

/** Enable notifications for a channel subscription */
export function enableChannelNotify(userId: string, channelId: string, channelName: string): void {
	const db = getDb();
	const now = Date.now();
	db.run(
		sql`INSERT INTO video_sub_notifications (user_id, channel_id, channel_name, enabled, created_at, updated_at)
			VALUES (${userId}, ${channelId}, ${channelName}, 1, ${now}, ${now})
			ON CONFLICT(user_id, channel_id)
			DO UPDATE SET enabled = 1, channel_name = ${channelName}, updated_at = ${now}`
	);
}

/** Disable notifications for a channel subscription */
export function disableChannelNotify(userId: string, channelId: string): void {
	const db = getDb();
	db.run(
		sql`UPDATE video_sub_notifications SET enabled = 0, updated_at = ${Date.now()}
			WHERE user_id = ${userId} AND channel_id = ${channelId}`
	);
}

/** Remove notification entry entirely (used when unsubscribing) */
export function removeChannelNotify(userId: string, channelId: string): void {
	const db = getDb();
	db.delete(schema.videoSubNotifications)
		.where(and(
			eq(schema.videoSubNotifications.userId, userId),
			eq(schema.videoSubNotifications.channelId, channelId)
		))
		.run();
}

/** Get all channels with notifications enabled (for polling) */
export function getAllEnabledChannelNotifications(): Array<{
	userId: string;
	channelId: string;
	channelName: string;
	lastCheckedVideoId: string | null;
}> {
	const db = getDb();
	return db
		.select({
			userId: schema.videoSubNotifications.userId,
			channelId: schema.videoSubNotifications.channelId,
			channelName: schema.videoSubNotifications.channelName,
			lastCheckedVideoId: schema.videoSubNotifications.lastCheckedVideoId
		})
		.from(schema.videoSubNotifications)
		.where(eq(schema.videoSubNotifications.enabled, true))
		.all();
}

/** Update the last checked video ID for a user+channel */
function updateLastChecked(userId: string, channelId: string, videoId: string): void {
	const db = getDb();
	db.run(
		sql`UPDATE video_sub_notifications
			SET last_checked_video_id = ${videoId}, updated_at = ${Date.now()}
			WHERE user_id = ${userId} AND channel_id = ${channelId}`
	);
}

// ── Poller ──────────────────────────────────────────────────────

let pollInterval: ReturnType<typeof setInterval> | null = null;

const POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes

async function pollSubscriptionUploads() {
	const configs = getEnabledConfigs().filter((c) => c.type === 'invidious');
	if (configs.length === 0) return;
	const config = configs[0];

	const entries = getAllEnabledChannelNotifications();
	if (entries.length === 0) return;

	// Group by channelId to avoid fetching the same channel multiple times
	const channelMap = new Map<string, typeof entries>();
	for (const entry of entries) {
		const list = channelMap.get(entry.channelId) ?? [];
		list.push(entry);
		channelMap.set(entry.channelId, list);
	}

	for (const [channelId, subscribers] of channelMap) {
		try {
			const videosRes = await getChannelVideos(config, channelId, 'newest');
			const videos = videosRes.videos ?? [];
			if (videos.length === 0) continue;

			const latestVideo = videos[0];
			const latestVideoId = latestVideo.videoId;
			const normalized = normalizeVideo(config, latestVideo);

			for (const sub of subscribers) {
				// First time — just seed the last checked ID, don't notify
				if (!sub.lastCheckedVideoId) {
					updateLastChecked(sub.userId, channelId, latestVideoId);
					continue;
				}

				// No new video since last check
				if (sub.lastCheckedVideoId === latestVideoId) continue;

				// Find all new videos since last checked
				const newVideos = [];
				for (const v of videos) {
					if (v.videoId === sub.lastCheckedVideoId) break;
					newVideos.push(v);
				}

				if (newVideos.length === 0) {
					// lastCheckedVideoId might have been removed — just update
					updateLastChecked(sub.userId, channelId, latestVideoId);
					continue;
				}

				// Create notifications for new uploads (max 3 to avoid spam)
				for (const v of newVideos.slice(0, 3)) {
					const norm = normalizeVideo(config, v);
					createNotificationIfEnabled({
						userId: sub.userId,
						type: 'video_subscription',
						title: `${sub.channelName} uploaded a new video`,
						message: norm.title,
						href: `/media/video/${v.videoId}?service=${config.id}`,
						metadata: {
							channelId,
							channelName: sub.channelName,
							videoId: v.videoId,
							thumbnail: norm.poster
						}
					});
				}

				if (newVideos.length > 3) {
					createNotificationIfEnabled({
						userId: sub.userId,
						type: 'video_subscription',
						title: `${sub.channelName} uploaded ${newVideos.length} new videos`,
						href: `/videos/channel/${channelId}`,
						metadata: { channelId, channelName: sub.channelName, count: newVideos.length }
					});
				}

				updateLastChecked(sub.userId, channelId, latestVideoId);
			}
		} catch {
			// Silent — channel might be unreachable temporarily
		}

		// Small delay between channels to avoid hammering the Invidious instance
		await new Promise((r) => setTimeout(r, 500));
	}
}

export function startVideoNotificationPoller() {
	if (pollInterval) return;
	// Initial poll after 2 minutes (let the server settle)
	setTimeout(() => {
		pollSubscriptionUploads();
		pollInterval = setInterval(pollSubscriptionUploads, POLL_INTERVAL);
	}, 2 * 60 * 1000);
}

export function stopVideoNotificationPoller() {
	if (pollInterval) {
		clearInterval(pollInterval);
		pollInterval = null;
	}
}

import { getRawDb, getDb, schema } from '$lib/db';
import { getServiceConfig } from '$lib/server/services';
import { resolveHistoryPoster } from '$lib/server/history-thumbnails';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	const raw = getRawDb();
	const rows = raw.prepare(`
		SELECT id, user_id as userId, service_id as serviceId, service_type as serviceType,
		       media_id as mediaId, media_type as mediaType, media_title as mediaTitle,
		       started_at as timestamp, duration_ms as durationMs,
		       media_duration_ms as mediaDurationMs, progress, completed,
		       device_name as deviceName, client_name as clientName
		FROM play_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 50 OFFSET 0
	`).all(userId) as any[];

	const totalRow = raw.prepare(
		`SELECT COUNT(*) as count FROM play_sessions WHERE user_id = ?`
	).get(userId) as { count: number };
	const total = totalRow.count;

	const db = getDb();
	const serviceRows = db
		.select({ id: schema.services.id, name: schema.services.name, type: schema.services.type })
		.from(schema.services)
		.all();
	const services = serviceRows.map((s) => ({ id: s.id, name: s.name, type: s.type }));

	// Resolve a poster URL per event using the owning service's type.
	// Jellyfin/Plex images are public via the server URL; Invidious videos use
	// ytimg CDN; Calibre/RomM covers are auth-gated and go through the Nexus
	// image proxy. Anything else returns null (the view shows a color block).
	const events = rows.map((e) => ({
		...e,
		poster: resolveHistoryPoster({
			serviceId: e.serviceId,
			serviceType: e.serviceType,
			mediaId: e.mediaId,
			mediaType: e.mediaType,
			serviceUrl: getServiceConfig(e.serviceId)?.url
		})
	}));

	return { events, total, services };
};

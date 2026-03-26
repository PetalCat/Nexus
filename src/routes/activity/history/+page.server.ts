import { getRawDb, getDb, schema } from '$lib/db';
import { getServiceConfig } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	const raw = getRawDb();
	const events = raw.prepare(`
		SELECT id, user_id as userId, service_id as serviceId, media_id as mediaId,
		       media_type as mediaType, media_title as mediaTitle, started_at as timestamp,
		       duration_ms as durationMs, media_duration_ms as mediaDurationMs, progress,
		       completed, device_name as deviceName, client_name as clientName
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

	// Build service URL map for poster thumbnails (Jellyfin images are public)
	const serviceUrls: Record<string, string> = {};
	for (const s of serviceRows) {
		const config = getServiceConfig(s.id);
		if (config?.url) serviceUrls[s.id] = config.url;
	}

	return { events, total, services, serviceUrls };
};

import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import { getConnectedUserCount, getOnlineUserIds } from '$lib/server/ws';
import { existsSync, statSync } from 'fs';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/system
 * System info: DB file size, table row counts, WS connections, etc.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const db = getRawDb();
	const dbPath = process.env.DATABASE_URL || './nexus.db';

	// DB file size
	let dbSizeBytes = 0;
	try {
		if (existsSync(dbPath)) dbSizeBytes = statSync(dbPath).size;
	} catch { /* ignore */ }

	// Row counts for key tables. The legacy `activity` table was dropped on
	// 2026-04-17 (migration 0008); `play_sessions` is the canonical progress
	// store and is already listed below.
	const tables = ['users', 'media_items', 'play_sessions', 'media_actions', 'interaction_events', 'services', 'sessions', 'stats_rollups'];
	const rowCounts: Record<string, number> = {};
	for (const t of tables) {
		try {
			const row = db.prepare(`SELECT COUNT(*) as count FROM ${t}`).get() as any;
			rowCounts[t] = row?.count ?? 0;
		} catch {
			rowCounts[t] = 0;
		}
	}

	// WebSocket info
	const onlineUserIds = [...getOnlineUserIds()];

	// App settings
	let appSettings: Record<string, string> = {};
	try {
		const rows = db.prepare(`SELECT key, value FROM app_settings`).all() as { key: string; value: string }[];
		appSettings = Object.fromEntries(rows.map(r => [r.key, r.value]));
	} catch { /* ignore */ }

	return json({
		db: { path: dbPath, sizeBytes: dbSizeBytes, rowCounts },
		ws: { connectedUsers: getConnectedUserCount(), onlineUserIds },
		appSettings
	});
};

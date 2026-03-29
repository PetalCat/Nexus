import { getRawDb } from '$lib/db';
import { getEnabledConfigs } from './services';
import { registry } from '$lib/adapters/registry';
import type { SyncItem } from '$lib/adapters/types';

// ---------------------------------------------------------------------------
// Media Items Sync
//
// Populates the media_items table from library data via adapter syncLibraryItems.
// This enables content-based and time-aware recommendation providers.
// Runs on startup and periodically via rec-scheduler.
// ---------------------------------------------------------------------------

function upsertSyncItems(serviceId: string, serviceType: string, items: SyncItem[]) {
	const raw = getRawDb();
	const stmt = raw.prepare(
		`INSERT INTO media_items (id, source_id, service_id, type, title, sort_title, description, poster, backdrop, year, rating, genres, studios, duration, status, cached_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', datetime('now'))
		 ON CONFLICT(id) DO UPDATE SET
		   title = excluded.title,
		   description = excluded.description,
		   poster = excluded.poster,
		   backdrop = excluded.backdrop,
		   year = excluded.year,
		   rating = excluded.rating,
		   genres = excluded.genres,
		   studios = excluded.studios,
		   duration = excluded.duration,
		   cached_at = excluded.cached_at`
	);

	const tx = raw.transaction(() => {
		for (const item of items) {
			stmt.run(
				`${item.sourceId}:${serviceId}`,
				item.sourceId,
				serviceId,
				item.mediaType,
				item.title,
				item.sortTitle ?? null,
				null, // description not on SyncItem (kept lean)
				item.poster ?? null,
				item.backdrop ?? null,
				item.year ?? null,
				item.rating ?? null,
				item.genres ? JSON.stringify(item.genres) : null,
				null, // studios not on SyncItem
				item.duration ?? null
			);
		}
	});

	tx();
}

/** Sync all library items from adapters that implement syncLibraryItems */
export async function syncMediaItems(): Promise<number> {
	const configs = getEnabledConfigs();
	let totalSynced = 0;

	for (const config of configs) {
		const adapter = registry.get(config.type);
		if (!adapter?.syncLibraryItems) continue;

		try {
			console.log(`[media-sync] Syncing from ${config.name ?? config.id}...`);
			const items = await adapter.syncLibraryItems(config);
			upsertSyncItems(config.id, config.type, items);
			totalSynced += items.length;
			console.log(`[media-sync] Synced ${items.length} items from ${config.name ?? config.id}`);
		} catch (e) {
			console.error(`[media-sync] ${config.type} error:`, e instanceof Error ? e.message : e);
		}
	}

	return totalSynced;
}

/** Quick check: are media_items populated? */
export function hasMediaItems(): boolean {
	const raw = getRawDb();
	const row = raw.prepare('SELECT COUNT(*) as c FROM media_items').get() as { c: number };
	return row.c > 0;
}

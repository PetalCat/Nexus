import { getRawDb } from '$lib/db';
import { getEnabledConfigs } from './services';
import type { ServiceConfig } from '$lib/adapters/types';

// ---------------------------------------------------------------------------
// Media Items Sync
//
// Populates the media_items table from Jellyfin library data.
// This enables content-based and time-aware recommendation providers.
// Runs on startup and periodically via rec-scheduler.
// ---------------------------------------------------------------------------

const BATCH_SIZE = 200;
const SYNC_TIMEOUT = 30_000;

interface JellyfinItem {
	Id: string;
	Name: string;
	SortName?: string;
	Overview?: string;
	ProductionYear?: number;
	CommunityRating?: number;
	Genres?: string[];
	Studios?: Array<{ Name: string }>;
	RunTimeTicks?: number;
	Type: string;
	ImageTags?: Record<string, string>;
	BackdropImageTags?: string[];
	Status?: string;
}

function jellyfinTypeToLocal(type: string): string | null {
	switch (type) {
		case 'Movie': return 'movie';
		case 'Series': return 'show';
		case 'MusicAlbum': return 'album';
		case 'Audio': return 'music';
		default: return null;
	}
}

async function fetchJellyfinItems(
	config: ServiceConfig,
	includeTypes: string,
	offset: number,
	limit: number
): Promise<{ items: JellyfinItem[]; total: number }> {
	const url = new URL(`${config.url}/Items`);
	url.searchParams.set('IncludeItemTypes', includeTypes);
	url.searchParams.set('Recursive', 'true');
	url.searchParams.set('SortBy', 'DateCreated');
	url.searchParams.set('SortOrder', 'Descending');
	url.searchParams.set('Limit', String(limit));
	url.searchParams.set('StartIndex', String(offset));
	url.searchParams.set('Fields', 'Overview,Genres,Studios,BackdropImageTags,ImageTags');
	url.searchParams.set('EnableImages', 'true');

	const headers: Record<string, string> = {
		Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0", Token="${config.apiKey ?? ''}"`,
		'X-Emby-Token': config.apiKey ?? ''
	};

	const res = await fetch(url.toString(), {
		headers,
		signal: AbortSignal.timeout(SYNC_TIMEOUT)
	});
	if (!res.ok) throw new Error(`Jellyfin Items → ${res.status}`);
	const data = await res.json();
	return {
		items: data.Items ?? [],
		total: data.TotalRecordCount ?? 0
	};
}

function upsertMediaItems(config: ServiceConfig, items: JellyfinItem[]) {
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
			const localType = jellyfinTypeToLocal(item.Type);
			if (!localType) continue;

			const hasPoster = item.ImageTags?.Primary;
			const hasBackdrop = item.BackdropImageTags && item.BackdropImageTags.length > 0;

			stmt.run(
				`${item.Id}:${config.id}`,
				item.Id,
				config.id,
				localType,
				item.Name,
				item.SortName ?? null,
				item.Overview ?? null,
				hasPoster ? `${config.url}/Items/${item.Id}/Images/Primary?quality=90&maxWidth=600` : null,
				hasBackdrop ? `${config.url}/Items/${item.Id}/Images/Backdrop/0?quality=90&maxWidth=1920` : null,
				item.ProductionYear ?? null,
				item.CommunityRating ?? null,
				item.Genres ? JSON.stringify(item.Genres) : null,
				item.Studios ? JSON.stringify(item.Studios.map(s => s.Name)) : null,
				item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : null
			);
		}
	});

	tx();
}

/** Sync all Jellyfin library items into media_items table */
export async function syncMediaItems(): Promise<number> {
	const configs = getEnabledConfigs().filter(c => c.type === 'jellyfin');
	if (configs.length === 0) {
		console.log('[media-sync] No Jellyfin services configured');
		return 0;
	}

	let totalSynced = 0;

	for (const config of configs) {
		try {
			console.log(`[media-sync] Syncing from ${config.name ?? config.id}...`);

			// Fetch movies and series (the types recommendation engine cares about)
			for (const includeType of ['Movie', 'Series']) {
				let offset = 0;
				let total = Infinity;

				while (offset < total) {
					const result = await fetchJellyfinItems(config, includeType, offset, BATCH_SIZE);
					total = result.total;

					if (result.items.length === 0) break;

					upsertMediaItems(config, result.items);
					totalSynced += result.items.length;
					offset += result.items.length;
				}
			}

			console.log(`[media-sync] Synced ${totalSynced} items from ${config.name ?? config.id}`);
		} catch (e) {
			console.error(`[media-sync] Error syncing ${config.id}:`, e);
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

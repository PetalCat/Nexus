import { getLibraryItems, getConfigsForMediaType } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { getPlatforms } from '$lib/adapters/romm';
import { getUserCredentialForService } from '$lib/server/auth';
import { getDb, schema } from '$lib/db';
import { and, eq, desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const sortBy = url.searchParams.get('sort') || 'title';
	const platformParam = url.searchParams.get('platform');
	const platformId = platformParam ? Number(platformParam) : undefined;
	const userId = locals.user?.id;

	const rommConfigs = getConfigsForMediaType('game');
	const hasGameService = rommConfigs.length > 0;

	// Resolve user credentials for each RomM instance
	const rommCreds = rommConfigs.map((c) =>
		userId ? getUserCredentialForService(userId, c.id) ?? undefined : undefined
	);

	const adapter = registry.get('romm');

	const [libraryResult, ...platformResults] = await Promise.all([
		getLibraryItems({ type: 'game', sortBy, limit: 200, platformId }, userId),
		...rommConfigs.map((c, i) => getPlatforms(c, rommCreds[i]))
	]);

	const platforms = platformResults.flat();

	let collections: { id: number; name: string; description?: string; romIds: number[] }[] = [];
	try {
		const allCollections = await Promise.all(
			rommConfigs.map((c, i) => adapter?.getSubItems?.(c, '', 'collection', {}, rommCreds[i]).then(r => r?.items ?? []) ?? Promise.resolve([]))
		);
		collections = allCollections.flat().map((c: any) => ({
			id: c.id,
			name: c.name,
			description: c.description,
			romIds: c.roms ?? []
		}));
	} catch { /* ignore */ }

	// Enrich items with per-user session state (same pattern as books). RomM's
	// `userStatus` stays as an advisory hint but Continue Playing is driven by
	// play_sessions now.
	if (userId) {
		const db = getDb();
		const gameSessions = db.select({
			mediaId: schema.playSessions.mediaId,
			serviceId: schema.playSessions.serviceId,
			updatedAt: schema.playSessions.updatedAt,
			endedAt: schema.playSessions.endedAt,
			completed: schema.playSessions.completed
		})
			.from(schema.playSessions)
			.where(and(
				eq(schema.playSessions.userId, userId),
				eq(schema.playSessions.mediaType, 'game')
			))
			.orderBy(desc(schema.playSessions.updatedAt))
			.all();
		const latestBySource = new Map<string, typeof gameSessions[number]>();
		for (const row of gameSessions) {
			const key = `${row.serviceId}:${row.mediaId}`;
			if (!latestBySource.has(key)) latestBySource.set(key, row);
		}
		for (const item of libraryResult.items) {
			const s = latestBySource.get(`${item.serviceId}:${item.sourceId}`);
			if (!s) continue;
			item.metadata = {
				...(item.metadata ?? {}),
				lastPlayedAtMs: s.updatedAt,
				sessionOpen: s.endedAt == null,
				sessionCompleted: !!s.completed
			};
		}
	}

	return {
		items: libraryResult.items,
		total: libraryResult.total,
		sortBy,
		hasGameService,
		platforms,
		selectedPlatform: platformId ?? null,
		collections
	};
};

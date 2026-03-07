import { error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getServiceConfig, getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getSeasons as getJellyfinSeasons } from '$lib/adapters/jellyfin';
import { getSubtitleStatus, getItemSubtitleHistory } from '$lib/adapters/bazarr';
import { getRomSaves, getRomStates, getRomScreenshots } from '$lib/adapters/romm';
import { isPlayableInBrowser } from '$lib/emulator/cores';
import { getRelatedBooks, getCalibreBookFormats } from '$lib/adapters/calibre';
import { emitMediaEvent } from '$lib/server/analytics';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { JellyfinSeason } from '$lib/adapters/jellyfin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const userId = locals.user?.id;
	let serviceId = url.searchParams.get('service');

	// ── Resolve service & fetch item ────────────────────────────────────
	let item: UnifiedMedia | null = null;
	let resolvedServiceId = serviceId;
	let resolvedServiceType = '';

	if (serviceId) {
		// Explicit service — direct fetch
		const config = getServiceConfig(serviceId);
		if (!config) throw error(404, 'Service not found');

		const adapter = registry.get(config.type);
		if (!adapter?.getItem) throw error(501, 'This service does not support item detail');

		resolvedServiceType = config.type;
		const userCred = userId && adapter.userLinkable
			? getUserCredentialForService(userId, serviceId) ?? undefined
			: undefined;

		// For Overseerr, prefix sourceId with media type so adapter knows which TMDB endpoint
		const sourceId = config.type === 'overseerr'
			? `${params.type === 'show' ? 'tv' : params.type}:${params.id}`
			: params.id;

		item = await adapter.getItem(config, sourceId, userCred);
	} else {
		// No service specified — try all enabled services that support getItem
		const configs = getEnabledConfigs();
		for (const config of configs) {
			const adapter = registry.get(config.type);
			if (!adapter?.getItem) continue;

			const userCred = userId && adapter.userLinkable
				? getUserCredentialForService(userId, config.id) ?? undefined
				: undefined;

			try {
				const result = await adapter.getItem(config, params.id, userCred);
				if (result) {
					item = result;
					resolvedServiceId = config.id;
					resolvedServiceType = config.type;
					break;
				}
			} catch { /* try next service */ }
		}
	}

	if (!item) throw error(404, 'Item not found');

	// ── Bazarr subtitle enrichment ─────────────────────────────────────
	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length > 0 && item) {
		const bazarrConfig = bazarrConfigs[0];
		const tmdbId = item.metadata?.tmdbId as string | undefined;
		const radarrId = item.metadata?.radarrId as string | undefined;
		const sonarrId = item.metadata?.sonarrId as string | undefined;

		if (tmdbId || radarrId || sonarrId) {
			try {
				const [subtitleStatus, subtitleHistory] = await Promise.all([
					getSubtitleStatus(bazarrConfig, tmdbId, {
						radarrId,
						sonarrId,
						type: item.type === 'show' || item.type === 'episode' ? 'show' : 'movie'
					}),
					getItemSubtitleHistory(bazarrConfig, tmdbId, {
						radarrId,
						sonarrId,
						type: item.type === 'show' || item.type === 'episode' ? 'show' : 'movie'
					})
				]);

				if (subtitleStatus) {
					item.metadata = {
						...item.metadata,
						subtitles: {
							available: subtitleStatus.available,
							missing: subtitleStatus.missing,
							wanted: subtitleStatus.wanted,
							lastEvent: subtitleHistory[0] ?? undefined
						}
					};
				}
			} catch { /* silent — enrichment is best-effort */ }
		}
	}

	serviceId = resolvedServiceId!;

	const config = getServiceConfig(serviceId)!;
	const adapter = registry.get(config.type)!;
	const userCred = userId && adapter.userLinkable
		? getUserCredentialForService(userId, serviceId) ?? undefined
		: undefined;

	// ── Fetch similar items ─────────────────────────────────────────────
	let similar: UnifiedMedia[] = [];
	try {
		if (adapter.getSimilar) {
			const sourceIdForSimilar = config.type === 'overseerr'
				? `${params.type === 'show' ? 'tv' : params.type}:${params.id}`
				: params.id;
			similar = await adapter.getSimilar(config, sourceIdForSimilar, userCred);
		}
	} catch { /* silent */ }

	// ── Seasons & episodes ──────────────────────────────────────────────
	let seasons: JellyfinSeason[] = [];
	let episodes: UnifiedMedia[] = [];
	let selectedSeason: number | null = null;

	if (item.type === 'show' && resolvedServiceType === 'jellyfin') {
		// Show page — fetch all seasons, then episodes for the selected season
		try {
			seasons = await getJellyfinSeasons(config, params.id, userCred);
		} catch { /* silent */ }

		if (seasons.length > 0) {
			const requestedSeason = url.searchParams.get('season');
			if (requestedSeason != null) {
				selectedSeason = parseInt(requestedSeason, 10);
			} else {
				// Default to first season with unwatched episodes, or first season
				const unwatched = seasons.find((s) => s.unplayedCount && s.unplayedCount > 0 && s.seasonNumber > 0);
				selectedSeason = (unwatched ?? seasons.find((s) => s.seasonNumber > 0) ?? seasons[0]).seasonNumber;
			}

			try {
				if (adapter.getSeasonEpisodes) {
					episodes = await adapter.getSeasonEpisodes(config, params.id, selectedSeason!, userCred);
				}
			} catch { /* silent */ }
		}
	} else if (item.type === 'episode') {
		// Episode page — show that season's episodes
		try {
			const seriesId = item.metadata?.seriesId as string | undefined;
			const seasonNumber = item.metadata?.seasonNumber as number | undefined;
			if (seriesId && seasonNumber != null && adapter.getSeasonEpisodes) {
				episodes = await adapter.getSeasonEpisodes(config, seriesId, seasonNumber, userCred);
				selectedSeason = seasonNumber;

				// Also fetch seasons so user can navigate between them
				if (resolvedServiceType === 'jellyfin') {
					seasons = await getJellyfinSeasons(config, seriesId, userCred);
				}
			}
		} catch { /* silent */ }
	}

	// ── Request context (for Overseerr items) ───────────────────────────
	let canRequest = false;
	let overseerrServiceId: string | null = null;
	if (resolvedServiceType === 'overseerr') {
		canRequest = true;
		overseerrServiceId = serviceId;
	}

	// ── Analytics: emit detail_view event ─────────────────────────────
	if (userId && item) {
		const meta: Record<string, unknown> = {};
		if (item.metadata?.platform) meta.platform = item.metadata.platform;
		if (item.metadata?.platformSlug) meta.platformSlug = item.metadata.platformSlug;
		if (item.metadata?.userStatus) meta.userStatus = item.metadata.userStatus;
		if (item.metadata?.lastPlayed) meta.lastPlayed = item.metadata.lastPlayed;
		if (item.metadata?.retroAchievements) meta.hasRetroAchievements = true;
		if (item.metadata?.hltb) meta.hasHltb = true;

		emitMediaEvent({
			userId,
			serviceId,
			serviceType: resolvedServiceType,
			eventType: 'detail_view',
			mediaId: params.id,
			mediaType: item.type,
			mediaTitle: item.title,
			mediaYear: item.year,
			mediaGenres: item.genres,
			parentTitle: item.metadata?.platform as string ?? item.metadata?.seriesName as string,
			metadata: Object.keys(meta).length > 0 ? meta : undefined
		});
	}

	// ── Video-specific data (Invidious) ────────────────────────────────
	let isSubscribed = false;
	let hasLinkedInvidious = false;
	let videoNotifyEnabled = false;

	if (resolvedServiceType === 'invidious' && userId) {
		hasLinkedInvidious = !!userCred?.accessToken;
		if (hasLinkedInvidious && userCred && item.metadata?.authorId) {
			try {
				const { getSubscriptions } = await import('$lib/adapters/invidious');
				const { isChannelNotifyEnabled } = await import('$lib/server/video-notifications');
				const subs = await getSubscriptions(config, userCred);
				isSubscribed = subs.some((s: any) => s.authorId === item.metadata?.authorId);
				videoNotifyEnabled = isChannelNotifyEnabled(userId, item.metadata.authorId as string);
			} catch { /* silent */ }
		}
	}

	// ── Game-specific data (RomM saves, states, screenshots) ────────────
	let gameSaves: Awaited<ReturnType<typeof getRomSaves>> = [];
	let gameStates: Awaited<ReturnType<typeof getRomStates>> = [];
	let gameScreenshots: Awaited<ReturnType<typeof getRomScreenshots>> = [];

	if (item.type === 'game' && resolvedServiceType === 'romm') {
		try {
			[gameSaves, gameStates, gameScreenshots] = await Promise.all([
				getRomSaves(config, params.id, userCred),
				getRomStates(config, params.id, userCred),
				getRomScreenshots(config, params.id, userCred)
			]);
		} catch { /* silent — best-effort enrichment */ }
	}

	// ── Game notes (from Nexus DB) ──────────────────────────────────────
	let gameNoteContent = '';
	if (item.type === 'game' && userId) {
		try {
			const { getDb } = await import('$lib/db');
			const { gameNotes } = await import('$lib/db/schema');
			const { eq, and } = await import('drizzle-orm');
			const db = getDb();
			const note = db
				.select()
				.from(gameNotes)
				.where(
					and(
						eq(gameNotes.userId, userId),
						eq(gameNotes.romId, params.id),
						eq(gameNotes.serviceId, serviceId)
					)
				)
				.get();
			if (note) gameNoteContent = note.content;
		} catch { /* silent */ }
	}

	// ── Book-specific data (Calibre) ────────────────────────────────────
	let bookRelated: Awaited<ReturnType<typeof getRelatedBooks>> = { sameAuthor: [], sameSeries: [] };
	let bookFormats: Awaited<ReturnType<typeof getCalibreBookFormats>> = { formats: [] };
	let bookNotes: any[] = [];
	let bookHighlights: any[] = [];
	let bookBookmarks: any[] = [];

	if (item.type === 'book' && resolvedServiceType === 'calibre') {
		const { getRelatedBooks: fetchRelated, getCalibreBookFormats: fetchFormats } = await import('$lib/adapters/calibre');
		try {
			[bookRelated, bookFormats] = await Promise.all([
				fetchRelated(config, params.id, userCred),
				fetchFormats(config, params.id, userCred)
			]);
		} catch { /* silent */ }

		// Fetch user annotations from DB
		if (userId) {
			const { getDb } = await import('$lib/db');
			const schema = await import('$lib/db/schema');
			const { eq, and, desc } = await import('drizzle-orm');
			const db = getDb();

			try {
				[bookNotes, bookHighlights, bookBookmarks] = await Promise.all([
					db.select().from(schema.bookNotes)
						.where(and(eq(schema.bookNotes.userId, userId), eq(schema.bookNotes.bookId, params.id), eq(schema.bookNotes.serviceId, serviceId)))
						.orderBy(desc(schema.bookNotes.updatedAt))
						.all(),
					db.select().from(schema.bookHighlights)
						.where(and(eq(schema.bookHighlights.userId, userId), eq(schema.bookHighlights.bookId, params.id), eq(schema.bookHighlights.serviceId, serviceId)))
						.orderBy(desc(schema.bookHighlights.createdAt))
						.all(),
					db.select().from(schema.bookBookmarks)
						.where(and(eq(schema.bookBookmarks.userId, userId), eq(schema.bookBookmarks.bookId, params.id), eq(schema.bookBookmarks.serviceId, serviceId)))
						.orderBy(desc(schema.bookBookmarks.createdAt))
						.all()
				]);
			} catch { /* silent */ }
		}
	}

	// ── Invidious stream data ────────────────────────────────────────────
	let videoStreamUrl: string | undefined;
	let videoCaptions: { label: string; lang: string; url: string }[] = [];

	if (resolvedServiceType === 'invidious' && item.type === 'video') {
		videoStreamUrl = `/api/video/stream/${params.id}`;

		// Map Invidious captions to proxied URLs
		const rawCaptions = (item.metadata?.captions as any[]) ?? [];
		videoCaptions = rawCaptions.map((c: any) => {
			const captionUrl = c.url ?? c.src ?? '';
			return {
				label: c.label ?? c.language ?? 'Unknown',
				lang: c.language_code ?? c.languageCode ?? c.lang ?? '',
				url: `/api/video/stream/${params.id}/captions?url=${encodeURIComponent(captionUrl)}`
			};
		});
	}

	return {
		item,
		serviceType: resolvedServiceType,
		serviceId,
		similar,
		episodes,
		seasons,
		selectedSeason,
		canRequest,
		overseerrServiceId,
		isAdmin: locals.user?.isAdmin ?? false,
		gameSaves,
		gameStates,
		gameScreenshots,
		isSubscribed,
		hasLinkedInvidious,
		videoNotifyEnabled,
		invidiousBaseUrl: resolvedServiceType === 'invidious' ? config.url : undefined,
		videoStreamUrl,
		videoCaptions,
		bookRelated,
		bookFormats,
		bookNotes,
		bookHighlights,
		bookBookmarks,
		supportsEmulation: item.type === 'game' && isPlayableInBrowser(item.metadata?.platformSlug as string | undefined),
		gameNoteContent
	};
};

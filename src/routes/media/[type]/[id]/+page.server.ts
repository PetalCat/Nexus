import { error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { isOverseerrType } from '$lib/adapters/overseerr';
import { getServiceConfig, getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getSubtitleStatus, getItemSubtitleHistory } from '$lib/adapters/bazarr';
import { isPlayableInBrowser } from '$lib/emulator/cores';
import { emitMediaAction } from '$lib/server/analytics';
import { resolveTrailerUrl } from '$lib/server/trailers';
import { getUserWatchlist } from '$lib/server/social';
import { getUserRating, getMediaRatingStats } from '$lib/server/ratings';
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
		if (!adapter?.getItem) {
			// Management services (Sonarr, Radarr, Lidarr) don't serve item detail.
			// Try to find the item on a library service or Overseerr/Seerr instead.
			const fallbackConfigs = getEnabledConfigs()
				.filter((c) => {
					const a = registry.get(c.type);
					return a?.getItem && (a.isLibrary || a.isSearchable);
				})
				.sort((a, b) => {
					// Try Overseerr/Seerr first (they understand TMDB/TVDB IDs)
					const aPri = registry.get(a.type)?.searchPriority ?? 99;
					const bPri = registry.get(b.type)?.searchPriority ?? 99;
					return aPri - bPri;
				});
			for (const fc of fallbackConfigs) {
				const fa = registry.get(fc.type);
				if (!fa?.getItem) continue;
				const cred = userId && fa.userLinkable
					? getUserCredentialForService(userId, fc.id) ?? undefined
					: undefined;
				try {
					const found = await fa.getItem(fc, params.id, cred);
					if (found) {
						item = found;
						resolvedServiceId = fc.id;
						resolvedServiceType = fc.type;
						break;
					}
				} catch { continue; }
			}
			if (!item) throw error(404, 'Item not found in any library service');
		}

		if (!resolvedServiceType) resolvedServiceType = config.type;
		const userCred = userId && adapter?.userLinkable
			? getUserCredentialForService(userId, serviceId) ?? undefined
			: undefined;

		// For Overseerr, prefix sourceId with media type so adapter knows which TMDB endpoint
		const sourceId = isOverseerrType(config.type)
			? `${params.type === 'show' ? 'tv' : params.type}:${params.id}`
			: params.id;

		if (!item && adapter?.getItem) {
			item = await adapter.getItem(config, sourceId, userCred);
		}
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

	// ── Bazarr subtitle enrichment (non-blocking, 3s timeout) ────────
	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length > 0 && item) {
		const bazarrConfig = bazarrConfigs[0];
		const tmdbId = item.metadata?.tmdbId as string | undefined;
		const radarrId = item.metadata?.radarrId as string | undefined;
		const sonarrId = item.metadata?.sonarrId as string | undefined;

		if (tmdbId || radarrId || sonarrId) {
			try {
				const subtitleType = item.type === 'show' || item.type === 'episode' ? 'show' : 'movie';
				const subtitleStatus = await Promise.race([
					getSubtitleStatus(bazarrConfig, tmdbId, {
						radarrId,
						sonarrId,
						type: subtitleType
					}),
					new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))
				]);

				if (subtitleStatus) {
					const subtitleHistory = await Promise.race([
						getItemSubtitleHistory(bazarrConfig, tmdbId, {
							radarrId,
							sonarrId,
							type: subtitleType
						}),
						new Promise<[]>((resolve) => setTimeout(() => resolve([]), 1000))
					]);

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

	// ── Quality enrichment (non-blocking, runs in parallel below) ─────
	const qualityPromise = (async () => {
		const qualityConfigs = getEnabledConfigs().filter((c) => {
			const a = registry.get(c.type);
			return a?.enrichItem && ['radarr', 'sonarr', 'lidarr'].includes(c.type);
		});
		for (const qc of qualityConfigs) {
			const qa = registry.get(qc.type);
			if (!qa?.enrichItem) continue;
			try {
				const enriched = await Promise.race([
					qa.enrichItem(qc, item, 'quality'),
					new Promise<null>((r) => setTimeout(() => r(null), 2000))
				]);
				if (enriched?.metadata?.quality) return enriched.metadata.quality;
			} catch { continue; }
		}
		return null;
	})();

	// ── Fetch similar items ─────────────────────────────────────────────
	let similar: UnifiedMedia[] = [];
	try {
		if (adapter.getSimilar) {
			const sourceIdForSimilar = isOverseerrType(config.type)
				? `${params.type === 'show' ? 'tv' : params.type}:${params.id}`
				: params.id;
			similar = await adapter.getSimilar(config, sourceIdForSimilar, userCred);
		}
	} catch { /* silent */ }

	// ── Seasons & episodes ──────────────────────────────────────────────
	let seasons: JellyfinSeason[] = [];
	let episodes: UnifiedMedia[] = [];
	let selectedSeason: number | null = null;

	// Media servers that expose a "seasons + episodes" hierarchy (Jellyfin, Plex).
	const SHOW_SERVERS = new Set(['jellyfin', 'plex']);

	if (item.type === 'show' && SHOW_SERVERS.has(resolvedServiceType)) {
		const seriesId = item.sourceId;

		// Show page — fetch all seasons, then episodes for the selected season
		try {
			const subResult = await adapter?.getSubItems?.(config, seriesId, 'season', {}, userCred);
			seasons = (subResult?.items ?? []) as unknown as JellyfinSeason[];
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
					episodes = await adapter.getSeasonEpisodes(config, seriesId, selectedSeason!, userCred);
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
				if (SHOW_SERVERS.has(resolvedServiceType)) {
					const subResult = await adapter?.getSubItems?.(config, seriesId, 'season', {}, userCred);
					seasons = (subResult?.items ?? []) as unknown as JellyfinSeason[];
				}
			}
		} catch { /* silent */ }
	}

	// ── Request context (for Overseerr items) ───────────────────────────
	let canRequest = false;
	let overseerrServiceId: string | null = null;
	if (isOverseerrType(resolvedServiceType ?? '')) {
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

		emitMediaAction({
			userId,
			serviceId,
			serviceType: resolvedServiceType,
			actionType: 'detail_view',
			mediaId: params.id,
			mediaType: item.type,
			mediaTitle: item.title,
			metadata: Object.keys(meta).length > 0 ? meta : undefined
		});
	}

	// ── Video-specific data (Invidious) ────────────────────────────────
	let isSubscribed = false;
	let hasLinkedInvidious = false;
	let videoNotifyEnabled = false;

	// Local resume fallback for server-hosted media (Jellyfin / Plex).
	// Upstream user progress is the source of truth, but if sync is delayed we use
	// the latest Nexus activity row so the Resume button still lands near the
	// correct position.
	const RESUME_SERVERS = new Set(['jellyfin', 'plex']);
	if (
		userId &&
		RESUME_SERVERS.has(resolvedServiceType) &&
		(item.type === 'movie' || item.type === 'episode')
	) {
		try {
			const { getDb } = await import('$lib/db');
			const { playSessions } = await import('$lib/db/schema');
			const { eq, and, desc, inArray } = await import('drizzle-orm');
			const db = getDb();
			const mediaIds = Array.from(new Set([params.id, item.sourceId].filter((v): v is string => !!v)));
			const record = db.select().from(playSessions)
				.where(
					and(
						eq(playSessions.userId, userId),
						eq(playSessions.serviceId, serviceId),
						inArray(playSessions.mediaId, mediaIds)
					)
				)
				.orderBy(desc(playSessions.updatedAt))
				.get();
			if (record && !record.completed && (record.progress ?? 0) > 0) {
				item.progress = Math.max(item.progress ?? 0, record.progress ?? 0);
				if (!item.duration && record.positionTicks && (record.progress ?? 0) > 0) {
					item.duration = record.positionTicks / 10_000_000 / (record.progress ?? 1);
				}
			}
		} catch { /* silent */ }
	}

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
	let gameSaves: any[] = [];
	let gameStates: any[] = [];
	let gameScreenshots: any[] = [];

	if (item.type === 'game' && resolvedServiceType === 'romm') {
		try {
			const enriched = await Promise.all([
				adapter.enrichItem?.(config, { sourceId: params.id } as any, 'saves', userCred),
				adapter.enrichItem?.(config, { sourceId: params.id } as any, 'states', userCred),
				adapter.enrichItem?.(config, { sourceId: params.id } as any, 'screenshots', userCred)
			]);
			gameSaves = (enriched[0]?.metadata?.saves ?? []) as any[];
			gameStates = (enriched[1]?.metadata?.states ?? []) as any[];
			gameScreenshots = (enriched[2]?.metadata?.screenshots ?? []) as any[];
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
	let bookRelated: { sameAuthor: UnifiedMedia[]; sameSeries: UnifiedMedia[]; nextInSeries?: UnifiedMedia; prevInSeries?: UnifiedMedia } = { sameAuthor: [], sameSeries: [] };
	let bookFormats: { formats: { name: string; downloadUrl: string }[] } = { formats: [] };
	let bookNotes: any[] = [];
	let bookHighlights: any[] = [];
	let bookBookmarks: any[] = [];

	if (item.type === 'book' && resolvedServiceType === 'calibre') {
		try {
			const [relatedEnriched, formatsEnriched] = await Promise.all([
				adapter.enrichItem?.(config, { sourceId: params.id } as any, 'related', userCred),
				adapter.enrichItem?.(config, { sourceId: params.id } as any, 'formats', userCred)
			]);
			bookRelated = (relatedEnriched?.metadata?.related as typeof bookRelated) ?? bookRelated;
			bookFormats = (formatsEnriched?.metadata?.formats as typeof bookFormats) ?? bookFormats;
		} catch { /* silent — best-effort enrichment */ }

		// Fetch user annotations from DB
		if (userId) {
			const { getDb, schema } = await import('$lib/db');
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

		// Load saved progress for resume
		if (userId) {
			try {
				const { getDb } = await import('$lib/db');
				const { playSessions } = await import('$lib/db/schema');
				const { eq, and, desc } = await import('drizzle-orm');
				const db = getDb();
				const record = db.select().from(playSessions)
					.where(and(
						eq(playSessions.userId, userId),
						eq(playSessions.mediaId, params.id),
						eq(playSessions.serviceId, serviceId)
					))
					.orderBy(desc(playSessions.updatedAt))
					.get();
				const progress = record?.progress ?? 0;
				if (record && !record.completed && progress > 0 && progress < 0.9) {
					item.progress = progress;
					if (record.positionTicks) {
						item.duration = record.positionTicks / 10_000_000 / (progress || 1);
					}
				}
			} catch { /* silent */ }
		}

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

	// ── Watchlist check ─────────────────────────────────────────────────
	const watchlistItems = userId ? getUserWatchlist(userId) : [];
	const watchlistEntry = watchlistItems.find(
		(f) => f.mediaId === params.id && f.serviceId === serviceId
	);
	const inWatchlist = !!watchlistEntry;
	const watchlistItemId = watchlistEntry?.id ?? null;

	// ── User rating ────────────────────────────────────────────────────
	const userRating = userId ? getUserRating(userId, params.id, serviceId) : null;
	const ratingStats = await getMediaRatingStats(params.id, serviceId);

	// ── Trailer resolution ──────────────────────────────────────────────
	const trailerUrl = await resolveTrailerUrl(
		params.id,
		serviceId,
		item.title,
		item.year,
		(item.metadata?.trailerUrl as string) ?? null,
		userId
	);

	// Resolve quality enrichment (was running in parallel)
	const quality = await qualityPromise;
	if (quality) {
		item.metadata = { ...item.metadata, quality };
	}

	// ── Post-play data: next item + skip markers (Jellyfin-only this cycle) ──
	// Non-Jellyfin sources get null/[] and the player hides the up-next card
	// and skip buttons accordingly. See plan §4 and the locked decisions.
	let nextItem: import('$lib/adapters/player-markers').NextItemData | null = null;
	let skipMarkers: import('$lib/adapters/player-markers').SkipMarkerData[] = [];
	if (
		resolvedServiceType === 'jellyfin' &&
		(item.type === 'episode' || item.type === 'movie')
	) {
		try {
			if (adapter.getNextItem) {
				nextItem = await adapter.getNextItem(config, params.id, userCred);
			}
		} catch { /* silent */ }
		try {
			if (adapter.getSkipMarkers) {
				skipMarkers = await adapter.getSkipMarkers(config, params.id, userCred);
			}
		} catch { /* silent */ }
	}

	return {
		nextItem,
		skipMarkers,
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
		gameNoteContent,
		inWatchlist,
		watchlistItemId,
		userRating,
		ratingStats,
		trailerUrl
	};
};

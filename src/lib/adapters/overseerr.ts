import type { ServiceAdapter } from './base';
import type { NexusRequest, ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential } from './types';

/** Build request headers — prefer user session cookie over admin API key */
function authHeaders(config: ServiceConfig, userCred?: UserCredential): Record<string, string> {
	if (userCred?.accessToken) {
		return { Cookie: userCred.accessToken, 'Content-Type': 'application/json' };
	}
	return { 'X-Api-Key': config.apiKey ?? '', 'Content-Type': 'application/json' };
}

async function osFetch(
	config: ServiceConfig,
	path: string,
	userCred?: UserCredential,
	opts?: RequestInit
) {
	const url = `${config.url}/api/v1${path}`;
	const res = await fetch(url, {
		...opts,
		headers: {
			...authHeaders(config, userCred),
			...(opts?.headers as Record<string, string>)
		},
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`Overseerr ${path} → ${res.status}`);
	return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	const isMovie = item.mediaType === 'movie';
	return {
		id: `${item.id}:${config.id}`,
		sourceId: String(item.id),
		serviceId: config.id,
		serviceType: 'overseerr',
		type: isMovie ? 'movie' : 'show',
		title: item.title || item.name || 'Unknown',
		sortTitle: item.originalTitle || item.originalName,
		description: item.overview,
		poster: item.posterPath ? `https://image.tmdb.org/t/p/w500${item.posterPath}` : undefined,
		backdrop: item.backdropPath
			? `https://image.tmdb.org/t/p/w1280${item.backdropPath}`
			: undefined,
		year: item.releaseDate
			? new Date(item.releaseDate).getFullYear()
			: item.firstAirDate
				? new Date(item.firstAirDate).getFullYear()
				: undefined,
		rating: item.voteAverage,
		genres: item.genres?.map((g: { name: string }) => g.name) ?? [],
		status: mapStatus(item.mediaInfo?.status),
		metadata: {
			tmdbId: item.id,
			mediaInfo: item.mediaInfo,
			requestStatus: item.mediaInfo?.requests?.[0]?.status
		},
		actionLabel: item.mediaInfo?.status === 5 ? 'Watch' : 'Request',
		actionUrl: `${config.url}/${isMovie ? 'movie' : 'tv'}/${item.id}`
	};
}

/**
 * Normalize an Overseerr request object into a NexusRequest.
 *
 * The base request list endpoint (/request) only returns a minimal `media`
 * object (just IDs + status). Pass the `detail` object fetched from
 * /movie/{tmdbId} or /tv/{tmdbId} to populate title, poster, description, etc.
 */
/** Derive the true request status by checking both request status and media availability.
 *  Media status 5 = fully available, 4 = partially available (some seasons). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveRequestStatus(req: any): NexusRequest['status'] {
	const mediaStatus = req.media?.status;
	if (mediaStatus === 5) return 'available';
	if (mediaStatus === 4) return 'partial';
	return mapRequestStatus(req.status);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRequest(config: ServiceConfig, req: any, detail?: any): NexusRequest {
	const m = req.media ?? {};
	const d = detail ?? {};                              // enriched TMDB detail
	const isMovie = req.type === 'movie' || m.mediaType === 'movie';

	const title = d.title || d.name || m.title || m.name || `Request #${req.id}`;
	const poster = d.posterPath
		? `https://image.tmdb.org/t/p/w300${d.posterPath}`
		: m.posterPath ? `https://image.tmdb.org/t/p/w300${m.posterPath}` : undefined;
	const backdrop = d.backdropPath
		? `https://image.tmdb.org/t/p/w1280${d.backdropPath}`
		: m.backdropPath ? `https://image.tmdb.org/t/p/w1280${m.backdropPath}` : undefined;
	const rawDate = d.releaseDate || d.firstAirDate || m.releaseDate || m.firstAirDate;
	const year = rawDate ? new Date(rawDate).getFullYear() : undefined;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const genres: string[] = ((d.genres ?? m.genres ?? []) as any[]).map((g: any) =>
		typeof g === 'string' ? g : (g.name ?? '')
	).filter(Boolean);

	const tmdbId = m.tmdbId ? String(m.tmdbId) : undefined;

	return {
		id: `${config.id}:${req.id}`,
		sourceId: String(req.id),
		serviceId: config.id,
		serviceType: 'overseerr',
		serviceName: config.name,
		title,
		type: isMovie ? 'movie' : 'show',
		poster,
		year,
		status: resolveRequestStatus(req),
		requestedByName: req.requestedBy?.displayName ?? req.requestedBy?.email ?? 'Unknown',
		requestedByExternalId: String(req.requestedBy?.id ?? ''),
		requestedAt: req.createdAt ?? new Date().toISOString(),
		updatedAt: req.updatedAt,
		tmdbId,
		mediaUrl: tmdbId ? `${config.url}/${isMovie ? 'movie' : 'tv'}/${tmdbId}` : undefined,
		description: d.overview || m.overview || undefined,
		genres: genres.length ? genres : undefined,
		backdrop,
		rating: d.voteAverage ?? m.voteAverage ?? undefined
	};
}

/**
 * Build a rich UnifiedMedia from a full TMDB detail object (from /movie/{id} or /tv/{id}).
 * Includes cast, taglines, runtime, studios, content rating — everything the detail page needs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeDetail(config: ServiceConfig, d: any, mediaType: 'movie' | 'tv'): UnifiedMedia {
	const isMovie = mediaType === 'movie';
	const title = d.title || d.name || 'Unknown';

	// Cast — top 20 from credits
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cast = (d.credits?.cast ?? []).slice(0, 20).map((c: any) => ({
		name: c.name,
		role: c.character ?? c.job ?? '',
		type: c.knownForDepartment ?? 'Acting',
		imageUrl: c.profilePath ? `https://image.tmdb.org/t/p/w185${c.profilePath}` : undefined
	}));

	// Studios / networks
	const studios: string[] = isMovie
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		? (d.productionCompanies ?? []).map((s: any) => s.name).filter(Boolean)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		: (d.networks ?? []).map((n: any) => n.name).filter(Boolean);

	// Runtime (seconds)
	const runtimeMin = isMovie ? d.runtime : (d.episodeRunTime?.[0] ?? d.runtime);
	const duration = runtimeMin ? runtimeMin * 60 : undefined;

	// Content rating
	let officialRating: string | undefined;
	if (isMovie) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const usRelease = d.releases?.results?.find((r: any) => r.iso_3166_1 === 'US');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		officialRating = usRelease?.release_dates?.find((rd: any) => rd.certification)?.certification;
	} else {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const usCR = d.contentRatings?.results?.find((r: any) => r.iso_3166_1 === 'US');
		officialRating = usCR?.rating;
	}

	return {
		id: `${d.id}:${config.id}`,
		sourceId: String(d.id),
		serviceId: config.id,
		serviceType: 'overseerr',
		type: isMovie ? 'movie' : 'show',
		title,
		sortTitle: d.originalTitle || d.originalName,
		description: d.overview,
		poster: d.posterPath ? `https://image.tmdb.org/t/p/w500${d.posterPath}` : undefined,
		backdrop: d.backdropPath ? `https://image.tmdb.org/t/p/w1280${d.backdropPath}` : undefined,
		year: d.releaseDate
			? new Date(d.releaseDate).getFullYear()
			: d.firstAirDate ? new Date(d.firstAirDate).getFullYear() : undefined,
		rating: d.voteAverage,
		genres: d.genres?.map((g: { name: string }) => g.name) ?? [],
		studios,
		duration,
		status: mapStatus(d.mediaInfo?.status),
		metadata: {
			tmdbId: d.id,
			mediaInfo: d.mediaInfo,
			requestStatus: d.mediaInfo?.requests?.[0]?.status,
			cast,
			taglines: d.tagline ? [d.tagline] : [],
			officialRating,
			criticRating: d.voteAverage ? Math.round(d.voteAverage * 10) : undefined,
			seasonCount: d.numberOfSeasons,
			episodeCount: d.numberOfEpisodes,
			tmdbMediaType: mediaType
		},
		actionLabel: d.mediaInfo?.status === 5 ? 'Watch' : 'Request',
		actionUrl: `${config.url}/${isMovie ? 'movie' : 'tv'}/${d.id}`
	};
}

/** Map Overseerr request status (1=pending, 2=approved, 3=declined).
 *  Availability is determined from media.status, not request status. */
function mapRequestStatus(s?: number): NexusRequest['status'] {
	switch (s) {
		case 2: return 'approved';
		case 3: return 'declined';
		default: return 'pending';
	}
}

function mapStatus(s?: number): UnifiedMedia['status'] {
	switch (s) {
		case 5: return 'available';
		case 3:
		case 4: return 'downloading';
		case 2: return 'requested';
		default: return undefined;
	}
}

/**
 * Parse a URL like "http://host:8096" into the shape Overseerr's Jellyfin auth needs.
 */
function parseJellyfinUrl(raw: string): { hostname: string; port: number; useSsl: boolean } {
	try {
		const u = new URL(raw);
		const useSsl = u.protocol === 'https:';
		const defaultPort = useSsl ? 443 : 80;
		const port = u.port ? parseInt(u.port, 10) : defaultPort;
		return { hostname: u.hostname, port, useSsl };
	} catch {
		return { hostname: raw, port: 8096, useSsl: false };
	}
}

/**
 * Import a Jellyfin user into Overseerr by their Jellyfin user ID.
 * Uses the admin API key. Returns the newly created Overseerr user ID, or null on failure.
 */
export async function importJellyfinUser(config: ServiceConfig, jellyfinUserId: string): Promise<string | null> {
	try {
		const res = await fetch(`${config.url}/api/v1/user/import-from-jellyfin`, {
			method: 'POST',
			headers: { 'X-Api-Key': config.apiKey ?? '', 'Content-Type': 'application/json' },
			body: JSON.stringify({ jellyfinUserIds: [jellyfinUserId] }),
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) return null;
		const imported = await res.json() as Array<{ id?: number }>;
		return imported?.[0]?.id != null ? String(imported[0].id) : null;
	} catch {
		return null;
	}
}

/** Returns true if the given service type is an Overseerr-compatible adapter (overseerr or seerr). */
export function isOverseerrType(type: string): boolean {
	return type === 'overseerr' || type === 'seerr';
}

export const overseerrAdapter: ServiceAdapter = {
	id: 'overseerr',
	displayName: 'Overseerr',
	defaultPort: 5055,
	color: '#f59e0b',
	abbreviation: 'OS',
	isSearchable: true,
	searchPriority: 1,
	authVia: 'jellyfin',
	derivedFrom: ['jellyfin', 'plex'],
	parentRequired: false,
	icon: 'overseerr',
	mediaTypes: ['movie', 'show'],
	userLinkable: true,
	authUsernameLabel: 'Email',

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await osFetch(config, '/status');
			return { serviceId: config.id, name: config.name, type: 'overseerr', online: true, latency: Date.now() - start };
		} catch (e) {
			return { serviceId: config.id, name: config.name, type: 'overseerr', online: false, error: String(e) };
		}
	},

	async getRecentlyAdded(config, userCred?): Promise<UnifiedMedia[]> {
		try {
			const data = await osFetch(config, '/media?filter=available&sort=added&take=20', userCred);
			return (data?.results ?? []).map((i: unknown) => normalize(config, i));
		} catch { return []; }
	},

	async getTrending(config, userCred?): Promise<UnifiedMedia[]> {
		try {
			const [movies, tv] = await Promise.all([
				osFetch(config, '/discover/trending', userCred).catch(() => ({ results: [] })),
				osFetch(config, '/discover/trending/tv', userCred).catch(() => ({ results: [] }))
			]);
			return [...(movies.results ?? []), ...(tv.results ?? [])].map((i: unknown) => normalize(config, i));
		} catch { return []; }
	},

	async search(config, query, userCred?): Promise<UnifiedSearchResult> {
		try {
			const data = await osFetch(config, `/search?query=${encodeURIComponent(query)}&page=1`, userCred);
			return { items: (data.results ?? []).map((i: unknown) => normalize(config, i)), total: data.totalResults ?? 0, source: 'overseerr' };
		} catch { return { items: [], total: 0, source: 'overseerr' }; }
	},

	async requestMedia(config, tmdbId, type, userCred?, seasons?): Promise<boolean> {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const body: any = { mediaType: type, mediaId: Number(tmdbId) };

			// For TV requests, pass specific seasons if provided
			if (type === 'tv' && seasons && seasons.length > 0) {
				body.seasons = seasons;
			}

			// When the user is auto-linked (no session cookie), we use the admin API key.
			// Pass userId so Overseerr attributes the request to the correct user,
			// not the API key owner.
			if (userCred?.externalUserId && !userCred.accessToken) {
				body.userId = Number(userCred.externalUserId);
			}

			await osFetch(config, '/request', userCred, {
				method: 'POST',
				body: JSON.stringify(body)
			});
			return true;
		} catch { return false; }
	},

	/**
	 * Authenticate a user against Overseerr.
	 *
	 * Two modes, controlled by the service's `username` field (admin-configured):
	 *   - Empty / unset  → local email + password  (`POST /api/v1/auth/local`)
	 *   - Jellyfin URL   → Jellyfin credentials     (`POST /api/v1/auth/jellyfin`)
	 *
	 * The admin sets the Jellyfin URL in the Overseerr service's "Jellyfin Auth URL"
	 * field (stored in config.username) to enable the Jellyfin auth mode.
	 */
	async authenticateUser(config, username, password) {
		const jellyfinUrl = config.username?.trim();

		let authBody: Record<string, unknown>;
		let authPath: string;

		if (jellyfinUrl) {
			// Jellyfin-based auth — Overseerr delegates login to Jellyfin
			const { hostname, port, useSsl } = parseJellyfinUrl(jellyfinUrl);
			authPath = '/auth/jellyfin';
			authBody = { username, password, hostname, port, useSsl };
		} else {
			// Local Overseerr account (email + password)
			authPath = '/auth/local';
			authBody = { email: username, password };
		}

		const res = await fetch(`${config.url}/api/v1${authPath}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.apiKey ?? '' },
			body: JSON.stringify(authBody),
			signal: AbortSignal.timeout(10_000)
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(
				(body as { message?: string }).message ??
				(body as { error?: string }).error ??
				`Authentication failed (${res.status})`
			);
		}

		const data = await res.json() as { id?: number; email?: string; displayName?: string };

		// Capture session cookie for future user-attributed requests
		const setCookie = res.headers.get('set-cookie') ?? '';
		const sidMatch = setCookie.match(/connect\.sid=([^;]+)/);
		const sessionCookie = sidMatch ? `connect.sid=${sidMatch[1]}` : '';

		return {
			accessToken: sessionCookie,
			externalUserId: String(data.id ?? ''),
			externalUsername: data.displayName ?? data.email ?? username
		};
	},

	/**
	 * List requests. Admin API key → all requests. User session cookie → own requests only.
	 * Automatically enriches each request with TMDB metadata (title, poster, description…)
	 * by batch-fetching from Overseerr's /movie/{id} and /tv/{id} endpoints in parallel.
	 */
	async getRequests(config, opts?, userCred?) {
		try {
			const filter = opts?.filter ?? 'all';
			const take = opts?.take ?? 100;
			const skip = opts?.skip ?? 0;

			const data = await osFetch(
				config,
				`/request?take=${take}&skip=${skip}&filter=${filter}&sort=added`,
				userCred
			);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let requests: any[] = data.results ?? [];

			// When the user is auto-linked (has externalUserId but no session cookie),
			// the admin API key is used and Overseerr returns ALL requests.
			// Filter to only this user's requests on the Nexus side.
			if (userCred?.externalUserId && !userCred.accessToken) {
				requests = requests.filter(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(req: any) => String(req.requestedBy?.id ?? '') === userCred.externalUserId
				);
			}

			// Collect unique (type, tmdbId) pairs for batch enrichment
			const toFetch = new Map<string, { mediaType: 'movie' | 'tv'; tmdbId: string }>();
			for (const req of requests) {
				const tmdbId = req.media?.tmdbId;
				if (!tmdbId) continue;
				const mediaType: 'movie' | 'tv' = req.type === 'movie' ? 'movie' : 'tv';
				const key = `${mediaType}:${tmdbId}`;
				if (!toFetch.has(key)) toFetch.set(key, { mediaType, tmdbId: String(tmdbId) });
			}

			// Batch-fetch media details from Overseerr's TMDB cache (all in parallel)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const detailCache = new Map<string, any>();
			await Promise.allSettled(
				[...toFetch.entries()].map(async ([key, { mediaType, tmdbId }]) => {
					try {
						const detail = await osFetch(config, `/${mediaType}/${tmdbId}`);
						detailCache.set(key, detail);
					} catch { /* ignore individual failures */ }
				})
			);

			return requests.map((req) => {
				const mediaType: 'movie' | 'tv' = req.type === 'movie' ? 'movie' : 'tv';
				const tmdbId = req.media?.tmdbId ? String(req.media.tmdbId) : null;
				const detail = tmdbId ? detailCache.get(`${mediaType}:${tmdbId}`) : undefined;
				return normalizeRequest(config, req, detail);
			});
		} catch { return []; }
	},

	async getPendingCount(config) {
		try {
			const data = await osFetch(config, '/request/count');
			return (data?.pending ?? 0) as number;
		} catch { return 0; }
	},

	async approveRequest(config, requestId) {
		try {
			await osFetch(config, `/request/${requestId}/approve`, undefined, { method: 'POST' });
			return true;
		} catch { return false; }
	},

	async denyRequest(config, requestId) {
		try {
			await osFetch(config, `/request/${requestId}/decline`, undefined, { method: 'POST' });
			return true;
		} catch { return false; }
	},

	/**
	 * List all Overseerr users (admin API key).
	 * Returns each user's Overseerr ID and their linked Jellyfin user ID,
	 * which allows auto-linking a Nexus user when Jellyfin auth mode is active.
	 */
	async discover(config, opts?, userCred?) {
		const page = opts?.page ?? 1;
		const category = opts?.category ?? 'trending';
		try {
			let endpoint: string;
			switch (category) {
				case 'movies': endpoint = `/discover/movies?page=${page}`; break;
				case 'tv': endpoint = `/discover/tv?page=${page}`; break;
				case 'upcoming-movies': endpoint = `/discover/movies/upcoming?page=${page}`; break;
				case 'upcoming-tv': endpoint = `/discover/tv/upcoming?page=${page}`; break;
				case 'popular-movies': endpoint = `/discover/movies?page=${page}`; break;
				case 'popular-tv': endpoint = `/discover/tv?page=${page}`; break;
				case 'genre-movie': endpoint = `/discover/movies/genre/${opts?.genreId}?page=${page}`; break;
				case 'genre-tv': endpoint = `/discover/tv/genre/${opts?.genreId}?page=${page}`; break;
				case 'network': endpoint = `/discover/tv/network/${opts?.networkId}?page=${page}`; break;
				default: endpoint = `/discover/trending?page=${page}`;
			}
			const data = await osFetch(config, endpoint, userCred);
			return {
				items: (data.results ?? []).map((i: unknown) => normalize(config, i)),
				hasMore: page < (data.totalPages ?? 1)
			};
		} catch { return { items: [], hasMore: false }; }
	},

	async getServiceData(config, dataType, params, userCred) {
		switch (dataType) {
			case 'genres-movie': {
				const data = await osFetch(config, '/genres/movie', userCred);
				return data;
			}
			case 'genres-tv': {
				const data = await osFetch(config, '/genres/tv', userCred);
				return data;
			}
			case 'person': {
				const data = await osFetch(config, `/person/${params?.personId}`, userCred);
				return data;
			}
			case 'person-credits': {
				const data = await osFetch(config, `/person/${params?.personId}/combined_credits`, userCred);
				return data;
			}
			case 'recommendations': {
				const mediaType = params?.mediaType ?? 'movie';
				const data = await osFetch(config, `/${mediaType}/${params?.tmdbId}/recommendations`, userCred);
				return (data?.results ?? []).map((i: unknown) => normalize(config, i));
			}
			case 'similar': {
				const mediaType = params?.mediaType ?? 'movie';
				const data = await osFetch(config, `/${mediaType}/${params?.tmdbId}/similar`, userCred);
				return (data?.results ?? []).map((i: unknown) => normalize(config, i));
			}
			default: return null;
		}
	},

	async getItem(config, sourceId, userCred?) {
		// sourceId may be "movie:12345" or "tv:12345" (prefixed by the media detail page)
		// or just "12345" (fallback: try movie, then tv)
		let mediaType: 'movie' | 'tv';
		let id: string;

		if (sourceId.includes(':')) {
			const parts = sourceId.split(':', 2);
			mediaType = parts[0] === 'tv' || parts[0] === 'show' ? 'tv' : 'movie';
			id = parts[1];
		} else {
			id = sourceId;
			// Try movie first, then tv
			try {
				const d = await osFetch(config, `/movie/${id}`);
				if (d?.title) return normalizeDetail(config, d, 'movie');
			} catch { /* try tv */ }
			try {
				const d = await osFetch(config, `/tv/${id}`);
				if (d?.name) return normalizeDetail(config, d, 'tv');
			} catch { /* nothing */ }
			return null;
		}

		try {
			const data = await osFetch(config, `/${mediaType}/${id}`);
			return normalizeDetail(config, data, mediaType);
		} catch { return null; }
	},

	async getSimilar(config, sourceId, userCred?) {
		let mediaType: 'movie' | 'tv';
		let id: string;
		if (sourceId.includes(':')) {
			const parts = sourceId.split(':', 2);
			mediaType = parts[0] === 'tv' || parts[0] === 'show' ? 'tv' : 'movie';
			id = parts[1];
		} else {
			id = sourceId;
			mediaType = 'movie'; // best guess
		}
		try {
			const data = await osFetch(config, `/${mediaType}/${id}/recommendations`);
			return (data?.results ?? []).map((i: unknown) => normalize(config, i));
		} catch { return []; }
	},

	async getUsers(config) {
		try {
			const data = await osFetch(config, '/user?take=100&skip=0');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return (data.results ?? []).map((u: any) => ({
				externalId: String(u.id),
				username: u.displayName ?? u.email ?? String(u.id),
				isAdmin: u.permissions === 2,
				serviceType: 'overseerr',
				jellyfinUserId: u.jellyfinUserId ?? undefined
			}));
		} catch { return []; }
	}
};

import type { ServiceAdapter } from './base';
import type { ExternalUser, ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential } from './types';

// ---------------------------------------------------------------------------
// Auth & fetch
// ---------------------------------------------------------------------------

/** Per-service userId cache — resolved once from /Users/Me */
const userIdCache = new Map<string, string>();

function authHeaders(config: ServiceConfig): Record<string, string> {
	return {
		// Modern header (preferred; X-Emby-Token deprecated in Jellyfin 12+)
		Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0", Token="${config.apiKey ?? ''}"`,
		// Legacy fallback — still required by many current Jellyfin installs
		'X-Emby-Token': config.apiKey ?? ''
	};
}

async function jfFetch(
	config: ServiceConfig,
	path: string,
	params?: Record<string, string>,
	timeoutMs = 8000
) {
	const url = new URL(`${config.url}${path}`);
	if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url.toString(), {
		headers: authHeaders(config),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`Jellyfin ${path} → ${res.status}`);
	return res.json();
}

/**
 * Resolve the userId for a request.
 * Priority: userCred.externalUserId > cached admin userId > /Users/Me > /Users (first admin).
 */
async function getUserId(config: ServiceConfig, userCred?: UserCredential): Promise<string> {
	// Per-user credential takes absolute priority
	if (userCred?.externalUserId) return userCred.externalUserId;

	const cached = userIdCache.get(config.id);
	if (cached) return cached;

	// Try /Users/Me first (works when config uses a user access token)
	try {
		const me = await jfFetch(config, '/Users/Me');
		if (me?.Id) {
			userIdCache.set(config.id, me.Id as string);
			return me.Id as string;
		}
	} catch {
		// Falls through to admin endpoint below
	}

	// Admin API key path: GET /Users returns all users
	const users = await jfFetch(config, '/Users');
	const list: Array<{ Id: string; Policy?: { IsAdministrator?: boolean } }> =
		Array.isArray(users) ? users : (users.Items ?? []);
	// Prefer the first admin; fall back to first user
	const admin = list.find((u) => u.Policy?.IsAdministrator);
	const id = (admin ?? list[0])?.Id;
	if (!id) throw new Error('Jellyfin: no users found via GET /Users');
	userIdCache.set(config.id, id);
	return id;
}

/**
 * Build auth headers, preferring a user credential's token over the server-level API key.
 */
function resolvedHeaders(config: ServiceConfig, userCred?: UserCredential): Record<string, string> {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	return {
		Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0", Token="${token}"`,
		'X-Emby-Token': token
	};
}

async function jfFetchUser(
	config: ServiceConfig,
	path: string,
	params?: Record<string, string>,
	userCred?: UserCredential,
	timeoutMs = 8000
) {
	const url = new URL(`${config.url}${path}`);
	if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url.toString(), {
		headers: resolvedHeaders(config, userCred),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`Jellyfin ${path} → ${res.status}`);
	return res.json();
}

// ---------------------------------------------------------------------------
// Stream URL builder
// ---------------------------------------------------------------------------

function buildStreamUrl(config: ServiceConfig, item: any): string | undefined {
	const type = item.Type;
	// Only playable types get stream URLs
	if (['Movie', 'Episode', 'Audio', 'LiveTvChannel'].includes(type)) {
		// Use the Nexus proxy to keep the user inside the app
		// The proxy route /api/stream/[serviceId]/[itemId] will forward to Jellyfin
		return `/api/stream/${config.id}/${item.Id}`;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const FIELDS = 'Overview,Genres,Studios,BackdropImageTags,ImageTags,UserData,ParentId,SeriesId,SeriesName,ParentIndexNumber,IndexNumber,AlbumArtist,Artists,ArtistItems,Album,AlbumId';

function mediaType(jfType: string): UnifiedMedia['type'] {
	switch (jfType) {
		case 'Movie':
			return 'movie';
		case 'Series':
			return 'show';
		case 'Episode':
			return 'episode';
		case 'MusicAlbum':
			return 'album';
		case 'Audio':
			return 'music';
		case 'LiveTvChannel':
			return 'live';
		default:
			return 'movie';
	}
}

function posterUrl(config: ServiceConfig, itemId: string) {
	return `${config.url}/Items/${itemId}/Images/Primary?quality=90&maxWidth=600`;
}

function thumbUrl(config: ServiceConfig, itemId: string) {
	return `${config.url}/Items/${itemId}/Images/Primary?quality=90&maxWidth=800`;
}

function backdropUrl(config: ServiceConfig, itemId: string, index = 0) {
	return `${config.url}/Items/${itemId}/Images/Backdrop/${index}?quality=90&maxWidth=1920`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	const type = mediaType(item.Type);
	const ud = item.UserData;

	// Poster: for episodes always use the series poster (episode Primary is a landscape thumbnail).
	// For everything else use item's own Primary, falling back to parent.
	const isEpisode = item.Type === 'Episode';
	const hasPrimary = item.ImageTags?.Primary;
	const posterItemId = isEpisode
		? (item.SeriesId ?? item.ParentId ?? (hasPrimary ? item.Id : null))
		: (hasPrimary ? item.Id : (item.SeriesId ?? item.ParentId ?? null));

	// Thumb: episode's own Primary image (landscape screenshot) — useful for episode lists
	const thumbItemId = isEpisode && hasPrimary ? item.Id : null;

	// Backdrop: item's own, else parent's
	const hasBackdrop = (item.BackdropImageTags?.length ?? 0) > 0;
	const backdropItemId = hasBackdrop ? item.Id : (item.ParentBackdropItemId ?? null);

	// Progress: PlayedPercentage (0-100) → 0-1, or derive from ticks
	let progress: number | undefined;
	if (ud?.PlayedPercentage != null) {
		progress = Math.min(1, ud.PlayedPercentage / 100);
	} else if (ud?.PlaybackPositionTicks && item.RunTimeTicks) {
		progress = Math.min(1, ud.PlaybackPositionTicks / item.RunTimeTicks);
	}

	// Friendly title for episodes: "Title" (Show name and code in metadata)
	const title = item.Name ?? 'Unknown';

	// Extract cast / People from the raw item if present
	const cast: Array<{ name: string; role: string; type: string; imageUrl?: string }> = [];
	if (Array.isArray(item.People)) {
		for (const p of item.People) {
			cast.push({
				name: p.Name ?? '',
				role: p.Role ?? p.Type ?? '',
				type: p.Type ?? 'Actor',
				imageUrl: p.PrimaryImageTag ? `${config.url}/Items/${p.Id}/Images/Primary?quality=90&maxWidth=200` : undefined
			});
		}
	}

	// Official rating (e.g. PG-13, TV-MA)
	const officialRating = item.OfficialRating ?? undefined;
	// Critic rating (from Rotten Tomatoes)
	const criticRating = item.CriticRating ?? undefined;

	return {
		id: `${item.Id}:${config.id}`,
		sourceId: item.Id,
		serviceId: config.id,
		serviceType: 'jellyfin',
		type,
		title,
		sortTitle: item.SortName,
		description: item.Overview,
		poster: posterItemId ? posterUrl(config, posterItemId) : undefined,
		backdrop: backdropItemId ? backdropUrl(config, backdropItemId) : undefined,
		thumb: thumbItemId ? thumbUrl(config, thumbItemId) : undefined,
		year: item.ProductionYear,
		rating: item.CommunityRating,
		genres: item.Genres ?? [],
		studios: item.Studios?.map((s: { Name: string }) => s.Name) ?? [],
		duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : undefined,
		status: 'available',
		progress,
		metadata: {
			jellyfinId: item.Id,
			userData: ud,
			seriesId: item.SeriesId,
			seriesName: item.SeriesName,
			seasonNumber: item.ParentIndexNumber,
			episodeNumber: item.IndexNumber,
			episodeTitle: item.Type === 'Episode' ? item.Name : undefined,
			cast,
			officialRating,
			criticRating,
			taglines: item.Taglines ?? [],
			endDate: item.EndDate,
			// Music-specific fields
			artist: item.AlbumArtist ?? item.Artists?.[0] ?? item.ArtistItems?.[0]?.Name,
			artistId: item.ArtistItems?.[0]?.Id,
			albumId: item.AlbumId,
			albumName: item.Album,
			trackNumber: item.IndexNumber,
			discNumber: item.ParentIndexNumber,
			artistImageUrl: item.ArtistItems?.[0]?.Id
				? `${config.url}/Items/${item.ArtistItems[0].Id}/Images/Primary?quality=90&maxWidth=300`
				: undefined
		},
		actionLabel: type === 'music' || type === 'album' ? 'Listen' : 'Watch',
		actionUrl: `${config.url}/web/index.html#!/details?id=${item.Id}`,
		streamUrl: buildStreamUrl(config, item)
	};
}

// ---------------------------------------------------------------------------
// Season helpers (exported for use by page server)
// ---------------------------------------------------------------------------

export interface JellyfinSeason {
	id: string;
	name: string;
	seasonNumber: number;
	episodeCount: number;
	imageUrl?: string;
	unplayedCount?: number;
}

export async function getSeasons(
	config: ServiceConfig,
	seriesId: string,
	userCred?: UserCredential
): Promise<JellyfinSeason[]> {
	try {
		const userId = await getUserId(config, userCred);
		const data = await jfFetchUser(config, `/Shows/${seriesId}/Seasons`, {
			UserId: userId,
			EnableUserData: 'true'
		}, userCred);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (data.Items ?? []).map((s: any) => ({
			id: s.Id,
			name: s.Name ?? `Season ${s.IndexNumber}`,
			seasonNumber: s.IndexNumber ?? 0,
			episodeCount: s.ChildCount ?? 0,
			imageUrl: s.ImageTags?.Primary ? posterUrl(config, s.Id) : undefined,
			unplayedCount: s.UserData?.UnplayedItemCount ?? 0
		}));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Music helpers (exported for use by music API)
// ---------------------------------------------------------------------------

export async function getAlbums(
	config: ServiceConfig,
	userCred?: UserCredential,
	opts?: { genre?: string; artistId?: string; sort?: string; limit?: number; offset?: number }
): Promise<{ items: UnifiedMedia[]; total: number }> {
	try {
		const userId = await getUserId(config, userCred);
		const params: Record<string, string> = {
			IncludeItemTypes: 'MusicAlbum',
			Recursive: 'true',
			SortBy: opts?.sort === 'year' ? 'ProductionYear' : opts?.sort === 'rating' ? 'CommunityRating' : opts?.sort === 'added' ? 'DateCreated' : 'SortName',
			SortOrder: opts?.sort === 'year' || opts?.sort === 'added' ? 'Descending' : 'Ascending',
			Limit: String(opts?.limit ?? 50),
			StartIndex: String(opts?.offset ?? 0),
			Fields: FIELDS,
			EnableUserData: 'true',
			EnableImages: 'true'
		};
		if (opts?.genre) params.Genres = opts.genre;
		if (opts?.artistId) params.ArtistIds = opts.artistId;

		const data = await jfFetchUser(config, `/Users/${userId}/Items`, params, userCred);
		return {
			items: (data.Items ?? []).map((i: unknown) => normalize(config, i)),
			total: data.TotalRecordCount ?? 0
		};
	} catch {
		return { items: [], total: 0 };
	}
}

export async function getAlbumTracks(
	config: ServiceConfig,
	albumId: string,
	userCred?: UserCredential
): Promise<UnifiedMedia[]> {
	try {
		const userId = await getUserId(config, userCred);
		const data = await jfFetchUser(config, `/Users/${userId}/Items`, {
			ParentId: albumId,
			IncludeItemTypes: 'Audio',
			SortBy: 'ParentIndexNumber,IndexNumber',
			SortOrder: 'Ascending',
			Fields: FIELDS,
			EnableUserData: 'true'
		}, userCred);
		return (data.Items ?? []).map((i: unknown) => normalize(config, i));
	} catch {
		return [];
	}
}

export async function getArtists(
	config: ServiceConfig,
	userCred?: UserCredential,
	opts?: { sort?: string; limit?: number; offset?: number }
): Promise<{ items: Array<{ id: string; name: string; sortName?: string; albumCount: number; imageUrl?: string; backdrop?: string; genres?: string[]; overview?: string }>; total: number }> {
	try {
		const userId = await getUserId(config, userCred);
		const data = await jfFetchUser(config, '/Artists', {
			userId,
			SortBy: opts?.sort === 'album-count' ? 'AlbumCount' : 'SortName',
			SortOrder: opts?.sort === 'album-count' ? 'Descending' : 'Ascending',
			Limit: String(opts?.limit ?? 50),
			StartIndex: String(opts?.offset ?? 0),
			Fields: 'Overview,Genres,ImageTags,BackdropImageTags',
			EnableImages: 'true'
		}, userCred);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const items = (data.Items ?? []).map((a: any) => ({
			id: a.Id,
			name: a.Name ?? 'Unknown Artist',
			sortName: a.SortName,
			albumCount: a.AlbumCount ?? a.ChildCount ?? 0,
			imageUrl: a.ImageTags?.Primary ? `${config.url}/Items/${a.Id}/Images/Primary?quality=90&maxWidth=300` : undefined,
			backdrop: (a.BackdropImageTags?.length ?? 0) > 0 ? `${config.url}/Items/${a.Id}/Images/Backdrop/0?quality=90&maxWidth=1920` : undefined,
			genres: a.Genres ?? [],
			overview: a.Overview
		}));
		return { items, total: data.TotalRecordCount ?? 0 };
	} catch {
		return { items: [], total: 0 };
	}
}

export async function getArtistAlbums(
	config: ServiceConfig,
	artistId: string,
	userCred?: UserCredential
): Promise<UnifiedMedia[]> {
	try {
		const userId = await getUserId(config, userCred);
		const data = await jfFetchUser(config, `/Users/${userId}/Items`, {
			ArtistIds: artistId,
			IncludeItemTypes: 'MusicAlbum',
			Recursive: 'true',
			SortBy: 'ProductionYear',
			SortOrder: 'Descending',
			Fields: FIELDS,
			EnableUserData: 'true',
			EnableImages: 'true'
		}, userCred);
		return (data.Items ?? []).map((i: unknown) => normalize(config, i));
	} catch {
		return [];
	}
}

export async function getInstantMix(
	config: ServiceConfig,
	itemId: string,
	userCred?: UserCredential,
	limit = 20
): Promise<UnifiedMedia[]> {
	try {
		const userId = await getUserId(config, userCred);
		const data = await jfFetchUser(config, `/Items/${itemId}/InstantMix`, {
			userId,
			Limit: String(limit),
			Fields: FIELDS,
			EnableUserData: 'true'
		}, userCred);
		return (data.Items ?? []).map((i: unknown) => normalize(config, i));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const jellyfinAdapter: ServiceAdapter = {
	id: 'jellyfin',
	displayName: 'Jellyfin',
	defaultPort: 8096,
	icon: 'jellyfin',
	mediaTypes: ['movie', 'show', 'music', 'live'],
	userLinkable: true,

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await jfFetch(config, '/System/Info/Public');
			// Warm up the userId cache in the background (non-blocking)
			getUserId(config).catch(() => {});
			return { serviceId: config.id, name: config.name, type: 'jellyfin', online: true, latency: Date.now() - start };
		} catch (e) {
			return { serviceId: config.id, name: config.name, type: 'jellyfin', online: false, error: String(e) };
		}
	},

	/** Items the user has started but not finished */
	async getContinueWatching(config, userCred?): Promise<UnifiedMedia[]> {
		// Requires a linked user account — never fall back to admin credentials
		if (!userCred?.externalUserId) return [];
		try {
			const userId = await getUserId(config, userCred);
			const data = await jfFetchUser(config, `/Users/${userId}/Items/Resume`, {
				Limit: '20',
				Fields: FIELDS,
				MediaTypes: 'Video',
				EnableUserData: 'true'
			}, userCred);
			return (data.Items ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	/** Items added to the library recently */
	async getRecentlyAdded(config, userCred?): Promise<UnifiedMedia[]> {
		try {
			const userId = await getUserId(config, userCred);
			const data = await jfFetchUser(config, `/Users/${userId}/Items/Latest`, {
				Limit: '20',
				Fields: FIELDS,
				IncludeItemTypes: 'Movie,Series,MusicAlbum',
				EnableUserData: 'true',
				EnableImages: 'true'
			}, userCred);
			return (Array.isArray(data) ? data : []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	/**
	 * "Up Next" — the next episode of shows the user is watching.
	 * Falls back to Suggestions if NextUp returns nothing.
	 */
	async getTrending(config, userCred?): Promise<UnifiedMedia[]> {
		// NextUp and Suggestions are personal — skip if no linked account
		if (!userCred?.externalUserId) return [];
		try {
			const userId = await getUserId(config, userCred);
			const nextUp = await jfFetchUser(config, '/Shows/NextUp', {
				UserId: userId,
				Limit: '20',
				Fields: FIELDS,
				EnableUserData: 'true',
				EnableRewatching: 'false'
			}, userCred);
			const items: UnifiedMedia[] = (nextUp.Items ?? []).map((i: unknown) => normalize(config, i));
			if (items.length > 0) return items;

			// Fall back to Jellyfin suggestions (server-side recommendations)
			const suggestions = await jfFetchUser(config, `/Users/${userId}/Suggestions`, {
				Limit: '20',
				Fields: FIELDS,
				MediaType: 'Video'
			}, userCred);
			return (suggestions.Items ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	/** Full-text search across movies, shows, episodes, music */
	async search(config, query, userCred?): Promise<UnifiedSearchResult> {
		try {
			const userId = await getUserId(config, userCred);
			const data = await jfFetchUser(config, `/Users/${userId}/Items`, {
				searchTerm: query,
				IncludeItemTypes: 'Movie,Series,Episode,MusicAlbum,Audio',
				Recursive: 'true',
				Limit: '30',
				Fields: FIELDS,
				EnableUserData: 'true'
			}, userCred);
			return {
				items: (data.Items ?? []).map((i: unknown) => normalize(config, i)),
				total: data.TotalRecordCount ?? 0,
				source: 'jellyfin'
			};
		} catch {
			return { items: [], total: 0, source: 'jellyfin' };
		}
	},

	/** Browse the full library, optionally filtered by media type */
	async getLibrary(config, opts = {}, userCred?): Promise<{ items: UnifiedMedia[]; total: number }> {
		try {
			const userId = await getUserId(config, userCred);
			const typeMap: Record<string, string> = {
				movie: 'Movie',
				show: 'Series',
				music: 'Audio',
				album: 'MusicAlbum',
				episode: 'Episode'
			};
			const includeTypes = opts.type ? typeMap[opts.type] ?? 'Movie,Series,MusicAlbum' : 'Movie,Series,MusicAlbum';
			const sortMap: Record<string, string> = { title: 'SortName', year: 'ProductionYear', rating: 'CommunityRating', added: 'DateCreated' };
			const sortBy = sortMap[opts.sortBy ?? 'title'] ?? 'SortName';
			const data = await jfFetchUser(config, `/Users/${userId}/Items`, {
				IncludeItemTypes: includeTypes,
				Recursive: 'true',
				SortBy: sortBy,
				SortOrder: 'Ascending',
				Limit: String(opts.limit ?? 100),
				StartIndex: String(opts.offset ?? 0),
				Fields: FIELDS,
				EnableUserData: 'true',
				EnableImages: 'true'
			}, userCred);
			return {
				items: (data.Items ?? []).map((i: unknown) => normalize(config, i)),
				total: data.TotalRecordCount ?? 0
			};
		} catch {
			return { items: [], total: 0 };
		}
	},

	/** Live TV channels */
	async getLiveChannels(config, userCred?): Promise<UnifiedMedia[]> {
		try {
			const userId = await getUserId(config, userCred);
			const data = await jfFetchUser(config, '/LiveTv/Channels', {
				userId,
				Limit: '100',
				AddCurrentProgram: 'true',
				EnableUserData: 'true'
			}, userCred);
			return (data.Items ?? []).map((ch: Record<string, unknown>) => ({
				id: `${ch.Id}:${config.id}`,
				sourceId: ch.Id as string,
				serviceId: config.id,
				serviceType: 'jellyfin',
				type: 'live' as const,
				title: ch.Name as string ?? 'Unknown',
				poster: ch.Id ? posterUrl(config, ch.Id as string) : undefined,
				status: 'available' as const,
				metadata: { channelNumber: ch.ChannelNumber, currentProgram: (ch.CurrentProgram as Record<string, unknown>)?.Name },
				actionLabel: 'Watch Live',
				actionUrl: `${config.url}/web/index.html#!/livetv`
			}));
		} catch {
			return [];
		}
	},

	/** Fetch a single item by its Jellyfin ID */
	async getItem(config, sourceId, userCred?): Promise<UnifiedMedia | null> {
		try {
			const userId = await getUserId(config, userCred);
			const item = await jfFetchUser(config, `/Users/${userId}/Items/${sourceId}`, {
				Fields: `${FIELDS},People,MediaStreams,Chapters`
			}, userCred);
			return normalize(config, item);
		} catch {
			return null;
		}
	},

	/** Fetch similar items for a given Jellyfin item */
	async getSimilar(config: ServiceConfig, sourceId: string, userCred?: UserCredential): Promise<UnifiedMedia[]> {
		try {
			const userId = await getUserId(config, userCred);
			const data = await jfFetchUser(config, `/Items/${sourceId}/Similar`, {
				UserId: userId,
				Limit: '12',
				Fields: FIELDS
			}, userCred);
			return (data.Items ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	/** Fetch all episodes for a season of a show */
	async getSeasonEpisodes(config: ServiceConfig, seriesId: string, seasonNumber: number, userCred?: UserCredential): Promise<UnifiedMedia[]> {
		try {
			const userId = await getUserId(config, userCred);
			const data = await jfFetchUser(config, `/Shows/${seriesId}/Episodes`, {
				UserId: userId,
				Season: String(seasonNumber),
				Fields: FIELDS,
				EnableUserData: 'true'
			}, userCred);
			return (data.Items ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	/** Authenticate a Jellyfin user — returns access token + userId */
	async authenticateUser(config, username, password) {
		const url = `${config.url}/Users/AuthenticateByName`;
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				...authHeaders(config),
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ Username: username, Pw: password }),
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) throw new Error(`Jellyfin auth failed: ${res.status}`);
		const data = await res.json();
		return {
			accessToken: data.AccessToken as string,
			externalUserId: data.User?.Id as string,
			externalUsername: data.User?.Name as string
		};
	},

	/** List all Jellyfin users (admin API key required) */
	async getUsers(config): Promise<ExternalUser[]> {
		const users = await jfFetch(config, '/Users');
		const list: Array<{ Id: string; Name: string; Policy?: { IsAdministrator?: boolean } }> =
			Array.isArray(users) ? users : (users.Items ?? []);
		return list.map((u) => ({
			externalId: u.Id,
			username: u.Name,
			isAdmin: u.Policy?.IsAdministrator ?? false,
			serviceType: 'jellyfin'
		}));
	},

	/** Create a new user on Jellyfin and return auth credentials */
	async createUser(config, username, password) {
		// 1. Create the user via admin API
		const createRes = await fetch(`${config.url}/Users/New`, {
			method: 'POST',
			headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
			body: JSON.stringify({ Name: username, Password: password }),
			signal: AbortSignal.timeout(10000)
		});
		if (!createRes.ok) {
			const text = await createRes.text().catch(() => '');
			throw new Error(`Jellyfin user creation failed (${createRes.status}): ${text}`);
		}
		const created = await createRes.json();

		// 2. Authenticate as the new user to get a token
		const authRes = await fetch(`${config.url}/Users/AuthenticateByName`, {
			method: 'POST',
			headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
			body: JSON.stringify({ Username: username, Pw: password }),
			signal: AbortSignal.timeout(8000)
		});
		if (!authRes.ok) throw new Error(`Jellyfin auth after creation failed: ${authRes.status}`);
		const authData = await authRes.json();

		return {
			accessToken: authData.AccessToken as string,
			externalUserId: (created.Id ?? authData.User?.Id) as string,
			externalUsername: username
		};
	}
};

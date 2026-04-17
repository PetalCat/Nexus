import type { ServiceAdapter } from './base';
import { AdapterAuthError } from './errors';
import type {
	ExternalUser,
	NexusSession,
	ServiceConfig,
	ServiceHealth,
	SyncItem,
	UnifiedMedia,
	UnifiedSearchResult,
	UserCredential
} from './types';
import { proxyImageUrl } from '$lib/image-proxy';

// ---------------------------------------------------------------------------
// Auth & fetch
// ---------------------------------------------------------------------------

function plexHeaders(config: ServiceConfig, userCred?: UserCredential): Record<string, string> {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	return {
		'X-Plex-Token': token,
		'X-Plex-Client-Identifier': 'nexus',
		'X-Plex-Product': 'Nexus',
		'X-Plex-Version': '1.0.0',
		Accept: 'application/json'
	};
}

async function plexFetch(
	config: ServiceConfig,
	path: string,
	params?: Record<string, string>,
	userCred?: UserCredential,
	timeoutMs = 8000
) {
	const base = config.url.replace(/\/+$/, '');
	const url = new URL(`${base}${path}`);
	if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url.toString(), {
		headers: plexHeaders(config, userCred),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`Plex ${path} → ${res.status}`);
	return res.json();
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function mediaType(plexType: string): UnifiedMedia['type'] {
	switch (plexType) {
		case 'movie':
			return 'movie';
		case 'show':
			return 'show';
		case 'episode':
			return 'episode';
		case 'artist':
			return 'music';
		case 'album':
			return 'album';
		case 'track':
			return 'music';
		default:
			return 'movie';
	}
}

function imageUrl(config: ServiceConfig, path: string | undefined, _userCred?: UserCredential): string | undefined {
	if (!path) return undefined;
	// Route through the Nexus image proxy so the browser never sees the Plex
	// origin or X-Plex-Token. The proxy uses `getImageHeaders` to forward the
	// X-Plex-Token server-side. Mirrors Jellyfin's `proxyPath` behavior.
	return proxyImageUrl(`${config.url.replace(/\/+$/, '')}${path}`, config.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any, userCred?: UserCredential): UnifiedMedia {
	const type = mediaType(item.type);

	// Progress from viewOffset / duration (both in ms)
	let progress: number | undefined;
	if (item.viewOffset && item.duration) {
		progress = Math.min(1, item.viewOffset / item.duration);
	}

	// Cast from Role array
	const cast: Array<{ name: string; role: string; type: string; imageUrl?: string }> = [];
	if (Array.isArray(item.Role)) {
		for (const r of item.Role) {
			cast.push({
				name: r.tag ?? '',
				role: r.role ?? '',
				type: 'Actor',
				imageUrl: r.thumb ? imageUrl(config, r.thumb, userCred) : undefined
			});
		}
	}

	// Stream URL — route through Nexus so the browser never sees X-Plex-Token.
	// Only set for playable leaf types.
	let streamUrl: string | undefined;
	if (['movie', 'episode', 'track'].includes(item.type) && item.ratingKey) {
		streamUrl = `/api/stream/${config.id}/${item.ratingKey}`;
	}

	// Plex `Guid` array carries external IDs (tmdb://, imdb://, tvdb://) —
	// used downstream for Bazarr/Overseerr/etc. cross-service resolution.
	const providerIds: Record<string, string> = {};
	let tmdbId: string | null = null;
	let imdbId: string | null = null;
	if (Array.isArray(item.Guid)) {
		for (const g of item.Guid) {
			const id = String(g.id ?? '');
			if (id.startsWith('tmdb://')) {
				tmdbId = id.slice('tmdb://'.length);
				providerIds.Tmdb = tmdbId;
			} else if (id.startsWith('imdb://')) {
				imdbId = id.slice('imdb://'.length);
				providerIds.Imdb = imdbId;
			} else if (id.startsWith('tvdb://')) {
				providerIds.Tvdb = id.slice('tvdb://'.length);
			}
		}
	}

	return {
		id: `${item.ratingKey}:${config.id}`,
		sourceId: String(item.ratingKey),
		serviceId: config.id,
		serviceType: 'plex',
		type,
		title: item.title ?? 'Unknown',
		sortTitle: item.titleSort,
		description: item.summary,
		poster: imageUrl(config, item.thumb, userCred),
		backdrop: imageUrl(config, item.art, userCred),
		year: item.year,
		rating: item.rating,
		genres: item.Genre?.map((g: { tag: string }) => g.tag) ?? [],
		studios: item.Studio ? [item.Studio] : [],
		duration: item.duration ? Math.round(item.duration / 1000) : undefined,
		status: 'available',
		progress,
		metadata: {
			plexRatingKey: item.ratingKey,
			cast,
			seriesId: item.grandparentRatingKey ? String(item.grandparentRatingKey) : undefined,
			seriesName: item.grandparentTitle,
			seasonNumber: item.parentIndex,
			episodeNumber: item.index,
			episodeTitle: item.type === 'episode' ? item.title : undefined,
			contentRating: item.contentRating,
			officialRating: item.contentRating,
			criticRating: item.rating,
			taglines: item.tagline ? [item.tagline] : [],
			tmdbId,
			imdbId,
			providerIds,
			// Music-specific
			artist: item.grandparentTitle ?? item.parentTitle,
			artistId: item.grandparentRatingKey ? String(item.grandparentRatingKey) : undefined,
			albumId: item.parentRatingKey ? String(item.parentRatingKey) : undefined,
			albumName: item.parentTitle,
			trackNumber: item.index
		},
		actionLabel: type === 'music' || type === 'album' ? 'Listen' : 'Watch',
		actionUrl: `${config.url}/web/index.html#!/server/${config.id}/details?key=${encodeURIComponent(`/library/metadata/${item.ratingKey}`)}`,
		streamUrl
	};
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

const PLEX_SESSION_TYPE_MAP: Record<string, string> = {
	movie: 'movie',
	episode: 'episode',
	track: 'music',
	clip: 'movie'
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const plexAdapter: ServiceAdapter = {
	id: 'plex',
	displayName: 'Plex',
	defaultPort: 32400,
	color: '#e5a00d',
	abbreviation: 'PX',
	mediaTypes: ['movie', 'show', 'music'],
	isLibrary: true,
	isSearchable: true,
	searchPriority: 0,
	userLinkable: true,
	pollIntervalMs: 10_000,
	authUsernameLabel: 'Email (optional)',
	onboarding: {
		category: 'media-server',
		description: 'Stream your Plex media library',
		priority: 2,
		requiredFields: ['url', 'username', 'password'],
		supportsAutoAuth: true,
	},

	contractVersion: 1,
	tier: 'user-standalone',
	capabilities: {
		media: ['movie', 'show', 'music'],
		adminAuth: {
			required: true,
			fields: ['url', 'adminApiKey'],
			supportsHealthProbe: true
		},
		userAuth: {
			userLinkable: true,
			usernameLabel: 'Email (optional)',
			supportsRegistration: false,
			supportsAccountCreation: false,
			// X-Plex-Token is effectively permanent — no need for stored-password refresh
			supportsPasswordStorage: false,
			supportsHealthProbe: true
		},
		library: true,
		search: { priority: 0 },
		sessions: { pollIntervalMs: 10_000 }
	},

	async probeAdminCredential(config) {
		try {
			const res = await fetch(`${config.url}/identity`, {
				headers: {
					'X-Plex-Token': config.apiKey ?? '',
					Accept: 'application/json'
				},
				signal: AbortSignal.timeout(5000)
			});
			if (res.status === 401) return 'invalid';
			if (!res.ok) return 'expired';
			return 'ok';
		} catch {
			return 'expired';
		}
	},

	async probeCredential(config, userCred) {
		try {
			const token = userCred.accessToken;
			if (!token) return 'invalid';
			const res = await fetch(`${config.url}/`, {
				headers: {
					'X-Plex-Token': token,
					Accept: 'application/json'
				},
				signal: AbortSignal.timeout(5000)
			});
			if (res.status === 401) return 'invalid';
			if (!res.ok) return 'expired';
			return 'ok';
		} catch {
			return 'expired';
		}
	},

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			const data = await plexFetch(config, '/');
			const serverName = data?.MediaContainer?.friendlyName ?? config.name;
			return {
				serviceId: config.id,
				name: serverName,
				type: 'plex',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'plex',
				online: false,
				error: String(e)
			};
		}
	},

	async getContinueWatching(config, userCred?): Promise<UnifiedMedia[]> {
		try {
			const data = await plexFetch(config, '/library/onDeck', undefined, userCred);
			const items = data?.MediaContainer?.Metadata ?? [];
			return items.map((i: unknown) => normalize(config, i, userCred));
		} catch {
			return [];
		}
	},

	async getRecentlyAdded(config, userCred?): Promise<UnifiedMedia[]> {
		try {
			const data = await plexFetch(config, '/library/recentlyAdded', undefined, userCred);
			const items = data?.MediaContainer?.Metadata ?? [];
			return items.map((i: unknown) => normalize(config, i, userCred));
		} catch {
			return [];
		}
	},

	async search(config, query, userCred?): Promise<UnifiedSearchResult> {
		try {
			const data = await plexFetch(config, '/search', { query }, userCred);
			const items = data?.MediaContainer?.Metadata ?? [];
			return {
				items: items.map((i: unknown) => normalize(config, i, userCred)),
				total: items.length,
				source: 'plex'
			};
		} catch {
			return { items: [], total: 0, source: 'plex' };
		}
	},

	async getItem(config, sourceId, userCred?): Promise<UnifiedMedia | null> {
		try {
			const data = await plexFetch(config, `/library/metadata/${sourceId}`, undefined, userCred);
			const item = data?.MediaContainer?.Metadata?.[0];
			if (!item) return null;
			return normalize(config, item, userCred);
		} catch {
			return null;
		}
	},

	async getLibrary(config, opts = {}, userCred?): Promise<{ items: UnifiedMedia[]; total: number }> {
		try {
			// First, get all library sections
			const sections = await plexFetch(config, '/library/sections', undefined, userCred);
			const dirs = sections?.MediaContainer?.Directory ?? [];

			// If a type filter is given, map to Plex section types
			const typeMap: Record<string, string> = {
				movie: 'movie',
				show: 'show',
				music: 'artist'
			};
			const wantedType = opts.type ? typeMap[opts.type] : undefined;

			// Filter sections by type if requested
			const filteredDirs = wantedType
				? dirs.filter((d: { type: string }) => d.type === wantedType)
				: dirs;

			if (filteredDirs.length === 0) return { items: [], total: 0 };

			// Fetch items from the first matching section (or aggregate)
			const allItems: UnifiedMedia[] = [];
			let totalCount = 0;

			for (const dir of filteredDirs) {
				const params: Record<string, string> = {
					'X-Plex-Container-Start': String(opts.offset ?? 0),
					'X-Plex-Container-Size': String(opts.limit ?? 50)
				};
				const data = await plexFetch(
					config,
					`/library/sections/${dir.key}/all`,
					params,
					userCred
				);
				const container = data?.MediaContainer ?? {};
				const items = container.Metadata ?? [];
				totalCount += container.totalSize ?? items.length;
				allItems.push(...items.map((i: unknown) => normalize(config, i, userCred)));

				// If we already have enough items, stop
				if (allItems.length >= (opts.limit ?? 50)) break;
			}

			return {
				items: allItems.slice(0, opts.limit ?? 50),
				total: totalCount
			};
		} catch {
			return { items: [], total: 0 };
		}
	},

	async getSimilar(config, sourceId, userCred?): Promise<UnifiedMedia[]> {
		try {
			const data = await plexFetch(
				config,
				`/library/metadata/${sourceId}/similar`,
				undefined,
				userCred
			);
			const items = data?.MediaContainer?.Metadata ?? [];
			return items.map((i: unknown) => normalize(config, i, userCred));
		} catch {
			return [];
		}
	},

	/**
	 * Plex "trending" analog — on-deck (i.e. next up) for the authenticated user.
	 * Mirrors the Jellyfin `getTrending` which returns Next-Up items, falling back
	 * to server-side recommendations when Next-Up is empty.
	 */
	async getTrending(config, userCred?): Promise<UnifiedMedia[]> {
		if (!userCred?.accessToken && !config.apiKey) return [];
		try {
			const data = await plexFetch(config, '/library/onDeck', undefined, userCred);
			const items = data?.MediaContainer?.Metadata ?? [];
			return items.map((i: unknown) => normalize(config, i, userCred));
		} catch {
			return [];
		}
	},

	/** Fetch all episodes for a given season of a show */
	async getSeasonEpisodes(config, seriesId, seasonNumber, userCred?): Promise<UnifiedMedia[]> {
		try {
			// Plex: seasons are children of the series, and episodes are children
			// of the season. We need to resolve the correct season's ratingKey.
			const seasonsData = await plexFetch(
				config,
				`/library/metadata/${seriesId}/children`,
				undefined,
				userCred
			);
			const seasons = seasonsData?.MediaContainer?.Metadata ?? [];
			const season = seasons.find((s: any) => Number(s.index) === Number(seasonNumber));
			if (!season?.ratingKey) return [];
			const epsData = await plexFetch(
				config,
				`/library/metadata/${season.ratingKey}/children`,
				undefined,
				userCred
			);
			const episodes = epsData?.MediaContainer?.Metadata ?? [];
			return episodes.map((i: unknown) => normalize(config, i, userCred));
		} catch {
			return [];
		}
	},

	/** Seasons / sub-items. Currently supports 'season'. */
	async getSubItems(config, parentId, type, _opts, userCred) {
		if (type !== 'season') return { items: [], total: 0 };
		try {
			const data = await plexFetch(
				config,
				`/library/metadata/${parentId}/children`,
				undefined,
				userCred
			);
			const seasons = data?.MediaContainer?.Metadata ?? [];
			// Shape matches the JellyfinSeason type so media/[type]/[id] can render it.
			const items = seasons
				.filter((s: any) => s.type === 'season')
				.map((s: any) => ({
					id: String(s.ratingKey),
					name: s.title ?? `Season ${s.index ?? 0}`,
					seasonNumber: Number(s.index ?? 0),
					episodeCount: Number(s.leafCount ?? 0),
					imageUrl: s.thumb ? imageUrl(config, s.thumb, userCred) : undefined,
					unplayedCount: Number(s.leafCount ?? 0) - Number(s.viewedLeafCount ?? 0)
				}));
			return { items: items as unknown as UnifiedMedia[], total: items.length };
		} catch {
			return { items: [], total: 0 };
		}
	},

	/**
	 * List all users on this Plex server (owner + shared-home/friends).
	 * Requires the server's admin X-Plex-Token. Uses plex.tv to enumerate
	 * users who have access, since there's no /Users equivalent on the local
	 * server itself.
	 */
	async getUsers(config): Promise<ExternalUser[]> {
		const token = config.apiKey ?? '';
		if (!token) return [];
		try {
			// 1. Owner account
			const owner: ExternalUser[] = [];
			try {
				const meRes = await fetch('https://plex.tv/api/v2/user', {
					headers: {
						'X-Plex-Token': token,
						'X-Plex-Client-Identifier': 'nexus',
						'X-Plex-Product': 'Nexus',
						Accept: 'application/json'
					},
					signal: AbortSignal.timeout(8000)
				});
				if (meRes.ok) {
					const me = await meRes.json();
					owner.push({
						externalId: String(me.id ?? ''),
						username: me.username ?? me.title ?? 'owner',
						isAdmin: true,
						serviceType: 'plex'
					});
				}
			} catch { /* swallow */ }

			// 2. Shared users from /api/v2/home/users
			const shared: ExternalUser[] = [];
			try {
				const homeRes = await fetch('https://plex.tv/api/v2/home/users', {
					headers: {
						'X-Plex-Token': token,
						'X-Plex-Client-Identifier': 'nexus',
						'X-Plex-Product': 'Nexus',
						Accept: 'application/json'
					},
					signal: AbortSignal.timeout(8000)
				});
				if (homeRes.ok) {
					const data = await homeRes.json();
					// Shape varies by API version — either { users: [] } or an array directly.
					const list = Array.isArray(data) ? data : (data?.users ?? []);
					for (const u of list) {
						shared.push({
							externalId: String(u.id ?? ''),
							username: u.username ?? u.title ?? '',
							isAdmin: !!u.admin,
							serviceType: 'plex'
						});
					}
				}
			} catch { /* swallow */ }

			// De-duplicate by externalId — owner may also appear in home users.
			const seen = new Set<string>();
			return [...owner, ...shared].filter((u) => {
				if (!u.externalId || seen.has(u.externalId)) return false;
				seen.add(u.externalId);
				return true;
			});
		} catch {
			return [];
		}
	},

	async authenticateUser(config, _username, password) {
		// Plex uses tokens directly — the password field is the user's Plex token.
		// Verify the token works against this server.
		const token = password;
		const tempCred: UserCredential = {
			accessToken: token
		};

		// Verify the token works against the server
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let serverData: any;
		try {
			serverData = await plexFetch(config, '/', undefined, tempCred);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (/401|403|unauthorized|forbidden/i.test(msg)) {
				throw new AdapterAuthError('Invalid Plex token', 'invalid');
			}
			if (/unreach|ENOTFOUND|ECONNREFUSED|timeout|abort/i.test(msg)) {
				throw new AdapterAuthError(`Cannot reach Plex at ${config.url}`, 'unreachable');
			}
			throw new AdapterAuthError(msg, 'invalid');
		}
		if (!serverData?.MediaContainer) {
			throw new AdapterAuthError('Plex: token rejected by server', 'invalid');
		}

		// Fetch user info from plex.tv
		let externalUserId = '';
		let externalUsername = '';
		try {
			const res = await fetch('https://plex.tv/api/v2/user', {
				headers: {
					'X-Plex-Token': token,
					'X-Plex-Client-Identifier': 'nexus',
					'X-Plex-Product': 'Nexus',
					Accept: 'application/json'
				},
				signal: AbortSignal.timeout(8000)
			});
			if (res.ok) {
				const user = await res.json();
				externalUserId = String(user.id ?? '');
				externalUsername = user.username ?? user.title ?? '';
			}
		} catch {
			// plex.tv unreachable — use server identity as fallback
			externalUserId = serverData.MediaContainer.machineIdentifier ?? 'plex-user';
			externalUsername = _username || 'Plex User';
		}

		return { accessToken: token, externalUserId, externalUsername };
	},

	async pollSessions(config): Promise<NexusSession[]> {
		try {
			const data = await plexFetch(config, '/status/sessions', undefined, undefined, 5000);
			const sessions = data?.MediaContainer?.Metadata ?? [];
			const results: NexusSession[] = [];

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			for (const session of sessions as any[]) {
				if (!session.ratingKey) continue;

				const isPaused = session.Player?.state === 'paused';
				const mType = PLEX_SESSION_TYPE_MAP[session.type] ?? 'movie';
				const positionMs = session.viewOffset ?? 0;
				const durationMs = session.duration ?? 0;
				const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

				results.push({
					sessionId: session.Session?.id ?? session.sessionKey ?? session.ratingKey,
					userId: session.User?.id ?? '',
					username: session.User?.title ?? 'Unknown',
					mediaId: String(session.ratingKey),
					mediaTitle: session.title,
					mediaType: mType as NexusSession['mediaType'],
					state: isPaused ? 'paused' : 'playing',
					progress,
					positionSeconds: positionMs > 0 ? positionMs / 1000 : undefined,
					durationSeconds: durationMs > 0 ? durationMs / 1000 : undefined,
					device: session.Player?.device ?? session.Player?.title,
					client: session.Player?.product,
					year: session.year,
					genres: session.Genre?.map((g: { tag: string }) => g.tag),
					parentId: session.grandparentRatingKey,
					parentTitle: session.grandparentTitle,
					metadata: {
						streamType: session.TranscodeSession ? 'transcode' : 'direct-play',
						isTranscoding: !!session.TranscodeSession,
						videoCodec: session.Media?.[0]?.videoCodec,
						audioCodec: session.Media?.[0]?.audioCodec,
						resolution: session.Media?.[0]?.videoResolution,
						bitrate: session.Media?.[0]?.bitrate
					}
				});
			}

			return results;
		} catch {
			return [];
		}
	},

	async getImageHeaders(config, userCred) {
		const token = userCred?.accessToken ?? config.apiKey ?? '';
		return { 'X-Plex-Token': token };
	},

	async getServiceData(config, dataType, params, userCred) {
		switch (dataType) {
			case 'libraries': {
				const data = await plexFetch(config, '/library/sections', undefined, userCred);
				return data?.MediaContainer?.Directory ?? [];
			}
			case 'refresh': {
				const sectionId = params?.sectionId as string;
				if (!sectionId) throw new Error('sectionId required for refresh');
				const base = config.url.replace(/\/+$/, '');
				const url = new URL(`${base}/library/sections/${sectionId}/refresh`);
				await fetch(url.toString(), {
					method: 'PUT',
					headers: plexHeaders(config, userCred),
					signal: AbortSignal.timeout(8000)
				});
				return { success: true };
			}
			case 'server-info': {
				const data = await plexFetch(config, '/', undefined, userCred);
				return data?.MediaContainer ?? {};
			}
			default:
				return null;
		}
	}
};

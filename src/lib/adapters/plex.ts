import type { ServiceAdapter } from './base';
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

function imageUrl(config: ServiceConfig, path: string | undefined, userCred?: UserCredential): string | undefined {
	if (!path) return undefined;
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	const base = config.url.replace(/\/+$/, '');
	return `${base}${path}?X-Plex-Token=${token}`;
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

	// Stream URL from Media array
	let streamUrl: string | undefined;
	if (item.Media?.[0]?.Part?.[0]?.key) {
		const token = userCred?.accessToken ?? config.apiKey ?? '';
		const base = config.url.replace(/\/+$/, '');
		streamUrl = `${base}${item.Media[0].Part[0].key}?X-Plex-Token=${token}`;
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
		duration: item.duration ? Math.round(item.duration / 1000) : undefined,
		status: 'available',
		progress,
		metadata: {
			plexRatingKey: item.ratingKey,
			cast,
			seriesName: item.grandparentTitle,
			seasonNumber: item.parentIndex,
			episodeNumber: item.index,
			episodeTitle: item.type === 'episode' ? item.title : undefined,
			contentRating: item.contentRating,
			// Music-specific
			artist: item.grandparentTitle ?? item.parentTitle,
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

	async authenticateUser(config, _username, password) {
		// Plex uses tokens directly — the password field is the user's Plex token.
		// Verify the token works against this server.
		const token = password;
		const tempCred: UserCredential = {
			id: '',
			userId: '',
			serviceId: config.id,
			accessToken: token
		};

		// Verify the token works against the server
		const serverData = await plexFetch(config, '/', undefined, tempCred);
		if (!serverData?.MediaContainer) {
			throw new Error('Plex: token rejected by server');
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

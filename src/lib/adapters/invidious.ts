import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential } from './types';
import { withCache } from '../server/cache';

// ---------------------------------------------------------------------------
// Invidious adapter
//
// Invidious is an alternative front-end to YouTube. This adapter connects
// to a self-hosted Invidious instance and exposes video browsing, search,
// subscriptions, playlists, and watch history.
//
// Config convention:
//   url      -> Invidious instance URL (e.g. http://localhost:3000)
//   username -> admin username (for account provisioning only)
//   password -> admin password (for account provisioning only)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface InvidiousThumbnail {
	quality: string;
	url: string;
	width: number;
	height: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface InvidiousVideo {
	type?: string;
	title: string;
	videoId: string;
	videoThumbnails?: InvidiousThumbnail[];
	description?: string;
	descriptionHtml?: string;
	published?: number;
	publishedText?: string;
	lengthSeconds?: number;
	viewCount?: number;
	viewCountText?: string;
	author?: string;
	authorId?: string;
	authorUrl?: string;
	authorVerified?: boolean;
	genre?: string;
	genreUrl?: string;
	subCountText?: string;
	likeCount?: number;
	dislikeCount?: number;
	keywords?: string[];
	isLive?: boolean;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	adaptiveFormats?: any[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	formatStreams?: any[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	captions?: any[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	recommendedVideos?: any[];
	authorThumbnails?: InvidiousThumbnail[];
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Perform form-based authentication against the Invidious login page.
 * Invidious uses a single "signin" action that auto-registers unknown users
 * when registration is enabled. Returns the SID cookie value on success.
 */
async function formAuth(
	config: ServiceConfig,
	username: string,
	password: string
): Promise<string> {
	const url = `${config.url}/login?type=invidious&referer=%2F`;

	const body = new URLSearchParams({
		email: username,
		password: password,
		action: 'signin'
	});

	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
		redirect: 'manual',
		signal: AbortSignal.timeout(8000)
	});

	// Success = 302 redirect with Set-Cookie containing SID
	if (res.status !== 302) {
		throw new Error(`Invidious auth failed (status ${res.status}) — check credentials`);
	}

	const setCookie = res.headers.get('set-cookie') ?? '';
	const match = setCookie.match(/SID=([^;]+)/);
	if (!match) {
		throw new Error('Invidious auth: no SID cookie in response');
	}

	return match[1];
}

// No separate token generation needed — we store the SID cookie directly
// as the accessToken and send it as a Cookie header in invFetch.

// ---------------------------------------------------------------------------
// Authenticated fetch helper
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invFetch<T = any>(
	config: ServiceConfig,
	path: string,
	userCred?: UserCredential,
	init?: RequestInit
): Promise<T> {
	const url = `${config.url}${path}`;
	const headers: Record<string, string> = {
		...(init?.headers as Record<string, string> ?? {})
	};

	if (userCred?.accessToken) {
		headers['Cookie'] = `SID=${userCred.accessToken}`;
	}

	const res = await fetch(url, {
		...init,
		headers,
		signal: init?.signal ?? AbortSignal.timeout(8000)
	});

	if (!res.ok) {
		throw new Error(`Invidious ${path} -> ${res.status}`);
	}

	// 204 No Content — nothing to parse
	if (res.status === 204 || res.headers.get('content-length') === '0') {
		return undefined as T;
	}

	return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function pickThumbnail(thumbs: InvidiousThumbnail[] | undefined, quality: string): string | undefined {
	if (!thumbs || thumbs.length === 0) return undefined;
	const match = thumbs.find((t) => t.quality === quality);
	return (match ?? thumbs[0])?.url;
}

/**
 * Normalize an Invidious video object into a UnifiedMedia item.
 * When `detail` is true, additional metadata fields are included.
 */
export function normalizeVideo(config: ServiceConfig, item: InvidiousVideo, detail = false): UnifiedMedia {
	const poster = pickThumbnail(item.videoThumbnails, 'medium'); // 320x180
	const backdrop = pickThumbnail(item.videoThumbnails, 'maxres'); // 1280x720

	const year = item.published ? new Date(item.published * 1000).getFullYear() : undefined;

	// Check if any adaptive format is 4K
	const is4k = item.adaptiveFormats?.some(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(f: any) => f.qualityLabel?.includes('2160') || f.qualityLabel?.includes('4K')
	) ?? false;

	// Check for captions
	const hasCaptions = (item.captions && item.captions.length > 0) ?? false;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const metadata: Record<string, any> = {
		viewCount: item.viewCount,
		author: item.author,
		authorId: item.authorId,
		authorUrl: item.authorUrl,
		authorVerified: item.authorVerified,
		publishedText: item.publishedText,
		published: item.published,
		isLive: item.isLive,
		is4k,
		hasCaptions
	};

	if (detail) {
		metadata.likeCount = item.likeCount;
		metadata.keywords = item.keywords;
		metadata.subCountText = item.subCountText;
		metadata.authorThumbnails = item.authorThumbnails;
		metadata.adaptiveFormats = item.adaptiveFormats;
		metadata.formatStreams = item.formatStreams;
		metadata.captions = item.captions;
		metadata.recommendedVideos = item.recommendedVideos?.map((v: InvidiousVideo) =>
			normalizeVideo(config, v)
		);
	}

	return {
		id: `invidious:${item.videoId}`,
		sourceId: item.videoId,
		serviceId: config.id,
		serviceType: 'invidious',
		type: 'video',
		title: item.title,
		description: item.description,
		poster,
		backdrop,
		year,
		duration: item.lengthSeconds,
		genres: item.genre ? [item.genre] : undefined,
		metadata
	};
}

// ---------------------------------------------------------------------------
// ServiceAdapter implementation
// ---------------------------------------------------------------------------

export const invidiousAdapter: ServiceAdapter = {
	id: 'invidious',
	displayName: 'Invidious',
	defaultPort: 3000,
	mediaTypes: ['video'],
	userLinkable: true,
	authUsernameLabel: 'Username',

	async ping(config: ServiceConfig): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await invFetch(config, '/api/v1/stats');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'invidious',
				online: true,
				latency: Date.now() - start
			};
		} catch (err) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'invidious',
				online: false,
				error: err instanceof Error ? err.message : String(err)
			};
		}
	},

	async authenticateUser(
		config: ServiceConfig,
		username: string,
		password: string
	): Promise<{ accessToken: string; externalUserId: string; externalUsername: string }> {
		const sid = await formAuth(config, username, password);
		return {
			accessToken: sid,
			externalUserId: username,
			externalUsername: username
		};
	},

	async createUser(
		config: ServiceConfig,
		username: string,
		password: string
	): Promise<{ accessToken: string; externalUserId: string; externalUsername: string }> {
		// Invidious auto-registers unknown users on signin when registration is enabled
		const sid = await formAuth(config, username, password);
		return {
			accessToken: sid,
			externalUserId: username,
			externalUsername: username
		};
	},

	async search(
		config: ServiceConfig,
		query: string,
		userCred?: UserCredential
	): Promise<UnifiedSearchResult> {
		const params = new URLSearchParams({ q: query, type: 'video' });
		const results = await invFetch<InvidiousVideo[]>(
			config,
			`/api/v1/search?${params}`,
			userCred
		);

		const items = results
			.filter((v) => v.type === 'video' || v.videoId)
			.map((v) => normalizeVideo(config, v));

		return { items, total: items.length, source: config.name };
	},

	async getTrending(config: ServiceConfig, userCred?: UserCredential): Promise<UnifiedMedia[]> {
		return withCache(`invidious:trending:${config.id}`, 120_000, async () => {
			const results = await invFetch<InvidiousVideo[]>(config, '/api/v1/trending', userCred);
			return results.map((v) => normalizeVideo(config, v));
		});
	},

	async getRecentlyAdded(config: ServiceConfig, userCred?: UserCredential): Promise<UnifiedMedia[]> {
		return withCache(`invidious:popular:${config.id}`, 120_000, async () => {
			const results = await invFetch<InvidiousVideo[]>(config, '/api/v1/popular', userCred);
			return results.map((v) => normalizeVideo(config, v));
		});
	},

	async getItem(
		config: ServiceConfig,
		sourceId: string,
		userCred?: UserCredential
	): Promise<UnifiedMedia | null> {
		try {
			const video = await invFetch<InvidiousVideo>(
				config,
				`/api/v1/videos/${encodeURIComponent(sourceId)}`,
				userCred
			);
			return normalizeVideo(config, video, true);
		} catch {
			return null;
		}
	},

	async getLibrary(
		config: ServiceConfig,
		opts?: { type?: string; limit?: number; offset?: number },
		userCred?: UserCredential
	): Promise<{ items: UnifiedMedia[]; total: number }> {
		if (!userCred?.accessToken) {
			return { items: [], total: 0 };
		}
		const page = opts?.offset ? Math.floor(opts.offset / (opts?.limit ?? 20)) + 1 : 1;
		const feed = await invFetch<{ notifications: InvidiousVideo[]; videos: InvidiousVideo[] }>(
			config,
			`/api/v1/auth/feed?page=${page}`,
			userCred
		);
		const items = feed.videos.map((v) => normalizeVideo(config, v));
		return { items, total: items.length };
	}
};

// ---------------------------------------------------------------------------
// Exported helper functions
// ---------------------------------------------------------------------------

/** Get user's subscriptions */
export async function getSubscriptions(
	config: ServiceConfig,
	userCred: UserCredential
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
	return invFetch(config, '/api/v1/auth/subscriptions', userCred);
}

/** Subscribe to a channel */
export async function subscribe(
	config: ServiceConfig,
	channelId: string,
	userCred: UserCredential
): Promise<void> {
	await invFetch(config, `/api/v1/auth/subscriptions/${encodeURIComponent(channelId)}`, userCred, {
		method: 'POST'
	});
}

/** Unsubscribe from a channel */
export async function unsubscribe(
	config: ServiceConfig,
	channelId: string,
	userCred: UserCredential
): Promise<void> {
	await invFetch(config, `/api/v1/auth/subscriptions/${encodeURIComponent(channelId)}`, userCred, {
		method: 'DELETE'
	});
}

/** Get subscription feed (paginated) */
export async function getSubscriptionFeed(
	config: ServiceConfig,
	userCred: UserCredential,
	page = 1
): Promise<{ videos: UnifiedMedia[]; notifications: UnifiedMedia[] }> {
	const feed = await invFetch<{ notifications: InvidiousVideo[]; videos: InvidiousVideo[] }>(
		config,
		`/api/v1/auth/feed?page=${page}`,
		userCred
	);
	return {
		videos: feed.videos.map((v) => normalizeVideo(config, v)),
		notifications: feed.notifications.map((v) => normalizeVideo(config, v))
	};
}

/** Get user's playlists */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getUserPlaylists(config: ServiceConfig, userCred: UserCredential): Promise<any[]> {
	return invFetch(config, '/api/v1/auth/playlists', userCred);
}

/** Create a playlist */
export async function createPlaylist(
	config: ServiceConfig,
	title: string,
	privacy: 'public' | 'unlisted' | 'private',
	userCred: UserCredential
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
	return invFetch(config, '/api/v1/auth/playlists', userCred, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ title, privacy })
	});
}

/** Delete a playlist */
export async function deletePlaylist(
	config: ServiceConfig,
	playlistId: string,
	userCred: UserCredential
): Promise<void> {
	await invFetch(config, `/api/v1/auth/playlists/${encodeURIComponent(playlistId)}`, userCred, {
		method: 'DELETE'
	});
}

/** Add a video to a playlist */
export async function addToPlaylist(
	config: ServiceConfig,
	playlistId: string,
	videoId: string,
	userCred: UserCredential
): Promise<void> {
	await invFetch(config, `/api/v1/auth/playlists/${encodeURIComponent(playlistId)}/videos`, userCred, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ videoId })
	});
}

/** Remove a video from a playlist by index */
export async function removeFromPlaylist(
	config: ServiceConfig,
	playlistId: string,
	index: string,
	userCred: UserCredential
): Promise<void> {
	await invFetch(
		config,
		`/api/v1/auth/playlists/${encodeURIComponent(playlistId)}/videos/${encodeURIComponent(index)}`,
		userCred,
		{ method: 'DELETE' }
	);
}

/** Get watch history (paginated) */
export async function getWatchHistory(
	config: ServiceConfig,
	userCred: UserCredential,
	page = 1
): Promise<string[]> {
	return invFetch(config, `/api/v1/auth/history?page=${page}`, userCred);
}

/** Mark a video as watched */
export async function markWatched(
	config: ServiceConfig,
	videoId: string,
	userCred: UserCredential
): Promise<void> {
	await invFetch(config, `/api/v1/auth/history/${encodeURIComponent(videoId)}`, userCred, {
		method: 'POST'
	});
}

/** Remove a video from watch history */
export async function removeFromHistory(
	config: ServiceConfig,
	videoId: string,
	userCred: UserCredential
): Promise<void> {
	await invFetch(config, `/api/v1/auth/history/${encodeURIComponent(videoId)}`, userCred, {
		method: 'DELETE'
	});
}

/** Get channel info */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getChannel(config: ServiceConfig, channelId: string): Promise<any> {
	return invFetch(config, `/api/v1/channels/${encodeURIComponent(channelId)}`);
}

/** Get channel videos */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getChannelVideos(config: ServiceConfig, channelId: string, sort?: string): Promise<any> {
	const params = sort ? `?sort_by=${encodeURIComponent(sort)}` : '';
	return invFetch(config, `/api/v1/channels/${encodeURIComponent(channelId)}/videos${params}`);
}

/** Get comments for a video */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getComments(config: ServiceConfig, videoId: string, sort?: string): Promise<any> {
	const params = sort ? `?sort_by=${encodeURIComponent(sort)}` : '';
	return invFetch(config, `/api/v1/comments/${encodeURIComponent(videoId)}${params}`);
}

/** Get search suggestions */
export async function getSearchSuggestions(config: ServiceConfig, query: string): Promise<{ query: string; suggestions: string[] }> {
	const params = new URLSearchParams({ q: query });
	return invFetch(config, `/api/v1/search/suggestions?${params}`);
}

/** Get trending videos by category */
export async function getTrendingByCategory(
	config: ServiceConfig,
	category?: 'music' | 'gaming' | 'news' | 'movies'
): Promise<UnifiedMedia[]> {
	const cacheKey = `invidious:trending:${config.id}:${category ?? 'default'}`;
	return withCache(cacheKey, 120_000, async () => {
		const params = category ? `?type=${encodeURIComponent(category)}` : '';
		const results = await invFetch<InvidiousVideo[]>(config, `/api/v1/trending${params}`);
		return results.map((v) => normalizeVideo(config, v));
	});
}

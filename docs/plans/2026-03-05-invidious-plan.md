# Invidious Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Full YouTube replacement via self-hosted Invidious — per-user accounts, subscriptions, playlists, watch history, trending, search, video streams.

**Architecture:** Invidious adapter implements ServiceAdapter interface with form-based registration/login for user provisioning, bearer token auth for per-user API calls. Exported helpers power dedicated `/api/video/*` routes. All video data normalizes to UnifiedMedia with `type: 'video'`.

**Tech Stack:** SvelteKit API routes, Invidious REST API v1, form-based auth (no captcha), bearer tokens

---

### Task 1: Add `video` to MediaType union

**Files:**
- Modify: `src/lib/adapters/types.ts:1`

**Step 1: Add 'video' to the MediaType union**

Change line 1 from:
```ts
export type MediaType = 'movie' | 'show' | 'episode' | 'book' | 'game' | 'music' | 'album' | 'live';
```
to:
```ts
export type MediaType = 'movie' | 'show' | 'episode' | 'book' | 'game' | 'music' | 'album' | 'live' | 'video';
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: Success (no consumers break from a union widening)

**Step 3: Commit**

```bash
git add src/lib/adapters/types.ts
git commit -m "feat: add 'video' to MediaType union for Invidious"
```

---

### Task 2: Create Invidious adapter

**Files:**
- Create: `src/lib/adapters/invidious.ts`

This is the core file. It implements:
1. Form-based login/registration (captcha must be disabled on Invidious)
2. Token generation via authenticated API
3. All ServiceAdapter interface methods
4. Exported helper functions for subscriptions, playlists, history, channels, comments

**Key patterns to follow (from existing adapters):**
- `AbortSignal.timeout(8000)` on every fetch
- `withCache(key, ttlMs, fn)` for cacheable responses
- Normalize all responses to `UnifiedMedia`
- `userCred?.accessToken` for per-user bearer auth
- Admin auth uses `config.username` / `config.password`

**Step 1: Write the full adapter**

```ts
// src/lib/adapters/invidious.ts
import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential } from './types';
import { withCache } from '../server/cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InvidiousVideo {
	type: 'video';
	title: string;
	videoId: string;
	author: string;
	authorId: string;
	authorUrl: string;
	authorVerified: boolean;
	videoThumbnails: Array<{ quality: string; url: string; width: number; height: number }>;
	description: string;
	descriptionHtml?: string;
	viewCount: number;
	viewCountText?: string;
	published: number; // unix seconds
	publishedText: string;
	lengthSeconds: number;
	liveNow: boolean;
	premium: boolean;
	isUpcoming: boolean;
	is4k?: boolean;
	hasCaptions?: boolean;
	// Detail-only fields
	keywords?: string[];
	likeCount?: number;
	genre?: string;
	genreUrl?: string;
	subCountText?: string;
	adaptiveFormats?: unknown[];
	formatStreams?: unknown[];
	captions?: unknown[];
	recommendedVideos?: InvidiousVideo[];
}

interface InvidiousChannel {
	author: string;
	authorId: string;
	authorUrl: string;
	authorBanners?: Array<{ url: string; width: number; height: number }>;
	authorThumbnails: Array<{ url: string; width: number; height: number }>;
	subCount: number;
	totalViews: number;
	joined: number;
	description: string;
	descriptionHtml?: string;
	tags?: string[];
	authorVerified: boolean;
	latestVideos: InvidiousVideo[];
	relatedChannels?: Array<{ author: string; authorId: string; authorThumbnails: Array<{ url: string }> }>;
}

interface InvidiousPlaylist {
	title: string;
	playlistId: string;
	author: string;
	authorId: string;
	videos: InvidiousVideo[];
	videoCount: number;
}

interface InvidiousComment {
	author: string;
	authorThumbnails: Array<{ url: string }>;
	authorId: string;
	authorUrl: string;
	content: string;
	contentHtml: string;
	published: number;
	publishedText: string;
	likeCount: number;
	isEdited: boolean;
	replies?: { replyCount: number; continuation: string };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** POST the login or registration form, return the SID cookie */
async function formAuth(
	config: ServiceConfig,
	username: string,
	password: string,
	action: 'signin' | 'signin_register'
): Promise<string> {
	const url = `${config.url}/login?type=invidious&action=${action}`;
	const body = new URLSearchParams({
		'user[email]': username, // Invidious calls the username field "email"
		'user[password]': password,
		action,
		referer: '/'
	});

	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
		redirect: 'manual',
		signal: AbortSignal.timeout(8000)
	});

	// Success = 302 redirect; failure = 200 with error on page
	if (res.status !== 302) {
		const html = await res.text();
		const errorMatch = html.match(/<p[^>]*class="[^"]*error[^"]*"[^>]*>(.*?)<\/p>/i);
		throw new Error(errorMatch?.[1] ?? `Invidious ${action} failed (status ${res.status})`);
	}

	const setCookies = res.headers.getSetCookie?.() ?? [];
	const sidCookie = setCookies.find(c => c.startsWith('SID='));
	if (!sidCookie) throw new Error('No SID cookie received from Invidious');
	return sidCookie.split(';')[0]; // "SID=xxx"
}

/** Generate a bearer token using an existing session cookie */
async function generateToken(config: ServiceConfig, sidCookie: string): Promise<string> {
	const res = await fetch(`${config.url}/api/v1/auth/tokens/register`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Cookie: sidCookie
		},
		body: JSON.stringify({
			scopes: [
				'GET:feed',
				'GET:notifications',
				'GET:playlists*',
				'POST:playlists*',
				'PATCH:playlists*',
				'DELETE:playlists*',
				'GET:subscriptions*',
				'POST:subscriptions*',
				'DELETE:subscriptions*',
				'GET:history*',
				'POST:history*',
				'DELETE:history*',
				'GET:tokens',
				'GET:preferences',
				'POST:preferences'
			],
			expire: Math.floor(Date.now() / 1000) + 365 * 24 * 3600 // 1 year
		}),
		signal: AbortSignal.timeout(8000)
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Token registration failed: ${text}`);
	}

	const data = await res.json();
	return data.session as string;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function authHeaders(userCred?: UserCredential): Record<string, string> {
	if (userCred?.accessToken) {
		return { Authorization: `Bearer ${userCred.accessToken}` };
	}
	return {};
}

async function invFetch<T>(config: ServiceConfig, path: string, userCred?: UserCredential, init?: RequestInit): Promise<T> {
	const url = `${config.url}${path}`;
	const res = await fetch(url, {
		...init,
		headers: {
			...authHeaders(userCred),
			...init?.headers
		},
		signal: init?.signal ?? AbortSignal.timeout(8000)
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Invidious ${path} -> ${res.status}: ${text.slice(0, 200)}`);
	}
	return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function getThumbnail(thumbs: InvidiousVideo['videoThumbnails'], quality: string): string | undefined {
	return thumbs?.find(t => t.quality === quality)?.url
		?? thumbs?.find(t => t.quality === 'medium')?.url
		?? thumbs?.[0]?.url;
}

function normalize(config: ServiceConfig, item: InvidiousVideo, detail = false): UnifiedMedia {
	const media: UnifiedMedia = {
		id: `${item.videoId}:${config.id}`,
		sourceId: item.videoId,
		serviceId: config.id,
		serviceType: 'invidious',
		type: 'video',
		title: item.title,
		description: item.description,
		poster: getThumbnail(item.videoThumbnails, 'medium'),    // 320x180
		backdrop: getThumbnail(item.videoThumbnails, 'maxres'),   // 1280x720
		year: item.published ? new Date(item.published * 1000).getFullYear() : undefined,
		duration: item.lengthSeconds,
		genres: item.genre ? [item.genre] : undefined,
		metadata: {
			viewCount: item.viewCount,
			author: item.author,
			authorId: item.authorId,
			authorUrl: item.authorUrl,
			authorVerified: item.authorVerified,
			publishedText: item.publishedText,
			published: item.published,
			isLive: item.liveNow,
			is4k: item.is4k,
			hasCaptions: item.hasCaptions
		}
	};

	if (detail) {
		media.metadata = {
			...media.metadata,
			likeCount: item.likeCount,
			keywords: item.keywords,
			subCountText: item.subCountText,
			adaptiveFormats: item.adaptiveFormats,
			formatStreams: item.formatStreams,
			captions: item.captions,
			recommendedVideos: item.recommendedVideos?.map(v => normalize(config, v))
		};
	}

	return media;
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
			return { serviceId: config.id, name: config.name, type: config.type, online: true, latency: Date.now() - start };
		} catch (e: any) {
			return { serviceId: config.id, name: config.name, type: config.type, online: false, error: e.message };
		}
	},

	async authenticateUser(config, username, password) {
		const sid = await formAuth(config, username, password, 'signin');
		const token = await generateToken(config, sid);
		return { accessToken: token, externalUserId: username, externalUsername: username };
	},

	async createUser(config, username, password) {
		const sid = await formAuth(config, username, password, 'signin_register');
		const token = await generateToken(config, sid);
		return { accessToken: token, externalUserId: username, externalUsername: username };
	},

	async search(config, query, userCred) {
		const videos = await invFetch<InvidiousVideo[]>(
			config,
			`/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
			userCred
		);
		return {
			items: videos.filter(v => v.type === 'video').map(v => normalize(config, v)),
			total: videos.length,
			source: config.name
		};
	},

	async getTrending(config, userCred) {
		return withCache(`invidious:trending:${config.id}`, 120_000, async () => {
			const videos = await invFetch<InvidiousVideo[]>(config, '/api/v1/trending', userCred);
			return videos.map(v => normalize(config, v));
		});
	},

	async getRecentlyAdded(config, userCred) {
		return withCache(`invidious:popular:${config.id}`, 120_000, async () => {
			const videos = await invFetch<InvidiousVideo[]>(config, '/api/v1/popular', userCred);
			return videos.map(v => normalize(config, v));
		});
	},

	async getItem(config, sourceId, userCred) {
		const video = await invFetch<InvidiousVideo>(config, `/api/v1/videos/${sourceId}`, userCred);
		return normalize(config, video, true);
	},

	async getLibrary(config, opts, userCred) {
		if (!userCred?.accessToken) return { items: [], total: 0 };
		const page = opts?.offset ? Math.floor(opts.offset / (opts?.limit ?? 20)) + 1 : 1;
		const feed = await invFetch<{ notifications: InvidiousVideo[]; videos: InvidiousVideo[] }>(
			config,
			`/api/v1/auth/feed?page=${page}`,
			userCred
		);
		const items = feed.videos.map(v => normalize(config, v));
		return { items, total: items.length };
	}
};

// ---------------------------------------------------------------------------
// Exported helpers — used by /api/video/* routes
// ---------------------------------------------------------------------------

// ── Subscriptions ──────────────────────────────────────────────

export async function getSubscriptions(config: ServiceConfig, userCred: UserCredential) {
	return invFetch<Array<{ author: string; authorId: string }>>(config, '/api/v1/auth/subscriptions', userCred);
}

export async function subscribe(config: ServiceConfig, channelId: string, userCred: UserCredential) {
	await fetch(`${config.url}/api/v1/auth/subscriptions/${channelId}`, {
		method: 'POST',
		headers: authHeaders(userCred),
		signal: AbortSignal.timeout(8000)
	});
}

export async function unsubscribe(config: ServiceConfig, channelId: string, userCred: UserCredential) {
	await fetch(`${config.url}/api/v1/auth/subscriptions/${channelId}`, {
		method: 'DELETE',
		headers: authHeaders(userCred),
		signal: AbortSignal.timeout(8000)
	});
}

export async function getSubscriptionFeed(config: ServiceConfig, userCred: UserCredential, page = 1) {
	return invFetch<{ notifications: InvidiousVideo[]; videos: InvidiousVideo[] }>(
		config, `/api/v1/auth/feed?page=${page}`, userCred
	);
}

// ── Playlists ──────────────────────────────────────────────────

export async function getUserPlaylists(config: ServiceConfig, userCred: UserCredential) {
	return invFetch<InvidiousPlaylist[]>(config, '/api/v1/auth/playlists', userCred);
}

export async function createPlaylist(config: ServiceConfig, title: string, privacy: 'public' | 'unlisted' | 'private', userCred: UserCredential) {
	const res = await fetch(`${config.url}/api/v1/auth/playlists`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders(userCred) },
		body: JSON.stringify({ title, privacy }),
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`Create playlist failed: ${res.status}`);
	return res.json() as Promise<{ title: string; playlistId: string }>;
}

export async function deletePlaylist(config: ServiceConfig, playlistId: string, userCred: UserCredential) {
	await fetch(`${config.url}/api/v1/auth/playlists/${playlistId}`, {
		method: 'DELETE',
		headers: authHeaders(userCred),
		signal: AbortSignal.timeout(8000)
	});
}

export async function addToPlaylist(config: ServiceConfig, playlistId: string, videoId: string, userCred: UserCredential) {
	const res = await fetch(`${config.url}/api/v1/auth/playlists/${playlistId}/videos`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders(userCred) },
		body: JSON.stringify({ videoId }),
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`Add to playlist failed: ${res.status}`);
	return res.json();
}

export async function removeFromPlaylist(config: ServiceConfig, playlistId: string, index: string, userCred: UserCredential) {
	await fetch(`${config.url}/api/v1/auth/playlists/${playlistId}/videos/${index}`, {
		method: 'DELETE',
		headers: authHeaders(userCred),
		signal: AbortSignal.timeout(8000)
	});
}

// ── Watch History ──────────────────────────────────────────────

export async function getWatchHistory(config: ServiceConfig, userCred: UserCredential, page = 1) {
	return invFetch<string[]>(config, `/api/v1/auth/history?page=${page}`, userCred);
}

export async function markWatched(config: ServiceConfig, videoId: string, userCred: UserCredential) {
	await fetch(`${config.url}/api/v1/auth/history/${videoId}`, {
		method: 'POST',
		headers: authHeaders(userCred),
		signal: AbortSignal.timeout(8000)
	});
}

export async function removeFromHistory(config: ServiceConfig, videoId: string, userCred: UserCredential) {
	await fetch(`${config.url}/api/v1/auth/history/${videoId}`, {
		method: 'DELETE',
		headers: authHeaders(userCred),
		signal: AbortSignal.timeout(8000)
	});
}

// ── Channels ───────────────────────────────────────────────────

export async function getChannel(config: ServiceConfig, channelId: string): Promise<InvidiousChannel> {
	return invFetch<InvidiousChannel>(config, `/api/v1/channels/${channelId}`);
}

export async function getChannelVideos(config: ServiceConfig, channelId: string, sort?: string) {
	const qs = sort ? `?sort_by=${sort}` : '';
	return invFetch<{ videos: InvidiousVideo[] }>(config, `/api/v1/channels/${channelId}/videos${qs}`);
}

// ── Comments ───────────────────────────────────────────────────

export async function getComments(config: ServiceConfig, videoId: string, sort?: string) {
	const qs = sort ? `?sort_by=${sort}` : '';
	return invFetch<{ comments: InvidiousComment[]; commentCount: number; continuation?: string }>(
		config, `/api/v1/comments/${videoId}${qs}`
	);
}

// ── Search Suggestions ─────────────────────────────────────────

export async function getSearchSuggestions(config: ServiceConfig, query: string) {
	return invFetch<{ query: string; suggestions: string[] }>(
		config, `/api/v1/search/suggestions?q=${encodeURIComponent(query)}`
	);
}

// ── Trending by category ───────────────────────────────────────

export async function getTrendingByCategory(config: ServiceConfig, category?: string) {
	const qs = category ? `?type=${category}` : '';
	return withCache(`invidious:trending:${config.id}:${category ?? 'all'}`, 120_000, async () => {
		return invFetch<InvidiousVideo[]>(config, `/api/v1/trending${qs}`);
	});
}

// Re-export normalize for use by API routes that need to convert raw responses
export function normalizeVideo(config: ServiceConfig, item: InvidiousVideo, detail = false): UnifiedMedia {
	return normalize(config, item, detail);
}
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: Success

**Step 3: Commit**

```bash
git add src/lib/adapters/invidious.ts
git commit -m "feat: add Invidious adapter with full YouTube API integration"
```

---

### Task 3: Register adapter + wire into services

**Files:**
- Modify: `src/lib/adapters/registry.ts` — add import + register
- Modify: `src/lib/server/services.ts:176` — add `'invidious'` to LIBRARY_TYPES
- Modify: `src/routes/settings/+page.svelte:699` — add to username/password form conditional
- Modify: `src/routes/settings/+page.svelte:537` — add to edit form conditional

**Step 1: Register in registry**

In `src/lib/adapters/registry.ts`, add import at line 11 (after bazarr import):
```ts
import { invidiousAdapter } from './invidious';
```

Add to the registry chain (after `.register(bazarrAdapter)`):
```ts
.register(invidiousAdapter);
```

**Step 2: Add to LIBRARY_TYPES**

In `src/lib/server/services.ts` line 176, change:
```ts
const LIBRARY_TYPES = new Set(['jellyfin', 'calibre', 'romm']);
```
to:
```ts
const LIBRARY_TYPES = new Set(['jellyfin', 'calibre', 'romm', 'invidious']);
```

**Step 3: Add to settings form username/password conditionals**

In `src/routes/settings/+page.svelte` line 699 (add form), change:
```svelte
{#if form.type === 'romm' || form.type === 'calibre'}
```
to:
```svelte
{#if form.type === 'romm' || form.type === 'calibre' || form.type === 'invidious'}
```

In `src/routes/settings/+page.svelte` line 537 (edit form), change:
```svelte
{#if editForm.type === 'romm' || editForm.type === 'calibre'}
```
to:
```svelte
{#if editForm.type === 'romm' || editForm.type === 'calibre' || editForm.type === 'invidious'}
```

**Step 4: Verify build**

Run: `pnpm build`
Expected: Success

**Step 5: Commit**

```bash
git add src/lib/adapters/registry.ts src/lib/server/services.ts src/routes/settings/+page.svelte
git commit -m "feat: register Invidious adapter and wire into services"
```

---

### Task 4: Create `/api/video/` routes — browsing (trending, popular, suggestions)

**Files:**
- Create: `src/routes/api/video/trending/+server.ts`
- Create: `src/routes/api/video/popular/+server.ts`
- Create: `src/routes/api/video/suggestions/+server.ts`

All three are public-ish (require Nexus auth but not Invidious user token).

**Step 1: Create the route files**

`src/routes/api/video/trending/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getTrendingByCategory, normalizeVideo } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const category = url.searchParams.get('type') ?? undefined; // music, gaming, movies
	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ items: [] });

	const config = configs[0];
	const videos = await getTrendingByCategory(config, category);
	return json({ items: videos.map(v => normalizeVideo(config, v)) });
};
```

`src/routes/api/video/popular/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { invidiousAdapter } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ items: [] });

	const items = await invidiousAdapter.getRecentlyAdded!(configs[0]);
	return json({ items });
};
```

`src/routes/api/video/suggestions/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getSearchSuggestions } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const q = url.searchParams.get('q');
	if (!q) return json({ suggestions: [] });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ suggestions: [] });

	const result = await getSearchSuggestions(configs[0], q);
	return json(result);
};
```

**Step 2: Verify build**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/routes/api/video/trending src/routes/api/video/popular src/routes/api/video/suggestions
git commit -m "feat: add video browsing API routes (trending, popular, suggestions)"
```

---

### Task 5: Create `/api/video/` routes — subscriptions

**Files:**
- Create: `src/routes/api/video/subscriptions/+server.ts`
- Create: `src/routes/api/video/subscriptions/[ucid]/+server.ts`

**Step 1: Create subscription routes**

`src/routes/api/video/subscriptions/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getSubscriptions, getSubscriptionFeed, normalizeVideo } from '$lib/adapters/invidious';

/** GET — list subscriptions or subscription feed */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ items: [] });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	const view = url.searchParams.get('view'); // 'channels' or default (feed)
	if (view === 'channels') {
		const subs = await getSubscriptions(config, userCred);
		return json({ subscriptions: subs });
	}

	const page = parseInt(url.searchParams.get('page') ?? '1');
	const feed = await getSubscriptionFeed(config, userCred, page);
	return json({
		videos: feed.videos.map(v => normalizeVideo(config, v)),
		notifications: feed.notifications.map(v => normalizeVideo(config, v))
	});
};
```

`src/routes/api/video/subscriptions/[ucid]/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { subscribe, unsubscribe } from '$lib/adapters/invidious';

/** POST — subscribe to channel */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	await subscribe(config, params.ucid, userCred);
	return json({ ok: true });
};

/** DELETE — unsubscribe from channel */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	await unsubscribe(config, params.ucid, userCred);
	return json({ ok: true });
};
```

**Step 2: Verify build**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/routes/api/video/subscriptions
git commit -m "feat: add subscription feed and channel subscribe/unsubscribe APIs"
```

---

### Task 6: Create `/api/video/` routes — channels + comments

**Files:**
- Create: `src/routes/api/video/channels/[id]/+server.ts`
- Create: `src/routes/api/video/comments/[id]/+server.ts`

**Step 1: Create the routes**

`src/routes/api/video/channels/[id]/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getChannel, getChannelVideos, normalizeVideo } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });

	const config = configs[0];
	const sort = url.searchParams.get('sort') ?? undefined;

	const [channel, videosRes] = await Promise.all([
		getChannel(config, params.id),
		getChannelVideos(config, params.id, sort)
	]);

	return json({
		author: channel.author,
		authorId: channel.authorId,
		description: channel.description,
		subCount: channel.subCount,
		totalViews: channel.totalViews,
		authorVerified: channel.authorVerified,
		tags: channel.tags,
		banner: channel.authorBanners?.[0]?.url,
		thumbnail: channel.authorThumbnails?.find(t => t.width >= 100)?.url,
		videos: videosRes.videos.map(v => normalizeVideo(config, v)),
		relatedChannels: channel.relatedChannels
	});
};
```

`src/routes/api/video/comments/[id]/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getComments } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });

	const sort = url.searchParams.get('sort') ?? undefined; // 'top' or 'new'
	const result = await getComments(configs[0], params.id, sort);
	return json(result);
};
```

**Step 2: Verify build**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/routes/api/video/channels src/routes/api/video/comments
git commit -m "feat: add channel detail and video comments API routes"
```

---

### Task 7: Create `/api/video/` routes — playlists

**Files:**
- Create: `src/routes/api/video/playlists/+server.ts`
- Create: `src/routes/api/video/playlists/[id]/+server.ts`
- Create: `src/routes/api/video/playlists/[id]/videos/+server.ts`
- Create: `src/routes/api/video/playlists/[id]/videos/[index]/+server.ts`

**Step 1: Create playlist routes**

`src/routes/api/video/playlists/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getUserPlaylists, createPlaylist } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ playlists: [] });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	const playlists = await getUserPlaylists(config, userCred);
	return json({ playlists });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	const body = await request.json();
	const title = body.title;
	const privacy = body.privacy ?? 'private';
	if (!title) return json({ error: 'title is required' }, { status: 400 });

	const result = await createPlaylist(config, title, privacy, userCred);
	return json(result, { status: 201 });
};
```

`src/routes/api/video/playlists/[id]/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { deletePlaylist } from '$lib/adapters/invidious';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	await deletePlaylist(config, params.id, userCred);
	return json({ ok: true });
};
```

`src/routes/api/video/playlists/[id]/videos/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { addToPlaylist } from '$lib/adapters/invidious';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	const body = await request.json();
	if (!body.videoId) return json({ error: 'videoId is required' }, { status: 400 });

	const result = await addToPlaylist(config, params.id, body.videoId, userCred);
	return json(result, { status: 201 });
};
```

`src/routes/api/video/playlists/[id]/videos/[index]/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { removeFromPlaylist } from '$lib/adapters/invidious';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	await removeFromPlaylist(config, params.id, params.index, userCred);
	return json({ ok: true });
};
```

**Step 2: Verify build**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/routes/api/video/playlists
git commit -m "feat: add video playlist CRUD API routes"
```

---

### Task 8: Create `/api/video/` routes — watch history

**Files:**
- Create: `src/routes/api/video/history/+server.ts`
- Create: `src/routes/api/video/history/[id]/+server.ts`

**Step 1: Create history routes**

`src/routes/api/video/history/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getWatchHistory } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ videoIds: [] });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	const page = parseInt(url.searchParams.get('page') ?? '1');
	const videoIds = await getWatchHistory(config, userCred, page);
	return json({ videoIds });
};
```

`src/routes/api/video/history/[id]/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { markWatched, removeFromHistory } from '$lib/adapters/invidious';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	await markWatched(config, params.id, userCred);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	await removeFromHistory(config, params.id, userCred);
	return json({ ok: true });
};
```

**Step 2: Verify build**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/routes/api/video/history
git commit -m "feat: add watch history API routes"
```

---

### Task 9: Verify against live instance

**Step 1: Start dev server**

Run: `pnpm dev`

**Step 2: Test ping (add Invidious service first via settings UI)**

Add service with URL `http://localhost:3000`, type `invidious`, username + password for an Invidious account.

**Step 3: Test unauthenticated endpoints**

```bash
# Trending
curl -s http://localhost:5173/api/video/trending -H 'Cookie: <session>' | jq '.items | length'

# Popular
curl -s http://localhost:5173/api/video/popular -H 'Cookie: <session>' | jq '.items | length'

# Search suggestions
curl -s 'http://localhost:5173/api/video/suggestions?q=tech' -H 'Cookie: <session>' | jq '.suggestions'

# Comments
curl -s http://localhost:5173/api/video/comments/dQw4w9WgXcQ -H 'Cookie: <session>' | jq '.commentCount'
```

**Step 4: Test authenticated endpoints (after linking Invidious account)**

```bash
# Subscription feed
curl -s http://localhost:5173/api/video/subscriptions -H 'Cookie: <session>' | jq '.videos | length'

# Playlists
curl -s http://localhost:5173/api/video/playlists -H 'Cookie: <session>' | jq '.playlists'

# History
curl -s http://localhost:5173/api/video/history -H 'Cookie: <session>' | jq '.videoIds'
```

# Bazarr Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Bazarr enrichment adapter that provides subtitle intelligence (user-level) and system management data (admin-level) to the Nexus platform.

**Architecture:** Enrichment adapter following StreamyStats pattern — registered in the adapter registry for ping/health, with exported helper functions for subtitle data enrichment. Not a browsable service. Uses `withCache` for all API calls.

**Tech Stack:** SvelteKit, TypeScript, Bazarr REST API (`X-API-KEY` auth), existing `withCache` TTL cache.

---

### Task 1: Create Bazarr Adapter — Types and Fetch Helper

**Files:**
- Create: `src/lib/adapters/bazarr.ts`

**Step 1: Create the adapter file with types, fetch helper, and ping-only adapter**

```ts
import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth } from './types';
import { withCache } from '../server/cache';

// ---------------------------------------------------------------------------
// Bazarr adapter
//
// Bazarr is a subtitle management service for Sonarr/Radarr media.
// It is an enrichment adapter — no browsable library, no user accounts.
//
// Config:
//   url    -> Bazarr instance URL (e.g. http://localhost:6767)
//   apiKey -> Bazarr API key (sent as X-API-KEY header)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubtitleTrack {
	language: string;        // ISO 639-2 (e.g. "eng", "fre")
	languageName: string;    // Human-readable (e.g. "English")
	hearingImpaired: boolean;
	forced: boolean;
	provider?: string;
	score?: number;
	filePath?: string;
}

export interface SubtitleStatus {
	tmdbId?: number;
	radarrId?: number;
	sonarrId?: number;
	seriesId?: number;
	seasonNumber?: number;
	episodeNumber?: number;
	title: string;
	available: SubtitleTrack[];
	missing: string[];
	wanted: string[];
}

export interface SubtitleEvent {
	timestamp: string;
	mediaTitle: string;
	episodeInfo?: string;
	language: string;
	provider: string;
	action: 'downloaded' | 'upgraded' | 'failed' | 'deleted' | 'manual';
	score?: number;
}

export interface SubtitleProvider {
	name: string;
	status: 'active' | 'throttled' | 'error' | 'disabled';
	error?: string;
}

export interface LanguageProfile {
	id: number;
	name: string;
	languages: Array<{ code: string; name: string; forced: boolean; hi: boolean }>;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function bazarrFetch(config: ServiceConfig, path: string, timeoutMs = 8000) {
	const url = `${config.url.replace(/\/+$/, '')}${path}`;
	const res = await fetch(url, {
		headers: {
			'X-API-KEY': config.apiKey ?? '',
			Accept: 'application/json'
		},
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`Bazarr ${path} -> ${res.status}`);
	return res.json();
}

// ---------------------------------------------------------------------------
// Adapter (registry — ping only)
// ---------------------------------------------------------------------------

export const bazarrAdapter: ServiceAdapter = {
	id: 'bazarr',
	displayName: 'Bazarr',
	defaultPort: 6767,
	icon: 'bazarr',

	async ping(config: ServiceConfig): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await bazarrFetch(config, '/api/system/status', 5000);
			return {
				serviceId: config.id,
				name: config.name,
				type: 'bazarr',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'bazarr',
				online: false,
				latency: Date.now() - start,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	}
};
```

**Step 2: Verify the file compiles**

Run: `cd /Users/parker/Developer/Nexus && npx tsc --noEmit src/lib/adapters/bazarr.ts 2>&1 | head -20`

If tsc doesn't support single-file, run: `npx tsc --noEmit 2>&1 | grep bazarr`

Expected: No errors related to bazarr.ts

**Step 3: Commit**

```bash
git add src/lib/adapters/bazarr.ts
git commit -m "feat(bazarr): add adapter skeleton with types and ping"
```

---

### Task 2: Register Bazarr Adapter

**Files:**
- Modify: `src/lib/adapters/registry.ts`

**Step 1: Add import and registration**

In `src/lib/adapters/registry.ts`, add:

```ts
// After the streamystats import:
import { bazarrAdapter } from './bazarr';
```

And append `.register(bazarrAdapter)` to the registry chain (after `.register(streamystatsAdapter)`).

**Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep -i 'error' | head -10`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/lib/adapters/registry.ts
git commit -m "feat(bazarr): register adapter in registry"
```

---

### Task 3: Implement User-Level Enrichment — getSubtitleStatus

**Files:**
- Modify: `src/lib/adapters/bazarr.ts`

**Step 1: Add normalization helpers and getSubtitleStatus**

Add after the `bazarrFetch` function, before the adapter export:

```ts
// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeTrack(sub: any): SubtitleTrack {
	return {
		language: sub.code2 ?? sub.code3 ?? '',
		languageName: sub.name ?? '',
		hearingImpaired: sub.hi === true || sub.hearing_impaired === true,
		forced: sub.forced === true,
		provider: sub.provider ?? undefined,
		score: sub.score ?? undefined,
		filePath: sub.path ?? sub.subtitles_path ?? undefined
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMovieStatus(movie: any): SubtitleStatus {
	const profileLanguages: string[] = (movie.languages ?? []).map((l: any) => l.code2 ?? l.code3 ?? '');
	const availableTracks: SubtitleTrack[] = (movie.subtitles ?? []).map(normalizeTrack);
	const availableCodes = new Set(availableTracks.map((t) => t.language));
	const missing = profileLanguages.filter((code) => !availableCodes.has(code));

	return {
		tmdbId: movie.tmdbId,
		radarrId: movie.radarrId,
		title: movie.title ?? '',
		available: availableTracks,
		missing,
		wanted: profileLanguages
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEpisodeStatus(ep: any): SubtitleStatus {
	const profileLanguages: string[] = (ep.languages ?? []).map((l: any) => l.code2 ?? l.code3 ?? '');
	const availableTracks: SubtitleTrack[] = (ep.subtitles ?? []).map(normalizeTrack);
	const availableCodes = new Set(availableTracks.map((t) => t.language));
	const missing = profileLanguages.filter((code) => !availableCodes.has(code));

	return {
		sonarrId: ep.sonarrSeriesId,
		seriesId: ep.sonarrSeriesId,
		seasonNumber: ep.season,
		episodeNumber: ep.episode,
		title: ep.title ?? '',
		available: availableTracks,
		missing,
		wanted: profileLanguages
	};
}

// ---------------------------------------------------------------------------
// Exported user-level enrichment helpers
// ---------------------------------------------------------------------------

/**
 * Get subtitle status for a movie or series.
 * Tries TMDB ID first, falls back to Radarr/Sonarr ID.
 * Returns null if no match found.
 */
export async function getSubtitleStatus(
	config: ServiceConfig,
	tmdbId?: number,
	opts?: { radarrId?: number; sonarrId?: number; type?: 'movie' | 'show' }
): Promise<SubtitleStatus | null> {
	const cacheKey = `bazarr:status:${config.id}:${tmdbId ?? ''}:${opts?.radarrId ?? ''}:${opts?.sonarrId ?? ''}`;

	return withCache(cacheKey, 120_000, async () => {
		const isShow = opts?.type === 'show';

		// Try TMDB ID first
		if (tmdbId) {
			try {
				if (isShow) {
					const data = await bazarrFetch(config, `/api/series?tmdbid[]=${tmdbId}`);
					const items = Array.isArray(data) ? data : (data.data ?? []);
					if (items.length > 0) return normalizeEpisodeStatus(items[0]);
				} else {
					const data = await bazarrFetch(config, `/api/movies?tmdbid[]=${tmdbId}`);
					const items = Array.isArray(data) ? data : (data.data ?? []);
					if (items.length > 0) return normalizeMovieStatus(items[0]);
				}
			} catch { /* fall through to ID lookup */ }
		}

		// Fallback: Radarr/Sonarr ID
		if (opts?.radarrId) {
			try {
				const movie = await bazarrFetch(config, `/api/movies/${opts.radarrId}`);
				return normalizeMovieStatus(movie);
			} catch { /* no match */ }
		}

		if (opts?.sonarrId) {
			try {
				const series = await bazarrFetch(config, `/api/series/${opts.sonarrId}`);
				return normalizeEpisodeStatus(series);
			} catch { /* no match */ }
		}

		return null;
	});
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep bazarr`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/adapters/bazarr.ts
git commit -m "feat(bazarr): add getSubtitleStatus enrichment helper"
```

---

### Task 4: Implement getSeasonSubtitleStatus

**Files:**
- Modify: `src/lib/adapters/bazarr.ts`

**Step 1: Add getSeasonSubtitleStatus after getSubtitleStatus**

```ts
/**
 * Get subtitle status for all episodes in a season.
 * Uses Sonarr series ID to query Bazarr's episodes endpoint.
 */
export async function getSeasonSubtitleStatus(
	config: ServiceConfig,
	sonarrSeriesId: number,
	seasonNumber: number
): Promise<SubtitleStatus[]> {
	const cacheKey = `bazarr:season:${config.id}:${sonarrSeriesId}:s${seasonNumber}`;

	return withCache(cacheKey, 120_000, async () => {
		try {
			const data = await bazarrFetch(
				config,
				`/api/episodes?seriesid[]=${sonarrSeriesId}`
			);
			const episodes = Array.isArray(data) ? data : (data.data ?? []);
			return episodes
				.filter((ep: any) => ep.season === seasonNumber)
				.map(normalizeEpisodeStatus);
		} catch (e) {
			console.error('[Bazarr] getSeasonSubtitleStatus error:', e instanceof Error ? e.message : e);
			return [];
		}
	});
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep bazarr`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/adapters/bazarr.ts
git commit -m "feat(bazarr): add getSeasonSubtitleStatus helper"
```

---

### Task 5: Implement getItemSubtitleHistory

**Files:**
- Modify: `src/lib/adapters/bazarr.ts`

**Step 1: Add history normalization and getItemSubtitleHistory**

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeHistoryEvent(entry: any): SubtitleEvent {
	let action: SubtitleEvent['action'] = 'downloaded';
	const rawAction = (entry.action ?? '').toString().toLowerCase();
	if (rawAction.includes('upgrade')) action = 'upgraded';
	else if (rawAction.includes('fail')) action = 'failed';
	else if (rawAction.includes('delete')) action = 'deleted';
	else if (rawAction.includes('manual')) action = 'manual';

	return {
		timestamp: entry.timestamp ?? entry.date ?? '',
		mediaTitle: entry.seriesTitle ?? entry.title ?? '',
		episodeInfo: entry.episode_number
			? `S${String(entry.season).padStart(2, '0')}E${String(entry.episode_number).padStart(2, '0')}`
			: undefined,
		language: entry.language?.code2 ?? entry.language?.name ?? '',
		provider: entry.provider ?? '',
		action,
		score: entry.score ?? undefined
	};
}

/**
 * Get subtitle download history for a specific item.
 * Tries TMDB ID first, falls back to Radarr/Sonarr ID.
 */
export async function getItemSubtitleHistory(
	config: ServiceConfig,
	tmdbId?: number,
	opts?: { radarrId?: number; sonarrId?: number; type?: 'movie' | 'show' }
): Promise<SubtitleEvent[]> {
	const cacheKey = `bazarr:history:${config.id}:${tmdbId ?? ''}:${opts?.radarrId ?? ''}:${opts?.sonarrId ?? ''}`;

	return withCache(cacheKey, 120_000, async () => {
		try {
			const isShow = opts?.type === 'show';
			const endpoint = isShow ? '/api/history/series' : '/api/history/movies';
			const data = await bazarrFetch(config, endpoint);
			const events = Array.isArray(data) ? data : (data.data ?? []);

			// Filter to matching item
			const filtered = events.filter((e: any) => {
				if (tmdbId && e.tmdbId === tmdbId) return true;
				if (opts?.radarrId && e.radarrId === opts.radarrId) return true;
				if (opts?.sonarrId && e.sonarrSeriesId === opts.sonarrId) return true;
				return false;
			});

			return filtered.map(normalizeHistoryEvent);
		} catch (e) {
			console.error('[Bazarr] getItemSubtitleHistory error:', e instanceof Error ? e.message : e);
			return [];
		}
	});
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep bazarr`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/adapters/bazarr.ts
git commit -m "feat(bazarr): add getItemSubtitleHistory helper"
```

---

### Task 6: Implement Admin Functions

**Files:**
- Modify: `src/lib/adapters/bazarr.ts`

**Step 1: Add getProviderStatus, getLanguageProfiles, getSystemHistory**

```ts
// ---------------------------------------------------------------------------
// Exported admin-level functions
// ---------------------------------------------------------------------------

/**
 * Get status of all configured subtitle providers.
 */
export async function getProviderStatus(config: ServiceConfig): Promise<SubtitleProvider[]> {
	return withCache(`bazarr:providers:${config.id}`, 30_000, async () => {
		try {
			const data = await bazarrFetch(config, '/api/providers');
			const providers = Array.isArray(data) ? data : (data.data ?? []);
			return providers.map((p: any) => ({
				name: p.name ?? '',
				status: p.status === 'active' ? 'active'
					: p.status === 'throttled' ? 'throttled'
					: p.status === 'disabled' ? 'disabled'
					: 'error' as SubtitleProvider['status'],
				error: p.error ?? undefined
			}));
		} catch (e) {
			console.error('[Bazarr] getProviderStatus error:', e instanceof Error ? e.message : e);
			return [];
		}
	});
}

/**
 * Get all configured language profiles.
 */
export async function getLanguageProfiles(config: ServiceConfig): Promise<LanguageProfile[]> {
	return withCache(`bazarr:profiles:${config.id}`, 300_000, async () => {
		try {
			const data = await bazarrFetch(config, '/api/languages/profiles');
			const profiles = Array.isArray(data) ? data : (data.data ?? []);
			return profiles.map((p: any) => ({
				id: p.profileId ?? p.id ?? 0,
				name: p.name ?? '',
				languages: (p.items ?? p.languages ?? []).map((l: any) => ({
					code: l.code2 ?? l.code3 ?? l.language ?? '',
					name: l.name ?? l.long_name ?? '',
					forced: l.forced === true,
					hi: l.hi === true
				}))
			}));
		} catch (e) {
			console.error('[Bazarr] getLanguageProfiles error:', e instanceof Error ? e.message : e);
			return [];
		}
	});
}

/**
 * Get system-wide subtitle history (paginated).
 */
export async function getSystemHistory(
	config: ServiceConfig,
	opts?: { page?: number; limit?: number }
): Promise<{ events: SubtitleEvent[]; total: number }> {
	const page = opts?.page ?? 1;
	const limit = opts?.limit ?? 50;
	const cacheKey = `bazarr:syshistory:${config.id}:p${page}:l${limit}`;

	return withCache(cacheKey, 30_000, async () => {
		try {
			// Fetch both movie and series history
			const [movieData, seriesData] = await Promise.all([
				bazarrFetch(config, `/api/history/movies?start=${(page - 1) * limit}&length=${limit}`),
				bazarrFetch(config, `/api/history/series?start=${(page - 1) * limit}&length=${limit}`)
			]);

			const movieEvents = (Array.isArray(movieData) ? movieData : (movieData.data ?? [])).map(normalizeHistoryEvent);
			const seriesEvents = (Array.isArray(seriesData) ? seriesData : (seriesData.data ?? [])).map(normalizeHistoryEvent);

			// Merge and sort by timestamp descending
			const allEvents = [...movieEvents, ...seriesEvents]
				.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
				.slice(0, limit);

			const totalMovies = movieData.recordsTotal ?? movieEvents.length;
			const totalSeries = seriesData.recordsTotal ?? seriesEvents.length;

			return { events: allEvents, total: totalMovies + totalSeries };
		} catch (e) {
			console.error('[Bazarr] getSystemHistory error:', e instanceof Error ? e.message : e);
			return { events: [], total: 0 };
		}
	});
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep bazarr`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/adapters/bazarr.ts
git commit -m "feat(bazarr): add admin functions (providers, profiles, history)"
```

---

### Task 7: Wire Enrichment into Media Detail Page

**Files:**
- Modify: `src/routes/media/[type]/[id]/+page.server.ts`

**Step 1: Add Bazarr subtitle enrichment after item is resolved**

Add import at top of file:

```ts
import { getSubtitleStatus, getItemSubtitleHistory } from '$lib/adapters/bazarr';
import type { SubtitleStatus, SubtitleEvent } from '$lib/adapters/bazarr';
```

After the `if (!item) throw error(404, 'Item not found');` line (around line 61), before the similar items section, add:

```ts
	// ── Bazarr subtitle enrichment ─────────────────────────────────────
	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length > 0 && item) {
		const bazarrConfig = bazarrConfigs[0];
		const tmdbId = item.metadata?.tmdbId as number | undefined;
		const radarrId = item.metadata?.radarrId as number | undefined;
		const sonarrId = item.metadata?.sonarrId as number | undefined;

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
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep 'page.server' | head -5`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/routes/media/[type]/[id]/+page.server.ts
git commit -m "feat(bazarr): wire subtitle enrichment into media detail page"
```

---

### Task 8: Add Admin Subtitle API Endpoint

**Files:**
- Create: `src/routes/api/admin/subtitles/+server.ts`

**Step 1: Create the admin API endpoint**

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getProviderStatus, getLanguageProfiles, getSystemHistory } from '$lib/adapters/bazarr';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) throw error(403, 'Admin only');

	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length === 0) {
		return json({ providers: [], profiles: [], history: { events: [], total: 0 } });
	}

	const config = bazarrConfigs[0];
	const section = url.searchParams.get('section');
	const page = parseInt(url.searchParams.get('page') ?? '1', 10);
	const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

	if (section === 'providers') {
		return json({ providers: await getProviderStatus(config) });
	}
	if (section === 'profiles') {
		return json({ profiles: await getLanguageProfiles(config) });
	}
	if (section === 'history') {
		return json(await getSystemHistory(config, { page, limit }));
	}

	// Return all sections
	const [providers, profiles, history] = await Promise.all([
		getProviderStatus(config),
		getLanguageProfiles(config),
		getSystemHistory(config, { page, limit })
	]);

	return json({ providers, profiles, history });
};
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep subtitles`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/routes/api/admin/subtitles/+server.ts
git commit -m "feat(bazarr): add admin subtitles API endpoint"
```

---

## Design Reference

### Data Types

```ts
SubtitleTrack   — per-file: language, HI, forced, provider, score
SubtitleStatus  — per-item: available tracks, missing/wanted languages
SubtitleEvent   — history: timestamp, action, provider, language
SubtitleProvider — admin: provider name, status, errors
LanguageProfile  — admin: profile name, configured languages
```

### ID Matching (TMDB first, Sonarr/Radarr fallback)

- TMDB ID: from Jellyfin ProviderIds, Sonarr/Radarr native, Overseerr
- Radarr ID: from `metadata.radarrId` on Radarr items
- Sonarr ID: from `metadata.sonarrId` on Sonarr items

### Injected Metadata

```ts
item.metadata.subtitles = {
  available: SubtitleTrack[],
  missing: string[],
  wanted: string[],
  lastEvent?: SubtitleEvent
}
```

### Cache TTLs

- Per-item status/history: 2 min
- Provider status: 30s
- Language profiles: 5 min
- System history: 30s

### Auth

`X-API-KEY` header, key from `ServiceConfig.apiKey`.

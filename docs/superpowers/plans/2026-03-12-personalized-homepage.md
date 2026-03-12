# Personalized Homepage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal homepage with a Netflix-style personalized feed powered by the existing recommendation engine.

**Architecture:** Pre-compute homepage row layouts per user in the rec scheduler (every 60min), cache in-memory via `withCache`. Homepage load reads the cache + fetches Continue Watching live from Jellyfin. New `HeroCarousel.svelte` component for the top carousel, `ContinueWatchingCard.svelte` for landscape progress cards.

**Tech Stack:** SvelteKit (Svelte 5), existing recommendation engine, `withCache` in-memory cache, Jellyfin adapter, Drizzle/SQLite

**Spec:** `docs/superpowers/specs/2026-03-11-personalized-homepage-design.md`

---

## Chunk 1: Homepage Cache Builder

### Task 1: Add `rowOrder` to RecProfileConfig

**Files:**
- Modify: `src/lib/server/recommendations/types.ts:30-46`

- [ ] **Step 1: Add rowOrder field to RecProfileConfig**

In `src/lib/server/recommendations/types.ts`, add `rowOrder` to the interface:

```typescript
// Add after line 45 (before the closing brace of RecProfileConfig):
	rowOrder?: string[];
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors related to `rowOrder`

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/recommendations/types.ts
git commit -m "feat: add rowOrder to RecProfileConfig"
```

---

### Task 2: Create homepage cache builder module

**Files:**
- Create: `src/lib/server/homepage-cache.ts`

This module is the core of the feature — it reads pre-computed recommendations from `recommendation_cache` and assembles them into homepage-ready rows.

- [ ] **Step 1: Create the homepage types and builder**

Create `src/lib/server/homepage-cache.ts`:

```typescript
import { getRawDb } from '$lib/db';
import { withCache, invalidate } from './cache';
import type { ScoredRecommendation, RecProfileConfig, ReasonType } from './recommendations/types';
import { DEFAULT_PROFILE } from './recommendations/types';
import type { UnifiedMedia } from '$lib/adapters/types';

// ---------------------------------------------------------------------------
// Homepage Cache
//
// Assembles pre-computed recommendations into homepage-ready rows.
// Called by the rec scheduler after recommendations are rebuilt.
// ---------------------------------------------------------------------------

export interface HeroItem {
	id: string;
	sourceId: string;
	serviceId: string;
	serviceType: string;
	title: string;
	year?: number;
	runtime?: string;
	rating?: number;
	overview?: string;
	backdrop?: string;
	poster?: string;
	mediaType: string;
	genres?: string[];
	reason: string;
	provider: string;
	streamUrl?: string;
}

export interface HomepageItem {
	id: string;
	sourceId: string;
	serviceId: string;
	serviceType: string;
	title: string;
	poster?: string;
	backdrop?: string;
	year?: number;
	mediaType: string;
	genres?: string[];
	rating?: number;
	context?: string;
	progress?: number;
	timeRemaining?: string;
	episodeInfo?: string;
	streamUrl?: string;
	description?: string;
}

export interface HomepageRow {
	id: string;
	title: string;
	subtitle?: string;
	type: 'reason' | 'genre' | 'system';
	items: HomepageItem[];
}

export interface HomepageCache {
	hero: HeroItem[];
	rows: HomepageRow[];
	computedAt: number;
}

const MIN_ROW_ITEMS = 3;

/** Format seconds into "Xh Ym" */
function formatDuration(secs?: number): string | undefined {
	if (!secs) return undefined;
	const h = Math.floor(secs / 3600);
	const m = Math.floor((secs % 3600) / 60);
	return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Convert a ScoredRecommendation to a HomepageItem */
function recToItem(rec: ScoredRecommendation, context?: string): HomepageItem {
	const item = rec.item;
	return {
		id: item.id,
		sourceId: item.sourceId,
		serviceId: item.serviceId,
		serviceType: item.serviceType,
		title: item.title,
		poster: item.poster,
		backdrop: item.backdrop,
		year: item.year,
		mediaType: item.type,
		genres: item.genres,
		rating: item.rating,
		context,
		streamUrl: item.streamUrl,
		description: item.description
	};
}

/** Convert a ScoredRecommendation to a HeroItem */
function recToHero(rec: ScoredRecommendation): HeroItem {
	const item = rec.item;
	return {
		id: item.id,
		sourceId: item.sourceId,
		serviceId: item.serviceId,
		serviceType: item.serviceType,
		title: item.title,
		year: item.year,
		runtime: formatDuration(item.duration),
		rating: item.rating,
		overview: item.description,
		backdrop: item.backdrop,
		poster: item.poster,
		mediaType: item.type,
		genres: item.genres,
		reason: rec.reason,
		provider: rec.provider,
		streamUrl: item.streamUrl
	};
}

/** Convert a UnifiedMedia (continue watching) to a HomepageItem */
export function cwToItem(item: UnifiedMedia): HomepageItem {
	const progress = item.progress ?? 0;
	const remaining = item.duration ? item.duration * (1 - progress) : 0;
	const h = Math.floor(remaining / 3600);
	const m = Math.floor((remaining % 3600) / 60);
	const timeRemaining = remaining > 0
		? (h > 0 ? `${h}h ${m}m left` : `${m}m left`)
		: undefined;

	// Extract episode info from metadata or title pattern
	const season = item.metadata?.parentIndexNumber ?? item.metadata?.season;
	const episode = item.metadata?.indexNumber ?? item.metadata?.episode;
	const episodeInfo = season != null && episode != null
		? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
		: undefined;

	return {
		id: item.id,
		sourceId: item.sourceId,
		serviceId: item.serviceId,
		serviceType: item.serviceType,
		title: item.title,
		poster: item.poster,
		backdrop: item.backdrop ?? item.thumb,
		year: item.year,
		mediaType: item.type,
		genres: item.genres,
		rating: item.rating,
		progress,
		timeRemaining,
		episodeInfo,
		streamUrl: item.streamUrl,
		description: item.description
	};
}

// Reason types that map to specific named rows
const TRENDING_REASONS: ReasonType[] = ['trending'];
const FRIEND_REASONS: ReasonType[] = ['friend_shared', 'friend_watched'];
const TIME_REASONS: ReasonType[] = ['time_pattern'];
const GENRE_REASONS: ReasonType[] = ['genre_match'];
// Everything else goes to "Recommended for You"
const CATCH_ALL_REASONS: ReasonType[] = [
	'similar_users', 'similar_item', 'studio_match',
	'era_match', 'completion_pattern', 'external'
];

/**
 * Build homepage cache from pre-computed recommendations.
 * Reads from recommendation_cache table (already populated by rec scheduler).
 */
export function buildHomepageCache(userId: string): HomepageCache | null {
	const raw = getRawDb();

	// Read all cached recommendations for this user
	const rows = raw.prepare(
		`SELECT results FROM recommendation_cache WHERE user_id = ?`
	).all(userId) as Array<{ results: string }>;

	if (rows.length === 0) return null;

	const allRecs: ScoredRecommendation[] = [];
	for (const row of rows) {
		try {
			const parsed = JSON.parse(row.results) as ScoredRecommendation[];
			allRecs.push(...parsed);
		} catch { /* skip malformed */ }
	}

	if (allRecs.length === 0) return null;

	// Deduplicate by sourceId (keep highest score)
	const seen = new Map<string, ScoredRecommendation>();
	for (const rec of allRecs.sort((a, b) => b.score - a.score)) {
		const key = rec.item.sourceId;
		if (!seen.has(key)) seen.set(key, rec);
	}
	const deduped = Array.from(seen.values());

	// Hero: top 8 with backdrops
	const heroRecs = deduped
		.filter((r) => r.item.backdrop)
		.slice(0, 8);
	const hero = heroRecs.map(recToHero);

	// Exclude hero items from rows
	const heroIds = new Set(heroRecs.map((r) => r.item.sourceId));
	const remaining = deduped.filter((r) => !heroIds.has(r.item.sourceId));

	// Group by reason type
	const trending = remaining.filter((r) => TRENDING_REASONS.includes(r.reasonType));
	const friends = remaining.filter((r) => FRIEND_REASONS.includes(r.reasonType));
	const timeAware = remaining.filter((r) => TIME_REASONS.includes(r.reasonType));
	const genreMatch = remaining.filter((r) => GENRE_REASONS.includes(r.reasonType));
	const catchAll = remaining.filter((r) => CATCH_ALL_REASONS.includes(r.reasonType));

	const resultRows: HomepageRow[] = [];

	// Trending Now
	if (trending.length >= MIN_ROW_ITEMS) {
		resultRows.push({
			id: 'trending',
			title: 'Trending Now',
			subtitle: 'Popular across Nexus right now',
			type: 'reason',
			items: trending.slice(0, 20).map((r) => recToItem(r))
		});
	}

	// From Friends
	if (friends.length >= MIN_ROW_ITEMS) {
		resultRows.push({
			id: 'friends',
			title: 'From Friends',
			subtitle: 'Shared & watched by people you follow',
			type: 'reason',
			items: friends.slice(0, 20).map((r) => {
				const context = r.reasonType === 'friend_shared'
					? `Shared by ${r.basedOn?.[0] ?? 'a friend'}`
					: `${r.basedOn?.[0] ?? 'A friend'} watched this`;
				return recToItem(r, context);
			})
		});
	}

	// Right Now (time-aware)
	if (timeAware.length >= MIN_ROW_ITEMS) {
		resultRows.push({
			id: 'time-aware',
			title: 'Perfect for Right Now',
			subtitle: 'Based on what you usually watch at this time',
			type: 'reason',
			items: timeAware.slice(0, 20).map((r) => recToItem(r))
		});
	}

	// Recommended for You (catch-all)
	if (catchAll.length >= MIN_ROW_ITEMS) {
		resultRows.push({
			id: 'recommended',
			title: 'Recommended for You',
			type: 'reason',
			items: catchAll.slice(0, 20).map((r) => recToItem(r))
		});
	}

	// Genre rows — group by genre, ordered by user affinity
	if (genreMatch.length > 0) {
		const byGenre = new Map<string, ScoredRecommendation[]>();
		for (const r of genreMatch) {
			const genre = r.basedOn?.[0] ?? 'your favorites';
			if (!byGenre.has(genre)) byGenre.set(genre, []);
			byGenre.get(genre)!.push(r);
		}

		// Load genre affinity to order rows
		const affinityRows = raw.prepare(
			`SELECT genre, score FROM user_genre_affinity
			 WHERE user_id = ? AND media_type = 'all'
			 ORDER BY score DESC`
		).all(userId) as Array<{ genre: string; score: number }>;
		const affinityOrder = affinityRows.map((r) => r.genre);

		// Sort genre keys by affinity order
		const sortedGenres = Array.from(byGenre.keys()).sort((a, b) => {
			const ai = affinityOrder.indexOf(a);
			const bi = affinityOrder.indexOf(b);
			return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
		});

		let rank = 1;
		for (const genre of sortedGenres) {
			const recs = byGenre.get(genre)!;
			if (recs.length < MIN_ROW_ITEMS) continue;
			const genreSlug = genre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
			resultRows.push({
				id: `genre:${genreSlug}`,
				title: genre,
				subtitle: `Your #${rank} genre`,
				type: 'genre',
				items: recs.slice(0, 20).map((r) => recToItem(r))
			});
			rank++;
		}
	}

	return { hero, rows: resultRows, computedAt: Date.now() };
}

const HOMEPAGE_CACHE_TTL = 60 * 60 * 1000; // 60 min

/** Get cached homepage data for a user. Returns null on cache miss. */
export async function getHomepageCache(userId: string): Promise<HomepageCache | null> {
	return withCache(`homepage:${userId}`, HOMEPAGE_CACHE_TTL, async () => {
		return buildHomepageCache(userId);
	});
}

/** Invalidate homepage cache for a user (e.g., after profile change) */
export function invalidateHomepageCache(userId: string) {
	invalidate(`homepage:${userId}`);
}

/** Default row order */
export const DEFAULT_ROW_ORDER = [
	'continue', 'trending', 'friends', 'time-aware', 'recommended', 'new', 'genre:*'
];

/**
 * Apply user's row ordering preferences.
 * 'genre:*' expands to all genre rows in their current (affinity) order.
 * Continue Watching is always position 0 regardless of rowOrder.
 */
export function applyRowOrder(rows: HomepageRow[], rowOrder?: string[]): HomepageRow[] {
	const order = rowOrder ?? DEFAULT_ROW_ORDER;
	const rowMap = new Map(rows.map((r) => [r.id, r]));
	const genreRows = rows.filter((r) => r.type === 'genre');
	const result: HomepageRow[] = [];
	const placed = new Set<string>();

	for (const id of order) {
		if (id === 'genre:*') {
			// Expand to all genre rows not yet placed
			for (const gr of genreRows) {
				if (!placed.has(gr.id)) {
					result.push(gr);
					placed.add(gr.id);
				}
			}
		} else if (id.startsWith('genre:') && !rowMap.has(id)) {
			// Specific genre that might not exist — skip
			continue;
		} else {
			const row = rowMap.get(id);
			if (row && !placed.has(id)) {
				result.push(row);
				placed.add(id);
			}
		}
	}

	// Append any rows not in the order
	for (const row of rows) {
		if (!placed.has(row.id)) {
			result.push(row);
		}
	}

	return result;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/homepage-cache.ts
git commit -m "feat: homepage cache builder with row grouping and ordering"
```

---

### Task 3: Integrate homepage cache into rec scheduler

**Files:**
- Modify: `src/lib/server/rec-scheduler.ts:67-89`

- [ ] **Step 1: Add homepage cache build after precomputeRecs**

In `src/lib/server/rec-scheduler.ts`, add the import at the top (after line 11):

```typescript
import { buildHomepageCache, invalidateHomepageCache } from './homepage-cache';
import { withCache } from './cache';
```

Then modify the `runScheduledRebuilds` function. Replace lines 78-84 (the `tickCount % 12` block):

```typescript
			// Every 12th tick (60 min) — pre-compute recommendations, then build homepage cache
			if (tickCount % 12 === 0) {
				invalidatePrefix(`rec-rows:${userId}`);
				invalidateHomepageCache(userId);
				precomputeRecs(userId).then(() => {
					// Build homepage cache AFTER recs are computed so we read fresh data
					const cache = buildHomepageCache(userId);
					if (cache) {
						// Store in withCache so getHomepageCache() can read it
						withCache(`homepage:${userId}`, 60 * 60 * 1000, async () => cache);
					}
					console.log(`[rec-scheduler] Homepage cache built for ${userId}`);
				}).catch((e) =>
					console.error(`[rec-scheduler] Precompute error for ${userId}:`, e)
				);
			}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/rec-scheduler.ts
git commit -m "feat: build homepage cache after recommendation precompute"
```

---

## Chunk 2: HeroCarousel Component

### Task 4: Create HeroCarousel.svelte

**Files:**
- Create: `src/lib/components/HeroCarousel.svelte`

@svelte:svelte-code-writer @svelte:svelte-core-bestpractices

- [ ] **Step 1: Create the HeroCarousel component**

Create `src/lib/components/HeroCarousel.svelte`:

```svelte
<script lang="ts">
	import type { HeroItem } from '$lib/server/homepage-cache';
	import ServiceBadge from './ServiceBadge.svelte';

	interface Props {
		items: HeroItem[];
		autoAdvanceMs?: number;
	}

	let { items, autoAdvanceMs = 8000 }: Props = $props();

	let currentIndex = $state(0);
	let paused = $state(false);
	let intervalId: ReturnType<typeof setInterval> | undefined;

	const current = $derived(items[currentIndex]);

	function goto(index: number) {
		currentIndex = ((index % items.length) + items.length) % items.length;
	}

	function next() {
		goto(currentIndex + 1);
	}

	function prev() {
		goto(currentIndex - 1);
	}

	function startTimer() {
		stopTimer();
		if (items.length <= 1) return;
		intervalId = setInterval(() => {
			if (!paused) next();
		}, autoAdvanceMs);
	}

	function stopTimer() {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = undefined;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') { prev(); e.preventDefault(); }
		else if (e.key === 'ArrowRight') { next(); e.preventDefault(); }
	}

	$effect(() => {
		startTimer();
		return stopTimer;
	});

	// Preload next image
	$effect(() => {
		if (items.length <= 1) return;
		const nextIdx = (currentIndex + 1) % items.length;
		const nextItem = items[nextIdx];
		if (nextItem?.backdrop) {
			const img = new Image();
			img.src = nextItem.backdrop;
		}
	});
</script>

{#if current}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="hero-carousel relative mx-2 mt-2 overflow-hidden rounded-xl sm:mx-4 sm:mt-4 sm:rounded-2xl"
		style="height: clamp(260px, 45vh, 520px); box-shadow: 0 24px 80px rgba(0,0,0,0.7)"
		role="region"
		aria-label="Featured recommendations"
		aria-roledescription="carousel"
		onmouseenter={() => paused = true}
		onmouseleave={() => paused = false}
		onfocusin={() => paused = true}
		onfocusout={() => paused = false}
		onkeydown={handleKeydown}
	>
		<!-- Backdrop -->
		{#key currentIndex}
			{#if current.backdrop}
				<img
					src={current.backdrop}
					alt=""
					class="absolute inset-0 h-full w-full object-cover animate-fade-in"
					style="transform: scale(1.02)"
				/>
			{:else}
				<div class="absolute inset-0" style="background: linear-gradient(135deg, var(--color-raised) 0%, var(--color-deep) 50%, var(--color-base) 100%)">
					<div class="absolute inset-0 opacity-20" style="background: radial-gradient(ellipse at 30% 50%, var(--color-accent) 0%, transparent 60%)"></div>
				</div>
			{/if}
		{/key}

		<!-- Gradient overlays -->
		<div class="absolute inset-0" style="background: linear-gradient(to top, var(--color-void) 0%, rgba(13,11,10,0.7) 35%, rgba(13,11,10,0.2) 60%, transparent 100%)"></div>
		<div class="absolute inset-0" style="background: linear-gradient(to right, rgba(13,11,10,0.85) 0%, rgba(13,11,10,0.4) 40%, transparent 70%)"></div>

		<!-- Content -->
		<div class="absolute bottom-0 left-0 right-0 flex items-end p-4 pb-5 sm:p-6 sm:pb-8 md:p-8 md:pb-10">
			<div class="max-w-2xl">
				<div class="flex items-center gap-2">
					<span
						class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]"
						style="background: color-mix(in srgb, var(--color-accent) 20%, transparent)"
					>
						Top Pick
					</span>
					<ServiceBadge type={current.serviceType} />
					{#if current.year}
						<span class="text-xs font-medium text-white/50">{current.year}</span>
					{/if}
					{#if current.runtime}
						<span class="text-xs text-white/30">&middot;</span>
						<span class="text-xs font-medium text-white/50">{current.runtime}</span>
					{/if}
					{#if current.rating}
						<span class="text-xs text-white/30">&middot;</span>
						<span class="flex items-center gap-0.5 text-xs font-medium text-[var(--color-accent)]">
							&#9733; {current.rating.toFixed(1)}
						</span>
					{/if}
				</div>

				{#key currentIndex}
					<h1 class="text-display mt-2 text-2xl font-bold leading-[1.1] tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] animate-fade-in sm:mt-3 sm:text-3xl md:text-4xl lg:text-5xl">
						{current.title}
					</h1>
				{/key}

				{#if current.genres && current.genres.length > 0}
					<div class="mt-2 flex flex-wrap gap-1">
						{#each current.genres.slice(0, 3) as genre, i}
							<span class="text-xs font-medium text-white/40">{genre}</span>
							{#if i < Math.min(current.genres.length, 3) - 1}
								<span class="text-xs text-white/20">&middot;</span>
							{/if}
						{/each}
					</div>
				{/if}

				{#if current.reason}
					<p class="mt-2 text-sm" style="color: color-mix(in srgb, var(--color-accent) 80%, transparent)">
						{current.reason}
					</p>
				{/if}

				{#if current.overview}
					<p class="mt-2 hidden text-sm leading-relaxed text-white/60 line-clamp-2 sm:block sm:max-w-lg sm:mt-3">
						{current.overview}
					</p>
				{/if}

				<div class="mt-3 flex gap-2 sm:mt-5 sm:gap-3">
					{#if current.streamUrl}
						<a
							href="/media/{current.mediaType}/{current.sourceId}?service={current.serviceId}&play=1"
							class="btn btn-primary text-sm sm:text-base"
							style="padding: 0.5rem 1.25rem;"
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>
							Play
						</a>
					{/if}
					<a
						href="/media/{current.mediaType}/{current.sourceId}?service={current.serviceId}"
						class="btn btn-ghost text-sm sm:text-base"
						style="padding: 0.5rem 1.25rem; border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.8);"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
						More Info
					</a>
				</div>
			</div>
		</div>

		<!-- Navigation arrows -->
		{#if items.length > 1}
			<button
				class="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
				onclick={prev}
				aria-label="Previous slide"
			>
				&#8249;
			</button>
			<button
				class="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
				onclick={next}
				aria-label="Next slide"
			>
				&#8250;
			</button>

			<!-- Dot indicators -->
			<div class="absolute right-4 top-4 flex gap-1.5">
				{#each items as _, i}
					<button
						class="h-2 w-2 rounded-full transition-colors {i === currentIndex ? 'bg-[var(--color-accent)]' : 'bg-white/30 hover:bg-white/50'}"
						onclick={() => goto(i)}
						aria-label="Go to slide {i + 1}"
					></button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	:global(.animate-fade-in) {
		animation: fade-in 0.5s ease-out;
	}
</style>
```

- [ ] **Step 2: Verify the component compiles**

Run: `npx svelte-check --threshold error 2>&1 | tail -10`
Expected: No errors in HeroCarousel.svelte

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/HeroCarousel.svelte
git commit -m "feat: HeroCarousel component with auto-advance and keyboard nav"
```

---

### Task 5: Create ContinueWatchingCard.svelte

**Files:**
- Create: `src/lib/components/ContinueWatchingCard.svelte`

@svelte:svelte-code-writer @svelte:svelte-core-bestpractices

- [ ] **Step 1: Create the ContinueWatchingCard component**

Create `src/lib/components/ContinueWatchingCard.svelte`:

```svelte
<script lang="ts">
	import type { HomepageItem } from '$lib/server/homepage-cache';

	interface Props {
		item: HomepageItem;
	}

	let { item }: Props = $props();
</script>

<a
	href="/media/{item.mediaType}/{item.sourceId}?service={item.serviceId}{item.streamUrl ? '&play=1' : ''}"
	class="group flex-shrink-0 w-40 sm:w-48 md:w-56"
>
	<!-- Landscape thumbnail -->
	<div class="relative aspect-video overflow-hidden rounded-lg bg-[var(--color-surface)]">
		{#if item.backdrop}
			<img
				src={item.backdrop}
				alt={item.title}
				class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
				loading="lazy"
			/>
		{:else if item.poster}
			<img
				src={item.poster}
				alt={item.title}
				class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
				loading="lazy"
			/>
		{:else}
			<div class="flex h-full w-full items-center justify-center bg-[var(--color-deep)]">
				<span class="text-xs text-white/30">No image</span>
			</div>
		{/if}

		<!-- Play overlay on hover -->
		<div class="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
			<svg class="h-10 w-10 text-white opacity-0 transition-opacity group-hover:opacity-100" viewBox="0 0 24 24" fill="currentColor">
				<path d="M8 5.14v14l11-7-11-7z"/>
			</svg>
		</div>

		<!-- Progress bar -->
		{#if item.progress != null && item.progress > 0}
			<div class="absolute bottom-0 left-0 right-0 h-1 bg-white/15">
				<div
					class="h-full bg-[var(--color-accent)] transition-[width]"
					style="width: {item.progress * 100}%"
				></div>
			</div>
		{/if}
	</div>

	<!-- Title & metadata -->
	<div class="mt-1.5 min-w-0">
		<p class="truncate text-xs font-medium text-white/80 group-hover:text-white sm:text-sm">
			{item.title}
		</p>
		<div class="flex items-center gap-1 text-[11px] text-white/40">
			{#if item.episodeInfo}
				<span>{item.episodeInfo}</span>
				{#if item.timeRemaining}
					<span>&middot;</span>
				{/if}
			{/if}
			{#if item.timeRemaining}
				<span>{item.timeRemaining}</span>
			{/if}
		</div>
	</div>
</a>
```

- [ ] **Step 2: Verify the component compiles**

Run: `npx svelte-check --threshold error 2>&1 | tail -10`
Expected: No errors in ContinueWatchingCard.svelte

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ContinueWatchingCard.svelte
git commit -m "feat: ContinueWatchingCard with landscape thumbnail and progress bar"
```

---

## Chunk 3: Homepage Rewrite

### Task 6: Rewrite +page.server.ts

**Files:**
- Modify: `src/routes/+page.server.ts` (full rewrite)

- [ ] **Step 1: Rewrite the homepage server load**

Replace the entire contents of `src/routes/+page.server.ts`:

```typescript
import { getDashboardFast } from '$lib/server/services';
import { getHomepageCache, applyRowOrder, cwToItem, DEFAULT_ROW_ORDER } from '$lib/server/homepage-cache';
import type { HomepageCache, HomepageRow, HomepageItem, HeroItem } from '$lib/server/homepage-cache';
import { getRawDb } from '$lib/db';
import { DEFAULT_PROFILE } from '$lib/server/recommendations/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;

	// Parallel: live Continue Watching + pre-computed homepage cache
	const [dashboardRows, homepageCache] = await Promise.all([
		getDashboardFast(userId),
		userId ? getHomepageCache(userId) : Promise.resolve(null)
	]);

	// Build Continue Watching row from live data
	const cwDashRow = dashboardRows.find((r) => r.id === 'continue');
	const cwItems: HomepageItem[] = (cwDashRow?.items ?? []).map(cwToItem);
	const continueRow: HomepageRow | null = cwItems.length > 0
		? { id: 'continue', title: 'Continue Watching', type: 'system', items: cwItems }
		: null;

	// New in Library from live data (used in both cache-hit and cold-start paths)
	const newDashRow = dashboardRows.find((r) => r.id === 'new-in-library');
	const newRow: HomepageRow | null = newDashRow
		? {
				id: 'new',
				title: 'New in Your Library',
				subtitle: 'Recently added across your media servers',
				type: 'system',
				items: newDashRow.items.map(cwToItem) // reuse converter for UnifiedMedia
			}
		: null;

	if (homepageCache) {
		// Cache hit — full personalized homepage
		// Load user's row order preference
		let rowOrder: string[] | undefined;
		if (userId) {
			const raw = getRawDb();
			const profileRow = raw.prepare(
				`SELECT config FROM user_rec_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1`
			).get(userId) as { config: string } | undefined;
			if (profileRow?.config) {
				try {
					const config = JSON.parse(profileRow.config);
					rowOrder = config.rowOrder;
				} catch { /* use default */ }
			}
		}

		// Inject New in Library into the cached rows (it's live, not cached)
		const allRows = [...homepageCache.rows];
		if (newRow) allRows.push(newRow);

		// Apply ordering
		const orderedRows = applyRowOrder(allRows, rowOrder);

		// Continue Watching always first
		if (continueRow) orderedRows.unshift(continueRow);

		return {
			hero: homepageCache.hero,
			rows: orderedRows,
			personalized: true
		};
	}

	// Cold start — no recommendation cache
	const coldRows: HomepageRow[] = [];
	if (continueRow) coldRows.push(continueRow);
	if (newRow) coldRows.push(newRow);

	// Try to get a hero from continue watching or new in library
	const heroSource = cwDashRow?.items[0] ?? newDashRow?.items[0];
	const coldHero: HeroItem[] = heroSource?.backdrop
		? [{
				id: heroSource.id,
				sourceId: heroSource.sourceId,
				serviceId: heroSource.serviceId,
				serviceType: heroSource.serviceType,
				title: heroSource.title,
				year: heroSource.year,
				runtime: heroSource.duration
					? `${Math.floor(heroSource.duration / 3600)}h ${Math.floor((heroSource.duration % 3600) / 60)}m`
					: undefined,
				rating: heroSource.rating,
				overview: heroSource.description,
				backdrop: heroSource.backdrop,
				poster: heroSource.poster,
				mediaType: heroSource.type,
				genres: heroSource.genres,
				reason: '',
				provider: '',
				streamUrl: heroSource.streamUrl
			}]
		: [];

	return {
		hero: coldHero,
		rows: coldRows,
		personalized: false
	};
};
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.server.ts
git commit -m "feat: rewrite homepage server load with personalized cache + live CW"
```

---

### Task 7: Rewrite +page.svelte

**Files:**
- Modify: `src/routes/+page.svelte` (full rewrite)

@svelte:svelte-code-writer @svelte:svelte-core-bestpractices

- [ ] **Step 1: Rewrite the homepage template**

Replace the entire contents of `src/routes/+page.svelte`:

```svelte
<script lang="ts">
	import type { PageData } from './$types';
	import HeroCarousel from '$lib/components/HeroCarousel.svelte';
	import ContinueWatchingCard from '$lib/components/ContinueWatchingCard.svelte';
	import MediaRow from '$lib/components/MediaRow.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Nexus — Home</title>
</svelte:head>

<div class="flex min-w-0 flex-col">
	<!-- Hero Carousel -->
	{#if data.hero && data.hero.length > 0}
		<HeroCarousel items={data.hero} />
	{/if}

	<!-- Rows -->
	{#if data.rows.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[0_0_40px_rgba(212,162,83,0.12)]">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
					<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
				</svg>
			</div>
			<h2 class="text-display text-xl font-semibold">No services connected</h2>
			<p class="mt-2 text-sm text-[var(--color-muted)]">Add your media services to populate your dashboard.</p>
			<a href="/settings" class="btn btn-primary mt-6">Configure Services</a>
		</div>
	{:else}
		<div class="mt-6 flex flex-col gap-10 pb-8">
			{#each data.rows as row (row.id)}
				{#if row.id === 'continue'}
					<!-- Continue Watching: landscape cards with progress -->
					<div class="px-4">
						<h2 class="mb-3 text-base font-semibold text-white sm:text-lg">{row.title}</h2>
						<div class="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
							{#each row.items as item (item.id)}
								<ContinueWatchingCard {item} />
							{/each}
						</div>
					</div>
				{:else}
					<!-- Standard poster rows — adapt HomepageRow to DashboardRow for MediaRow -->
					{@const dashRow = {
						id: row.id,
						title: row.title,
						subtitle: row.subtitle,
						items: row.items.map(item => ({
							id: item.id,
							sourceId: item.sourceId,
							serviceId: item.serviceId,
							serviceType: item.serviceType,
							type: item.mediaType,
							title: item.title,
							description: item.description ?? '',
							poster: item.poster,
							backdrop: item.backdrop,
							year: item.year,
							rating: item.rating,
							genres: item.genres,
							streamUrl: item.streamUrl,
							metadata: item.context ? { recReason: item.context } : undefined
						}))
					}}
					<MediaRow row={dashRow} />
				{/if}
			{/each}
		</div>
	{/if}
</div>
```

- [ ] **Step 2: Verify page compiles**

Run: `npx svelte-check --threshold error 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: personalized homepage with hero carousel and typed rows"
```

---

### Task 8: Redirect /for-you to homepage

**Files:**
- Modify: `src/routes/for-you/+page.server.ts` (replace with redirect)
- Delete: `src/routes/for-you/+page.svelte`

- [ ] **Step 1: Replace /for-you with redirect**

Replace the entire contents of `src/routes/for-you/+page.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(301, '/');
};
```

- [ ] **Step 2: Delete the old page component**

Run: `rm src/routes/for-you/+page.svelte`

- [ ] **Step 3: Verify the redirect works**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/for-you/+page.server.ts
git rm src/routes/for-you/+page.svelte
git commit -m "feat: redirect /for-you to homepage"
```

---

## Chunk 4: Cache Invalidation & Integration

### Task 9: Wire up cache invalidation on profile/feedback changes

**Files:**
- Modify: `src/routes/api/recommendations/preferences/+server.ts` (if exists, add invalidation)
- Modify: `src/routes/api/recommendations/feedback/+server.ts` (if exists, add invalidation)

- [ ] **Step 1: Find and update the preferences endpoint**

Search for the PUT handler for recommendation preferences. Add this import at the top:

```typescript
import { invalidateHomepageCache } from '$lib/server/homepage-cache';
```

After the profile is updated in the database, add:

```typescript
invalidateHomepageCache(userId);
```

- [ ] **Step 2: Find and update the feedback endpoint**

Search for the POST handler for recommendation feedback (hide/unhide). Add the same import and invalidation call after the feedback is recorded.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/recommendations/
git commit -m "feat: invalidate homepage cache on profile/feedback changes"
```

---

### Task 10: Manual smoke test

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`

- [ ] **Step 2: Visit homepage**

Open `http://localhost:5173/` in browser. Verify:
- If you have watch history: hero carousel shows, reason rows + genre rows appear
- If no history: cold start view with Continue Watching (if any) + New in Library
- Continue Watching shows landscape cards with progress bars
- Hero auto-advances every 8s, pauses on hover
- Arrow/dot navigation works
- All cards link to correct `/media/[type]/[id]?service=[serviceId]` URLs

- [ ] **Step 3: Visit /for-you**

Open `http://localhost:5173/for-you`. Verify it redirects to `/`.

- [ ] **Step 4: Final commit with any fixes**

If any adjustments were needed during testing, commit them:

```bash
git add -A
git commit -m "fix: homepage smoke test fixes"
```

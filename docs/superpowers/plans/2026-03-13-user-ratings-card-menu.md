# User Ratings, Card Context Menu & Rating Labels — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5-star user ratings to the media detail page, a three-dot context menu with watchlist toggle on media cards, and source-labeled rating pills throughout.

**Architecture:** New `userRatings` table + `ratings.ts` server module following the existing `userFavorites` pattern. Client-side `favoritesStore` for card menu state. Rating labels are template-only changes in the meta-strip.

**Tech Stack:** SvelteKit, Drizzle ORM (SQLite), Svelte 5 runes ($state/$derived/$effect)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/db/schema.ts` | Modify | Add `userRatings` table definition + type export |
| `src/lib/server/ratings.ts` | Create | CRUD functions + cached aggregate stats |
| `src/routes/api/media/[id]/ratings/+server.ts` | Create | GET/POST/DELETE API endpoints |
| `src/lib/stores/favorites.ts` | Create | Client-side favorites store indexed by mediaId:serviceId |
| `src/lib/components/MediaCard.svelte` | Modify | Add three-dot menu with watchlist toggle |
| `src/routes/media/[type]/[id]/+page.server.ts` | Modify | Load user rating + aggregate stats |
| `src/routes/media/[type]/[id]/+page.svelte` | Modify | Star widget in Zone C, source-labeled rating pills in meta-strip |

---

## Task 1: Database — `userRatings` table

**Files:**
- Modify: `src/lib/db/schema.ts` (after line 328, after `UserFavorite` type export)

- [ ] **Step 1: Add table definition**

In `src/lib/db/schema.ts`, after the `UserFavorite` type export (line 328), add:

```typescript
// ── User Ratings ────────────────────────────────────────────────────

export const userRatings = sqliteTable('user_ratings', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	mediaId: text('media_id').notNull(),
	serviceId: text('service_id').notNull(),
	mediaType: text('media_type').notNull(),
	rating: integer('rating').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export type UserRating = typeof userRatings.$inferSelect;
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/parker/Developer/Nexus && pnpm build 2>&1 | tail -5`
Expected: `✓ built in` — no new errors from the schema change.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat: add userRatings table schema"
```

---

## Task 2: Server — `src/lib/server/ratings.ts`

**Files:**
- Create: `src/lib/server/ratings.ts`

- [ ] **Step 1: Create ratings server module**

Create `src/lib/server/ratings.ts`:

```typescript
import { randomBytes } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { withCache, invalidate } from './cache';
import { emitMediaEvent } from './analytics';

function genId(): string {
	return randomBytes(16).toString('hex');
}

export function getUserRating(
	userId: string,
	mediaId: string,
	serviceId: string
): number | null {
	const db = getDb();
	const row = db
		.select({ rating: schema.userRatings.rating })
		.from(schema.userRatings)
		.where(
			and(
				eq(schema.userRatings.userId, userId),
				eq(schema.userRatings.mediaId, mediaId),
				eq(schema.userRatings.serviceId, serviceId)
			)
		)
		.get();
	return row?.rating ?? null;
}

export function upsertRating(
	userId: string,
	mediaId: string,
	serviceId: string,
	rating: number,
	meta: { mediaType: string; serviceType: string }
): void {
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		throw new Error('Rating must be an integer between 1 and 5');
	}

	const db = getDb();
	const now = Date.now();
	const existing = db
		.select({ id: schema.userRatings.id })
		.from(schema.userRatings)
		.where(
			and(
				eq(schema.userRatings.userId, userId),
				eq(schema.userRatings.mediaId, mediaId),
				eq(schema.userRatings.serviceId, serviceId)
			)
		)
		.get();

	if (existing) {
		db.update(schema.userRatings)
			.set({ rating, updatedAt: now })
			.where(eq(schema.userRatings.id, existing.id))
			.run();
	} else {
		db.insert(schema.userRatings)
			.values({
				id: genId(),
				userId,
				mediaId,
				serviceId,
				mediaType: meta.mediaType,
				rating,
				createdAt: now,
				updatedAt: now
			})
			.run();
	}

	invalidate(`rating-stats:${mediaId}:${serviceId}`);

	emitMediaEvent({
		userId,
		serviceId,
		serviceType: meta.serviceType,
		eventType: 'rate',
		mediaId,
		mediaType: meta.mediaType,
		metadata: { rating }
	});
}

export function deleteRating(
	userId: string,
	mediaId: string,
	serviceId: string,
	meta: { serviceType: string; mediaType: string }
): boolean {
	const db = getDb();
	const result = db
		.delete(schema.userRatings)
		.where(
			and(
				eq(schema.userRatings.userId, userId),
				eq(schema.userRatings.mediaId, mediaId),
				eq(schema.userRatings.serviceId, serviceId)
			)
		)
		.run();

	invalidate(`rating-stats:${mediaId}:${serviceId}`);

	emitMediaEvent({
		userId,
		serviceId,
		serviceType: meta.serviceType,
		eventType: 'rate',
		mediaId,
		mediaType: meta.mediaType,
		metadata: { cleared: true }
	});

	return result.changes > 0;
}

export async function getMediaRatingStats(
	mediaId: string,
	serviceId: string
): Promise<{ avg: number; count: number } | null> {
	return withCache(`rating-stats:${mediaId}:${serviceId}`, 2 * 60 * 1000, async () => {
		const db = getDb();
		const row = db
			.get<{ avg: number | null; count: number }>(
				sql`SELECT AVG(rating) as avg, COUNT(*) as count FROM user_ratings WHERE media_id = ${mediaId} AND service_id = ${serviceId}`
			);
		if (!row || row.count === 0) return null;
		return { avg: Math.round(row.avg! * 10) / 10, count: row.count };
	});
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/parker/Developer/Nexus && pnpm build 2>&1 | tail -5`
Expected: `✓ built in` — no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/ratings.ts
git commit -m "feat: add ratings server module with CRUD and cached aggregates"
```

---

## Task 3: API — `/api/media/[id]/ratings`

**Files:**
- Create: `src/routes/api/media/[id]/ratings/+server.ts`

- [ ] **Step 1: Create API route**

Create directory and file `src/routes/api/media/[id]/ratings/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import { getUserRating, upsertRating, deleteRating, getMediaRatingStats } from '$lib/server/ratings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);
	const service = url.searchParams.get('service');
	if (!service) throw error(400, 'Missing service param');

	const userRating = getUserRating(locals.user.id, params.id, service);
	const stats = await getMediaRatingStats(params.id, service);
	return json({ userRating, stats });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const { service, rating, mediaType, serviceType } = await request.json();
	if (!service || !rating || !mediaType || !serviceType) throw error(400, 'Missing fields');
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw error(400, 'Rating must be 1-5');

	upsertRating(locals.user.id, params.id, service, rating, { mediaType, serviceType });
	const stats = await getMediaRatingStats(params.id, service);
	return json({ userRating: rating, stats });
};

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);
	const service = url.searchParams.get('service');
	const serviceType = url.searchParams.get('serviceType') ?? 'unknown';
	const mediaType = url.searchParams.get('mediaType') ?? 'unknown';
	if (!service) throw error(400, 'Missing service param');

	deleteRating(locals.user.id, params.id, service, { serviceType, mediaType });
	const stats = await getMediaRatingStats(params.id, service);
	return json({ userRating: null, stats });
};
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/parker/Developer/Nexus && pnpm build 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/media/\[id\]/ratings/
git commit -m "feat: add ratings API endpoints (GET/POST/DELETE)"
```

---

## Task 4: Media Detail Page — Load Ratings Data

**Files:**
- Modify: `src/routes/media/[type]/[id]/+page.server.ts` (after watchlist check, ~line 373; and in return object, ~line 375)

- [ ] **Step 1: Add imports and load rating data**

At the top of `+page.server.ts`, add import:

```typescript
import { getUserRating, getMediaRatingStats } from '$lib/server/ratings';
```

After the watchlist check block (after line 373 `const favoriteId = watchlistEntry?.id ?? null;`), add:

```typescript
	// ── User rating ────────────────────────────────────────────────────
	const userRating = userId ? getUserRating(userId, params.id, serviceId) : null;
	const ratingStats = await getMediaRatingStats(params.id, serviceId);
```

In the return object (line 375), add after `favoriteId`:

```typescript
		userRating,
		ratingStats,
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/parker/Developer/Nexus && pnpm build 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add src/routes/media/\[type\]/\[id\]/+page.server.ts
git commit -m "feat: load user rating and aggregate stats in media detail page"
```

---

## Task 5: Media Detail Page — Star Widget & Rating Labels

**Files:**
- Modify: `src/routes/media/[type]/[id]/+page.svelte`

This task has three sub-parts: (A) script state, (B) star widget template + CSS, (C) rating source labels.

### 5A: Script State

- [ ] **Step 1: Add rating state variables**

In the `<script>` section, after the existing `data` destructuring and derived values, add:

```typescript
	// ── User rating ──────────────────────────────────────────────────
	let userRating = $state(data.userRating as number | null);
	let ratingStats = $state(data.ratingStats as { avg: number; count: number } | null);
	let ratingHover = $state(0); // 0 = not hovering, 1-5 = hovered star
	let ratingCleared = $state(false);

	// Reset rating state when navigating to different item
	$effect(() => {
		void data.item.sourceId;
		userRating = data.userRating as number | null;
		ratingStats = data.ratingStats as { avg: number; count: number } | null;
		ratingCleared = false;
	});

	// Rating source label
	const ratingSource = $derived.by(() => {
		const st = data.serviceType;
		if (st === 'jellyfin') return 'Community';
		if (st === 'overseerr') return 'TMDB';
		if (st === 'radarr') return 'IMDb';
		if (st === 'sonarr') return 'TMDB';
		return 'Rating';
	});

	async function submitRating(value: number) {
		if (value === userRating) {
			// Clear rating
			const prev = userRating;
			const prevStats = ratingStats;
			userRating = null;
			ratingCleared = true;
			setTimeout(() => (ratingCleared = false), 2000);
			try {
				const res = await fetch(
					`/api/media/${item.sourceId}/ratings?service=${data.serviceId}&serviceType=${data.serviceType}&mediaType=${item.type}`,
					{ method: 'DELETE' }
				);
				const json = await res.json();
				ratingStats = json.stats;
			} catch {
				userRating = prev;
				ratingStats = prevStats;
			}
		} else {
			// Set rating
			const prev = userRating;
			const prevStats = ratingStats;
			userRating = value;
			ratingCleared = false;
			try {
				const res = await fetch(`/api/media/${item.sourceId}/ratings`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						service: data.serviceId,
						rating: value,
						mediaType: item.type,
						serviceType: data.serviceType
					})
				});
				const json = await res.json();
				ratingStats = json.stats;
			} catch {
				userRating = prev;
				ratingStats = prevStats;
			}
		}
	}
```

### 5B: Star Widget Template + CSS

- [ ] **Step 2: Add star widget in Zone C**

In Zone C, BEFORE the action row (`<div class="anim action-row"`), add the star widget:

```svelte
							<!-- Star rating -->
							<div class="anim star-widget" style="--d:555ms">
								<div
									class="star-row"
									onmouseleave={() => (ratingHover = 0)}
									role="group"
									aria-label="Rate this {item.type}"
								>
									{#each [1, 2, 3, 4, 5] as star}
										<button
											class="star-btn"
											class:star-filled={(ratingHover || userRating || 0) >= star}
											onmouseenter={() => (ratingHover = star)}
											onclick={() => submitRating(star)}
											aria-label="{star} star{star !== 1 ? 's' : ''}"
										>
											<svg width="18" height="18" viewBox="0 0 24 24" fill={((ratingHover || userRating || 0) >= star) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5">
												<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
											</svg>
										</button>
									{/each}
								</div>
								{#if ratingStats}
									<span class="star-aggregate">{ratingStats.avg.toFixed(1)} avg ({ratingStats.count})</span>
								{/if}
								{#if ratingCleared}
									<span class="star-cleared">Rating cleared</span>
								{/if}
							</div>
```

- [ ] **Step 3: Add star widget CSS**

In the `<style>` section, add after the `.action-row` styles (after the `.act-status--requested` block):

```css
	/* Star Rating Widget */
	.star-widget {
		display: flex; align-items: center; gap: 0.75rem;
		flex-wrap: wrap;
	}
	.star-row {
		display: inline-flex; gap: 0.15rem;
	}
	.star-btn {
		background: none; border: none; cursor: pointer;
		color: rgba(240,235,227,0.25);
		padding: 0.1rem;
		transition: color 0.15s ease, transform 0.15s ease;
	}
	.star-btn:hover { transform: scale(1.15); }
	.star-filled { color: var(--color-accent); }
	.star-aggregate {
		font-size: 0.72rem; color: var(--color-muted);
		font-weight: 500;
	}
	.star-cleared {
		font-size: 0.68rem; color: rgba(240,235,227,0.45);
		font-style: italic;
		animation: fadeInOut 2s ease forwards;
	}
	@keyframes fadeInOut {
		0% { opacity: 0; }
		15% { opacity: 1; }
		75% { opacity: 1; }
		100% { opacity: 0; }
	}
```

### 5C: Rating Source Labels in Meta-strip

- [ ] **Step 4: Update meta-strip template**

Replace the current star rating display in the meta-strip. Find this block in Zone A:

```svelte
						{#if item.rating}
							<span class="dot">·</span>
							<span class="star-val">★ {item.rating.toFixed(1)}</span>
						{/if}
```

Replace with:

```svelte
						{#if item.rating}
							<span class="dot">·</span>
							<span class="rating-pill">
								<span class="rating-source">{ratingSource}</span>
								{item.rating.toFixed(1)}
							</span>
						{/if}
						{#if ratingStats}
							<span class="dot">·</span>
							<span class="rating-pill rating-pill--nexus">
								<span class="rating-source">Nexus</span>
								★ {ratingStats.avg.toFixed(1)}
								<span class="rating-count">({ratingStats.count})</span>
							</span>
						{/if}
```

- [ ] **Step 5: Update critic tag in Zone B**

Find the critic tag in Zone B:

```svelte
								{#if criticRating != null}
									<span class="critic-tag">{criticRating}%</span>
								{/if}
```

Replace with:

```svelte
								{#if criticRating != null}
									<span class="critic-tag">Critic {criticRating}%</span>
								{/if}
```

- [ ] **Step 6: Add rating label CSS**

In the `<style>` section, replace the `.star-val` line inside `.meta-strip` area:

```css
	.star-val { color: var(--color-accent); }
```

With the new rating pill styles (keep `.star-val` for backward compat if used elsewhere):

```css
	.star-val { color: var(--color-accent); }

	.rating-pill {
		display: inline-flex; align-items: center; gap: 0.3rem;
		padding: 0.1rem 0.45rem; border-radius: 4px;
		background: rgba(240,235,227,0.06);
		font-size: 0.78rem; font-weight: 600;
		color: rgba(240,235,227,0.72);
	}
	.rating-source {
		font-size: 0.58rem; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.05em;
		color: rgba(240,235,227,0.4);
	}
	.rating-pill--nexus {
		background: rgba(212,162,83,0.1);
		color: var(--color-accent);
	}
	.rating-pill--nexus .rating-source {
		color: rgba(212,162,83,0.55);
	}
	.rating-count {
		font-size: 0.6rem; font-weight: 400;
		color: rgba(240,235,227,0.4);
	}
```

- [ ] **Step 7: Verify build and test**

Run: `cd /Users/parker/Developer/Nexus && pnpm build 2>&1 | tail -5`

Manually verify at: `http://localhost:5173/media/movie/2ba8fac7846bc995460a0e4adfcc3e4f?service=the-media-place`
- Star widget visible in Zone C above action buttons
- External rating shows source label (e.g. "COMMUNITY 7.2")
- Nexus rating pill appears only when aggregate exists
- Clicking a star updates immediately, clicking same star clears with "Rating cleared" text
- Critic tag shows "Critic" prefix

- [ ] **Step 8: Commit**

```bash
git add src/routes/media/\[type\]/\[id\]/+page.svelte
git commit -m "feat: add star rating widget and source-labeled rating pills"
```

---

## Task 6: Client-Side Favorites Store

**Files:**
- Create: `src/lib/stores/favorites.ts`

- [ ] **Step 1: Create favorites store**

Create `src/lib/stores/favorites.ts`:

```typescript
import { browser } from '$app/environment';

interface FavoriteEntry {
	id: string;
	mediaId: string;
	serviceId: string;
	mediaType: string;
	mediaTitle: string;
	mediaPoster: string | null;
}

let favorites = $state<FavoriteEntry[]>([]);
let loaded = $state(false);

// Index for O(1) lookup by mediaId:serviceId
const index = $derived.by(() => {
	const map = new Map<string, FavoriteEntry>();
	for (const f of favorites) {
		map.set(`${f.mediaId}:${f.serviceId}`, f);
	}
	return map;
});

export const favoritesStore = {
	get favorites() { return favorites; },
	get loaded() { return loaded; },

	isInWatchlist(mediaId: string, serviceId: string): boolean {
		return index.has(`${mediaId}:${serviceId}`);
	},

	getFavoriteId(mediaId: string, serviceId: string): string | null {
		return index.get(`${mediaId}:${serviceId}`)?.id ?? null;
	},

	async load() {
		if (!browser || loaded) return;
		try {
			const res = await fetch('/api/user/favorites');
			if (res.ok) {
				favorites = await res.json();
				loaded = true;
			}
		} catch { /* silent */ }
	},

	async toggle(item: { sourceId: string; serviceId: string; type: string; title: string; poster?: string | null }) {
		const key = `${item.sourceId}:${item.serviceId}`;
		const existing = index.get(key);

		if (existing) {
			// Remove — optimistic
			const prev = [...favorites];
			favorites = favorites.filter((f) => f.id !== existing.id);
			try {
				const res = await fetch(`/api/user/favorites?id=${existing.id}`, { method: 'DELETE' });
				if (!res.ok) favorites = prev;
			} catch {
				favorites = prev;
			}
		} else {
			// Add — optimistic
			const tempId = crypto.randomUUID();
			const entry: FavoriteEntry = {
				id: tempId,
				mediaId: item.sourceId,
				serviceId: item.serviceId,
				mediaType: item.type,
				mediaTitle: item.title,
				mediaPoster: item.poster ?? null
			};
			favorites = [...favorites, entry];
			try {
				const res = await fetch('/api/user/favorites', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						mediaId: item.sourceId,
						serviceId: item.serviceId,
						mediaType: item.type,
						mediaTitle: item.title,
						mediaPoster: item.poster ?? null
					})
				});
				if (res.ok) {
					const { id } = await res.json();
					// Replace temp ID with real ID
					favorites = favorites.map((f) => f.id === tempId ? { ...f, id } : f);
				} else {
					favorites = favorites.filter((f) => f.id !== tempId);
				}
			} catch {
				favorites = favorites.filter((f) => f.id !== tempId);
			}
		}
	}
};
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/parker/Developer/Nexus && pnpm build 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/favorites.ts
git commit -m "feat: add client-side favorites store with optimistic updates"
```

---

## Task 7: MediaCard — Three-Dot Context Menu

**Files:**
- Modify: `src/lib/components/MediaCard.svelte`

- [ ] **Step 1: Add imports and menu state**

In the `<script>` section, add import and state:

```typescript
	import { favoritesStore } from '$lib/stores/favorites';
	import { onMount } from 'svelte';

	let menuOpen = $state(false);
	const inWatchlist = $derived(favoritesStore.isInWatchlist(item.sourceId, item.serviceId));

	onMount(() => { favoritesStore.load(); });

	function handleMenuToggle(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		menuOpen = !menuOpen;
	}

	function handleWatchlistToggle(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		menuOpen = false;
		favoritesStore.toggle(item);
	}

	function handleClickOutside() {
		if (menuOpen) menuOpen = false;
	}
```

- [ ] **Step 2: Add three-dot button and menu to template**

Inside the poster `<div>` (the one with `class="relative overflow-hidden rounded-[10px]..."`), after the status badge block (after line 138), add:

```svelte
		<!-- Three-dot menu -->
		<div class="card-menu-anchor">
			<button
				class="card-menu-btn"
				onclick={handleMenuToggle}
				aria-label="More options"
			>
				<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
					<circle cx="8" cy="3" r="1.5"/>
					<circle cx="8" cy="8" r="1.5"/>
					<circle cx="8" cy="13" r="1.5"/>
				</svg>
			</button>
			{#if menuOpen}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="card-menu" onmouseleave={handleClickOutside}>
					<button class="card-menu-item" onclick={handleWatchlistToggle}>
						{#if inWatchlist}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
							<span>In Watchlist</span>
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="ml-auto opacity-60"><path d="M2 6l3 3 5-5"/></svg>
						{:else}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
							<span>Add to Watchlist</span>
						{/if}
					</button>
				</div>
			{/if}
		</div>
```

- [ ] **Step 3: Add CSS for three-dot menu**

Add a `<style>` section to `MediaCard.svelte` (it currently uses only Tailwind classes):

```css
<style>
	.card-menu-anchor {
		position: absolute; top: 0.4rem; right: 0.4rem; z-index: 15;
	}
	.card-menu-btn {
		display: flex; align-items: center; justify-content: center;
		width: 1.6rem; height: 1.6rem; border-radius: 6px;
		background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
		border: 1px solid rgba(255,255,255,0.08);
		color: rgba(255,255,255,0.7); cursor: pointer;
		opacity: 0; transition: opacity 0.2s ease, background 0.15s ease;
	}
	:global(.group:hover) .card-menu-btn { opacity: 1; }
	.card-menu-btn:hover { background: rgba(0,0,0,0.8); color: white; }
	@media (hover: none) { .card-menu-btn { opacity: 1; } }

	.card-menu {
		position: absolute; top: 100%; right: 0;
		margin-top: 0.3rem; min-width: 10rem;
		background: var(--color-surface);
		border: 1px solid rgba(240,235,227,0.08);
		border-radius: 8px; overflow: hidden;
		box-shadow: 0 8px 32px rgba(0,0,0,0.6);
		animation: menuIn 0.15s ease;
	}
	@keyframes menuIn {
		from { opacity: 0; transform: translateY(-4px) scale(0.96); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}
	.card-menu-item {
		display: flex; align-items: center; gap: 0.5rem;
		width: 100%; padding: 0.5rem 0.7rem;
		background: none; border: none; cursor: pointer;
		font-size: 0.72rem; font-weight: 500;
		color: var(--color-cream);
		transition: background 0.15s ease;
	}
	.card-menu-item:hover {
		background: rgba(240,235,227,0.06);
	}
</style>
```

- [ ] **Step 4: Handle status badge conflict with menu button**

The status badge currently uses `absolute top-2 right-2`. When the three-dot menu is also top-right, they overlap. Move the status badge to top-left. Find:

```svelte
		{#if item.status && item.status !== 'available'}
			<div class="absolute top-2 right-2">
```

Replace with:

```svelte
		{#if item.status && item.status !== 'available'}
			<div class="absolute top-2 left-2">
```

- [ ] **Step 5: Verify build and test**

Run: `cd /Users/parker/Developer/Nexus && pnpm build 2>&1 | tail -5`

Manually verify:
- Hover over a MediaCard on `/discover` or `/search` — three-dot button appears top-right
- Click three-dot — dropdown opens with "Add to Watchlist"
- Click "Add to Watchlist" — text changes to "In Watchlist" with checkmark
- Click "In Watchlist" — toggles back
- Click outside menu or move mouse away — menu closes
- Card click still navigates to detail page
- Mobile: three-dot button always visible

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/MediaCard.svelte
git commit -m "feat: add three-dot context menu with watchlist toggle on media cards"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Full build check**

Run: `cd /Users/parker/Developer/Nexus && pnpm build 2>&1 | tail -10`
Expected: No new errors from our changes.

- [ ] **Step 2: End-to-end manual test**

Navigate to `http://localhost:5173/media/movie/2ba8fac7846bc995460a0e4adfcc3e4f?service=the-media-place`:
- [ ] Star widget visible in Zone C, stars are outlined
- [ ] Clicking star 4 fills stars 1-4 in accent color
- [ ] Aggregate text appears: "4.0 avg (1)"
- [ ] Clicking star 4 again clears, shows "Rating cleared"
- [ ] Meta-strip shows labeled rating: "COMMUNITY 7.2" (or similar)
- [ ] Nexus pill appears after rating: "NEXUS ★ 4.0 (1)"
- [ ] Critic tag shows "Critic" prefix

Navigate to `/discover` or a browse page:
- [ ] MediaCard hover shows three-dot button top-right
- [ ] Three-dot click opens menu, "Add to Watchlist" works
- [ ] Toggle back and forth works
- [ ] Card navigation still works

Check episode page (any episode detail):
- [ ] Star widget works for episodes too
- [ ] Source labels display correctly

- [ ] **Step 3: Commit all remaining changes**

If any fixes were needed during testing, commit them.

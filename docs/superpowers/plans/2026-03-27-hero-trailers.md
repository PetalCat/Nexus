# Hero Trailers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-playing muted trailers as hero backdrops and unify all hero sections into a single reusable component with three modes (carousel, detail, browse).

**Architecture:** A `TrailerPlayer.svelte` component handles video playback as a backdrop layer. A `HeroSection.svelte` wrapper provides the shared backdrop/gradient/controls structure with a content slot. Jellyfin's `RemoteTrailers` field is the primary trailer source, with Invidious search as fallback. A `/api/media/[id]/trailer` endpoint resolves trailer URLs lazily for card hover. User preference for autoplay stored in `app_settings`.

**Tech Stack:** SvelteKit 2, Svelte 5, hls.js (existing), Jellyfin API, Invidious API, existing Rust stream proxy

**IMPORTANT:** Do NOT modify any files in `src/routes/books/`, `src/lib/components/books/`, or book-related adapters.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/lib/components/TrailerPlayer.svelte` | Video element that plays trailer as backdrop layer (autoplay muted, fade-in, error fallback) |
| `src/lib/components/HeroSection.svelte` | Unified hero wrapper: backdrop image OR trailer, gradients, mute toggle, content slot |
| `src/lib/server/trailers.ts` | Resolve trailer URLs: Jellyfin RemoteTrailers → Invidious search → stream proxy URL |
| `src/routes/api/media/[id]/trailer/+server.ts` | GET endpoint returning resolved trailer stream URL for lazy loading |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/adapters/jellyfin.ts:117` | Add `RemoteTrailers` to FIELDS constant |
| `src/lib/adapters/jellyfin.ts:218-241` | Extract first trailer URL into `metadata.trailerUrl` in `normalize()` |
| `src/lib/adapters/types.ts:5-31` | Document `trailerUrl` in metadata (no type change — metadata is `Record<string, unknown>`) |
| `src/lib/types/homepage.ts:3-20` | Add `trailerUrl?: string` to `HeroItem` |
| `src/lib/server/homepage-cache.ts:93-113` | Pass `trailerUrl` through in `recToHero()` |
| `src/routes/+page.svelte` | Replace `HeroCarousel` with `HeroSection` in carousel mode |
| `src/routes/movies/+page.svelte` | Replace inline hero with `HeroSection` in browse mode |
| `src/routes/shows/+page.svelte` | Replace inline hero with `HeroSection` in browse mode |
| `src/routes/media/[type]/[id]/+page.svelte` | Replace inline hero with `HeroSection` in detail mode |
| `src/routes/media/[type]/[id]/+page.server.ts` | Add `trailerUrl` to returned data |

---

## Chunk 1: Data Layer

### Task 1: Add RemoteTrailers to Jellyfin Adapter

**Files:**
- Modify: `src/lib/adapters/jellyfin.ts`

- [ ] **Step 1: Add RemoteTrailers to FIELDS constant**

In `src/lib/adapters/jellyfin.ts`, line 117, append `,RemoteTrailers` to the FIELDS string:

```typescript
const FIELDS = 'Overview,Genres,Studios,BackdropImageTags,ImageTags,UserData,ParentId,SeriesId,SeriesName,ParentIndexNumber,IndexNumber,AlbumArtist,Artists,ArtistItems,Album,AlbumId,RemoteTrailers';
```

- [ ] **Step 2: Extract trailer URL in normalize()**

In the `normalize()` function, in the metadata object construction (around line 218-241), add after the `taglines` line:

```typescript
			trailerUrl: item.RemoteTrailers?.[0]?.Url ?? null,
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/adapters/jellyfin.ts
git commit -m "feat: fetch RemoteTrailers from Jellyfin and store in metadata"
```

---

### Task 2: Add trailerUrl to HeroItem Type

**Files:**
- Modify: `src/lib/types/homepage.ts`
- Modify: `src/lib/server/homepage-cache.ts`

- [ ] **Step 1: Add trailerUrl to HeroItem interface**

In `src/lib/types/homepage.ts`, add after the `streamUrl` field (line 19):

```typescript
	trailerUrl?: string;
```

- [ ] **Step 2: Pass trailerUrl in recToHero()**

In `src/lib/server/homepage-cache.ts`, in the `recToHero()` function (around line 93-113), add to the returned object:

```typescript
		trailerUrl: (item.metadata?.trailerUrl as string) ?? undefined,
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/homepage.ts src/lib/server/homepage-cache.ts
git commit -m "feat: pass trailerUrl through HeroItem and homepage cache"
```

---

### Task 3: Trailer Resolution Service

**Files:**
- Create: `src/lib/server/trailers.ts`

- [ ] **Step 1: Create the trailer resolution module**

```typescript
// src/lib/server/trailers.ts
import { withCache } from './cache';
import { getEnabledConfigs } from './services';
import { registry } from '$lib/adapters/registry';
import { resolveUserCred } from './services';

/**
 * Resolve a trailer URL for a media item.
 * 1. Check metadata.trailerUrl (from Jellyfin RemoteTrailers — typically YouTube)
 * 2. If YouTube URL + Invidious configured, resolve to proxied stream URL
 * 3. If no trailer from Jellyfin + Invidious configured, search for one
 * 4. Returns a playable stream URL or null
 */
export async function resolveTrailerUrl(
	mediaId: string,
	serviceId: string,
	title: string,
	year?: number,
	metadataTrailerUrl?: string | null,
	userId?: string
): Promise<string | null> {
	const cacheKey = `trailer:${mediaId}:${serviceId}`;

	return withCache(cacheKey, 24 * 60 * 60 * 1000, async () => {
		// Step 1: Try Jellyfin's RemoteTrailers URL
		const youtubeId = extractYouTubeId(metadataTrailerUrl);

		// Step 2: If we have a YouTube ID, resolve via Invidious
		if (youtubeId) {
			const streamUrl = await resolveViaInvidious(youtubeId, userId);
			if (streamUrl) return streamUrl;
		}

		// Step 3: No Jellyfin trailer — search Invidious
		if (!youtubeId) {
			const searchUrl = await searchInvidiousTrailer(title, year, userId);
			if (searchUrl) return searchUrl;
		}

		return null;
	});
}

function extractYouTubeId(url?: string | null): string | null {
	if (!url) return null;
	// Match youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID
	const match = url.match(
		/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
	);
	return match?.[1] ?? null;
}

async function getInvidiousConfig(): Promise<{ config: any; userCred: any } | null> {
	const configs = getEnabledConfigs();
	const invConfig = configs.find((c) => c.type === 'invidious');
	if (!invConfig) return null;
	return { config: invConfig, userCred: null };
}

async function resolveViaInvidious(
	youtubeId: string,
	userId?: string
): Promise<string | null> {
	const inv = await getInvidiousConfig();
	if (!inv) return null;

	try {
		const baseUrl = inv.config.url.replace(/\/$/, '');
		// Use Invidious API to get video streams
		const res = await fetch(`${baseUrl}/api/v1/videos/${youtubeId}`, {
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return null;
		const data = await res.json();

		// Prefer adaptive format (720p or lower for trailers)
		const stream = data.adaptiveFormats
			?.filter((f: any) => f.type?.startsWith('video/mp4') && f.qualityLabel)
			?.sort((a: any, b: any) => {
				const aH = parseInt(a.qualityLabel) || 0;
				const bH = parseInt(b.qualityLabel) || 0;
				// Prefer 720p, then lower
				if (aH <= 720 && bH <= 720) return bH - aH;
				if (aH <= 720) return -1;
				if (bH <= 720) return 1;
				return aH - bH;
			})?.[0];

		if (stream?.url) return stream.url;

		// Fallback to format streams
		const fallback = data.formatStreams?.find(
			(f: any) => f.type?.startsWith('video/mp4')
		);
		return fallback?.url ?? null;
	} catch {
		return null;
	}
}

async function searchInvidiousTrailer(
	title: string,
	year?: number,
	userId?: string
): Promise<string | null> {
	const inv = await getInvidiousConfig();
	if (!inv) return null;

	try {
		const query = `${title} ${year ?? ''} official trailer`.trim();
		const baseUrl = inv.config.url.replace(/\/$/, '');
		const res = await fetch(
			`${baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
			{ signal: AbortSignal.timeout(8000) }
		);
		if (!res.ok) return null;
		const results = await res.json();

		const firstVideo = results?.[0];
		if (!firstVideo?.videoId) return null;

		// Resolve this video's stream URL
		return resolveViaInvidious(firstVideo.videoId, userId);
	} catch {
		return null;
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/trailers.ts
git commit -m "feat: trailer resolution service (Jellyfin → Invidious → stream URL)"
```

---

### Task 4: Trailer API Endpoint

**Files:**
- Create: `src/routes/api/media/[id]/trailer/+server.ts`

- [ ] **Step 1: Create the endpoint**

```typescript
// src/routes/api/media/[id]/trailer/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceConfig } from '$lib/server/services';
import { resolveTrailerUrl } from '$lib/server/trailers';
import { registry } from '$lib/adapters/registry';
import { resolveUserCred } from '$lib/server/services';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);

	const serviceId = url.searchParams.get('service');
	if (!serviceId) throw error(400, 'Missing service param');

	const config = getServiceConfig(serviceId);
	if (!config) throw error(404, 'Service not found');

	const adapter = registry.get(config.type);
	if (!adapter) throw error(404, 'Adapter not found');

	// Fetch item to get metadata (including trailerUrl)
	const userCred = resolveUserCred(config, locals.user.id);
	const item = await adapter.getItem(config, params.id, userCred);
	if (!item) throw error(404, 'Item not found');

	const trailerUrl = await resolveTrailerUrl(
		params.id,
		serviceId,
		item.title,
		item.year,
		(item.metadata?.trailerUrl as string) ?? null,
		locals.user.id
	);

	return json({ trailerUrl });
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/media/\[id\]/trailer/
git commit -m "feat: trailer resolution API endpoint"
```

---

## Chunk 2: UI Components

### Task 5: TrailerPlayer Component

**Files:**
- Create: `src/lib/components/TrailerPlayer.svelte`

- [ ] **Step 1: Create the TrailerPlayer component**

```svelte
<!-- src/lib/components/TrailerPlayer.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let {
		src,
		delay = 5000,
		autoplay = true,
		muted = $bindable(true),
		playing = $bindable(false)
	}: {
		src?: string | null;
		delay?: number;
		autoplay?: boolean;
		muted?: boolean;
		playing?: boolean;
	} = $props();

	let videoEl: HTMLVideoElement | undefined = $state();
	let visible = $state(false);
	let loaded = $state(false);
	let failed = $state(false);

	// Respect prefers-reduced-motion
	const reducedMotion = browser
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;

	const shouldAutoplay = $derived(autoplay && !reducedMotion && !!src);

	$effect(() => {
		if (!videoEl || !src || failed) return;

		// Reset state when src changes
		loaded = false;
		visible = false;
		playing = false;
		videoEl.src = src;
		videoEl.load();
	});

	$effect(() => {
		if (videoEl) {
			videoEl.muted = muted;
		}
	});

	function onCanPlay() {
		loaded = true;
		if (shouldAutoplay) {
			setTimeout(() => {
				if (!videoEl || failed) return;
				videoEl.play().then(() => {
					visible = true;
					playing = true;
				}).catch(() => {
					failed = true;
					playing = false;
				});
			}, delay);
		}
	}

	function onError() {
		failed = true;
		visible = false;
		playing = false;
	}

	function onEnded() {
		visible = false;
		playing = false;
	}

	export function play() {
		if (!videoEl || !loaded || failed) return;
		videoEl.play().then(() => {
			visible = true;
			playing = true;
		}).catch(() => {});
	}

	export function stop() {
		if (!videoEl) return;
		videoEl.pause();
		videoEl.currentTime = 0;
		visible = false;
		playing = false;
	}

	// IntersectionObserver — pause when off-screen
	let containerEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		if (!containerEl) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting && videoEl && playing) {
					videoEl.pause();
				} else if (entry.isIntersecting && videoEl && playing) {
					videoEl.play().catch(() => {});
				}
			},
			{ threshold: 0.3 }
		);
		observer.observe(containerEl);
		return () => observer.disconnect();
	});
</script>

<div
	bind:this={containerEl}
	class="trailer-player"
	class:trailer-visible={visible}
>
	{#if src && !failed}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			oncanplay={onCanPlay}
			onerror={onError}
			onended={onEnded}
			muted={muted}
			playsinline
			preload="auto"
			class="trailer-video"
		></video>
	{/if}
</div>

<style>
	.trailer-player {
		position: absolute;
		inset: 0;
		z-index: 1;
		overflow: hidden;
		opacity: 0;
		transition: opacity 1.2s ease;
		pointer-events: none;
	}
	.trailer-visible {
		opacity: 1;
	}
	.trailer-video {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/TrailerPlayer.svelte
git commit -m "feat: TrailerPlayer component with autoplay, mute, and IntersectionObserver"
```

---

### Task 6: HeroSection Component

**Files:**
- Create: `src/lib/components/HeroSection.svelte`

- [ ] **Step 1: Create the HeroSection component**

```svelte
<!-- src/lib/components/HeroSection.svelte -->
<script lang="ts">
	import TrailerPlayer from './TrailerPlayer.svelte';
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';

	let {
		backdrop,
		trailerUrl = null,
		mode = 'carousel',
		autoplay = true,
		delay = 5000,
		children
	}: {
		backdrop?: string | null;
		trailerUrl?: string | null;
		mode?: 'carousel' | 'detail' | 'browse';
		autoplay?: boolean;
		delay?: number;
		children: Snippet;
	} = $props();

	// Mute state persisted in localStorage
	let muted = $state(true);
	let playing = $state(false);

	if (browser) {
		const stored = localStorage.getItem('nexus:trailer-muted');
		if (stored !== null) muted = stored === 'true';
	}

	function toggleMute() {
		muted = !muted;
		if (browser) localStorage.setItem('nexus:trailer-muted', String(muted));
	}

	const heightClass: Record<string, string> = {
		carousel: 'hero--carousel',
		detail: 'hero--detail',
		browse: 'hero--browse'
	};

	// Poster fallback: blur the poster if no backdrop
	const hasPoster = $derived(!!backdrop);
</script>

<div class="hero {heightClass[mode]}">
	<!-- Backdrop image (always present, trailer fades over it) -->
	{#if backdrop}
		<div
			class="hero-backdrop"
			style="background-image: url('{backdrop}');"
		></div>
	{:else}
		<div class="hero-backdrop hero-backdrop--empty"></div>
	{/if}

	<!-- Trailer video layer -->
	<TrailerPlayer
		src={trailerUrl}
		{autoplay}
		{delay}
		bind:muted
		bind:playing
	/>

	<!-- Gradient overlays -->
	<div class="hero-gradient-left"></div>
	<div class="hero-gradient-bottom"></div>

	<!-- Trailer controls -->
	{#if playing || trailerUrl}
		<div class="hero-controls">
			{#if playing}
				<span class="hero-badge">
					{mode === 'browse' ? 'Preview' : 'Trailer'}
				</span>
			{/if}
			{#if playing}
				<button
					class="hero-mute-btn"
					onclick={toggleMute}
					aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
				>
					{#if muted}
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
					{:else}
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
					{/if}
				</button>
			{/if}
		</div>
	{/if}

	<!-- Trailer progress bar -->
	{#if playing}
		<div class="hero-progress">
			<div class="hero-progress-bar"></div>
		</div>
	{/if}

	<!-- Content slot -->
	<div class="hero-content">
		{@render children()}
	</div>
</div>

<style>
	.hero {
		position: relative;
		width: 100%;
		overflow: hidden;
	}
	.hero--carousel { height: clamp(300px, 50vh, 520px); }
	.hero--detail { height: clamp(320px, 55vh, 560px); }
	.hero--browse { height: clamp(200px, 30vh, 300px); }

	.hero-backdrop {
		position: absolute; inset: 0;
		background-size: cover;
		background-position: center top;
		z-index: 0;
	}
	.hero-backdrop--empty {
		background: linear-gradient(135deg, #1a1816 0%, #0d0b0a 100%);
	}

	.hero-gradient-left {
		position: absolute; inset: 0; z-index: 2;
		background: linear-gradient(to right, rgba(13,11,10,0.7) 0%, transparent 60%);
	}
	.hero-gradient-bottom {
		position: absolute; bottom: 0; left: 0; right: 0; z-index: 2;
		height: 65%;
		background: linear-gradient(to top, #0d0b0a 0%, rgba(13,11,10,0.85) 40%, transparent 100%);
	}

	.hero-controls {
		position: absolute; top: 16px; right: 16px; z-index: 10;
		display: flex; align-items: center; gap: 8px;
	}
	.hero-badge {
		font-size: 9px; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.08em;
		color: rgba(240,235,227,0.4);
		background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
		padding: 4px 10px; border-radius: 4px;
		border: 1px solid rgba(240,235,227,0.08);
	}
	.hero-mute-btn {
		width: 32px; height: 32px; border-radius: 50%;
		background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
		border: 1px solid rgba(240,235,227,0.15);
		color: rgba(240,235,227,0.7); cursor: pointer;
		display: flex; align-items: center; justify-content: center;
		transition: all 0.2s;
	}
	.hero-mute-btn:hover { background: rgba(0,0,0,0.7); color: #f0ebe3; }

	.hero-progress {
		position: absolute; bottom: 0; left: 0; right: 0;
		height: 2px; z-index: 10;
		background: rgba(240,235,227,0.08);
	}
	.hero-progress-bar {
		height: 100%;
		background: var(--color-accent, #d4a253);
		border-radius: 0 1px 1px 0;
		animation: progress 30s linear forwards;
	}
	@keyframes progress { from { width: 0; } to { width: 100%; } }

	.hero-content {
		position: relative;
		z-index: 5;
		height: 100%;
	}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/HeroSection.svelte
git commit -m "feat: unified HeroSection component with trailer backdrop and 3 modes"
```

---

## Chunk 3: Page Integration

### Task 7: Homepage — Replace HeroCarousel

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Read the current homepage**

Read `src/routes/+page.svelte` to understand how `HeroCarousel` is currently used — what props it receives, what data it gets, and the surrounding markup.

- [ ] **Step 2: Replace HeroCarousel with HeroSection**

Replace the `HeroCarousel` import and usage. The carousel behavior (auto-advance, dots, arrows) stays inside the content slot — `HeroSection` only provides the backdrop/trailer layer. Keep the existing carousel navigation logic but move the backdrop rendering responsibility to `HeroSection`.

Key changes:
- Import `HeroSection` instead of (or alongside) `HeroCarousel`
- Wrap the carousel content in `<HeroSection mode="carousel" backdrop={currentItem.backdrop} trailerUrl={currentItem.trailerUrl}>`
- The carousel's auto-advance, dots, and arrow controls render inside the slot
- When the active slide changes, the `backdrop` and `trailerUrl` props update reactively

The exact implementation depends on the current page structure — read it first, then make the minimal change.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: homepage hero uses HeroSection with trailer support"
```

---

### Task 8: Media Detail Page — Replace Inline Hero

**Files:**
- Modify: `src/routes/media/[type]/[id]/+page.server.ts`
- Modify: `src/routes/media/[type]/[id]/+page.svelte`

- [ ] **Step 1: Add trailerUrl to page server data**

Read `src/routes/media/[type]/[id]/+page.server.ts`. Add import at top:

```typescript
import { resolveTrailerUrl } from '$lib/server/trailers';
```

After the existing data fetching (before the return statement, around line 375), add:

```typescript
	// ── Trailer URL ─────────────────────────────────────────────────
	const trailerUrl = await resolveTrailerUrl(
		params.id,
		serviceId,
		item.title,
		item.year,
		(item.metadata?.trailerUrl as string) ?? null,
		userId
	);
```

Add `trailerUrl` to the return object.

- [ ] **Step 2: Replace inline hero with HeroSection**

Read `src/routes/media/[type]/[id]/+page.svelte` to find the hero section — the backdrop image div, gradient overlays, and play button overlay at the top of the template.

Replace the backdrop/gradient markup with:

```svelte
<HeroSection
	mode="detail"
	backdrop={item.backdrop || item.poster}
	trailerUrl={data.trailerUrl}
>
	<!-- existing hero content (poster, title, metadata, actions) goes here -->
</HeroSection>
```

Import `HeroSection` at the top of the script:

```typescript
import HeroSection from '$lib/components/HeroSection.svelte';
```

The existing hero content (poster, title, metadata, star rating, CTAs) becomes the slot content. Remove the old backdrop image div and gradient divs since `HeroSection` provides those.

Add a "Watch Trailer" button to the CTA row if `data.trailerUrl` exists. This button should call `toggleMute` or start the trailer.

- [ ] **Step 3: Commit**

```bash
git add src/routes/media/\[type\]/\[id\]/+page.server.ts src/routes/media/\[type\]/\[id\]/+page.svelte
git commit -m "feat: media detail page uses HeroSection with trailer playback"
```

---

### Task 9: Movies Page — Replace Inline Hero

**Files:**
- Modify: `src/routes/movies/+page.svelte`

- [ ] **Step 1: Read and replace the movies hero**

Read `src/routes/movies/+page.svelte`. The hero section (lines 44-124) builds an inline hero from `pickHero(trendingMovies)`.

Replace the inline hero markup (the backdrop div, gradients, metadata overlay) with:

```svelte
<HeroSection
	mode="browse"
	backdrop={hero.backdrop}
	trailerUrl={hero.metadata?.trailerUrl}
>
	<!-- existing hero content: poster, title, metadata, CTAs -->
	<!-- page title watermark on right side -->
</HeroSection>
```

Import `HeroSection`:

```typescript
import HeroSection from '$lib/components/HeroSection.svelte';
```

Keep the existing `pickHero()` logic and the content inside the hero — just swap the backdrop/gradient wrapper.

- [ ] **Step 2: Add card hover trailer trigger**

Add reactive state for card hover:

```typescript
let hoverItem: UnifiedMedia | null = $state(null);
let hoverTimeout: ReturnType<typeof setTimeout> | null = $state(null);
let hoverTrailerUrl: string | null = $state(null);

function onCardHover(item: UnifiedMedia) {
	if (hoverTimeout) clearTimeout(hoverTimeout);
	hoverTimeout = setTimeout(async () => {
		hoverItem = item;
		// Lazy-resolve trailer URL
		try {
			const res = await fetch(`/api/media/${item.sourceId}/trailer?service=${item.serviceId}`);
			if (res.ok) {
				const data = await res.json();
				hoverTrailerUrl = data.trailerUrl;
			}
		} catch { /* silent */ }
	}, 2500);
}

function onCardHoverEnd() {
	if (hoverTimeout) clearTimeout(hoverTimeout);
	hoverTimeout = null;
	// Delay revert so it doesn't flash
	setTimeout(() => {
		if (!hoverTimeout) {
			hoverItem = null;
			hoverTrailerUrl = null;
		}
	}, 500);
}
```

Update the `HeroSection` props to use hover data when active:

```svelte
<HeroSection
	mode="browse"
	backdrop={hoverItem?.backdrop ?? hero.backdrop}
	trailerUrl={hoverTrailerUrl ?? hero.metadata?.trailerUrl}
>
```

Pass `onCardHover` and `onCardHoverEnd` as `onmouseenter`/`onmouseleave` handlers on the media card grid items. Read how `MediaCard` is rendered on this page to determine the exact integration point.

- [ ] **Step 3: Commit**

```bash
git add src/routes/movies/+page.svelte
git commit -m "feat: movies page uses HeroSection with card hover trailer preview"
```

---

### Task 10: Shows Page — Replace Inline Hero

**Files:**
- Modify: `src/routes/shows/+page.svelte`

- [ ] **Step 1: Read and replace the shows hero**

Read `src/routes/shows/+page.svelte`. Follow the same pattern as the movies page (Task 9):

1. Import `HeroSection`
2. Replace inline hero markup with `<HeroSection mode="browse">`
3. Add card hover trailer trigger with the same reactive state pattern
4. Keep existing content as slot children

The implementation mirrors Task 9 exactly but for shows data (`data.trendingTV`).

- [ ] **Step 2: Commit**

```bash
git add src/routes/shows/+page.svelte
git commit -m "feat: shows page uses HeroSection with card hover trailer preview"
```

---

### Task 10b: Games Page — Add HeroSection

**Files:**
- Modify: `src/routes/games/+page.svelte`

- [ ] **Step 1: Read the games page**

Read `src/routes/games/+page.svelte`. The games page may not have an existing hero section — if not, add a `<HeroSection mode="browse">` at the top of the page with a featured game from the page data.

If the page already has a hero/featured section, follow the same pattern as movies/shows (Tasks 9-10): replace inline backdrop markup with `HeroSection`, add card hover trigger.

If the games page has no featured item or backdrop data available, skip adding a hero — the component should only appear when there's content to show.

- [ ] **Step 2: Commit**

```bash
git add src/routes/games/+page.svelte
git commit -m "feat: games page uses HeroSection with trailer support"
```

---

## Chunk 4: User Preference

### Task 11: Autoplay Trailer User Preference

**Files:**
- Modify: `src/routes/+layout.server.ts` (pass preference to client)
- Modify: `src/routes/+layout.svelte` (make preference available app-wide)

- [ ] **Step 1: Read how settings are currently loaded**

Read `src/routes/+layout.server.ts` and `src/routes/+layout.svelte` to understand the current data flow. Also read how `app_settings` table is accessed elsewhere in the codebase.

- [ ] **Step 2: Add autoplay preference to layout data**

In `src/routes/+layout.server.ts`, query the user's autoplay preference:

```typescript
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
```

In the load function, after getting the user:

```typescript
	let autoplayTrailers = true; // default
	if (locals.user) {
		const db = getDb();
		const setting = db
			.select({ value: schema.appSettings.value })
			.from(schema.appSettings)
			.where(eq(schema.appSettings.key, `user:${locals.user.id}:autoplayTrailers`))
			.get();
		if (setting) autoplayTrailers = setting.value === 'true';
	}
```

Add `autoplayTrailers` to the return object.

- [ ] **Step 3: Pass autoplay preference to HeroSection instances**

Each page that uses `HeroSection` should read this from the layout data and pass it as the `autoplay` prop. The exact mechanism depends on how layout data is accessed — typically via `$page.data.autoplayTrailers` or through the page's own `data` prop.

- [ ] **Step 4: Add toggle to Settings → Playback**

Read the settings/playback page to understand the existing pattern, then add a toggle for "Autoplay trailers" that writes to `app_settings` via an API call. Default is based on screen width: `window.innerWidth >= 768`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/+layout.server.ts src/routes/+layout.svelte
git commit -m "feat: autoplay trailers user preference with mobile-aware default"
```

---

### Task 12: Delete Old HeroCarousel

**Files:**
- Delete: `src/lib/components/HeroCarousel.svelte` (only after verifying no remaining imports)

- [ ] **Step 1: Search for remaining HeroCarousel imports**

```bash
grep -r "HeroCarousel" src/ --include="*.svelte" --include="*.ts"
```

If no results (all pages now use `HeroSection`), delete the old component.

- [ ] **Step 2: Delete and commit**

```bash
rm src/lib/components/HeroCarousel.svelte
git add -A
git commit -m "chore: remove old HeroCarousel component (replaced by HeroSection)"
```

---

## Execution Order

```
Data Layer:  1 → 2 → 3 → 4
UI Components:           5 → 6
Page Integration:              7 → 8 → 9 → 10
User Preference:                              11
Cleanup:                                       12
```

All tasks are sequential — each builds on the previous.

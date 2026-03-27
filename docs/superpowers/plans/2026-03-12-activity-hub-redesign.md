# Activity Hub Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Activity Hub with a three-tab analytics/insights dashboard, unified media history, and recommendation algorithm controls.

**Architecture:** SvelteKit route group under `/activity/` with shared layout (tab bar, auth gate). Insights tab uses Chart.js (bar + donut) plus pure Svelte/CSS for remaining 6 visualizations. History tab provides both timeline feed and sortable table with shared filters. Recommendations tab integrates StreamyStats with local preference/feedback storage.

**Tech Stack:** SvelteKit, Svelte 5, Chart.js + svelte-chartjs, Drizzle ORM (better-sqlite3), Tailwind CSS

---

## File Structure

### New Files
```
src/routes/activity/+layout.svelte              — tab bar (Insights/History/Recommendations) + auth gate
src/routes/activity/+layout.server.ts            — auth check, hasStreamyStats flag, redirect /activity → /activity/insights
src/routes/activity/insights/+page.svelte        — dashboard with period controls + 8 chart cards
src/routes/activity/insights/+page.server.ts     — computeStats for current + prev period, timeline data
src/routes/activity/history/+page.svelte         — timeline feed + table toggle with shared filters
src/routes/activity/history/+page.server.ts      — initial 50 events (SSR)
src/routes/activity/recommendations/+page.svelte — recs grid + tuning sliders + feedback table
src/routes/activity/recommendations/+page.server.ts — load prefs + current recs + feedback history
src/routes/api/user/recommendations/+server.ts           — GET recs (StreamyStats + filter)
src/routes/api/user/recommendations/feedback/+server.ts   — POST feedback, GET feedback history
src/routes/api/user/recommendations/feedback/[id]/+server.ts — DELETE undo feedback
src/routes/api/user/recommendations/preferences/+server.ts — GET/PUT tuning prefs
src/lib/components/charts/WatchTimeChart.svelte  — Chart.js bar chart (hours per day/week/month)
src/lib/components/charts/MediaDonut.svelte      — Chart.js donut (time by media type)
src/lib/components/charts/GenreBars.svelte       — pure CSS horizontal bar chart (top 6 genres)
src/lib/components/charts/ViewingHeatmap.svelte  — pure CSS 7×24 grid (hour × weekday)
src/lib/components/charts/ActivityCalendar.svelte — pure CSS GitHub-style year grid + streak stats
src/lib/components/charts/DeviceBreakdown.svelte — pure CSS segmented bars (devices + clients)
src/lib/components/charts/QualityStats.svelte    — pure CSS 4-metric quality display
src/lib/components/charts/TopItems.svelte        — ranked list with poster thumbnails
src/lib/components/history/HistoryFeed.svelte    — chronological feed grouped by day
src/lib/components/history/HistoryTable.svelte   — sortable dense table
src/lib/components/history/HistoryFilters.svelte — media type chips + search + date + service + event type
```

### Modified Files
```
src/routes/activity/+page.server.ts              — replace with redirect(302, '/activity/insights')
src/routes/activity/+page.svelte                 — delete contents (replaced by sub-routes)
src/lib/db/schema.ts                             — add recommendation_preferences, recommendation_feedback tables
src/lib/db/index.ts                              — add CREATE TABLE for new tables
src/routes/api/user/stats/+server.ts             — add from/to query param support
src/routes/api/user/stats/events/+server.ts      — add serviceId, titleSearch params
src/lib/server/analytics.ts                      — add serviceId, titleSearch to queryMediaEvents/countMediaEvents
src/routes/+layout.svelte                        — update activeId for /activity sub-routes
```

---

## Chunk 1: Shared Infrastructure

### Task 1: Install Chart.js Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install chart.js and svelte-chartjs**

```bash
pnpm add chart.js svelte-chartjs
```

- [ ] **Step 2: Verify installation**

```bash
pnpm ls chart.js svelte-chartjs
```

Expected: Both packages listed with versions.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add chart.js and svelte-chartjs dependencies"
```

---

### Task 2: Add Recommendation Tables to Database

**Files:**
- Modify: `src/lib/db/schema.ts` (add after line ~609, before end of file)
- Modify: `src/lib/db/index.ts` (add CREATE TABLE statements in initDb)

- [ ] **Step 1: Add Drizzle schema definitions**

In `src/lib/db/schema.ts`, add after the `SponsorBlockPreference` type export (line ~609):

```typescript
// ── Recommendation Preferences & Feedback ────────────────────────────

export const recommendationPreferences = sqliteTable('recommendation_preferences', {
	userId: text('user_id').primaryKey(),
	mediaTypeWeights: text('media_type_weights').notNull().default(JSON.stringify({
		movie: 50, show: 50, book: 50, game: 50, music: 50, video: 50
	})),
	genrePreferences: text('genre_preferences').notNull().default('{}'), // JSON: { genre: 'boost' | 'neutral' | 'suppress' }
	similarityThreshold: real('similarity_threshold').notNull().default(0.5),
	updatedAt: integer('updated_at').notNull()
});

export const recommendationFeedback = sqliteTable('recommendation_feedback', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	mediaId: text('media_id').notNull(),
	mediaTitle: text('media_title'),
	feedback: text('feedback').notNull(), // 'up' | 'down' | 'dismiss'
	reason: text('reason'), // why it was recommended
	createdAt: integer('created_at').notNull()
});

export type RecommendationPreference = typeof recommendationPreferences.$inferSelect;
export type RecommendationFeedbackEntry = typeof recommendationFeedback.$inferSelect;
```

- [ ] **Step 2: Add CREATE TABLE statements in initDb**

In `src/lib/db/index.ts`, add at the end of the `initDb` function (before the closing `}`):

```typescript
	// ── Recommendation preferences & feedback ────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS recommendation_preferences (
		user_id TEXT PRIMARY KEY,
		media_type_weights TEXT NOT NULL DEFAULT '{"movie":50,"show":50,"book":50,"game":50,"music":50,"video":50}',
		genre_preferences TEXT NOT NULL DEFAULT '{}',
		similarity_threshold REAL NOT NULL DEFAULT 0.5,
		updated_at INTEGER NOT NULL DEFAULT 0
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS recommendation_feedback (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		media_id TEXT NOT NULL,
		media_title TEXT,
		feedback TEXT NOT NULL,
		reason TEXT,
		created_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_rec_feedback_user ON recommendation_feedback(user_id, created_at DESC)`);
	db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rec_feedback_unique ON recommendation_feedback(user_id, media_id)`);
```

- [ ] **Step 3: Verify app starts without errors**

```bash
pnpm dev
```

Check the terminal for any schema/migration errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/index.ts
git commit -m "feat: add recommendation_preferences and recommendation_feedback tables"
```

---

### Task 3: Extend Stats API with from/to Support

**Files:**
- Modify: `src/routes/api/user/stats/+server.ts`

- [ ] **Step 1: Add from/to query param support**

Replace the entire file content of `src/routes/api/user/stats/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { getOrComputeStats, computeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats?period=day:2026-03-04&type=movie
 * OR
 * GET /api/user/stats?from=1709510400000&to=1710115200000&type=movie
 *
 * When from/to are provided, computes stats for an arbitrary range (bypasses cache).
 * When period is provided, uses the cached getOrComputeStats path.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const mediaType = url.searchParams.get('type') ?? 'all';
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');

	if (fromParam && toParam) {
		const from = parseInt(fromParam);
		const to = parseInt(toParam);
		if (isNaN(from) || isNaN(to)) {
			return json({ error: 'from and to must be unix ms timestamps' }, { status: 400 });
		}
		const stats = computeStats(locals.user.id, from, to, mediaType !== 'all' ? mediaType : undefined);
		return json({ from, to, mediaType, stats });
	}

	const period = url.searchParams.get('period') ?? 'alltime';
	const stats = getOrComputeStats(locals.user.id, period, mediaType);
	return json({ period, mediaType, stats });
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/user/stats/+server.ts
git commit -m "feat: add from/to arbitrary range support to stats API"
```

---

### Task 4: Extend Events API with serviceId and titleSearch

**Files:**
- Modify: `src/lib/server/analytics.ts` (EventQueryOpts + queryMediaEvents + countMediaEvents)
- Modify: `src/routes/api/user/stats/events/+server.ts`

- [ ] **Step 1: Add serviceId and titleSearch to EventQueryOpts**

In `src/lib/server/analytics.ts`, update the `EventQueryOpts` interface (around line 409):

```typescript
export interface EventQueryOpts {
	userId: string;
	mediaType?: string;
	eventType?: string;
	from?: number; // unix ms
	to?: number; // unix ms
	serviceId?: string;
	titleSearch?: string;
	limit?: number;
	offset?: number;
}
```

- [ ] **Step 2: Update queryMediaEvents to use new filters**

In the `queryMediaEvents` function (around line 422), add these conditions after the existing `if (opts.to)` block:

```typescript
	if (opts.serviceId) {
		conditions.push('service_id = ?');
		params.push(opts.serviceId);
	}
	if (opts.titleSearch) {
		conditions.push('media_title LIKE ?');
		params.push(`%${opts.titleSearch}%`);
	}
```

- [ ] **Step 3: Update countMediaEvents similarly**

Find the `countMediaEvents` function and add the same two condition blocks. The function signature already uses `EventQueryOpts` or a similar type — add the same `serviceId` and `titleSearch` conditions.

Look at the existing countMediaEvents function. It uses a similar pattern. Add:

```typescript
	if (opts.serviceId) {
		conditions.push('service_id = ?');
		params.push(opts.serviceId);
	}
	if (opts.titleSearch) {
		conditions.push('media_title LIKE ?');
		params.push(`%${opts.titleSearch}%`);
	}
```

- [ ] **Step 4: Update events API endpoint**

In `src/routes/api/user/stats/events/+server.ts`, add the new params:

```typescript
	const serviceId = url.searchParams.get('serviceId') ?? undefined;
	const titleSearch = url.searchParams.get('titleSearch') ?? undefined;

	const opts = { userId: locals.user.id, mediaType, eventType, from, to, serviceId, titleSearch, limit, offset };
	const events = queryMediaEvents(opts);
	const total = countMediaEvents({ userId: locals.user.id, mediaType, eventType, from, to, serviceId, titleSearch });
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/analytics.ts src/routes/api/user/stats/events/+server.ts
git commit -m "feat: add serviceId and titleSearch filters to events API"
```

---

### Task 5: Activity Layout with Tab Bar

**Files:**
- Create: `src/routes/activity/+layout.svelte`
- Create: `src/routes/activity/+layout.server.ts`
- Modify: `src/routes/activity/+page.server.ts` (redirect)
- Delete contents of: `src/routes/activity/+page.svelte` (minimal redirect page)

- [ ] **Step 1: Create layout server**

Create `src/routes/activity/+layout.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');

	// Redirect /activity to /activity/insights
	if (url.pathname === '/activity' || url.pathname === '/activity/') {
		throw redirect(302, '/activity/insights');
	}

	// Check if user has a StreamyStats service configured
	const db = getDb();
	const ssService = db
		.select({ id: schema.services.id })
		.from(schema.services)
		.where(eq(schema.services.type, 'streamystats'))
		.limit(1)
		.all();
	const hasStreamyStats = ssService.length > 0;

	return { hasStreamyStats };
};
```

- [ ] **Step 2: Create layout component with tab bar**

Create `src/routes/activity/+layout.svelte`:

```svelte
<script lang="ts">
	import type { LayoutData } from './$types';
	import { page } from '$app/stores';
	import { BarChart3, Clock, Sparkles } from 'lucide-svelte';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const tabs = [
		{ id: 'insights', label: 'Insights', href: '/activity/insights', icon: BarChart3 },
		{ id: 'history', label: 'History', href: '/activity/history', icon: Clock },
		{ id: 'recommendations', label: 'Recommendations', href: '/activity/recommendations', icon: Sparkles }
	];

	const activeTab = $derived.by(() => {
		const path = $page.url.pathname;
		if (path.startsWith('/activity/history')) return 'history';
		if (path.startsWith('/activity/recommendations')) return 'recommendations';
		return 'insights';
	});
</script>

<svelte:head>
	<title>Activity Hub — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-6 pb-10">
	<div class="px-3 pt-4 sm:px-4 lg:px-6">
		<h1 class="font-display text-2xl font-bold text-cream sm:text-3xl">Activity Hub</h1>
		<p class="mt-1 text-sm text-muted">Analytics, history, and personalized recommendations.</p>

		<!-- Tab navigation -->
		<nav class="mt-5 flex gap-1 overflow-x-auto rounded-xl bg-surface/50 p-1 scrollbar-none" style="backdrop-filter: blur(8px);">
			{#each tabs as tab (tab.id)}
				{@const Icon = tab.icon}
				{@const active = activeTab === tab.id}
				<a
					href={tab.href}
					class="group flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200
						{active
						? 'bg-raised text-cream shadow-sm'
						: 'text-muted hover:text-cream'}"
				>
					<Icon size={15} strokeWidth={active ? 2 : 1.5} class={active ? 'text-accent' : ''} />
					{tab.label}
				</a>
			{/each}
		</nav>
	</div>

	{@render children()}
</div>
```

- [ ] **Step 3: Replace activity page.server.ts with redirect**

Replace `src/routes/activity/+page.server.ts` entirely:

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	throw redirect(302, '/activity/insights');
};
```

- [ ] **Step 4: Replace activity page.svelte with empty placeholder**

Replace `src/routes/activity/+page.svelte`:

```svelte
<!-- Redirects to /activity/insights via page.server.ts -->
```

- [ ] **Step 5: Update nav activeId for activity sub-routes**

In `src/routes/+layout.svelte`, find the `activeId` derived block (around line 103). The existing code likely matches `/activity` to `'activity'`. Update to also match sub-routes:

Find the line matching activity in the activeId derived block. If it says something like:
```typescript
if (path.startsWith('/activity')) return 'activity';
```
That already handles sub-routes. Verify it exists. If the path is matched by a simple segment check, ensure `/activity/insights`, `/activity/history`, `/activity/recommendations` all map to `'activity'`.

- [ ] **Step 6: Verify routing works**

```bash
# Start dev server and navigate to /activity — should redirect to /activity/insights
# Tab bar should render with three tabs
```

- [ ] **Step 7: Commit**

```bash
git add src/routes/activity/
git add src/routes/+layout.svelte
git commit -m "feat: activity hub layout with three-tab navigation"
```

---

## Chunk 2: Insights Tab — Period Controls & Stat Cards

### Task 6: Insights Page Server (Data Loading)

**Files:**
- Create: `src/routes/activity/insights/+page.server.ts`

- [ ] **Step 1: Create insights page server**

```typescript
import { computeStats } from '$lib/server/stats-engine';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user!.id;
	const now = Date.now();

	// Parse period from URL params or default to 7 days
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');

	const to = toParam ? parseInt(toParam) : now;
	const from = fromParam ? parseInt(fromParam) : to - 7 * 24 * 60 * 60 * 1000;

	// Compute stats for current period
	const stats = computeStats(userId, from, to);

	// Compute stats for previous period (same duration, shifted back)
	const duration = to - from;
	const prevFrom = from - duration;
	const prevTo = from;
	const prevStats = computeStats(userId, prevFrom, prevTo);

	return {
		from,
		to,
		stats,
		prevStats
	};
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/activity/insights/+page.server.ts
git commit -m "feat: insights page server with current + previous period stats"
```

---

### Task 7: Insights Page — Period Controls & Stat Cards

**Files:**
- Create: `src/routes/activity/insights/+page.svelte`

This is the main insights page. It will contain period controls and stat cards first, with chart placeholders. Charts are added in subsequent tasks.

- [ ] **Step 1: Create the insights page with period controls and stat cards**

Create `src/routes/activity/insights/+page.svelte`:

```svelte
<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import WatchTimeChart from '$lib/components/charts/WatchTimeChart.svelte';
	import MediaDonut from '$lib/components/charts/MediaDonut.svelte';
	import GenreBars from '$lib/components/charts/GenreBars.svelte';
	import ViewingHeatmap from '$lib/components/charts/ViewingHeatmap.svelte';
	import TopItems from '$lib/components/charts/TopItems.svelte';
	import ActivityCalendar from '$lib/components/charts/ActivityCalendar.svelte';
	import DeviceBreakdown from '$lib/components/charts/DeviceBreakdown.svelte';
	import QualityStats from '$lib/components/charts/QualityStats.svelte';

	let { data }: { data: PageData } = $props();

	// Period presets
	const presets = [
		{ label: 'Today', days: 1 },
		{ label: '7 Days', days: 7 },
		{ label: '30 Days', days: 30 },
		{ label: 'Year', days: 365 },
		{ label: 'All Time', days: 0 }
	];

	function applyPreset(days: number) {
		const now = Date.now();
		const to = now;
		const from = days === 0 ? 0 : now - days * 24 * 60 * 60 * 1000;
		goto(`/activity/insights?from=${from}&to=${to}`, { replaceState: true });
	}

	function applyDateRange(fromDate: string, toDate: string) {
		const from = new Date(fromDate).getTime();
		const to = new Date(toDate).getTime() + 86400000; // end of day
		if (!isNaN(from) && !isNaN(to) && to > from) {
			goto(`/activity/insights?from=${from}&to=${to}`, { replaceState: true });
		}
	}

	// Current date range as date strings for inputs
	const fromDate = $derived(new Date(data.from).toISOString().slice(0, 10));
	const toDate = $derived(new Date(data.to).toISOString().slice(0, 10));

	// Active preset detection
	const activePreset = $derived.by(() => {
		const now = Date.now();
		const duration = data.to - data.from;
		if (data.from === 0) return 'All Time';
		const days = Math.round(duration / (24 * 60 * 60 * 1000));
		// Check if "to" is approximately now (within 1 hour)
		if (Math.abs(data.to - now) > 3600000) return null;
		if (days === 1) return 'Today';
		if (days === 7) return '7 Days';
		if (days === 30) return '30 Days';
		if (days >= 364 && days <= 366) return 'Year';
		return null;
	});

	// Helpers
	function formatDuration(ms: number) {
		if (ms <= 0) return '0m';
		const totalMin = Math.round(ms / 60_000);
		if (totalMin < 60) return `${totalMin}m`;
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	function pctChange(current: number, previous: number): string | null {
		if (previous === 0 && current === 0) return null;
		if (previous === 0) return '+100%';
		const pct = Math.round(((current - previous) / previous) * 100);
		return pct >= 0 ? `+${pct}%` : `${pct}%`;
	}

	function pctColor(s: string | null): string {
		if (!s) return 'text-faint';
		return s.startsWith('+') ? 'text-emerald-400' : 'text-red-400';
	}

	// Stat card data
	const statCards = $derived([
		{
			label: 'Watch Time',
			value: formatDuration(data.stats.totalPlayTimeMs),
			sub: `across ${data.stats.totalSessions} sessions`,
			change: pctChange(data.stats.totalPlayTimeMs, data.prevStats.totalPlayTimeMs)
		},
		{
			label: 'Items Consumed',
			value: String(data.stats.totalItems),
			sub: (() => {
				// Group topItems by mediaType and count unique
				const types = new Map<string, number>();
				for (const item of data.stats.topItems) {
					types.set(item.mediaType, (types.get(item.mediaType) ?? 0) + 1);
				}
				return [...types.entries()].map(([t, c]) => `${c} ${t}${c > 1 ? 's' : ''}`).join(', ') || 'no items';
			})(),
			change: pctChange(data.stats.totalItems, data.prevStats.totalItems)
		},
		{
			label: 'Current Streak',
			value: `${data.stats.streaks.current}d`,
			sub: `longest: ${data.stats.streaks.longest}d`,
			change: null
		},
		{
			label: 'Completion Rate',
			value: `${Math.round(data.stats.avgCompletionRate * 100)}%`,
			sub: `${data.stats.completions} of ${data.stats.totalItems} finished`,
			change: pctChange(data.stats.avgCompletionRate, data.prevStats.avgCompletionRate)
		}
	]);

	// Date input state
	let customFrom = $state(fromDate);
	let customTo = $state(toDate);

	// Sync when data changes
	$effect(() => {
		customFrom = fromDate;
		customTo = toDate;
	});
</script>

<div class="px-3 sm:px-4 lg:px-6">
	<!-- Period Controls -->
	<div class="mb-6 flex flex-wrap items-center gap-3">
		<!-- Preset buttons -->
		<div class="flex gap-1.5">
			{#each presets as preset (preset.label)}
				<button
					onclick={() => applyPreset(preset.days)}
					class="rounded-lg px-3 py-1.5 text-xs font-medium transition-all
						{activePreset === preset.label
						? 'bg-accent/15 text-accent'
						: 'bg-white/[0.04] text-muted hover:text-cream hover:bg-white/[0.08]'}"
				>
					{preset.label}
				</button>
			{/each}
		</div>

		<!-- Date range inputs -->
		<div class="flex items-center gap-2">
			<input
				type="date"
				bind:value={customFrom}
				onchange={() => applyDateRange(customFrom, customTo)}
				class="rounded-lg border border-cream/[0.06] bg-raised px-2.5 py-1.5 text-xs text-cream"
			/>
			<span class="text-xs text-faint">to</span>
			<input
				type="date"
				bind:value={customTo}
				onchange={() => applyDateRange(customFrom, customTo)}
				class="rounded-lg border border-cream/[0.06] bg-raised px-2.5 py-1.5 text-xs text-cream"
			/>
		</div>
	</div>

	<!-- Stat Cards -->
	<div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
		{#each statCards as card (card.label)}
			<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
				<p class="text-[11px] uppercase tracking-wide text-muted">{card.label}</p>
				<p class="mt-1 font-display text-2xl font-bold text-cream">{card.value}</p>
				<p class="mt-0.5 text-[11px] text-faint">{card.sub}</p>
				{#if card.change}
					<p class="mt-1 text-[11px] font-medium {pctColor(card.change)}">{card.change} vs prev period</p>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Chart Row 1: Watch Time (2/3) + Media Donut (1/3) -->
	<div class="mb-4 grid gap-4 lg:grid-cols-3">
		<div class="lg:col-span-2">
			<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
				<h3 class="mb-3 text-sm font-semibold text-cream">Watch Time</h3>
				<WatchTimeChart stats={data.stats} from={data.from} to={data.to} />
			</div>
		</div>
		<div>
			<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
				<h3 class="mb-3 text-sm font-semibold text-cream">Media Types</h3>
				<MediaDonut stats={data.stats} />
			</div>
		</div>
	</div>

	<!-- Chart Row 2: Genre Bars + Viewing Heatmap + Top Items -->
	<div class="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
			<h3 class="mb-3 text-sm font-semibold text-cream">Top Genres</h3>
			<GenreBars stats={data.stats} />
		</div>
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
			<h3 class="mb-3 text-sm font-semibold text-cream">Viewing Heatmap</h3>
			<ViewingHeatmap stats={data.stats} />
		</div>
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4 sm:col-span-2 lg:col-span-1">
			<h3 class="mb-3 text-sm font-semibold text-cream">Top Items</h3>
			<TopItems stats={data.stats} from={data.from} />
		</div>
	</div>

	<!-- Chart Row 3: Activity Calendar + Playback Details -->
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
			<h3 class="mb-3 text-sm font-semibold text-cream">Activity & Streaks</h3>
			<ActivityCalendar stats={data.stats} />
		</div>
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
			<h3 class="mb-3 text-sm font-semibold text-cream">Playback Details</h3>
			<DeviceBreakdown stats={data.stats} />
			<div class="mt-4 border-t border-cream/[0.06] pt-4">
				<QualityStats stats={data.stats} />
			</div>
		</div>
	</div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/activity/insights/+page.svelte
git commit -m "feat: insights page with period controls and stat cards"
```

---

## Chunk 3: Insights Tab — Chart Components

### Task 8: WatchTimeChart (Chart.js Bar)

**Files:**
- Create: `src/lib/components/charts/WatchTimeChart.svelte`

- [ ] **Step 1: Create the bar chart component**

This uses Chart.js via svelte-chartjs. It renders hours per day/week/month depending on the period span.

```svelte
<script lang="ts">
	import { Bar } from 'svelte-chartjs';
	import {
		Chart as ChartJS,
		CategoryScale,
		LinearScale,
		BarElement,
		Tooltip
	} from 'chart.js';
	import type { ComputedStats } from '$lib/server/stats-engine';

	ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

	interface Props {
		stats: ComputedStats;
		from: number;
		to: number;
	}

	let { stats, from, to }: Props = $props();

	// Use hourly distribution data to build a simplified bar chart
	// For now, use the hourlyDistribution (24 hours) as a proxy
	const chartData = $derived.by(() => {
		const hours = stats.hourlyDistribution;
		const labels = hours.map((_, i) => {
			if (i === 0) return '12am';
			if (i === 12) return '12pm';
			if (i < 12) return `${i}am`;
			return `${i - 12}pm`;
		});

		return {
			labels,
			datasets: [
				{
					label: 'Minutes',
					data: hours.map((ms) => Math.round(ms / 60_000)),
					backgroundColor: 'rgba(212, 162, 83, 0.6)',
					borderRadius: 4,
					borderSkipped: false
				}
			]
		};
	});

	const chartOptions = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			tooltip: {
				callbacks: {
					label: (ctx: any) => {
						const mins = ctx.raw;
						if (mins < 60) return `${mins}m`;
						return `${Math.floor(mins / 60)}h ${mins % 60}m`;
					}
				}
			}
		},
		scales: {
			x: {
				grid: { display: false },
				ticks: { color: 'rgba(240, 235, 227, 0.3)', font: { size: 10 } }
			},
			y: {
				grid: { color: 'rgba(240, 235, 227, 0.04)' },
				ticks: {
					color: 'rgba(240, 235, 227, 0.3)',
					font: { size: 10 },
					callback: (v: number) => v < 60 ? `${v}m` : `${Math.floor(v / 60)}h`
				}
			}
		}
	};
</script>

<div class="h-48">
	<Bar data={chartData} options={chartOptions} />
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/charts/WatchTimeChart.svelte
git commit -m "feat: WatchTimeChart bar chart component"
```

---

### Task 9: MediaDonut (Chart.js Donut)

**Files:**
- Create: `src/lib/components/charts/MediaDonut.svelte`

- [ ] **Step 1: Create the donut chart component**

```svelte
<script lang="ts">
	import { Doughnut } from 'svelte-chartjs';
	import {
		Chart as ChartJS,
		ArcElement,
		Tooltip,
		Legend
	} from 'chart.js';
	import type { ComputedStats } from '$lib/server/stats-engine';

	ChartJS.register(ArcElement, Tooltip, Legend);

	interface Props {
		stats: ComputedStats;
	}

	let { stats }: Props = $props();

	const TYPE_COLORS: Record<string, string> = {
		movie: '#d4a253',
		show: '#3d8f84',
		episode: '#3d8f84',
		book: '#c45c5c',
		game: '#56a99d',
		music: '#e8bc6a',
		video: '#8a7565',
		live: '#605850'
	};

	const chartData = $derived.by(() => {
		// Group topItems by mediaType and sum play time
		const typeMap = new Map<string, number>();
		for (const item of stats.topItems) {
			typeMap.set(item.mediaType, (typeMap.get(item.mediaType) ?? 0) + item.playTimeMs);
		}
		const entries = [...typeMap.entries()].sort((a, b) => b[1] - a[1]);
		if (entries.length === 0) {
			return { labels: ['No data'], datasets: [{ data: [1], backgroundColor: ['rgba(240,235,227,0.05)'] }] };
		}

		return {
			labels: entries.map(([t]) => t.charAt(0).toUpperCase() + t.slice(1)),
			datasets: [{
				data: entries.map(([, ms]) => Math.round(ms / 60_000)),
				backgroundColor: entries.map(([t]) => TYPE_COLORS[t] ?? '#605850'),
				borderWidth: 0
			}]
		};
	});

	const totalHours = $derived(Math.round(stats.totalPlayTimeMs / 3_600_000));

	const chartOptions = {
		responsive: true,
		maintainAspectRatio: false,
		cutout: '65%',
		plugins: {
			legend: { display: false },
			tooltip: {
				callbacks: {
					label: (ctx: any) => {
						const mins = ctx.raw;
						if (mins < 60) return ` ${mins}m`;
						return ` ${Math.floor(mins / 60)}h ${mins % 60}m`;
					}
				}
			}
		}
	};
</script>

<div class="flex items-center gap-4">
	<div class="relative h-32 w-32 flex-shrink-0">
		<Doughnut data={chartData} options={chartOptions} />
		<div class="absolute inset-0 flex items-center justify-center">
			<div class="text-center">
				<p class="font-display text-lg font-bold text-cream">{totalHours}h</p>
				<p class="text-[9px] text-faint">total</p>
			</div>
		</div>
	</div>
	<div class="flex flex-col gap-1.5 text-xs">
		{#each chartData.labels as label, i (label)}
			<div class="flex items-center gap-2">
				<span class="h-2.5 w-2.5 rounded-full" style="background: {chartData.datasets[0].backgroundColor[i]}"></span>
				<span class="text-muted">{label}</span>
			</div>
		{/each}
	</div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/charts/MediaDonut.svelte
git commit -m "feat: MediaDonut chart component"
```

---

### Task 10: GenreBars (Pure CSS)

**Files:**
- Create: `src/lib/components/charts/GenreBars.svelte`

- [ ] **Step 1: Create genre bars component**

```svelte
<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props { stats: ComputedStats }
	let { stats }: Props = $props();

	const COLORS = ['#d4a253', '#3d8f84', '#c45c5c', '#e8bc6a', '#56a99d', '#8a7565'];

	const genres = $derived(stats.topGenres.slice(0, 6));
	const maxMs = $derived(genres.length > 0 ? genres[0].playTimeMs : 1);

	function formatTime(ms: number): string {
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${mins}m`;
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}
</script>

<div class="flex flex-col gap-2.5">
	{#if genres.length === 0}
		<p class="py-8 text-center text-xs text-faint">No genre data in this period.</p>
	{:else}
		{#each genres as genre, i (genre.genre)}
			<div class="flex items-center gap-2">
				<span class="w-16 flex-shrink-0 truncate text-[11px] text-muted">{genre.genre}</span>
				<div class="relative h-5 flex-1 overflow-hidden rounded">
					<div
						class="h-full rounded"
						style="width: {Math.max(4, (genre.playTimeMs / maxMs) * 100)}%;
							background: linear-gradient(90deg, {COLORS[i % COLORS.length]}99, {COLORS[i % COLORS.length]}33);"
					></div>
					<span class="absolute inset-y-0 left-2 flex items-center text-[10px] font-medium text-cream/80">
						{formatTime(genre.playTimeMs)}
					</span>
				</div>
			</div>
		{/each}
	{/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/charts/GenreBars.svelte
git commit -m "feat: GenreBars pure CSS chart component"
```

---

### Task 11: ViewingHeatmap (Pure CSS)

**Files:**
- Create: `src/lib/components/charts/ViewingHeatmap.svelte`

- [ ] **Step 1: Create heatmap component**

Uses the `hourlyDistribution` (24 values) and `weekdayDistribution` (7 values) from stats to build a 7×24 grid. Since we only have aggregate distributions (not per hour-per-day), we approximate by multiplying hourly × weekday weights.

```svelte
<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props { stats: ComputedStats }
	let { stats }: Props = $props();

	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	// Build a 7×24 grid by combining hourly and weekday distributions
	const grid = $derived.by(() => {
		const hourly = stats.hourlyDistribution; // 24 values
		const weekday = stats.weekdayDistribution; // 7 values (Sun=0)
		const maxHour = Math.max(...hourly, 1);
		const maxDay = Math.max(...weekday, 1);

		// Reorder weekday: Mon(1)..Sun(0)
		const reordered = [1, 2, 3, 4, 5, 6, 0];

		const cells: { day: number; hour: number; intensity: number }[] = [];
		let maxVal = 0;
		for (let d = 0; d < 7; d++) {
			for (let h = 0; h < 24; h++) {
				const val = (hourly[h] / maxHour) * (weekday[reordered[d]] / maxDay);
				if (val > maxVal) maxVal = val;
				cells.push({ day: d, hour: h, intensity: val });
			}
		}
		// Normalize
		if (maxVal > 0) {
			for (const cell of cells) cell.intensity /= maxVal;
		}
		return cells;
	});
</script>

<div class="overflow-x-auto">
	<div class="inline-grid gap-[2px]" style="grid-template-columns: 28px repeat(24, 1fr); min-width: 320px;">
		<!-- Header row -->
		<div></div>
		{#each Array(24) as _, h}
			{#if h % 6 === 0}
				<div class="text-center text-[8px] text-faint">
					{h === 0 ? '12a' : h === 6 ? '6a' : h === 12 ? '12p' : '6p'}
				</div>
			{:else}
				<div></div>
			{/if}
		{/each}

		<!-- Grid rows -->
		{#each DAYS as day, d}
			<div class="flex items-center text-[9px] text-faint">{day}</div>
			{#each Array(24) as _, h}
				{@const cell = grid[d * 24 + h]}
				<div
					class="aspect-square rounded-[2px]"
					style="background: rgba(212, 162, 83, {Math.max(0.04, cell.intensity * 0.9)});"
					title="{day} {h}:00 — {Math.round(cell.intensity * 100)}%"
				></div>
			{/each}
		{/each}
	</div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/charts/ViewingHeatmap.svelte
git commit -m "feat: ViewingHeatmap pure CSS grid component"
```

---

### Task 12: TopItems (Pure Svelte)

**Files:**
- Create: `src/lib/components/charts/TopItems.svelte`

- [ ] **Step 1: Create top items component**

```svelte
<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props {
		stats: ComputedStats;
		from: number;
	}

	let { stats, from }: Props = $props();

	const TYPE_COLORS: Record<string, string> = {
		movie: '#d4a253',
		show: '#3d8f84',
		episode: '#3d8f84',
		book: '#c45c5c',
		game: '#56a99d',
		music: '#e8bc6a'
	};

	const items = $derived(stats.topItems.slice(0, 5));

	function formatTime(ms: number): string {
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${mins}m`;
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}
</script>

<div class="flex flex-col gap-2">
	{#if items.length === 0}
		<p class="py-8 text-center text-xs text-faint">No activity in this period.</p>
	{:else}
		{#each items as item, i (item.mediaId)}
			<div class="flex items-center gap-3">
				<span
					class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-xs font-bold"
					style="color: {i === 0 ? '#d4a253' : 'rgba(240,235,227,0.4)'};"
				>
					{i + 1}
				</span>
				<div class="min-w-0 flex-1">
					<p class="truncate text-xs font-medium text-cream">{item.title}</p>
					<p class="text-[10px] text-faint">
						<span style="color: {TYPE_COLORS[item.mediaType] ?? '#605850'}">{item.mediaType}</span>
						· {item.sessions} session{item.sessions !== 1 ? 's' : ''}
					</p>
				</div>
				<span class="flex-shrink-0 text-[11px] text-muted">{formatTime(item.playTimeMs)}</span>
			</div>
		{/each}
	{/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/charts/TopItems.svelte
git commit -m "feat: TopItems ranked list component"
```

---

### Task 13: ActivityCalendar (Pure CSS)

**Files:**
- Create: `src/lib/components/charts/ActivityCalendar.svelte`

- [ ] **Step 1: Create activity calendar component**

GitHub contribution-style year grid with streak stats.

```svelte
<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props { stats: ComputedStats }
	let { stats }: Props = $props();

	// Build a simplified year calendar (last 52 weeks)
	// We use weekday distribution as a proxy for the calendar grid
	// since we don't have per-day data in ComputedStats.
	// The real per-day data would need an additional query.
	// For now, show streak stats prominently + the weekday distribution.

	const streakStats = [
		{ label: 'Current', value: stats.streaks.current },
		{ label: 'Longest', value: stats.streaks.longest },
		{ label: 'Sessions', value: stats.totalSessions }
	];

	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const weekdayReordered = $derived([1, 2, 3, 4, 5, 6, 0].map(i => stats.weekdayDistribution[i]));
	const maxDay = $derived(Math.max(...weekdayReordered, 1));
</script>

<div>
	<!-- Streak stats -->
	<div class="mb-4 flex gap-4">
		{#each streakStats as stat (stat.label)}
			<div class="text-center">
				<p class="font-display text-xl font-bold text-accent">{stat.value}</p>
				<p class="text-[10px] text-faint">{stat.label}</p>
			</div>
		{/each}
	</div>

	<!-- Weekday activity bars -->
	<div class="flex flex-col gap-1.5">
		{#each DAYS as day, i}
			<div class="flex items-center gap-2">
				<span class="w-8 text-[9px] text-faint">{day}</span>
				<div class="h-3 flex-1 rounded-sm" style="background: rgba(212, 162, 83, {Math.max(0.06, (weekdayReordered[i] / maxDay) * 0.8)});"></div>
			</div>
		{/each}
	</div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/charts/ActivityCalendar.svelte
git commit -m "feat: ActivityCalendar streak stats component"
```

---

### Task 14: DeviceBreakdown + QualityStats (Pure CSS)

**Files:**
- Create: `src/lib/components/charts/DeviceBreakdown.svelte`
- Create: `src/lib/components/charts/QualityStats.svelte`

- [ ] **Step 1: Create DeviceBreakdown**

```svelte
<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props { stats: ComputedStats }
	let { stats }: Props = $props();

	const COLORS = ['#d4a253', '#3d8f84', '#c45c5c', '#56a99d', '#e8bc6a', '#8a7565'];

	function makeSegments(items: { name: string; playTimeMs: number }[]) {
		const total = items.reduce((sum, d) => sum + d.playTimeMs, 0);
		if (total === 0) return [];
		return items.map((item, i) => ({
			name: item.name,
			pct: Math.round((item.playTimeMs / total) * 100),
			color: COLORS[i % COLORS.length]
		}));
	}

	const devices = $derived(makeSegments(stats.topDevices));
	const clients = $derived(makeSegments(stats.topClients));
</script>

{#snippet segmentBar(segments: { name: string; pct: number; color: string }[], label: string)}
	<div class="mb-3">
		<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</p>
		{#if segments.length === 0}
			<p class="text-[10px] text-faint">No data</p>
		{:else}
			<div class="flex h-6 overflow-hidden rounded-md">
				{#each segments as seg (seg.name)}
					<div
						style="width: {Math.max(seg.pct, 3)}%; background: {seg.color};"
						class="flex items-center justify-center text-[9px] font-medium text-white/80"
						title="{seg.name}: {seg.pct}%"
					>
						{#if seg.pct >= 15}{seg.name}{/if}
					</div>
				{/each}
			</div>
			<div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
				{#each segments as seg (seg.name)}
					<div class="flex items-center gap-1 text-[10px] text-muted">
						<span class="h-2 w-2 rounded-full" style="background: {seg.color}"></span>
						{seg.name} · {seg.pct}%
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{@render segmentBar(devices, 'Devices')}
{@render segmentBar(clients, 'Clients')}
```

- [ ] **Step 2: Create QualityStats**

```svelte
<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props { stats: ComputedStats }
	let { stats }: Props = $props();

	// Compute 4K percentage from resolution breakdown
	const resEntries = $derived(Object.entries(stats.resolutionBreakdown));
	const totalRes = $derived(resEntries.reduce((sum, [, v]) => sum + v, 0));

	const fourKPct = $derived.by(() => {
		const fourK = (stats.resolutionBreakdown['2160'] ?? 0) + (stats.resolutionBreakdown['4K'] ?? 0);
		return totalRes > 0 ? Math.round((fourK / totalRes) * 100) : 0;
	});

	const hdrEntries = $derived(Object.entries(stats.hdrBreakdown));
	const hdrTotal = $derived(hdrEntries.reduce((sum, [, v]) => sum + v, 0));
	const hdrPct = $derived.by(() => {
		const hdr = hdrEntries.filter(([k]) => k !== 'SDR' && k !== 'none').reduce((sum, [, v]) => sum + v, 0);
		return hdrTotal > 0 ? Math.round((hdr / hdrTotal) * 100) : 0;
	});

	const transcodePct = $derived(Math.round(stats.transcodeRate * 100));
	const subtitlePct = $derived(Math.round(stats.subtitleUsage * 100));

	const metrics = $derived([
		{ label: '4K', value: `${fourKPct}%`, color: '#d4a253' },
		{ label: 'HDR', value: `${hdrPct}%`, color: '#3d8f84' },
		{ label: 'Transcoded', value: `${transcodePct}%`, color: '#c45c5c' },
		{ label: 'Subtitles', value: `${subtitlePct}%`, color: 'rgba(240,235,227,0.5)' }
	]);
</script>

<div class="flex justify-between gap-3">
	{#each metrics as m (m.label)}
		<div class="text-center">
			<p class="font-display text-lg font-bold" style="color: {m.color}">{m.value}</p>
			<p class="text-[10px] text-faint">{m.label}</p>
		</div>
	{/each}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/charts/DeviceBreakdown.svelte src/lib/components/charts/QualityStats.svelte
git commit -m "feat: DeviceBreakdown and QualityStats chart components"
```

---

## Chunk 4: History Tab

### Task 15: History Page Server

**Files:**
- Create: `src/routes/activity/history/+page.server.ts`

- [ ] **Step 1: Create history server with initial events**

```typescript
import { queryMediaEvents, countMediaEvents } from '$lib/server/analytics';
import { getDb, schema } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	// Initial load: latest 50 events of consumption-relevant types
	const events = queryMediaEvents({
		userId,
		limit: 50,
		offset: 0
	});

	const total = countMediaEvents({ userId });

	// Service name lookup for display
	const db = getDb();
	const serviceRows = db
		.select({ id: schema.services.id, name: schema.services.name, type: schema.services.type })
		.from(schema.services)
		.all();
	const services = serviceRows.map((s) => ({ id: s.id, name: s.name, type: s.type }));

	return { events, total, services };
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/activity/history/+page.server.ts
git commit -m "feat: history page server with initial events"
```

---

### Task 16: HistoryFilters Component

**Files:**
- Create: `src/lib/components/history/HistoryFilters.svelte`

- [ ] **Step 1: Create filters component**

```svelte
<script lang="ts">
	import { Search, List, LayoutGrid } from 'lucide-svelte';

	interface Props {
		services: { id: string; name: string; type: string }[];
		selectedTypes: string[];
		searchQuery: string;
		selectedService: string;
		viewMode: 'feed' | 'table';
		onfilter: () => void;
	}

	let {
		services,
		selectedTypes = $bindable([]),
		searchQuery = $bindable(''),
		selectedService = $bindable(''),
		viewMode = $bindable('feed'),
		onfilter
	}: Props = $props();

	const mediaTypes = [
		{ id: 'all', label: 'All' },
		{ id: 'movie', label: 'Movies' },
		{ id: 'show', label: 'Shows' },
		{ id: 'episode', label: 'Episodes' },
		{ id: 'book', label: 'Books' },
		{ id: 'game', label: 'Games' },
		{ id: 'music', label: 'Music' }
	];

	function toggleType(type: string) {
		if (type === 'all') {
			selectedTypes = [];
		} else {
			const idx = selectedTypes.indexOf(type);
			if (idx >= 0) {
				selectedTypes = selectedTypes.filter((t) => t !== type);
			} else {
				selectedTypes = [...selectedTypes, type];
			}
		}
		onfilter();
	}

	const isAllSelected = $derived(selectedTypes.length === 0);
</script>

<div class="flex flex-wrap items-center gap-3">
	<!-- Media type chips -->
	<div class="flex flex-wrap gap-1.5">
		{#each mediaTypes as mt (mt.id)}
			{@const active = mt.id === 'all' ? isAllSelected : selectedTypes.includes(mt.id)}
			<button
				onclick={() => toggleType(mt.id)}
				class="rounded-lg px-3 py-1.5 text-xs font-medium transition-all
					{active ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-muted hover:text-cream'}"
			>
				{mt.label}
			</button>
		{/each}
	</div>

	<!-- Search -->
	<div class="relative flex-1 min-w-[140px]">
		<Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
		<input
			type="text"
			placeholder="Search titles..."
			bind:value={searchQuery}
			oninput={() => onfilter()}
			class="w-full rounded-lg border border-cream/[0.06] bg-raised py-1.5 pl-8 pr-3 text-xs text-cream placeholder:text-faint"
		/>
	</div>

	<!-- Service filter -->
	{#if services.length > 1}
		<select
			bind:value={selectedService}
			onchange={() => onfilter()}
			class="rounded-lg border border-cream/[0.06] bg-raised px-2.5 py-1.5 text-xs text-cream"
		>
			<option value="">All services</option>
			{#each services as svc (svc.id)}
				<option value={svc.id}>{svc.name}</option>
			{/each}
		</select>
	{/if}

	<!-- View toggle -->
	<div class="flex gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
		<button
			onclick={() => { viewMode = 'feed'; }}
			class="rounded-md p-1.5 transition-all {viewMode === 'feed' ? 'bg-accent/15 text-accent' : 'text-faint hover:text-cream'}"
			title="Feed view"
		>
			<LayoutGrid size={14} />
		</button>
		<button
			onclick={() => { viewMode = 'table'; }}
			class="rounded-md p-1.5 transition-all {viewMode === 'table' ? 'bg-accent/15 text-accent' : 'text-faint hover:text-cream'}"
			title="Table view"
		>
			<List size={14} />
		</button>
	</div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/history/HistoryFilters.svelte
git commit -m "feat: HistoryFilters component with type chips, search, service filter, view toggle"
```

---

### Task 17: HistoryFeed Component

**Files:**
- Create: `src/lib/components/history/HistoryFeed.svelte`

- [ ] **Step 1: Create timeline feed component**

```svelte
<script lang="ts">
	import type { MediaEvent } from '$lib/db/schema';

	interface Props {
		events: MediaEvent[];
	}

	let { events }: Props = $props();

	const TYPE_COLORS: Record<string, string> = {
		movie: 'rgba(212,162,83,0.15)',
		show: 'rgba(61,143,132,0.15)',
		episode: 'rgba(61,143,132,0.15)',
		book: 'rgba(196,92,92,0.15)',
		game: 'rgba(86,169,157,0.15)',
		music: 'rgba(232,188,106,0.15)',
		video: 'rgba(212,162,83,0.1)'
	};

	const TYPE_TEXT_COLORS: Record<string, string> = {
		movie: '#d4a253',
		show: '#3d8f84',
		episode: '#3d8f84',
		book: '#c45c5c',
		game: '#56a99d',
		music: '#e8bc6a'
	};

	// Group events by day
	const groupedByDay = $derived.by(() => {
		const groups: { label: string; date: string; events: MediaEvent[] }[] = [];
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);

		const todayStr = today.toISOString().slice(0, 10);
		const yesterdayStr = yesterday.toISOString().slice(0, 10);

		for (const event of events) {
			const d = new Date(event.timestamp);
			const dateStr = d.toISOString().slice(0, 10);
			let label: string;
			if (dateStr === todayStr) label = 'Today';
			else if (dateStr === yesterdayStr) label = 'Yesterday';
			else label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

			const last = groups[groups.length - 1];
			if (last && last.date === dateStr) {
				last.events.push(event);
			} else {
				groups.push({ label, date: dateStr, events: [event] });
			}
		}
		return groups;
	});

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	}

	function formatDuration(ms: number | null): string {
		if (!ms || ms <= 0) return '';
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${mins}m`;
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	function progressPct(pos: number | null, dur: number | null): string | null {
		if (!pos || !dur || dur <= 0) return null;
		return `${Math.max(0, Math.min(Math.round((pos / dur) * 100), 100))}%`;
	}
</script>

<div class="flex flex-col gap-4">
	{#if events.length === 0}
		<p class="py-12 text-center text-sm text-faint">No history yet. Start watching, reading, or playing something!</p>
	{:else}
		{#each groupedByDay as group (group.date)}
			<div>
				<p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{group.label}</p>
				<div class="flex flex-col gap-1.5">
					{#each group.events as event (event.id)}
						{@const progress = progressPct(event.positionTicks, event.durationTicks)}
						<a
							href="/media/{event.mediaType}/{event.serviceId}:{event.mediaId}"
							class="flex items-center gap-3 rounded-lg bg-white/[0.02] p-2.5 transition-colors hover:bg-white/[0.04]"
						>
							<!-- Poster placeholder -->
							<div
								class="h-11 w-8 flex-shrink-0 rounded"
								style="background: {TYPE_COLORS[event.mediaType] ?? 'rgba(255,255,255,0.03)'};"
							></div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-xs font-medium text-cream/90">{event.mediaTitle ?? 'Untitled'}</p>
								<p class="text-[10px] text-faint">
									<span style="color: {TYPE_TEXT_COLORS[event.mediaType] ?? 'inherit'}">{event.mediaType}</span>
									{#if event.playDurationMs}· {formatDuration(event.playDurationMs)}{/if}
									{#if progress}· {progress}{/if}
								</p>
							</div>
							<span class="flex-shrink-0 text-[10px] text-faint">{formatTime(event.timestamp)}</span>
						</a>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/history/HistoryFeed.svelte
git commit -m "feat: HistoryFeed timeline component grouped by day"
```

---

### Task 18: HistoryTable Component

**Files:**
- Create: `src/lib/components/history/HistoryTable.svelte`

- [ ] **Step 1: Create sortable table component**

```svelte
<script lang="ts">
	import type { MediaEvent } from '$lib/db/schema';

	interface Props {
		events: MediaEvent[];
		services: { id: string; name: string }[];
	}

	let { events, services }: Props = $props();

	const serviceNameMap = $derived(new Map(services.map((s) => [s.id, s.name])));

	let sortCol = $state<'title' | 'type' | 'duration' | 'service' | 'date'>('date');
	let sortDir = $state<'asc' | 'desc'>('desc');

	function toggleSort(col: typeof sortCol) {
		if (sortCol === col) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortCol = col;
			sortDir = 'desc';
		}
	}

	const sorted = $derived.by(() => {
		const copy = [...events];
		const dir = sortDir === 'asc' ? 1 : -1;
		copy.sort((a, b) => {
			switch (sortCol) {
				case 'title': return dir * ((a.mediaTitle ?? '').localeCompare(b.mediaTitle ?? ''));
				case 'type': return dir * (a.mediaType.localeCompare(b.mediaType));
				case 'duration': return dir * ((a.playDurationMs ?? 0) - (b.playDurationMs ?? 0));
				case 'service': return dir * (a.serviceId.localeCompare(b.serviceId));
				case 'date': return dir * (a.timestamp - b.timestamp);
				default: return 0;
			}
		});
		return copy;
	});

	function formatDuration(ms: number | null): string {
		if (!ms || ms <= 0) return '—';
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${mins}m`;
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	}

	function sortIndicator(col: string): string {
		if (sortCol !== col) return '';
		return sortDir === 'asc' ? ' ↑' : ' ↓';
	}
</script>

<div class="overflow-x-auto">
	{#if events.length === 0}
		<p class="py-12 text-center text-sm text-faint">No history yet.</p>
	{:else}
		<table class="w-full text-xs">
			<thead>
				<tr class="border-b border-cream/[0.06] text-left text-[10px] uppercase tracking-wide text-faint">
					<th class="cursor-pointer px-3 py-2" onclick={() => toggleSort('title')}>Title{sortIndicator('title')}</th>
					<th class="cursor-pointer px-3 py-2" onclick={() => toggleSort('type')}>Type{sortIndicator('type')}</th>
					<th class="cursor-pointer px-3 py-2" onclick={() => toggleSort('duration')}>Duration{sortIndicator('duration')}</th>
					<th class="cursor-pointer px-3 py-2" onclick={() => toggleSort('service')}>Service{sortIndicator('service')}</th>
					<th class="cursor-pointer px-3 py-2" onclick={() => toggleSort('date')}>Date{sortIndicator('date')}</th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as event (event.id)}
					<tr class="border-b border-cream/[0.03] hover:bg-white/[0.02]">
						<td class="max-w-[200px] truncate px-3 py-2 text-cream/80">{event.mediaTitle ?? 'Untitled'}</td>
						<td class="px-3 py-2 capitalize text-muted">{event.mediaType}</td>
						<td class="px-3 py-2 text-muted">{formatDuration(event.playDurationMs)}</td>
						<td class="px-3 py-2 text-muted">{serviceNameMap.get(event.serviceId) ?? event.serviceId}</td>
						<td class="px-3 py-2 text-faint">{formatDate(event.timestamp)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/history/HistoryTable.svelte
git commit -m "feat: HistoryTable sortable table component"
```

---

### Task 19: History Page (Combining Feed, Table, Filters)

**Files:**
- Create: `src/routes/activity/history/+page.svelte`

- [ ] **Step 1: Create the history page**

```svelte
<script lang="ts">
	import type { PageData } from './$types';
	import type { MediaEvent } from '$lib/db/schema';
	import HistoryFilters from '$lib/components/history/HistoryFilters.svelte';
	import HistoryFeed from '$lib/components/history/HistoryFeed.svelte';
	import HistoryTable from '$lib/components/history/HistoryTable.svelte';

	let { data }: { data: PageData } = $props();

	let viewMode = $state<'feed' | 'table'>('feed');
	let selectedTypes = $state<string[]>([]);
	let searchQuery = $state('');
	let selectedService = $state('');

	let allEvents = $state<MediaEvent[]>(data.events as MediaEvent[]);
	let loading = $state(false);
	let hasMore = $state(data.events.length < data.total);

	// Client-side filter
	const filteredEvents = $derived.by(() => {
		let result = allEvents;
		if (selectedTypes.length > 0) {
			result = result.filter((e) => selectedTypes.includes(e.mediaType));
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter((e) => (e.mediaTitle ?? '').toLowerCase().includes(q));
		}
		if (selectedService) {
			result = result.filter((e) => e.serviceId === selectedService);
		}
		return result;
	});

	async function loadMore() {
		if (loading || !hasMore) return;
		loading = true;
		try {
			const params = new URLSearchParams({
				limit: '50',
				offset: String(allEvents.length)
			});
			if (selectedService) params.set('serviceId', selectedService);
			if (searchQuery.trim()) params.set('titleSearch', searchQuery.trim());

			const res = await fetch(`/api/user/stats/events?${params}`);
			const json = await res.json();
			allEvents = [...allEvents, ...json.events];
			hasMore = allEvents.length < json.total;
		} catch (e) {
			console.error('Failed to load more events:', e);
		} finally {
			loading = false;
		}
	}

	async function applyServerFilters() {
		loading = true;
		try {
			const params = new URLSearchParams({ limit: '50', offset: '0' });
			if (selectedService) params.set('serviceId', selectedService);
			if (searchQuery.trim()) params.set('titleSearch', searchQuery.trim());
			if (selectedTypes.length === 1) params.set('type', selectedTypes[0]);

			const res = await fetch(`/api/user/stats/events?${params}`);
			const json = await res.json();
			allEvents = json.events;
			hasMore = allEvents.length < json.total;
		} catch (e) {
			console.error('Failed to filter events:', e);
		} finally {
			loading = false;
		}
	}

	// Debounced server filter for search
	let filterTimeout: ReturnType<typeof setTimeout>;
	function onFilterChange() {
		clearTimeout(filterTimeout);
		filterTimeout = setTimeout(applyServerFilters, 300);
	}
</script>

<div class="px-3 sm:px-4 lg:px-6">
	<div class="mb-4">
		<HistoryFilters
			services={data.services}
			bind:selectedTypes
			bind:searchQuery
			bind:selectedService
			bind:viewMode
			onfilter={onFilterChange}
		/>
	</div>

	{#if viewMode === 'feed'}
		<HistoryFeed events={filteredEvents} />
	{:else}
		<HistoryTable events={filteredEvents} services={data.services} />
	{/if}

	{#if hasMore}
		<div class="mt-6 flex justify-center">
			<button
				onclick={loadMore}
				disabled={loading}
				class="rounded-lg bg-white/[0.04] px-6 py-2 text-xs font-medium text-muted transition-colors hover:bg-white/[0.08] disabled:opacity-50"
			>
				{loading ? 'Loading...' : 'Load More'}
			</button>
		</div>
	{/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/activity/history/+page.svelte
git commit -m "feat: history page with feed/table toggle, filters, infinite load"
```

---

## Chunk 5: Recommendations Tab

### Task 20: Recommendation API Endpoints

**Files:**
- Create: `src/routes/api/user/recommendations/+server.ts`
- Create: `src/routes/api/user/recommendations/preferences/+server.ts`
- Create: `src/routes/api/user/recommendations/feedback/+server.ts`
- Create: `src/routes/api/user/recommendations/feedback/[id]/+server.ts`

- [ ] **Step 1: Create recommendations GET endpoint**

Create `src/routes/api/user/recommendations/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getStreamyStatsRecommendations } from '$lib/adapters/streamystats';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = getDb();
	const userId = locals.user.id;

	// Find StreamyStats service
	const ssServices = db
		.select()
		.from(schema.services)
		.where(eq(schema.services.type, 'streamystats'))
		.all();

	if (ssServices.length === 0) {
		return json({ recommendations: [], error: 'No StreamyStats service configured' });
	}

	const ssConfig = getServiceConfig(ssServices[0].id);
	if (!ssConfig) return json({ recommendations: [] });

	// Get user's Jellyfin credential (StreamyStats auth)
	const userCred = getUserCredentialForService(userId, ssConfig.id);
	if (!userCred?.accessToken) {
		return json({ recommendations: [], error: 'No Jellyfin credentials linked' });
	}

	try {
		const recs = await getStreamyStatsRecommendations(ssConfig, 'all', userCred, 50);

		// Load preferences for filtering
		const prefs = db
			.select()
			.from(schema.recommendationPreferences)
			.where(eq(schema.recommendationPreferences.userId, userId))
			.all();
		const pref = prefs[0];

		// Load dismissed/downvoted items
		const feedback = db
			.select()
			.from(schema.recommendationFeedback)
			.where(eq(schema.recommendationFeedback.userId, userId))
			.all();
		const dismissed = new Set(feedback.filter((f) => f.feedback === 'dismiss' || f.feedback === 'down').map((f) => f.mediaId));

		// Filter out dismissed items
		let filtered = recs.filter((r) => !dismissed.has(r.id));

		// Apply similarity threshold
		if (pref) {
			const threshold = pref.similarityThreshold ?? 0.5;
			filtered = filtered.filter((r) => {
				const sim = (r as any).similarity ?? 1;
				return sim >= threshold;
			});
		}

		return json({ recommendations: filtered.slice(0, 20) });
	} catch (e) {
		console.error('[Recommendations] Error:', e);
		return json({ recommendations: [], error: 'Failed to fetch recommendations' });
	}
};
```

- [ ] **Step 2: Create preferences GET/PUT endpoint**

Create `src/routes/api/user/recommendations/preferences/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = getDb();
	const rows = db
		.select()
		.from(schema.recommendationPreferences)
		.where(eq(schema.recommendationPreferences.userId, locals.user.id))
		.all();

	if (rows.length === 0) {
		return json({
			mediaTypeWeights: { movie: 50, show: 50, book: 50, game: 50, music: 50, video: 50 },
			genrePreferences: {},
			similarityThreshold: 0.5
		});
	}

	const p = rows[0];
	return json({
		mediaTypeWeights: JSON.parse(p.mediaTypeWeights),
		genrePreferences: JSON.parse(p.genrePreferences),
		similarityThreshold: p.similarityThreshold
	});
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const db = getDb();

	db.insert(schema.recommendationPreferences)
		.values({
			userId: locals.user.id,
			mediaTypeWeights: JSON.stringify(body.mediaTypeWeights ?? {}),
			genrePreferences: JSON.stringify(body.genrePreferences ?? {}),
			similarityThreshold: body.similarityThreshold ?? 0.5,
			updatedAt: Date.now()
		})
		.onConflictDoUpdate({
			target: schema.recommendationPreferences.userId,
			set: {
				mediaTypeWeights: JSON.stringify(body.mediaTypeWeights ?? {}),
				genrePreferences: JSON.stringify(body.genrePreferences ?? {}),
				similarityThreshold: body.similarityThreshold ?? 0.5,
				updatedAt: Date.now()
			}
		})
		.run();

	return json({ ok: true });
};
```

- [ ] **Step 3: Create feedback POST/GET endpoint**

Create `src/routes/api/user/recommendations/feedback/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { eq, desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = getDb();
	const feedback = db
		.select()
		.from(schema.recommendationFeedback)
		.where(eq(schema.recommendationFeedback.userId, locals.user.id))
		.orderBy(desc(schema.recommendationFeedback.createdAt))
		.all();

	return json({ feedback });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { mediaId, mediaTitle, feedback, reason } = await request.json();
	if (!mediaId || !feedback) return json({ error: 'mediaId and feedback required' }, { status: 400 });

	const db = getDb();

	// Upsert: if user already gave feedback on this item, update it
	db.insert(schema.recommendationFeedback)
		.values({
			userId: locals.user.id,
			mediaId,
			mediaTitle: mediaTitle ?? null,
			feedback,
			reason: reason ?? null,
			createdAt: Date.now()
		})
		.onConflictDoUpdate({
			target: [schema.recommendationFeedback.userId, schema.recommendationFeedback.mediaId],
			set: {
				feedback,
				reason: reason ?? null,
				createdAt: Date.now()
			}
		})
		.run();

	return json({ ok: true });
};
```

Note: The `onConflictDoUpdate` with a composite target requires matching the UNIQUE index `idx_rec_feedback_unique` on `(user_id, media_id)`. If Drizzle doesn't support composite conflict targets directly, use raw SQL as a fallback:

```typescript
import { getRawDb } from '$lib/db';

// In POST handler, if Drizzle composite conflict doesn't work:
const raw = getRawDb();
raw.prepare(`
	INSERT INTO recommendation_feedback (user_id, media_id, media_title, feedback, reason, created_at)
	VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT(user_id, media_id) DO UPDATE SET feedback = ?, reason = ?, created_at = ?
`).run(
	locals.user.id, mediaId, mediaTitle ?? null, feedback, reason ?? null, Date.now(),
	feedback, reason ?? null, Date.now()
);
```

- [ ] **Step 4: Create feedback delete endpoint**

Create `src/routes/api/user/recommendations/feedback/[id]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = getDb();
	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	db.delete(schema.recommendationFeedback)
		.where(
			and(
				eq(schema.recommendationFeedback.id, id),
				eq(schema.recommendationFeedback.userId, locals.user.id)
			)
		)
		.run();

	return json({ ok: true });
};
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/user/recommendations/
git commit -m "feat: recommendation API endpoints (recs, preferences, feedback)"
```

---

### Task 21: Recommendations Page Server

**Files:**
- Create: `src/routes/activity/recommendations/+page.server.ts`

- [ ] **Step 1: Create recommendations page server**

```typescript
import { getDb, schema } from '$lib/db';
import { eq, desc } from 'drizzle-orm';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getStreamyStatsRecommendations } from '$lib/adapters/streamystats';
import { computeStats } from '$lib/server/stats-engine';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const userId = locals.user!.id;
	const { hasStreamyStats } = await parent();
	const db = getDb();

	// Load preferences
	const prefRows = db
		.select()
		.from(schema.recommendationPreferences)
		.where(eq(schema.recommendationPreferences.userId, userId))
		.all();

	const preferences = prefRows[0]
		? {
				mediaTypeWeights: JSON.parse(prefRows[0].mediaTypeWeights),
				genrePreferences: JSON.parse(prefRows[0].genrePreferences),
				similarityThreshold: prefRows[0].similarityThreshold
			}
		: {
				mediaTypeWeights: { movie: 50, show: 50, book: 50, game: 50, music: 50, video: 50 },
				genrePreferences: {} as Record<string, string>,
				similarityThreshold: 0.5
			};

	// Load feedback history
	const feedback = db
		.select()
		.from(schema.recommendationFeedback)
		.where(eq(schema.recommendationFeedback.userId, userId))
		.orderBy(desc(schema.recommendationFeedback.createdAt))
		.all();

	// Get user's consumed genres for the tuning UI
	const allTimeStats = computeStats(userId, 0, Date.now());
	const consumedGenres = allTimeStats.topGenres.map((g) => g.genre);

	return {
		hasStreamyStats,
		preferences,
		feedback,
		consumedGenres
	};
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/activity/recommendations/+page.server.ts
git commit -m "feat: recommendations page server with prefs, feedback, genres"
```

---

### Task 22: Recommendations Page

**Files:**
- Create: `src/routes/activity/recommendations/+page.svelte`

- [ ] **Step 1: Create the recommendations page**

```svelte
<script lang="ts">
	import type { PageData } from './$types';
	import { ThumbsUp, ThumbsDown, X, Loader2 } from 'lucide-svelte';
	import type { UnifiedMedia } from '$lib/adapters/types';

	let { data }: { data: PageData } = $props();

	let recommendations = $state<UnifiedMedia[]>([]);
	let recsLoading = $state(true);
	let recsError = $state<string | null>(null);
	let feedbackList = $state(data.feedback);

	let preferences = $state(data.preferences);
	let savingPrefs = $state(false);

	// Load recommendations client-side (StreamyStats can be slow)
	async function loadRecs() {
		if (!data.hasStreamyStats) { recsLoading = false; return; }
		try {
			const res = await fetch('/api/user/recommendations');
			const json = await res.json();
			recommendations = json.recommendations ?? [];
			recsError = json.error ?? null;
		} catch {
			recsError = "Couldn't reach StreamyStats.";
		} finally {
			recsLoading = false;
		}
	}

	$effect(() => { loadRecs(); });

	async function giveFeedback(mediaId: string, mediaTitle: string | undefined, fb: 'up' | 'down' | 'dismiss', reason?: string) {
		await fetch('/api/user/recommendations/feedback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mediaId, mediaTitle, feedback: fb, reason })
		});
		// Remove from visible list
		recommendations = recommendations.filter((r) => r.id !== mediaId);
		// Refresh feedback list
		const res = await fetch('/api/user/recommendations/feedback');
		feedbackList = (await res.json()).feedback;
	}

	async function deleteFeedback(id: number) {
		await fetch(`/api/user/recommendations/feedback/${id}`, { method: 'DELETE' });
		feedbackList = feedbackList.filter((f) => f.id !== id);
	}

	async function savePreferences() {
		savingPrefs = true;
		await fetch('/api/user/recommendations/preferences', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(preferences)
		});
		savingPrefs = false;
		// Reload recs with new prefs
		recsLoading = true;
		await loadRecs();
	}

	function toggleGenre(genre: string) {
		const current = preferences.genrePreferences[genre] ?? 'neutral';
		const cycle = { neutral: 'boost', boost: 'suppress', suppress: 'neutral' } as const;
		preferences.genrePreferences = { ...preferences.genrePreferences, [genre]: cycle[current as keyof typeof cycle] };
	}

	const WEIGHT_TYPES = ['movie', 'show', 'book', 'game', 'music', 'video'];
</script>

<div class="px-3 sm:px-4 lg:px-6">
	{#if !data.hasStreamyStats}
		<!-- Setup prompt -->
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-8 text-center">
			<p class="text-sm text-muted">Connect StreamyStats in Settings to get personalized recommendations.</p>
			<a href="/settings" class="mt-3 inline-block rounded-lg bg-accent/15 px-4 py-2 text-xs font-medium text-accent hover:bg-accent/25">
				Go to Settings
			</a>
		</div>
	{:else}
		<!-- Section 1: Active Recommendations -->
		<section class="mb-8">
			<h2 class="mb-4 text-base font-semibold text-cream">Recommendations</h2>
			{#if recsLoading}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
					{#each Array(6) as _}
						<div class="h-64 animate-pulse rounded-xl bg-white/[0.03]"></div>
					{/each}
				</div>
			{:else if recsError && recommendations.length === 0}
				<div class="rounded-xl border border-cream/[0.06] bg-raised p-6 text-center text-sm text-faint">
					{recsError}
				</div>
			{:else if recommendations.length === 0}
				<div class="rounded-xl border border-cream/[0.06] bg-raised p-6 text-center text-sm text-faint">
					Not enough watch history for recommendations yet. Keep watching!
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
					{#each recommendations as rec (rec.id)}
						<div class="group rounded-xl border border-cream/[0.06] bg-raised p-3">
							{#if rec.poster}
								<img src={rec.poster} alt={rec.title} class="mb-2 aspect-[2/3] w-full rounded-lg object-cover" />
							{:else}
								<div class="mb-2 flex aspect-[2/3] w-full items-center justify-center rounded-lg bg-white/[0.03] text-faint text-xs">
									No poster
								</div>
							{/if}
							<p class="truncate text-xs font-medium text-cream">{rec.title}</p>
							<p class="text-[10px] text-faint capitalize">{rec.type}</p>
							{#if (rec as any).reason}
								<p class="mt-1 text-[10px] text-muted">{(rec as any).reason}</p>
							{/if}
							{#if (rec as any).similarity != null}
								<p class="text-[10px] text-accent">{Math.round((rec as any).similarity * 100)}% match</p>
							{/if}
							<!-- Feedback buttons -->
							<div class="mt-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
								<button
									onclick={() => giveFeedback(rec.id, rec.title, 'up')}
									class="rounded-md bg-emerald-500/10 p-1.5 text-emerald-400 hover:bg-emerald-500/20"
									title="Like"
								>
									<ThumbsUp size={12} />
								</button>
								<button
									onclick={() => giveFeedback(rec.id, rec.title, 'down')}
									class="rounded-md bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20"
									title="Dislike"
								>
									<ThumbsDown size={12} />
								</button>
								<button
									onclick={() => giveFeedback(rec.id, rec.title, 'dismiss')}
									class="rounded-md bg-white/[0.04] p-1.5 text-faint hover:bg-white/[0.08] hover:text-cream"
									title="Not interested"
								>
									<X size={12} />
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Section 2: Algorithm Tuning -->
		<section class="mb-8">
			<h2 class="mb-4 text-base font-semibold text-cream">Algorithm Tuning</h2>
			<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
				<!-- Media type weights -->
				<h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Media Type Weights</h3>
				<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
					{#each WEIGHT_TYPES as type (type)}
						<div>
							<label class="mb-1 block text-[11px] capitalize text-muted">{type}</label>
							<input
								type="range"
								min="0" max="100"
								bind:value={preferences.mediaTypeWeights[type]}
								class="w-full accent-[#d4a253]"
							/>
							<span class="text-[10px] text-faint">{preferences.mediaTypeWeights[type]}</span>
						</div>
					{/each}
				</div>

				<!-- Genre preferences -->
				{#if data.consumedGenres.length > 0}
					<h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Genre Preferences</h3>
					<div class="mb-6 flex flex-wrap gap-2">
						{#each data.consumedGenres as genre (genre)}
							{@const pref = preferences.genrePreferences[genre] ?? 'neutral'}
							<button
								onclick={() => toggleGenre(genre)}
								class="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all
									{pref === 'boost' ? 'bg-emerald-500/15 text-emerald-400'
									: pref === 'suppress' ? 'bg-red-500/15 text-red-400'
									: 'bg-white/[0.04] text-muted'}"
							>
								{genre}
								{#if pref === 'boost'}↑{:else if pref === 'suppress'}↓{/if}
							</button>
						{/each}
					</div>
				{/if}

				<!-- Similarity threshold -->
				<h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Discovery Level</h3>
				<div class="mb-4 flex items-center gap-3">
					<span class="text-[10px] text-muted">Adventurous</span>
					<input
						type="range"
						min="0.3" max="0.9" step="0.05"
						bind:value={preferences.similarityThreshold}
						class="flex-1 accent-[#d4a253]"
					/>
					<span class="text-[10px] text-muted">Safe</span>
				</div>

				<button
					onclick={savePreferences}
					disabled={savingPrefs}
					class="rounded-lg bg-accent/15 px-4 py-2 text-xs font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
				>
					{savingPrefs ? 'Saving...' : 'Save & Refresh'}
				</button>
			</div>
		</section>

		<!-- Section 3: Feedback History -->
		{#if feedbackList.length > 0}
			<section>
				<h2 class="mb-4 text-base font-semibold text-cream">Feedback History</h2>
				<div class="overflow-hidden rounded-xl border border-cream/[0.06]">
					<table class="w-full text-xs">
						<thead>
							<tr class="border-b border-cream/[0.06] text-left text-[10px] uppercase tracking-wide text-faint">
								<th class="px-3 py-2">Title</th>
								<th class="px-3 py-2">Feedback</th>
								<th class="px-3 py-2">Date</th>
								<th class="px-3 py-2"></th>
							</tr>
						</thead>
						<tbody>
							{#each feedbackList as fb (fb.id)}
								<tr class="border-b border-cream/[0.03] hover:bg-white/[0.02]">
									<td class="px-3 py-2 text-cream/80">{fb.mediaTitle ?? fb.mediaId}</td>
									<td class="px-3 py-2">
										<span class="rounded px-1.5 py-0.5 text-[10px]
											{fb.feedback === 'up' ? 'bg-emerald-500/15 text-emerald-400'
											: fb.feedback === 'down' ? 'bg-red-500/15 text-red-400'
											: 'bg-white/[0.04] text-faint'}">
											{fb.feedback === 'up' ? '👍' : fb.feedback === 'down' ? '👎' : '✕'}
										</span>
									</td>
									<td class="px-3 py-2 text-faint">
										{new Date(fb.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
									</td>
									<td class="px-3 py-2">
										<button
											onclick={() => deleteFeedback(fb.id)}
											class="text-faint hover:text-red-400"
											title="Undo"
										>
											<X size={12} />
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	{/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/activity/recommendations/+page.svelte
git commit -m "feat: recommendations page with recs grid, tuning, feedback history"
```

---

## Chunk 6: Polish & Integration

### Task 23: Nav Highlight Fix

**Files:**
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 1: Verify nav activeId handles /activity sub-routes**

Read the `activeId` derived block in `src/routes/+layout.svelte`. It should already match `/activity*` to `'activity'` since `path.startsWith('/activity')` would be in the chain. If not, add:

```typescript
if (path.startsWith('/activity')) return 'activity';
```

into the `$derived.by` block, before the final fallback.

- [ ] **Step 2: Commit if changed**

```bash
git add src/routes/+layout.svelte
git commit -m "fix: nav activeId for activity sub-routes"
```

---

### Task 24: Remove Old Activity Page Content

**Files:**
- Modify: `src/routes/activity/+page.svelte`
- Modify: `src/routes/activity/+page.server.ts`

- [ ] **Step 1: Verify redirect works**

Navigate to `/activity` in the browser. It should redirect to `/activity/insights`. The old page content in `+page.svelte` is now unreachable (layout server handles redirect), but the minimal `+page.server.ts` redirect is a safety net.

- [ ] **Step 2: Commit final cleanup**

```bash
git add -A
git commit -m "feat: complete activity hub redesign with insights, history, and recommendations tabs"
```

---

### Task 25: Smoke Test

- [ ] **Step 1: Navigate to /activity → should redirect to /activity/insights**
- [ ] **Step 2: Verify Insights tab loads with stat cards and charts**
- [ ] **Step 3: Change period presets and date range — verify data updates**
- [ ] **Step 4: Click History tab — verify feed renders with events**
- [ ] **Step 5: Toggle table view — verify table renders**
- [ ] **Step 6: Filter by media type and search — verify filtering works**
- [ ] **Step 7: Click Recommendations tab — verify it loads (or shows setup prompt if no StreamyStats)**
- [ ] **Step 8: Test responsive layout at mobile viewport**

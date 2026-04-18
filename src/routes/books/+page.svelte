<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import MediaRow from '$lib/components/MediaRow.svelte';
	import BookHero from '$lib/components/books/BookHero.svelte';
	import BookshelfView from '$lib/components/books/BookshelfView.svelte';
	import BookListRow from '$lib/components/books/BookListRow.svelte';
	import SeriesCard from '$lib/components/books/SeriesCard.svelte';
	import SeriesCollapsedCard from '$lib/components/books/SeriesCollapsedCard.svelte';
	import AuthorCard from '$lib/components/books/AuthorCard.svelte';
	import BookCardSkeleton from '$lib/components/books/BookCardSkeleton.svelte';
	import ReadingStatsCard from '$lib/components/books/ReadingStatsCard.svelte';

	let { data }: { data: PageData } = $props();

	const sortOptions = [
		{ id: 'title', label: 'Title' },
		{ id: 'year', label: 'Year' },
		{ id: 'rating', label: 'Rating' },
		{ id: 'added', label: 'Recently Added' }
	];

	const statusOptions = [
		{ id: '', label: 'All' },
		{ id: 'read', label: 'Read' },
		{ id: 'unread', label: 'Unread' }
	];

	let viewMode = $state<'grid' | 'list' | 'shelf'>('grid');
	let localQuery = $state('');
	let collapseSeries = $state(false);

	const filtered = $derived(
		localQuery
			? data.items.filter((i: UnifiedMedia) => i.title.toLowerCase().includes(localQuery.toLowerCase()))
			: data.items
	);

	const activeTab = $derived(data.tab);

	type DisplayEntry = { type: 'book'; item: UnifiedMedia } | { type: 'series'; name: string; books: UnifiedMedia[] };

	const displayItems: DisplayEntry[] = $derived.by(() => {
		if (!collapseSeries || activeTab !== 'all') return filtered.map(item => ({ type: 'book' as const, item }));

		const seriesMap = new Map<string, UnifiedMedia[]>();
		const standalone: DisplayEntry[] = [];

		for (const item of filtered) {
			const series = item.metadata?.series as string | undefined;
			if (series) {
				if (!seriesMap.has(series)) seriesMap.set(series, []);
				seriesMap.get(series)!.push(item);
			} else {
				standalone.push({ type: 'book', item });
			}
		}

		const result: DisplayEntry[] = [];
		for (const [name, books] of seriesMap) {
			if (books.length > 1) {
				result.push({ type: 'series', name, books });
			} else {
				result.push({ type: 'book', item: books[0] });
			}
		}
		return [...result, ...standalone];
	});

	// --- Virtual scrolling for grid view ---
	const CARD_HEIGHT = 240;
	const VIRTUAL_THRESHOLD = 100;

	let gridContainer = $state<HTMLDivElement | undefined>(undefined);
	let visibleRange = $state({ start: 0, end: 60 });

	const useVirtualScrolling = $derived(viewMode === 'grid' && displayItems.length >= VIRTUAL_THRESHOLD);

	const cols = $derived.by(() => {
		if (!gridContainer) return 4;
		return Math.max(1, Math.floor(gridContainer.clientWidth / 160));
	});

	function updateVisibleRange() {
		if (!gridContainer) return;
		const scrollTop = window.scrollY;
		const containerTop = gridContainer.getBoundingClientRect().top + scrollTop;
		const relativeScroll = scrollTop - containerTop;
		const viewportHeight = window.innerHeight;
		const currentCols = Math.max(1, Math.floor(gridContainer.clientWidth / 160));
		const startRow = Math.floor(Math.max(0, relativeScroll - viewportHeight) / CARD_HEIGHT);
		const endRow = Math.ceil((relativeScroll + viewportHeight * 2) / CARD_HEIGHT);
		visibleRange = {
			start: Math.max(0, startRow * currentCols),
			end: Math.min(displayItems.length, endRow * currentCols + currentCols)
		};
	}

	$effect(() => {
		if (!useVirtualScrolling) return;
		updateVisibleRange();
		const onScroll = () => updateVisibleRange();
		const onResize = () => updateVisibleRange();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onResize, { passive: true });
		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onResize);
		};
	});

	// Build query string preserving current params
	function buildUrl(overrides: Record<string, string>): string {
		const params = new URLSearchParams();
		const current = { sort: data.sortBy, category: data.category, author: data.author, status: data.status, tab: data.tab };
		for (const [k, v] of Object.entries({ ...current, ...overrides })) {
			if (v) params.set(k, v);
		}
		return `/books?${params}`;
	}

	// Find representative cover for an author
	function authorCover(authorName: string): string | undefined {
		return data.items.find(i => (i.metadata?.author as string) === authorName)?.poster;
	}
</script>

<svelte:head>
	<title>Books — Nexus</title>
</svelte:head>

<div class="flex min-w-0 flex-col">
	<!-- Hero (only for libraries with 5+ books) -->
	{#if data.featuredBook && data.total >= 5}
		<BookHero book={data.featuredBook} />
	{/if}

	<!-- Continue Reading Row -->
	{#if data.continueReading.length > 0}
		<div class="mt-6">
			<MediaRow row={{ id: 'continue-reading', title: 'Continue Reading', subtitle: 'Pick up where you left off', items: data.continueReading }} />
		</div>
	{/if}

	<!-- Recently Added Row (only if 10+ books — avoids duplicating the grid) -->
	{#if data.recentlyAdded.length > 0 && data.total >= 10}
		<div class="mt-6">
			<MediaRow row={{ id: 'recently-added', title: 'Recently Added', subtitle: 'Latest additions to your library', items: data.recentlyAdded }} />
		</div>
	{/if}

	<!-- Reading Stats -->
	{#if data.readingStats && (data.readingStats.booksThisYear > 0 || data.readingStats.pagesThisMonth > 0)}
		<div class="mt-6 px-3 sm:px-4 lg:px-6">
			<ReadingStatsCard {...data.readingStats} />
		</div>
	{/if}

	<!-- Tab Navigation (only show when series or multiple authors exist) -->
	{#if data.series.length > 0 || data.authors.length > 1}
		<div class="{data.total >= 5 ? 'mt-8' : 'mt-4'} border-b border-[var(--color-surface)] px-3 sm:px-4 lg:px-6">
			<nav class="flex gap-0">
				{#each [{ id: 'all', label: 'All Books' }, { id: 'series', label: 'Series' }, { id: 'authors', label: 'Authors' }] as t (t.id)}
					{#if t.id === 'all' || (t.id === 'series' && data.series.length > 0) || (t.id === 'authors' && data.authors.length > 1)}
						<a
							href={buildUrl({ tab: t.id })}
							class="relative px-4 py-2.5 text-sm font-medium transition-colors {activeTab === t.id
								? 'text-[var(--color-cream)]'
								: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
						>
							{t.label}
							{#if activeTab === t.id}
								<div class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--color-accent)]"></div>
							{/if}
						</a>
					{/if}
				{/each}
			</nav>
		</div>
	{/if}

	<!-- Tab Content -->
	{#if activeTab === 'series'}
		<!-- Series Tab -->
		<div class="px-3 py-6 sm:px-4 lg:px-6">
			{#if data.series.length === 0}
				<p class="py-12 text-center text-sm text-[var(--color-muted)]">No series found in your library.</p>
			{:else}
				<div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
					{#each data.series as series (series.name)}
						<SeriesCard {series} />
					{/each}
				</div>
			{/if}
		</div>
	{:else if activeTab === 'authors'}
		<!-- Authors Tab -->
		<div class="px-3 py-6 sm:px-4 lg:px-6">
			{#if data.authors.length === 0}
				<p class="py-12 text-center text-sm text-[var(--color-muted)]">No authors found in your library.</p>
			{:else}
				<div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
					{#each data.authors as author (author.name)}
						<AuthorCard {author} representativeCover={authorCover(author.name)} />
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<!-- All Books Tab -->
		<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6">
			<!-- Filter Bar -->
			<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
				<div>
					<h1 class="text-lg font-semibold text-[var(--color-cream)]">Books</h1>
					<p class="text-xs text-[var(--color-muted)]">
						{data.total} book{data.total === 1 ? '' : 's'}
						{#if data.category}· {data.category}{/if}
						{#if data.author}· {data.author}{/if}
					</p>
				</div>

				<!-- Category chips (only show when 5+ books and multiple categories) -->
				{#if data.categories.length > 1 && data.total >= 5}
					<div class="flex gap-1.5 overflow-x-auto scrollbar-none sm:ml-auto">
						<a
							href={buildUrl({ category: '' })}
							class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all {!data.category
								? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
								: 'bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
						>All</a>
						{#each data.categories.slice(0, 12) as cat}
							<a
								href={buildUrl({ category: cat })}
								class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all {data.category === cat
									? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
									: 'bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
							>{cat}</a>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Controls Row (hide for tiny libraries) -->
			{#if data.total > 1}
			<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
				<!-- Sort -->
				<div class="flex items-center gap-2">
					<span class="text-xs text-[var(--color-muted)]">Sort</span>
					<div class="flex gap-1 overflow-x-auto rounded-lg bg-[var(--color-surface)] p-1 scrollbar-none">
						{#each sortOptions as s}
							<a
								href={buildUrl({ sort: s.id })}
								class="rounded-md px-2.5 py-1 text-xs font-medium transition-all {data.sortBy === s.id
									? 'bg-[var(--color-raised)] text-[var(--color-cream)]'
									: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
							>{s.label}</a>
						{/each}
					</div>
				</div>

				<!-- Status filter -->
				<div class="flex items-center gap-2">
					<span class="text-xs text-[var(--color-muted)]">Status</span>
					<div class="flex gap-1 rounded-lg bg-[var(--color-surface)] p-1">
						{#each statusOptions as s}
							<a
								href={buildUrl({ status: s.id })}
								class="rounded-md px-2.5 py-1 text-xs font-medium transition-all {data.status === s.id
									? 'bg-[var(--color-raised)] text-[var(--color-cream)]'
									: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
							>{s.label}</a>
						{/each}
					</div>
				</div>

				<!-- Spacer -->
				<div class="hidden sm:flex sm:flex-1"></div>

				<!-- Collapse series toggle -->
				{#if data.series.length > 0}
					<button
						onclick={() => collapseSeries = !collapseSeries}
						class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all {collapseSeries
							? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
							: 'bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
						aria-label="Collapse series"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M4 6h4v4H4zM4 14h4v4H4zM14 6h6M14 10h4M14 14h6M14 18h4"/>
						</svg>
						Series
					</button>
				{/if}

				<!-- View mode toggle -->
				<div class="flex items-center gap-1 rounded-lg bg-[var(--color-surface)] p-1">
					<button
						onclick={() => viewMode = 'grid'}
						class="rounded-md p-1.5 transition-all {viewMode === 'grid' ? 'bg-[var(--color-raised)] text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
						aria-label="Grid view"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
							<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
						</svg>
					</button>
					<button
						onclick={() => viewMode = 'list'}
						class="rounded-md p-1.5 transition-all {viewMode === 'list' ? 'bg-[var(--color-raised)] text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
						aria-label="List view"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
							<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
						</svg>
					</button>
					<button
						onclick={() => viewMode = 'shelf'}
						class="rounded-md p-1.5 transition-all {viewMode === 'shelf' ? 'bg-[var(--color-raised)] text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
						aria-label="Shelf view"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
							<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/>
						</svg>
					</button>
				</div>

				<!-- Quick search -->
				<input
					bind:value={localQuery}
					class="input w-full text-sm sm:w-44"
					placeholder="Filter..."
				/>
			</div>
			{/if}

			<!-- Library Display -->
			{#if filtered.length === 0}
				{@const isFailedLoad = data.hasBookService && data.serviceStatus === 'offline'}
				{@const isEmptyLibrary = data.hasBookService && data.serviceStatus === 'online' && data.items.length === 0}
				<div class="flex flex-col items-center justify-center py-24 text-center">
					<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] {isFailedLoad ? 'text-amber-500' : 'text-[var(--color-muted)]'}">
						{#if isFailedLoad}
							<!-- Warning icon for failed load -->
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
								<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
							</svg>
						{:else}
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
								<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/><path d="M4 20h10"/>
							</svg>
						{/if}
					</div>
					{#if isFailedLoad}
						<p class="font-medium">Couldn't load Calibre library</p>
						<p class="mt-1 max-w-md text-sm text-[var(--color-muted)]">
							Calibre-Web is configured but unreachable right now. Check that the service is running and your credentials are correct.
						</p>
						{#if data.serviceError}
							<p class="mt-2 max-w-md text-xs text-[var(--color-muted)]/70 font-mono">{data.serviceError}</p>
						{/if}
						<div class="mt-4 flex gap-2">
							<a href="/settings/accounts" class="btn btn-secondary text-sm">Check connection</a>
							<button onclick={() => window.location.reload()} class="btn btn-primary text-sm">Retry</button>
						</div>
					{:else if isEmptyLibrary}
						<p class="font-medium">Your library is empty</p>
						<p class="mt-1 max-w-md text-sm text-[var(--color-muted)]">
							Calibre-Web is connected, but there are no books yet. Add books through Calibre-Web's interface to see them here.
						</p>
					{:else if !data.hasBookService}
						<p class="font-medium">No books found</p>
						<p class="mt-1 text-sm text-[var(--color-muted)]">Connect Calibre to see your book collection here.</p>
						<a href="/settings/accounts" class="btn btn-primary mt-4 text-sm">Connect a Service</a>
					{:else}
						<p class="font-medium">No books found</p>
						<p class="mt-1 text-sm text-[var(--color-muted)]">Try adjusting your filters.</p>
					{/if}
				</div>
			{:else if viewMode === 'shelf'}
				<BookshelfView items={filtered} />
			{:else if viewMode === 'list'}
				<div class="flex flex-col divide-y divide-[var(--color-surface)]">
					{#each filtered as item (item.id)}
						<BookListRow {item} />
					{/each}
				</div>
			{:else}
				<div
					bind:this={gridContainer}
					class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4"
				>
					{#if useVirtualScrolling}
						{@const beforeHeight = Math.floor(visibleRange.start / cols) * CARD_HEIGHT}
						{@const afterItems = displayItems.length - visibleRange.end}
						{@const afterHeight = Math.ceil(Math.max(0, afterItems) / cols) * CARD_HEIGHT}
						{#if beforeHeight > 0}
							<div style="height: {beforeHeight}px; grid-column: 1 / -1;"></div>
						{/if}
						{#each displayItems.slice(visibleRange.start, visibleRange.end) as entry (entry.type === 'series' ? `series:${entry.name}` : entry.item.id)}
							{#if entry.type === 'series'}
								<SeriesCollapsedCard
									seriesName={entry.name}
									books={entry.books}
									onExpand={() => { window.location.href = buildUrl({ tab: 'all', series: entry.name }); }}
								/>
							{:else}
								<div class="relative">
									<MediaCard item={entry.item} />
									{#if entry.item.metadata?.formats}
										<div class="absolute bottom-[3.2rem] left-1 z-10 flex gap-0.5">
											{#each (entry.item.metadata.formats as { name: string }[]).slice(0, 3) as fmt (fmt.name)}
												<span class="rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium uppercase text-white/80 backdrop-blur-sm">{fmt.name}</span>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						{/each}
						{#if afterHeight > 0}
							<div style="height: {afterHeight}px; grid-column: 1 / -1;"></div>
						{/if}
					{:else}
						{#each displayItems as entry (entry.type === 'series' ? `series:${entry.name}` : entry.item.id)}
							{#if entry.type === 'series'}
								<SeriesCollapsedCard
									seriesName={entry.name}
									books={entry.books}
									onExpand={() => { window.location.href = buildUrl({ tab: 'all', series: entry.name }); }}
								/>
							{:else}
								<div class="relative">
									<MediaCard item={entry.item} />
									{#if entry.item.metadata?.formats}
										<div class="absolute bottom-[3.2rem] left-1 z-10 flex gap-0.5">
											{#each (entry.item.metadata.formats as { name: string }[]).slice(0, 3) as fmt (fmt.name)}
												<span class="rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium uppercase text-white/80 backdrop-blur-sm">{fmt.name}</span>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						{/each}
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

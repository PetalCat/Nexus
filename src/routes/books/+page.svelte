<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import HeroCinematic from '$lib/components/books/system/heroes/HeroCinematic.svelte';
	import HeroLiterary from '$lib/components/books/system/heroes/HeroLiterary.svelte';
	// HeroConstellation is available but not used in default flow (future flourish)
	import RightRailBlock from '$lib/components/books/system/RightRailBlock.svelte';
	import ProgressThread from '$lib/components/books/system/ProgressThread.svelte';
	import BookCover from '$lib/components/books/system/BookCover.svelte';
	import ProseStat from '$lib/components/books/system/ProseStat.svelte';
	import Ornament from '$lib/components/books/system/Ornament.svelte';
	import SectionHeader from '$lib/components/books/system/SectionHeader.svelte';
	// Preserved library-body components:
	import BookshelfView from '$lib/components/books/BookshelfView.svelte';
	import BookListRow from '$lib/components/books/BookListRow.svelte';
	import SeriesCard from '$lib/components/books/SeriesCard.svelte';
	import SeriesCollapsedCard from '$lib/components/books/SeriesCollapsedCard.svelte';
	import AuthorCard from '$lib/components/books/AuthorCard.svelte';
	import MediaCard from '$lib/components/MediaCard.svelte';

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

	// New derived fields from Task 9 loader
	const streakCount = $derived(data.streak14?.filter(Boolean).length ?? 0);

	function currentPageLabel(book: { progress?: number; metadata?: Record<string, unknown> }): string {
		const pct = Math.round((book.progress ?? 0) * 100);
		const pages = (book.metadata?.pages as number | undefined) ?? 0;
		if (pct <= 0) return 'not started';
		const page = pages > 0 ? Math.round((book.progress ?? 0) * pages) : null;
		return page != null ? `page ${page} · ${pct}%` : `${pct}%`;
	}
</script>

<svelte:head><title>Books — Nexus</title></svelte:head>

<div class="books-page">

	<!-- 1. Hero -->
	{#if !data.hasBookService}
		<section class="onboarding-hero">
			<h1>Connect a book service</h1>
			<p>Nexus reads from Calibre-Web. Connect one under Settings → Accounts to populate your library.</p>
			<a class="btn primary" href="/settings/accounts">Connect a service</a>
		</section>
	{:else if data.serviceStatus === 'offline'}
		<section class="offline-strip">
			<span class="tag">⚠ BOOK SERVICE OFFLINE</span>
			<p>Couldn't reach Calibre-Web. {data.serviceError ?? 'Check that the service is running.'}</p>
			<button onclick={() => window.location.reload()}>Retry</button>
		</section>
	{:else if data.currentBook}
		<HeroCinematic book={data.currentBook} />
	{:else}
		<HeroLiterary totalBooks={data.total} {streakCount} currentBook={data.currentBook ?? null} />
	{/if}

	<!-- 2 + 3. Main + rail grid -->
	{#if data.hasBookService && data.serviceStatus !== 'offline'}
		<div class="main-grid">
			<section class="lib-col" id="library">
				<SectionHeader ordinal="◇ LIBRARY" title="Your library" meta={`${data.total} book${data.total === 1 ? '' : 's'}`} />

				<!-- Tabs (only show when series or multiple authors exist) -->
				{#if data.series.length > 0 || data.authors.length > 1}
					<nav class="tabs">
						{#each [{ id: 'all', label: 'All Books' }, { id: 'series', label: 'Series' }, { id: 'authors', label: 'Authors' }] as t (t.id)}
							{#if t.id === 'all' || (t.id === 'series' && data.series.length > 0) || (t.id === 'authors' && data.authors.length > 1)}
								<a href={buildUrl({ tab: t.id })} class:active={activeTab === t.id}>{t.label}</a>
							{/if}
						{/each}
					</nav>
				{/if}

				<!-- Tab Content -->
				{#if activeTab === 'series'}
					<!-- Series Tab -->
					<div class="tab-body">
						{#if data.series.length === 0}
							<p class="empty-tab">No series found in your library.</p>
						{:else}
							<div class="series-grid">
								{#each data.series as series (series.name)}
									<SeriesCard {series} />
								{/each}
							</div>
						{/if}
					</div>
				{:else if activeTab === 'authors'}
					<!-- Authors Tab -->
					<div class="tab-body">
						{#if data.authors.length === 0}
							<p class="empty-tab">No authors found in your library.</p>
						{:else}
							<div class="authors-grid">
								{#each data.authors as author (author.name)}
									<AuthorCard {author} representativeCover={authorCover(author.name)} />
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					<!-- All Books Tab -->
					<div class="tab-body">
						<!-- Filter Bar -->
						<div class="filter-bar">
							<!-- Category chips (only show when 5+ books and multiple categories) -->
							{#if data.categories.length > 1 && data.total >= 5}
								<div class="category-chips">
									<a
										href={buildUrl({ category: '' })}
										class="chip {!data.category ? 'chip-active' : ''}"
									>All</a>
									{#each data.categories.slice(0, 12) as cat}
										<a
											href={buildUrl({ category: cat })}
											class="chip {data.category === cat ? 'chip-active' : ''}"
										>{cat}</a>
									{/each}
								</div>
							{/if}
						</div>

						<!-- Controls Row (hide for tiny libraries) -->
						{#if data.total > 1}
							<div class="controls-row">
								<!-- Sort -->
								<div class="ctrl-group">
									<span class="ctrl-label">Sort</span>
									<div class="seg-group">
										{#each sortOptions as s}
											<a
												href={buildUrl({ sort: s.id })}
												class="seg {data.sortBy === s.id ? 'seg-active' : ''}"
											>{s.label}</a>
										{/each}
									</div>
								</div>

								<!-- Status filter -->
								<div class="ctrl-group">
									<span class="ctrl-label">Status</span>
									<div class="seg-group">
										{#each statusOptions as s}
											<a
												href={buildUrl({ status: s.id })}
												class="seg {data.status === s.id ? 'seg-active' : ''}"
											>{s.label}</a>
										{/each}
									</div>
								</div>

								<!-- Spacer -->
								<div class="ctrl-spacer"></div>

								<!-- Collapse series toggle -->
								{#if data.series.length > 0}
									<button
										onclick={() => collapseSeries = !collapseSeries}
										class="toggle-btn {collapseSeries ? 'toggle-btn-active' : ''}"
										aria-label="Collapse series"
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M4 6h4v4H4zM4 14h4v4H4zM14 6h6M14 10h4M14 14h6M14 18h4"/>
										</svg>
										Series
									</button>
								{/if}

								<!-- View mode toggle -->
								<div class="view-toggle">
									<button
										onclick={() => viewMode = 'grid'}
										class="view-btn {viewMode === 'grid' ? 'view-btn-active' : ''}"
										aria-label="Grid view"
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
											<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
										</svg>
									</button>
									<button
										onclick={() => viewMode = 'list'}
										class="view-btn {viewMode === 'list' ? 'view-btn-active' : ''}"
										aria-label="List view"
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
											<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
										</svg>
									</button>
									<button
										onclick={() => viewMode = 'shelf'}
										class="view-btn {viewMode === 'shelf' ? 'view-btn-active' : ''}"
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
									class="input filter-input"
									placeholder="Filter..."
								/>
							</div>
						{/if}

						<!-- Library Display -->
						{#if filtered.length === 0}
							{@const isEmptyLibrary = data.serviceStatus === 'online' && data.items.length === 0}
							<div class="empty-state">
								<div class="empty-icon">
									<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
										<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/><path d="M4 20h10"/>
									</svg>
								</div>
								{#if isEmptyLibrary}
									<p class="empty-title">Your library is empty</p>
									<p class="empty-body">
										Calibre-Web is connected, but there are no books yet. Add books through Calibre-Web's interface to see them here.
									</p>
								{:else}
									<p class="empty-title">No books found</p>
									<p class="empty-body">Try adjusting your filters.</p>
								{/if}
							</div>
						{:else if viewMode === 'shelf'}
							<BookshelfView items={filtered} />
						{:else if viewMode === 'list'}
							<div class="list-view">
								{#each filtered as item (item.id)}
									<BookListRow {item} />
								{/each}
							</div>
						{:else}
							<div
								bind:this={gridContainer}
								class="book-grid"
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
											<div class="card-wrap">
												<MediaCard item={entry.item} />
												{#if entry.item.metadata?.formats}
													<div class="fmt-badges">
														{#each (entry.item.metadata.formats as { name: string }[]).slice(0, 3) as fmt (fmt.name)}
															<span class="fmt-badge">{fmt.name}</span>
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
											<div class="card-wrap">
												<MediaCard item={entry.item} />
												{#if entry.item.metadata?.formats}
													<div class="fmt-badges">
														{#each (entry.item.metadata.formats as { name: string }[]).slice(0, 3) as fmt (fmt.name)}
															<span class="fmt-badge">{fmt.name}</span>
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
			</section>

			<aside class="rail" aria-label="Reading sidebar">
				<RightRailBlock label="Continue">
					{#snippet children()}
						{#if data.currentBook}
							<div class="qr-row">
								<BookCover book={data.currentBook} size="xs" showProgress={false} />
								<div class="qr-info">
									<div class="qr-title">{data.currentBook.title}</div>
									<div class="qr-meta">{currentPageLabel(data.currentBook)}</div>
								</div>
								<a class="qr-btn" href="/books/read/{data.currentBook.id}">Open</a>
							</div>
						{:else if data.total > 0}
							<a class="qr-cta" href="#library">Pick something from the library →</a>
						{:else}
							<div class="qr-empty">Nothing yet.</div>
						{/if}
					{/snippet}
				</RightRailBlock>

				<RightRailBlock label="Year progress">
					{#snippet children()}
						<div class="yp-row">
							<span class="yp-big">{data.yearProgress.booksThisYear}</span>
							<span class="yp-unit">/ {data.yearProgress.goal} books</span>
						</div>
						<ProgressThread value={data.yearProgress.goal > 0 ? data.yearProgress.booksThisYear / data.yearProgress.goal : 0} />
					{/snippet}
				</RightRailBlock>

				<RightRailBlock label="Last 14 days">
					{#snippet children()}
						<div class="streak">
							{#each data.streak14 as hit, i (i)}
								<span class="s" class:on={hit}></span>
							{/each}
						</div>
					{/snippet}
				</RightRailBlock>

				{#if data.recentHighlight}
					{@const hl = data.recentHighlight}
					<RightRailBlock label="Recent highlight" linkText="All highlights" linkHref="/books/notes">
						{#snippet children()}
							<div class="hl-quote">"{hl.text}"</div>
							<div class="hl-cite">
								{hl.bookTitle}{hl.chapter ? ` · ${hl.chapter}` : ''}
							</div>
						{/snippet}
					</RightRailBlock>
				{/if}
			</aside>
		</div>

		<!-- 4. ProseStat divider -->
		<div class="divider">
			<ProseStat>
				{#snippet children()}
					{data.total} books on the shelves · a streak of <strong>{streakCount}</strong> day{streakCount === 1 ? '' : 's'}.
					<a class="more-link" href="/books/stats">More in stats →</a>
				{/snippet}
			</ProseStat>
		</div>

		<!-- 5. Deep-page links -->
		<div class="deep-links">
			<a class="deep-card" href="/books/stats">
				<div class="deep-title">Stats &amp; habits</div>
				<div class="deep-sub">Goal ring · genre bars · reading calendar</div>
				<span class="deep-arrow">→</span>
			</a>
			<a class="deep-card" href="/books/notes">
				<div class="deep-title">Marginalia</div>
				<div class="deep-sub">Highlights &amp; notes archive</div>
				<span class="deep-arrow">→</span>
			</a>
		</div>

		<!-- 6. Literary footer -->
		<footer class="lit-footer">
			<Ornament variant="cluster" />
			<ProseStat>
				{#snippet children()}
					<strong>{streakCount}</strong> day{streakCount === 1 ? '' : 's'} of reading at Nexus this season.
				{/snippet}
			</ProseStat>
		</footer>
	{/if}
</div>

<style>
	.books-page { padding-bottom: 60px; }

	/* onboarding + offline */
	.onboarding-hero { padding: 60px 32px; text-align: center; }
	.onboarding-hero h1 { font-family: var(--font-display); font-size: 36px; margin: 0 0 10px; }
	.onboarding-hero p { color: var(--muted); max-width: 48ch; margin: 0 auto 22px; }
	.onboarding-hero .btn { display: inline-block; padding: 10px 22px; border-radius: 100px; background: var(--accent); color: var(--void); font-weight: 700; }
	.offline-strip { padding: 20px 32px; background: rgba(196, 92, 92, .08); border-bottom: 1px solid rgba(196, 92, 92, .2); display: flex; align-items: center; gap: 16px; }
	.offline-strip .tag { font: 10px/1 var(--font-mono); letter-spacing: .18em; color: #e88888; text-transform: uppercase; }
	.offline-strip p { color: var(--muted); margin: 0; flex: 1; font-size: 13px; }
	.offline-strip button { padding: 6px 14px; border-radius: 100px; background: rgba(240,235,227,.06); color: var(--cream); border: 1px solid rgba(240,235,227,.1); font-size: 12px; }

	/* main + rail grid */
	.main-grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 32px; padding: 20px 28px; }
	.rail { position: sticky; top: 14px; align-self: start; background: var(--base); border: 1px solid rgba(240,235,227,.06); border-radius: 10px; padding: 4px 16px; min-height: 40px; }

	/* library section */
	.lib-col { min-width: 0; }
	.tabs { display: flex; gap: 0; border-bottom: 1px solid var(--surface); margin: 14px 0 18px; }
	.tabs a { padding: 10px 18px; font-size: 13px; font-weight: 500; color: var(--muted); position: relative; text-decoration: none; }
	.tabs a.active { color: var(--cream); }
	.tabs a.active::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: 0; height: 2px; background: var(--accent); border-radius: 1px; }

	/* tab body */
	.tab-body { padding: 6px 0; }
	.empty-tab { padding: 48px 0; text-align: center; font-size: 13px; color: var(--muted); }
	.series-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
	.authors-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }

	/* filter bar */
	.filter-bar { margin-bottom: 10px; }
	.category-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 4px; }
	.category-chips::-webkit-scrollbar { display: none; }
	.chip { flex-shrink: 0; border-radius: 100px; padding: 4px 10px; font-size: 11px; font-weight: 500; text-decoration: none; transition: all .15s; background: var(--surface); color: var(--muted); }
	.chip:hover { color: var(--cream); }
	.chip-active { background: rgba(212,162,83,.15); color: var(--accent); }

	/* controls row */
	.controls-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 16px; }
	.ctrl-group { display: flex; align-items: center; gap: 8px; }
	.ctrl-label { font-size: 12px; color: var(--muted); }
	.ctrl-spacer { flex: 1; display: none; }
	@media (min-width: 640px) { .ctrl-spacer { display: block; } }
	.seg-group { display: flex; gap: 2px; background: var(--surface); border-radius: 8px; padding: 4px; overflow-x: auto; scrollbar-width: none; }
	.seg-group::-webkit-scrollbar { display: none; }
	.seg { border-radius: 6px; padding: 4px 10px; font-size: 12px; font-weight: 500; text-decoration: none; color: var(--muted); transition: all .15s; white-space: nowrap; }
	.seg:hover { color: var(--cream); }
	.seg-active { background: var(--raised); color: var(--cream); }
	.toggle-btn { display: flex; align-items: center; gap: 6px; border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 500; background: var(--surface); color: var(--muted); transition: all .15s; }
	.toggle-btn:hover { color: var(--cream); }
	.toggle-btn-active { background: rgba(212,162,83,.15); color: var(--accent); }
	.view-toggle { display: flex; gap: 2px; background: var(--surface); border-radius: 8px; padding: 4px; }
	.view-btn { border-radius: 6px; padding: 6px; color: var(--muted); transition: all .15s; }
	.view-btn:hover { color: var(--cream); }
	.view-btn-active { background: var(--raised); color: var(--cream); }
	.filter-input { font-size: 13px; width: 100%; }
	@media (min-width: 640px) { .filter-input { width: 176px; } }

	/* empty state */
	.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 96px 0; text-align: center; }
	.empty-icon { display: flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 16px; background: var(--surface); color: var(--muted); margin-bottom: 20px; }
	.empty-title { font-weight: 600; color: var(--cream); margin: 0 0 6px; }
	.empty-body { font-size: 13px; color: var(--muted); max-width: 42ch; margin: 0 0 16px; }

	/* list view */
	.list-view { display: flex; flex-direction: column; }
	.list-view :global(> *) { border-bottom: 1px solid var(--surface); }
	.list-view :global(> *:last-child) { border-bottom: none; }

	/* book grid */
	.book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 12px; }
	@media (min-width: 640px) { .book-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; } }
	.card-wrap { position: relative; }
	.fmt-badges { position: absolute; bottom: 3.2rem; left: 4px; z-index: 10; display: flex; gap: 2px; }
	.fmt-badge { border-radius: 3px; background: rgba(0,0,0,.6); padding: 2px 4px; font-size: 9px; font-weight: 500; text-transform: uppercase; color: rgba(255,255,255,.8); backdrop-filter: blur(4px); }

	/* divider */
	.divider { text-align: center; padding: 14px 28px; }
	.more-link { font: 10px/1 var(--font-mono); letter-spacing: .22em; color: var(--accent); text-transform: uppercase; margin-left: 10px; text-decoration: none; }

	/* deep links */
	.deep-links { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 20px 28px; }
	.deep-card { position: relative; display: block; padding: 18px 22px; background: var(--base); border: 1px solid rgba(240,235,227,.06); border-radius: 10px; text-decoration: none; color: var(--cream); }
	.deep-card:hover { border-color: rgba(212,162,83,.3); }
	.deep-title { font-family: var(--font-display); font-size: 17px; font-weight: 700; }
	.deep-sub { color: var(--muted); font-size: 12px; margin-top: 4px; }
	.deep-arrow { position: absolute; top: 20px; right: 22px; font: 11px/1 var(--font-mono); letter-spacing: .2em; color: var(--accent); }

	/* footer */
	.lit-footer { text-align: center; padding: 40px 28px 20px; }

	/* responsive: tablet */
	@media (max-width: 1023px) {
		.main-grid { grid-template-columns: 1fr; }
		.rail { position: static; }
	}
	/* responsive: mobile */
	@media (max-width: 639px) {
		.main-grid { padding: 16px; gap: 16px; }
		.deep-links { grid-template-columns: 1fr; padding: 16px; }
		.divider { padding: 8px 16px; }
	}

	/* right rail block styles */
	.qr-row { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; }
	.qr-info { min-width: 0; }
	.qr-title { font-family: var(--font-display); font-style: italic; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--cream); }
	.qr-meta { font: 9px/1 var(--font-mono); color: var(--faint); letter-spacing: .12em; margin-top: 3px; text-transform: uppercase; }
	.qr-btn { padding: 5px 10px; border-radius: 100px; background: var(--accent); color: var(--void); font: 700 10px/1 var(--font-mono); letter-spacing: .1em; text-decoration: none; }
	.qr-cta, .qr-empty { font: 11px/1.4 var(--font-display); font-style: italic; color: var(--muted); text-decoration: none; }
	.qr-cta:hover { color: var(--accent-lt); }

	.yp-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
	.yp-big { font-family: var(--font-display); font-size: 26px; font-weight: 700; line-height: 1; color: var(--cream); }
	.yp-unit { font: 10px/1 var(--font-mono); color: var(--muted); letter-spacing: .1em; }

	.streak { display: flex; gap: 3px; }
	.streak .s { flex: 1; height: 8px; background: var(--raised); border-radius: 1px; }
	.streak .s.on { background: var(--accent); box-shadow: 0 0 4px rgba(212, 162, 83, .4); }

	.hl-quote { font-family: var(--font-display); font-style: italic; font-size: 12px; line-height: 1.5; color: rgba(240, 235, 227, .82); }
	.hl-cite { font: 9px/1 var(--font-mono); color: var(--faint); letter-spacing: .12em; margin-top: 6px; text-transform: uppercase; }
</style>

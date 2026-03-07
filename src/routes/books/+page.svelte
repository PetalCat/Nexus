<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import MediaRow from '$lib/components/MediaRow.svelte';
	import BookHero from '$lib/components/books/BookHero.svelte';
	import BookshelfView from '$lib/components/books/BookshelfView.svelte';
	import BookListRow from '$lib/components/books/BookListRow.svelte';
	import SeriesCard from '$lib/components/books/SeriesCard.svelte';
	import AuthorCard from '$lib/components/books/AuthorCard.svelte';
	import ReadingStatsWidget from '$lib/components/books/ReadingStatsWidget.svelte';

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

	const filtered = $derived(
		localQuery
			? data.items.filter((i: UnifiedMedia) => i.title.toLowerCase().includes(localQuery.toLowerCase()))
			: data.items
	);

	const activeTab = $derived(data.tab);

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
	<!-- Hero -->
	{#if data.featuredBook}
		<BookHero book={data.featuredBook} />
	{/if}

	<!-- Reading Stats -->
	<div class="mt-4 px-3 sm:px-4 lg:px-6">
		<ReadingStatsWidget />
	</div>

	<!-- Continue Reading Row -->
	{#if data.continueReading.length > 0}
		<div class="mt-6">
			<MediaRow row={{ id: 'continue-reading', title: 'Continue Reading', subtitle: 'Pick up where you left off', items: data.continueReading }} />
		</div>
	{/if}

	<!-- Recently Added Row -->
	{#if data.recentlyAdded.length > 0}
		<div class="mt-6">
			<MediaRow row={{ id: 'recently-added', title: 'Recently Added', subtitle: 'Latest additions to your library', items: data.recentlyAdded }} />
		</div>
	{/if}

	<!-- Tab Navigation -->
	<div class="mt-8 border-b border-[var(--color-surface)] px-3 sm:px-4 lg:px-6">
		<nav class="flex gap-0">
			{#each [{ id: 'all', label: 'All Books' }, { id: 'series', label: 'Series' }, { id: 'authors', label: 'Authors' }] as t}
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
			{/each}
		</nav>
	</div>

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
					<p class="text-xs text-[var(--color-muted)]">
						{data.total} book{data.total === 1 ? '' : 's'}
						{#if data.category}· {data.category}{/if}
						{#if data.author}· {data.author}{/if}
					</p>
				</div>

				<!-- Category chips (scrollable) -->
				{#if data.categories.length > 0}
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

			<!-- Controls Row -->
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

			<!-- Library Display -->
			{#if filtered.length === 0}
				<div class="flex flex-col items-center justify-center py-24 text-center">
					<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
						<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/><path d="M4 20h10"/>
						</svg>
					</div>
					<p class="font-medium">No books found</p>
					<p class="mt-1 text-sm text-[var(--color-muted)]">
						{data.items.length === 0 ? 'Connect Calibre to see your book collection here.' : 'Try adjusting your filters.'}
					</p>
					{#if data.items.length === 0}
						<a href="/settings" class="btn btn-primary mt-4 text-sm">Connect a Service</a>
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
				<div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4">
					{#each filtered as item (item.id)}
						<MediaCard {item} />
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

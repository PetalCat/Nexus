<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import SetupHint from '$lib/components/onboarding/SetupHint.svelte';
	import { goto } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	interface Genre {
		id: number;
		name: string;
	}

	const tabs = [
		{ id: 'trending', label: 'Trending' },
		{ id: 'movies', label: 'Movies' },
		{ id: 'tv', label: 'TV Shows' },
		{ id: 'upcoming-movies', label: 'Upcoming Movies' },
		{ id: 'upcoming-tv', label: 'Upcoming TV' }
	] as const;

	type TabId = (typeof tabs)[number]['id'];

	// Derive tab and genre from server data (reactive to navigation)
	const activeTab = $derived((data.category as TabId) ?? 'trending');
	const selectedGenreId = $derived(data.genreId ?? '');

	// Server-provided items as the base; extra pages appended client-side
	let extraItems = $state<UnifiedMedia[]>([]);
	let extraHasMore = $state<boolean | null>(null);
	let currentPage = $state(1);
	let loading = $state(false);

	// Reset appended items when server data changes (tab/genre switch)
	let lastCategory = $state('');
	let lastGenreId = $state('');
	$effect(() => {
		const cat = data.category ?? '';
		const gid = data.genreId ?? '';
		if (cat !== lastCategory || gid !== lastGenreId) {
			lastCategory = cat;
			lastGenreId = gid;
			extraItems = [];
			extraHasMore = null;
			currentPage = 1;
		}
	});

	const items = $derived([...(data.discover?.items ?? []), ...extraItems]);
	const hasMore = $derived(extraHasMore ?? data.discover?.hasMore ?? false);

	// Determine which genre list to show based on active tab
	const isMovieTab = $derived(
		activeTab === 'movies' || activeTab === 'upcoming-movies'
	);
	const isTvTab = $derived(
		activeTab === 'tv' || activeTab === 'upcoming-tv'
	);
	const showGenreFilter = $derived(isMovieTab || isTvTab);
	const genres = $derived<Genre[]>(isMovieTab ? data.movieGenres : isTvTab ? data.tvGenres : []);

	// Request state per item
	let requesting = $state<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});

	// Sentinel element for IntersectionObserver
	let observer: IntersectionObserver | undefined;

	function observeSentinel(node: HTMLDivElement) {
		observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && hasMore && !loading) {
					loadMore();
				}
			},
			{ rootMargin: '400px' }
		);
		observer.observe(node);
		return {
			destroy() {
				observer?.disconnect();
			}
		};
	}

	async function switchTab(tabId: TabId) {
		if (tabId === activeTab && !selectedGenreId) return;
		await navigateDiscover(tabId, '');
	}

	async function selectGenre(genreId: string) {
		await navigateDiscover(activeTab, genreId);
	}

	async function navigateDiscover(category: string, genreId: string) {
		const params = new URLSearchParams();
		params.set('category', category);
		if (genreId) params.set('genreId', genreId);
		await goto(`/discover?${params.toString()}`, { replaceState: true });
	}

	async function loadMore() {
		if (loading || !hasMore) return;
		loading = true;
		try {
			const nextPage = currentPage + 1;
			const params = new URLSearchParams();
			params.set('category', activeTab);
			if (selectedGenreId) params.set('genreId', selectedGenreId);
			params.set('page', String(nextPage));

			const res = await fetch(`/api/discover?${params.toString()}`);
			if (res.ok) {
				const result = await res.json();
				const newItems: UnifiedMedia[] = result.items ?? [];
				// Deduplicate against all existing items
				const existingIds = new Set(items.map((i) => i.sourceId));
				const unique = newItems.filter((i) => !existingIds.has(i.sourceId));
				extraItems = [...extraItems, ...unique];
				extraHasMore = result.hasMore ?? false;
				currentPage = nextPage;
			}
		} catch {
			// Silent failure -- user can scroll again to retry
		} finally {
			loading = false;
		}
	}

	async function requestItem(item: UnifiedMedia, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const key = item.id;
		requesting[key] = 'loading';
		try {
			const type = item.type === 'show' ? 'tv' : 'movie';
			const res = await fetch('/api/requests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId: item.serviceId, tmdbId: item.sourceId, type })
			});
			const body = await res.json();
			requesting[key] = body.ok ? 'done' : 'error';
		} catch {
			requesting[key] = 'error';
		}
	}

	function handleTabKeydown(e: KeyboardEvent, index: number) {
		let target = index;
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			target = (index + 1) % tabs.length;
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			target = (index - 1 + tabs.length) % tabs.length;
		} else if (e.key === 'Home') {
			e.preventDefault();
			target = 0;
		} else if (e.key === 'End') {
			e.preventDefault();
			target = tabs.length - 1;
		} else {
			return;
		}
		const tabEl = document.querySelector<HTMLButtonElement>(`[data-tab-index="${target}"]`);
		tabEl?.focus();
		tabEl?.click();
	}
</script>

<svelte:head>
	<title>Discover — Nexus</title>
	<meta name="description" content="Discover trending movies, TV shows, and upcoming releases" />
</svelte:head>

{#if data.missingCategories?.length}
	<SetupHint missing={data.missingCategories} />
{/if}

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6">
	<!-- Page header -->
	<div class="mb-6">
		<h1 class="text-display text-2xl font-bold sm:text-3xl">Discover</h1>
		<p class="mt-1 text-sm text-[var(--color-muted)]">Explore trending and upcoming titles across your services.</p>
	</div>

	<!-- Tab bar -->
	<div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div
			class="scrollbar-none flex gap-1 overflow-x-auto rounded-xl bg-[var(--color-surface)] p-1"
			role="tablist"
			aria-label="Discover categories"
		>
			{#each tabs as tab, i (tab.id)}
				<button
					role="tab"
					id="tab-{tab.id}"
					aria-selected={activeTab === tab.id}
					aria-controls="tabpanel-discover"
					tabindex={activeTab === tab.id ? 0 : -1}
					data-tab-index={i}
					class="whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-all {activeTab === tab.id
						? 'bg-[var(--color-accent)] text-[var(--color-void)] shadow-sm'
						: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
					onclick={() => switchTab(tab.id)}
					onkeydown={(e) => handleTabKeydown(e, i)}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<!-- Genre filter -->
		{#if showGenreFilter && genres.length > 0}
			<div class="flex items-center gap-2">
				<label for="genre-select" class="text-xs text-[var(--color-muted)]">Genre</label>
				<select
					id="genre-select"
					class="rounded-lg border border-cream/[0.08] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-cream)] transition-colors focus:border-[var(--color-accent)] focus:outline-none"
					value={selectedGenreId}
					onchange={(e) => selectGenre(e.currentTarget.value)}
				>
					<option value="">All Genres</option>
					{#each genres as genre (genre.id)}
						<option value={String(genre.id)}>{genre.name}</option>
					{/each}
				</select>
			</div>
		{/if}
	</div>

	<!-- Results grid -->
	<div
		id="tabpanel-discover"
		role="tabpanel"
		aria-labelledby="tab-{activeTab}"
	>
		{#if items.length === 0 && !loading}
			<div class="flex flex-col items-center justify-center py-24 text-center">
				<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="11" cy="11" r="8"/>
						<path d="M21 21l-4.35-4.35"/>
					</svg>
				</div>
				<p class="font-medium text-[var(--color-cream)]">Nothing to discover</p>
				<p class="mt-1 text-sm text-[var(--color-muted)]">Connect a service like Overseerr to populate discover results.</p>
				<a href="/settings/accounts" class="mt-4 rounded-xl border border-[var(--color-accent)]/30 px-4 py-2 text-sm font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/10">Connect a Service</a>
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
				{#each items as item, i (item.sourceId + '-' + i)}
					<div class="discover-card group relative">
						<!-- Rating badge -->
						{#if item.rating}
							<div class="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent)] backdrop-blur-sm">
								<svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9 3 10.5l.5-3.5L1 4.5 4.5 4z"/></svg>
								{item.rating.toFixed(1)}
							</div>
						{/if}

						<!-- Availability badge -->
						{#if item.status === 'available'}
							<div class="absolute bottom-[calc(2.75rem+0.5rem)] left-2 z-10">
								<span class="rounded-md bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">In Library</span>
							</div>
						{:else if item.status === 'requested'}
							<div class="absolute bottom-[calc(2.75rem+0.5rem)] left-2 z-10">
								<span class="rounded-md bg-blue-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">Requested</span>
							</div>
						{:else if item.serviceType === 'overseerr'}
							{@const reqState = requesting[item.id] ?? 'idle'}
							<div class="absolute bottom-[calc(2.75rem+0.5rem)] left-2 z-10">
								{#if reqState === 'done'}
									<span class="rounded-md bg-blue-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">Requested</span>
								{:else if reqState === 'loading'}
									<span class="rounded-md bg-[var(--color-accent)]/80 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-void)] backdrop-blur-sm">
										Requesting...
									</span>
								{:else if reqState === 'error'}
									<span class="rounded-md bg-red-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">Failed</span>
								{:else}
									<button
										class="rounded-md bg-[var(--color-accent)]/90 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-void)] backdrop-blur-sm transition-colors hover:bg-[var(--color-accent)]"
										onclick={(e) => requestItem(item, e)}
									>
										Request
									</button>
								{/if}
							</div>
						{/if}

						<MediaCard {item} />

						<!-- Extra metadata below card -->
						<div class="mt-[-0.25rem] px-0.5">
							{#if item.genres?.length}
								<p class="truncate text-[10px] text-[var(--color-muted)]">
									{#if item.year}<span>{item.year}</span><span class="opacity-40"> &middot; </span>{/if}{item.genres[0]}
								</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<!-- Infinite scroll sentinel -->
			<div use:observeSentinel class="flex items-center justify-center py-8" aria-hidden="true">
				{#if loading}
					<div class="flex items-center gap-2 text-sm text-[var(--color-muted)]">
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="10" opacity="0.25"/>
							<path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
						</svg>
						Loading more...
					</div>
				{:else if !hasMore && items.length > 0}
					<p class="text-xs text-[var(--color-muted)]">You've reached the end.</p>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.discover-card {
		position: relative;
	}

	select {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%238a8a9a' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.6rem center;
		padding-right: 1.8rem;
	}
</style>

<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { goto } from '$app/navigation';
	import { page as pageStore } from '$app/state';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import MediaRow from '$lib/components/MediaRow.svelte';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';
	import HeroSection from '$lib/components/HeroSection.svelte';

	let { data }: { data: PageData } = $props();

	const sortOptions = [
		{ id: 'title', label: 'Title' },
		{ id: 'year', label: 'Year' },
		{ id: 'rating', label: 'Rating' },
		{ id: 'added', label: 'Recently Added' }
	];

	function pickHero(items: UnifiedMedia[]): UnifiedMedia | null {
		return items.find((i) => i.backdrop && i.description) ?? items.find((i) => i.backdrop) ?? null;
	}

	// Server-side search: typing updates the URL (?q=…) with a debounce, which
	// re-runs the loader. No more client-side slice-of-200 filter.
	// svelte-ignore state_referenced_locally
	let queryInput = $state(data.q ?? '');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	function syncUrl(nextQuery: string, nextPage = 1) {
		const url = new URL(pageStore.url);
		if (nextQuery) url.searchParams.set('q', nextQuery);
		else url.searchParams.delete('q');
		if (nextPage > 1) url.searchParams.set('page', String(nextPage));
		else url.searchParams.delete('page');
		goto(url, { keepFocus: true, replaceState: true, noScroll: true });
	}

	function onQueryInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => syncUrl(queryInput.trim(), 1), 300);
	}

	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));
	const hasPrev = $derived(data.page > 1);
	const hasNext = $derived(data.page < totalPages);

	function gotoPage(p: number) {
		syncUrl(queryInput.trim(), p);
	}

	function formatDuration(secs?: number) {
		if (!secs) return null;
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	// Card hover trailer preview
	let hoverItem: UnifiedMedia | null = $state(null);
	let hoverTimeout: ReturnType<typeof setTimeout> | null = $state(null);
	let hoverTrailerVideo: string | null = $state(null);
	let hoverTrailerAudio: string | null = $state(null);

	function onCardHover(item: UnifiedMedia) {
		if (hoverTimeout) clearTimeout(hoverTimeout);
		hoverTimeout = setTimeout(async () => {
			hoverItem = item;
			try {
				const res = await fetch(`/api/media/${item.sourceId}/trailer?service=${item.serviceId}`);
				if (res.ok) {
					const data = await res.json();
					hoverTrailerVideo = data.trailer?.video ?? null;
					hoverTrailerAudio = data.trailer?.audio ?? null;
				}
			} catch { /* silent */ }
		}, 2500);
	}

	function onCardHoverEnd() {
		if (hoverTimeout) clearTimeout(hoverTimeout);
		hoverTimeout = null;
		setTimeout(() => {
			if (!hoverTimeout) {
				hoverItem = null;
				hoverTrailerVideo = null;
				hoverTrailerAudio = null;
			}
		}, 500);
	}
</script>

<svelte:head>
	<title>TV Shows — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-10 pb-10">
	<!-- Hero (streamed from Overseerr trending) -->
	{#await data.trendingTV}
		{#if data.hasOverseerr}
			<div class="mx-3 mt-4 rounded-2xl border border-[rgba(240,235,227,0.08)] bg-[var(--color-surface)]/70 px-5 py-4 text-sm text-[var(--color-muted)] sm:mx-4 lg:mx-6">
				Loading trending shows...
			</div>
		{/if}
	{:then trendingTV}
		{@const hero = pickHero(trendingTV)}
		{#if hero}
			<HeroSection
				mode="browse"
				backdrop={hoverItem?.backdrop ?? hero.backdrop}
				trailerUrl={hoverTrailerVideo}
				trailerAudioUrl={hoverTrailerAudio}
			>
				<div class="flex h-full items-end p-4 pb-5 sm:p-6 sm:pb-8 md:p-8 md:pb-10">
					<div class="max-w-xl">
						<div class="mb-3 flex flex-wrap items-center gap-2">
							<ServiceBadge type={hero.serviceType} />
							{#if hero.year}<span class="text-xs font-medium text-cream/50">{hero.year}</span>{/if}
							{#if hero.duration}
								<span class="text-xs text-cream/30">·</span>
								<span class="text-xs font-medium text-cream/50">{formatDuration(hero.duration)}</span>
							{/if}
							{#if hero.rating}
								<span class="text-xs text-cream/30">·</span>
								<span class="flex items-center gap-0.5 text-xs font-medium text-[var(--color-accent)]">
									<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9 3 10.5l.5-3.5L1 4.5 4.5 4z"/></svg>
									{hero.rating.toFixed(1)}
								</span>
							{/if}
						</div>
						<h1 class="text-display text-2xl font-bold leading-tight drop-shadow-2xl sm:text-3xl md:text-4xl">{hero.title}</h1>
						{#if hero.genres?.length}
							<div class="mt-2 flex flex-wrap gap-1.5">
								{#each hero.genres.slice(0, 3) as genre (genre)}
									<span class="rounded-full border border-cream/20 px-2 py-0.5 text-[10px] font-medium text-cream/70">{genre}</span>
								{/each}
							</div>
						{/if}
						{#if hero.description}
							<p class="mt-3 line-clamp-2 max-w-lg text-sm leading-relaxed text-cream/70 sm:line-clamp-3">{hero.description}</p>
						{/if}
						<div class="mt-4 flex items-center gap-3">
							<a
								href="/media/{hero.type}/{hero.sourceId}?service={hero.serviceId}"
								class="flex items-center gap-2 rounded-xl border border-cream/20 bg-cream/10 px-5 py-2.5 text-sm font-semibold text-cream backdrop-blur-sm transition-all hover:bg-cream/20 active:scale-95"
							>More Info</a>
						</div>
					</div>
					<span class="ml-auto hidden select-none text-[clamp(2rem,6vw,5rem)] font-black tracking-tight text-cream/[0.03] sm:block">SHOWS</span>
				</div>
			</HeroSection>
		{/if}
	{:catch}
		{#if data.hasOverseerr}
			<div class="mx-3 mt-4 rounded-2xl border border-[rgba(240,235,227,0.08)] bg-[var(--color-surface)]/70 px-5 py-4 text-sm text-[var(--color-muted)] sm:mx-4 lg:mx-6">
				Trending shows are unavailable right now.
			</div>
		{/if}
	{/await}

	<!-- In Your Library -->
	<div class="px-3 sm:px-4 lg:px-6">
		<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
			<div>
				<h2 class="text-display text-lg font-semibold">In Your Library</h2>
				<p class="mt-0.5 text-xs text-[var(--color-muted)]">
					{data.total} show{data.total === 1 ? '' : 's'} in your collection
				</p>
			</div>
			<div class="flex items-center gap-2 sm:ml-auto">
				<span class="text-xs text-[var(--color-muted)]">Sort by</span>
				<div class="flex gap-1 overflow-x-auto rounded-lg bg-[var(--color-surface)] p-1 scrollbar-none">
					{#each sortOptions as s (s.id)}
						<a
							href="/shows?sort={s.id}{queryInput.trim() ? `&q=${encodeURIComponent(queryInput.trim())}` : ''}"
							class="rounded-md px-2.5 py-1 text-xs font-medium transition-all {data.sortBy === s.id
								? 'bg-[var(--color-raised)] text-[var(--color-cream)]'
								: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
						>{s.label}</a>
					{/each}
				</div>
			</div>
			<input
				bind:value={queryInput}
				oninput={onQueryInput}
				class="input w-full text-sm sm:w-48"
				placeholder="Search shows..."
			/>
		</div>

		{#if data.libraryItems.length === 0}
			<div class="flex flex-col items-center justify-center py-24 text-center">
				<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 20h8M12 18v2" />
					</svg>
				</div>
				<p class="font-medium">No shows found</p>
				<p class="mt-1 text-sm text-[var(--color-muted)]">
					{data.libraryItems.length === 0
						? data.hasLibraryService
							? 'Your TV library is empty, still syncing, or your media service is unavailable right now.'
							: 'Connect a media service to populate your library.'
						: 'Try adjusting your filters.'}
				</p>
				{#if data.libraryItems.length === 0 && !data.hasLibraryService}
					<a href="/settings/accounts" class="btn btn-primary mt-4 text-sm">Connect a Service</a>
				{/if}
			</div>
		{:else}
			<div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4">
				{#each data.libraryItems as item (item.id)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						onmouseenter={() => onCardHover(item)}
						onmouseleave={onCardHoverEnd}
					>
						<MediaCard {item} />
					</div>
				{/each}
			</div>

			<!-- Pagination -->
			{#if totalPages > 1}
				<div class="mt-6 flex items-center justify-center gap-3 text-sm">
					<button
						class="btn px-3 py-1.5 text-xs disabled:opacity-40"
						disabled={!hasPrev}
						onclick={() => gotoPage(data.page - 1)}
					>Prev</button>
					<span class="text-[var(--color-muted)]">Page {data.page} of {totalPages}</span>
					<button
						class="btn px-3 py-1.5 text-xs disabled:opacity-40"
						disabled={!hasNext}
						onclick={() => gotoPage(data.page + 1)}
					>Next</button>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Popular TV Shows row (streamed from Overseerr) -->
	{#await data.popularTV}
		{#if data.hasOverseerr}
			<div class="px-3 text-sm text-[var(--color-muted)] sm:px-4 lg:px-6">Loading popular shows...</div>
		{/if}
	{:then popularTV}
		{#if popularTV.length > 0}
			<MediaRow row={{ id: 'popular-tv', title: 'Popular TV Shows', subtitle: 'Series everyone is watching', items: popularTV }} />
		{/if}
	{:catch}
		{#if data.hasOverseerr}
			<div class="px-3 text-sm text-[var(--color-muted)] sm:px-4 lg:px-6">Popular shows are unavailable right now.</div>
		{/if}
	{/await}
</div>

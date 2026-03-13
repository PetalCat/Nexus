<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia, DashboardRow } from '$lib/adapters/types';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import MediaRow from '$lib/components/MediaRow.svelte';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';

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

	// Client-side search filter
	let localQuery = $state('');
	const filtered = $derived(
		localQuery
			? data.libraryItems.filter((i: UnifiedMedia) =>
					i.title.toLowerCase().includes(localQuery.toLowerCase())
				)
			: data.libraryItems
	);

	function formatDuration(secs?: number) {
		if (!secs) return null;
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}
</script>

<svelte:head>
	<title>Movies — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-10 pb-10">
	<!-- Hero (streamed from Overseerr trending — renders when ready) -->
	{#await data.trendingMovies then trendingMovies}
		{@const h = pickHero(trendingMovies)}
		{#if h}
			<div
				class="relative mx-2 mt-2 overflow-hidden rounded-xl sm:mx-4 sm:mt-4 sm:rounded-2xl"
				style="height: clamp(240px, 42vh, 480px); box-shadow: 0 24px 80px rgba(0,0,0,0.6)"
			>
				{#if h.backdrop}
					<img
						src={h.backdrop}
						alt={h.title}
						class="absolute inset-0 h-full w-full object-cover"
					/>
				{:else}
					<div
						class="absolute inset-0"
						style="background: linear-gradient(135deg, var(--color-raised) 0%, var(--color-deep) 60%, var(--color-base) 100%)"
					>
						<div
							class="absolute inset-0 opacity-20"
							style="background: radial-gradient(ellipse at 30% 50%, var(--color-accent) 0%, transparent 60%)"
						></div>
					</div>
				{/if}

				<div
					class="absolute inset-0"
					style="background: linear-gradient(to top, var(--color-void) 0%, rgba(13,11,10,0.65) 35%, rgba(13,11,10,0.1) 70%, transparent 100%)"
				></div>
				<div
					class="absolute inset-0"
					style="background: linear-gradient(to right, rgba(13,11,10,0.85) 0%, rgba(13,11,10,0.4) 40%, transparent 70%)"
				></div>

				<div
					class="absolute bottom-0 left-0 right-0 flex items-end p-4 pb-5 sm:p-6 sm:pb-8 md:p-8 md:pb-10"
				>
					<div class="max-w-xl">
						<div class="mb-3 flex flex-wrap items-center gap-2">
							<ServiceBadge type={h.serviceType} />
							{#if h.year}<span class="text-xs font-medium text-white/50">{h.year}</span>{/if}
							{#if h.duration}
								<span class="text-xs text-white/30">·</span>
								<span class="text-xs font-medium text-white/50">{formatDuration(h.duration)}</span>
							{/if}
							{#if h.rating}
								<span class="text-xs text-white/30">·</span>
								<span class="flex items-center gap-0.5 text-xs font-medium text-[var(--color-accent)]">
									<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9 3 10.5l.5-3.5L1 4.5 4.5 4z"/></svg>
									{h.rating.toFixed(1)}
								</span>
							{/if}
						</div>
						<h1 class="text-display text-2xl font-bold leading-tight drop-shadow-2xl sm:text-3xl md:text-4xl">{h.title}</h1>
						{#if h.genres?.length}
							<div class="mt-2 flex flex-wrap gap-1.5">
								{#each h.genres.slice(0, 3) as genre}
									<span class="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-medium text-white/70">{genre}</span>
								{/each}
							</div>
						{/if}
						{#if h.description}
							<p class="mt-3 line-clamp-2 max-w-lg text-sm leading-relaxed text-white/70 sm:line-clamp-3">{h.description}</p>
						{/if}
						<div class="mt-4 flex items-center gap-3">
							<a
								href="/media/{h.type}/{h.sourceId}?service={h.serviceId}"
								class="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20 active:scale-95"
							>More Info</a>
						</div>
					</div>
				</div>
			</div>
		{/if}
	{/await}

	<!-- In Your Library -->
	<div class="px-3 sm:px-4 lg:px-6">
		<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
			<div>
				<h2 class="text-display text-lg font-semibold">In Your Library</h2>
				<p class="mt-0.5 text-xs text-[var(--color-muted)]">
					{data.total} movie{data.total === 1 ? '' : 's'} in your collection
				</p>
			</div>

			<!-- Sort -->
			<div class="flex items-center gap-2 sm:ml-auto">
				<span class="text-xs text-[var(--color-muted)]">Sort by</span>
				<div
					class="flex gap-1 overflow-x-auto rounded-lg bg-[var(--color-surface)] p-1 scrollbar-none"
				>
					{#each sortOptions as s}
						<a
							href="/movies?sort={s.id}"
							class="rounded-md px-2.5 py-1 text-xs font-medium transition-all {data.sortBy ===
							s.id
								? 'bg-[var(--color-raised)] text-[var(--color-cream)]'
								: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
						>
							{s.label}
						</a>
					{/each}
				</div>
			</div>

			<!-- Quick search -->
			<input bind:value={localQuery} class="input w-full text-sm sm:w-48" placeholder="Filter..." />
		</div>

		{#if filtered.length === 0}
			<div class="flex flex-col items-center justify-center py-24 text-center">
				<div
					class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]"
				>
					<svg
						width="28"
						height="28"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect x="2" y="4" width="20" height="16" rx="2" />
						<path d="M2 8h20M7 4v4M12 4v4M17 4v4" />
					</svg>
				</div>
				<p class="font-medium">No movies found</p>
				<p class="mt-1 text-sm text-[var(--color-muted)]">
					{data.libraryItems.length === 0
						? 'Connect a media service to populate your library.'
						: 'Try adjusting your filters.'}
				</p>
				{#if data.libraryItems.length === 0}
					<a href="/settings/accounts" class="btn btn-primary mt-4 text-sm">Connect a Service</a>
				{/if}
			</div>
		{:else}
			<div
				class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4"
			>
				{#each filtered as item (item.id)}
					<MediaCard {item} />
				{/each}
			</div>
		{/if}
	</div>

	<!-- Popular Movies row (streamed from Overseerr) -->
	{#await data.popularMovies then popularMovies}
		{#if popularMovies.length > 0}
			<MediaRow row={{ id: 'popular-movies', title: 'Popular Movies', subtitle: 'Most watched movies this week', items: popularMovies }} />
		{/if}
	{/await}
</div>

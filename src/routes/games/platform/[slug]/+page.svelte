<script lang="ts">
	import type { PageData } from './$types';
	import MediaCard from '$lib/components/MediaCard.svelte';

	let { data }: { data: PageData } = $props();

	const sortOptions = [
		{ id: 'title', label: 'Title' },
		{ id: 'year', label: 'Year' },
		{ id: 'rating', label: 'Rating' },
		{ id: 'added', label: 'Recently Added' }
	];

	function buildSortUrl(sortId: string) {
		const params = new URLSearchParams();
		if (sortId !== 'title') params.set('sort', sortId);
		return `/games/platform/${data.platform.slug}${params.toString() ? '?' + params.toString() : ''}`;
	}
</script>

<svelte:head>
	<title>{data.platform.display_name} — Games — Nexus</title>
</svelte:head>

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">
	<!-- Hero -->
	<div class="mb-6 flex items-center gap-4">
		<a href="/games" class="text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
		</a>
		{#if data.platform.url_logo}
			<img src={data.platform.url_logo} alt="" class="h-10 w-10 rounded-lg object-contain" />
		{/if}
		<div>
			<h1 class="text-display text-2xl font-bold">{data.platform.display_name}</h1>
			<p class="text-sm text-[var(--color-muted)]">{data.total} games</p>
		</div>
	</div>

	<!-- Stats row -->
	<div class="mb-6 flex flex-wrap gap-3">
		<div class="stat-card">
			<span class="stat-value">{data.stats.totalGames}</span>
			<span class="stat-label">Games</span>
		</div>
		{#if data.stats.avgRating}
			<div class="stat-card">
				<span class="stat-value">{data.stats.avgRating}</span>
				<span class="stat-label">Avg Rating</span>
			</div>
		{/if}
		{#each data.stats.topGenres.slice(0, 3) as genre}
			<div class="stat-card">
				<span class="stat-value">{genre.count}</span>
				<span class="stat-label">{genre.name}</span>
			</div>
		{/each}
	</div>

	<!-- Sort -->
	<div class="mb-4 flex items-center gap-2 sm:mb-6">
		<span class="text-xs text-[var(--color-muted)]">Sort by</span>
		<div class="flex gap-1 overflow-x-auto rounded-lg bg-[var(--color-surface)] p-1 scrollbar-none">
			{#each sortOptions as s}
				<a
					href={buildSortUrl(s.id)}
					class="rounded-md px-2.5 py-1 text-xs font-medium transition-all {data.sortBy === s.id
						? 'bg-[var(--color-raised)] text-[var(--color-cream)]'
						: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
				>
					{s.label}
				</a>
			{/each}
		</div>
	</div>

	<!-- Game grid -->
	{#if data.items.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<p class="font-medium text-[var(--color-cream)]">No games found</p>
			<p class="mt-1 text-sm text-[var(--color-muted)]">No games available for this platform.</p>
		</div>
	{:else}
		<div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4">
			{#each data.items as item (item.id)}
				<MediaCard {item} />
			{/each}
		</div>
	{/if}
</div>

<style>
	.stat-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.75rem 1.25rem;
		border-radius: 0.75rem;
		background: var(--color-surface);
		border: 1px solid rgba(240,235,227,0.06);
	}
	.stat-value {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-cream);
	}
	.stat-label {
		font-size: 0.625rem;
		font-weight: 500;
		color: var(--color-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
</style>

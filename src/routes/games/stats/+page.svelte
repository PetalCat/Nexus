<script lang="ts">
	import type { PageData } from './$types';
	import StatCard from '$lib/components/games/StatCard.svelte';
	import MediaCard from '$lib/components/MediaCard.svelte';

	let { data }: { data: PageData } = $props();

	const statusColors: Record<string, string> = {
		playing: 'var(--color-accent)',
		finished: '#4dd9c0',
		completed: '#6bbd45',
		retired: '#f59e0b',
		wishlist: '#60a5fa',
		unset: 'var(--color-muted)'
	};

	const maxPlatformCount = $derived(
		data.platformBreakdown.length > 0 ? data.platformBreakdown[0].count : 1
	);

	const maxGenreCount = $derived(
		data.genreBreakdown.length > 0 ? data.genreBreakdown[0].count : 1
	);
</script>

<svelte:head>
	<title>Game Stats — Nexus</title>
</svelte:head>

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">
	<!-- Header -->
	<div class="mb-6 flex items-center gap-3">
		<a href="/games" class="text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
		</a>
		<h1 class="text-display text-2xl font-bold">Game Stats</h1>
	</div>

	<!-- Stat cards -->
	<div class="mb-8 flex flex-wrap gap-3">
		<StatCard label="Total Games" value={data.totalGames} />
		{#if data.avgRating}
			<StatCard label="Avg Rating" value={data.avgRating} />
		{/if}
		<StatCard label="Finished" value={data.finishedCount} subtitle="{data.completionRate}% completion" />
		<StatCard label="Platforms" value={data.platformBreakdown.length} />
		<StatCard label="Genres" value={data.genreBreakdown.length} />
	</div>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Platform distribution -->
		<section class="section-card">
			<h2 class="section-title">Platform Distribution</h2>
			<div class="space-y-2">
				{#each data.platformBreakdown as p}
					<a href="/games/platform/{p.slug}" class="bar-row group">
						<div class="bar-label">
							{#if p.logo}
								<img src={p.logo} alt="" class="h-4 w-4 rounded object-contain" />
							{/if}
							<span class="group-hover:text-[var(--color-cream)]">{p.name}</span>
						</div>
						<div class="bar-track">
							<div
								class="bar-fill"
								style="width: {(p.count / maxPlatformCount) * 100}%"
							></div>
						</div>
						<span class="bar-count">{p.count}</span>
					</a>
				{/each}
			</div>
		</section>

		<!-- Status distribution -->
		<section class="section-card">
			<h2 class="section-title">Status Breakdown</h2>
			<div class="space-y-2">
				{#each data.statusBreakdown as s}
					<div class="bar-row">
						<div class="bar-label">
							<div
								class="h-2.5 w-2.5 rounded-full"
								style="background: {statusColors[s.status] ?? 'var(--color-muted)'}"
							></div>
							<span class="capitalize">{s.status === 'unset' ? 'No Status' : s.status}</span>
						</div>
						<div class="bar-track">
							<div
								class="bar-fill"
								style="width: {(s.count / data.totalGames) * 100}%; background: {statusColors[s.status] ?? 'var(--color-muted)'}"
							></div>
						</div>
						<span class="bar-count">{s.count}</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- Genre breakdown -->
		<section class="section-card">
			<h2 class="section-title">Top Genres</h2>
			<div class="space-y-2">
				{#each data.genreBreakdown as g}
					<div class="bar-row">
						<span class="bar-label-text">{g.genre}</span>
						<div class="bar-track">
							<div
								class="bar-fill"
								style="width: {(g.count / maxGenreCount) * 100}%"
							></div>
						</div>
						<span class="bar-count">{g.count}</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- Top rated -->
		<section class="section-card">
			<h2 class="section-title">Top Rated</h2>
			<div class="space-y-1">
				{#each data.topRated as item, i (item.id)}
					{@const detailUrl = `/media/${item.type}/${item.sourceId}?service=${item.serviceId}`}
					<a href={detailUrl} class="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-surface)]">
						<span class="w-5 text-right text-xs font-bold text-[var(--color-muted)]">{i + 1}</span>
						{#if item.poster}
							<img src={item.poster} alt="" class="h-10 w-7 rounded object-cover flex-shrink-0" />
						{/if}
						<div class="flex-1 min-w-0">
							<p class="text-xs font-medium text-[var(--color-cream)] truncate">{item.title}</p>
							{#if item.metadata?.platform}
								<p class="text-[10px] text-[var(--color-muted)]">{item.metadata.platform}</p>
							{/if}
						</div>
						{#if item.rating}
							<div class="flex items-center gap-1 text-xs text-[var(--color-muted)]">
								<svg width="10" height="10" viewBox="0 0 24 24" fill="var(--color-accent)" stroke="none"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>
								{item.rating.toFixed(1)}
							</div>
						{/if}
					</a>
				{/each}
			</div>
		</section>
	</div>
</div>

<style>
	.section-card {
		background: var(--color-surface);
		border: 1px solid rgba(240,235,227,0.06);
		border-radius: 1rem;
		padding: 1.25rem;
	}
	.section-title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-cream);
		margin-bottom: 0.75rem;
	}
	.bar-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
	}
	.bar-label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-shrink: 0;
		width: 8rem;
		font-size: 0.6875rem;
		color: var(--color-muted);
		overflow: hidden;
	}
	.bar-label span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.15s;
	}
	.bar-label-text {
		flex-shrink: 0;
		width: 8rem;
		font-size: 0.6875rem;
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bar-track {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: rgba(240,235,227,0.04);
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		border-radius: 3px;
		background: var(--color-accent);
		transition: width 0.3s ease;
	}
	.bar-count {
		flex-shrink: 0;
		width: 2rem;
		text-align: right;
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--color-muted);
	}
</style>

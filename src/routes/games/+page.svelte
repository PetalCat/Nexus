<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import MediaCard from '$lib/components/MediaCard.svelte';

	let { data }: { data: PageData } = $props();

	const sortOptions = [
		{ id: 'title', label: 'Title' },
		{ id: 'year', label: 'Year' },
		{ id: 'rating', label: 'Rating' },
		{ id: 'added', label: 'Recently Added' }
	];

	let localQuery = $state('');
	const filtered = $derived(
		localQuery
			? data.items.filter((i: UnifiedMedia) => i.title.toLowerCase().includes(localQuery.toLowerCase()))
			: data.items
	);

	const statusColors: Record<string, string> = {
		playing: '#7c6cf8',
		finished: '#4dd9c0',
		completed: '#6bbd45',
		retired: '#f59e0b',
		wishlist: '#60a5fa'
	};

	function buildPlatformUrl(platformId: number | null) {
		const params = new URLSearchParams();
		if (data.sortBy !== 'title') params.set('sort', data.sortBy);
		if (platformId != null) params.set('platform', String(platformId));
		const qs = params.toString();
		return `/games${qs ? '?' + qs : ''}`;
	}

	function buildSortUrl(sortId: string) {
		const params = new URLSearchParams();
		if (sortId !== 'title') params.set('sort', sortId);
		if (data.selectedPlatform != null) params.set('platform', String(data.selectedPlatform));
		const qs = params.toString();
		return `/games${qs ? '?' + qs : ''}`;
	}
</script>

<svelte:head>
	<title>Games — Nexus</title>
</svelte:head>

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">
	<div class="mb-4 sm:mb-6">
		<h1 class="text-display text-2xl font-bold">Games</h1>
		<p class="mt-1 text-sm text-[var(--color-subtle)]">{data.total} items in your collection</p>
	</div>

	<!-- Platform filter bar -->
	{#if data.platforms.length > 0}
		<div class="platform-bar mb-4 sm:mb-5">
			<a
				href={buildPlatformUrl(null)}
				class="platform-pill"
				class:platform-pill--active={data.selectedPlatform == null}
			>
				All
			</a>
			{#each data.platforms.filter(p => p.rom_count > 0).sort((a, b) => b.rom_count - a.rom_count) as platform}
				<a
					href={buildPlatformUrl(platform.id)}
					class="platform-pill"
					class:platform-pill--active={data.selectedPlatform === platform.id}
				>
					{#if platform.url_logo}
						<img src={platform.url_logo} alt="" class="platform-logo" />
					{/if}
					{platform.display_name}
					<span class="platform-count">{platform.rom_count}</span>
				</a>
			{/each}
		</div>
	{/if}

	<!-- Filters bar -->
	<div class="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center">
		<!-- Sort -->
		<div class="flex items-center gap-2">
			<span class="text-xs text-[var(--color-muted)]">Sort by</span>
			<div class="flex gap-1 overflow-x-auto rounded-lg bg-[var(--color-surface)] p-1 scrollbar-none">
				{#each sortOptions as s}
					<a
						href={buildSortUrl(s.id)}
						class="rounded-md px-2.5 py-1 text-xs font-medium transition-all {data.sortBy === s.id
							? 'bg-[var(--color-raised)] text-[var(--color-text)]'
							: 'text-[var(--color-subtle)] hover:text-[var(--color-text)]'}"
					>
						{s.label}
					</a>
				{/each}
			</div>
		</div>

		<!-- Quick search -->
		<input
			bind:value={localQuery}
			class="input w-full text-sm sm:ml-auto sm:w-48"
			placeholder="Filter..."
		/>
	</div>

	{#if filtered.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<rect x="2" y="7" width="20" height="12" rx="3"/><path d="M8 11v4M6 13h4M15 12h2M15 14h2"/>
				</svg>
			</div>
			<p class="font-medium">No games found</p>
			<p class="mt-1 text-sm text-[var(--color-subtle)]">
				{data.items.length === 0 ? 'Connect RomM to see your game collection here.' : 'Try adjusting your search or filter.'}
			</p>
			{#if data.items.length === 0}
				<a href="/settings" class="btn btn-primary mt-4 text-sm">Connect a Service</a>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4">
			{#each filtered as item (item.id)}
				<div class="game-card-wrapper">
					<MediaCard {item} />
					{#if item.metadata?.userStatus}
						{@const status = item.metadata.userStatus as string}
						<div
							class="status-dot"
							title={status}
							style="background: {statusColors[status] ?? 'var(--color-muted)'}"
						></div>
					{/if}
					{#if item.metadata?.platform}
						<span class="platform-tag">{item.metadata.platform}</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Collections -->
	{#if data.collections.length > 0}
		<div class="mt-8">
			<h2 class="mb-4 text-lg font-bold text-[var(--color-text)]">Collections</h2>
			{#each data.collections as collection}
				{@const collectionItems = data.items.filter((i) => collection.romIds.includes(Number(i.sourceId)))}
				{#if collectionItems.length > 0}
					<div class="mb-6">
						<h3 class="mb-2 text-sm font-semibold text-[var(--color-subtle)]">{collection.name}</h3>
						<div class="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
							{#each collectionItems.slice(0, 12) as item (item.id)}
								<div class="w-[110px] flex-shrink-0 sm:w-[140px]">
									<MediaCard {item} />
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.platform-bar {
		display: flex;
		gap: 0.35rem;
		overflow-x: auto;
		padding-bottom: 0.25rem;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}
	.platform-bar::-webkit-scrollbar { display: none; }

	.platform-pill {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.75rem;
		border-radius: 100px;
		background: var(--color-surface);
		color: var(--color-subtle);
		font-size: 0.75rem;
		font-weight: 500;
		border: 1px solid var(--color-border);
		transition: all 0.2s ease;
		white-space: nowrap;
		text-decoration: none;
	}
	.platform-pill:hover {
		background: var(--color-raised);
		color: var(--color-text);
		border-color: var(--color-muted);
	}
	.platform-pill--active {
		background: var(--color-nebula);
		color: white;
		border-color: var(--color-nebula);
	}
	.platform-pill--active:hover {
		background: color-mix(in oklch, var(--color-nebula) 85%, white);
	}

	.platform-logo {
		width: 16px;
		height: 16px;
		object-fit: contain;
		border-radius: 2px;
	}

	.platform-count {
		font-size: 0.62rem;
		font-weight: 600;
		opacity: 0.6;
	}

	.game-card-wrapper {
		position: relative;
	}

	.status-dot {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1.5px solid rgba(0, 0, 0, 0.5);
		z-index: 5;
	}

	.platform-tag {
		display: block;
		margin-top: 0.15rem;
		font-size: 0.6rem;
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>

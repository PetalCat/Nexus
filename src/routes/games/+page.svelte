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
	let viewMode = $state<'grid' | 'list'>('grid');
	let showFavoritesOnly = $state(false);

	const inProgress = $derived(
		data.items.filter((i: UnifiedMedia) => i.metadata?.userStatus === 'playing' || (i.progress && i.progress > 0 && i.progress < 1))
	);

	const filtered = $derived.by(() => {
		let items = data.items;
		if (localQuery) {
			items = items.filter((i: UnifiedMedia) => i.title.toLowerCase().includes(localQuery.toLowerCase()));
		}
		if (showFavoritesOnly) {
			items = items.filter((i: UnifiedMedia) => i.metadata?.userStatus === 'favorite' || i.metadata?.is_favorited);
		}
		return items;
	});

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

	function formatLastPlayed(dateStr: string | undefined) {
		if (!dateStr) return null;
		const d = new Date(dateStr);
		const diff = Date.now() - d.getTime();
		const days = Math.floor(diff / 86400000);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 30) return `${days}d ago`;
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

	<!-- Continue Playing -->
	{#if inProgress.length > 0 && data.selectedPlatform == null && !localQuery}
		<section class="mb-6">
			<h2 class="mb-3 text-sm font-semibold text-[var(--color-subtle)]">Continue Playing</h2>
			<div class="continue-row">
				{#each inProgress.slice(0, 10) as item (item.id)}
					<div class="continue-card">
						<MediaCard {item} size="sm" />
						{#if item.metadata?.userStatus}
							{@const status = item.metadata.userStatus as string}
							<div
								class="status-dot"
								title={status}
								style="background: {statusColors[status] ?? 'var(--color-muted)'}"
							></div>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

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

		<!-- View toggle + Favorites -->
		<div class="flex items-center gap-2">
			<button
				class="view-toggle"
				class:view-toggle--active={showFavoritesOnly}
				onclick={() => (showFavoritesOnly = !showFavoritesOnly)}
				title="Show favorites only"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill={showFavoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
				</svg>
			</button>
			<div class="flex gap-0.5 rounded-lg bg-[var(--color-surface)] p-0.5">
				<button
					class="view-toggle"
					class:view-toggle--active={viewMode === 'grid'}
					onclick={() => (viewMode = 'grid')}
					title="Grid view"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
					</svg>
				</button>
				<button
					class="view-toggle"
					class:view-toggle--active={viewMode === 'list'}
					onclick={() => (viewMode = 'list')}
					title="List view"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
					</svg>
				</button>
			</div>
		</div>

		<!-- Quick search -->
		<div class="relative sm:ml-auto">
			<svg class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
			</svg>
			<input
				bind:value={localQuery}
				class="input w-full pl-8 text-sm sm:w-48"
				placeholder="Filter..."
			/>
			{#if localQuery}
				<button
					class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)] hover:text-[var(--color-text)]"
					onclick={() => (localQuery = '')}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
				</button>
			{/if}
		</div>
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
	{:else if viewMode === 'list'}
		<!-- List view -->
		<div class="list-view">
			{#each filtered as item (item.id)}
				{@const detailUrl = `/media/${item.type}/${item.sourceId}?service=${item.serviceId}`}
				<a href={detailUrl} class="list-row">
					<div class="list-thumb">
						{#if item.poster}
							<img src={item.poster} alt="" loading="lazy" />
						{:else}
							<div class="list-thumb-empty">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="12" rx="3"/></svg>
							</div>
						{/if}
						{#if item.metadata?.userStatus}
							{@const status = item.metadata.userStatus as string}
							<div class="list-status-dot" style="background: {statusColors[status] ?? 'var(--color-muted)'}"></div>
						{/if}
					</div>
					<span class="list-title">{item.title}</span>
					{#if item.metadata?.platform}
						<span class="list-badge hidden sm:inline">{item.metadata.platform}</span>
					{/if}
					{#if item.genres && item.genres.length > 0}
						<span class="list-genre hidden md:inline">{item.genres[0]}</span>
					{/if}
					{#if item.rating}
						<span class="list-rating hidden lg:flex">
							<svg width="11" height="11" viewBox="0 0 24 24" fill="var(--color-star)" stroke="none"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>
							{item.rating.toFixed(1)}
						</span>
					{/if}
					{#if item.progress != null && item.progress > 0}
						<div class="list-progress hidden sm:flex">
							<div class="list-progress-bar">
								<div class="list-progress-fill" style="width: {Math.round(item.progress * 100)}%"></div>
							</div>
							<span class="list-progress-pct">{Math.round(item.progress * 100)}%</span>
						</div>
					{/if}
					{#if item.metadata?.lastPlayed}
						<span class="list-last-played hidden lg:inline">{formatLastPlayed(item.metadata.lastPlayed as string)}</span>
					{/if}
				</a>
			{/each}
		</div>
	{:else}
		<!-- Grid view -->
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
	/* ── Continue Playing row ── */
	.continue-row {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}
	.continue-row::-webkit-scrollbar { display: none; }
	.continue-card {
		position: relative;
		flex-shrink: 0;
		width: 100px;
	}
	@media (min-width: 640px) { .continue-card { width: 120px; } }

	/* ── Platform bar ── */
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

	/* ── View toggles ── */
	.view-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem;
		border-radius: 0.5rem;
		color: var(--color-subtle);
		transition: all 0.15s;
	}
	.view-toggle:hover { color: var(--color-text); }
	.view-toggle--active {
		color: var(--color-nebula);
		background: var(--color-raised);
	}

	/* ── Grid card wrappers ── */
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

	/* ── List view ── */
	.list-view {
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		overflow: hidden;
	}
	.list-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		text-decoration: none;
		transition: background 0.15s;
		border-bottom: 1px solid var(--color-border-subtle);
	}
	.list-row:last-child { border-bottom: none; }
	.list-row:hover { background: var(--color-surface); }

	.list-thumb {
		position: relative;
		width: 40px;
		height: 54px;
		flex-shrink: 0;
		border-radius: 4px;
		overflow: hidden;
		background: var(--color-raised);
	}
	.list-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.list-thumb-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		color: var(--color-muted);
	}
	.list-status-dot {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		border: 1px solid rgba(0, 0, 0, 0.4);
	}

	.list-title {
		flex: 1;
		min-width: 0;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.list-badge {
		flex-shrink: 0;
		font-size: 0.625rem;
		font-weight: 500;
		padding: 0.15rem 0.5rem;
		border-radius: 100px;
		background: var(--color-surface);
		color: var(--color-subtle);
		border: 1px solid var(--color-border);
	}

	.list-genre {
		flex-shrink: 0;
		width: 7rem;
		font-size: 0.6875rem;
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.list-rating {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-subtle);
	}

	.list-progress {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 5rem;
	}
	.list-progress-bar {
		flex: 1;
		height: 4px;
		border-radius: 2px;
		background: var(--color-surface);
		overflow: hidden;
	}
	.list-progress-fill {
		height: 100%;
		border-radius: 2px;
		background: linear-gradient(90deg, var(--color-nebula), var(--color-pulsar));
	}
	.list-progress-pct {
		font-size: 0.6rem;
		color: var(--color-muted);
		width: 2rem;
		text-align: right;
	}

	.list-last-played {
		flex-shrink: 0;
		width: 5rem;
		font-size: 0.6875rem;
		color: var(--color-muted);
		text-align: right;
	}
</style>

<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import CollectionEditor from '$lib/components/games/CollectionEditor.svelte';
	import GameFilterPanel from '$lib/components/games/GameFilterPanel.svelte';
	import { invalidateAll, goto } from '$app/navigation';
	import { page } from '$app/stores';

	let { data }: { data: PageData } = $props();

	let editorOpen = $state(false);
	let editingCollection = $state<{ id: number; name: string; description?: string; romIds: number[] } | null>(null);
	let deletingId = $state<number | null>(null);

	function openNewCollection() {
		editingCollection = null;
		editorOpen = true;
	}

	function openEditCollection(c: { id: number; name: string; description?: string; romIds: number[] }) {
		editingCollection = c;
		editorOpen = true;
	}

	async function handleSave(detail: { id?: number; name: string; description: string; romIds: number[] }) {
		if (detail.id) {
			await fetch(`/api/games/collections/${detail.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: detail.name, description: detail.description })
			});
			// Sync ROM list
			const existing = data.collections.find((c) => c.id === detail.id);
			const existingRoms = new Set(existing?.romIds ?? []);
			const newRoms = new Set(detail.romIds);
			const toAdd = detail.romIds.filter((id) => !existingRoms.has(id));
			const toRemove = [...existingRoms].filter((id) => !newRoms.has(id));
			if (toAdd.length > 0) {
				await fetch(`/api/games/collections/${detail.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'add', romIds: toAdd })
				});
			}
			if (toRemove.length > 0) {
				await fetch(`/api/games/collections/${detail.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'remove', romIds: toRemove })
				});
			}
		} else {
			const res = await fetch('/api/games/collections', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: detail.name, description: detail.description })
			});
			if (res.ok && detail.romIds.length > 0) {
				const { collection } = await res.json();
				await fetch(`/api/games/collections/${collection.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'add', romIds: detail.romIds })
				});
			}
		}
		editorOpen = false;
		invalidateAll();
	}

	async function handleDelete(collectionId: number) {
		deletingId = collectionId;
		await fetch(`/api/games/collections/${collectionId}`, { method: 'DELETE' });
		deletingId = null;
		invalidateAll();
	}

	const sortOptions = [
		{ id: 'title', label: 'Title' },
		{ id: 'year', label: 'Year' },
		{ id: 'rating', label: 'Rating' },
		{ id: 'added', label: 'Recently Added' }
	];

	let localQuery = $state('');
	let viewMode = $state<'grid' | 'list'>('grid');
	let showFavoritesOnly = $state(false);
	let showFilterPanel = $state(false);

	interface Filters {
		genres: string[];
		statuses: string[];
		ratingMin: number | null;
		ratingMax: number | null;
		regions: string[];
		tags: string[];
	}

	function parseFiltersFromUrl(): Filters {
		const sp = $page.url.searchParams;
		return {
			genres: sp.get('genre')?.split(',').filter(Boolean) ?? [],
			statuses: sp.get('status')?.split(',').filter(Boolean) ?? [],
			ratingMin: sp.get('rating_min') ? Number(sp.get('rating_min')) : null,
			ratingMax: sp.get('rating_max') ? Number(sp.get('rating_max')) : null,
			regions: sp.get('region')?.split(',').filter(Boolean) ?? [],
			tags: sp.get('tags')?.split(',').filter(Boolean) ?? []
		};
	}

	let advancedFilters = $state<Filters>(parseFiltersFromUrl());

	const advancedFilterCount = $derived(
		advancedFilters.genres.length +
		advancedFilters.statuses.length +
		advancedFilters.regions.length +
		advancedFilters.tags.length +
		(advancedFilters.ratingMin != null ? 1 : 0) +
		(advancedFilters.ratingMax != null ? 1 : 0)
	);

	function handleFilterChange(f: Filters) {
		advancedFilters = f;
		const params = new URLSearchParams($page.url.searchParams);
		if (f.genres.length) params.set('genre', f.genres.join(','));
		else params.delete('genre');
		if (f.statuses.length) params.set('status', f.statuses.join(','));
		else params.delete('status');
		if (f.ratingMin != null) params.set('rating_min', String(f.ratingMin));
		else params.delete('rating_min');
		if (f.ratingMax != null) params.set('rating_max', String(f.ratingMax));
		else params.delete('rating_max');
		if (f.regions.length) params.set('region', f.regions.join(','));
		else params.delete('region');
		if (f.tags.length) params.set('tags', f.tags.join(','));
		else params.delete('tags');
		const qs = params.toString();
		goto(`/games${qs ? '?' + qs : ''}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

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
		const f = advancedFilters;
		if (f.genres.length) {
			items = items.filter((i: UnifiedMedia) => i.genres?.some((g) => f.genres.includes(g)));
		}
		if (f.statuses.length) {
			items = items.filter((i: UnifiedMedia) => f.statuses.includes((i.metadata?.userStatus as string) ?? ''));
		}
		if (f.ratingMin != null) {
			items = items.filter((i: UnifiedMedia) => (i.rating ?? 0) >= f.ratingMin!);
		}
		if (f.ratingMax != null) {
			items = items.filter((i: UnifiedMedia) => (i.rating ?? 10) <= f.ratingMax!);
		}
		if (f.regions.length) {
			items = items.filter((i: UnifiedMedia) => {
				const r = i.metadata?.regions;
				const regions: string[] = Array.isArray(r) ? r : typeof r === 'string' && r ? [r] : [];
				return regions.some((reg) => f.regions.includes(reg));
			});
		}
		if (f.tags.length) {
			items = items.filter((i: UnifiedMedia) => {
				const t = i.metadata?.tags;
				const tags: string[] = Array.isArray(t) ? t : typeof t === 'string' && t ? [t] : [];
				return tags.some((tag) => f.tags.includes(tag));
			});
		}
		return items;
	});

	const statusColors: Record<string, string> = {
		playing: 'var(--color-accent)',
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
	<div class="mb-4 flex items-start justify-between sm:mb-6">
		<div>
			<h1 class="text-display text-2xl font-bold">Games</h1>
			<p class="mt-1 text-sm text-[var(--color-muted)]">{data.total} items in your collection</p>
		</div>
		<a
			href="/games/stats"
			class="flex items-center gap-1.5 rounded-full bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-all hover:bg-[var(--color-raised)] hover:text-[var(--color-cream)] border border-[rgba(240,235,227,0.06)]"
		>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
			Stats
		</a>
	</div>

	<!-- Continue Playing -->
	{#if inProgress.length > 0 && data.selectedPlatform == null && !localQuery}
		<section class="mb-6">
			<h2 class="mb-3 text-sm font-semibold text-[var(--color-muted)]">Continue Playing</h2>
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
					href="/games/platform/{platform.slug}"
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
							? 'bg-[var(--color-raised)] text-[var(--color-cream)]'
							: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
					>
						{s.label}
					</a>
				{/each}
			</div>
		</div>

		<!-- View toggle + Favorites + Filter -->
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
			<button
				class="filter-toggle"
				class:filter-toggle--active={showFilterPanel || advancedFilterCount > 0}
				onclick={() => (showFilterPanel = !showFilterPanel)}
				title="Advanced filters"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
				</svg>
				{#if advancedFilterCount > 0}
					<span class="filter-badge">{advancedFilterCount}</span>
				{/if}
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
					class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)] hover:text-[var(--color-cream)]"
					onclick={() => (localQuery = '')}
					aria-label="Clear filter"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
				</button>
			{/if}
		</div>
	</div>

	{#if showFilterPanel}
		<div class="mb-4 sm:mb-6">
			<GameFilterPanel
				items={data.items}
				filters={advancedFilters}
				onfilterchange={handleFilterChange}
			/>
		</div>
	{/if}

	{#if filtered.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<rect x="2" y="7" width="20" height="12" rx="3"/><path d="M8 11v4M6 13h4M15 12h2M15 14h2"/>
				</svg>
			</div>
			<p class="font-medium">No games found</p>
			<p class="mt-1 text-sm text-[var(--color-muted)]">
				{data.items.length === 0 ? 'Connect RomM to see your game collection here.' : 'Try adjusting your search or filter.'}
			</p>
			{#if data.items.length === 0}
				<a href="/settings/accounts" class="btn btn-primary mt-4 text-sm">Connect a Service</a>
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
							<svg width="11" height="11" viewBox="0 0 24 24" fill="var(--color-accent)" stroke="none"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>
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
	<div class="mt-8">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-lg font-bold text-[var(--color-cream)]">Collections</h2>
			<button
				class="flex items-center gap-1.5 rounded-full bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-all hover:bg-[var(--color-raised)] hover:text-[var(--color-cream)] border border-[rgba(240,235,227,0.06)]"
				onclick={openNewCollection}
			>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				New Collection
			</button>
		</div>
		{#if data.collections.length === 0}
			<p class="text-sm text-[var(--color-muted)]">No collections yet. Create one to organize your games.</p>
		{/if}
		{#each data.collections as collection (collection.id)}
			{@const collectionItems = data.items.filter((i) => collection.romIds.includes(Number(i.sourceId)))}
			<div class="mb-6">
				<div class="mb-2 flex items-center gap-2">
					<h3 class="text-sm font-semibold text-[var(--color-muted)]">{collection.name}</h3>
					<span class="text-[10px] text-[var(--color-muted)] opacity-60">{collectionItems.length} games</span>
					<div class="ml-auto flex items-center gap-1">
						<button
							class="rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-cream)]"
							title="Edit collection"
							onclick={() => openEditCollection(collection)}
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
						</button>
						<button
							class="rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
							title="Delete collection"
							disabled={deletingId === collection.id}
							onclick={() => handleDelete(collection.id)}
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
						</button>
					</div>
				</div>
				{#if collectionItems.length > 0}
					<div class="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
						{#each collectionItems.slice(0, 12) as item (item.id)}
							<div class="w-[110px] flex-shrink-0 sm:w-[140px]">
								<MediaCard {item} />
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-xs text-[var(--color-muted)] opacity-60">No games in this collection yet.</p>
				{/if}
			</div>
		{/each}
	</div>
</div>

<CollectionEditor
	open={editorOpen}
	collection={editingCollection}
	allGames={data.items}
	onclose={() => { editorOpen = false; }}
	onsave={handleSave}
/>

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
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 500;
		border: 1px solid rgba(240,235,227,0.06);
		transition: all 0.2s ease;
		white-space: nowrap;
		text-decoration: none;
	}
	.platform-pill:hover {
		background: var(--color-raised);
		color: var(--color-cream);
		border-color: var(--color-muted);
	}
	.platform-pill--active {
		background: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
	}
	.platform-pill--active:hover {
		background: color-mix(in oklch, var(--color-accent) 85%, white);
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
		color: var(--color-muted);
		transition: all 0.15s;
	}
	.view-toggle:hover { color: var(--color-cream); }
	.view-toggle--active {
		color: var(--color-accent);
		background: var(--color-raised);
	}

	.filter-toggle {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem;
		border-radius: 0.5rem;
		color: var(--color-muted);
		transition: all 0.15s;
	}
	.filter-toggle:hover { color: var(--color-cream); }
	.filter-toggle--active {
		color: var(--color-accent);
		background: var(--color-raised);
	}
	.filter-badge {
		position: absolute;
		top: -3px;
		right: -3px;
		min-width: 14px;
		height: 14px;
		border-radius: 100px;
		background: var(--color-accent);
		color: var(--color-void);
		font-size: 0.55rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 3px;
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
		border: 1px solid rgba(240,235,227,0.06);
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
		border-bottom: 1px solid rgba(240,235,227,0.04);
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
		color: var(--color-cream);
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
		color: var(--color-muted);
		border: 1px solid rgba(240,235,227,0.06);
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
		color: var(--color-muted);
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
		background: linear-gradient(90deg, var(--color-accent), var(--color-steel));
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

<script lang="ts">
	import type { PageData } from './$types';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import { Bookmark, X } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	const filterOptions = [
		{ id: 'all', label: 'All' },
		{ id: 'movie', label: 'Movies' },
		{ id: 'show', label: 'Shows' },
		{ id: 'music', label: 'Music' },
		{ id: 'book', label: 'Books' },
		{ id: 'game', label: 'Games' }
	];

	const sortOptions = [
		{ id: 'added', label: 'Date Added' },
		{ id: 'title', label: 'Title' },
		{ id: 'year', label: 'Year' }
	];

	let activeFilter = $state('all');
	let activeSort = $state('added');

	$effect(() => {
		activeFilter = data.filterType ?? 'all';
		activeSort = data.sortBy ?? 'added';
	});
	let removingId = $state<string | null>(null);

	const filtered = $derived.by(() => {
		let items = [...data.items];
		if (activeFilter !== 'all') {
			items = items.filter((i) => i.mediaType === activeFilter);
		}
		if (activeSort === 'title') {
			items.sort((a, b) => a.mediaTitle.localeCompare(b.mediaTitle));
		}
		return items;
	});

	async function removeFromWatchlist(favoriteId: string) {
		removingId = favoriteId;
		try {
			const res = await fetch(`/api/user/watchlist?id=${encodeURIComponent(favoriteId)}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				data.items = data.items.filter((i) => i.id !== favoriteId);
			}
		} finally {
			removingId = null;
		}
	}
</script>

<svelte:head>
	<title>Watchlist — Nexus</title>
</svelte:head>

<div class="px-3 sm:px-4 lg:px-6">
	<!-- Filters and sort -->
	<div class="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
		<!-- Filter chips -->
		<div class="flex gap-1.5 overflow-x-auto scrollbar-none">
			{#each filterOptions as f (f.id)}
				<button
					onclick={() => (activeFilter = f.id)}
					class="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200
						{activeFilter === f.id
						? 'bg-accent/15 text-accent ring-1 ring-accent/20'
						: 'bg-surface/50 text-muted hover:text-cream'}"
				>
					{f.label}
				</button>
			{/each}
		</div>

		<!-- Sort -->
		<div class="flex items-center gap-2 sm:ml-auto">
			<span class="text-xs text-faint">Sort</span>
			<div class="flex gap-1 rounded-lg bg-surface/50 p-0.5">
				{#each sortOptions as s (s.id)}
					<button
						onclick={() => (activeSort = s.id)}
						class="rounded-md px-2.5 py-1 text-xs font-medium transition-all
							{activeSort === s.id
							? 'bg-raised text-cream'
							: 'text-muted hover:text-cream'}"
					>
						{s.label}
					</button>
				{/each}
			</div>
		</div>
	</div>

	{#if filtered.length === 0}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div
				class="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-surface text-muted"
				style="box-shadow: 0 0 40px rgba(212, 162, 83, 0.06);"
			>
				<Bookmark size={32} strokeWidth={1.2} />
			</div>
			<p class="font-display text-lg font-semibold text-cream">Your watchlist is empty</p>
			<p class="mt-2 max-w-xs text-sm text-muted">
				Browse your library and bookmark items you want to watch, read, or play later.
			</p>
			<a href="/" class="btn btn-primary mt-5 text-sm">Browse Library</a>
		</div>
	{:else}
		<!-- Poster grid -->
		<div
			class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4"
		>
			{#each filtered as item, i (item.id)}
				<div
					class="group relative"
					style="animation: stagger-reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; animation-delay: {Math.min(
						i * 30,
						600
					)}ms; opacity: 0;"
				>
					<MediaCard
						item={{
							id: `${item.mediaId}:${item.serviceId}`,
							sourceId: item.mediaId,
							serviceId: item.serviceId,
							type: item.mediaType as import('$lib/adapters/types').MediaType,
							title: item.mediaTitle,
							poster: item.mediaPoster ?? undefined,
							serviceType: 'jellyfin'
						}}
					/>
					<!-- Remove button overlay -->
					<button
						onclick={() => removeFromWatchlist(item.id)}
						class="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-void/80 text-muted opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-warm/80 hover:text-cream group-hover:opacity-100"
						aria-label="Remove from watchlist"
						disabled={removingId === item.id}
					>
						<X size={14} strokeWidth={2} />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';

	let { data }: { data: PageData } = $props();

	// Split results: library items vs requestable (Overseerr, not yet available)
	const libraryItems = $derived(
		data.items.filter((i) => i.serviceType !== 'overseerr' || i.status === 'available')
	);
	const requestableItems = $derived(
		data.items.filter((i) => i.serviceType === 'overseerr' && i.status !== 'available')
	);

	const typeGroups = $derived(() => {
		const groups: Record<string, typeof data.items> = {};
		for (const item of libraryItems) {
			const key = item.type;
			groups[key] ??= [];
			groups[key].push(item);
		}
		return groups;
	});

	const typeLabels: Record<string, string> = {
		movie: 'Movies',
		show: 'TV Shows',
		episode: 'Episodes',
		book: 'Books',
		game: 'Games',
		music: 'Music',
		album: 'Albums',
		live: 'Live TV'
	};

	// Request state per item
	let requesting = $state<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});

	async function requestItem(item: UnifiedMedia) {
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
</script>

<svelte:head>
	<title>{data.query ? `"${data.query}" — Nexus` : 'Search — Nexus'}</title>
</svelte:head>

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6">
	{#if !data.query}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"/>
					<path d="M21 21l-4.35-4.35"/>
				</svg>
			</div>
			<h2 class="text-display text-xl font-semibold">Search everything</h2>
			<p class="mt-2 text-sm text-[var(--color-muted)]">Movies, shows, books, games, music — all in one place.</p>
		</div>
	{:else if data.items.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"/>
					<path d="M21 21l-4.35-4.35"/>
				</svg>
			</div>
			<h2 class="text-display text-xl font-semibold">No results for "{data.query}"</h2>
			<p class="mt-2 text-sm text-[var(--color-muted)]">Try a different search term or check your connected services.</p>
		</div>
	{:else}
		<div class="mb-4 flex items-center gap-2">
			<span class="text-sm text-[var(--color-muted)]">
				{data.total} result{data.total !== 1 ? 's' : ''} for
			</span>
			<span class="text-sm font-medium">"{data.query}"</span>
		</div>

		<div class="flex flex-col gap-10">
			<!-- Library results, grouped by type -->
			{#if libraryItems.length > 0}
				{#each Object.entries(typeGroups()) as [type, items]}
					<section>
						<h2 class="text-display mb-4 text-base font-semibold">{typeLabels[type] ?? type}</h2>
						<div class="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4">
							{#each items as item, i (`${item.id}-${i}`)}
								<div class="flex flex-col gap-2">
									<MediaCard {item} />
									<ServiceBadge type={item.serviceType} name={item.serviceType} />
								</div>
							{/each}
						</div>
					</section>
				{/each}
			{/if}

			<!-- Requestable items from Overseerr -->
			{#if requestableItems.length > 0}
				<section>
					<div class="mb-4">
						<h2 class="text-display text-base font-semibold">Not in your library?</h2>
						<p class="mt-0.5 text-sm text-[var(--color-muted)]">Found via Overseerr — request any of these to add them.</p>
					</div>
					<div class="flex flex-col gap-2">
						{#each requestableItems as item, i (`${item.id}-req-${i}`)}
							{@const reqState = requesting[item.id] ?? 'idle'}
							<div class="card-raised flex items-center gap-4 px-4 py-3">
								<!-- Poster -->
								<div class="relative flex-shrink-0 overflow-hidden rounded-md" style="width:44px;height:66px;background:var(--color-surface)">
									{#if item.poster}
										<img src={item.poster} alt={item.title} class="h-full w-full object-cover" loading="lazy" />
									{:else}
										<div class="flex h-full w-full items-center justify-center text-[var(--color-muted)]">
											<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 21l7-7 4 4 3-3 4 4"/></svg>
										</div>
									{/if}
								</div>

								<!-- Info -->
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-medium text-sm truncate">{item.title}</span>
										{#if item.year}<span class="text-xs text-[var(--color-muted)] flex-shrink-0">{item.year}</span>{/if}
									</div>
									<div class="mt-1 flex items-center gap-2 flex-wrap">
										<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)] capitalize">{item.type === 'show' ? 'TV Show' : item.type}</span>
										{#if item.rating}
											<span class="text-[10px] text-[var(--color-accent)] flex items-center gap-0.5">
												<svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9 3 10.5l.5-3.5L1 4.5 4.5 4z"/></svg>
												{item.rating.toFixed(1)}
											</span>
										{/if}
										{#if item.description}
											<span class="text-[10px] text-[var(--color-muted)] line-clamp-1 flex-1 min-w-0 hidden sm:block">{item.description}</span>
										{/if}
									</div>
								</div>

								<!-- Request button -->
								<div class="flex-shrink-0">
									{#if reqState === 'done'}
										<span class="flex items-center gap-1 text-xs font-medium text-[var(--color-steel)]">
											<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 6l3 3 5-5"/></svg>
											Requested
										</span>
									{:else if reqState === 'error'}
										<span class="text-xs text-[var(--color-warm)]">Failed</span>
									{:else}
										<button
											class="btn btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 border border-[var(--color-accent)]/30 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
											onclick={() => requestItem(item)}
											disabled={reqState === 'loading'}
										>
											{#if reqState === 'loading'}
												<svg class="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
											{:else}
												<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 1v10M1 6h10"/></svg>
											{/if}
											{reqState === 'loading' ? 'Requesting…' : 'Request'}
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</section>
			{:else if libraryItems.length === 0}
				<!-- Nothing at all found -->
				<div class="flex flex-col items-center justify-center py-16 text-center">
					<p class="text-sm text-[var(--color-muted)]">Nothing found in your library or connected services.</p>
				</div>
			{/if}
		</div>
	{/if}
</div>

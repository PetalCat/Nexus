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
</script>

<svelte:head>
	<title>Music — Nexus</title>
</svelte:head>

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">
	<div class="mb-4 sm:mb-6">
		<h1 class="text-display text-2xl font-bold">Music</h1>
		<p class="mt-1 text-sm text-[var(--color-subtle)]">{data.total} items in your collection</p>
	</div>

	<!-- Filters bar -->
	<div class="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center">
		<!-- Sort -->
		<div class="flex items-center gap-2">
			<span class="text-xs text-[var(--color-muted)]">Sort by</span>
			<div class="flex gap-1 overflow-x-auto rounded-lg bg-[var(--color-surface)] p-1 scrollbar-none">
				{#each sortOptions as s}
					<a
						href="/music?sort={s.id}"
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
					<circle cx="9" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M12 18V8l9-2v2"/>
				</svg>
			</div>
			<p class="font-medium">No music found</p>
			<p class="mt-1 text-sm text-[var(--color-subtle)]">
				{data.items.length === 0 ? 'Connect Jellyfin with a music library to see your collection here.' : 'Try adjusting your search.'}
			</p>
			{#if data.items.length === 0}
				<a href="/settings" class="btn btn-primary mt-4 text-sm">Connect a Service</a>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4">
			{#each filtered as item (item.id)}
				<MediaCard {item} />
			{/each}
		</div>
	{/if}
</div>

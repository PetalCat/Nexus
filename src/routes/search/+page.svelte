<script lang="ts">
	import type { PageData } from './$types';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';

	let { data }: { data: PageData } = $props();

	const typeGroups = $derived(() => {
		const groups: Record<string, typeof data.items> = {};
		for (const item of data.items) {
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
</script>

<svelte:head>
	<title>{data.query ? `"${data.query}" — Nexus` : 'Search — Nexus'}</title>
</svelte:head>

<div class="px-6 py-6">
	<div class="mb-6 max-w-xl">
		<SearchBar />
	</div>

	{#if !data.query}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-4 text-5xl opacity-20">⌕</div>
			<h2 class="text-display text-xl font-semibold">Search everything</h2>
			<p class="mt-2 text-sm text-[var(--color-subtle)]">Movies, shows, books, games, music — all in one place.</p>
		</div>
	{:else if data.items.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-4 text-5xl opacity-20">∅</div>
			<h2 class="text-display text-xl font-semibold">No results for "{data.query}"</h2>
			<p class="mt-2 text-sm text-[var(--color-subtle)]">Try a different search term or check your connected services.</p>
		</div>
	{:else}
		<div class="mb-4 flex items-center gap-2">
			<span class="text-sm text-[var(--color-subtle)]">
				{data.total} result{data.total !== 1 ? 's' : ''} for
			</span>
			<span class="text-sm font-medium">"{data.query}"</span>
		</div>

		<div class="flex flex-col gap-10">
			{#each Object.entries(typeGroups()) as [type, items]}
				<section>
					<h2 class="text-display mb-4 text-base font-semibold">{typeLabels[type] ?? type}</h2>
					<div class="flex flex-wrap gap-4">
						{#each items as item (item.id)}
							<div class="flex flex-col gap-2">
								<MediaCard {item} />
								<ServiceBadge type={item.serviceType} name={item.serviceType} />
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</div>

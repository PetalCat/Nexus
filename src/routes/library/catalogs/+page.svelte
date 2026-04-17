<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { FolderOpen } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	let query = $state('');

	const filtered = $derived(
		query
			? data.collections.filter((c: UnifiedMedia) =>
					c.title.toLowerCase().includes(query.toLowerCase())
				)
			: data.collections
	);
</script>

<svelte:head>
	<title>Collections — Nexus</title>
</svelte:head>

<div class="px-3 pb-10 pt-4 sm:px-4 lg:px-6">
	<!-- Header -->
	<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-display text-2xl font-bold">Collections</h1>
			<p class="mt-1 text-sm text-[var(--color-muted)]">
				{data.collections.length} collection{data.collections.length === 1 ? '' : 's'}
			</p>
		</div>
		<input
			bind:value={query}
			class="input w-full text-sm sm:w-56"
			placeholder="Filter collections..."
			aria-label="Filter collections"
		/>
	</div>

	<!-- Grid -->
	{#if filtered.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div
				class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]"
			>
				<FolderOpen size={28} strokeWidth={1.2} />
			</div>
			<p class="font-medium text-[var(--color-cream)]">
				{data.collections.length === 0 ? 'No collections found' : 'No matches'}
			</p>
			<p class="mt-1 text-sm text-[var(--color-muted)]">
				{data.collections.length === 0
					? 'Collections from your media services will appear here.'
					: 'Try adjusting your search.'}
			</p>
		</div>
	{:else}
		<div
			class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5"
		>
			{#each filtered as collection, i (collection.id)}
				{@const movieCount = (collection.metadata?.movieCount as number) ?? 0}
				<a
					href="/library/catalogs/{collection.sourceId}"
					class="group relative overflow-hidden rounded-xl border border-[rgba(240,235,227,0.04)] bg-[var(--color-surface)] transition-all duration-300 hover:border-[rgba(240,235,227,0.1)] hover:shadow-lg hover:shadow-black/20"
					style="animation: stagger-reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; animation-delay: {i * 40}ms; opacity: 0;"
					aria-label="{collection.title}, {movieCount} movie{movieCount === 1 ? '' : 's'}"
				>
					<!-- Poster -->
					<div class="aspect-[2/3] overflow-hidden bg-[var(--color-raised)]">
						{#if collection.poster}
							<img
								src={collection.poster}
								alt=""
								class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
								loading="lazy"
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center" style="background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-raised) 100%);">
								<FolderOpen size={32} strokeWidth={1} class="text-[var(--color-muted)]" style="opacity: 0.3;" />
							</div>
						{/if}

						<!-- Movie count badge -->
						{#if movieCount > 0}
							<div class="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-cream)] backdrop-blur-sm">
								{movieCount} movie{movieCount === 1 ? '' : 's'}
							</div>
						{/if}
					</div>

					<!-- Title -->
					<div class="p-2.5">
						<h3 class="line-clamp-2 text-sm font-semibold leading-tight text-[var(--color-cream)] transition-colors duration-200 group-hover:text-[var(--color-accent)]">
							{collection.title}
						</h3>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

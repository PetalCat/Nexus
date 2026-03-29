<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import { ArrowLeft, Film } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	const available = $derived(
		data.movies.filter((m: UnifiedMedia) => m.status === 'available').length
	);
	const missing = $derived(data.movies.length - available);
</script>

<svelte:head>
	<title>{data.collection?.items?.[0]?.title ?? 'Collection'} — Nexus</title>
</svelte:head>

{#if !data.collection}
	<div class="flex flex-col items-center justify-center px-3 py-24 text-center sm:px-4 lg:px-6">
		<div
			class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]"
		>
			<Film size={28} strokeWidth={1.2} />
		</div>
		<p class="text-lg font-semibold text-[var(--color-cream)]">Collection not found</p>
		<p class="mt-1 text-sm text-[var(--color-muted)]">This collection may have been removed or is unavailable.</p>
		<a
			href="/collections"
			class="mt-5 flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
		>
			<ArrowLeft size={14} strokeWidth={2} />
			Back to Collections
		</a>
	</div>
{:else}
	{@const firstItem = data.movies[0]}
	{@const backdrop = firstItem?.backdrop ?? data.movies.find((m: UnifiedMedia) => m.backdrop)?.backdrop}
	{@const collectionTitle = (data.collection as Record<string, unknown>).title as string | undefined ?? firstItem?.title ?? 'Collection'}

	<div class="pb-10">
		<!-- Hero -->
		<div class="relative mb-8 overflow-hidden" style="min-height: 260px;">
			{#if backdrop}
				<img
					src={backdrop}
					alt=""
					class="absolute inset-0 h-full w-full object-cover"
					style="filter: brightness(0.35) saturate(0.8);"
				/>
			{/if}
			<div
				class="absolute inset-0"
				style="background: linear-gradient(to top, var(--color-bg) 0%, transparent 50%), linear-gradient(to right, var(--color-bg) 0%, transparent 40%);"
			></div>
			{#if !backdrop}
				<div class="absolute inset-0" style="background: linear-gradient(135deg, #14141f 0%, #1c1c2e 50%, #14141f 100%);"></div>
			{/if}

			<div class="relative flex min-h-[260px] flex-col justify-end px-3 pb-6 pt-16 sm:px-4 lg:px-6">
				<a
					href="/collections"
					class="mb-4 flex w-fit items-center gap-1.5 rounded-lg bg-black/40 px-3 py-1.5 text-xs font-medium text-[var(--color-cream)]/70 backdrop-blur-sm transition-colors hover:text-[var(--color-cream)]"
					aria-label="Back to collections"
				>
					<ArrowLeft size={14} strokeWidth={2} />
					Collections
				</a>
				<h1 class="text-display text-2xl font-bold leading-tight drop-shadow-2xl sm:text-3xl md:text-4xl">
					{collectionTitle}
				</h1>
				<p class="mt-2 text-sm text-[var(--color-cream)]/60">
					{data.movies.length} movie{data.movies.length === 1 ? '' : 's'}
					{#if available > 0}
						<span class="text-[var(--color-cream)]/30 mx-1">&middot;</span>
						<span class="text-emerald-400">{available} available</span>
					{/if}
					{#if missing > 0}
						<span class="text-[var(--color-cream)]/30 mx-1">&middot;</span>
						<span class="text-amber-400">{missing} missing</span>
					{/if}
				</p>
			</div>
		</div>

		<!-- Movie Grid -->
		<div class="px-3 sm:px-4 lg:px-6">
			{#if data.movies.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-center">
					<p class="text-sm text-[var(--color-muted)]">No movies in this collection.</p>
				</div>
			{:else}
				<div
					class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4"
				>
					{#each data.movies as movie (movie.id)}
						<div class="relative">
							<MediaCard item={movie} />
							<!-- Availability overlay -->
							{#if movie.status === 'available'}
								<div
									class="pointer-events-none absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/90 text-white"
									title="Available"
								>
									<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
										<path d="M2 6l3 3 5-5" />
									</svg>
								</div>
							{:else if movie.status === 'missing'}
								<div
									class="pointer-events-none absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/90 text-white text-[10px] font-bold"
									title="Missing"
								>
									+
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import MediaCard from '$lib/components/MediaCard.svelte';

	let { data }: { data: PageData } = $props();

	function progressLabel(progress: number | undefined) {
		if (!progress) return '';
		const pct = Math.round(progress * 100);
		return `${pct}%`;
	}
</script>

<svelte:head>
	<title>Activity — Nexus</title>
</svelte:head>

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">
	<div class="mb-6 sm:mb-8">
		<h1 class="text-display text-2xl font-bold">Activity</h1>
		<p class="mt-1 text-sm text-[var(--color-muted)]">Your watch history and progress across all services.</p>
	</div>

	{#if data.continueWatching.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
					<circle cx="12" cy="12" r="3"/>
				</svg>
			</div>
			<p class="font-medium">No activity yet</p>
			<p class="mt-1 text-sm text-[var(--color-muted)]">Start watching something and your progress will appear here.</p>
			<a href="/" class="btn btn-primary mt-4 text-sm">Go to Home</a>
		</div>
	{:else}
		<section>
			<h2 class="mb-4 text-base font-semibold">Continue Watching</h2>
			<div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4">
				{#each data.continueWatching as item (item.id)}
					<div class="relative">
						<MediaCard {item} />
						{#if item.progress}
							<div class="absolute bottom-10 left-2 right-2 h-1 overflow-hidden rounded-full bg-white/20">
								<div
									class="h-full rounded-full bg-[var(--color-accent)]"
									style="width: {Math.round((item.progress ?? 0) * 100)}%"
								></div>
							</div>
							<span class="absolute bottom-[52px] right-2 text-[10px] font-mono text-white/70">
								{progressLabel(item.progress)}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

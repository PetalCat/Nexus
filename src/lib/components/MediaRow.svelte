<script lang="ts">
	import type { DashboardRow } from '$lib/adapters/types';
	import MediaCard from './MediaCard.svelte';

	interface Props {
		row: DashboardRow;
	}

	let { row }: Props = $props();

	let scrollEl: HTMLDivElement | undefined = $state();
	let canScrollLeft = $state(false);
	let canScrollRight = $state(true);

	function scroll(dir: -1 | 1) {
		if (!scrollEl) return;
		const scrollAmount = scrollEl.clientWidth * 0.75;
		scrollEl.scrollBy({ left: dir * scrollAmount, behavior: 'smooth' });
	}

	function updateScrollState() {
		if (!scrollEl) return;
		canScrollLeft = scrollEl.scrollLeft > 2;
		canScrollRight = scrollEl.scrollLeft < scrollEl.scrollWidth - scrollEl.clientWidth - 2;
	}
</script>

<section class="flex flex-col gap-3">
	<div class="flex items-start justify-between px-4 sm:px-6">
		<div class="flex flex-col gap-0.5">
			<h2 class="text-display text-base font-semibold tracking-tight">{row.title}</h2>
			{#if row.subtitle}
				<p class="text-xs text-[var(--color-subtle)]">{row.subtitle}</p>
			{/if}
		</div>
		<div class="flex gap-0.5">
			<button
				class="btn-icon rounded-md p-1.5 transition-opacity {canScrollLeft ? 'opacity-60 hover:opacity-100' : 'opacity-20 pointer-events-none'}"
				onclick={() => scroll(-1)}
				aria-label="Scroll left"
				disabled={!canScrollLeft}
			>
				<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M10 12L6 8l4-4" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
			<button
				class="btn-icon rounded-md p-1.5 transition-opacity {canScrollRight ? 'opacity-60 hover:opacity-100' : 'opacity-20 pointer-events-none'}"
				onclick={() => scroll(1)}
				aria-label="Scroll right"
				disabled={!canScrollRight}
			>
				<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
		</div>
	</div>

	<div
		class="media-row px-4 sm:px-6"
		bind:this={scrollEl}
		onscroll={updateScrollState}
	>
		{#each row.items as item (item.id)}
			<div class="w-[8.5rem] sm:w-[10rem] md:w-[11rem]">
				<MediaCard {item} />
			</div>
		{/each}
	</div>
</section>

<script lang="ts">
	import type { DashboardRow } from '$lib/adapters/types';
	import MediaCard from './MediaCard.svelte';

	interface Props {
		row: DashboardRow;
	}

	let { row }: Props = $props();

	let scrollEl: HTMLDivElement | undefined = $state();

	function scroll(dir: -1 | 1) {
		if (!scrollEl) return;
		scrollEl.scrollBy({ left: dir * 320, behavior: 'smooth' });
	}
</script>

<section class="flex flex-col gap-3">
	<div class="flex items-center justify-between px-6">
		<h2 class="text-display text-base font-semibold tracking-tight">{row.title}</h2>
		<div class="flex gap-1">
			<button class="btn-icon" onclick={() => scroll(-1)} aria-label="Scroll left">
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M10 12L6 8l4-4" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
			<button class="btn-icon" onclick={() => scroll(1)} aria-label="Scroll right">
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
		</div>
	</div>

	<div class="media-row px-6" bind:this={scrollEl}>
		{#each row.items as item (item.id)}
			<MediaCard {item} />
		{/each}
	</div>
</section>

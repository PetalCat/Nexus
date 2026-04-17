<script lang="ts">
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import type { UnifiedMedia } from '$lib/types/media-ui';
	import type { UnifiedMedia as AdapterMedia } from '$lib/adapters/types';
	import MediaCard from '$lib/components/MediaCard.svelte';

	interface Props {
		title: string;
		items: UnifiedMedia[];
		showProgress?: boolean;
		showBadge?: boolean;
		cardSize?: 'sm' | 'md' | 'lg' | 'xl';
		forceAspect?: 'portrait' | 'square' | 'video' | null;
		onitemclick?: (media: UnifiedMedia) => void;
	}

	// Props kept for backward API compat — only `cardSize` is threaded through
	// to the canonical MediaCard. `showProgress`, `showBadge`, `forceAspect`,
	// and `onitemclick` are no-ops after the consolidation on #31.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let { title, items, cardSize = 'md' }: Props = $props();

	let scrollEl: HTMLDivElement | undefined = $state();
	let canScrollLeft = $state(false);
	let canScrollRight = $state(true);

	function updateScrollState() {
		if (!scrollEl) return;
		canScrollLeft = scrollEl.scrollLeft > 8;
		canScrollRight = scrollEl.scrollLeft < scrollEl.scrollWidth - scrollEl.clientWidth - 8;
	}

	function scroll(dir: 'left' | 'right') {
		if (!scrollEl) return;
		const amount = scrollEl.clientWidth * 0.65;
		scrollEl.scrollBy({
			left: dir === 'left' ? -amount : amount,
			behavior: 'smooth'
		});
	}
</script>

{#if items.length > 0}
	<section class="group/row relative" aria-label="{title} media row">
		<!-- Section header with gold accent -->
		<div class="mb-4 flex items-center gap-3 sm:mb-5 sm:gap-4">
			<div class="flex min-w-0 items-center gap-2 sm:gap-3">
				<div class="h-[18px] w-[3px] shrink-0 rounded-full bg-gradient-to-b from-accent to-accent-dim" aria-hidden="true"></div>
				<h2 class="truncate font-display text-lg font-bold tracking-wide text-cream/90 sm:text-xl">
					{title}
				</h2>
			</div>
			<div class="hidden h-px flex-1 bg-gradient-to-r from-cream/[0.04] to-transparent sm:block" aria-hidden="true"></div>

			<!-- Arrow controls in header -->
			<div class="hidden items-center gap-1 sm:flex">
				<button
					onclick={() => scroll('left')}
					disabled={!canScrollLeft}
					class="rounded-lg p-1.5 text-faint transition-all duration-200 hover:bg-cream/[0.05] hover:text-cream disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-faint"
					aria-label="Scroll {title} left"
				>
					<ChevronLeft size={16} strokeWidth={1.5} />
				</button>
				<button
					onclick={() => scroll('right')}
					disabled={!canScrollRight}
					class="rounded-lg p-1.5 text-faint transition-all duration-200 hover:bg-cream/[0.05] hover:text-cream disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-faint"
					aria-label="Scroll {title} right"
				>
					<ChevronRight size={16} strokeWidth={1.5} />
				</button>
			</div>
		</div>

		<div class="relative -mx-2">
			<!-- Left fade -->
			{#if canScrollLeft}
				<div
					class="pointer-events-none absolute left-0 top-0 z-20 h-full w-16 bg-gradient-to-r from-nexus-void to-transparent"
					aria-hidden="true"
				></div>
			{/if}

			<!-- Scroll container -->
			<div
				bind:this={scrollEl}
				onscroll={updateScrollState}
				class="flex gap-3 overflow-x-auto px-2 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			>
				{#each items as media (media.id)}
					<MediaCard item={media as unknown as AdapterMedia} size={cardSize === 'xl' ? 'lg' : cardSize} />
				{/each}
			</div>

			<!-- Right fade -->
			{#if canScrollRight}
				<div
					class="pointer-events-none absolute right-0 top-0 z-20 h-full w-16 bg-gradient-to-l from-nexus-void to-transparent"
					aria-hidden="true"
				></div>
			{/if}
		</div>
	</section>
{/if}

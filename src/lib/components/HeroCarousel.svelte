<script lang="ts">
	import type { HeroItem } from '$lib/types/homepage';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';

	interface Props {
		items: HeroItem[];
		autoAdvanceMs?: number;
	}

	let { items, autoAdvanceMs = 8000 }: Props = $props();

	let currentIndex = $state(0);
	let paused = $state(false);

	let current = $derived(items[currentIndex]);
	let nextItem = $derived(items[(currentIndex + 1) % items.length]);

	function advance(dir: 1 | -1) {
		currentIndex = (currentIndex + dir + items.length) % items.length;
	}

	function goTo(index: number) {
		currentIndex = index;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			advance(-1);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			advance(1);
		}
	}

	// Auto-advance timer
	$effect(() => {
		if (paused || items.length <= 1) return;

		const interval = setInterval(() => {
			currentIndex = (currentIndex + 1) % items.length;
		}, autoAdvanceMs);

		return () => clearInterval(interval);
	});

	// Preload next backdrop image
	$effect(() => {
		if (nextItem?.backdrop) {
			const img = new Image();
			img.src = nextItem.backdrop;
		}
	});
</script>

{#if items.length > 0 && current}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
	<div
		class="hero-carousel relative mx-2 mt-2 overflow-hidden rounded-xl sm:mx-4 sm:mt-4 sm:rounded-2xl"
		style="height: clamp(260px, 45vh, 520px); box-shadow: 0 24px 80px rgba(0,0,0,0.7)"
		role="region"
		aria-roledescription="carousel"
		aria-label="Featured media"
		onmouseenter={() => (paused = true)}
		onmouseleave={() => (paused = false)}
		onfocusin={() => (paused = true)}
		onfocusout={() => (paused = false)}
		onkeydown={handleKeydown}
		tabindex="0"
	>
		<!-- Background image with fade transition -->
		{#key currentIndex}
			{#if current.backdrop}
				<img
					src={current.backdrop}
					alt={current.title}
					class="hero-fade absolute inset-0 h-full w-full object-cover"
					style="transform: scale(1.02)"
				/>
			{:else}
				<div class="hero-fade absolute inset-0" style="background: linear-gradient(135deg, var(--color-raised) 0%, var(--color-deep) 50%, var(--color-base) 100%)">
					<div class="absolute inset-0 opacity-20" style="background: radial-gradient(ellipse at 30% 50%, var(--color-accent) 0%, transparent 60%)"></div>
				</div>
			{/if}
		{/key}

		<!-- Gradient overlays -->
		<div class="absolute inset-0" style="background: linear-gradient(to top, var(--color-void) 0%, rgba(13,11,10,0.7) 35%, rgba(13,11,10,0.2) 60%, transparent 100%)"></div>
		<div class="absolute inset-0" style="background: linear-gradient(to right, rgba(13,11,10,0.85) 0%, rgba(13,11,10,0.4) 40%, transparent 70%)"></div>

		<!-- Dot indicators + arrows (top-right) -->
		{#if items.length > 1}
			<div class="absolute right-4 top-4 z-10 flex items-center gap-2 sm:right-6 sm:top-6">
				<button
					class="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white/70 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
					onclick={() => advance(-1)}
					aria-label="Previous slide"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
				</button>

				<div class="flex items-center gap-1.5" role="tablist" aria-label="Slide indicators">
					{#each items as _, i (i)}
						<button
							class="h-1.5 rounded-full transition-all duration-300 {i === currentIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}"
							role="tab"
							aria-selected={i === currentIndex}
							aria-label="Go to slide {i + 1}"
							onclick={() => goTo(i)}
						></button>
					{/each}
				</div>

				<button
					class="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white/70 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
					onclick={() => advance(1)}
					aria-label="Next slide"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
				</button>
			</div>
		{/if}

		<!-- Content with fade transition -->
		{#key currentIndex}
			<div class="hero-fade absolute bottom-0 left-0 right-0 flex items-end p-4 pb-5 sm:p-6 sm:pb-8 md:p-8 md:pb-10">
				<div class="max-w-2xl">
					<!-- Reason badge + metadata row -->
					<div class="flex items-center gap-2">
						{#if current.reason}
							<span class="inline-flex items-center rounded-full bg-[var(--color-accent)]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
								{current.reason}
							</span>
						{/if}
						<ServiceBadge type={current.serviceType} />
						{#if current.year}
							<span class="text-xs font-medium text-white/50">{current.year}</span>
						{/if}
						{#if current.runtime}
							<span class="text-xs text-white/30">&middot;</span>
							<span class="text-xs font-medium text-white/50">{current.runtime}</span>
						{/if}
						{#if current.rating}
							<span class="text-xs text-white/30">&middot;</span>
							<span class="flex items-center gap-0.5 text-xs font-medium text-[var(--color-accent)]">
								&#9733; {current.rating.toFixed(1)}
							</span>
						{/if}
					</div>

					<!-- Title -->
					<h2 class="text-display mt-2 text-2xl font-bold leading-[1.1] tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] sm:mt-3 sm:text-3xl md:text-4xl lg:text-5xl">
						{current.title}
					</h2>

					<!-- Genres -->
					{#if current.genres && current.genres.length > 0}
						<div class="mt-2 flex flex-wrap gap-1">
							{#each current.genres.slice(0, 3) as genre, i (genre)}
								<span class="text-xs font-medium text-white/40">{genre}</span>
								{#if i < Math.min(current.genres.length, 3) - 1}
									<span class="text-xs text-white/20">&middot;</span>
								{/if}
							{/each}
						</div>
					{/if}

					<!-- Overview -->
					{#if current.overview}
						<p class="mt-2 hidden text-sm leading-relaxed text-white/60 line-clamp-2 sm:block sm:max-w-lg sm:mt-3">
							{current.overview}
						</p>
					{/if}

					<!-- Action buttons -->
					<div class="mt-3 flex gap-2 sm:mt-5 sm:gap-3">
						{#if current.streamUrl}
							<a
								href="/media/{current.mediaType}/{current.sourceId}?service={current.serviceId}&play=1"
								class="btn btn-primary text-sm sm:text-base"
								style="padding: 0.5rem 1.25rem;"
							>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>
								Play
							</a>
						{/if}
						<a
							href="/media/{current.mediaType}/{current.sourceId}?service={current.serviceId}"
							class="btn btn-ghost text-sm sm:text-base"
							style="padding: 0.5rem 1.25rem; border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.8);"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
							More Info
						</a>
					</div>
				</div>
			</div>
		{/key}
	</div>
{/if}

<style>
	.hero-fade {
		animation: heroFadeIn 0.6s ease-out both;
	}

	@keyframes heroFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>

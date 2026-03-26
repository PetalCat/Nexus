<script lang="ts">
	import type { UnifiedMedia } from '$lib/types/media-ui';
	import ActionButton from './ActionButton.svelte';
	import MediaBadge from './MediaBadge.svelte';
	import { ChevronLeft, ChevronRight, Star, Pause, Play } from 'lucide-svelte';
	import { onMount } from 'svelte';

	interface Props {
		items: UnifiedMedia[];
	}

	let { items }: Props = $props();

	let currentIndex = $state(0);
	let isPaused = $state(false);
	let intervalId: ReturnType<typeof setInterval> | null = null;

	function next() {
		currentIndex = (currentIndex + 1) % items.length;
	}

	function prev() {
		currentIndex = (currentIndex - 1 + items.length) % items.length;
	}

	function goTo(index: number) {
		currentIndex = index;
		startAutoAdvance();
	}

	function startAutoAdvance() {
		stopAutoAdvance();
		intervalId = setInterval(() => {
			if (!isPaused) next();
		}, 8000);
	}

	function stopAutoAdvance() {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	}

	function togglePause() {
		isPaused = !isPaused;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') {
			prev();
			e.preventDefault();
		} else if (e.key === 'ArrowRight') {
			next();
			e.preventDefault();
		} else if (e.key === ' ' || e.key === 'Enter') {
			togglePause();
			e.preventDefault();
		}
	}

	onMount(() => {
		startAutoAdvance();
		return () => stopAutoAdvance();
	});

	const current = $derived(items[currentIndex]);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
<section
	class="nexus-grain group/carousel relative overflow-hidden"
	style="min-height: clamp(320px, 55vh, 720px);"
	onmouseenter={() => (isPaused = true)}
	onmouseleave={() => (isPaused = false)}
	onfocusin={() => (isPaused = true)}
	onfocusout={() => (isPaused = false)}
	onkeydown={handleKeydown}
	aria-label="Featured media carousel"
	aria-roledescription="carousel"
	tabindex="0"
>
	<!-- Background slides -->
	{#each items as item, i (item.id)}
		<div
			class="absolute inset-0 transition-opacity duration-[1.5s] ease-out"
			class:opacity-0={i !== currentIndex}
			class:opacity-100={i === currentIndex}
			class:z-10={i === currentIndex}
			class:z-0={i !== currentIndex}
			aria-hidden="true"
		>
			<img
				src={item.image}
				alt=""
				class="absolute inset-0 h-full w-full object-cover"
				class:animate-ken-burns={i === currentIndex}
			/>

			<!-- Cinematic overlay system -->
			<div class="absolute inset-0 bg-gradient-to-t from-nexus-void via-nexus-void/50 to-nexus-void/5"></div>
			<div class="absolute inset-0 bg-gradient-to-r from-nexus-void/95 via-nexus-void/40 to-transparent"></div>
			<div class="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,transparent_0%,transparent_50%,rgba(13,11,10,0.6)_100%)]"></div>
			<div class="absolute bottom-0 left-0 h-1/2 w-1/2 bg-[radial-gradient(ellipse_at_0%_100%,rgba(212,162,83,0.06)_0%,transparent_70%)]"></div>
		</div>
	{/each}

	<!-- Content overlay -->
	<div class="relative z-20 flex items-end" style="min-height: clamp(320px, 55vh, 720px);">
		{#key currentIndex}
			<div class="flex max-w-2xl flex-col gap-3 px-4 pb-16 sm:gap-5 sm:px-8 sm:pb-24 lg:px-12">
				<div class="animate-fade-in-up" style="animation-delay: 0s; opacity: 0">
					<MediaBadge type={current.type} size="md" />
				</div>

				<h2
					class="animate-fade-in-up nexus-title-glow font-display text-3xl font-black leading-[1.05] tracking-tight text-cream sm:text-4xl md:text-5xl lg:text-[3.5rem]"
					style="animation-delay: 0.1s; opacity: 0"
				>
					{current.title}
				</h2>

				{#if current.metadata?.year || current.metadata?.runtime || current.metadata?.genre || current.metadata?.rating}
					<div
						class="animate-fade-in-up nexus-text-glow flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm"
						style="animation-delay: 0.18s; opacity: 0"
					>
						{#if current.metadata.rating}
							<span class="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5">
								<Star size={12} class="fill-accent text-accent" />
								<span class="font-semibold text-accent">{current.metadata.rating}</span>
							</span>
						{/if}
						{#if current.metadata.year}
							<span class="text-cream/60">{current.metadata.year}</span>
						{/if}
						{#if current.metadata.runtime}
							<span class="text-cream/20" aria-hidden="true">&bull;</span>
							<span class="text-cream/60">{current.metadata.runtime}</span>
						{/if}
						{#if current.metadata.genre}
							<span class="text-cream/20" aria-hidden="true">&bull;</span>
							<span class="text-cream/60">{current.metadata.genre}</span>
						{/if}
						{#if current.metadata.artist}
							<span class="text-cream/20" aria-hidden="true">&bull;</span>
							<span class="text-cream/60">{current.metadata.artist}</span>
						{/if}
					</div>
				{/if}

				<p
					class="animate-fade-in-up nexus-text-glow line-clamp-2 max-w-lg font-body text-xs leading-relaxed text-cream/50 sm:text-sm lg:text-[15px]"
					style="animation-delay: 0.24s; opacity: 0"
				>
					{current.description}
				</p>

				<div
					class="animate-fade-in-up flex items-center gap-4 pt-2"
					style="animation-delay: 0.3s; opacity: 0"
				>
					{#if current.action}
						<ActionButton action={current.action} size="lg" />
					{/if}
					{#if current.progress && current.progress > 0}
						<div class="flex items-center gap-2">
							<div class="h-1 w-16 overflow-hidden rounded-full bg-cream/10">
								<div
									class="h-full rounded-full bg-accent/70"
									style="width: {current.progress * 100}%"
								></div>
							</div>
							<span class="nexus-text-glow text-xs text-cream/40">
								{Math.round(current.progress * 100)}%
							</span>
						</div>
					{/if}
				</div>
			</div>
		{/key}
	</div>

	<!-- Bottom glow line -->
	<div
		class="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-px animate-glow-pulse"
		style="background: linear-gradient(to right, transparent, rgba(212,162,83,0.3) 30%, rgba(212,162,83,0.3) 70%, transparent)"
		aria-hidden="true"
	></div>

	<!-- Navigation arrows -->
	<button
		onclick={prev}
		class="absolute left-4 top-1/2 z-30 -translate-y-1/2 rounded-full p-3 opacity-0 transition-all duration-300 hover:bg-cream/10 group-hover/carousel:opacity-100"
		style="background: rgba(13,11,10,0.5); backdrop-filter: blur(12px); border: 1px solid rgba(240,235,227,0.08);"
		aria-label="Previous slide"
	>
		<ChevronLeft size={20} class="text-cream/80" />
	</button>

	<button
		onclick={next}
		class="absolute right-4 top-1/2 z-30 -translate-y-1/2 rounded-full p-3 opacity-0 transition-all duration-300 hover:bg-cream/10 group-hover/carousel:opacity-100"
		style="background: rgba(13,11,10,0.5); backdrop-filter: blur(12px); border: 1px solid rgba(240,235,227,0.08);"
		aria-label="Next slide"
	>
		<ChevronRight size={20} class="text-cream/80" />
	</button>

	<!-- Bottom controls: dots + pause -->
	<div class="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3">
		<div class="flex items-center gap-2" role="tablist" aria-label="Carousel slides">
			{#each items as _, i}
				<button
					onclick={() => goTo(i)}
					class="relative overflow-hidden rounded-full transition-all duration-500 ease-out-expo {i === currentIndex
						? 'h-2 w-10 bg-cream/10'
						: 'h-2 w-2 bg-cream/20 hover:bg-cream/40'}"
					role="tab"
					aria-selected={i === currentIndex}
					aria-label="Slide {i + 1} of {items.length}: {items[i].title}"
				>
					{#if i === currentIndex}
						{#key currentIndex}
							<div
								class="absolute inset-0 origin-left rounded-full bg-accent animate-progress-fill"
								style:animation-play-state={isPaused ? 'paused' : 'running'}
							></div>
						{/key}
					{/if}
				</button>
			{/each}
		</div>

		<button
			onclick={togglePause}
			class="rounded-full p-1.5 text-cream/30 transition-colors hover:text-cream/60"
			aria-label={isPaused ? 'Resume carousel' : 'Pause carousel'}
		>
			{#if isPaused}
				<Play size={12} class="fill-current" />
			{:else}
				<Pause size={12} class="fill-current" />
			{/if}
		</button>
	</div>
</section>

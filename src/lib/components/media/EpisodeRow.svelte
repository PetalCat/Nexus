<script lang="ts">
	import type { Episode, SubtitleStatus } from '$lib/types/media-ui';
	import { Play, Check, Captions } from 'lucide-svelte';

	let {
		episode,
		index,
		isCurrent = false,
		onplay,
		subtitleStatus = null
	}: {
		episode: Episode;
		index: number;
		isCurrent?: boolean;
		onplay?: () => void;
		subtitleStatus?: SubtitleStatus | null;
	} = $props();

	const subsComplete = $derived(subtitleStatus ? subtitleStatus.missing.length === 0 : null);

	const watched = $derived(episode.progress === 1);
	const inProgress = $derived(episode.progress != null && episode.progress > 0 && episode.progress < 1);
	const progressPercent = $derived(Math.round((episode.progress ?? 0) * 100));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="group/episode flex flex-col cursor-pointer"
	onclick={() => onplay?.()}
	onkeydown={(e) => e.key === 'Enter' && onplay?.()}
	role="button"
	tabindex="0"
>
	<!-- Thumbnail -->
	<div class="relative aspect-video overflow-hidden rounded-lg {isCurrent ? 'ring-2 ring-steel/50' : ''}">
		{#if episode.image}
			<img
				src={episode.image}
				alt={episode.title}
				class="h-full w-full object-cover transition-transform duration-500 group-hover/episode:scale-105"
				loading="lazy"
			/>
		{:else}
			<div class="h-full w-full bg-cream/[0.04]"></div>
		{/if}

		<!-- Darken overlay on hover -->
		<div class="absolute inset-0 bg-black/0 transition-all duration-300 group-hover/episode:bg-black/40"></div>

		<!-- Play button -->
		<div class="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover/episode:opacity-100">
			<div class="flex h-11 w-11 items-center justify-center rounded-full bg-cream/20 backdrop-blur-md border border-cream/10 shadow-lg transition-transform duration-300 ease-out-back group-hover/episode:scale-100 scale-75">
				<Play size={18} strokeWidth={0} class="ml-0.5 fill-cream" />
			</div>
		</div>

		<!-- Watched badge -->
		{#if watched}
			<div class="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-steel/80 backdrop-blur-sm">
				<Check size={11} strokeWidth={2.5} class="text-cream" />
			</div>
		{/if}

		<!-- Progress bar -->
		{#if inProgress}
			<div class="absolute inset-x-0 bottom-0 h-[3px] bg-cream/10">
				<div
					class="h-full bg-gradient-to-r from-steel to-steel-light animate-progress-fill-fast origin-left"
					style="transform: scaleX(0)"
				></div>
			</div>
		{/if}

		<!-- CC badge -->
		{#if subtitleStatus}
			<div
				class="absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded {subsComplete ? 'bg-steel/70' : 'bg-accent/70'} backdrop-blur-sm"
				title={subsComplete ? 'All subtitles available' : `${subtitleStatus.missing.length} missing`}
			>
				<Captions size={11} strokeWidth={2} class="text-cream" />
			</div>
		{/if}
	</div>

	<!-- Info below thumbnail -->
	<div class="mt-2.5 flex flex-col gap-0.5 px-0.5">
		<p class="truncate text-sm font-medium {isCurrent ? 'text-steel-light' : 'text-cream/90 group-hover/episode:text-cream'}">
			<span class="text-faint tabular-nums">E{episode.episodeNumber}</span>
			<span class="text-faint/40 mx-1">&middot;</span>
			{episode.title}
		</p>
		<span class="text-xs text-faint">{episode.duration}</span>
	</div>
</div>

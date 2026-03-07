<script lang="ts">
	import { Star } from 'lucide-svelte';
	import type { UnifiedMedia } from '$lib/types/media-ui';

	interface Props {
		media: UnifiedMedia;
		onclick?: () => void;
	}

	let { media, onclick }: Props = $props();

	const progressPercent = $derived(Math.round((media.progress ?? 0) * 100));
</script>

<button
	{onclick}
	class="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-200 hover:bg-cream/[0.04]"
>
	<!-- Thumbnail (portrait 2:3) -->
	<div class="h-[48px] w-[32px] flex-shrink-0 overflow-hidden rounded">
		{#if media.image}
			<img
				src={media.image}
				alt={media.title}
				class="h-full w-full object-cover"
				loading="lazy"
			/>
		{:else}
			<div class="h-full w-full bg-gradient-to-br from-accent/20 to-nexus-deep"></div>
		{/if}
	</div>

	<!-- Title -->
	<span class="min-w-0 flex-1 truncate text-sm font-medium text-cream/90">{media.title}</span>

	<!-- Genre -->
	<span class="hidden w-32 shrink-0 truncate text-[11px] text-faint md:inline">
		{media.metadata.genre ?? '-'}
	</span>

	<!-- Year -->
	<span class="hidden w-12 shrink-0 text-[11px] text-faint sm:inline">
		{media.metadata.year ?? '-'}
	</span>

	<!-- Rating -->
	{#if media.metadata.rating}
		<span class="hidden shrink-0 items-center gap-1 text-xs text-accent lg:flex">
			<Star size={10} class="fill-accent text-accent" />
			{media.metadata.rating}
		</span>
	{:else}
		<span class="hidden w-10 shrink-0 lg:block"></span>
	{/if}

	<!-- Runtime (movies only) -->
	{#if media.metadata.runtime}
		<span class="hidden w-16 shrink-0 text-right text-[11px] text-faint lg:inline">
			{media.metadata.runtime}
		</span>
	{/if}

	<!-- Progress -->
	<div class="hidden w-24 shrink-0 items-center gap-2 sm:flex">
		{#if progressPercent > 0}
			<div class="h-1 flex-1 overflow-hidden rounded-full bg-cream/10">
				<div
					class="h-full rounded-full bg-gradient-to-r from-accent to-accent-dim"
					style="width: {progressPercent}%"
				></div>
			</div>
			<span class="text-[10px] text-accent">{progressPercent}%</span>
		{:else}
			<span class="text-[10px] text-faint">-</span>
		{/if}
	</div>
</button>

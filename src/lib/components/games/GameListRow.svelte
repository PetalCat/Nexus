<script lang="ts">
	import { Star } from 'lucide-svelte';
	import type { UnifiedMedia, GameSaveData } from '$lib/types/media-ui';
	import FavoriteButton from './FavoriteButton.svelte';

	interface Props {
		game: UnifiedMedia;
		saveData?: GameSaveData | null;
		isFavorite?: boolean;
		onfavoritetoggle?: () => void;
		onclick?: () => void;
	}

	let { game, saveData = null, isFavorite = false, onfavoritetoggle, onclick }: Props = $props();

	const progressPercent = $derived(Math.round((game.progress ?? 0) * 100));

	const lastPlayedLabel = $derived(() => {
		if (!saveData?.lastPlayed) return '--';
		const now = new Date();
		const then = new Date(saveData.lastPlayed);
		const diffMs = now.getTime() - then.getTime();
		const diffDays = Math.floor(diffMs / 86400000);
		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		return `${diffDays}d ago`;
	});
</script>

<button
	{onclick}
	class="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-200 hover:bg-cream/[0.04]"
>
	<!-- Thumbnail -->
	<div class="h-[40px] w-[30px] flex-shrink-0 overflow-hidden rounded">
		{#if game.image}
			<img
				src={game.image}
				alt={game.title}
				class="h-full w-full object-cover"
				loading="lazy"
			/>
		{:else}
			<div class="h-full w-full bg-gradient-to-br from-warm/20 to-nexus-deep"></div>
		{/if}
	</div>

	<!-- Title -->
	<span class="min-w-0 flex-1 truncate text-sm font-medium text-cream/90">{game.title}</span>

	<!-- Platform badge -->
	<span class="hidden shrink-0 rounded bg-cream/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted sm:inline">
		{game.metadata.platform}
	</span>

	<!-- Genre -->
	<span class="hidden w-28 shrink-0 truncate text-[11px] text-faint md:inline">
		{game.metadata.genre ?? '--'}
	</span>

	<!-- Rating -->
	{#if game.metadata.rating}
		<span class="hidden shrink-0 items-center gap-1 text-xs text-accent lg:flex">
			<Star size={10} class="fill-accent text-accent" />
			{game.metadata.rating}
		</span>
	{:else}
		<span class="hidden w-10 shrink-0 lg:block"></span>
	{/if}

	<!-- Progress -->
	<div class="hidden w-24 shrink-0 items-center gap-2 sm:flex">
		{#if progressPercent > 0}
			<div class="h-1 flex-1 overflow-hidden rounded-full bg-cream/10">
				<div
					class="h-full rounded-full bg-gradient-to-r from-warm to-warm-light"
					style="width: {progressPercent}%"
				></div>
			</div>
			<span class="text-[10px] text-warm-light">{progressPercent}%</span>
		{:else}
			<span class="text-[10px] text-faint">--</span>
		{/if}
	</div>

	<!-- Last played -->
	<span class="hidden w-16 shrink-0 text-right text-[11px] text-faint lg:inline">
		{lastPlayedLabel()}
	</span>

	<!-- Favorite -->
	{#if onfavoritetoggle}
		<div class="shrink-0" onclick={(e) => e.stopPropagation()}>
			<FavoriteButton active={isFavorite} size="sm" onclick={(e) => { e.stopPropagation(); onfavoritetoggle?.(); }} />
		</div>
	{/if}
</button>

<script lang="ts">
	import type { Track } from '$lib/stores/musicStore.svelte';
	import { Play, Heart, MoreHorizontal } from 'lucide-svelte';

	let {
		track,
		index,
		isPlaying = false,
		isCurrent = false,
		isLiked = false,
		showAlbumArt = false,
		showArtist = true,
		showAlbum = false,
		onplay,
		onliketoggle,
		onaddtoplaylist
	}: {
		track: Track;
		index: number;
		isPlaying?: boolean;
		isCurrent?: boolean;
		isLiked?: boolean;
		showAlbumArt?: boolean;
		showArtist?: boolean;
		showAlbum?: boolean;
		onplay?: () => void;
		onliketoggle?: () => void;
		onaddtoplaylist?: () => void;
	} = $props();

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="group/track flex w-full items-center rounded-lg px-1.5 py-2 text-left cursor-pointer transition-all duration-200
		{isCurrent ? 'bg-accent/[0.08]' : 'hover:bg-cream/[0.03]'}"
	onclick={() => onplay?.()}
	onkeydown={(e) => e.key === 'Enter' && onplay?.()}
	role="button"
	tabindex="0"
>
	<!-- Track number / equalizer -->
	<span class="w-9 shrink-0 text-center text-xs tabular-nums {isCurrent ? 'font-bold text-accent' : 'text-faint'}">
		{#if isCurrent && isPlaying}
			<span class="inline-flex items-end gap-[1.5px]">
				<span class="inline-block w-[2.5px] rounded-full bg-accent animate-equalizer-1" style="height: 10px"></span>
				<span class="inline-block w-[2.5px] rounded-full bg-accent animate-equalizer-2" style="height: 10px"></span>
				<span class="inline-block w-[2.5px] rounded-full bg-accent animate-equalizer-3" style="height: 10px"></span>
			</span>
		{:else}
			<span class="group-hover/track:hidden">{index + 1}</span>
			<Play size={12} strokeWidth={0} class="ml-2 hidden fill-current text-cream group-hover/track:inline" />
		{/if}
	</span>

	<!-- Album art -->
	{#if showAlbumArt}
		<div class="mr-3 h-9 w-9 shrink-0 overflow-hidden rounded">
			<img src={track.image} alt={track.album} class="h-full w-full object-cover" loading="lazy" />
		</div>
	{/if}

	<!-- Title + artist -->
	<div class="min-w-0 flex-1 px-1">
		<p class="truncate text-sm {isCurrent ? 'font-medium text-accent' : 'text-cream/90 group-hover/track:text-cream'}">
			{track.title}
		</p>
		{#if showArtist}
			<p class="truncate text-xs text-faint">{track.artist}</p>
		{/if}
	</div>

	<!-- Album name -->
	{#if showAlbum}
		<span class="hidden shrink-0 truncate px-3 text-xs text-faint md:block max-w-[160px]">{track.album}</span>
	{/if}

	<!-- Heart -->
	<button
		class="shrink-0 p-1.5 transition-all duration-200
			{isLiked ? 'text-accent' : 'text-transparent group-hover/track:text-faint hover:!text-accent'}"
		onclick={(e: MouseEvent) => { e.stopPropagation(); onliketoggle?.(); }}
		aria-label={isLiked ? 'Unlike' : 'Like'}
	>
		<Heart size={14} strokeWidth={isLiked ? 0 : 1.5} class={isLiked ? 'fill-current' : ''} />
	</button>

	<!-- Menu -->
	{#if onaddtoplaylist}
		<button
			class="shrink-0 p-1.5 text-transparent transition-all duration-200 group-hover/track:text-faint hover:!text-cream"
			onclick={(e: MouseEvent) => { e.stopPropagation(); onaddtoplaylist?.(); }}
			aria-label="Add to playlist"
		>
			<MoreHorizontal size={14} strokeWidth={1.5} />
		</button>
	{/if}

	<!-- Duration -->
	<span class="shrink-0 pr-2 text-xs tabular-nums text-faint w-12 text-right">
		{formatTime(track.duration)}
	</span>
</div>

<script lang="ts">
	import type { Playlist, Track } from '$lib/stores/musicStore.svelte';
	import { ListMusic } from 'lucide-svelte';

	let {
		playlist,
		tracks,
		isActive = false,
		onclick
	}: {
		playlist: Playlist;
		tracks: Track[];
		isActive?: boolean;
		onclick?: () => void;
	} = $props();

	// Get up to 4 unique album art images for collage
	const artImages = $derived(
		[...new Map(tracks.map((t) => [t.image, t.image])).values()].slice(0, 4)
	);
</script>

<button
	class="group/playlist flex w-40 shrink-0 cursor-pointer flex-col text-left transition-all duration-300"
	onclick={() => onclick?.()}
>
	<div
		class="relative aspect-square w-full overflow-hidden rounded-xl transition-all duration-300"
		style="box-shadow: {isActive
			? '0 8px 32px rgba(212, 162, 83, 0.2), 0 0 0 2px rgba(212, 162, 83, 0.4)'
			: '0 2px 8px rgba(13, 11, 10, 0.3)'};"
	>
		{#if artImages.length >= 4}
			<!-- 2x2 collage -->
			<div class="grid h-full w-full grid-cols-2 grid-rows-2">
				{#each artImages.slice(0, 4) as src, i}
					<img {src} alt="" class="h-full w-full object-cover" loading="lazy" />
				{/each}
			</div>
		{:else if artImages.length > 0}
			<img src={artImages[0]} alt="" class="h-full w-full object-cover" loading="lazy" />
		{:else}
			<div class="flex h-full w-full items-center justify-center bg-gradient-to-br from-nexus-surface to-nexus-deep">
				<ListMusic size={32} strokeWidth={1} class="text-faint" />
			</div>
		{/if}
		<!-- Hover overlay -->
		<div class="pointer-events-none absolute inset-0 bg-nexus-void/0 transition-all duration-300 group-hover/playlist:bg-nexus-void/30"></div>
	</div>
	<div class="mt-2 px-0.5">
		<p class="truncate text-sm font-medium text-cream">{playlist.name}</p>
		<p class="text-xs text-faint">{tracks.length} tracks</p>
	</div>
</button>

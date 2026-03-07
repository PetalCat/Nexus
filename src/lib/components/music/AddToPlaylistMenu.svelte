<script lang="ts">
	import type { Playlist } from '$lib/stores/musicStore.svelte';
	import { Check, Plus, X } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let {
		trackId,
		playlists,
		onclose,
		onaddtoplaylist,
		oncreateplaylist
	}: {
		trackId: string;
		playlists: Playlist[];
		onclose?: () => void;
		onaddtoplaylist?: (playlistId: string) => void;
		oncreateplaylist?: () => void;
	} = $props();

	let menuRef = $state<HTMLDivElement | null>(null);

	function handleClickOutside(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) {
			onclose?.();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose?.();
	}

	onMount(() => {
		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleKeydown);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleKeydown);
		};
	});
</script>

<div
	bind:this={menuRef}
	class="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-cream/[0.06] bg-nexus-raised shadow-2xl"
>
	<div class="flex items-center justify-between border-b border-cream/[0.04] px-3 py-2">
		<span class="text-xs font-medium text-cream/70">Add to playlist</span>
		<button class="p-0.5 text-faint hover:text-cream" onclick={() => onclose?.()}>
			<X size={12} />
		</button>
	</div>
	<div class="max-h-48 overflow-y-auto py-1">
		{#each playlists as playlist (playlist.id)}
			{@const isInPlaylist = playlist.trackIds.includes(trackId)}
			<button
				class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-cream/[0.04]
					{isInPlaylist ? 'text-accent' : 'text-cream/80'}"
				onclick={() => onaddtoplaylist?.(playlist.id)}
			>
				{#if isInPlaylist}
					<Check size={14} strokeWidth={2} class="shrink-0" />
				{:else}
					<span class="w-3.5 shrink-0"></span>
				{/if}
				<span class="truncate">{playlist.name}</span>
				<span class="ml-auto text-xs text-faint">{playlist.trackIds.length}</span>
			</button>
		{/each}
	</div>
	<div class="border-t border-cream/[0.04]">
		<button
			class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-cream/70 transition-colors hover:bg-cream/[0.04] hover:text-cream"
			onclick={() => { oncreateplaylist?.(); onclose?.(); }}
		>
			<Plus size={14} strokeWidth={2} class="shrink-0" />
			Create New Playlist
		</button>
	</div>
</div>

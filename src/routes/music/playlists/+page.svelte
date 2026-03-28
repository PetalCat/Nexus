<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	import { goto } from '$app/navigation';
	import LikedSongsCard from '$lib/components/music/LikedSongsCard.svelte';
	import PlaylistCard from '$lib/components/music/PlaylistCard.svelte';
	import { Plus } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	let showCreateInput = $state(false);
	let newPlaylistName = $state('');
	let creating = $state(false);

	async function createPlaylist() {
		if (!newPlaylistName.trim() || creating) return;
		creating = true;
		try {
			const res = await fetch('/api/music/playlists', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newPlaylistName.trim() })
			});
			if (res.ok) {
				newPlaylistName = '';
				showCreateInput = false;
				invalidateAll();
			}
		} finally {
			creating = false;
		}
	}

	function handleCreateKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') createPlaylist();
		if (e.key === 'Escape') {
			showCreateInput = false;
			newPlaylistName = '';
		}
	}
</script>

<svelte:head>
	<title>Playlists — Nexus</title>
</svelte:head>

<div class="space-y-6">
	<h1 style="font-family: var(--font-display); font-size: 18px;" class="text-cream">
		Your Playlists
	</h1>

	<div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));">
		<!-- Liked Songs -->
		<LikedSongsCard trackCount={data.likedCount} onclick={() => goto('/music/liked')} />

		<!-- User playlists -->
		{#each data.playlists as playlist (playlist.id)}
			<PlaylistCard
				playlist={{ id: playlist.id, name: playlist.name, trackIds: [], createdAt: String(playlist.createdAt) }}
				tracks={[]}
				onclick={() => goto(`/music/playlists/${playlist.id}`)}
			/>
		{/each}

		<!-- Create Playlist card -->
		{#if showCreateInput}
			<div
				class="flex aspect-square flex-col items-center justify-center rounded-[10px] p-4"
				style="background: var(--color-raised); border: 2px solid rgba(212, 162, 83, 0.3);"
			>
				<input
					type="text"
					bind:value={newPlaylistName}
					onkeydown={handleCreateKeydown}
					placeholder="Playlist name..."
					class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-faint focus:border-accent focus:outline-none"
				/>
				<div class="mt-3 flex gap-2">
					<button
						onclick={createPlaylist}
						disabled={creating || !newPlaylistName.trim()}
						class="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-nexus-void transition-opacity hover:opacity-90 disabled:opacity-50"
					>
						{creating ? 'Creating...' : 'Create'}
					</button>
					<button
						onclick={() => { showCreateInput = false; newPlaylistName = ''; }}
						class="rounded-lg px-3 py-1.5 text-xs text-faint transition-colors hover:text-cream"
					>
						Cancel
					</button>
				</div>
			</div>
		{:else}
			<button
				onclick={() => { showCreateInput = true; }}
				class="group flex aspect-square cursor-pointer flex-col items-center justify-center rounded-[10px] transition-all duration-200"
				style="background: var(--color-raised); border: 2px dashed rgba(240, 235, 227, 0.1);"
				onmouseenter={(e) => {
					const el = e.currentTarget as HTMLElement;
					el.style.borderColor = 'rgba(212, 162, 83, 0.3)';
				}}
				onmouseleave={(e) => {
					const el = e.currentTarget as HTMLElement;
					el.style.borderColor = 'rgba(240, 235, 227, 0.1)';
				}}
			>
				<Plus size={32} strokeWidth={1.5} style="color: var(--color-faint);" class="transition-colors group-hover:!text-accent" />
				<span class="mt-2 text-sm text-faint transition-colors group-hover:text-accent">Create Playlist</span>
			</button>
		{/if}
	</div>
</div>

<script lang="ts">
	import type { PageData } from './$types';
	import { goto, invalidateAll } from '$app/navigation';
	import { ListVideo, Plus, PlaySquare, ArrowLeft, Lock, Globe, Eye } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	const playlists = $derived(data.playlists);
	let newTitle = $state('');
	let newPrivacy = $state<'public' | 'unlisted' | 'private'>('private');
	let creating = $state(false);

	const privacyOptions = [
		{ value: 'private' as const, label: 'Private', icon: Lock },
		{ value: 'unlisted' as const, label: 'Unlisted', icon: Eye },
		{ value: 'public' as const, label: 'Public', icon: Globe }
	];

	async function createPlaylist() {
		const title = newTitle.trim();
		if (!title || creating) return;
		creating = true;
		try {
			const res = await fetch('/api/video/playlists', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title, privacy: newPrivacy })
			});
			if (res.ok) {
				newTitle = '';
				await invalidateAll();
			}
		} catch {
			// silent
		} finally {
			creating = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			createPlaylist();
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function getVideoCount(playlist: any): number {
		return playlist.videoCount ?? playlist.videos?.length ?? 0;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function getThumbnail(playlist: any): string | undefined {
		if (playlist.videos?.[0]?.videoThumbnails?.[0]?.url) {
			return playlist.videos[0].videoThumbnails[0].url;
		}
		return undefined;
	}
</script>

<svelte:head>
	<title>Playlists — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-8 p-4 pb-10 sm:p-6 lg:p-10">
	<!-- Header -->
	<div class="flex items-center gap-4">
		<a
			href="/videos"
			class="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-cream"
			aria-label="Back to videos"
		>
			<ArrowLeft size={18} />
		</a>
		<div class="flex items-center gap-2">
			<ListVideo size={20} class="text-accent" />
			<h1 class="font-display text-2xl font-bold text-cream">Playlists</h1>
		</div>
	</div>

	{#if !data.hasLinkedAccount}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<div
				class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-muted"
			>
				<PlaySquare size={28} strokeWidth={1.5} />
			</div>
			<p class="font-medium text-cream">No Invidious account linked</p>
			<p class="mt-1 text-sm text-muted">
				Link your Invidious account in settings to manage playlists.
			</p>
			<a
				href="/settings/accounts"
				class="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-accent/80"
			>
				Go to Settings
			</a>
		</div>
	{:else}
		<!-- Create playlist form -->
		<div
			class="flex flex-col gap-3 rounded-xl border border-white/[0.04] bg-surface/50 p-4 sm:flex-row sm:items-end"
		>
			<div class="flex-1">
				<label for="playlist-title" class="mb-1.5 block text-xs font-medium text-muted"
					>New Playlist</label
				>
				<input
					id="playlist-title"
					type="text"
					bind:value={newTitle}
					onkeydown={handleKeydown}
					placeholder="Playlist name..."
					class="w-full rounded-lg border border-white/[0.06] bg-raised/50 px-3 py-2 text-sm text-cream placeholder:text-faint outline-none transition-colors focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
				/>
			</div>
			<div class="flex items-end gap-2">
				<div>
					<label for="playlist-privacy" class="mb-1.5 block text-xs font-medium text-muted"
						>Privacy</label
					>
					<select
						id="playlist-privacy"
						bind:value={newPrivacy}
						class="rounded-lg border border-white/[0.06] bg-raised/50 px-3 py-2 text-sm text-cream outline-none transition-colors focus:border-accent/40"
					>
						{#each privacyOptions as opt (opt.value)}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>
				<button
					onclick={createPlaylist}
					disabled={!newTitle.trim() || creating}
					class="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed"
				>
					<Plus size={16} />
					Create
				</button>
			</div>
		</div>

		<!-- Playlist grid -->
		{#if playlists.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-center">
				<div
					class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-muted"
				>
					<ListVideo size={28} strokeWidth={1.5} />
				</div>
				<p class="font-medium text-cream">No playlists yet</p>
				<p class="mt-1 text-sm text-muted">Create your first playlist above.</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{#each playlists as playlist (playlist.playlistId ?? playlist.id)}
					{@const id = playlist.playlistId ?? playlist.id}
					{@const thumb = getThumbnail(playlist)}
					{@const count = getVideoCount(playlist)}
					<button
						class="group overflow-hidden rounded-xl border border-white/[0.04] bg-surface/50 text-left transition-colors hover:bg-raised/60"
						onclick={() => goto(`/videos/playlists/${id}`)}
					>
						<!-- Thumbnail -->
						<div class="relative aspect-video w-full overflow-hidden bg-raised/30">
							{#if thumb}
								<img
									src={thumb}
									alt={playlist.title}
									class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
									loading="lazy"
								/>
							{:else}
								<div
									class="flex h-full w-full items-center justify-center bg-gradient-to-br from-nexus-surface to-nexus-base"
								>
									<ListVideo size={32} class="text-muted/30" />
								</div>
							{/if}
							<!-- Video count badge -->
							<span
								class="absolute bottom-2 right-2 rounded-md bg-nexus-void/80 px-2 py-0.5 text-[11px] font-medium tabular-nums text-cream/90"
							>
								{count} video{count !== 1 ? 's' : ''}
							</span>
						</div>

						<!-- Info -->
						<div class="p-3">
							<h3
								class="line-clamp-1 text-sm font-medium text-cream/85 transition-colors group-hover:text-cream"
							>
								{playlist.title}
							</h3>
							<p class="mt-0.5 text-[11px] text-faint/70">
								{#if playlist.privacy === 'private'}
									<Lock size={10} class="mr-0.5 inline" /> Private
								{:else if playlist.privacy === 'unlisted'}
									<Eye size={10} class="mr-0.5 inline" /> Unlisted
								{:else}
									<Globe size={10} class="mr-0.5 inline" /> Public
								{/if}
							</p>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>

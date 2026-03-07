<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { ArrowLeft, ListVideo, Trash2, X } from 'lucide-svelte';
	import VideoCard from '$lib/components/video/VideoCard.svelte';
	import { toVideoCardMedia } from '$lib/utils/video-format';
	import { page } from '$app/stores';

	let { data }: { data: PageData } = $props();

	let removedIds = $state<string[]>([]);
	let removingIds = $state<string[]>([]);
	let deleting = $state(false);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const videos = $derived((data.playlist?.videos ?? []).filter((v: any) => !removedIds.includes(v.id)));
	const playlistId = $derived($page.params.id);

	function handleVideoClick(sourceId: string, serviceId: string) {
		goto(`/media/video/${sourceId}?service=${serviceId}`);
	}

	async function deletePlaylist() {
		if (!confirm('Delete this playlist? This cannot be undone.')) return;
		deleting = true;
		try {
			const res = await fetch(`/api/video/playlists/${encodeURIComponent(playlistId ?? '')}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				goto('/videos/playlists');
			}
		} catch {
			// silent
		} finally {
			deleting = false;
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async function removeVideo(video: any) {
		const indexId = video._indexId;
		removingIds = [...removingIds, video.id];
		try {
			const res = await fetch(
				`/api/video/playlists/${encodeURIComponent(playlistId ?? '')}/videos/${encodeURIComponent(indexId)}`,
				{ method: 'DELETE' }
			);
			if (res.ok) {
				removedIds = [...removedIds, video.id];
			}
		} catch {
			// silent
		} finally {
			removingIds = removingIds.filter((id) => id !== video.id);
		}
	}
</script>

<svelte:head>
	<title>{data.playlist?.title ?? 'Playlist'} — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-8 p-4 pb-10 sm:p-6 lg:p-10">
	{#if !data.playlist}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<div
				class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-muted"
			>
				<ListVideo size={28} strokeWidth={1.5} />
			</div>
			<p class="font-medium text-cream">Playlist not found</p>
			<p class="mt-1 text-sm text-muted">It may have been deleted or is not accessible.</p>
			<a
				href="/videos/playlists"
				class="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-accent/80"
			>
				Back to Playlists
			</a>
		</div>
	{:else}
		<!-- Header -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex items-center gap-4">
				<a
					href="/videos/playlists"
					class="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-cream"
					aria-label="Back to playlists"
				>
					<ArrowLeft size={18} />
				</a>
				<div>
					<h1 class="font-display text-2xl font-bold text-cream">{data.playlist.title}</h1>
					<p class="mt-0.5 text-sm text-muted">
						{data.playlist.videoCount} video{data.playlist.videoCount !== 1 ? 's' : ''}
					</p>
				</div>
			</div>

			<button
				onclick={deletePlaylist}
				disabled={deleting}
				class="flex items-center gap-1.5 rounded-lg border border-white/[0.06] px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
			>
				<Trash2 size={14} />
				Delete
			</button>
		</div>

		<!-- Video list -->
		{#if videos.length === 0}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<p class="text-sm text-muted">This playlist is empty.</p>
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each videos as video, i (video.id)}
					<div class="group relative flex items-center gap-3">
						<span class="w-6 text-right text-xs tabular-nums text-faint/50">{i + 1}</span>
						<div class="flex-1">
							<VideoCard
								video={toVideoCardMedia(video)}
								layout="list"
								onclick={() => handleVideoClick(video.sourceId, video.serviceId)}
							/>
						</div>
						<!-- Remove button -->
						<button
							class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted opacity-0 transition-all hover:bg-raised hover:text-cream group-hover:opacity-100"
							onclick={() => removeVideo(video)}
							disabled={removingIds.includes(video.id)}
							aria-label="Remove from playlist"
						>
							<X size={16} />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

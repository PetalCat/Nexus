<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { goto, invalidateAll } from '$app/navigation';
	import { History, X, ArrowLeft } from 'lucide-svelte';
	import VideoCard from '$lib/components/video/VideoCard.svelte';
	import { toVideoCardMedia } from '$lib/utils/video-format';
	import { toast } from '$lib/stores/toast.svelte';
	import SignInCard from '$lib/components/account-linking/SignInCard.svelte';
	import StaleCredentialBanner from '$lib/components/account-linking/StaleCredentialBanner.svelte';

	let { data }: { data: PageData } = $props();
	let removedIds = $state<string[]>([]);
	let removingIds = $state<string[]>([]);
	let extraVideos = $state<UnifiedMedia[]>([]);
	let currentPage = $state(1);
	let loadingMore = $state(false);
	let hasMore = $state(false);
	$effect(() => { hasMore = data.hasMore; });
	const videos = $derived([...data.videos, ...extraVideos].filter((v) => !removedIds.includes(v.id)));

	async function loadMore() {
		if (loadingMore || !hasMore) return;
		loadingMore = true;
		try {
			const nextPage = currentPage + 1;
			const res = await fetch(`/api/video/history/resolved?page=${nextPage}&limit=24`);
			if (res.ok) {
				const json = await res.json();
				extraVideos = [...extraVideos, ...(json.items ?? [])];
				hasMore = json.hasMore;
				currentPage = nextPage;
			}
		} catch {
			toast.error('Failed to load more history');
		}
		loadingMore = false;
	}

	function handleVideoClick(item: UnifiedMedia) {
		goto(`/media/video/${item.sourceId}?service=${item.serviceId}`);
	}

	async function removeFromHistory(videoId: string, sourceId: string) {
		removingIds = [...removingIds, videoId];
		try {
			await fetch(`/api/video/history/${encodeURIComponent(sourceId)}`, { method: 'DELETE' });
			removedIds = [...removedIds, videoId];
		} catch {
			toast.error('Failed to remove from history');
		} finally {
			removingIds = removingIds.filter((id) => id !== videoId);
		}
	}
</script>

<svelte:head>
	<title>Watch History — Nexus</title>
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
			<History size={20} class="text-accent" />
			<h1 class="font-display text-2xl font-bold text-cream">Watch History</h1>
		</div>
	</div>

	{#if data.invidiousSummary?.staleSince}
		<StaleCredentialBanner
			service={data.invidiousSummary}
			context="Your watch history requires Invidious"
			onReconnected={() => invalidateAll()}
		/>
	{:else if !data.hasLinkedAccount && data.invidiousSummary}
		<SignInCard
			service={data.invidiousSummary}
			features={['watch history', 'continue watching']}
			variant="hero"
			onConnected={() => invalidateAll()}
		/>
	{:else if videos.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<div
				class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-muted"
			>
				<History size={28} strokeWidth={1.5} />
			</div>
			<p class="font-medium text-cream">No watch history</p>
			<p class="mt-1 text-sm text-muted">Videos you watch will appear here.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each videos as item (item.id)}
				<div class="group relative">
					<VideoCard
						video={toVideoCardMedia(item)}
						layout="grid"
						onclick={() => handleVideoClick(item)}
					/>
					<!-- Remove button overlay -->
					<button
						class="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-nexus-void/80 text-muted opacity-0 transition-all hover:bg-nexus-void hover:text-cream group-hover:opacity-100"
						onclick={(e) => {
							e.stopPropagation();
							removeFromHistory(item.id, item.sourceId!);
						}}
						disabled={removingIds.includes(item.id)}
						aria-label="Remove from history"
					>
						<X size={14} />
					</button>
				</div>
			{/each}
		</div>

		{#if hasMore}
			<div class="mt-6 flex justify-center">
				<button
					class="rounded-xl border border-cream/[0.08] bg-surface px-6 py-2.5 text-sm text-muted transition-colors hover:bg-raised hover:text-cream disabled:opacity-50"
					onclick={loadMore}
					disabled={loadingMore}
				>
					{loadingMore ? 'Loading...' : 'Load More'}
				</button>
			</div>
		{/if}
	{/if}
</div>

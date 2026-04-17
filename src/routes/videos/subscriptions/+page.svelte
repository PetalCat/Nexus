<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { goto, invalidateAll } from '$app/navigation';
	import { Rss, History, ListVideo, ArrowLeft } from 'lucide-svelte';
	import VideoCard from '$lib/components/video/VideoCard.svelte';
	import SignInCard from '$lib/components/account-linking/SignInCard.svelte';
	import StaleCredentialBanner from '$lib/components/account-linking/StaleCredentialBanner.svelte';

	let { data }: { data: PageData } = $props();

	function handleVideoClick(item: UnifiedMedia) {
		goto(`/media/video/${item.sourceId}?service=${item.serviceId}`);
	}
</script>

<svelte:head>
	<title>Subscriptions — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-6 p-4 pb-10 sm:p-6 lg:p-10">
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
			<Rss size={20} class="text-accent" />
			<h1 class="font-display text-2xl font-bold text-cream">Subscriptions</h1>
		</div>
	</div>

	<!-- Sub-nav -->
	<nav class="flex items-center gap-1" aria-label="Video sections">
		<a
			href="/videos/subscriptions"
			class="rounded-lg px-3.5 py-2 text-sm font-medium text-accent bg-accent/10"
		>
			<Rss size={14} class="inline-block mr-1 -mt-0.5" />
			Subscriptions
		</a>
		<a
			href="/videos/history"
			class="rounded-lg px-3.5 py-2 text-sm font-medium text-muted hover:bg-raised hover:text-cream transition-colors"
		>
			<History size={14} class="inline-block mr-1 -mt-0.5" />
			History
		</a>
		<a
			href="/videos/playlists"
			class="rounded-lg px-3.5 py-2 text-sm font-medium text-muted hover:bg-raised hover:text-cream transition-colors"
		>
			<ListVideo size={14} class="inline-block mr-1 -mt-0.5" />
			Playlists
		</a>
	</nav>

	{#if data.invidiousSummary?.staleSince}
		<StaleCredentialBanner
			service={data.invidiousSummary}
			context="Your subscription feed requires Invidious"
			onReconnected={() => invalidateAll()}
		/>
	{:else if !data.hasLinkedAccount && data.invidiousSummary}
		<SignInCard
			service={data.invidiousSummary}
			features={['subscriptions', 'history', 'playlists']}
			variant="hero"
			onConnected={() => invalidateAll()}
		/>
	{:else if data.today.length === 0 && data.thisWeek.length === 0 && data.earlier.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-muted">
				<Rss size={28} strokeWidth={1.5} />
			</div>
			<p class="font-medium text-cream">No subscription videos</p>
			<p class="mt-1 text-sm text-muted">Subscribe to channels to see their videos here.</p>
		</div>
	{:else}
		{#if data.today.length > 0}
			<section>
				<h2 class="mb-4 font-display text-lg font-semibold text-cream">
					Today <span class="text-sm font-normal text-muted">({data.today.length})</span>
				</h2>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each data.today as item (item.id)}
						<VideoCard
							video={item}
							layout="grid"
							onclick={() => handleVideoClick(item)}
							onchannelclick={() => goto(`/videos/channel/${item.metadata?.authorId}`)}
						/>
					{/each}
				</div>
			</section>
		{/if}

		{#if data.thisWeek.length > 0}
			<section>
				<h2 class="mb-4 font-display text-lg font-semibold text-cream">
					This Week <span class="text-sm font-normal text-muted">({data.thisWeek.length})</span>
				</h2>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each data.thisWeek as item (item.id)}
						<VideoCard
							video={item}
							layout="grid"
							onclick={() => handleVideoClick(item)}
							onchannelclick={() => goto(`/videos/channel/${item.metadata?.authorId}`)}
						/>
					{/each}
				</div>
			</section>
		{/if}

		{#if data.earlier.length > 0}
			<section>
				<h2 class="mb-4 font-display text-lg font-semibold text-cream">
					Earlier <span class="text-sm font-normal text-muted">({data.earlier.length})</span>
				</h2>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each data.earlier as item (item.id)}
						<VideoCard
							video={item}
							layout="grid"
							onclick={() => handleVideoClick(item)}
							onchannelclick={() => goto(`/videos/channel/${item.metadata?.authorId}`)}
						/>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { formatDuration, formatViews, formatCount, toVideoCardMedia } from '$lib/utils/video-format';
	import { goto } from '$app/navigation';
	import { ArrowLeft, CheckCircle, Users, Eye, Bell, BellOff } from 'lucide-svelte';
	import VideoCard from '$lib/components/video/VideoCard.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	let { data }: { data: PageData } = $props();

	const sortOptions = [
		{ label: 'Newest', value: 'newest' },
		{ label: 'Oldest', value: 'oldest' },
		{ label: 'Popular', value: 'popular' }
	] as const;

	let activeTab = $state<'videos' | 'about'>('videos');
	let subscribed = $state(false);
	let subscribing = $state(false);
	let notify = $state(false);
	$effect(() => { subscribed = data.isSubscribed; });
	$effect(() => { notify = data.notifyEnabled; });
	let togglingNotify = $state(false);

	async function toggleSubscribe() {
		subscribing = true;
		try {
			const method = subscribed ? 'DELETE' : 'POST';
			const res = await fetch(`/api/video/subscriptions/${data.channel.authorId}`, { method });
			if (res.ok) {
				subscribed = !subscribed;
				if (!subscribed) notify = false;
			}
		} catch { toast.error('Failed to update subscription'); }
		finally { subscribing = false; }
	}

	async function toggleNotify() {
		if (togglingNotify) return;
		togglingNotify = true;
		const method = notify ? 'DELETE' : 'POST';
		try {
			const res = await fetch(`/api/video/subscriptions/${data.channel.authorId}/notifications`, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ channelName: data.channel.author })
			});
			if (res.ok) notify = !notify;
		} catch { toast.error('Failed to update notifications'); }
		finally { togglingNotify = false; }
	}
</script>

<svelte:head>
	<title>{data.channel.author} — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-0">
	<!-- Banner -->
	{#if data.channel.banner}
		<div class="relative h-44 w-full overflow-hidden sm:h-56 lg:h-64">
			<img
				src={data.channel.banner}
				alt=""
				class="h-full w-full object-cover"
			/>
			<div class="absolute inset-0 bg-gradient-to-t from-nexus-void via-nexus-void/80 to-transparent"></div>
		</div>
	{:else}
		<div class="h-20"></div>
	{/if}

	<!-- Channel info -->
	<div class="relative -mt-10 flex flex-col gap-6 px-4 sm:px-6 lg:px-10">
		<div class="flex items-end gap-4 sm:gap-5">
			{#if data.channel.thumbnail}
				<img
					src={data.channel.thumbnail}
					alt={data.channel.author}
					class="h-20 w-20 flex-shrink-0 rounded-full border-4 border-nexus-void object-cover shadow-xl sm:h-24 sm:w-24"
				/>
			{:else}
				<div class="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full border-4 border-nexus-void bg-raised shadow-xl sm:h-24 sm:w-24">
					<Users size={32} class="text-faint" />
				</div>
			{/if}

			<div class="min-w-0 flex-1 pb-1">
				<div class="flex items-center gap-2">
					<h1 class="font-display text-xl font-bold text-cream sm:text-2xl">{data.channel.author}</h1>
					{#if data.channel.authorVerified}
						<CheckCircle size={18} class="flex-shrink-0 text-accent" />
					{/if}
				</div>
				<div class="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
					{#if data.channel.subCount}
						<span class="flex items-center gap-1">
							<Users size={13} />
							{formatCount(data.channel.subCount)} subscribers
						</span>
					{/if}
					{#if data.channel.totalViews}
						<span class="flex items-center gap-1">
							<Eye size={13} />
							{formatCount(data.channel.totalViews)} views
						</span>
					{/if}
					{#if data.channel.videos.length > 0}
						<span>{data.channel.videos.length} videos</span>
					{/if}
				</div>
			</div>

			{#if data.hasLinkedAccount}
				<div class="ml-auto flex flex-shrink-0 items-center gap-1.5">
					{#if subscribed}
						<button
							class="rounded-full p-2.5 transition-colors {notify
								? 'bg-warm/15 text-warm hover:bg-warm/25'
								: 'text-muted/50 hover:bg-raised hover:text-cream'}"
							disabled={togglingNotify}
							onclick={toggleNotify}
							title={notify ? 'Turn off notifications' : 'Get notified of new uploads'}
						>
							{#if notify}
								<Bell size={18} fill="currentColor" />
							{:else}
								<BellOff size={18} />
							{/if}
						</button>
					{/if}
					<button
						class="rounded-full px-5 py-2 text-sm font-medium transition-all
							{subscribed
								? 'border border-cream/[0.1] bg-transparent text-muted hover:border-cream/[0.2] hover:text-cream'
								: 'bg-accent text-cream hover:bg-accent/80'}"
						onclick={toggleSubscribe}
						disabled={subscribing}
					>
						{subscribed ? 'Subscribed' : 'Subscribe'}
					</button>
				</div>
			{/if}
		</div>

		<!-- Back button -->
		<button
			class="flex w-fit items-center gap-1.5 text-sm text-muted transition-colors hover:text-cream"
			onclick={() => history.back()}
		>
			<ArrowLeft size={16} />
			Back
		</button>

		<!-- Tabs -->
		<div class="flex items-center gap-1 border-b border-cream/[0.06] pb-0">
			<button
				class="rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors
					{activeTab === 'videos' ? 'border-b-2 border-accent text-cream' : 'text-muted hover:text-cream'}"
				onclick={() => (activeTab = 'videos')}
			>Videos</button>
			<button
				class="rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors
					{activeTab === 'about' ? 'border-b-2 border-accent text-cream' : 'text-muted hover:text-cream'}"
				onclick={() => (activeTab = 'about')}
			>About</button>
		</div>

		<!-- Videos tab -->
		{#if activeTab === 'videos'}
			<div class="flex items-center justify-end">
				<div class="flex items-center gap-1">
					{#each sortOptions as opt (opt.value)}
						<a
							href="?sort={opt.value}"
							class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors
								{data.sort === opt.value ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-raised hover:text-cream'}"
						>
							{opt.label}
						</a>
					{/each}
				</div>
			</div>

			{#if data.channel.videos.length > 0}
				<div class="grid grid-cols-1 gap-4 pb-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each data.channel.videos as item (item.id)}
						<VideoCard
							video={toVideoCardMedia(item)}
							layout="grid"
							showChannel={false}
							onclick={() => goto(`/media/video/${item.sourceId}?service=${data.channel.serviceId}`)}
						/>
					{/each}
				</div>
			{:else}
				<p class="py-20 text-center text-sm text-muted">No videos found for this channel.</p>
			{/if}

		<!-- About tab -->
		{:else if activeTab === 'about'}
			<div class="flex max-w-3xl flex-col gap-6 pb-10">
				{#if data.channel.description}
					<div>
						<h2 class="mb-2 text-sm font-semibold text-cream">Description</h2>
						<p class="whitespace-pre-line text-sm leading-relaxed text-muted/80">{data.channel.description}</p>
					</div>
				{/if}

				<div class="flex flex-wrap gap-x-8 gap-y-3">
					{#if data.channel.totalViews}
						<div>
							<span class="text-xs text-muted">Total views</span>
							<p class="text-sm font-medium text-cream">{formatCount(data.channel.totalViews)}</p>
						</div>
					{/if}
					{#if data.channel.subCount}
						<div>
							<span class="text-xs text-muted">Subscribers</span>
							<p class="text-sm font-medium text-cream">{formatCount(data.channel.subCount)}</p>
						</div>
					{/if}
					{#if data.channel.videos.length > 0}
						<div>
							<span class="text-xs text-muted">Videos</span>
							<p class="text-sm font-medium text-cream">{data.channel.videos.length}</p>
						</div>
					{/if}
				</div>

				{#if data.channel.tags.length > 0}
					<div>
						<h2 class="mb-2 text-sm font-semibold text-cream">Tags</h2>
						<div class="flex flex-wrap gap-2">
							{#each data.channel.tags as tag}
								<span class="rounded-full bg-raised px-3 py-1 text-xs text-muted">{tag}</span>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

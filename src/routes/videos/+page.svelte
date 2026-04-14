<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { goto, invalidateAll } from '$app/navigation';
	import { PlaySquare, TrendingUp, Rss, Search, X, Users, History, ListVideo, ChevronRight } from 'lucide-svelte';
	import VideoCard from '$lib/components/video/VideoCard.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCount, toVideoCardMedia } from '$lib/utils/video-format';
	import SignInCard from '$lib/components/account-linking/SignInCard.svelte';
	import StaleCredentialBanner from '$lib/components/account-linking/StaleCredentialBanner.svelte';

	let { data }: { data: PageData } = $props();

	// --- Search state ---
	interface ChannelResult {
		id: string;
		name: string;
		thumbnail: string;
		subscribers: number;
		videoCount: number;
		description: string;
	}

	let searchInput: HTMLInputElement | undefined = $state();
	let searchQuery = $state('');
	let committedQuery = $state('');
	let suggestions = $state<string[]>([]);
	let searchResults = $state<UnifiedMedia[]>([]);
	let channelResults = $state<ChannelResult[]>([]);
	let isSearching = $state(false);
	let suggestionsOpen = $state(false);
	let selectedSuggestion = $state(-1);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let searchAbort: AbortController | undefined;

	const isSearchMode = $derived(committedQuery.length > 0);

	const categories = [
		{ label: 'All', value: undefined, href: '/videos' },
		{ label: 'Music', value: 'music', href: '/videos?category=music' },
		{ label: 'Gaming', value: 'gaming', href: '/videos?category=gaming' },
		{ label: 'News', value: 'news', href: '/videos?category=news' },
		{ label: 'Movies', value: 'movies', href: '/videos?category=movies' }
	] as const;

	// --- Search state (filters) ---
	let searchSort = $state<'relevance' | 'date' | 'views' | 'rating'>('relevance');
	let searchDuration = $state<'' | 'short' | 'medium' | 'long'>('');
	let searchDate = $state<'' | 'hour' | 'today' | 'week' | 'month' | 'year'>('');

	let trendingLimit = $state(20);

	// --- Infinite scroll ---
	let sentinelEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!sentinelEl) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && trendingLimit < data.trending.length) {
					trendingLimit += 20;
				}
			},
			{ rootMargin: '200px' }
		);
		observer.observe(sentinelEl);
		return () => observer.disconnect();
	});

	// --- Search result counts ---
	const searchResultSummary = $derived.by(() => {
		const parts: string[] = [];
		if (searchResults.length > 0) parts.push(`${searchResults.length} video${searchResults.length !== 1 ? 's' : ''}`);
		if (channelResults.length > 0) parts.push(`${channelResults.length} channel${channelResults.length !== 1 ? 's' : ''}`);
		return parts.join(', ');
	});

	// --- Search logic ---

	function handleInput() {
		const q = searchQuery.trim();
		if (debounceTimer) clearTimeout(debounceTimer);
		selectedSuggestion = -1;

		if (!q) {
			suggestions = [];
			suggestionsOpen = false;
			return;
		}

		debounceTimer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/video/suggestions?q=${encodeURIComponent(q)}`);
				if (!res.ok) return;
				const json = await res.json();
				const newSuggestions = json.suggestions ?? [];
				// Only update if query hasn't changed
				if (searchQuery.trim() === q) {
					suggestions = newSuggestions;
					suggestionsOpen = newSuggestions.length > 0;
				}
			} catch {
				// ignore
			}
		}, 250);
	}

	async function executeSearch(query: string) {
		const q = query.trim();
		if (!q) return;

		suggestionsOpen = false;
		suggestions = [];
		committedQuery = q;
		isSearching = true;

		searchAbort?.abort();
		searchAbort = new AbortController();

		const params = new URLSearchParams({ q });
		if (searchSort !== 'relevance') params.set('sort', searchSort);
		if (searchDuration) params.set('duration', searchDuration);
		if (searchDate) params.set('date', searchDate);

		try {
			const res = await fetch(`/api/video/search?${params}`, {
				signal: searchAbort.signal
			});
			if (!res.ok) throw new Error('Search failed');
			const json = await res.json();
			searchResults = json.items ?? [];
			channelResults = json.channels ?? [];
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			searchResults = [];
			channelResults = [];
			toast.error('Search failed — try again');
		} finally {
			isSearching = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (suggestionsOpen && suggestions.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				selectedSuggestion = Math.min(selectedSuggestion + 1, suggestions.length - 1);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				selectedSuggestion = Math.max(selectedSuggestion - 1, -1);
				return;
			}
			if (e.key === 'Enter' && selectedSuggestion >= 0) {
				e.preventDefault();
				const picked = suggestions[selectedSuggestion];
				searchQuery = picked;
				executeSearch(picked);
				return;
			}
		}

		if (e.key === 'Enter') {
			e.preventDefault();
			executeSearch(searchQuery);
		}
		if (e.key === 'Escape') {
			suggestionsOpen = false;
			if (!committedQuery) searchInput?.blur();
		}
	}

	function pickSuggestion(s: string) {
		searchQuery = s;
		suggestionsOpen = false;
		executeSearch(s);
	}

	function clearSearch() {
		searchQuery = '';
		committedQuery = '';
		searchResults = [];
		channelResults = [];
		suggestions = [];
		suggestionsOpen = false;
		isSearching = false;
		searchAbort?.abort();
		searchInput?.focus();
	}

	function closeSuggestions(e: FocusEvent) {
		// Delay so that mousedown on a suggestion can fire first
		const related = e.relatedTarget as HTMLElement | null;
		if (related?.closest('.suggestions-list')) return;
		setTimeout(() => { suggestionsOpen = false; }, 150);
	}

	function handleVideoClick(item: UnifiedMedia) {
		goto(`/media/video/${item.sourceId}?service=${item.serviceId}`);
	}

	function fixChannelThumb(url: string): string {
		if (url.startsWith('//')) return `https:${url}`;
		return url;
	}
</script>

<svelte:head>
	<title>Videos — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-6 p-4 pb-10 sm:p-6 lg:p-10">
	<!-- Header -->
	<h1 class="font-display text-2xl font-bold text-cream">Videos</h1>

	<!-- Stale credential banner (takes priority over sign-in card) -->
	{#if data.invidiousSummary?.staleSince}
		<StaleCredentialBanner
			service={data.invidiousSummary}
			context="Your subscription feed and history require Invidious"
			onReconnected={() => invalidateAll()}
		/>
	{:else if data.invidiousSummary && data.hasInvidious && !data.hasLinkedAccount}
		<!-- Inline sign-in card — replaces the "no CTA" empty state -->
		<SignInCard
			service={data.invidiousSummary}
			features={['subscriptions', 'history', 'playlists']}
			variant="inline"
			onConnected={() => invalidateAll()}
		/>
	{/if}

	<!-- Sub-nav — always visible -->
	{#if data.hasLinkedAccount && data.hasInvidious}
		<nav class="flex items-center gap-1" aria-label="Video sections">
			<a
				href="/videos"
				class="rounded-lg px-3.5 py-2 text-sm font-medium text-muted hover:bg-raised hover:text-cream transition-colors"
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
	{/if}

	<!-- Search bar — centered, wider -->
	{#if data.hasInvidious}
		<div class="relative mx-auto w-full max-w-xl">
			<div class="relative flex items-center">
				<Search size={16} class="absolute left-3 text-muted pointer-events-none" />
				<input
					bind:this={searchInput}
					type="text"
					bind:value={searchQuery}
					oninput={handleInput}
					onkeydown={handleKeydown}
					onblur={closeSuggestions}
					onfocus={() => { if (suggestions.length > 0 && searchQuery.trim()) suggestionsOpen = true; }}
					placeholder="Search videos & channels..."
					class="w-full rounded-xl border border-cream/[0.06] bg-surface py-2.5 pl-9 pr-9 text-sm text-cream placeholder:text-faint outline-none transition-colors focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
				/>
				{#if searchQuery || isSearchMode}
					<button
						onclick={clearSearch}
						class="absolute right-3 text-muted transition-colors hover:text-cream"
						aria-label="Clear search"
					>
						<X size={16} />
					</button>
				{/if}
			</div>

			{#if suggestionsOpen && suggestions.length > 0}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="suggestions-list absolute top-full z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-cream/[0.08] bg-surface shadow-2xl"
					onmousedown={(e) => e.preventDefault()}
				>
					{#each suggestions as suggestion, i (suggestion)}
						<button
							class="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors
								{i === selectedSuggestion ? 'bg-raised text-cream' : 'text-cream/70 hover:bg-raised/60 hover:text-cream'}"
							onmousedown={() => pickSuggestion(suggestion)}
						>
							<Search size={13} class="flex-shrink-0 text-faint" />
							<span class="truncate">{suggestion}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if !data.hasInvidious}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-muted">
				<PlaySquare size={28} strokeWidth={1.5} />
			</div>
			<p class="font-medium text-cream">No video service connected</p>
			<p class="mt-1 text-sm text-muted">Add an Invidious instance in settings to browse videos.</p>
			<a href="/settings/accounts" class="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-accent/80">
				Connect a Service
			</a>
		</div>
	{:else if isSearchMode}
		<!-- ====== SEARCH RESULTS ====== -->
		<section class="flex flex-col gap-6">
			<div class="flex items-center gap-2">
				<Search size={18} class="text-accent" />
				<h2 class="font-display text-lg font-semibold text-cream">
					{isSearching ? 'Searching...' : `Results for "${committedQuery}"`}
				</h2>
				{#if !isSearching && searchResultSummary}
					<span class="text-sm text-muted">{searchResultSummary}</span>
				{/if}
			</div>

			<div class="flex flex-wrap items-center gap-2">
				{#each [
					{ label: 'Relevance', value: 'relevance' },
					{ label: 'Date', value: 'date' },
					{ label: 'Views', value: 'views' },
					{ label: 'Rating', value: 'rating' }
				] as opt (opt.value)}
					<button
						class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors
							{searchSort === opt.value ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-raised hover:text-cream'}"
						onclick={() => { searchSort = opt.value as typeof searchSort; executeSearch(committedQuery); }}
					>{opt.label}</button>
				{/each}

				<span class="mx-1 text-faint/30">|</span>

				{#each [
					{ label: 'Any length', value: '' },
					{ label: 'Short (<4m)', value: 'short' },
					{ label: 'Medium (4-20m)', value: 'medium' },
					{ label: 'Long (>20m)', value: 'long' }
				] as opt (opt.value)}
					<button
						class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors
							{searchDuration === opt.value ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-raised hover:text-cream'}"
						onclick={() => { searchDuration = opt.value as typeof searchDuration; executeSearch(committedQuery); }}
					>{opt.label}</button>
				{/each}
			</div>

			{#if isSearching}
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each { length: 8 } as _, i (i)}
						<div>
							<div class="aspect-video rounded-xl bg-raised animate-pulse"></div>
							<div class="mt-2.5 space-y-1.5 px-0.5">
								<div class="h-4 w-3/4 rounded bg-raised animate-pulse"></div>
								<div class="h-3 w-1/2 rounded bg-raised animate-pulse"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<!-- Channels -->
				{#if channelResults.length > 0}
					<div class="flex flex-col gap-3">
						<h3 class="flex items-center gap-2 text-sm font-medium text-muted">
							<Users size={14} />
							Channels
						</h3>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{#each channelResults as channel (channel.id)}
								<button
									class="group flex items-center gap-3 rounded-xl border border-cream/[0.04] bg-surface/50 p-3 text-left transition-colors hover:bg-raised/60"
									onclick={() => goto(`/videos/channel/${channel.id}`)}
								>
									{#if channel.thumbnail}
										<img
											src={fixChannelThumb(channel.thumbnail)}
											alt={channel.name}
											class="h-12 w-12 flex-shrink-0 rounded-full object-cover"
											loading="lazy"
										/>
									{:else}
										<div class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-raised text-faint">
											<Users size={18} />
										</div>
									{/if}
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm font-medium text-cream/85 transition-colors group-hover:text-cream">
											{channel.name}
										</p>
										<p class="mt-0.5 text-[11px] text-faint">
											{#if channel.subscribers}{formatCount(channel.subscribers)} subscribers{/if}
											{#if channel.subscribers && channel.videoCount}
												<span class="mx-1 text-faint/40">&middot;</span>
											{/if}
											{#if channel.videoCount}{channel.videoCount} videos{/if}
										</p>
									</div>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Videos -->
				{#if searchResults.length > 0}
					{#if channelResults.length > 0}
						<h3 class="flex items-center gap-2 text-sm font-medium text-muted">
							<PlaySquare size={14} />
							Videos
						</h3>
					{/if}
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{#each searchResults as item (item.id)}
							<VideoCard
								video={toVideoCardMedia(item)}
								layout="grid"
								onclick={() => handleVideoClick(item)}
								onchannelclick={() => goto(`/videos/channel/${item.metadata?.authorId}`)}
							/>
						{/each}
					</div>
				{/if}

				{#if searchResults.length === 0 && channelResults.length === 0}
					<p class="py-10 text-center text-sm text-muted">No results found for "{committedQuery}"</p>
				{/if}
			{/if}
		</section>
	{:else}
		<!-- ====== BROWSING MODE ====== -->

		<!-- Category tabs -->
		<nav class="flex items-center gap-1 overflow-x-auto" aria-label="Video categories">
			{#each categories as cat (cat.href)}
				{@const isActive = data.category === cat.value}
				<a
					href={cat.href}
					class="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors {isActive
						? 'bg-accent/15 text-accent'
						: 'text-muted hover:bg-raised hover:text-cream'}"
					aria-current={isActive ? 'page' : undefined}
				>
					{cat.label}
				</a>
			{/each}
		</nav>

		<!-- Subscription feed — horizontal scrollable row -->
		{#if data.hasLinkedAccount}
			<section>
				<div class="mb-4 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Rss size={18} class="text-accent" />
						<h2 class="font-display text-lg font-semibold text-cream">Your Subscriptions</h2>
					</div>
					<a
						href="/videos/subscriptions"
						class="flex items-center gap-1 text-sm text-muted transition-colors hover:text-cream"
					>
						See all
						<ChevronRight size={14} />
					</a>
				</div>

				{#await data.subscriptionFeed}
					<div class="flex gap-4 overflow-x-auto pb-2">
						{#each { length: 6 } as _, i (i)}
							<div class="w-[280px] flex-shrink-0">
								<div class="aspect-video rounded-xl bg-raised animate-pulse"></div>
								<div class="mt-2.5 space-y-1.5 px-0.5">
									<div class="h-4 w-3/4 rounded bg-raised animate-pulse"></div>
									<div class="h-3 w-1/2 rounded bg-raised animate-pulse"></div>
								</div>
							</div>
						{/each}
					</div>
				{:then feed}
					{#if feed.length > 0}
						<div class="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
							{#each feed.slice(0, 16) as item (item.id)}
								<div class="w-[280px] flex-shrink-0">
									<VideoCard
										video={toVideoCardMedia(item)}
										layout="grid"
										onclick={() => handleVideoClick(item)}
										onchannelclick={() => goto(`/videos/channel/${item.metadata?.authorId}`)}
									/>
								</div>
							{/each}
						</div>
					{:else}
						<p class="py-6 text-center text-sm text-muted">No subscription videos available.</p>
					{/if}
				{:catch}
					<p class="py-6 text-center text-sm text-muted">Failed to load subscription feed.</p>
				{/await}
			</section>
		{/if}

		<!-- Trending -->
		{#if data.trending.length > 0}
			<section>
				<div class="mb-4 flex items-center gap-2">
					<TrendingUp size={18} class="text-steel-light" />
					<h2 class="font-display text-lg font-semibold text-cream">Trending</h2>
				</div>

				<!-- Featured first 2 items -->
				{#if data.trending.length >= 2}
					<div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
						{#each data.trending.slice(0, 2) as item (item.id)}
							<VideoCard
								video={toVideoCardMedia(item)}
								layout="grid"
								onclick={() => handleVideoClick(item)}
								onchannelclick={() => goto(`/videos/channel/${item.metadata?.authorId}`)}
							/>
						{/each}
					</div>
				{/if}

				<!-- Remaining items in standard grid -->
				{#if data.trending.length > 2}
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{#each data.trending.slice(2, trendingLimit) as item (item.id)}
							<VideoCard
								video={toVideoCardMedia(item)}
								layout="grid"
								onclick={() => handleVideoClick(item)}
								onchannelclick={() => goto(`/videos/channel/${item.metadata?.authorId}`)}
							/>
						{/each}
					</div>
				{/if}

				<!-- Infinite scroll sentinel -->
				{#if data.trending.length > trendingLimit}
					<div bind:this={sentinelEl} class="h-4"></div>
				{/if}
			</section>
		{/if}

		{#if data.trending.length === 0 && !data.hasLinkedAccount}
			<div class="flex flex-col items-center justify-center py-20 text-center">
				<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-muted">
					<PlaySquare size={28} strokeWidth={1.5} />
				</div>
				<p class="font-medium text-cream">No videos available</p>
				<p class="mt-1 text-sm text-muted">Check that your Invidious instance is reachable.</p>
			</div>
		{/if}
	{/if}
</div>

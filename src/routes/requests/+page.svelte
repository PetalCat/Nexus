<script lang="ts">
	import type { PageData } from './$types';
	import type { NexusRequest, UnifiedMedia } from '$lib/adapters/types';
	import { invalidateAll, goto } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	// ── Active tab ────────────────────────────────────────
	type Tab = 'discover' | 'mine' | 'pending';
	let activeTab = $state<Tab>('discover');

	// ── Search ────────────────────────────────────────────
	let searchQuery = $state('');
	let searchResults = $state<UnifiedMedia[]>([]);
	let searching = $state(false);

	// ── Discover infinite scroll ──────────────────────────
	let discoverItems = $state<UnifiedMedia[]>(data.initialDiscoverItems);
	let discoverPage = $state(1);
	let discoverHasMore = $state(data.discoverHasMore);
	let loadingMore = $state(false);
	let sentinel = $state<HTMLElement | undefined>(undefined);

	// ── Request action state ──────────────────────────────
	let requestedIds = $state<Set<string>>(new Set());
	let requestingIds = $state<Set<string>>(new Set());
	let errorIds = $state<Set<string>>(new Set());

	// ── My Requests filter ────────────────────────────────
	let myFilter = $state<'all' | 'active' | 'available' | 'declined'>('all');

	// ── Admin queue ───────────────────────────────────────
	let actioning = $state(false);
	let actionResult = $state<{ succeeded: number; failed: number } | null>(null);

	function openMedia(item: UnifiedMedia) {
		goto(`/media/${item.type}/${item.sourceId}?service=${item.serviceId}`);
	}
	function openReq(req: NexusRequest) {
		if (req.tmdbId) goto(`/media/${req.type}/${req.tmdbId}?service=${req.serviceId}`);
	}

	// ── Derived ───────────────────────────────────────────
	const isTyping = $derived(searchQuery.trim().length >= 2);
	const gridItems = $derived(isTyping ? searchResults : discoverItems);
	const myTmdbIds = $derived(new Set(data.myRequests.map((r) => r.tmdbId).filter(Boolean)));

	const filteredMyRequests = $derived(data.myRequests.filter((r) => {
		if (myFilter === 'active') return r.status === 'pending' || r.status === 'approved';
		if (myFilter === 'available') return r.status === 'available';
		if (myFilter === 'declined') return r.status === 'declined';
		return true;
	}));

	const myCounts = $derived({
		all: data.myRequests.length,
		active: data.myRequests.filter(r => r.status === 'pending' || r.status === 'approved').length,
		available: data.myRequests.filter(r => r.status === 'available').length,
		declined: data.myRequests.filter(r => r.status === 'declined').length,
	});

	// ── Live search (debounced) ───────────────────────────
	$effect(() => {
		const q = searchQuery.trim();
		if (q.length < 2) { searchResults = []; searching = false; return; }
		searching = true;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
				const body = await res.json();
				searchResults = (body.items ?? []).filter((i: UnifiedMedia) => i.serviceType === 'overseerr');
			} catch { searchResults = []; }
			finally { searching = false; }
		}, 350);
		return () => clearTimeout(timer);
	});

	// ── IntersectionObserver for infinite scroll ──────────
	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && !loadingMore && discoverHasMore && !isTyping) {
					loadMore();
				}
			},
			{ rootMargin: '300px' }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	});

	async function loadMore() {
		if (loadingMore || !discoverHasMore) return;
		loadingMore = true;
		try {
			const nextPage = discoverPage + 1;
			const res = await fetch(`/api/discover?page=${nextPage}`);
			const body = await res.json();
			// Deduplicate against existing items
			const existingIds = new Set(discoverItems.map(i => i.sourceId));
			const fresh = (body.items ?? []).filter((i: UnifiedMedia) => !existingIds.has(i.sourceId));
			discoverItems = [...discoverItems, ...fresh];
			discoverPage = nextPage;
			discoverHasMore = body.hasMore;
		} catch { /* ignore */ }
		finally { loadingMore = false; }
	}

	// ── Request a media item ──────────────────────────────
	async function requestItem(item: UnifiedMedia) {
		const key = item.id;
		requestingIds = new Set([...requestingIds, key]);
		errorIds = new Set([...errorIds].filter(k => k !== key));
		try {
			const type = item.type === 'show' ? 'tv' : 'movie';
			const res = await fetch('/api/requests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId: item.serviceId, tmdbId: item.sourceId, type })
			});
			const body = await res.json();
			if (body.ok) requestedIds = new Set([...requestedIds, key]);
			else errorIds = new Set([...errorIds, key]);
		} catch { errorIds = new Set([...errorIds, key]); }
		finally { requestingIds = new Set([...requestingIds].filter(k => k !== key)); }
	}

	// ── Admin approve / deny ──────────────────────────────
	async function adminAction(action: 'approve' | 'deny', id: string) {
		actioning = true;
		actionResult = null;
		try {
			const res = await fetch('/api/requests', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, ids: [id] })
			});
			actionResult = await res.json();
			await invalidateAll();
		} catch { /* ignore */ }
		finally { actioning = false; }
	}

	// ── Helpers ───────────────────────────────────────────
	function relativeTime(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 30) return `${days}d ago`;
		return new Date(iso).toLocaleDateString();
	}

	function statusStep(status: NexusRequest['status']): number {
		switch (status) {
			case 'available': return 2;
			case 'approved':  return 1;
			default:          return 0;
		}
	}

	function statusLabel(status: NexusRequest['status']): string {
		switch (status) {
			case 'pending':   return 'Awaiting Approval';
			case 'approved':  return 'Processing';
			case 'available': return 'Ready to Watch';
			case 'declined':  return 'Not Approved';
		}
	}

	function typeLabel(type: string): string {
		switch (type) {
			case 'movie': return 'Movie';
			case 'show':  return 'Series';
			default:      return type;
		}
	}
</script>

<svelte:head>
	<title>Requests — Nexus</title>
</svelte:head>

{#if !data.hasOverseerr}
	<div class="flex flex-col items-center justify-center px-4 py-32 text-center">
		<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)]">
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-nebula)" stroke-width="1.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
		</div>
		<h2 class="text-display text-xl font-bold">No request service connected</h2>
		<p class="mt-2 max-w-sm text-sm text-[var(--color-subtle)]">Connect Overseerr in Settings to allow users to request movies and shows.</p>
		<a href="/settings" class="btn btn-primary mt-5">Open Settings</a>
	</div>
{:else}

	<!-- ══ STICKY TAB BAR ══════════════════════════════════ -->
	<div class="sticky top-14 z-30 border-b border-[var(--color-border)] bg-[var(--color-void)]/95 backdrop-blur-xl">
		<div class="flex items-center gap-0.5 overflow-x-auto scrollbar-none px-3 sm:px-4 lg:px-6">
			<!-- Discover tab -->
			<button
				onclick={() => activeTab = 'discover'}
				class="flex-shrink-0 relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors
					{activeTab === 'discover' ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M14.5 9l-5.5 3.5 5.5 3.5V9z" fill="currentColor" stroke="none"/></svg>
				Discover
				{#if activeTab === 'discover'}
					<span class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--color-nebula)]"></span>
				{/if}
			</button>

			<!-- My Requests tab -->
			<button
				onclick={() => activeTab = 'mine'}
				class="flex-shrink-0 relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors
					{activeTab === 'mine' ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
				My Requests
				{#if data.myRequests.length > 0}
					<span class="rounded-full bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-muted)]">{data.myRequests.length}</span>
				{/if}
				{#if activeTab === 'mine'}
					<span class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--color-nebula)]"></span>
				{/if}
			</button>

			<!-- Pending tab (admin only) -->
			{#if data.isAdmin}
				<button
					onclick={() => activeTab = 'pending'}
					class="flex-shrink-0 relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors
						{activeTab === 'pending' ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
					Pending
					{#if data.adminPending.length > 0}
						<span class="rounded-full bg-[#f59e0b] px-1.5 py-0.5 text-[10px] font-bold text-black">{data.adminPending.length}</span>
					{/if}
					{#if activeTab === 'pending'}
						<span class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--color-nebula)]"></span>
					{/if}
				</button>
			{/if}
		</div>
	</div>

	<!-- ══ TAB CONTENT ════════════════════════════════════ -->

	<!-- ── DISCOVER TAB ── -->
	{#if activeTab === 'discover'}
		<div class="px-3 pt-5 pb-4 sm:px-4 lg:px-6">
			<!-- Sticky search within tab -->
			<div class="relative mb-5">
				<div class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center">
					{#if searching}
						<svg class="animate-spin text-[var(--color-nebula)]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
					{:else}
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-[var(--color-muted)]"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg>
					{/if}
				</div>
				<input
					bind:value={searchQuery}
					class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-raised)] py-2.5 pl-10 pr-9 text-sm text-[var(--color-text)] placeholder-[var(--color-muted)] outline-none transition-all focus:border-[var(--color-nebula)]/50 focus:ring-2 focus:ring-[var(--color-nebula)]/15"
					placeholder="Search for movies, shows, anime…"
					autocomplete="off"
					spellcheck="false"
				/>
				{#if searchQuery}
					<button
						class="absolute inset-y-0 right-3 flex items-center text-[var(--color-muted)] hover:text-[var(--color-text)]"
						onclick={() => (searchQuery = '')}
						aria-label="Clear"
					>
						<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
					</button>
				{/if}
			</div>

			<!-- Section label -->
			<p class="mb-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
				{#if isTyping}
					{searching ? 'Searching…' : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`}
				{:else}
					Trending to Request
				{/if}
			</p>
		</div>

		<!-- Poster grid (no horizontal padding so grid goes edge-to-edge on mobile) -->
		<div class="px-3 sm:px-4 lg:px-6">
			{#if gridItems.length === 0 && !searching && !loadingMore}
				<div class="py-16 text-center">
					<p class="text-sm text-[var(--color-muted)]">{isTyping ? 'No results found.' : 'Nothing available.'}</p>
				</div>
			{:else}
				<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
					{#each gridItems as item (item.id)}
						{@const alreadyReq = requestedIds.has(item.id) || myTmdbIds.has(item.sourceId)}
						{@const isLoading = requestingIds.has(item.id)}
						{@const isAvailable = item.status === 'available'}
						{@const isPending = item.status === 'requested' || item.status === 'downloading'}

						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="group relative cursor-pointer" onclick={() => openMedia(item)}>
							<div class="relative overflow-hidden rounded-xl transition-all duration-200 {''}" style="aspect-ratio:2/3;background:var(--color-surface)">
								{#if item.poster}
									<img
										src={item.poster}
										alt={item.title}
										class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
										loading="lazy"
									/>
								{:else}
									<div class="flex h-full w-full flex-col items-center justify-center gap-1 p-2">
										<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" class="text-[var(--color-muted)]"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20M7 4v4M17 4v4"/></svg>
										<span class="text-center text-[9px] text-[var(--color-muted)] leading-tight line-clamp-3">{item.title}</span>
									</div>
								{/if}

								<!-- Status pip -->
								{#if isAvailable}
									<div class="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-[#00d4aa] backdrop-blur-sm">In Library</div>
								{:else if isPending || alreadyReq}
									<div class="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-[#f59e0b] backdrop-blur-sm">Requested</div>
								{/if}

								<!-- Hover overlay -->
								<div class="absolute inset-0 flex flex-col justify-end opacity-0 transition-opacity duration-200 group-hover:opacity-100"
									style="background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.5) 40%, transparent 70%)">
									<div class="p-2">
										<p class="mb-1.5 text-xs font-semibold text-white line-clamp-2 leading-tight">{item.title}</p>
										{#if item.year}
											<p class="mb-2 text-[10px] text-white/50">{item.year}{item.rating ? ` · ★ ${item.rating.toFixed(1)}` : ''}</p>
										{/if}
										{#if isAvailable}
											{#if item.actionUrl}
												<a href={item.actionUrl} onclick={(e) => e.stopPropagation()}
													class="flex w-full items-center justify-center gap-1 rounded-lg bg-white py-1.5 text-[11px] font-bold text-black hover:bg-white/90">
													<svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3l10 5-10 5V3z"/></svg>
													Watch
												</a>
											{/if}
										{:else if alreadyReq || isPending}
											<div class="flex w-full items-center justify-center gap-1 rounded-lg border border-[#f59e0b]/40 py-1.5 text-[11px] font-semibold text-[#f59e0b]">
												<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 6l3 3 5-5"/></svg>
												Requested
											</div>
										{:else}
											<button
												onclick={(e) => { e.stopPropagation(); requestItem(item); }}
												disabled={isLoading}
												class="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-nebula)] py-1.5 text-[11px] font-bold text-white hover:bg-[var(--color-nebula)]/80 disabled:opacity-60 transition-colors"
											>
												{#if isLoading}
													<svg class="animate-spin" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
												{:else}
													<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 1v10M1 6h10"/></svg>
												{/if}
												{isLoading ? '…' : 'Request'}
											</button>
										{/if}
									</div>
								</div>
							</div>

							<!-- Title below (larger screens) -->
							<div class="mt-1.5 hidden px-0.5 sm:block">
								<p class="truncate text-xs font-medium text-[var(--color-text)]">{item.title}</p>
								{#if item.year}<p class="text-[10px] text-[var(--color-muted)]">{item.year}</p>{/if}
							</div>
						</div>
					{/each}

					<!-- Skeleton cards while loading more -->
					{#if loadingMore || searching}
						{#each Array(6) as _, i (i)}
							<div class="overflow-hidden rounded-xl bg-[var(--color-surface)] animate-pulse" style="aspect-ratio:2/3"></div>
						{/each}
					{/if}
				</div>

				<!-- Infinite scroll sentinel (only for browse mode, not search) -->
				{#if !isTyping}
					<div bind:this={sentinel} class="h-4 w-full"></div>
					{#if !discoverHasMore && discoverItems.length > 0}
						<p class="mt-4 pb-8 text-center text-xs text-[var(--color-muted)]">You've seen it all.</p>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}

	<!-- ── MY REQUESTS TAB ── -->
	{#if activeTab === 'mine'}
		<div class="px-3 py-5 sm:px-4 lg:px-6">

			{#if !data.hasLinkedOverseerr}
				<div class="rounded-2xl border border-dashed border-[var(--color-border)] px-6 py-12 text-center">
					<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface)]">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-nebula)" stroke-width="1.5" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
					</div>
					<p class="font-semibold">Link your account to track requests</p>
					<p class="mt-1.5 text-sm text-[var(--color-subtle)]">Connect your Overseerr account in Settings → My Accounts to see your request history here.</p>
					<a href="/settings" class="btn btn-ghost mt-5 border border-[var(--color-border)] text-sm">Go to Settings</a>
				</div>
			{:else if data.myRequests.length === 0}
				<div class="rounded-2xl border border-dashed border-[var(--color-border)] px-6 py-12 text-center">
					<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface)]">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-nebula)" stroke-width="1.5" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
					</div>
					<p class="font-semibold">No requests yet</p>
					<p class="mt-1.5 text-sm text-[var(--color-subtle)]">Head to Discover and request something.</p>
					<button onclick={() => (activeTab = 'discover')} class="btn btn-ghost mt-5 border border-[var(--color-border)] text-sm">Browse Discover</button>
				</div>
			{:else}
				<!-- Filter tabs -->
				<div class="mb-4 flex gap-1 overflow-x-auto scrollbar-none">
					{#each [
						{ key: 'all',       label: 'All',         count: myCounts.all },
						{ key: 'active',    label: 'In Progress', count: myCounts.active },
						{ key: 'available', label: 'Ready',       count: myCounts.available },
						{ key: 'declined',  label: 'Declined',    count: myCounts.declined },
					] as tab (tab.key)}
						<button
							onclick={() => (myFilter = tab.key as typeof myFilter)}
							class="flex-shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all
								{myFilter === tab.key ? 'bg-[var(--color-raised)] text-[var(--color-text)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
						>
							{tab.label}
							{#if tab.count > 0}
								<span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold
									{myFilter === tab.key ? 'bg-[var(--color-nebula)]/30 text-[var(--color-nebula)]' : 'bg-[var(--color-surface)] text-[var(--color-muted)]'}"
								>{tab.count}</span>
							{/if}
						</button>
					{/each}
				</div>

				{#if filteredMyRequests.length === 0}
					<p class="py-10 text-center text-sm text-[var(--color-muted)]">Nothing in this category.</p>
				{:else}
					<div class="flex flex-col gap-2.5">
						{#each filteredMyRequests as req (req.id)}
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
							<div
								class="group relative cursor-pointer overflow-hidden rounded-2xl transition-all hover:ring-1 hover:ring-[var(--color-border)]
									{''}"
								style="background:var(--color-raised)"
								onclick={() => openReq(req)}
							>
								<!-- Backdrop bleed -->
								{#if req.backdrop}
									<div class="pointer-events-none absolute inset-0 opacity-[0.07]">
										<img src={req.backdrop} alt="" class="h-full w-full object-cover" aria-hidden="true" />
										<div class="absolute inset-0" style="background: linear-gradient(to right, transparent 0%, var(--color-raised) 60%)"></div>
									</div>
								{/if}

								<div class="relative flex items-start gap-4 p-4">
									<!-- Poster -->
									<div class="flex-shrink-0 overflow-hidden rounded-xl shadow-lg" style="width:56px;height:84px;background:var(--color-surface)">
										{#if req.poster}
											<img src={req.poster} alt={req.title} class="h-full w-full object-cover" loading="lazy" />
										{:else}
											<div class="flex h-full w-full items-center justify-center text-[var(--color-muted)]">
												<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20"/></svg>
											</div>
										{/if}
									</div>

									<!-- Info -->
									<div class="flex-1 min-w-0">
										<div class="flex items-start justify-between gap-2">
											<div class="min-w-0">
												<h3 class="truncate font-semibold text-sm">{req.title}</h3>
												<p class="mt-0.5 text-[11px] text-[var(--color-muted)]">
													{#if req.year}{req.year} · {/if}{typeLabel(req.type)}{#if req.rating} · <span class="text-[var(--color-star)]">★ {req.rating.toFixed(1)}</span>{/if}
												</p>
											</div>
											{#if req.status === 'available' && req.mediaUrl}
												<a
													href={req.mediaUrl}
													target="_blank" rel="noopener"
													onclick={(e) => e.stopPropagation()}
													class="flex-shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-black transition hover:bg-white/90 active:scale-95"
												>Watch</a>
											{/if}
										</div>

										{#if req.description}
											<p class="mt-1.5 line-clamp-2 text-[11px] text-[var(--color-subtle)] leading-relaxed">{req.description}</p>
										{/if}

										<!-- Status journey -->
										<div class="mt-3">
											{#if req.status === 'declined'}
												<div class="flex items-center gap-2">
													<div class="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-nova)]/20">
														<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="var(--color-nova)" stroke-width="2" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>
													</div>
													<span class="text-xs font-semibold text-[var(--color-nova)]">Not Approved</span>
													<span class="text-[10px] text-[var(--color-subtle)]">· {relativeTime(req.requestedAt)}</span>
												</div>
											{:else}
												{@const step = statusStep(req.status)}
												<div class="flex items-center">
													{#each [
														{ label: 'Requested', step: 0 },
														{ label: 'Approved',  step: 1 },
														{ label: 'Ready',     step: 2 },
													] as s, i (s.step)}
														<!-- Node -->
														<div class="flex items-center gap-1.5 {i > 0 ? 'flex-1' : ''}">
															{#if i > 0}
																<!-- Connector line -->
																<div class="flex-1 h-px {step >= s.step ? 'bg-[var(--color-nebula)]/50' : 'bg-[var(--color-border)]'}
																	{step >= 2 && s.step === 2 ? 'bg-[#00d4aa]/50' : ''}"></div>
															{/if}
															<div class="flex items-center gap-1">
																<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-all
																	{step >= s.step
																		? s.step === 2
																			? 'bg-[#00d4aa] shadow-[0_0_8px_#00d4aa40]'
																			: 'bg-[var(--color-nebula)] shadow-[0_0_6px_var(--color-nebula-dim)]'
																		: 'border border-[var(--color-border)] bg-[var(--color-surface)]'}">
																	{#if step >= s.step}
																		<svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5l2.5 3 3.5-4.5"/></svg>
																	{/if}
																</div>
																<span class="text-[10px] font-medium
																	{step >= s.step
																		? s.step === 2 ? 'text-[#00d4aa]' : 'text-[var(--color-text)]'
																		: 'text-[var(--color-muted)]'}">{s.label}</span>
															</div>
														</div>
													{/each}
												</div>
												<p class="mt-1.5 text-[10px] text-[var(--color-subtle)]">
													{statusLabel(req.status)} · {relativeTime(req.requestedAt)}
												</p>
											{/if}
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- ── PENDING TAB (admin) ── -->
	{#if activeTab === 'pending' && data.isAdmin}
		<div class="px-3 py-5 sm:px-4 lg:px-6">

			{#if actionResult}
				<div class="mb-4 rounded-xl border px-4 py-2.5 text-sm
					{actionResult.failed === 0
						? 'border-[var(--color-pulsar)]/30 bg-[var(--color-pulsar-dim)] text-[var(--color-pulsar)]'
						: 'border-[var(--color-nova)]/30 bg-[var(--color-nova)]/10 text-[var(--color-nova)]'}">
					{actionResult.succeeded} succeeded{actionResult.failed > 0 ? `, ${actionResult.failed} failed` : ''}
				</div>
			{/if}

			{#if data.adminPending.length === 0}
				<div class="rounded-2xl border border-dashed border-[var(--color-border)] py-14 text-center">
					<p class="text-sm font-medium text-[var(--color-muted)]">All clear — no pending requests.</p>
				</div>
			{:else}
				<p class="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">{data.adminPending.length} awaiting approval</p>
				<div class="flex flex-col gap-2">
					{#each data.adminPending as req (req.id)}
						<div class="flex items-center gap-3 rounded-xl px-3 py-3" style="background:var(--color-raised)">
							<!-- Poster -->
							<div class="flex-shrink-0 overflow-hidden rounded-lg" style="width:44px;height:66px;background:var(--color-surface)">
								{#if req.poster}
									<img src={req.poster} alt={req.title} class="h-full w-full object-cover" loading="lazy" />
								{:else}
									<div class="flex h-full w-full items-center justify-center text-[var(--color-muted)]">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/></svg>
									</div>
								{/if}
							</div>

							<!-- Info -->
							<div class="flex-1 min-w-0">
								<p class="truncate font-medium text-sm">{req.title}</p>
								<p class="text-[11px] text-[var(--color-muted)]">{#if req.year}{req.year} · {/if}{typeLabel(req.type)}</p>
								<div class="mt-1 flex items-center gap-1.5">
									<span class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold" style="background:#7c6cf820;color:var(--color-nebula)">
										{req.requestedByName.slice(0, 1).toUpperCase()}
									</span>
									<span class="truncate text-[11px] text-[var(--color-subtle)]">{req.requestedByName}</span>
									<span class="flex-shrink-0 text-[10px] text-[var(--color-muted)]">· {relativeTime(req.requestedAt)}</span>
								</div>
							</div>

							<!-- Actions -->
							<div class="flex flex-shrink-0 items-center gap-1.5">
								<button
									onclick={() => adminAction('approve', req.id)}
									disabled={actioning}
									class="rounded-lg bg-[var(--color-pulsar)]/15 px-3 py-2 text-xs font-semibold text-[var(--color-pulsar)] transition hover:bg-[var(--color-pulsar)]/25 active:scale-95"
									title="Approve"
								>✓</button>
								<button
									onclick={() => adminAction('deny', req.id)}
									disabled={actioning}
									class="rounded-lg bg-[var(--color-nova)]/15 px-3 py-2 text-xs font-semibold text-[var(--color-nova)] transition hover:bg-[var(--color-nova)]/25 active:scale-95"
									title="Deny"
								>✗</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

{/if}<!-- end hasOverseerr -->

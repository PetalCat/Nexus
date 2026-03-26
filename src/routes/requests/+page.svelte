<script lang="ts">
	import type { PageData } from './$types';
	import type { NexusRequest, UnifiedMedia } from '$lib/adapters/types';
	import { invalidateAll, goto } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';

	let { data }: { data: PageData } = $props();

	// ── Active tab ────────────────────────────────────────
	type Tab = 'discover' | 'mine' | 'requests';
	let activeTab = $state<Tab>('discover');

	// ── Search ────────────────────────────────────────────
	let searchQuery = $state('');
	let searchResults = $state<UnifiedMedia[]>([]);
	let searching = $state(false);

	// ── Discover infinite scroll ──────────────────────────
	let discoverItems = $state<UnifiedMedia[]>([]);
	let discoverPage = $state(1);
	let discoverHasMore = $state(false);
	let discoverLoading = $state(true);
	let loadingMore = $state(false);
	let sentinel = $state<HTMLElement | undefined>(undefined);

	// Load streamed discover data when it resolves
	$effect(() => {
		data.initialDiscover.then((result) => {
			discoverItems = result.items;
			discoverHasMore = result.hasMore;
			discoverLoading = false;
		}).catch(() => { discoverLoading = false; });
	});

	// ── Request action state ──────────────────────────────
	let requestedIds = $state<Set<string>>(new Set());
	let requestingIds = $state<Set<string>>(new Set());
	let errorIds = $state<Set<string>>(new Set());

	// ── Season picker ────────────────────────────────────
	type SeasonInfo = { seasonNumber: number; name: string; episodeCount: number; status: 'available' | 'requested' | 'none' };
	let seasonPickerItem = $state<UnifiedMedia | null>(null);
	let seasonsList = $state<SeasonInfo[]>([]);
	let seasonsLoading = $state(false);
	let selectedSeasons = $state<Set<number>>(new Set());

	const requestableSeasons = $derived(seasonsList.filter(s => s.status === 'none'));
	const allSelected = $derived(requestableSeasons.length > 0 && requestableSeasons.every(s => selectedSeasons.has(s.seasonNumber)));

	function toggleSeason(num: number) {
		const next = new Set(selectedSeasons);
		if (next.has(num)) next.delete(num);
		else next.add(num);
		selectedSeasons = next;
	}

	function toggleAllSeasons() {
		if (allSelected) {
			selectedSeasons = new Set();
		} else {
			selectedSeasons = new Set(requestableSeasons.map(s => s.seasonNumber));
		}
	}

	async function openSeasonPicker(item: UnifiedMedia) {
		seasonPickerItem = item;
		seasonsLoading = true;
		seasonsList = [];
		selectedSeasons = new Set();
		try {
			const res = await fetch(`/api/requests/seasons?serviceId=${item.serviceId}&tmdbId=${item.sourceId}`);
			const body = await res.json();
			seasonsList = body.seasons ?? [];
			// Pre-select all requestable seasons
			selectedSeasons = new Set(
				seasonsList.filter(s => s.status === 'none').map(s => s.seasonNumber)
			);
		} catch { seasonsList = []; toast.error('Failed to load seasons'); }
		finally { seasonsLoading = false; }
	}

	function closeSeasonPicker() {
		seasonPickerItem = null;
		seasonsList = [];
		selectedSeasons = new Set();
	}

	async function confirmSeasonRequest() {
		if (!seasonPickerItem || selectedSeasons.size === 0) return;
		const item = seasonPickerItem;
		closeSeasonPicker();
		await doRequest(item, [...selectedSeasons]);
	}

	// ── Discover filters ─────────────────────────────────
	let typeFilter = $state<'all' | 'movie' | 'show'>('all');
	let genreFilter = $state<string | null>(null);
	let yearPreset = $state<string>('any');
	let ratingMin = $state(0);
	let sortBy = $state<'default' | 'rating' | 'year' | 'title'>('default');
	let showFilters = $state(false);

	// Dropdown open states
	let genreOpen = $state(false);
	let yearOpen = $state(false);
	let ratingOpen = $state(false);
	let sortOpen = $state(false);

	const yearPresets: Record<string, [number, number] | null> = {
		any: null,
		'2025–2026': [2025, 2026],
		'2020–2024': [2020, 2024],
		'2015–2019': [2015, 2019],
		'Before 2015': [0, 2014],
	};

	const activeFilterCount = $derived(
		(typeFilter !== 'all' ? 1 : 0) +
		(genreFilter ? 1 : 0) +
		(yearPreset !== 'any' ? 1 : 0) +
		(ratingMin > 0 ? 1 : 0) +
		(sortBy !== 'default' ? 1 : 0)
	);

	const availableGenres = $derived.by(() => {
		const set = new Set<string>();
		for (const item of gridItems) {
			if (item.genres) for (const g of item.genres) set.add(g);
		}
		return [...set].sort();
	});

	const filteredGridItems = $derived.by(() => {
		let items = gridItems;
		if (typeFilter !== 'all') items = items.filter(i => i.type === typeFilter);
		if (genreFilter) items = items.filter(i => i.genres?.includes(genreFilter!));
		if (yearPreset !== 'any') {
			const range = yearPresets[yearPreset];
			if (range) items = items.filter(i => i.year && i.year >= range[0] && i.year <= range[1]);
		}
		if (ratingMin > 0) items = items.filter(i => i.rating && i.rating >= ratingMin);
		if (sortBy === 'rating') items = [...items].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
		else if (sortBy === 'year') items = [...items].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
		else if (sortBy === 'title') items = [...items].sort((a, b) => a.title.localeCompare(b.title));
		return items;
	});

	function clearAllFilters() {
		typeFilter = 'all';
		genreFilter = null;
		yearPreset = 'any';
		ratingMin = 0;
		sortBy = 'default';
	}

	function closeAllDropdowns() {
		genreOpen = false;
		yearOpen = false;
		ratingOpen = false;
		sortOpen = false;
	}

	// ── My Requests filter ────────────────────────────────
	let myFilter = $state<'all' | 'active' | 'available' | 'declined'>('all');

	// ── Admin unified filter ─────────────────────────────
	let adminFilter = $state<'all' | 'pending' | 'processing' | 'available' | 'declined'>('all');

	const mySourceIds = $derived(new Set(data.myRequests.map(r => r.sourceId)));

	const filteredAllRequests = $derived(data.allRequests.filter((r) => {
		if (adminFilter === 'pending') return r.status === 'pending';
		if (adminFilter === 'processing') return r.status === 'approved';
		if (adminFilter === 'available') return r.status === 'available' || r.status === 'partial';
		if (adminFilter === 'declined') return r.status === 'declined';
		return true;
	}));

	const adminCounts = $derived({
		all: data.allRequests.length,
		pending: data.allRequests.filter(r => r.status === 'pending').length,
		processing: data.allRequests.filter(r => r.status === 'approved').length,
		available: data.allRequests.filter(r => r.status === 'available' || r.status === 'partial').length,
		declined: data.allRequests.filter(r => r.status === 'declined').length,
	});

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
		if (myFilter === 'available') return r.status === 'available' || r.status === 'partial';
		if (myFilter === 'declined') return r.status === 'declined';
		return true;
	}));

	const myCounts = $derived({
		all: data.myRequests.length,
		active: data.myRequests.filter(r => r.status === 'pending' || r.status === 'approved').length,
		available: data.myRequests.filter(r => r.status === 'available' || r.status === 'partial').length,
		declined: data.myRequests.filter(r => r.status === 'declined').length,
	});

	// ── Close dropdowns on outside click / Escape ────────
	$effect(() => {
		function onClickOutside() { closeAllDropdowns(); }
		function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') closeAllDropdowns(); }
		window.addEventListener('click', onClickOutside);
		window.addEventListener('keydown', onKeydown);
		return () => {
			window.removeEventListener('click', onClickOutside);
			window.removeEventListener('keydown', onKeydown);
		};
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
		} catch { toast.error('Failed to load more'); }
		finally { loadingMore = false; }
	}

	// ── Request a media item ──────────────────────────────
	function requestItem(item: UnifiedMedia) {
		if (item.type === 'show') {
			openSeasonPicker(item);
		} else {
			doRequest(item);
		}
	}

	async function doRequest(item: UnifiedMedia, seasons?: number[]) {
		const key = item.id;
		requestingIds = new Set([...requestingIds, key]);
		errorIds = new Set([...errorIds].filter(k => k !== key));
		try {
			const type = item.type === 'show' ? 'tv' : 'movie';
			const payload: Record<string, unknown> = { serviceId: item.serviceId, tmdbId: item.sourceId, type };
			if (seasons && seasons.length > 0) payload.seasons = seasons;
			const res = await fetch('/api/requests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
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
		} catch { toast.error('Request action failed'); }
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
			case 'available':
			case 'partial':   return 2;
			case 'approved':  return 1;
			default:          return 0;
		}
	}

	function statusLabel(status: NexusRequest['status']): string {
		switch (status) {
			case 'pending':   return 'Awaiting Approval';
			case 'approved':  return 'Processing';
			case 'available': return 'In Library';
			case 'partial':   return 'Partially Available';
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
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
		</div>
		<h2 class="text-display text-xl font-bold">No request service connected</h2>
		<p class="mt-2 max-w-sm text-sm text-[var(--color-muted)]">Connect Overseerr in Settings to allow users to request movies and shows.</p>
		<a href="/settings/accounts" class="btn btn-primary mt-5">Open Settings</a>
	</div>
{:else}

	<!-- ══ STICKY TAB BAR ══════════════════════════════════ -->
	<div class="sticky top-0 z-20 border-b border-[rgba(240,235,227,0.06)] bg-[var(--color-void)]/95 backdrop-blur-xl">
		<div class="flex items-center gap-0.5 overflow-x-auto scrollbar-none px-3 sm:px-4 lg:px-6">
			<!-- Discover tab -->
			<button
				onclick={() => activeTab = 'discover'}
				class="flex-shrink-0 relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors
					{activeTab === 'discover' ? 'text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M14.5 9l-5.5 3.5 5.5 3.5V9z" fill="currentColor" stroke="none"/></svg>
				Discover
				{#if activeTab === 'discover'}
					<span class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--color-accent)]"></span>
				{/if}
			</button>

			<!-- Requests tab (admin: unified) / My Requests (non-admin) -->
			{#if data.isAdmin}
				<button
					onclick={() => activeTab = 'requests'}
					class="flex-shrink-0 relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors
						{activeTab === 'requests' ? 'text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
					Requests
					{#if data.allRequests.length > 0}
						<span class="rounded-full bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-muted)]">{data.allRequests.length}</span>
					{/if}
					{#if adminCounts.pending > 0}
						<span class="rounded-full bg-[#f59e0b] px-1.5 py-0.5 text-[10px] font-bold text-black">{adminCounts.pending}</span>
					{/if}
					{#if activeTab === 'requests'}
						<span class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--color-accent)]"></span>
					{/if}
				</button>
			{:else}
				<button
					onclick={() => activeTab = 'mine'}
					class="flex-shrink-0 relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors
						{activeTab === 'mine' ? 'text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
					My Requests
					{#if data.myRequests.length > 0}
						<span class="rounded-full bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-muted)]">{data.myRequests.length}</span>
					{/if}
					{#if activeTab === 'mine'}
						<span class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--color-accent)]"></span>
					{/if}
				</button>
			{/if}
		</div>

		<!-- Search + filters (Discover tab only) -->
		{#if activeTab === 'discover'}
			<div class="px-3 pt-3 pb-2.5 sm:px-4 lg:px-6">
				<!-- Search input -->
				<div class="relative mb-2.5">
					<div class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center">
						{#if searching}
							<svg class="animate-spin text-[var(--color-accent)]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
						{:else}
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-[var(--color-muted)]"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg>
						{/if}
					</div>
					<input
						bind:value={searchQuery}
						class="w-full rounded-xl border border-[rgba(240,235,227,0.06)] bg-[var(--color-raised)] py-2.5 pl-10 pr-9 text-sm text-[var(--color-cream)] placeholder-[var(--color-muted)] outline-none transition-all focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent)]/15"
						placeholder="Search for movies, shows, anime…"
						autocomplete="off"
						spellcheck="false"
					/>
					{#if searchQuery}
						<button
							class="absolute inset-y-0 right-3 flex items-center text-[var(--color-muted)] hover:text-[var(--color-cream)]"
							onclick={() => (searchQuery = '')}
							aria-label="Clear"
						>
							<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
						</button>
					{/if}
				</div>

				<!-- Filter bar -->
				<div class="flex flex-wrap items-center gap-2">
				<!-- Type pills -->
				{#each [
					{ key: 'all', label: 'All' },
					{ key: 'movie', label: 'Movies' },
					{ key: 'show', label: 'Shows' },
				] as pill (pill.key)}
					<button
						onclick={() => (typeFilter = pill.key as typeof typeFilter)}
						class="rounded-lg px-3 py-1.5 text-xs font-medium transition-all
							{typeFilter === pill.key
								? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30'
								: 'bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
					>{pill.label}</button>
				{/each}

				<div class="h-4 w-px bg-[rgba(240,235,227,0.08)]"></div>

				<!-- Genre dropdown -->
				{#if availableGenres.length > 0}
					<div class="relative">
						<button
							onclick={(e) => { e.stopPropagation(); closeAllDropdowns(); genreOpen = !genreOpen; }}
							class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all
								{genreFilter
									? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30'
									: 'bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
						>
							{genreFilter ?? 'Genre'}
							<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4L5 6.5 7.5 4"/></svg>
						</button>
						{#if genreOpen}
							<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
							<div
								class="absolute left-0 top-full z-30 mt-1 max-h-60 w-48 overflow-y-auto overscroll-contain rounded-xl border border-[rgba(240,235,227,0.08)] bg-[var(--color-raised)] p-1 shadow-xl"
								onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
							>
								<button
									onclick={() => { genreFilter = null; genreOpen = false; }}
									class="w-full rounded-lg px-3 py-2 text-left text-xs transition-colors
										{!genreFilter ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'text-[var(--color-body)] hover:bg-[rgba(240,235,227,0.04)]'}"
								>Any Genre</button>
								{#each availableGenres as g (g)}
									<button
										onclick={() => { genreFilter = g; genreOpen = false; }}
										class="w-full rounded-lg px-3 py-2 text-left text-xs transition-colors
											{genreFilter === g ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'text-[var(--color-body)] hover:bg-[rgba(240,235,227,0.04)]'}"
									>{g}</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Year dropdown -->
				<div class="relative">
					<button
						onclick={(e) => { e.stopPropagation(); closeAllDropdowns(); yearOpen = !yearOpen; }}
						class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all
							{yearPreset !== 'any'
								? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30'
								: 'bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
					>
						{yearPreset === 'any' ? 'Year' : yearPreset}
						<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4L5 6.5 7.5 4"/></svg>
					</button>
					{#if yearOpen}
						<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
						<div
							class="absolute left-0 top-full z-30 mt-1 w-40 rounded-xl border border-[rgba(240,235,227,0.08)] bg-[var(--color-raised)] p-1 shadow-xl"
							onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
						>
							{#each Object.keys(yearPresets) as key (key)}
								<button
									onclick={() => { yearPreset = key; yearOpen = false; }}
									class="w-full rounded-lg px-3 py-2 text-left text-xs transition-colors
										{yearPreset === key ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'text-[var(--color-body)] hover:bg-[rgba(240,235,227,0.04)]'}"
								>{key === 'any' ? 'Any Year' : key}</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Rating dropdown -->
				<div class="relative">
					<button
						onclick={(e) => { e.stopPropagation(); closeAllDropdowns(); ratingOpen = !ratingOpen; }}
						class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all
							{ratingMin > 0
								? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30'
								: 'bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
					>
						{ratingMin > 0 ? `★ ${ratingMin}+` : 'Rating'}
						<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4L5 6.5 7.5 4"/></svg>
					</button>
					{#if ratingOpen}
						<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
						<div
							class="absolute left-0 top-full z-30 mt-1 w-32 rounded-xl border border-[rgba(240,235,227,0.08)] bg-[var(--color-raised)] p-1 shadow-xl"
							onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
						>
							{#each [
								{ value: 0, label: 'Any Rating' },
								{ value: 7, label: '★ 7+' },
								{ value: 8, label: '★ 8+' },
								{ value: 9, label: '★ 9+' },
							] as opt (opt.value)}
								<button
									onclick={() => { ratingMin = opt.value; ratingOpen = false; }}
									class="w-full rounded-lg px-3 py-2 text-left text-xs transition-colors
										{ratingMin === opt.value ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'text-[var(--color-body)] hover:bg-[rgba(240,235,227,0.04)]'}"
								>{opt.label}</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Sort dropdown -->
				<div class="relative">
					<button
						onclick={(e) => { e.stopPropagation(); closeAllDropdowns(); sortOpen = !sortOpen; }}
						class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all
							{sortBy !== 'default'
								? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30'
								: 'bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
					>
						{sortBy === 'default' ? 'Sort' : sortBy === 'rating' ? 'Rating ↓' : sortBy === 'year' ? 'Newest' : 'A–Z'}
						<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4L5 6.5 7.5 4"/></svg>
					</button>
					{#if sortOpen}
						<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
						<div
							class="absolute left-0 top-full z-30 mt-1 w-36 rounded-xl border border-[rgba(240,235,227,0.08)] bg-[var(--color-raised)] p-1 shadow-xl"
							onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
						>
							{#each [
								{ key: 'default', label: 'Default' },
								{ key: 'rating', label: 'Rating ↓' },
								{ key: 'year', label: 'Newest' },
								{ key: 'title', label: 'A–Z' },
							] as opt (opt.key)}
								<button
									onclick={() => { sortBy = opt.key as typeof sortBy; sortOpen = false; }}
									class="w-full rounded-lg px-3 py-2 text-left text-xs transition-colors
										{sortBy === opt.key ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'text-[var(--color-body)] hover:bg-[rgba(240,235,227,0.04)]'}"
								>{opt.label}</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Clear all -->
				{#if activeFilterCount > 0}
					<button
						onclick={clearAllFilters}
						class="ml-auto text-[11px] font-medium text-[var(--color-accent)] hover:underline"
					>{activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} · Clear all</button>
				{/if}
			</div>
			</div>
		{/if}
	</div>

	<!-- ══ TAB CONTENT ════════════════════════════════════ -->

	<!-- ── DISCOVER TAB ── -->
	{#if activeTab === 'discover'}
		<!-- Section label -->
		<div class="px-3 pt-4 pb-3 sm:px-4 lg:px-6">
			<p class="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
				{#if isTyping}
					{searching ? 'Searching…' : `${filteredGridItems.length} result${filteredGridItems.length !== 1 ? 's' : ''}`}
				{:else if activeFilterCount > 0}
					{filteredGridItems.length} match{filteredGridItems.length !== 1 ? 'es' : ''}
				{:else}
					Trending to Request
				{/if}
			</p>
		</div>

		<!-- Poster grid -->
		<div class="px-3 sm:px-4 lg:px-6">
			{#if discoverLoading && !isTyping}
				<!-- Skeleton while discover data streams in -->
				<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
					{#each Array(12) as _, i (i)}
						<div class="overflow-hidden rounded-xl bg-[var(--color-surface)] animate-pulse" style="aspect-ratio:2/3"></div>
					{/each}
				</div>
			{:else if filteredGridItems.length === 0 && !searching && !loadingMore}
				<div class="py-16 text-center">
					<p class="text-sm text-[var(--color-muted)]">{isTyping ? 'No results found.' : activeFilterCount > 0 ? 'No items match your filters.' : 'Nothing available.'}</p>
					{#if activeFilterCount > 0}
						<button onclick={clearAllFilters} class="mt-2 text-xs text-[var(--color-accent)] hover:underline">Clear filters</button>
					{/if}
				</div>
			{:else}
				<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
					{#each filteredGridItems as item (item.id)}
						{@const alreadyReq = requestedIds.has(item.id) || myTmdbIds.has(item.sourceId)}
						{@const isLoading = requestingIds.has(item.id)}
						{@const isAvailable = item.status === 'available'}
						{@const isPending = item.status === 'requested' || item.status === 'downloading'}

						
						<div class="group relative cursor-pointer" onclick={() => openMedia(item)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openMedia(item); }} role="button" tabindex="0">
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
										<p class="mb-1.5 text-xs font-semibold text-cream line-clamp-2 leading-tight">{item.title}</p>
										{#if item.year}
											<p class="mb-2 text-[10px] text-cream/50">{item.year}{item.rating ? ` · ★ ${item.rating.toFixed(1)}` : ''}</p>
										{/if}
										{#if isAvailable}
											{#if item.actionUrl}
												<a href={item.actionUrl} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
													class="flex w-full items-center justify-center gap-1 rounded-lg bg-cream py-1.5 text-[11px] font-bold text-black hover:bg-cream/90">
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
												class="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] py-1.5 text-[11px] font-bold text-cream hover:bg-[var(--color-accent)]/80 disabled:opacity-60 transition-colors"
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
								<p class="truncate text-xs font-medium text-[var(--color-cream)]">{item.title}</p>
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
	{#if activeTab === 'mine' && !data.isAdmin}
		<div class="px-3 py-5 sm:px-4 lg:px-6">

			{#if !data.hasLinkedOverseerr}
				<div class="rounded-2xl border border-dashed border-[rgba(240,235,227,0.06)] px-6 py-12 text-center">
					<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface)]">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
					</div>
					<p class="font-semibold">Link your account to track requests</p>
					<p class="mt-1.5 text-sm text-[var(--color-muted)]">Connect your Overseerr account in Settings → My Accounts to see your request history here.</p>
					<a href="/settings/accounts" class="btn btn-ghost mt-5 border border-[rgba(240,235,227,0.06)] text-sm">Go to Settings</a>
				</div>
			{:else if data.myRequests.length === 0}
				<div class="rounded-2xl border border-dashed border-[rgba(240,235,227,0.06)] px-6 py-12 text-center">
					<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface)]">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
					</div>
					<p class="font-semibold">No requests yet</p>
					<p class="mt-1.5 text-sm text-[var(--color-muted)]">Head to Discover and request something.</p>
					<button onclick={() => (activeTab = 'discover')} class="btn btn-ghost mt-5 border border-[rgba(240,235,227,0.06)] text-sm">Browse Discover</button>
				</div>
			{:else}
				<!-- Filter tabs -->
				<div class="mb-4 flex gap-1 overflow-x-auto scrollbar-none">
					{#each [
						{ key: 'all',       label: 'All',         count: myCounts.all },
						{ key: 'active',    label: 'In Progress', count: myCounts.active },
						{ key: 'available', label: 'In Library',  count: myCounts.available },
						{ key: 'declined',  label: 'Declined',    count: myCounts.declined },
					] as tab (tab.key)}
						<button
							onclick={() => (myFilter = tab.key as typeof myFilter)}
							class="flex-shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all
								{myFilter === tab.key ? 'bg-[var(--color-raised)] text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
						>
							{tab.label}
							{#if tab.count > 0}
								<span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold
									{myFilter === tab.key ? 'bg-[var(--color-accent)]/30 text-[var(--color-accent)]' : 'bg-[var(--color-surface)] text-[var(--color-muted)]'}"
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
							
							<div
								class="group relative cursor-pointer overflow-hidden rounded-2xl transition-all hover:ring-1 hover:ring-[rgba(240,235,227,0.06)]
									{''}"
								style="background:var(--color-raised)"
								onclick={() => openReq(req)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openReq(req); }} role="button" tabindex="0"
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
													{#if req.year}{req.year} · {/if}{typeLabel(req.type)}{#if req.rating} · <span class="text-[var(--color-accent)]">★ {req.rating.toFixed(1)}</span>{/if}
												</p>
											</div>
											{#if req.status === 'available' && req.mediaUrl}
												<a
													href={req.mediaUrl}
													target="_blank" rel="noopener"
													onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
													class="flex-shrink-0 rounded-lg bg-cream px-2.5 py-1.5 text-[11px] font-bold text-black transition hover:bg-cream/90 active:scale-95"
												>Watch</a>
											{/if}
										</div>

										{#if req.description}
											<p class="mt-1.5 line-clamp-2 text-[11px] text-[var(--color-muted)] leading-relaxed">{req.description}</p>
										{/if}

										<!-- Status journey -->
										<div class="mt-3">
											{#if req.status === 'declined'}
												<div class="flex items-center gap-2">
													<div class="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-warm)]/20">
														<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="var(--color-warm)" stroke-width="2" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>
													</div>
													<span class="text-xs font-semibold text-[var(--color-warm)]">Not Approved</span>
													<span class="text-[10px] text-[var(--color-muted)]">· {relativeTime(req.requestedAt)}</span>
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
																<div class="flex-1 h-px {step >= s.step ? 'bg-[var(--color-accent)]/50' : 'bg-[rgba(240,235,227,0.06)]'}
																	{step >= 2 && s.step === 2 ? 'bg-[#00d4aa]/50' : ''}"></div>
															{/if}
															<div class="flex items-center gap-1">
																<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-all
																	{step >= s.step
																		? s.step === 2
																			? 'bg-[#00d4aa] shadow-[0_0_8px_#00d4aa40]'
																			: 'bg-[var(--color-accent)] shadow-[0_0_6px_rgba(212,162,83,0.12)]'
																		: 'border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)]'}">
																	{#if step >= s.step}
																		<svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5l2.5 3 3.5-4.5"/></svg>
																	{/if}
																</div>
																<span class="text-[10px] font-medium
																	{step >= s.step
																		? s.step === 2 ? 'text-[#00d4aa]' : 'text-[var(--color-cream)]'
																		: 'text-[var(--color-muted)]'}">{s.label}</span>
															</div>
														</div>
													{/each}
												</div>
												<p class="mt-1.5 text-[10px] text-[var(--color-muted)]">
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

	<!-- ── ADMIN UNIFIED REQUESTS TAB ── -->
	{#if activeTab === 'requests' && data.isAdmin}
		<div class="px-3 py-5 sm:px-4 lg:px-6">

			<!-- Filter tabs -->
			<div class="mb-4 flex gap-1 overflow-x-auto scrollbar-none">
				{#each [
					{ key: 'all',        label: 'All',        count: adminCounts.all },
					{ key: 'pending',    label: 'Pending',    count: adminCounts.pending },
					{ key: 'processing', label: 'Processing', count: adminCounts.processing },
					{ key: 'available',  label: 'In Library', count: adminCounts.available },
					{ key: 'declined',   label: 'Declined',   count: adminCounts.declined },
				] as tab (tab.key)}
					<button
						onclick={() => (adminFilter = tab.key as typeof adminFilter)}
						class="flex-shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all
							{adminFilter === tab.key ? 'bg-[var(--color-raised)] text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
					>
						{tab.label}
						{#if tab.count > 0}
							<span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold
								{adminFilter === tab.key ? 'bg-[var(--color-accent)]/30 text-[var(--color-accent)]' : 'bg-[var(--color-surface)] text-[var(--color-muted)]'}
								{tab.key === 'pending' && adminFilter !== 'pending' && tab.count > 0 ? '!bg-[#f59e0b] !text-black !font-bold' : ''}"
							>{tab.count}</span>
						{/if}
					</button>
				{/each}
			</div>

			{#if filteredAllRequests.length === 0}
				<p class="py-10 text-center text-sm text-[var(--color-muted)]">
					{adminFilter === 'all' ? 'No requests yet.' : 'Nothing in this category.'}
				</p>
			{:else}
				<div class="flex flex-col gap-2">
					{#each filteredAllRequests as req (req.id)}
						{@const isOwn = mySourceIds.has(req.sourceId)}
						
						<div
							class="group flex items-center gap-3 rounded-xl px-3 py-3 cursor-pointer transition-all hover:ring-1 hover:ring-[rgba(240,235,227,0.06)]"
							style="background:var(--color-raised)"
							onclick={() => openReq(req)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openReq(req); }} role="button" tabindex="0"
						>
							<!-- Poster -->
							<div class="flex-shrink-0 overflow-hidden rounded-lg" style="width:40px;height:60px;background:var(--color-surface)">
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
								<div class="flex items-center gap-1.5">
									<h3 class="truncate font-semibold text-sm">{req.title}</h3>
									{#if isOwn}
										<span class="flex-shrink-0 rounded bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[9px] font-bold text-[var(--color-accent)]">YOU</span>
									{/if}
								</div>
								<p class="mt-0.5 text-[11px] text-[var(--color-muted)]">
									{#if req.year}{req.year} · {/if}{typeLabel(req.type)}{#if req.rating} · <span class="text-[var(--color-accent)]">★ {req.rating.toFixed(1)}</span>{/if}
								</p>
								<div class="mt-1.5 flex items-center gap-1.5">
									<span class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold" style="background:var(--color-accent)20;color:var(--color-accent)">
										{req.requestedByName.slice(0, 1).toUpperCase()}
									</span>
									<span class="truncate text-[11px] text-[var(--color-muted)]">{req.requestedByName}</span>
									<span class="flex-shrink-0 text-[10px] text-[var(--color-muted)]">· {relativeTime(req.requestedAt)}</span>
									<!-- Status badge -->
									{#if req.status === 'pending'}
										<span class="flex-shrink-0 rounded-full bg-[#f59e0b]/15 px-2 py-0.5 text-[9px] font-semibold text-[#f59e0b]">Pending</span>
									{:else if req.status === 'approved'}
										<span class="flex-shrink-0 rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[9px] font-semibold text-[var(--color-accent)]">Processing</span>
									{:else if req.status === 'available' || req.status === 'partial'}
										<span class="flex-shrink-0 rounded-full bg-[#00d4aa]/15 px-2 py-0.5 text-[9px] font-semibold text-[#00d4aa]">{req.status === 'partial' ? 'Partial' : 'In Library'}</span>
									{:else if req.status === 'declined'}
										<span class="flex-shrink-0 rounded-full bg-[var(--color-warm)]/15 px-2 py-0.5 text-[9px] font-semibold text-[var(--color-warm)]">Declined</span>
									{/if}
								</div>
							</div>

							<!-- Actions -->
							<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
							<div class="flex flex-shrink-0 items-center gap-1.5" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
								{#if req.status === 'pending'}
									<button
										onclick={() => adminAction('approve', req.id)}
										disabled={actioning}
										class="rounded-lg bg-[var(--color-steel)]/15 px-3 py-2 text-xs font-semibold text-[var(--color-steel)] transition hover:bg-[var(--color-steel)]/25 active:scale-95"
										title="Approve"
									>✓</button>
									<button
										onclick={() => adminAction('deny', req.id)}
										disabled={actioning}
										class="rounded-lg bg-[var(--color-warm)]/15 px-3 py-2 text-xs font-semibold text-[var(--color-warm)] transition hover:bg-[var(--color-warm)]/25 active:scale-95"
										title="Deny"
									>✗</button>
								{:else if (req.status === 'available' || req.status === 'partial') && req.mediaUrl}
									<a
										href={req.mediaUrl}
										target="_blank" rel="noopener"
										class="rounded-lg bg-cream px-2.5 py-1.5 text-[11px] font-bold text-black transition hover:bg-cream/90 active:scale-95"
									>Watch</a>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			{#if actionResult}
				<div class="mt-4 rounded-xl border px-4 py-2.5 text-sm
					{actionResult.failed === 0
						? 'border-[var(--color-steel)]/30 bg-[rgba(61,143,132,0.1)] text-[var(--color-steel)]'
						: 'border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 text-[var(--color-warm)]'}">
					{actionResult.succeeded} succeeded{actionResult.failed > 0 ? `, ${actionResult.failed} failed` : ''}
				</div>
			{/if}
		</div>
	{/if}

{/if}<!-- end hasOverseerr -->

<!-- ══ SEASON PICKER MODAL ════════════════════════════ -->
{#if seasonPickerItem}
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);"
		onclick={(e) => { if (e.target === e.currentTarget) closeSeasonPicker(); }}
		onkeydown={(e) => { if (e.key === 'Escape') closeSeasonPicker(); }}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Select seasons to request"
			class="w-full max-w-md overflow-hidden rounded-2xl border border-[rgba(240,235,227,0.08)]"
			style="background: rgba(13, 11, 10, 0.9); backdrop-filter: blur(24px) saturate(1.4); box-shadow: 0 24px 80px rgba(0,0,0,0.5);"
		>
			<!-- Header -->
			<div class="flex items-center gap-3 border-b border-[rgba(240,235,227,0.06)] px-5 py-4">
				{#if seasonPickerItem.poster}
					<img src={seasonPickerItem.poster} alt="" class="h-14 w-10 rounded-lg object-cover flex-shrink-0" />
				{/if}
				<div class="min-w-0 flex-1">
					<h3 class="truncate font-semibold text-sm text-[var(--color-cream)]">{seasonPickerItem.title}</h3>
					<p class="text-[11px] text-[var(--color-muted)]">Select seasons to request</p>
				</div>
				<button
					onclick={closeSeasonPicker}
					class="flex-shrink-0 rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[rgba(240,235,227,0.06)] hover:text-[var(--color-cream)] transition-colors"
					aria-label="Close"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
				</button>
			</div>

			<!-- Season list -->
			<div class="max-h-[50vh] overflow-y-auto overscroll-contain p-4">
				{#if seasonsLoading}
					<div class="flex items-center justify-center py-8">
						<svg class="animate-spin text-[var(--color-accent)]" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
					</div>
				{:else if seasonsList.length === 0}
					<p class="py-8 text-center text-sm text-[var(--color-muted)]">No season information available.</p>
				{:else}
					<!-- All toggle -->
					{#if requestableSeasons.length > 1}
						<button
							onclick={toggleAllSeasons}
							class="mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[rgba(240,235,227,0.04)]"
						>
							<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-all
								{allSelected
									? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
									: 'border-[rgba(240,235,227,0.15)] bg-transparent'}"
							>
								{#if allSelected}
									<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><path d="M2 5l2.5 3 3.5-4.5"/></svg>
								{/if}
							</div>
							<span class="text-sm font-medium text-[var(--color-cream)]">All Seasons</span>
							<span class="ml-auto text-[11px] text-[var(--color-muted)]">{requestableSeasons.length} available</span>
						</button>
						<div class="mb-2 border-b border-[rgba(240,235,227,0.04)]"></div>
					{/if}

					<div class="flex flex-col gap-0.5">
						{#each seasonsList as season (season.seasonNumber)}
							{@const isAvailable = season.status === 'available'}
							{@const isRequested = season.status === 'requested'}
							{@const isDisabled = isAvailable || isRequested}
							{@const isSelected = selectedSeasons.has(season.seasonNumber)}
							<button
								onclick={() => { if (!isDisabled) toggleSeason(season.seasonNumber); }}
								disabled={isDisabled}
								class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-colors
									{isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[rgba(240,235,227,0.04)] cursor-pointer'}"
							>
								<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-all
									{isDisabled
										? 'border-[rgba(240,235,227,0.08)] bg-[rgba(240,235,227,0.04)]'
										: isSelected
											? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
											: 'border-[rgba(240,235,227,0.15)] bg-transparent'}"
								>
									{#if isAvailable}
										<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--color-steel)" stroke-width="2" stroke-linecap="round"><path d="M2 5l2.5 3 3.5-4.5"/></svg>
									{:else if isRequested}
										<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3" stroke-linecap="round"/></svg>
									{:else if isSelected}
										<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><path d="M2 5l2.5 3 3.5-4.5"/></svg>
									{/if}
								</div>
								<div class="flex-1 text-left">
									<span class="text-sm font-medium
										{isDisabled ? 'text-[var(--color-muted)]' : 'text-[var(--color-cream)]'}"
									>{season.name}</span>
								</div>
								{#if season.episodeCount > 0}
									<span class="text-[11px] text-[var(--color-muted)]">{season.episodeCount} ep{season.episodeCount !== 1 ? 's' : ''}</span>
								{/if}
								{#if isAvailable}
									<span class="rounded-full bg-[#00d4aa]/15 px-2 py-0.5 text-[10px] font-semibold text-[#00d4aa]">In Library</span>
								{:else if isRequested}
									<span class="rounded-full bg-[#f59e0b]/15 px-2 py-0.5 text-[10px] font-semibold text-[#f59e0b]">Requested</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			{#if !seasonsLoading && seasonsList.length > 0}
				<div class="flex items-center justify-between border-t border-[rgba(240,235,227,0.06)] px-5 py-3.5">
					<span class="text-[11px] text-[var(--color-muted)]">
						{selectedSeasons.size} season{selectedSeasons.size !== 1 ? 's' : ''} selected
					</span>
					<div class="flex items-center gap-2">
						<button
							onclick={closeSeasonPicker}
							class="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]"
						>Cancel</button>
						<button
							onclick={confirmSeasonRequest}
							disabled={selectedSeasons.size === 0}
							class="rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-xs font-bold text-cream transition-all hover:bg-[var(--color-accent)]/80 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
						>Request {selectedSeasons.size > 0 ? `(${selectedSeasons.size})` : ''}</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

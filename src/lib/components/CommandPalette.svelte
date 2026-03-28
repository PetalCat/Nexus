<script lang="ts">
	import { goto } from '$app/navigation';
	import { Search, X, Clock, ArrowUp, ArrowDown, CornerDownLeft, Star, Plus, Check, Loader2, ChevronRight, Play } from 'lucide-svelte';
	import { palette, closePalette, setScope } from '$lib/stores/commandPalette.svelte';
	import { playTrack } from '$lib/stores/musicStore.svelte';
	import type { Track } from '$lib/stores/musicStore.svelte';
	import type { UnifiedMedia } from '$lib/adapters/types';

	const SCOPES = [
		{ label: 'All', value: undefined },
		{ label: 'Movies', value: 'movie' },
		{ label: 'Shows', value: 'show' },
		{ label: 'Music', value: 'music' },
		{ label: 'Books', value: 'book' },
		{ label: 'Games', value: 'game' },
		{ label: 'Videos', value: 'video' }
	] as const;

	const PREVIEW_PER_TYPE = 2;
	const STORAGE_KEY = 'nexus:recent-searches';
	const MAX_RECENTS = 10;

	let query = $state('');
	let activeIndex = $state(-1);
	let mounted = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);
	let dialogEl = $state<HTMLDivElement | null>(null);
	let debounceTimer = $state<ReturnType<typeof setTimeout> | null>(null);

	// Two-phase results: library (fast, local) then discover (slow, external)
	let libraryResults = $state<UnifiedMedia[]>([]);
	let discoverResults = $state<UnifiedMedia[]>([]);
	let searchingLibrary = $state(false);
	let searchingDiscover = $state(false);
	let searched = $state(false);

	let requesting = $state<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
	let recents = $state<string[]>(loadRecents());

	const typeLabel: Record<string, string> = {
		movie: 'Movies', show: 'Shows', episode: 'Episodes',
		book: 'Books', game: 'Games', music: 'Music', album: 'Albums', live: 'Live TV', video: 'Videos'
	};
	const typeSingular: Record<string, string> = {
		movie: 'Movie', show: 'Series', episode: 'Episode',
		book: 'Book', game: 'Game', music: 'Music', album: 'Album', live: 'Live TV', video: 'Video'
	};

	// ── Derived: group library results by type ──
	const libraryGroups = $derived.by(() => {
		const groups: Record<string, UnifiedMedia[]> = {};
		for (const item of libraryResults) {
			(groups[item.type] ??= []).push(item);
		}
		return groups;
	});

	// When scoped to a specific type, show all; otherwise show PREVIEW_PER_TYPE per group
	const isScoped = $derived(!!palette.scope);

	// Overseerr requestable items
	const requestableResults = $derived(
		discoverResults.filter((i) => i.serviceType === 'overseerr' && i.status !== 'available')
	);

	// Show Overseerr when library has few matches
	const overseerrSuggestions = $derived(
		searched && libraryResults.length < 3 && requestableResults.length > 0
			? requestableResults.slice(0, 2)
			: []
	);

	// Flat nav list for keyboard navigation
	const navItems = $derived.by(() => {
		const items: UnifiedMedia[] = [];
		if (isScoped) {
			items.push(...libraryResults);
		} else {
			for (const [, group] of Object.entries(libraryGroups)) {
				items.push(...group.slice(0, PREVIEW_PER_TYPE));
			}
		}
		items.push(...overseerrSuggestions);
		return items;
	});

	const searching = $derived(searchingLibrary);
	let scopeIndex = $derived(SCOPES.findIndex((s) => s.value === palette.scope));

	// ── Storage helpers ──
	function loadRecents(): string[] {
		if (typeof localStorage === 'undefined') return [];
		try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
		catch { return []; }
	}
	function saveRecents(items: string[]) {
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {}
	}
	function addRecent(term: string) {
		const t = term.trim();
		if (!t) return;
		const updated = [t, ...recents.filter((r) => r !== t)].slice(0, MAX_RECENTS);
		recents = updated;
		saveRecents(updated);
	}
	function removeRecent(term: string) {
		const updated = recents.filter((r) => r !== term);
		recents = updated;
		saveRecents(updated);
	}

	// ── Fetch: two parallel requests ──
	let libraryAbort: AbortController | null = null;
	let discoverAbort: AbortController | null = null;

	async function fetchResults(q: string) {
		libraryAbort?.abort();
		discoverAbort?.abort();

		if (q.trim().length < 2) {
			libraryResults = [];
			discoverResults = [];
			searched = false;
			searchingLibrary = false;
			searchingDiscover = false;
			return;
		}

		// Video scope uses a separate API endpoint
		if (palette.scope === 'video') {
			const libCtrl = new AbortController();
			libraryAbort = libCtrl;
			searchingLibrary = true;

			fetch(`/api/video/search?q=${encodeURIComponent(q.trim())}`, { signal: libCtrl.signal })
				.then((r) => r.ok ? r.json() : { items: [] })
				.then((data) => {
					if (!libCtrl.signal.aborted) {
						libraryResults = data.items ?? [];
						searched = true;
						searchingLibrary = false;
					}
				})
				.catch((err) => {
					if (!(err instanceof DOMException && err.name === 'AbortError')) {
						searchingLibrary = false;
						searched = true;
					}
				});
			return;
		}

		const baseParams = new URLSearchParams({ q: q.trim() });
		if (palette.scope) baseParams.set('type', palette.scope);

		// Phase 1 — Library (Jellyfin/Calibre/RomM, local network, fast)
		const libCtrl = new AbortController();
		libraryAbort = libCtrl;
		searchingLibrary = true;

		const libParams = new URLSearchParams(baseParams);
		libParams.set('source', 'library');

		fetch(`/api/search?${libParams}`, { signal: libCtrl.signal })
			.then((r) => r.ok ? r.json() : { items: [] })
			.then((data) => {
				if (!libCtrl.signal.aborted) {
					libraryResults = data.items ?? [];
					searched = true;
					searchingLibrary = false;
				}
			})
			.catch((err) => {
				if (!(err instanceof DOMException && err.name === 'AbortError')) {
					searchingLibrary = false;
					searched = true;
				}
			});

		// Phase 2 — Discover (Overseerr/Lidarr, external APIs, slow)
		const discCtrl = new AbortController();
		discoverAbort = discCtrl;
		searchingDiscover = true;

		const discParams = new URLSearchParams(baseParams);
		discParams.set('source', 'discover');

		fetch(`/api/search?${discParams}`, { signal: discCtrl.signal })
			.then((r) => r.ok ? r.json() : { items: [] })
			.then((data) => {
				if (!discCtrl.signal.aborted) {
					discoverResults = data.items ?? [];
					searchingDiscover = false;
				}
			})
			.catch((err) => {
				if (!(err instanceof DOMException && err.name === 'AbortError')) {
					searchingDiscover = false;
				}
			});
	}

	function debouncedFetch(q: string) {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => fetchResults(q), 150);
	}

	function researchIfNeeded() {
		if (query.trim().length >= 2) fetchResults(query);
	}

	// ── Actions ──
	function handleMusicPlay(item: UnifiedMedia) {
		const track: Track = {
			id: item.id,
			sourceId: item.sourceId,
			serviceId: item.serviceId,
			title: item.title,
			artist: (item.metadata?.artist as string) ?? 'Unknown',
			album: (item.metadata?.album as string) ?? '',
			albumId: (item.metadata?.albumId as string) ?? '',
			duration: item.duration ?? 0,
			image: item.poster ?? ''
		};
		playTrack(track);
	}

	function isMusicTrack(item: UnifiedMedia): boolean {
		return item.type === 'music' || (item as any).mediaType === 'Audio';
	}

	function navigateToItem(item: UnifiedMedia) {
		addRecent(query.trim());
		if (isMusicTrack(item)) {
			handleMusicPlay(item);
			closePalette();
			return;
		}
		closePalette();
		if (item.type === 'video') {
			goto(`/media/video/${item.sourceId}?service=${item.serviceId}`);
		} else {
			goto(`/media/${item.type}/${item.sourceId}?service=${item.serviceId}`);
		}
	}

	function expandType(type: string) {
		// Switch scope to this type to show all results
		const scopeVal = SCOPES.find((s) => s.value === type)?.value;
		if (scopeVal) {
			setScope(scopeVal);
			researchIfNeeded();
		}
	}

	function submitSearch(term?: string) {
		const t = (term ?? query).trim();
		if (!t) return;
		addRecent(t);
		query = t;
		fetchResults(t);
	}

	async function requestItem(item: UnifiedMedia) {
		const key = item.id;
		requesting[key] = 'loading';
		try {
			const type = item.type === 'show' ? 'tv' : 'movie';
			const res = await fetch('/api/requests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId: item.serviceId, tmdbId: item.sourceId, type })
			});
			const body = await res.json();
			requesting[key] = body.ok ? 'done' : 'error';
		} catch {
			requesting[key] = 'error';
		}
	}

	// ── Input handlers ──
	function handleInput() {
		activeIndex = -1;
		searched = false;
		debouncedFetch(query);
	}

	function handleKeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				if (query.trim().length > 0) {
					query = '';
					libraryResults = [];
					discoverResults = [];
					searched = false;
					activeIndex = -1;
				} else {
					closePalette();
				}
				break;
			case 'ArrowDown':
				e.preventDefault();
				if (searched && navItems.length > 0) {
					activeIndex = (activeIndex + 1) % navItems.length;
				} else if (!searched && recents.length > 0) {
					activeIndex = (activeIndex + 1) % recents.length;
				}
				break;
			case 'ArrowUp':
				e.preventDefault();
				if (searched && navItems.length > 0) {
					activeIndex = activeIndex <= 0 ? navItems.length - 1 : activeIndex - 1;
				} else if (!searched && recents.length > 0) {
					activeIndex = activeIndex <= 0 ? recents.length - 1 : activeIndex - 1;
				}
				break;
			case 'Enter':
				e.preventDefault();
				if (searched && activeIndex >= 0 && activeIndex < navItems.length) {
					navigateToItem(navItems[activeIndex]);
				} else if (!searched && activeIndex >= 0 && activeIndex < recents.length) {
					submitSearch(recents[activeIndex]);
				} else {
					submitSearch();
				}
				break;
			case 'Tab':
				e.preventDefault();
				{
					const next = e.shiftKey
						? (scopeIndex - 1 + SCOPES.length) % SCOPES.length
						: (scopeIndex + 1) % SCOPES.length;
					setScope(SCOPES[next].value);
					researchIfNeeded();
				}
				break;
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) closePalette();
	}

	// ── Lifecycle ──
	$effect(() => {
		if (palette.open) {
			query = '';
			libraryResults = [];
			discoverResults = [];
			searched = false;
			searchingLibrary = false;
			searchingDiscover = false;
			activeIndex = -1;
			requesting = {};
			recents = loadRecents();
			requestAnimationFrame(() => { mounted = true; });
			requestAnimationFrame(() => { inputEl?.focus(); });
		} else {
			mounted = false;
		}
	});

	$effect(() => {
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			libraryAbort?.abort();
			discoverAbort?.abort();
		};
	});

	// Helper: get flat index of an item in navItems for keyboard highlight
	function navIndex(item: UnifiedMedia): number {
		return navItems.indexOf(item);
	}
</script>

{#if palette.open}
	<div
		class="fixed inset-0 z-[60] flex items-start justify-center transition-opacity duration-200
			{mounted ? 'opacity-100' : 'opacity-0'}"
		style="background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && closePalette()}
		role="button"
		tabindex="-1"
		aria-label="Close search"
	>
		<div
			bind:this={dialogEl}
			role="dialog"
			aria-modal="true"
			aria-label="Search Nexus"
			class="w-full max-w-[640px] flex flex-col overflow-hidden transition-all duration-200 ease-out
				motion-reduce:transition-none motion-reduce:!transform-none
				md:mt-0 md:rounded-2xl md:border md:border-cream/[0.08]
				max-md:fixed max-md:inset-0 max-md:rounded-none max-md:border-none"
			style="
				background: rgba(13, 11, 10, 0.85);
				backdrop-filter: blur(24px) saturate(1.4);
				box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5), 0 0 1px rgba(240, 235, 227, 0.1);
				{mounted ? 'transform: scale(1); opacity: 1;' : 'transform: scale(0.97); opacity: 0;'}
			"
			style:margin-top="max(15vh, 80px)"
		>
			<!-- Input -->
			<div class="flex items-center gap-3 px-5 py-4 border-b border-cream/[0.06]">
				{#if searching}
					<Loader2 class="w-5 h-5 text-accent shrink-0 animate-spin" />
				{:else}
					<Search class="w-5 h-5 text-muted shrink-0" />
				{/if}
				<input
					bind:this={inputEl}
					bind:value={query}
					oninput={handleInput}
					onkeydown={handleKeydown}
					type="text"
					placeholder={palette.scope ? `Search ${typeLabel[palette.scope] ?? palette.scope}...` : 'Search Nexus...'}
					autocomplete="off"
					spellcheck="false"
					class="flex-1 bg-transparent text-cream text-lg font-body placeholder:text-faint outline-none"
					aria-label="Search"
					aria-autocomplete="list"
					aria-controls="command-palette-list"
					aria-activedescendant={activeIndex >= 0 ? `cp-item-${activeIndex}` : undefined}
				/>
				<button
					onclick={() => closePalette()}
					class="shrink-0 px-2 py-1 rounded-lg text-xs font-mono text-faint border border-cream/[0.08]
						bg-cream/[0.03] hover:bg-cream/[0.06] hover:text-muted transition-colors"
					aria-label="Close"
				>Esc</button>
			</div>

			<!-- Scope Tabs -->
			<div
				class="flex items-center gap-1 px-5 py-2.5 border-b border-cream/[0.06] overflow-x-auto scrollbar-none"
				role="tablist" aria-label="Search scope"
			>
				{#each SCOPES as scope (scope.label)}
					{@const count = scope.value ? (libraryGroups[scope.value]?.length ?? 0) : libraryResults.length}
					<button
						role="tab"
						aria-selected={palette.scope === scope.value}
						class="px-3 py-1.5 rounded-lg text-sm font-body whitespace-nowrap transition-all duration-150 flex items-center gap-1.5
							{palette.scope === scope.value
								? 'bg-accent/15 text-accent font-medium'
								: 'text-muted hover:text-cream hover:bg-cream/[0.04]'}"
						onclick={() => { setScope(scope.value); researchIfNeeded(); }}
					>
						{scope.label}
						{#if searched && count > 0 && scope.value !== palette.scope}
							<span class="text-[10px] opacity-60">{count}</span>
						{/if}
					</button>
				{/each}
			</div>

			<!-- Results -->
			<div
				id="command-palette-list"
				role="listbox"
				class="flex-1 overflow-y-auto overscroll-contain py-1 max-md:flex-1"
				style="max-height: min(55vh, 480px);"
			>
				{#if searched && query.trim().length >= 2}

					{#if isScoped}
						<!-- Scoped: show all results for this type -->
						{#if libraryResults.length > 0}
							<div class="px-4 pt-2 pb-1">
								<span class="text-[10px] font-semibold uppercase tracking-widest text-faint">
									{typeLabel[palette.scope ?? ''] ?? 'Results'} ({libraryResults.length})
								</span>
							</div>
							{#each libraryResults as item (item.id)}
								{@const idx = navIndex(item)}
								{@render resultRow(item, idx)}
							{/each}
						{/if}
					{:else}
						<!-- Unscoped: group by type, show preview per group -->
						{#each Object.entries(libraryGroups) as [type, items] (type)}
							{@const preview = items.slice(0, PREVIEW_PER_TYPE)}
							{@const hasMore = items.length > PREVIEW_PER_TYPE}
							<div class="px-4 pt-2.5 pb-1 flex items-center justify-between">
								<span class="text-[10px] font-semibold uppercase tracking-widest text-faint">
									{typeLabel[type] ?? type}
								</span>
								{#if hasMore}
									<button
										class="flex items-center gap-0.5 text-[10px] font-medium text-accent hover:text-accent-light transition-colors"
										onclick={() => expandType(type)}
									>
										All {items.length}
										<ChevronRight class="w-3 h-3" />
									</button>
								{/if}
							</div>
							{#each preview as item (item.id)}
								{@const idx = navIndex(item)}
								{@render resultRow(item, idx)}
							{/each}
						{/each}
					{/if}

					<!-- Overseerr suggestions (trickle in) -->
					{#if overseerrSuggestions.length > 0}
						<div class="px-4 pt-2.5 pb-1 {libraryResults.length > 0 ? 'mt-1 border-t border-cream/[0.06]' : ''}">
							<span class="text-[10px] font-semibold uppercase tracking-widest text-faint">
								{libraryResults.length > 0 ? 'Not in your library?' : 'Available to request'}
							</span>
						</div>
						{#each overseerrSuggestions as item (item.id)}
							{@const idx = navIndex(item)}
							{@const reqState = requesting[item.id] ?? 'idle'}
							<!-- svelte-ignore a11y_interactive_supports_focus -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								id="cp-item-{idx}"
								role="option"
								aria-selected={activeIndex === idx}
								class="flex items-center gap-3 px-4 py-2 mx-1 rounded-xl cursor-pointer transition-colors duration-100
									{activeIndex === idx ? 'bg-accent/10' : 'hover:bg-cream/[0.04]'}"
								onclick={() => navigateToItem(item)}
								onmouseenter={() => (activeIndex = idx)}
							>
								{@render posterThumb(item)}
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="text-sm font-medium text-cream truncate">{item.title}</span>
										{#if item.year}<span class="text-[11px] text-muted flex-shrink-0">{item.year}</span>{/if}
									</div>
									<div class="flex items-center gap-2 mt-0.5">
										<span class="text-[10px] px-1.5 py-0.5 rounded bg-cream/[0.06] text-muted">{typeSingular[item.type] ?? item.type}</span>
										{#if item.rating}
											<span class="flex items-center gap-0.5 text-[10px] text-accent">
												<Star class="w-2.5 h-2.5" fill="currentColor" />{item.rating.toFixed(1)}
											</span>
										{/if}
									</div>
								</div>
								<!-- Request button -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="flex-shrink-0" onclick={(e) => e.stopPropagation()}>
									{#if reqState === 'done'}
										<span class="flex items-center gap-1 text-[11px] font-medium text-steel">
											<Check class="w-3 h-3" />Done
										</span>
									{:else if reqState === 'error'}
										<span class="text-[11px] text-warm">Failed</span>
									{:else}
										<button
											class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium
												border border-accent/30 text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
											onclick={() => requestItem(item)}
											disabled={reqState === 'loading'}
										>
											{#if reqState === 'loading'}
												<Loader2 class="w-3 h-3 animate-spin" />
											{:else}
												<Plus class="w-3 h-3" />
											{/if}
											{reqState === 'loading' ? '...' : 'Request'}
										</button>
									{/if}
								</div>
							</div>
						{/each}
					{:else if searchingDiscover && libraryResults.length < 3}
						<!-- Discover still loading -->
						<div class="px-4 pt-2.5 pb-1 {libraryResults.length > 0 ? 'mt-1 border-t border-cream/[0.06]' : ''}">
							<span class="text-[10px] font-semibold uppercase tracking-widest text-faint flex items-center gap-1.5">
								<Loader2 class="w-3 h-3 animate-spin" />
								Checking Overseerr...
							</span>
						</div>
					{/if}

					<!-- No results at all -->
					{#if libraryResults.length === 0 && overseerrSuggestions.length === 0 && !searchingDiscover}
						<div class="px-5 py-10 text-center">
							<p class="text-sm text-faint">No results for "{query.trim()}"</p>
							<p class="text-xs text-faint/60 mt-1">Try a different term or change the scope</p>
						</div>
					{/if}

				{:else if query.trim().length >= 2 && searching}
					<!-- Loading skeleton -->
					<div class="px-4 py-2">
						{#each Array(3) as _, i (i)}
							<div class="flex items-center gap-3 px-1 py-2">
								<div class="w-9 h-[54px] rounded-lg bg-cream/[0.04] animate-pulse"></div>
								<div class="flex-1 space-y-2">
									<div class="h-3.5 w-2/3 rounded bg-cream/[0.04] animate-pulse"></div>
									<div class="h-2.5 w-1/3 rounded bg-cream/[0.04] animate-pulse"></div>
								</div>
							</div>
						{/each}
					</div>

				{:else if recents.length > 0 && query.trim().length === 0}
					<!-- Recent searches -->
					<div class="px-4 py-1.5">
						<span class="text-[10px] font-semibold uppercase tracking-widest text-faint">Recent</span>
					</div>
					{#each recents as term, i (term)}
						<!-- svelte-ignore a11y_interactive_supports_focus -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							id="cp-item-{i}"
							role="option"
							aria-selected={activeIndex === i}
							class="flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-colors duration-100
								{activeIndex === i ? 'bg-accent/10 text-cream' : 'text-muted hover:bg-cream/[0.04] hover:text-cream'}"
							onclick={() => submitSearch(term)}
							onmouseenter={() => (activeIndex = i)}
						>
							<Clock class="w-4 h-4 text-faint shrink-0" />
							<span class="flex-1 truncate text-sm font-body">{term}</span>
							<button
								onclick={(e) => { e.stopPropagation(); removeRecent(term); }}
								class="shrink-0 p-1 rounded-md text-faint hover:text-warm hover:bg-cream/[0.06] transition-colors"
								aria-label="Remove from recent"
							><X class="w-3.5 h-3.5" /></button>
						</div>
					{/each}
				{:else}
					<div class="px-5 py-10 text-center text-faint text-sm">
						Start typing to search your library
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex items-center gap-4 px-5 py-2.5 border-t border-cream/[0.06] text-faint text-xs font-mono">
				<span class="inline-flex items-center gap-1.5">
					<ArrowUp class="w-3 h-3" /><ArrowDown class="w-3 h-3" />
					<span>navigate</span>
				</span>
				<span class="inline-flex items-center gap-1.5">
					<CornerDownLeft class="w-3 h-3" />
					<span>{searched ? 'open' : 'search'}</span>
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="px-1 py-0.5 rounded border border-cream/[0.08] text-[10px] leading-none">Tab</span>
					<span>scope</span>
				</span>
				<span class="ml-auto inline-flex items-center gap-1.5">
					<span class="px-1 py-0.5 rounded border border-cream/[0.08] text-[10px] leading-none">Esc</span>
					<span>close</span>
				</span>
			</div>
		</div>
	</div>
{/if}

<!-- ── Shared snippets ── -->

{#snippet posterThumb(item: UnifiedMedia)}
	<div class="{item.type === 'video' ? 'w-24 h-[54px]' : 'w-9 h-[54px]'} flex-shrink-0 rounded-lg overflow-hidden" style="background: var(--color-surface)">
		{#if item.poster}
			<img src={item.poster} alt="" class="w-full h-full object-cover" loading="lazy" />
		{:else}
			<div class="w-full h-full flex items-center justify-center text-faint">
				<Search class="w-3.5 h-3.5" />
			</div>
		{/if}
	</div>
{/snippet}

{#snippet resultRow(item: UnifiedMedia, idx: number)}
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		id="cp-item-{idx}"
		role="option"
		aria-selected={activeIndex === idx}
		class="flex items-center gap-3 px-4 py-2 mx-1 rounded-xl cursor-pointer transition-colors duration-100
			{activeIndex === idx ? 'bg-accent/10' : 'hover:bg-cream/[0.04]'}"
		onclick={() => navigateToItem(item)}
		onmouseenter={() => (activeIndex = idx)}
	>
		{@render posterThumb(item)}
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2">
				<span class="text-sm font-medium text-cream truncate">{item.title}</span>
				{#if item.year}<span class="text-[11px] text-muted flex-shrink-0">{item.year}</span>{/if}
			</div>
			<div class="flex items-center gap-2 mt-0.5">
				{#if !isScoped}
					<span class="text-[10px] px-1.5 py-0.5 rounded bg-cream/[0.06] text-muted">{typeSingular[item.type] ?? item.type}</span>
				{/if}
				{#if isMusicTrack(item)}
					{#if item.metadata?.artist}
						<span class="text-[10px] text-muted truncate">{item.metadata.artist}</span>
					{/if}
					{#if item.metadata?.album}
						<span class="text-[10px] text-faint truncate">{item.metadata.album}</span>
					{/if}
				{:else if item.type === 'video'}
					{#if item.metadata?.author}
						<span class="text-[10px] text-muted truncate">{item.metadata.author}</span>
					{/if}
					{#if item.metadata?.viewCount}
						<span class="text-[10px] text-faint">{Number(item.metadata.viewCount).toLocaleString()} views</span>
					{/if}
					{#if item.metadata?.publishedText}
						<span class="text-[10px] text-faint">{item.metadata.publishedText}</span>
					{/if}
				{:else}
					{#if item.rating}
						<span class="flex items-center gap-0.5 text-[10px] text-accent">
							<Star class="w-2.5 h-2.5" fill="currentColor" />{item.rating.toFixed(1)}
						</span>
					{/if}
					{#if item.genres?.length}
						<span class="text-[10px] text-faint truncate hidden sm:block">{item.genres.slice(0, 2).join(', ')}</span>
					{/if}
				{/if}
			</div>
		</div>
		{#if isMusicTrack(item)}
			<span class="flex items-center justify-center w-6 h-6 rounded-full bg-accent/15 text-accent flex-shrink-0">
				<Play class="w-3 h-3" fill="currentColor" />
			</span>
		{:else}
			<span class="text-[9px] px-1.5 py-0.5 rounded-md bg-cream/[0.04] text-faint flex-shrink-0 capitalize">{item.serviceType}</span>
		{/if}
	</div>
{/snippet}

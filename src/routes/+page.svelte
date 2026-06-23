<script lang="ts">
	import '$lib/styles/paper-ink.css';
	import { goto } from '$app/navigation';
	import { Menu, Search, Sun, Moon, House, Film, Tv, Play, Music, Video, Sparkles, ImageIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	type IconType = typeof House;
	type HomeItem = PageData['rows'][number]['items'][number];
	type Hero = NonNullable<PageData['hero']> & { posterUrl?: string; backdropUrl?: string };

	let { data }: { data: PageData } = $props();

	let railOpen = $state(true);
	let theme = $state<'light' | 'dark'>('dark');
	// Active library filter. 'all' = Home (everything). Otherwise a filter key
	// below. This is REAL: it filters the content actually loaded from the
	// backend — no dead links, no routes that don't exist.
	let activeFilter = $state<string>('all');

	onMount(() => {
		const saved = localStorage.getItem('petalnet-theme');
		if (saved === 'light' || saved === 'dark') theme = saved;
		else if (window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
		// Warm the nucleo wasm matcher so the first search isn't slow.
		void getNucleo().catch(() => {});
	});

	function toggleTheme() {
		const root = document.documentElement;
		root.classList.add('no-theme-transition');
		theme = theme === 'dark' ? 'light' : 'dark';
		localStorage.setItem('petalnet-theme', theme);
		void root.offsetWidth;
		requestAnimationFrame(() => root.classList.remove('no-theme-transition'));
	}

	const dateline = $derived.by(() => {
		const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		const now = new Date();
		const h = now.getHours();
		const ap = h < 12 ? 'AM' : 'PM';
		const h12 = ((h + 11) % 12) + 1;
		return `${days[now.getDay()]} · ${h12}:${String(now.getMinutes()).padStart(2, '0')} ${ap}`;
	});

	// Library filters. Each maps a friendly label to the raw media types it
	// covers. We only render a filter in the rail if the loaded content actually
	// contains items of that type — so every item you can click does something.
	const FILTERS: { key: string; label: string; icon: IconType; types: string[] }[] = [
		{ key: 'movie', label: 'Movies', icon: Film, types: ['movie'] },
		{ key: 'show', label: 'Shows', icon: Tv, types: ['episode', 'series', 'season'] },
		{ key: 'video', label: 'Videos', icon: Video, types: ['video'] },
		{ key: 'music', label: 'Music', icon: Music, types: ['album', 'music', 'audio'] }
	];

	const allItems = $derived(data.rows.flatMap((row) => row.items));
	const presentFilters = $derived(
		FILTERS.filter((f) => allItems.some((it) => f.types.includes(it.type ?? '')))
	);

	const hero = $derived((data.hero as Hero | null) ?? undefined);
	const heroArt = $derived(mediaBackdrop(hero) ?? mediaPoster(hero));
	const heroDescription = $derived(hero?.description);

	// Rows actually shown: drop empties, and when a filter is active, keep only
	// matching items (and rows that still have any).
	const visibleRows = $derived.by(() => {
		const base = data.rows.filter((row) => row.items.length > 0);
		if (activeFilter === 'all') return base;
		const f = FILTERS.find((x) => x.key === activeFilter);
		if (!f) return base;
		return base
			.map((row) => ({ ...row, items: row.items.filter((it) => f.types.includes(it.type ?? '')) }))
			.filter((row) => row.items.length > 0);
	});

	// Card shape follows the item's NATIVE art ratio so nothing is cropped:
	// posters 2:3, album covers 1:1, episode/video stills 16:9. All cards share a
	// fixed height (set in CSS), so a row stays tidy while widths vary by type.
	function ratioClass(item: { type?: string }) {
		const t = item.type ?? '';
		if (t === 'album' || t === 'music') return 'r-square';
		if (t === 'episode' || t === 'video' || t === 'live') return 'r-landscape';
		return 'r-portrait';
	}

	function mediaPoster(item: (HomeItem & { posterUrl?: string }) | undefined) {
		return item?.posterUrl ?? item?.poster;
	}

	function mediaBackdrop(item: (HomeItem & { backdropUrl?: string }) | undefined) {
		return item?.backdropUrl ?? item?.backdrop ?? item?.thumb;
	}

	// Friendly, backend-agnostic type label for card meta. Never expose the raw
	// backend name (no "jellyfin") to a non-technical viewer.
	const TYPE_LABEL: Record<string, string> = {
		movie: 'Movie',
		episode: 'Episode',
		series: 'Series',
		season: 'Season',
		video: 'Video',
		album: 'Album',
		music: 'Track',
		audio: 'Audio'
	};
	function typeLabel(type?: string): string {
		return TYPE_LABEL[type ?? ''] ?? '';
	}

	// Only video items launch the streaming test page. Albums/series/audio are
	// shown but not playable yet (audio needs the later mini-player; series need
	// episode nav) — Eli, 2026-06-22.
	const PLAYABLE_TYPES = new Set(['movie', 'episode', 'video']);
	// Immutable collections — clicking one opens its contents (episodes/tracks).
	const COLLECTION_TYPES = new Set(['show', 'series', 'album']);
	function isPlayable(item: { type?: string }): boolean {
		return PLAYABLE_TYPES.has(item.type ?? '');
	}
	function isCollection(item: { type?: string }): boolean {
		return COLLECTION_TYPES.has(item.type ?? '');
	}
	// A card is interactive if it either plays or opens into a collection.
	function isOpenable(item: { type?: string }): boolean {
		return isPlayable(item) || isCollection(item);
	}

	type Ref = { serviceType: string; sourceId?: string; id: string };
	function playUrl(item: Ref) {
		const id = item.sourceId ?? item.id;
		return `/test-play/${encodeURIComponent(item.serviceType)}/${encodeURIComponent(id)}`;
	}
	function collectionUrl(item: Ref) {
		const id = item.sourceId ?? item.id;
		return `/collection/${encodeURIComponent(item.serviceType)}/${encodeURIComponent(id)}`;
	}

	function openItem(item: HomeItem) {
		if (isCollection(item)) goto(collectionUrl(item));
		else if (isPlayable(item)) goto(playUrl(item));
	}
	function openHero(item: Hero) {
		if (isCollection(item)) goto(collectionUrl(item));
		else if (isPlayable(item)) goto(playUrl(item));
	}

	// ── Search — REAL: hits /api/search, which runs each searchable backend's
	// adapter.search() live. Doubles as the command surface (⌘K / "/" to focus,
	// arrows + enter to pick). No fake suggestions — empty until the backend
	// actually returns matches.
	type SearchItem = {
		id: string;
		sourceId?: string;
		serviceType: string;
		type?: string;
		title: string;
		poster?: string;
		backdrop?: string;
		thumb?: string;
		year?: number;
	};
	let searchQuery = $state('');
	let searchResults = $state<SearchItem[]>([]);
	let searchOpen = $state(false);
	let searchLoading = $state(false);
	let searchActive = $state(-1);
	let searchInputEl = $state<HTMLInputElement>();
	let searchSeq = 0;

	function searchPoster(item: SearchItem) {
		return item.poster ?? item.thumb ?? item.backdrop;
	}

	// Real fzf-grade ranking via nucleo (Rust → wasm). Lazy + browser-only so SSR
	// never loads the wasm; warmed on mount so the first keystroke isn't slow.
	let nucleoMod: typeof import('nucleo-matcher-wasm') | null = null;
	async function getNucleo() {
		if (!nucleoMod) nucleoMod = await import('nucleo-matcher-wasm');
		return nucleoMod;
	}

	// Order candidates by nucleo score against the query. nucleo scores prefix and
	// word-boundary matches correctly (so "who" → "Who Is Alive" beats mid-word
	// "Hula Whoops"). Title-matches lead in scored order; anything the backend
	// matched on other fields trails so we never drop a valid hit. Duplicate
	// titles are consumed in original order. Falls back to the raw order if the
	// matcher can't load — degrade, don't break.
	async function rankResults(q: string, candidates: SearchItem[]): Promise<SearchItem[]> {
		if (candidates.length === 0) return candidates;
		try {
			const { NucleoMatcher } = await getNucleo();
			const matcher = new NucleoMatcher(candidates.map((c) => c.title));
			// matchPatternIndices → [title, score, matchedCharIndices[]]. nucleo TIES
			// all word-boundary matches at the same score (e.g. "wh" scores "What If"
			// and "Snow White" equally), so add a tiebreak: higher score, then EARLIER
			// first-match position (a title that starts with the query wins), then
			// shorter title. That gives the prefix-first ordering you'd expect.
			const ranked = matcher.matchPatternIndices(q) as [string, number, number[]][];
			ranked.sort(
				(a, b) =>
					b[1] - a[1] ||
					(a[2]?.[0] ?? Number.MAX_SAFE_INTEGER) - (b[2]?.[0] ?? Number.MAX_SAFE_INTEGER) ||
					a[0].length - b[0].length
			);
			const byTitle = new Map<string, SearchItem[]>();
			for (const c of candidates) {
				const arr = byTitle.get(c.title);
				if (arr) arr.push(c);
				else byTitle.set(c.title, [c]);
			}
			const ordered: SearchItem[] = [];
			for (const [title] of ranked) {
				const arr = byTitle.get(title);
				if (arr?.length) ordered.push(arr.shift()!);
			}
			const seen = new Set(ordered);
			return [...ordered, ...candidates.filter((c) => !seen.has(c))];
		} catch (e) {
			// Matcher unavailable (e.g. wasm blocked) — degrade to the backend's order
			// rather than break search.
			console.warn('[search] nucleo ranking unavailable, using raw order', e);
			return candidates;
		}
	}

	// Debounced live query. Re-runs whenever searchQuery changes; the cleanup
	// cancels the pending fetch timer, and searchSeq drops any stale response.
	$effect(() => {
		const q = searchQuery.trim();
		if (q.length < 2) {
			searchResults = [];
			searchOpen = false;
			searchLoading = false;
			return;
		}
		searchLoading = true;
		searchOpen = true;
		const seq = ++searchSeq;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
				const data = await res.json();
				if (seq !== searchSeq) return; // a newer query already fired
				const ranked = await rankResults(q, data.results ?? []);
				if (seq !== searchSeq) return; // ranking is async too — re-check
				searchResults = ranked;
				searchActive = searchResults.length ? 0 : -1;
			} catch {
				if (seq === searchSeq) searchResults = [];
			} finally {
				if (seq === searchSeq) searchLoading = false;
			}
		}, 200);
		return () => clearTimeout(timer);
	});

	function openResult(item: SearchItem) {
		searchOpen = false;
		searchQuery = '';
		// Series/albums open their collection; movies/episodes play; anything else
		// (a lone track) is a no-op rather than a dead navigation.
		if (isCollection(item)) goto(collectionUrl(item));
		else if (isPlayable(item)) goto(playUrl(item));
	}

	function onSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			searchOpen = false;
			searchQuery = '';
			searchInputEl?.blur();
			return;
		}
		if (!searchOpen || searchResults.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			searchActive = (searchActive + 1) % searchResults.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			searchActive = (searchActive - 1 + searchResults.length) % searchResults.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (searchActive >= 0) openResult(searchResults[searchActive]);
		}
	}

	// Global shortcuts: ⌘K / Ctrl+K (and bare "/" when not already typing) focus
	// the search; Escape closes it from anywhere.
	function onGlobalKeydown(e: KeyboardEvent) {
		const k = e.key.toLowerCase();
		const inField =
			document.activeElement instanceof HTMLInputElement ||
			document.activeElement instanceof HTMLTextAreaElement;
		if ((e.metaKey || e.ctrlKey) && k === 'k') {
			e.preventDefault();
			searchInputEl?.focus();
		} else if (e.key === '/' && !inField) {
			e.preventDefault();
			searchInputEl?.focus();
		}
	}
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<svelte:head><title>Nexus · Tonight</title></svelte:head>

<div class="pi-root" data-theme={theme} style="height:100vh; overflow:hidden; display:flex; flex-direction:column;">
	<!-- TOP BAR -->
	<header class="topbar">
		<button class="icon-btn" aria-label="Toggle menu" onclick={() => (railOpen = !railOpen)}>
			<Menu size={22} strokeWidth={1.8} />
		</button>
		<div class="brand">
			<span class="brand-mark"></span>
			<span class="brand-name">Nexus</span>
		</div>
		<div class="search-wrap">
			<label class="search">
				<Search size={18} strokeWidth={1.8} />
				<input
					bind:this={searchInputEl}
					bind:value={searchQuery}
					onkeydown={onSearchKeydown}
					onfocus={() => { if (searchQuery.trim().length >= 2) searchOpen = true; }}
					onblur={() => setTimeout(() => (searchOpen = false), 120)}
					type="search"
					autocomplete="off"
					spellcheck="false"
					placeholder="Search your library"
					aria-label="Search your library"
				/>
				<span class="kbd mono">⌘K</span>
			</label>

			{#if searchOpen}
				<div class="search-panel">
					{#if searchLoading && searchResults.length === 0}
						<div class="search-empty">Searching…</div>
					{:else if searchResults.length === 0}
						<div class="search-empty">No matches</div>
					{:else}
						{#each searchResults as r, i (r.id)}
							<button
								type="button"
								class="search-row"
								class:active={i === searchActive}
								class:nonplay={!isOpenable(r)}
								onmousedown={(e) => e.preventDefault()}
								onmouseenter={() => (searchActive = i)}
								onclick={() => openResult(r)}
							>
								<span class="sr-thumb">
									{#if searchPoster(r)}
										<img src={searchPoster(r)} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
									{:else}
										<ImageIcon size={16} strokeWidth={2} />
									{/if}
								</span>
								<span class="sr-text">
									<span class="sr-title">{r.title}</span>
									<span class="sr-meta">{typeLabel(r.type)}{#if typeLabel(r.type) && r.year} · {/if}{#if r.year}{r.year}{/if}</span>
								</span>
								{#if isPlayable(r)}<span class="sr-play"><Play size={13} strokeWidth={2} fill="currentColor" /></span>{/if}
							</button>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
		<button class="icon-btn outlined" aria-label="Toggle theme" onclick={toggleTheme}>
			{#if theme === 'dark'}<Sun size={18} strokeWidth={1.8} />{:else}<Moon size={18} strokeWidth={1.8} />{/if}
		</button>
		<a class="avatar" href="/outpost.goauthentik.io/sign_out" aria-label="Sign out">P</a>
	</header>

	<div style="display:flex; flex:1; min-height:0;">
		<!-- LEFT RAIL — real library filters only -->
		<nav class="rail" class:closed={!railOpen} style="width:{railOpen ? '232px' : '72px'};">
			<button class="rail-item" class:active={activeFilter === 'all'} onclick={() => (activeFilter = 'all')}>
				<span class="rail-icon"><House size={22} strokeWidth={2} /></span>
				<span class="rail-label">Home</span>
			</button>
			{#each presentFilters as f (f.key)}
				{@const Icon = f.icon}
				<button class="rail-item" class:active={activeFilter === f.key} onclick={() => (activeFilter = f.key)}>
					<span class="rail-icon"><Icon size={22} strokeWidth={2} /></span>
					<span class="rail-label">{f.label}</span>
				</button>
			{/each}
		</nav>

		<!-- MAIN — Tonight -->
		<main class="main">
			<div class="main-inner">
				<div class="eyebrow-row">
					<h1 class="eyebrow mono">Tonight</h1>
					<span class="dateline">{dateline}</span>
				</div>
				<p class="lede">One thread through everything you're hosting, newest and nearest to done first.</p>

				{#if hero && activeFilter === 'all'}
					<button
						class="hero pi-settle"
						class:no-art={!heroArt}
						style:background-image={heroArt ? `url("${heroArt}")` : undefined}
						onclick={() => openHero(hero)}
					>
						<div class="hero-scrim"></div>
						<div class="hero-body">
							<div class="hero-tags">
								{#if hero.type || hero.year}
									<span class="hero-kind mono">
										{typeLabel(hero.type) || 'Featured'}{#if hero.year} · {hero.year}{/if}
									</span>
								{/if}
							</div>
							<h2 class="hero-title">{hero.title}</h2>
							{#if heroDescription}<p class="hero-desc">{heroDescription}</p>{/if}
							{#if isPlayable(hero)}
								<div class="hero-actions">
									<span class="btn-play"><Play size={16} strokeWidth={2} fill="currentColor" /> Play</span>
								</div>
							{/if}
						</div>
					</button>
				{/if}

				{#if visibleRows.length === 0}
					<div class="empty-state pi-settle">
						<div class="empty-mark"><Sparkles size={34} strokeWidth={1.8} /></div>
						<h2>Nothing here yet</h2>
					</div>
				{:else}
					{#each visibleRows as row (row.id)}
						<div class="row-head">
							<h3>{row.title}</h3>
						</div>
						<div class="hrail">
							{#each row.items as item (item.id)}
								<button class="vcard pi-settle {ratioClass(item)}" class:nonplay={!isOpenable(item)} onclick={() => openItem(item)} aria-label={isPlayable(item) ? `Play ${item.title}` : isCollection(item) ? `Open ${item.title}` : item.title}>
									<div class="art">
										{#if mediaPoster(item) || mediaBackdrop(item)}
											<img src={mediaPoster(item) ?? mediaBackdrop(item)} alt={item.title} loading="lazy" decoding="async" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
										{:else}
											<span class="art-icon"><ImageIcon size={30} strokeWidth={2} /></span>
										{/if}
										{#if isPlayable(item)}<span class="art-play"><Play size={18} strokeWidth={2} fill="var(--on-petal)" /></span>{/if}
									</div>
									<div class="vc-title">{item.title}</div>
									<div class="vc-meta">
										{typeLabel(item.type)}{#if typeLabel(item.type) && item.year} · {/if}{#if item.year}{item.year}{/if}
									</div>
								</button>
							{/each}
						</div>
					{/each}
				{/if}
			</div>
		</main>
	</div>
</div>

<style>
	/* ── Top bar ── */
	.topbar {
		height: 56px; flex: none; display: flex; align-items: center; gap: var(--s3);
		padding: 0 18px; border-bottom: 1px solid var(--rule); background: var(--bg); z-index: 30;
	}
	.search-wrap { flex: 1; display: flex; justify-content: center; position: relative; }
	.search {
		width: 100%; max-width: 520px; display: flex; align-items: center; gap: 10px;
		height: 42px; padding: 0 14px; border-radius: var(--radius-sm); background: var(--surface);
		color: var(--text-soft); transition: var(--t); cursor: text;
	}
	.search:focus-within { outline: 1.5px solid var(--petal); outline-offset: -1.5px; color: var(--text); }
	.search input {
		flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--text);
		font-family: inherit; font-size: 14px;
	}
	.search input::placeholder { color: var(--text-soft); }
	.search input::-webkit-search-cancel-button { -webkit-appearance: none; }
	.kbd {
		font-size: 11px; font-weight: 500; color: var(--text-soft);
		background: var(--bg); border-radius: var(--radius-xs); padding: 2px 6px;
	}
	.search-panel {
		position: absolute; top: 50px; left: 50%; transform: translateX(-50%);
		width: 100%; max-width: 520px; max-height: 60vh; overflow-y: auto;
		background: var(--bg); border: 1px solid var(--rule-strong); border-radius: var(--radius);
		box-shadow: 0 16px 40px -12px rgba(0, 0, 0, 0.4); padding: 6px; z-index: 40;
	}
	.search-empty { padding: 16px; text-align: center; color: var(--text-soft); font-size: 13px; }
	.search-row {
		width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px 10px;
		border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer;
		text-align: left; font-family: inherit; color: var(--text); transition: background var(--dur-fast) ease;
	}
	.search-row.active { background: var(--petal-soft); }
	.search-row.nonplay { cursor: default; }
	.sr-thumb {
		flex: none; width: 56px; height: 32px; border-radius: 6px; overflow: hidden; background: var(--surface);
		display: flex; align-items: center; justify-content: center; color: var(--text-soft); position: relative;
	}
	.sr-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.sr-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
	.sr-title { font-size: 13.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.sr-meta { font-size: 12px; color: var(--text-mute); }
	.sr-play { flex: none; color: var(--petal); display: flex; }
	.icon-btn {
		width: 40px; height: 40px; flex: none; border: none; border-radius: var(--radius-sm);
		background: transparent; color: var(--text); cursor: pointer;
		display: flex; align-items: center; justify-content: center; transition: var(--t);
	}
	.icon-btn:hover { background: var(--petal-soft); }
	.icon-btn.outlined { color: var(--text-mute); }
	.icon-btn.outlined:hover { color: var(--text); }
	.icon-btn:active { transform: scale(0.94); }
	.brand { display: flex; align-items: center; gap: 9px; }
	.brand-mark {
		width: 24px; height: 24px; border-radius: 7px; background: var(--petal);
		display: flex; align-items: center; justify-content: center; position: relative;
	}
	.brand-mark::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--on-petal); }
	.brand-name { font-size: 18px; font-weight: 500; }
	.avatar {
		width: 34px; height: 34px; flex: none; border-radius: 50%; background: var(--surface);
		display: flex; align-items: center; justify-content: center;
		font-size: 13px; font-weight: 500; color: var(--text-mute); cursor: pointer;
		text-decoration: none; transition: var(--t);
	}
	.avatar:hover { filter: brightness(1.06); outline: 1.5px solid var(--petal); outline-offset: 2px; }

	/* ── Rail ── */
	.rail {
		flex: none; border-right: 1px solid var(--rule); padding: var(--s2);
		overflow-y: auto; overflow-x: hidden; transition: width 200ms var(--ease-standard);
	}
	.rail-item {
		width: 100%; height: 40px; display: flex; align-items: center; gap: 18px;
		padding: 0 14px; border: none; border-radius: var(--radius-sm); background: transparent;
		color: var(--text); font-family: inherit; font-size: 14px; font-weight: 400;
		cursor: pointer; margin-bottom: 2px; white-space: nowrap; transition: var(--t);
	}
	.rail-item:hover { background: var(--petal-soft); }
	.rail-item.active { background: var(--petal-soft); color: var(--petal); font-weight: 500; }
	.rail-icon { flex: none; display: flex; }
	.rail-item.active .rail-icon { color: var(--petal); }
	.rail-label {
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		transition: opacity 150ms ease;
	}
	.rail.closed .rail-label {
		opacity: 0; pointer-events: none; flex: 0 0 0; width: 0;
	}

	/* ── Main ── */
	.main { flex: 1; min-width: 0; overflow-y: auto; }
	.main-inner { max-width: 1120px; margin: 0 auto; padding: var(--s5) var(--s5) var(--s7); }
	.eyebrow-row { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
	.eyebrow {
		font-size: 12px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
		color: var(--petal); margin: 0;
	}
	.dateline { font-size: 13px; color: var(--text-soft); }
	.lede { font-size: 14px; color: var(--text-mute); margin: 0 0 var(--s4); text-wrap: balance; }

	/* ── Hero (media surface — functional legibility scrim allowed) ── */
	.hero {
		position: relative; width: 100%; border: none; border-radius: var(--radius-lg); overflow: hidden;
		background-color: var(--surface); background-position: center; background-size: cover;
		min-height: 320px; display: flex; align-items: flex-end;
		margin-bottom: var(--s5); cursor: pointer; text-align: left; padding: 0;
	}
	.hero.no-art { background-image: linear-gradient(135deg, var(--surface), var(--elev)); }
	.hero-scrim { position: absolute; inset: 0; background: linear-gradient(110deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.4) 48%, rgba(0,0,0,0) 80%); }
	.hero-body { position: relative; padding: 36px 38px; max-width: 580px; }
	.hero-tags { display: flex; align-items: center; gap: 9px; margin-bottom: 14px; }
	.hero-kind { font-size: 10px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(255,255,255,0.75); background: rgba(0,0,0,0.45); border-radius: var(--radius-xs); padding: 3px 8px; }
	.hero-title { font-size: clamp(28px, 4vw, 38px); font-weight: 500; letter-spacing: -0.012em; color: #fff; margin: 0 0 8px; line-height: 1.06; text-wrap: balance; }
	.hero-desc { font-size: 14px; color: rgba(255,255,255,0.82); margin: 0 0 20px; line-height: 1.5; }
	.hero-actions { display: flex; align-items: center; gap: 14px; }
	.btn-play {
		display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 24px 0 19px;
		border-radius: var(--radius); background: var(--petal); color: var(--on-petal);
		font-size: 14px; font-weight: 500; transition: var(--t);
	}
	.hero:hover .btn-play { filter: brightness(1.06); }

	/* ── Rows / cards ── */
	.row-head { display: flex; align-items: baseline; margin-bottom: 14px; }
	.row-head h3 { font-size: 14px; font-weight: 500; margin: 0; }
	/* Padding gives the hover outline (2px ring + 2px offset) room INSIDE the
	   scroll box — overflow-x:auto also clips overflow-y, so without this the ring
	   gets cropped at the top and edges. Negative margin re-aligns the first card
	   with the row heading. */
	.hrail { display: flex; gap: var(--s3); overflow-x: auto; padding: 6px 6px 12px; margin: 0 -6px var(--s5); }
	.vcard { flex: none; border: none; background: transparent; padding: 0; cursor: pointer; text-align: left; font-family: inherit; color: var(--text); }
	/* Uniform art height; width follows the item's native ratio so covers aren't
	   cropped (poster 2:3, album 1:1, episode 16:9). */
	.vcard.r-portrait { width: 116px; }
	.vcard.r-square { width: 174px; }
	.vcard.r-landscape { width: 309px; }
	.art {
		position: relative; height: 174px; width: 100%; border-radius: var(--radius); overflow: hidden;
		display: flex; align-items: center; justify-content: center; color: var(--text-soft);
		background: var(--surface); transition: var(--t);
	}
	.art img {
		position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
		transition: transform var(--dur-base) var(--ease-standard);
	}
	.vcard:hover .art { outline: 2px solid var(--petal); outline-offset: 2px; }
	.vcard:hover .art img { transform: scale(1.03); }
	.art-icon { display: flex; position: relative; z-index: 1; }
	.art-play {
		position: absolute; z-index: 2; width: 46px; height: 46px; border-radius: 50%; background: var(--petal);
		display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 22px rgba(0,0,0,0.45);
		opacity: 0; transform: scale(0.8); transition: opacity var(--dur-fast) ease, transform var(--dur-fast) ease;
	}
	.vcard:hover .art-play { opacity: 1; transform: scale(1); }
	.vc-title {
		margin-top: 9px; font-size: 13.5px; font-weight: 500; line-height: 1.25;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.vc-meta { font-size: 12.5px; color: var(--text-mute); min-height: 16px; }
	.empty-state {
		min-height: 320px; display: flex; flex-direction: column; align-items: center; justify-content: center;
		text-align: center; border-radius: var(--radius-lg); background: var(--surface); padding: var(--s5);
	}
	.empty-mark {
		width: 72px; height: 72px; border-radius: var(--radius); background: var(--petal-soft); color: var(--petal);
		display: flex; align-items: center; justify-content: center; margin-bottom: var(--s3);
	}
	.empty-state h2 { margin: 0 0 6px; font-size: 20px; font-weight: 500; }

	@media (max-width: 640px) {
		.main-inner { padding: var(--s4) var(--s3) var(--s6); }
		.rail { display: none; }
		.hero { min-height: 280px; }
		.hero-body { padding: 28px 24px; }
		.art { height: 150px; }
		.vcard.r-portrait { width: 100px; }
		.vcard.r-square { width: 150px; }
		.vcard.r-landscape { width: 267px; }
	}
	.vcard.nonplay { cursor: default; }
	.vcard.nonplay:hover .art { outline: none; }
</style>

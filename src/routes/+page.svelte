<script lang="ts">
	import '$lib/styles/paper-ink.css';
	import { goto } from '$app/navigation';
	import {
		Menu, Search, Sun, Moon, House, Film, Tv, BookOpen, Gamepad2, Rss,
		Sparkles, Clock, Heart, BarChart3, Play, ImageIcon
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	type IconType = typeof House;
	type HomeItem = PageData['rows'][number]['items'][number];
	type Hero = NonNullable<PageData['hero']> & { posterUrl?: string; backdropUrl?: string };

	let { data }: { data: PageData } = $props();

	let railOpen = $state(true);
	let theme = $state<'light' | 'dark'>('dark');
	let activeNav = $state(0);

	onMount(() => {
		const saved = localStorage.getItem('petalnet-theme');
		if (saved === 'light' || saved === 'dark') theme = saved;
		else if (window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
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

	const nav: { icon: IconType; label: string }[] = [
		{ icon: House, label: 'Home' }, { icon: Film, label: 'Movies' }, { icon: Tv, label: 'Shows' },
		{ icon: BookOpen, label: 'Books' }, { icon: Gamepad2, label: 'Games' }, { icon: Rss, label: 'Subs' }
	];
	const explore: { icon: IconType; label: string }[] = [
		{ icon: Sparkles, label: 'New tonight' }, { icon: Clock, label: 'History' },
		{ icon: Heart, label: 'Favorites' }, { icon: BarChart3, label: 'Stats' }
	];
	const channels = [
		{ initial: 'W', name: 'Workbench', color: '#7A3B2E', fresh: true },
		{ initial: 'A', name: 'Aperture', color: '#2E4756', fresh: true },
		{ initial: 'F', name: 'Foundry', color: '#3A4A38', fresh: false },
		{ initial: 'D', name: 'Drift', color: '#4A3A5C', fresh: true },
		{ initial: 'S', name: 'Solo Ascent', color: '#6B5536', fresh: false }
	];
	const services = [
		{ name: 'Jellyfin', dot: 'var(--success)' }, { name: 'Plex', dot: 'var(--success)' },
		{ name: 'Audiobookshelf', dot: 'var(--success)' }, { name: 'Invidious', dot: 'var(--warning)' }
	];

	const hero = $derived((data.hero as Hero | null) ?? undefined);
	const heroArt = $derived(mediaBackdrop(hero) ?? mediaPoster(hero));
	const heroDescription = $derived(hero?.description);
	const contentRows = $derived(data.rows.filter((row) => row.items.length > 0));

	function mediaPoster(item: (HomeItem & { posterUrl?: string }) | undefined) {
		return item?.posterUrl ?? item?.poster;
	}

	function mediaBackdrop(item: (HomeItem & { backdropUrl?: string }) | undefined) {
		return item?.backdropUrl ?? item?.backdrop ?? item?.thumb;
	}

	function playUrl(item: Pick<HomeItem, 'serviceType' | 'sourceId' | 'id'>) {
		const backend = item.serviceType;
		const id = item.sourceId ?? item.id;
		return `/test-play/${encodeURIComponent(backend)}/${encodeURIComponent(id)}`;
	}

	function playHero(item: Hero) {
		goto(playUrl(item));
	}

	function playItem(item: HomeItem) {
		goto(playUrl(item));
	}
</script>

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
				<input placeholder="Search your whole library and feeds" />
				<span class="kbd mono">⌘K</span>
			</label>
		</div>
		<button class="icon-btn outlined" aria-label="Toggle theme" onclick={toggleTheme}>
			{#if theme === 'dark'}<Sun size={18} strokeWidth={1.8} />{:else}<Moon size={18} strokeWidth={1.8} />{/if}
		</button>
		<div class="avatar">P</div>
	</header>

	<div style="display:flex; flex:1; min-height:0;">
		<!-- LEFT RAIL -->
		<nav class="rail" class:closed={!railOpen} style="width:{railOpen ? '232px' : '72px'};">
			{#each nav as item, i}
				{@const Icon = item.icon}
				<button class="rail-item" class:active={i === activeNav} onclick={() => (activeNav = i)}>
					<span class="rail-icon"><Icon size={22} strokeWidth={2} /></span>
					{#if railOpen}<span class="rail-label">{item.label}</span>{/if}
				</button>
			{/each}

			<div class="rail-sep"></div>
			{#if railOpen}<div class="rail-section">Discover</div>{/if}
			{#each explore as item}
				{@const Icon = item.icon}
				<button class="rail-item">
					<span class="rail-icon muted"><Icon size={21} strokeWidth={2} /></span>
					{#if railOpen}<span class="rail-label">{item.label}</span>{/if}
				</button>
			{/each}

			<div class="rail-sep"></div>
			{#if railOpen}<div class="rail-section">Subscriptions</div>{/if}
			{#each channels as ch}
				<button class="rail-item channel">
					<span class="ch-avatar" style="background:{ch.color};">
						{ch.initial}
						{#if ch.fresh && !railOpen}<span class="fresh-badge"></span>{/if}
					</span>
					{#if railOpen}<span class="rail-label ch-name">{ch.name}</span>{/if}
					{#if railOpen && ch.fresh}<span class="fresh-dot"></span>{/if}
				</button>
			{/each}

			{#if railOpen}
				<div class="rail-sep"></div>
				<div class="rail-section">Services</div>
				{#each services as s}
					<div class="rail-service">
						<span class="svc-dot" style="background:{s.dot};"></span>
						<span class="svc-name">{s.name}</span>
					</div>
				{/each}
			{/if}
		</nav>

		<!-- MAIN — Tonight -->
		<main class="main">
			<div class="main-inner">
				<div class="eyebrow-row">
					<h1 class="eyebrow mono">Tonight</h1>
					<span class="dateline">{dateline}</span>
				</div>
				<p class="lede">One thread through everything you're hosting, newest and nearest to done first.</p>

				{#if hero}
					<button
						class="hero pi-settle"
						class:no-art={!heroArt}
						style:background-image={heroArt ? `url("${heroArt}")` : undefined}
						onclick={() => playHero(hero)}
					>
						<div class="hero-scrim"></div>
						<div class="hero-body">
							<div class="hero-tags">
								<span class="hero-source mono"><span class="live-dot"></span>{hero.serviceType}</span>
								{#if hero.type || hero.year}
									<span class="hero-kind mono">
										{hero.type ?? 'movie'}{#if hero.year} · {hero.year}{/if}
									</span>
								{/if}
							</div>
							<h2 class="hero-title">{hero.title}</h2>
							{#if heroDescription}<p class="hero-desc">{heroDescription}</p>{/if}
							<div class="hero-actions">
								<span class="btn-play"><Play size={16} strokeWidth={2} fill="currentColor" /> Play</span>
							</div>
						</div>
					</button>
				{/if}

				{#if contentRows.length === 0}
					<div class="empty-state pi-settle">
						<div class="empty-mark"><Sparkles size={34} strokeWidth={1.8} /></div>
						<h2>No content yet — connect a service in settings</h2>
					</div>
				{:else}
					{#each contentRows as row (row.id)}
						<div class="row-head">
							<h3>{row.title}</h3>
						</div>
						<div class="hrail">
							{#each row.items as item (item.id)}
								<button class="vcard pi-settle wide" onclick={() => playItem(item)} aria-label="Play {item.title}">
									<div class="art">
										{#if mediaPoster(item) || mediaBackdrop(item)}
											<img src={mediaPoster(item) ?? mediaBackdrop(item)} alt={item.title} loading="lazy" decoding="async" />
										{:else}
											<span class="art-icon"><ImageIcon size={30} strokeWidth={2} /></span>
										{/if}
										<span class="art-source mono">{item.serviceType}</span>
										<span class="art-play"><Play size={18} strokeWidth={2} fill="var(--on-petal)" /></span>
									</div>
									<div class="vc-title">{item.title}</div>
									<div class="vc-meta">
										{item.serviceType}{#if item.year} · {item.year}{/if}
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
	.search-wrap { flex: 1; display: flex; justify-content: center; }
	.search {
		width: 100%; max-width: 520px; display: flex; align-items: center; gap: 10px;
		height: 42px; padding: 0 14px; border-radius: var(--radius-sm); background: var(--surface);
		color: var(--text-soft); transition: var(--t);
	}
	.search:focus-within { outline: 1.5px solid var(--petal); outline-offset: -1.5px; }
	.search input {
		flex: 1; border: none; outline: none; background: transparent; color: var(--text);
		font-family: inherit; font-size: 14px;
	}
	.search input::placeholder { color: var(--text-soft); }
	.kbd {
		font-size: 11px; font-weight: 500; color: var(--text-soft);
		background: var(--bg); border-radius: var(--radius-xs); padding: 2px 6px;
	}
	.avatar {
		width: 34px; height: 34px; flex: none; border-radius: 50%; background: var(--surface);
		display: flex; align-items: center; justify-content: center;
		font-size: 13px; font-weight: 500; color: var(--text-mute); cursor: pointer;
	}

	/* ── Rail ── */
	.rail {
		flex: none; border-right: 1px solid var(--rule); padding: var(--s2);
		overflow-y: auto; overflow-x: hidden; transition: width var(--dur-base) var(--ease-standard);
	}
	.rail-item {
		width: 100%; height: 40px; display: flex; align-items: center; gap: 18px;
		padding: 0 14px; border: none; border-radius: var(--radius-sm); background: transparent;
		color: var(--text); font-family: inherit; font-size: 14px; font-weight: 400;
		cursor: pointer; margin-bottom: 2px; white-space: nowrap; transition: var(--t);
	}
	.rail.closed .rail-item { height: 46px; justify-content: center; padding: 0; gap: 0; }
	.rail-item:hover { background: var(--petal-soft); }
	.rail-item.active { background: var(--petal-soft); color: var(--petal); font-weight: 500; }
	.rail-icon { flex: none; display: flex; }
	.rail-icon.muted { color: var(--text-mute); }
	.rail-item.active .rail-icon { color: var(--petal); }
	.rail-label { overflow: hidden; text-overflow: ellipsis; }
	.rail-sep { height: 1px; background: var(--rule); margin: var(--s2) var(--s2); }
	.rail-section {
		padding: 6px 14px 8px; font-size: 13px; font-weight: 500; color: var(--text-mute); white-space: nowrap;
	}
	.ch-avatar {
		width: 26px; height: 26px; flex: none; border-radius: 50%; display: flex;
		align-items: center; justify-content: center; font-weight: 500; font-size: 11px;
		color: #fff; position: relative;
	}
	.channel .rail-label { flex: 1; text-align: left; }
	.fresh-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--petal); }
	.fresh-badge {
		position: absolute; top: -1px; right: -1px; width: 8px; height: 8px; border-radius: 50%;
		background: var(--petal); border: 2px solid var(--bg);
	}
	.rail-service { width: 100%; height: 36px; display: flex; align-items: center; gap: 14px; padding: 0 14px; white-space: nowrap; }
	.svc-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; }
	.svc-name { font-size: 13px; color: var(--text-mute); overflow: hidden; text-overflow: ellipsis; }

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
	.hero-source {
		display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 500; color: #fff;
		background: rgba(0,0,0,0.45); border-radius: var(--radius-xs); padding: 3px 8px;
	}
	.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--petal); animation: pulse 1.8s ease-in-out infinite; }
	@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.82); } }
	.hero-kind { font-size: 10px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(255,255,255,0.75); }
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
	.hrail { display: flex; gap: var(--s3); overflow-x: auto; padding-bottom: 10px; margin-bottom: var(--s5); }
	.vcard { border: none; background: transparent; padding: 0; cursor: pointer; text-align: left; font-family: inherit; color: var(--text); }
	.vcard.wide { flex: none; width: 264px; }
	.art {
		position: relative; aspect-ratio: 16 / 9; border-radius: var(--radius); overflow: hidden;
		display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.3);
		background: var(--surface); box-shadow: inset 0 -40px 50px -24px rgba(0,0,0,0.5); transition: var(--t);
	}
	.art img {
		position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
		transition: transform var(--dur-base) var(--ease-standard);
	}
	.vcard:hover .art { outline: 2px solid var(--petal); outline-offset: 2px; }
	.vcard:hover .art img { transform: scale(1.03); }
	.art::after {
		content: ''; position: absolute; inset: 0;
		background: linear-gradient(to bottom, rgba(0,0,0,0.28), rgba(0,0,0,0.08) 42%, rgba(0,0,0,0.46));
		pointer-events: none;
	}
	.art-icon { display: flex; position: relative; z-index: 1; }
	.art-source {
		position: absolute; z-index: 2; top: 9px; left: 9px; font-size: 10px; font-weight: 500; color: #fff;
		background: rgba(0,0,0,0.5); border-radius: var(--radius-xs); padding: 3px 7px;
	}
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
	.vc-meta { font-size: 12.5px; color: var(--text-mute); }
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
		.search-wrap { display: none; }
		.main-inner { padding: var(--s4) var(--s3) var(--s6); }
		.rail { display: none; }
		.hero { min-height: 280px; }
		.hero-body { padding: 28px 24px; }
		.vcard.wide { width: 232px; }
	}
</style>
